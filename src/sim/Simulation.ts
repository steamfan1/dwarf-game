/**
 * All game state that advances in fixed ticks, and the orders that change it.
 *
 * The player never changes the world directly. Orders only mark work (dig this block,
 * fell that tree, cancel, change priority) on the job board; dwarves claim the jobs and
 * do them over time, and the changes they make (a block removed, a tree felled, items
 * dropped) come back through the methods in the "Changes made by dwarves" section. Spells
 * (Milestone 7) will be the other way to reshape the world, again through those methods.
 *
 * Every change to a cell keeps the rest in step: lighting is redone around it (and any
 * newly lit cell counts as explored), cached paths through its chunk are dropped, nearby
 * blocked jobs are retried, and the renderer is told via TileChanged.
 *
 * Pure TypeScript: no Phaser and no DOM, so it runs in unit tests and could move into a
 * worker. All randomness comes from `rng`, never Math.random(), so a world can be
 * replayed exactly from its seed and the player's orders.
 */
import type { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { createDwarf, type Dwarf } from './dwarves/Dwarf';
import { DwarfAI, type ColonyContext } from './dwarves/DwarfAI';
import type { ColonySettings } from './dwarves/settings';
import type { GameEvents } from './events';
import { ColonyStorage, GroundItems } from './items/Items';
import type { ItemRegistry } from './items/ItemRegistry';
import { HAUL_PRIORITY, JobBoard, type Job, type Priority } from './jobs/JobBoard';
import { HEARTH_LIGHT, Lighting } from './light/Lighting';
import { HomeMaps } from './nav/HomeMaps';
import { NavGrid } from './nav/NavGrid';
import { Pathfinder } from './nav/Pathfinder';
import { PathService } from './nav/PathService';
import { AIR, type TileRegistry } from './world/TileRegistry';
import { TreeFinder, type Tree } from './world/trees';
import type { CellRect, World } from './world/World';

/** Why a block can or can't be marked for digging. */
export type DigStatus =
  | 'ok'
  | 'marked'
  | 'out-of-bounds'
  | 'unexplored'
  | 'nothing-to-dig'
  | 'indestructible'
  | 'supports-hearth'
  | 'supports-tree';

/** The tools that mark work. 'auto' fells trees and digs everything else that can be dug. */
export type DesignationTool = 'dig' | 'chop' | 'auto';

/** Most A* searches per tick, so a burst of new jobs never drops a frame. */
export const PATH_SEARCHES_PER_TICK = 4;
/** Cells one search may expand before giving up (the whole world is 80,000). */
export const PATH_SEARCH_LIMIT = 30_000;
/** After the terrain changes, the home maps are rebuilt at most this often (ticks). */
const MAP_REBUILD_TICKS = 5;

export interface SimulationOptions {
  world: World;
  tiles: TileRegistry;
  items: ItemRegistry;
  colony: ColonySettings;
  bus: EventBus<GameEvents>;
}

export class Simulation implements ColonyContext {
  readonly world: World;
  readonly tiles: TileRegistry;
  readonly items: ItemRegistry;
  readonly colony: ColonySettings;
  readonly rng: Rng;
  /** The colony's home: where hauled items are stored, and later the Recall target and revival spot. */
  readonly hearth: { x: number; y: number };
  /** The Hearth's three cells; hauled items are delivered next to them. */
  readonly storeArea: CellRect;
  readonly lighting: Lighting;
  readonly nav: NavGrid;
  readonly paths: PathService;
  /** Where dwarves can get to from the Hearth and back again (see HomeMaps). */
  readonly homeMaps: HomeMaps;
  readonly jobs: JobBoard;
  readonly ground: GroundItems;
  readonly storage: ColonyStorage;
  readonly trees: TreeFinder;
  readonly dwarves: Dwarf[] = [];
  /** Number of ticks simulated since the world began. */
  tick = 0;
  /** Bumped whenever a block appears or disappears (the home maps go out of date). */
  terrainVersion = 0;

  private readonly bus: EventBus<GameEvents>;
  private mapsVersion = -1;
  private mapsTick = -MAP_REBUILD_TICKS;
  private readonly ai: DwarfAI;
  private readonly logTiles: ReadonlySet<number>;

  constructor({ world, tiles, items, colony, bus }: SimulationOptions) {
    this.world = world;
    this.tiles = tiles;
    this.items = items;
    this.colony = colony;
    this.bus = bus;
    this.rng = new Rng(`${world.seed}:simulation`);
    this.hearth = { ...world.spawn };
    this.storeArea = { x0: this.hearth.x - 1, y0: this.hearth.y, x1: this.hearth.x + 1, y1: this.hearth.y };
    this.logTiles = new Set(tiles.tiles.flatMap((t, i) => (t.art.style === 'log' ? [i] : [])));

    this.nav = new NavGrid(world, tiles, { safeDrop: colony.movement.safeDrop });
    this.paths = new PathService(world, new Pathfinder(this.nav, { maxExpanded: PATH_SEARCH_LIMIT }), {
      searchesPerTick: PATH_SEARCHES_PER_TICK,
      cacheSize: 256,
    });
    this.homeMaps = new HomeMaps(this.nav);
    this.jobs = new JobBoard(world);
    this.jobs.onMarkChanged = (x, y) => this.bus.emit('DesignationChanged', { x, y });
    this.jobs.onBlocked = (job) => this.bus.emit('JobBlocked', { type: job.type, x: job.x, y: job.y });
    this.ground = new GroundItems(world, tiles, items);
    this.storage = new ColonyStorage();
    this.trees = new TreeFinder(world, tiles);

    // Light the world. Whatever the light reaches (the whole surface, glowing lava and
    // crystals, the Hearth's surroundings) counts as explored from the start.
    this.lighting = new Lighting(world, tiles);
    if (world.inBounds(this.hearth.x, this.hearth.y)) this.lighting.setPointLight(this.hearth.x, this.hearth.y, HEARTH_LIGHT);
    this.lighting.discover(this.lighting.computeAll());

    this.spawnDwarves();
    this.ai = new DwarfAI(this);
    this.rebuildMaps();
  }

  /** Advance the world by exactly one tick (1/20 s of game time at 1x). */
  step(): void {
    this.tick++;
    this.paths.beginTick();
    if (this.mapsVersion !== this.terrainVersion && this.tick - this.mapsTick >= MAP_REBUILD_TICKS) this.rebuildMaps();
    for (const stack of this.ground.step()) {
      if (stack.haulJob !== 0) this.jobs.remove(stack.haulJob);
    }
    // Haul jobs follow their stacks as they fall.
    for (const stack of this.ground.all()) {
      const job = stack.haulJob !== 0 ? this.jobs.get(stack.haulJob) : undefined;
      if (job) {
        job.x = stack.x;
        job.y = stack.y;
      }
    }
    for (const dwarf of this.dwarves) this.ai.update(dwarf);
  }

  get livingDwarves(): Dwarf[] {
    return this.dwarves.filter((dwarf) => dwarf.phase !== 'dead');
  }

  dwarf(id: number): Dwarf | undefined {
    return this.dwarves.find((dwarf) => dwarf.id === id);
  }

  // ---- Player orders: they mark work; dwarves do it ------------------------------------------

  /** Whether a block can be marked for digging, and if not, why. */
  digStatus(x: number, y: number): DigStatus {
    const { world } = this;
    if (!world.inBounds(x, y)) return 'out-of-bounds';
    if (!world.isVisible(x, y)) return 'unexplored';
    if (this.jobs.at(x, y)?.type === 'dig') return 'marked';
    return this.blockReason(x, y) ?? 'ok';
  }

  /**
   * Mark work in a rectangle of cells: blocks to dig, or trees to fell (any part of a
   * tree marks the whole tree), or with 'auto' whichever of the two each cell needs.
   * Returns the number of new jobs.
   */
  designate(tool: DesignationTool, rect: CellRect, priority: Priority): number {
    const r = this.clampRect(rect);
    let added = 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if ((tool === 'chop' || tool === 'auto') && this.markTree(x, y, priority)) added++;
        else if ((tool === 'dig' || tool === 'auto') && this.markDig(x, y, priority)) added++;
      }
    }
    return added;
  }

  /** What a click with the Auto tool would mark here: a tree to fell, a block to dig, or nothing. */
  autoTarget(x: number, y: number): 'chop' | 'dig' | null {
    if (!this.world.inBounds(x, y) || !this.world.isVisible(x, y)) return null;
    if (this.trees.treeAt(x, y)) return 'chop';
    return this.digStatus(x, y) === 'ok' ? 'dig' : null;
  }

  /** Remove dig and chop marks in a rectangle (dwarves on those jobs stop). Returns how many. */
  cancelDesignations(rect: CellRect): number {
    const jobs = this.jobs.inRect(this.clampRect(rect));
    for (const job of jobs) this.jobs.remove(job.id);
    return jobs.length;
  }

  /** Change the priority of the dig and chop jobs in a rectangle. Returns how many. */
  prioritize(rect: CellRect, priority: Priority): number {
    const jobs = this.jobs.inRect(this.clampRect(rect));
    for (const job of jobs) this.jobs.setPriority(job.id, priority);
    return jobs.length;
  }

  // ---- Changes made by dwarves (and, later, spells) --------------------------------------------

  /** How far along a dig or chop job is, 0 to 1, at the pace of the dwarf on it (or a beginner). */
  jobProgress(job: Job): number {
    const dwarf = job.claimedBy !== 0 ? this.dwarf(job.claimedBy) : undefined;
    const speed = dwarf ? 1 + this.colony.skills.speedPerLevel * (dwarf.skills.mining.level - 1) : 1;
    let required: number;
    if (job.type === 'dig') {
      const tile = this.world.fg[this.world.index(job.x, job.y)]!;
      required = (this.colony.work.digTicksPerHardness * this.tiles.tiles[tile]!.hardness) / speed;
    } else if (job.type === 'chop') {
      required = this.colony.work.chopTicks / speed;
    } else {
      return 0;
    }
    return required > 0 ? Math.min(1, job.progress / required) : 1;
  }

  canDigNow(x: number, y: number): boolean {
    return this.world.inBounds(x, y) && this.blockReason(x, y) === null;
  }

  workCellOk(job: Job, cell: number): boolean {
    if (job.type !== 'dig') return true;
    // Standing on the block being dug is fine only if the fall that follows is safe.
    const { world } = this;
    return cell !== world.index(job.x, job.y - 1) || this.nav.fallAfterRemoving(job.x, job.y) <= this.colony.movement.safeDrop;
  }

  jobWorkable(job: Job): boolean {
    const { world, homeMaps } = this;
    if (job.type === 'haul') return world.inBounds(job.x, job.y) && homeMaps.workable(world.index(job.x, job.y));
    for (let y = job.y - 1; y <= job.y + 1; y++) {
      for (let x = job.x - 1; x <= job.x + 1; x++) {
        if (!world.inBounds(x, y)) continue;
        const cell = world.index(x, y);
        if (homeMaps.workable(cell) && this.workCellOk(job, cell)) return true;
      }
    }
    return false;
  }

  removeBlock(x: number, y: number, by: Dwarf): void {
    const { world, tiles } = this;
    const i = world.index(x, y);
    const drops = tiles.tiles[world.fg[i]!]!.drops;
    world.fg[i] = AIR;
    this.bus.emit('TileChanged', { x, y });

    // Grass tufts, flowers and the like would float without the block under them.
    const above = world.fgAt(x, y - 1);
    if (y > 0 && !tiles.solid[above] && tiles.replaceable[above] && tiles.tiles[above]?.art.style === 'sprite') {
      world.fg[world.index(x, y - 1)] = AIR;
      this.bus.emit('TileChanged', { x, y: y - 1 });
    }
    // What comes out lands at the digger's feet, never in a pocket nobody can reach.
    if (drops) this.dropItems(this.items.item(drops), 1, by.x, by.y);
    this.terrainChanged(x, y);
    this.bus.emit('BlockDug', { x, y, dwarf: by.id });
  }

  fellTree(tree: Tree, by: Dwarf): void {
    const { world, tiles } = this;
    const drops = tiles.tiles[world.fg[world.index(tree.x, tree.base)]!]!.drops;
    for (const cell of tree.cells) {
      world.fg[cell] = AIR;
      const x = cell % world.width;
      this.bus.emit('TileChanged', { x, y: (cell - x) / world.width });
    }
    // Trees don't block movement or light, so only the picture changes.
    if (drops) this.dropItems(this.items.item(drops), tree.wood, tree.x, tree.base);
    this.bus.emit('TreeFelled', { x: tree.x, y: tree.base, dwarf: by.id });
  }

  dropItems(item: number, count: number, x: number, y: number, skipDwarf?: number): void {
    for (const stack of this.ground.drop(item, count, x, y)) {
      const job = this.jobs.add({ type: 'haul', x: stack.x, y: stack.y, priority: HAUL_PRIORITY, tick: this.tick, stackId: stack.id });
      stack.haulJob = job.id;
      if (skipDwarf !== undefined) job.unreachableFor.add(skipDwarf);
      // A falling stack is judged where it lands, when the maps are next rebuilt.
      if (!stack.falling) this.flagIfBlocked(job);
    }
  }

  reveal(x: number, y: number, radius: number): void {
    const revealed = this.world.revealEllipse(x, y, radius, radius);
    if (revealed) this.bus.emit('ExploredChanged', revealed);
  }

  dwarfDied(dwarf: Dwarf, cause: 'fall' | 'lava'): void {
    this.bus.emit('DwarfDied', { dwarf: dwarf.id, name: dwarf.name, cause });
  }

  skillUp(dwarf: Dwarf, skill: 'mining'): void {
    this.bus.emit('SkillUp', { dwarf: dwarf.id, name: dwarf.name, skill, level: dwarf.skills[skill].level });
  }

  /** Debug: lift the fog of war everywhere. */
  revealAll(): void {
    this.bus.emit('ExploredChanged', this.world.revealAll());
  }

  // ---- Internals --------------------------------------------------------------------------------

  private markDig(x: number, y: number, priority: Priority): boolean {
    if (this.digStatus(x, y) !== 'ok') return false;
    this.flagIfBlocked(this.jobs.add({ type: 'dig', x, y, priority, tick: this.tick, cells: [this.world.index(x, y)] }));
    return true;
  }

  /** Mark the tree with a part in (x, y) for felling, unless it's marked already. */
  private markTree(x: number, y: number, priority: Priority): boolean {
    if (!this.world.inBounds(x, y) || !this.world.isVisible(x, y)) return false;
    const tree = this.trees.treeAt(x, y);
    if (!tree || this.jobs.at(tree.x, tree.base)) return false;
    this.flagIfBlocked(this.jobs.add({ type: 'chop', x: tree.x, y: tree.base, priority, tick: this.tick, cells: tree.column }));
    return true;
  }

  /** Why a block can't be dug at all, or null if it can. */
  private blockReason(x: number, y: number): Exclude<DigStatus, 'ok' | 'marked' | 'out-of-bounds' | 'unexplored'> | null {
    const { world, tiles } = this;
    const tile = world.fg[world.index(x, y)]!;
    if (!tiles.solid[tile]) return 'nothing-to-dig';
    if (!tiles.diggable[tile]) return 'indestructible';
    if (y === this.hearth.y + 1 && Math.abs(x - this.hearth.x) <= 1) return 'supports-hearth';
    if (this.logTiles.has(world.fgAt(x, y - 1))) return 'supports-tree';
    return null;
  }

  /** Keep lighting, exploration, cached paths and blocked jobs in step with a changed cell. */
  private terrainChanged(x: number, y: number): void {
    const relit = this.lighting.cellChanged(x, y);
    const discovered = this.lighting.discover(relit);
    if (discovered) this.bus.emit('ExploredChanged', discovered);
    this.paths.terrainChanged(x, y);
    this.jobs.terrainChanged(x, y);
    this.terrainVersion++;
  }

  /** Show a new job as blocked straight away if nobody can do it. */
  private flagIfBlocked(job: Job): void {
    this.jobs.setBlocked(job, !this.jobWorkable(job));
  }

  /** Redo the home maps, then flag the jobs nobody can do from a cell that leads back home. */
  private rebuildMaps(): void {
    this.homeMaps.rebuild(this.storeArea, 1);
    this.mapsVersion = this.terrainVersion;
    this.mapsTick = this.tick;
    this.jobs.mapsRebuilt();
    for (const job of this.jobs.all()) this.jobs.setBlocked(job, job.unsafe || !this.jobWorkable(job));
  }

  private clampRect(rect: CellRect): CellRect {
    return {
      x0: Math.max(0, Math.min(rect.x0, rect.x1)),
      y0: Math.max(0, Math.min(rect.y0, rect.y1)),
      x1: Math.min(this.world.width - 1, Math.max(rect.x0, rect.x1)),
      y1: Math.min(this.world.height - 1, Math.max(rect.y0, rect.y1)),
    };
  }

  /** The starting dwarves stand on the ground either side of the Hearth. */
  private spawnDwarves(): void {
    const rng = this.rng.fork('dwarves');
    const names = new Set<string>();
    const offsets = [-2, 2, 4, -4, 6, -6, 8, -8, 3, -3, 5, -5];
    for (let n = 0; n < this.colony.startingDwarves; n++) {
      const spot = this.standingSpotNear(this.hearth.x + offsets[n % offsets.length]!, this.hearth.y);
      const dwarf = createDwarf(n + 1, spot.x, spot.y, rng, this.colony, names);
      names.add(dwarf.name);
      this.dwarves.push(dwarf);
      this.world.revealEllipse(spot.x, spot.y, this.colony.vision.radius, this.colony.vision.radius);
    }
  }

  private standingSpotNear(x: number, y: number): { x: number; y: number } {
    const cx = Math.max(0, Math.min(this.world.width - 1, x));
    for (let row = y - 3; row <= y + 3; row++) {
      if (this.nav.standable(cx, row)) return { x: cx, y: row };
    }
    const landing = this.nav.landingRow(cx, Math.max(0, y));
    return { x: cx, y: landing >= 0 ? landing : Math.max(0, y) };
  }
}
