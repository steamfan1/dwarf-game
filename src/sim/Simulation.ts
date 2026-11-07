/**
 * All game state that advances in fixed ticks, and the orders that change it.
 *
 * The player never changes the world directly. Orders only mark work (dig this block,
 * build a wall there, set a workbench down here, craft ten planks) on the job board;
 * dwarves claim the jobs and do them over time, and the changes they make (a block
 * removed or built, a tree felled, items dropped or stored) come back through the methods
 * in the "Changes made by dwarves" section. Spells (Milestone 7) will be the other way to
 * reshape the world, again through those methods.
 *
 * Every change to a cell keeps the rest in step: lighting is redone around it (and any
 * newly lit cell counts as explored), cached paths through its chunk are dropped, nearby
 * blocked jobs are retried, and the renderer is told via TileChanged.
 *
 * Materials: the colony's goods sit in one store, reached from the Hearth and from every
 * chest (see ColonyStorage). A dwarf that takes on a build or craft job reserves what it
 * needs, fetches it from whichever of those is nearest, and uses it up at the site or
 * station. Jobs whose materials aren't in storage wait, flagged as missing them.
 *
 * Time and needs: the clock (TimeOfDay) turns day into night and back; dwarves get hungry
 * and tired, eat from storage (better at a table) and sleep at night (better in a bed in
 * a lit room). Rooms are found by flood fill (RoomMap) whenever blocks, walls, doors or
 * furniture change.
 *
 * Threats: the Spawner brings monsters out of the dark at night and through a portal
 * every few nights, and animals onto the hills by day; CreatureAI moves them. Dwarves
 * fight back by themselves (DwarfAI), helped by traps and turrets. Monsters break doors
 * and blocks to get at dwarves (TileDamage); missiles fly in a pool (Projectiles).
 *
 * Pure TypeScript: no Phaser and no DOM, so it runs in unit tests and could move into a
 * worker. All randomness comes from `rng`, never Math.random(), so a world can be
 * replayed exactly from its seed and the player's orders.
 */
import type { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { CraftQueue, type CraftOrder } from './crafting/CraftQueue';
import { HAND_CRAFTED, type Recipe, type RecipeBook } from './crafting/Recipes';
import { armoredDamage, lineOfSight as clearShot, Projectiles, seeThrough, type Projectile, type ProjectileImpact } from './combat/Combat';
import { TileDamage } from './combat/TileDamage';
import { createCreature, toughness, type Creature, type CreatureOrigin } from './creatures/Creature';
import { CreatureAI, type CreatureContext } from './creatures/CreatureAI';
import { CreatureNav, type Breaker } from './creatures/CreatureNav';
import type { CreatureDef, CreatureRegistry } from './creatures/CreatureRegistry';
import { Spawner, type SpawnerContext, type SpawnerEvent } from './creatures/Spawner';
import type { ThreatSettings } from './creatures/threats';
import { arrivedTraveller, createDwarf, gainXp, skillSpeed, type Dwarf, type Skill, type Traveller } from './dwarves/Dwarf';
import { DwarfAI, type ColonyContext, type NeedRates, type Weapon } from './dwarves/DwarfAI';
import type { ColonySettings } from './dwarves/settings';
import type { DeathCause, GameEvents } from './events';
import type { CropRegistry } from './farming/Crops';
import { Farms, growTicks, stageTile, type Plot } from './farming/Farms';
import { FurnitureSet, type PlacedFurniture } from './furniture/Furniture';
import type { FurnitureRegistry } from './furniture/FurnitureRegistry';
import { ColonyStorage, GroundItems } from './items/Items';
import { EQUIP_SLOTS, type ItemCount, type ItemRegistry, type ProjectileKind } from './items/ItemRegistry';
import { DEFAULT_PRIORITY, HAUL_PRIORITY, JobBoard, PERSONAL_JOBS, type Job, type Priority } from './jobs/JobBoard';
import { HEARTH_LIGHT, Lighting } from './light/Lighting';
import { HomeMaps } from './nav/HomeMaps';
import { NavGrid } from './nav/NavGrid';
import { Pathfinder, type PathGoal } from './nav/Pathfinder';
import { PathService } from './nav/PathService';
import { RoomMap } from './rooms/RoomMap';
import { Research, type TechTier, type TechTree } from './tech/TechTree';
import { TimeOfDay, type TimeSettings } from './time/TimeOfDay';
import { AIR, NO_LIQUID, type TileRegistry } from './world/TileRegistry';
import { TreeFinder, type Tree } from './world/trees';
import { FLAG_BUILT, type CellRect, type World } from './world/World';

/** Why a block can or can't be marked for digging. */
export type DigStatus =
  | 'ok'
  | 'marked'
  | 'out-of-bounds'
  | 'unexplored'
  | 'nothing-to-dig'
  | 'indestructible'
  | 'supports-hearth'
  | 'supports-tree'
  | 'supports-furniture';

/** Why a block, wall or piece of furniture can or can't be planned somewhere. */
export type BuildStatus =
  | 'ok'
  | 'out-of-bounds'
  | 'unexplored'
  /** Other work is already planned there. */
  | 'marked'
  /** A block, a tree, furniture, lava or the Hearth is in the way. */
  | 'occupied'
  /** There is a background wall there already. */
  | 'has-wall'
  /** Nothing would hold it up: it needs a block, ladder or wall next to it (or a wall behind it). */
  | 'unsupported'
  /** It must stand on solid ground. */
  | 'needs-floor'
  /** It hangs on a background wall, or on a block beside it. */
  | 'needs-wall'
  /** The item doesn't build that kind of thing. */
  | 'cannot-build'
  /** Crops need soil to grow in (dirt or clay) under them. */
  | 'needs-soil';

/** Where a crafting order stands, for the crafting panel. */
export type CraftStatus = 'working' | 'queued' | 'missing-materials' | 'no-station';

/** The tools that mark work. 'auto' fells trees, picks plants and digs everything else that can be dug. */
export type DesignationTool = 'dig' | 'chop' | 'auto';

/** Most A* searches per tick, so a burst of new jobs never drops a frame. */
export const PATH_SEARCHES_PER_TICK = 4;
/** Cells one search may expand before giving up (the whole world is 80,000). */
export const PATH_SEARCH_LIMIT = 30_000;
/** After the terrain changes, the home maps are rebuilt at most this often (ticks). */
const MAP_REBUILD_TICKS = 5;
/** Crafting orders get their jobs, and build jobs their "missing materials" flags, this often (ticks). */
const SUPPLY_CHECK_TICKS = 10;
/** "Storage is full" is announced at most this often (ticks). */
const STORAGE_FULL_NOTICE_TICKS = 400;
/** Rooms are found again at most this often after something changes (ticks). */
const ROOM_REBUILD_TICKS = 10;
/** Picked plants are checked for regrowth this often (ticks). */
const REGROWTH_CHECK_TICKS = 20;
/** Crops grow, and farm plots post their jobs, this often (ticks). */
const FARM_CHECK_TICKS = 20;
/** Creatures get their own path searches each tick, apart from the dwarves'. */
export const CREATURE_SEARCHES_PER_TICK = 2;
/** Cells one creature search may expand (they hunt nearby prey, or head for the Hearth). */
const CREATURE_SEARCH_LIMIT = 5000;
/** The most steps that breaking one block adds to a monster's path (see breakerFor). */
const BREAK_COST_CAP = 40;
/** A door or block being smashed wakes dwarves asleep within this many tiles... */
const NOISE_RADIUS = 8;
/** ...for this many ticks after each blow. */
const NOISE_TICKS = 30;
/** The portal's glow. */
const PORTAL_LIGHT = 10;
/** A hurt animal runs for this long (ticks). */
const ANIMAL_FLEE_TICKS = 70;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export interface SimulationOptions {
  world: World;
  tiles: TileRegistry;
  items: ItemRegistry;
  furniture: FurnitureRegistry;
  recipes: RecipeBook;
  colony: ColonySettings;
  time: TimeSettings;
  creatures: CreatureRegistry;
  threats: ThreatSettings;
  tech: TechTree;
  crops: CropRegistry;
  bus: EventBus<GameEvents>;
  /** The hour the world starts at, instead of time.json's (from the page address, for testing). */
  startHour?: number;
  /** Dwarves who came through a World Gate from the last world: they are the starting dwarves. */
  travellers?: readonly Traveller[];
  /**
   * False when the world is being loaded from a save: no starting dwarves, goods or
   * animals (the save brings its own). True by default.
   */
  fresh?: boolean;
}

/** What a save keeps that only the simulation itself can see (see save/SimState.ts). */
export interface SimInternals {
  nextCreatureId: number;
  worldWon: boolean;
  colonyLost: boolean;
  /** Picked plants growing back: the cell, the tile it is now and will be (tile numbers), and when. */
  regrowth: Array<{ cell: number; from: number; to: number; at: number }>;
}

/** What the HUD shows of an invasion: coming (with ticks to go), or under way (invaders left). */
export type WaveView = { phase: 'warning'; ticksLeft: number; side: -1 | 1 } | { phase: 'open'; left: number; side: -1 | 1 } | null;

export class Simulation implements ColonyContext, CreatureContext, SpawnerContext {
  readonly world: World;
  readonly tiles: TileRegistry;
  readonly items: ItemRegistry;
  readonly furnitureKinds: FurnitureRegistry;
  readonly recipes: RecipeBook;
  readonly colony: ColonySettings;
  readonly rng: Rng;
  /** The colony's home: where goods are stored, and later the Recall target and revival spot. */
  readonly hearth: { x: number; y: number };
  /** The Hearth's bottom row; dwarves stand within one tile of it to store and fetch goods. */
  readonly storeArea: CellRect;
  /** Every cell the Hearth covers: nothing can be built there. */
  readonly hearthArea: CellRect;
  readonly lighting: Lighting;
  readonly nav: NavGrid;
  readonly paths: PathService;
  /** Where dwarves can get to from the Hearth and back again (see HomeMaps). */
  readonly homeMaps: HomeMaps;
  readonly jobs: JobBoard;
  readonly ground: GroundItems;
  readonly storage: ColonyStorage;
  readonly furniture: FurnitureSet;
  readonly crafting: CraftQueue;
  readonly trees: TreeFinder;
  readonly time: TimeOfDay;
  readonly rooms: RoomMap;
  readonly needRates: NeedRates;
  readonly dwarves: Dwarf[] = [];
  readonly creatureKinds: CreatureRegistry;
  readonly threats: ThreatSettings;
  /** Every creature in the world: monsters and animals. */
  readonly creatures: Creature[] = [];
  /** Missiles in flight. */
  readonly projectiles = new Projectiles();
  /** Doors and blocks monsters have damaged. */
  readonly tileDamage = new TileDamage();
  /** Path searches for creatures, with their own budget. */
  readonly creaturePaths: PathService;
  readonly creatureRng: Rng;
  readonly spawner: Spawner;
  /** The colony's progress through the tech tree. */
  readonly research: Research;
  readonly cropKinds: CropRegistry;
  /** Farm plots marked with the Farm tool. */
  readonly farms = new Farms();
  /** Number of ticks simulated since the world began. */
  tick = 0;
  /** Bumped whenever a block appears or disappears (the home maps go out of date). */
  terrainVersion = 0;

  private readonly bus: EventBus<GameEvents>;
  private mapsVersion = -1;
  private mapsTick = -MAP_REBUILD_TICKS;
  private readonly ai: DwarfAI;
  private readonly logTiles: ReadonlySet<number>;
  /** The item that builds each furniture kind. */
  private readonly furnitureItems: Map<number, number>;
  /** Items dwarves can wear or wield. */
  private readonly gear: number[];
  /** Bumped when a chest is set down or taken away: the places to store goods have changed. */
  private storesVersion = 0;
  private lastStorageNotice = -STORAGE_FULL_NOTICE_TICKS;
  private readonly lavaType: number;
  /** Food items, most filling first. */
  private readonly foods: number[];
  private wasNight: boolean;
  private roomsDirty = true;
  private roomsTick = -ROOM_REBUILD_TICKS;
  /** Picked plants waiting to grow back: the cell, the tile it is now, what it becomes, and when. */
  private readonly regrowth: Array<{ cell: number; from: number; to: number; at: number }> = [];
  /** When each starving dwarf was last announced. */
  private readonly starvingNotices = new Map<number, number>();
  private readonly creatureAI: CreatureAI;
  /** How each kind of creature gets about, by kind. */
  private readonly creatureNavs: CreatureNav[];
  private nextCreatureId = 1;
  /** The latest loud noise (a door being smashed), which wakes sleepers near it. */
  private noise: { x: number; y: number; tick: number } | null = null;
  private portalLight: { x: number; y: number } | null = null;
  private colonyLost = false;
  /** Hunting marks by creature id (the job's id). */
  private readonly hunts = new Map<number, number>();
  /** The item that brings fallen dwarves back (-1 if none does). */
  private readonly reviveItem: number;
  /** The World Gate has been built. */
  private worldWon = false;

  constructor({ world, tiles, items, furniture, recipes, colony, time, creatures, threats, tech, crops, bus, startHour, travellers, fresh = true }: SimulationOptions) {
    this.world = world;
    this.tiles = tiles;
    this.items = items;
    this.furnitureKinds = furniture;
    this.recipes = recipes;
    this.colony = colony;
    this.creatureKinds = creatures;
    this.threats = threats;
    this.research = new Research(tech);
    this.cropKinds = crops;
    this.bus = bus;
    this.rng = new Rng(`${world.seed}:simulation`);
    this.creatureRng = this.rng.fork('creatures');
    this.hearth = { ...world.spawn };
    this.storeArea = { x0: this.hearth.x - 1, y0: this.hearth.y, x1: this.hearth.x + 1, y1: this.hearth.y };
    this.hearthArea = { ...this.storeArea, y0: this.hearth.y - 1 };
    this.logTiles = new Set(tiles.tiles.flatMap((t, i) => (t.art.style === 'log' ? [i] : [])));
    this.lavaType = tiles.hasLiquid('lava') ? tiles.liquid('lava') : -1;
    this.furnitureItems = new Map();
    items.items.forEach((item, i) => {
      if (item.builds && 'furniture' in item.builds) this.furnitureItems.set(furniture.id(item.builds.furniture), i);
    });
    this.gear = items.items.flatMap((item, i) => (item.equip ? [i] : []));
    this.reviveItem = items.items.findIndex((item) => item.revive !== null);
    this.foods = items.items
      .flatMap((item, i) => (item.food ? [i] : []))
      .sort((a, b) => items.get(b).food!.hunger - items.get(a).food!.hunger || a - b);
    this.time = new TimeOfDay(time, startHour);
    this.wasNight = this.time.isNight(0);
    this.needRates = needRates(colony, this.time);

    this.nav = new NavGrid(world, tiles, { safeDrop: colony.movement.safeDrop });
    this.paths = new PathService(world, new Pathfinder(this.nav, { maxExpanded: PATH_SEARCH_LIMIT }), {
      searchesPerTick: PATH_SEARCHES_PER_TICK,
      cacheSize: 256,
    });
    this.homeMaps = new HomeMaps(this.nav);
    this.jobs = new JobBoard(world);
    this.jobs.onMarkChanged = (x, y) => this.bus.emit('DesignationChanged', { x, y });
    this.jobs.onBlocked = (job) => this.bus.emit('JobBlocked', { type: job.type, x: job.x, y: job.y });
    this.jobs.onLetGo = (job) => this.letGo(job);
    this.ground = new GroundItems(world, tiles, items);
    this.storage = new ColonyStorage(items, colony.storage.hearthSlots);
    this.furniture = new FurnitureSet(world, furniture);
    this.crafting = new CraftQueue();
    this.trees = new TreeFinder(world, tiles);
    this.rooms = new RoomMap(world, tiles);
    if (fresh) for (const { item, count } of colony.startingItems) if (items.has(item)) this.storage.add(items.item(item), count);

    // Light the world. Whatever sunlight reaches (the whole surface and a few blocks
    // into the ground) counts as explored from the start.
    this.lighting = new Lighting(world, tiles);
    if (world.inBounds(this.hearth.x, this.hearth.y)) this.lighting.setPointLight(this.hearth.x, this.hearth.y, HEARTH_LIGHT);
    this.lighting.discover(this.lighting.computeAll());

    if (fresh) this.spawnDwarves(travellers ?? []);
    this.ai = new DwarfAI(this);
    this.rebuildMaps();
    this.rebuildRooms();

    this.creatureNavs = creatures.defs.map((def) => new CreatureNav(world, tiles, def.movement, this.breakerFor(def)));
    this.creaturePaths = new PathService(world, new Pathfinder(this.nav, { maxExpanded: CREATURE_SEARCH_LIMIT }), {
      searchesPerTick: CREATURE_SEARCHES_PER_TICK,
      cacheSize: 64,
    });
    this.creatureAI = new CreatureAI(this);
    this.spawner = new Spawner(this, this.rng.fork('spawner'));
    if (fresh) this.spawner.populate();
  }

  /** For saves: the private state (see save/SimState.ts). */
  saveInternals(): SimInternals {
    return {
      nextCreatureId: this.nextCreatureId,
      worldWon: this.worldWon,
      colonyLost: this.colonyLost,
      regrowth: this.regrowth.map((entry) => ({ ...entry })),
    };
  }

  /**
   * For loading a save, once its tick and clock are set: the private state comes back,
   * and the day or night it is now is taken as known (no NightStarted for a loaded night).
   */
  loadInternals(internals: SimInternals): void {
    this.nextCreatureId = Math.max(1, internals.nextCreatureId);
    this.worldWon = internals.worldWon;
    this.colonyLost = internals.colonyLost;
    this.regrowth.length = 0;
    this.regrowth.push(...internals.regrowth);
    this.wasNight = this.time.isNight(this.tick);
  }

  /** For loading a save: relight everything and find the rooms and the ways home again. */
  settleAfterLoad(): void {
    this.lighting.computeAll();
    this.terrainVersion++;
    this.rebuildMaps();
    this.rebuildRooms();
    this.syncCraftJobs();
  }

  /** Advance the world by exactly one tick (1/20 s of game time at 1x). */
  step(): void {
    this.tick++;
    this.paths.beginTick();
    this.creaturePaths.beginTick();
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
    if (this.tick % SUPPLY_CHECK_TICKS === 0) this.checkSupplies();
    if (this.roomsDirty && this.tick - this.roomsTick >= ROOM_REBUILD_TICKS) this.rebuildRooms();
    if (this.tick % REGROWTH_CHECK_TICKS === 0) this.regrow();
    if (this.tick % FARM_CHECK_TICKS === 0) this.tendFarms();
    const night = this.time.isNight(this.tick);
    if (night !== this.wasNight) {
      this.wasNight = night;
      this.bus.emit(night ? 'NightStarted' : 'DayStarted', { day: this.time.day(this.tick) });
    }
    this.spawner.step();
    for (const dwarf of this.dwarves) this.ai.update(dwarf);
    for (const creature of this.creatures) {
      this.creatureAI.update(creature);
      // Hunting marks follow their animal.
      const hunt = this.huntJobFor(creature.id);
      if (hunt) {
        hunt.x = creature.x;
        hunt.y = creature.y;
      }
    }
    this.projectiles.step(
      (projectile, x, y) => this.projectileHits(projectile, x, y),
      (projectile, hit) => this.projectileLands(projectile, hit),
    );
    this.stepDefences();
    for (let i = this.creatures.length - 1; i >= 0; i--) if (this.creatures[i]!.gone) this.creatures.splice(i, 1);
  }

  /** Whether it is night now. */
  isNight(): boolean {
    return this.time.isNight(this.tick);
  }

  /** How strong sunlight is now, from the night's moonlight up to 1 in full day. */
  get daylight(): number {
    return this.time.daylight(this.tick);
  }

  /** The light a cell gets right now: sunlight (dimmed at night) or glow, whichever is brighter. */
  lightNow(x: number, y: number): number {
    return Math.max(this.lighting.sunAt(x, y) * this.daylight, this.lighting.glow[this.world.index(x, y)] ?? 0);
  }

  /** Debug: bring nightfall forward to now. */
  skipToNight(): void {
    this.time.skipToNight(this.tick);
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
        else if (tool === 'auto' && this.markHarvest(x, y, priority)) added++;
        else if ((tool === 'dig' || tool === 'auto') && this.markDig(x, y, priority)) added++;
      }
    }
    return added;
  }

  /** What a click with the Auto tool would mark here: a tree to fell, a plant to pick, a block to dig, furniture to take apart, or nothing. */
  autoTarget(x: number, y: number): 'chop' | 'harvest' | 'dig' | 'dismantle' | null {
    if (!this.world.inBounds(x, y) || !this.world.isVisible(x, y)) return null;
    if (this.trees.treeAt(x, y)) return 'chop';
    if (this.harvestable(x, y)) return 'harvest';
    if (this.furniture.at(x, y)) return 'dismantle';
    return this.digStatus(x, y) === 'ok' ? 'dig' : null;
  }

  /** Plan blocks in a rectangle, built from an item that makes a tile (dirt, planks, ladders...). Returns how many. */
  designateBuild(item: number, rect: CellRect, priority: Priority): number {
    const tile = this.tileBuiltFrom(item);
    if (tile < 0) return 0;
    return this.planSpreading(rect, (x, y) => {
      if (this.buildStatus(item, x, y) !== 'ok') return false;
      const cell = this.world.index(x, y);
      this.flagIfBlocked(this.jobs.add({ type: 'build', x, y, priority, tick: this.tick, cells: [cell], inputs: [{ item, count: 1 }], target: tile }));
      return true;
    });
  }

  /** Plan background walls in a rectangle, built from an item that is some wall's material. Returns how many. */
  designateWall(item: number, rect: CellRect, priority: Priority): number {
    const wall = this.wallBuiltFrom(item);
    if (wall < 0) return 0;
    return this.planSpreading(rect, (x, y) => {
      if (this.wallStatus(item, x, y) !== 'ok') return false;
      const cell = this.world.index(x, y);
      this.flagIfBlocked(
        this.jobs.add({ type: 'wall', x, y, priority, tick: this.tick, cells: [cell], layer: 'back', inputs: [{ item, count: 1 }], target: wall }),
      );
      return true;
    });
  }

  /** Plan a piece of furniture standing on (x, y), its bottom-left cell. */
  designateFurniture(item: number, x: number, y: number, priority: Priority): boolean {
    if (this.furnitureStatus(item, x, y) !== 'ok') return false;
    const kind = this.furnitureBuiltFrom(item);
    const cells = this.rectCells(this.furniture.footprint(kind, x, y));
    this.flagIfBlocked(this.jobs.add({ type: 'place', x, y, priority, tick: this.tick, cells, inputs: [{ item, count: 1 }], target: kind }));
    return true;
  }

  /** Mark the piece of furniture covering (x, y) to be taken apart (it comes back as an item). */
  designateDismantle(x: number, y: number, priority: Priority): boolean {
    if (!this.world.inBounds(x, y) || !this.world.isVisible(x, y)) return false;
    const piece = this.furniture.at(x, y);
    if (!piece || this.jobs.at(x, y)) return false;
    this.flagIfBlocked(
      this.jobs.add({ type: 'dismantle', x: piece.x, y: piece.y, priority, tick: this.tick, cells: this.furniture.cells(piece), furnitureId: piece.id }),
    );
    return true;
  }

  /** Remove the work marked in a rectangle, in both layers, with hunting and revival marks (dwarves on those jobs stop). Returns how many jobs. */
  cancelDesignations(rect: CellRect): number {
    const jobs = this.marksIn(rect);
    for (const job of jobs) this.jobs.remove(job.id);
    // Farm plots stop being farmed: a crop growing there is dug up (its seed comes back).
    const plots = this.plotsIn(rect);
    for (const plot of plots) this.removePlot(plot, true);
    return Math.max(jobs.length, plots.length);
  }

  /** Change the priority of the work marked in a rectangle. Returns how many jobs. */
  prioritize(rect: CellRect, priority: Priority): number {
    const jobs = this.marksIn(rect);
    for (const job of jobs) this.jobs.setPriority(job.id, priority);
    const plots = this.plotsIn(rect);
    for (const plot of plots) plot.priority = priority;
    return Math.max(jobs.length, plots.length);
  }

  /** The player's marks in a rectangle: work on cells, animals to hunt and fallen dwarves to revive. */
  private marksIn(rect: CellRect): Job[] {
    const r = this.clampRect(rect);
    const jobs = this.jobs.inRect(r);
    for (const job of this.jobs.all()) {
      if ((job.type === 'hunt' || job.type === 'revive') && job.x >= r.x0 && job.x <= r.x1 && job.y >= r.y0 && job.y <= r.y1) jobs.push(job);
    }
    return jobs;
  }

  /** Whether a block can be planned in a cell with this item, and if not, why. */
  buildStatus(item: number, x: number, y: number): BuildStatus {
    const tile = this.tileBuiltFrom(item);
    if (tile < 0) return 'cannot-build';
    const where = this.visibleCell(x, y);
    if (where !== 'ok') return where;
    if (this.jobs.at(x, y) || this.farms.get(this.world.index(x, y))) return 'marked';
    if (!this.cellOpen(x, y)) return 'occupied';
    if (this.tiles.door[tile]) return this.floorAt(x, y + 1, true) ? 'ok' : 'needs-floor';
    return this.blockSupport(x, y, true) ? 'ok' : 'unsupported';
  }

  /** Whether a background wall can be planned in a cell with this item, and if not, why. */
  wallStatus(item: number, x: number, y: number): BuildStatus {
    if (this.wallBuiltFrom(item) < 0) return 'cannot-build';
    const where = this.visibleCell(x, y);
    if (where !== 'ok') return where;
    if (this.jobs.wallAt(x, y)) return 'marked';
    if (this.world.bg[this.world.index(x, y)] !== 0) return 'has-wall';
    if (this.liquidAt(x, y) === this.lavaType) return 'occupied';
    return this.wallSupport(x, y, true) ? 'ok' : 'unsupported';
  }

  /** Whether a piece of furniture built from this item can be planned standing on (x, y), and if not, why. */
  furnitureStatus(item: number, x: number, y: number): BuildStatus {
    const kind = this.furnitureBuiltFrom(item);
    if (kind < 0) return 'cannot-build';
    const rect = this.furniture.footprint(kind, x, y);
    for (let cy = rect.y0; cy <= rect.y1; cy++) {
      for (let cx = rect.x0; cx <= rect.x1; cx++) {
        const where = this.visibleCell(cx, cy);
        if (where !== 'ok') return where;
      }
    }
    for (let cy = rect.y0; cy <= rect.y1; cy++) {
      for (let cx = rect.x0; cx <= rect.x1; cx++) {
        if (this.jobs.at(cx, cy) || this.farms.get(this.world.index(cx, cy))) return 'marked';
        if (!this.cellOpen(cx, cy)) return 'occupied';
      }
    }
    return this.furnitureMounted(kind, rect, true) ?? 'ok';
  }

  /** Queue `count` crafts of a recipe (added to its order if it's queued already). Null while the tech tree hasn't unlocked it. */
  queueCraft(recipe: number, count: number): CraftOrder | null {
    if (!this.research.unlocked(recipe)) return null;
    const order = this.crafting.add(recipe, count);
    this.syncCraftJobs();
    return order;
  }

  /** Change how many crafts an order still wants; 0 cancels it. */
  setCraftRemaining(orderId: number, remaining: number): void {
    this.crafting.setRemaining(orderId, remaining);
    if (!this.crafting.get(orderId)) this.dropOrderJobs(orderId);
    this.syncCraftJobs();
  }

  /** Cancel an order; dwarves crafting it stop, and their materials go back to storage. */
  cancelCraft(orderId: number): void {
    this.crafting.remove(orderId);
    this.dropOrderJobs(orderId);
  }

  craftStatus(order: CraftOrder): CraftStatus {
    for (const job of this.jobs.all()) {
      if (job.type === 'craft' && job.orderId === order.id && job.claimedBy !== 0) return 'working';
    }
    const recipe = this.recipes.recipes[order.recipe]!;
    if (recipe.station !== HAND_CRAFTED && this.furniture.stations(recipe.station).length === 0) return 'no-station';
    return this.storage.hasAll(recipe.inputs) ? 'queued' : 'missing-materials';
  }

  // ---- What dwarves ask before and during their work (ColonyContext) ---------------------------

  /** How far along a job is, 0 to 1, at the pace of the dwarf on it (or a beginner). */
  jobProgress(job: Job): number {
    const dwarf = job.claimedBy !== 0 ? this.dwarf(job.claimedBy) : undefined;
    const required = this.workRequired(job, dwarf);
    return required > 0 ? Math.min(1, job.progress / required) : 1;
  }

  /**
   * Ticks of work a job takes from a dwarf (or from a beginner with bare hands, rested and
   * fed). Skill and tools make work quicker; hunger and tiredness make it slower.
   */
  workRequired(job: Job, dwarf?: Dwarf): number {
    const { colony, tiles, world } = this;
    const work = colony.work;
    const needs = dwarf ? this.needsSpeed(dwarf) : 1;
    const speed = (skill: Skill): number => needs * (dwarf ? skillSpeed(dwarf, skill, colony.skills.speedPerLevel) : 1);
    switch (job.type) {
      case 'dig': {
        const tile = world.fg[world.index(job.x, job.y)]!;
        return (work.digTicksPerHardness * tiles.tiles[tile]!.hardness) / (speed('mining') * (dwarf ? this.toolSpeed(dwarf) : 1));
      }
      case 'chop':
        return work.chopTicks / speed('mining');
      case 'build':
        return (work.buildTicksPerHardness * tiles.tiles[job.target]!.hardness) / speed('building');
      case 'wall':
        return work.wallTicks / speed('building');
      case 'place': {
        const def = this.furnitureKinds.get(job.target);
        return (work.furnitureTicks * def.width * def.height) / speed('building');
      }
      case 'dismantle':
        return work.dismantleTicks / speed('building');
      case 'craft':
        return this.recipes.recipes[job.target]!.time / speed('crafting');
      case 'harvest':
        return work.harvestTicks / speed('farming');
      case 'till':
        return this.cropKinds.tillTicks / speed('farming');
      case 'plant':
        return this.cropKinds.plantTicks / speed('farming');
      case 'eat':
        return colony.needs.eatTicks;
      case 'revive':
        return colony.combat.reviveTicks;
      default:
        return 0;
    }
  }

  /** How fast a dwarf works for its hunger and tiredness: 1 when fed and rested. */
  needsSpeed(dwarf: Dwarf): number {
    const n = this.colony.needs;
    return (dwarf.hunger < n.hungryBelow ? n.slowWork : 1) * (dwarf.energy < n.tiredBelow ? n.slowWork : 1);
  }

  /** How many times faster than bare hands a dwarf digs with the tool it holds. */
  toolSpeed(dwarf: Dwarf): number {
    const tool = dwarf.equipment.tool;
    return tool === null ? 1 : (this.items.get(tool).equip?.digSpeed ?? 1);
  }

  canDigNow(x: number, y: number): boolean {
    return this.world.inBounds(x, y) && this.blockReason(x, y) === null;
  }

  workCellOk(job: Job, cell: number): boolean {
    const { world } = this;
    const target = world.index(job.x, job.y);
    if (job.type === 'dig') {
      // Never inside what is being dug; on top of it only if the fall that follows is safe.
      if (cell === target) return false;
      return cell !== target - world.width || this.nav.fallAfterRemoving(job.x, job.y) <= this.colony.movement.safeDrop;
    }
    // A builder stands beside the cell it fills.
    if (job.type === 'build') return cell !== target;
    return true;
  }

  jobWorkable(job: Job): boolean {
    const { world, homeMaps } = this;
    if (job.type === 'haul') return world.inBounds(job.x, job.y) && homeMaps.workable(world.index(job.x, job.y));
    if (job.type === 'craft' || job.type === 'hunt' || PERSONAL_JOBS.has(job.type)) return true;
    const area = this.jobArea(job);
    for (let y = area.y0 - 1; y <= area.y1 + 1; y++) {
      for (let x = area.x0 - 1; x <= area.x1 + 1; x++) {
        if (!world.inBounds(x, y)) continue;
        const cell = world.index(x, y);
        if (homeMaps.workable(cell) && this.workCellOk(job, cell)) return true;
      }
    }
    return false;
  }

  /**
   * The cells a dwarf works beside: the block or tree, a furniture footprint, the station,
   * the table it eats at, the bed it sleeps in (or the Hearth, without one).
   */
  jobArea(job: Job): CellRect {
    if (job.type === 'place') return this.furniture.footprint(job.target, job.x, job.y);
    if (job.type === 'hunt' || job.type === 'fight') {
      const creature = this.creature(job.target);
      if (creature) return { x0: creature.x, y0: creature.y, x1: creature.x, y1: creature.y };
    }
    if (job.furnitureId !== 0 && job.type !== 'equip') {
      const piece = this.furniture.get(job.furnitureId);
      if (piece) return piece.rect;
    }
    if (job.type === 'craft' || job.type === 'eat' || job.type === 'sleep') return this.storeArea;
    return { x0: job.x, y0: job.y, x1: job.x, y1: job.y };
  }

  /** Whether a job can still be done as it was planned; if not, it should be dropped. */
  siteValid(job: Job): boolean {
    const { world } = this;
    switch (job.type) {
      case 'build':
        return this.cellOpen(job.x, job.y);
      case 'wall':
        return world.bg[world.index(job.x, job.y)] === 0;
      case 'place': {
        const rect = this.furniture.footprint(job.target, job.x, job.y);
        return this.rectCells(rect).every((cell) => {
          const x = cell % world.width;
          return this.cellOpen(x, (cell - x) / world.width);
        });
      }
      case 'dismantle':
        return this.furniture.get(job.furnitureId) !== undefined;
      case 'harvest':
        return this.world.fg[this.world.index(job.x, job.y)] === job.target;
      case 'till':
      case 'plant': {
        const plot = this.farms.get(world.index(job.x, job.y));
        return plot !== undefined && plot.state === (job.type === 'till' ? 'untilled' : 'empty') && this.plotValid(plot);
      }
      case 'hunt':
      case 'fight':
        return this.creature(job.target) !== undefined;
      case 'revive': {
        const dwarf = this.dwarf(job.target);
        return dwarf !== undefined && this.revivable(dwarf);
      }
      case 'craft': {
        if (this.isHandCraft(job)) return true;
        const station = this.furniture.get(job.furnitureId);
        return station !== undefined && station.user === job.claimedBy;
      }
      default:
        return true;
    }
  }

  /** Whether a dwarf could take a job on now: its materials are in storage, a station is free, there's room for a haul... */
  canTake(job: Job, dwarf: Dwarf): boolean {
    switch (job.type) {
      case 'haul': {
        const stack = this.ground.get(job.stackId);
        if (!stack || stack.falling) return false;
        if (this.storage.hasRoom(stack.item)) return true;
        this.noticeStorageFull();
        return false;
      }
      case 'equip':
      case 'eat':
      case 'sleep':
      case 'fight':
        return false;
      case 'harvest':
      case 'till':
        return this.siteValid(job);
      case 'plant':
        return this.storage.hasAll(job.inputs) && this.siteValid(job);
      case 'hunt': {
        // Only a dwarf fit to fight goes hunting, after an animal the player can see.
        const creature = this.creature(job.target);
        return creature !== undefined && this.world.isVisible(creature.x, creature.y) && dwarf.health >= this.colony.combat.engageAbove * dwarf.maxHealth;
      }
      case 'revive':
        return this.storage.hasAll(job.inputs) && this.siteValid(job);
      case 'craft': {
        if (!this.storage.hasAll(job.inputs)) return false;
        return this.isHandCraft(job) || this.freeStation(this.recipes.recipes[job.target]!.station, dwarf) !== null;
      }
      case 'build':
      case 'wall':
      case 'place':
        return this.storage.hasAll(job.inputs) && this.siteReady(job);
      case 'dismantle': {
        // A station in use is taken apart once its crafter is done.
        const piece = this.furniture.get(job.furnitureId);
        return piece !== undefined && piece.user === 0;
      }
      default:
        return true;
    }
  }

  /** Claim a job for a dwarf and set aside what it needs (materials, a station). */
  takeJob(job: Job, dwarf: Dwarf): boolean {
    if (!this.jobs.claim(job.id, dwarf.id)) return false;
    if (job.inputs.length > 0) {
      if (!this.storage.reserveAll(job.inputs)) {
        this.jobs.release(job.id, dwarf.id);
        return false;
      }
      job.reserved = true;
    }
    if (job.type === 'craft') {
      const recipe = this.recipes.recipes[job.target]!;
      if (recipe.station !== HAND_CRAFTED) {
        const station = this.freeStation(recipe.station, dwarf);
        if (!station) {
          this.jobs.release(job.id, dwarf.id);
          return false;
        }
        station.user = dwarf.id;
        job.furnitureId = station.id;
        job.x = station.x;
        job.y = station.y;
      }
      // Its order may need another open job for the next dwarf.
      this.syncCraftJobs();
    }
    return true;
  }

  /** Find better gear in storage for a dwarf: a trip to fetch it, claimed by that dwarf, or null. */
  startEquip(dwarf: Dwarf): Job | null {
    for (const slot of EQUIP_SLOTS) {
      const current = dwarf.equipment[slot];
      let bestTier = current === null ? 0 : (this.items.get(current).equip?.tier ?? 0);
      let best = -1;
      for (const item of this.gear) {
        const equip = this.items.get(item).equip!;
        if (equip.slot === slot && equip.tier > bestTier && this.storage.available(item) > 0) {
          best = item;
          bestTier = equip.tier;
        }
      }
      if (best < 0) continue;
      const job = this.jobs.add({
        type: 'equip',
        x: this.hearth.x,
        y: this.hearth.y,
        priority: DEFAULT_PRIORITY,
        tick: this.tick,
        inputs: [{ item: best, count: 1 }],
        target: best,
      });
      if (this.takeJob(job, dwarf)) return job;
      this.jobs.remove(job.id);
      return null;
    }
    return null;
  }

  /**
   * A hungry dwarf's meal: the most filling food in storage, reserved for it, eaten at the
   * nearest table within reach if there is one (a table gives a better meal). Null if
   * there's nothing to eat.
   */
  startMeal(dwarf: Dwarf): Job | null {
    const food = this.foods.find((item) => this.storage.available(item) > 0);
    if (food === undefined) return null;
    const job = this.jobs.add({ type: 'eat', x: this.hearth.x, y: this.hearth.y, priority: 4, tick: this.tick, inputs: [{ item: food, count: 1 }], target: food });
    if (!this.takeJob(job, dwarf)) {
      this.jobs.remove(job.id);
      return null;
    }
    const table = this.nearestFurniture('table', dwarf, this.colony.needs.tableReach, false);
    if (table) {
      job.furnitureId = table.id;
      job.x = table.x;
      job.y = table.y;
    }
    return job;
  }

  /** A tired dwarf goes to bed: the nearest free bed it can reach, or else the floor by the Hearth. */
  startSleep(dwarf: Dwarf): Job {
    const bed = this.nearestFurniture('bed', dwarf, Infinity, true);
    const job = this.jobs.add({ type: 'sleep', x: bed?.x ?? this.hearth.x, y: bed?.y ?? this.hearth.y, priority: 4, tick: this.tick, furnitureId: bed?.id ?? 0 });
    this.jobs.claim(job.id, dwarf.id);
    if (bed) bed.user = dwarf.id;
    return job;
  }

  /**
   * How fast a sleeping dwarf recovers, as a multiple of a night in bed: slower on the
   * floor, faster in a bed in a room with a light.
   */
  sleepRate(dwarf: Dwarf): number {
    const job = dwarf.jobId !== 0 ? this.jobs.get(dwarf.jobId) : undefined;
    const bed = job?.type === 'sleep' && job.furnitureId !== 0 ? this.furniture.get(job.furnitureId) : undefined;
    if (!bed) return this.colony.needs.floorSleep;
    const room = this.rooms.roomAt(bed.x, bed.y);
    return room && room.lights > 0 ? this.colony.needs.roomSleepBonus : 1;
  }

  /** Whether there's any food in storage that nobody has claimed. */
  foodAvailable(): boolean {
    return this.foods.some((item) => this.storage.available(item) > 0);
  }

  /** Where goods are put away and fetched from: the Hearth or any chest, whichever is nearest. */
  storageGoal(): PathGoal {
    const chests = this.furniture.storagePieces().map((piece) => piece.rect);
    return { area: this.storeArea, alternatives: chests, reach: 1, cacheKey: `store:${this.storesVersion}` };
  }

  /** A cell a builder needs clear: a block is about to go there. */
  wantsClear(cell: number): boolean {
    const { world } = this;
    const x = cell % world.width;
    const job = this.jobs.at(x, (cell - x) / world.width);
    return job !== undefined && job.type === 'build' && job.claimedBy !== 0 && this.tiles.solid[job.target] === 1;
  }

  /** A hand-made craft is worked wherever its materials were fetched. */
  isHandCraft(job: Job): boolean {
    return job.type === 'craft' && this.recipes.recipes[job.target]!.station === HAND_CRAFTED;
  }

  /** A dwarf at a store takes the materials its job reserved. False if they're gone. */
  fetchFor(job: Job, dwarf: Dwarf): boolean {
    if (!job.reserved) return false;
    const taken = this.storage.takeReserved(job.inputs);
    job.reserved = false;
    addTo(dwarf.carrying, taken);
    return job.inputs.every(({ item, count }) => taken.some((t) => t.item === item && t.count >= count));
  }

  /** Put everything a dwarf carries into storage. */
  storeCarried(dwarf: Dwarf): void {
    for (const { item, count } of dwarf.carrying) this.storage.add(item, count);
    if (dwarf.carrying.length > 0) this.bus.emit('StorageChanged');
    dwarf.carrying = [];
  }

  // ---- Changes made by dwarves (and, later, spells) --------------------------------------------

  /** A dwarf ate the meal it carried; a table makes it go further, a table in a room more so. */
  completeMeal(job: Job, by: Dwarf): boolean {
    const food = this.items.get(job.target).food;
    if (!food || !takeFrom(by.carrying, [{ item: job.target, count: 1 }])) return false;
    this.jobs.remove(job.id);
    const table = job.furnitureId !== 0 ? this.furniture.get(job.furnitureId) : undefined;
    const n = this.colony.needs;
    const bonus = !table ? 1 : this.rooms.roomAt(table.x, table.y) ? n.roomTableBonus : n.tableBonus;
    by.hunger = Math.min(100, by.hunger + food.hunger * bonus);
    by.health = Math.min(by.maxHealth, by.health + food.heal);
    return true;
  }

  /** A dwarf picked a plant: it leaves its crop where it grew, and may grow back. */
  harvestPlant(job: Job, by: Dwarf): void {
    const { world, tiles } = this;
    const i = world.index(job.x, job.y);
    const plot = this.farms.get(i);
    if (plot?.state === 'ripe') {
      this.harvestCrop(plot, job, by);
      return;
    }
    const plant = tiles.tiles[world.fg[i]!]!.harvest;
    this.jobs.remove(job.id);
    if (!plant) return;
    const becomes = plant.becomes ? tiles.tile(plant.becomes) : AIR;
    const was = world.fg[i]!;
    world.fg[i] = becomes;
    this.bus.emit('TileChanged', { x: job.x, y: job.y });
    this.dropItems(this.items.item(plant.item), plant.count, job.x, job.y);
    if (plant.regrowDays > 0) {
      this.regrowth.push({ cell: i, from: becomes, to: was, at: this.tick + Math.round(plant.regrowDays * this.time.cycleTicks) });
    }
    this.bus.emit('Harvested', { x: job.x, y: job.y, dwarf: by.id });
  }

  /** A dwarf has run out of food: say so now and then. */
  starving(dwarf: Dwarf): void {
    const last = this.starvingNotices.get(dwarf.id);
    if (last !== undefined && this.tick - last < this.time.cycleTicks / 3) return;
    this.starvingNotices.set(dwarf.id, this.tick);
    this.bus.emit('DwarfStarving', { dwarf: dwarf.id, name: dwarf.name });
  }

  /** A dwarf ran out of energy and fell asleep where it stood. */
  collapsed(dwarf: Dwarf): void {
    this.bus.emit('DwarfCollapsed', { dwarf: dwarf.id, name: dwarf.name });
  }

  removeBlock(x: number, y: number, by: Dwarf): void {
    const { world, tiles } = this;
    const i = world.index(x, y);
    const drops = tiles.tiles[world.fg[i]!]!.drops;
    world.fg[i] = AIR;
    world.flags[i] = world.flags[i]! & ~FLAG_BUILT;
    this.tileDamage.clear(i);
    this.bus.emit('TileChanged', { x, y });
    this.clearLooseTop(x, y);
    // What comes out lands at the digger's feet, never in a pocket nobody can reach.
    if (drops) this.dropItems(this.items.item(drops), 1, by.x, by.y);
    this.terrainChanged(x, y);
    this.bus.emit('BlockDug', { x, y, dwarf: by.id });
  }

  fellTree(tree: Tree, by: Dwarf): void {
    const { world, tiles } = this;
    const drops = tiles.tiles[world.fg[world.index(tree.x, tree.base)]!]!.drops;
    // Leaves give fibre: one for every few leaf tiles.
    const leaves = new Map<string, number>();
    for (const cell of tree.cells) {
      const tile = tiles.tiles[world.fg[cell]!]!;
      if (tile.art.style === 'leaves' && tile.drops) leaves.set(tile.drops, (leaves.get(tile.drops) ?? 0) + 1);
    }
    for (const cell of tree.cells) {
      world.fg[cell] = AIR;
      const x = cell % world.width;
      this.bus.emit('TileChanged', { x, y: (cell - x) / world.width });
    }
    // Trees don't block movement or light, so only the picture changes.
    if (drops) this.dropItems(this.items.item(drops), tree.wood, tree.x, tree.base);
    for (const [item, count] of leaves) {
      this.dropItems(this.items.item(item), Math.ceil(count / this.colony.work.leavesPerFiber), tree.x, tree.base);
    }
    this.bus.emit('TreeFelled', { x: tree.x, y: tree.base, dwarf: by.id });
  }

  /** A dwarf finished a block, a wall or a piece of furniture, using up what it carried. */
  completeBuild(job: Job, by: Dwarf): boolean {
    if (!takeFrom(by.carrying, job.inputs)) return false;
    this.jobs.remove(job.id);
    if (job.type === 'build') this.placeBlock(job.x, job.y, job.target, by);
    else if (job.type === 'wall') this.placeWall(job.x, job.y, job.target);
    else this.placeFurniture(job.target, job.x, job.y);
    this.bus.emit('BlockBuilt', { x: job.x, y: job.y, dwarf: by.id });
    return true;
  }

  /** A dwarf finished a craft: its inputs are used up and the output is in its arms. */
  completeCraft(job: Job, by: Dwarf): boolean {
    const recipe = this.recipes.recipes[job.target]!;
    if (!takeFrom(by.carrying, recipe.inputs)) return false;
    addTo(by.carrying, [recipe.output]);
    this.jobs.remove(job.id);
    const order = this.crafting.get(job.orderId);
    const finished = this.crafting.madeOne(job.orderId);
    this.syncCraftJobs();
    this.bus.emit('ItemCrafted', { item: recipe.output.item, count: recipe.output.count, dwarf: by.id, name: by.name });
    if (finished && order) this.bus.emit('CraftOrderDone', { item: recipe.output.item, count: order.count * recipe.output.count });
    this.recordResearch(recipe);
    return true;
  }

  // ---- The tech tree -------------------------------------------------------------------------

  /** The first of an item earns research; a full tier unlocks the next, and may bring new dwarves. */
  private recordResearch(recipe: Recipe): void {
    const { earned, reached } = this.research.recordCraft(recipe.index, recipe.output.item);
    if (earned > 0) {
      const { research } = this;
      this.bus.emit('ResearchGained', { item: recipe.output.item, points: earned, total: research.points, needed: research.needed, tier: research.tier });
    }
    this.tiersReached(reached);
  }

  private tiersReached(tiers: readonly TechTier[]): void {
    for (const tier of tiers) {
      this.bus.emit('TierReached', { tier: tier.index, name: tier.name, dwarves: tier.dwarves });
      for (let n = 0; n < tier.dwarves; n++) this.welcomeDwarf();
    }
  }

  /** Debug: jump to a tier of the tech tree; its new dwarves come as if it had been reached. */
  reachTier(tier: number): void {
    this.tiersReached(this.research.reach(tier));
  }

  /**
   * A new dwarf walks up to the Hearth to join the colony, if there's room for one more
   * (dwarves lost for good don't count). Returns it, or null.
   */
  welcomeDwarf(): Dwarf | null {
    const counted = this.dwarves.filter((d) => d.phase !== 'dead' || d.deathCause !== 'lava').length;
    if (counted >= this.colony.maxDwarves) return null;
    const id = this.dwarves.reduce((max, d) => Math.max(max, d.id), 0) + 1;
    const spot = this.standingSpotNear(this.hearth.x + this.rng.int(-3, 3), this.hearth.y);
    const dwarf = createDwarf(id, spot.x, spot.y, this.rng, this.colony, new Set(this.dwarves.map((d) => d.name)));
    this.dwarves.push(dwarf);
    this.reveal(spot.x, spot.y, this.colony.vision.radius);
    this.bus.emit('DwarfArrived', { dwarf: dwarf.id, name: dwarf.name });
    return dwarf;
  }

  /** The World Gate has been built: this world is won. */
  get won(): boolean {
    return this.worldWon;
  }

  // ---- Farming ---------------------------------------------------------------------------------

  /**
   * Whether a farm plot can be marked in a cell (the open cell a plant grows in, over soil
   * that can be tilled or already is), and if not, why.
   */
  farmStatus(x: number, y: number): BuildStatus {
    const where = this.visibleCell(x, y);
    if (where !== 'ok') return where;
    const { world, cropKinds } = this;
    const cell = world.index(x, y);
    if (this.farms.get(cell) || this.jobs.at(x, y)) return 'marked';
    if (!this.cellOpen(x, y) || cropKinds.stageTiles.has(world.fg[cell]!)) return 'occupied';
    if (!world.inBounds(x, y + 1)) return 'needs-soil';
    const below = world.fg[cell + world.width]!;
    return cropKinds.soil.has(below) || below === cropKinds.farmland ? 'ok' : 'needs-soil';
  }

  /**
   * Mark farm plots for a crop over a rectangle. They are standing orders: dwarves till each
   * one, sow it, bring the harvest in and sow it again, for as long as the plot stays.
   * Returns how many plots were marked.
   */
  designateFarm(crop: number, rect: CellRect, priority: Priority): number {
    if (!this.cropKinds.crops[crop]) return 0;
    const { world } = this;
    const r = this.clampRect(rect);
    let added = 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (this.farmStatus(x, y) !== 'ok') continue;
        const cell = world.index(x, y);
        const tilled = world.fg[cell + world.width] === this.cropKinds.farmland;
        this.postFarmJob(this.farms.add(cell, crop, tilled ? 'empty' : 'untilled', priority));
        added++;
      }
    }
    return added;
  }

  /** The plot of a cell, if it's farmed. */
  plotAt(x: number, y: number): Plot | undefined {
    return this.world.inBounds(x, y) ? this.farms.get(this.world.index(x, y)) : undefined;
  }

  /** How far a plot's crop has grown, 0 to 1 (1 once ripe). */
  plotProgress(plot: Plot): number {
    if (plot.state === 'ripe') return 1;
    if (plot.state !== 'growing') return 0;
    return Math.min(1, plot.growth / growTicks(this.cropKinds.crops[plot.crop]!, this.time.settings.dayTicks));
  }

  /** Debug: every growing crop ripens at the next check. */
  ripenCrops(): void {
    for (const plot of this.farms.all()) {
      if (plot.state === 'growing') plot.growth = growTicks(this.cropKinds.crops[plot.crop]!, this.time.settings.dayTicks);
    }
  }

  /** A dwarf tilled a plot's soil: farmland now, ready to sow. */
  completeTill(job: Job): void {
    const { world } = this;
    this.jobs.remove(job.id);
    const cell = world.index(job.x, job.y);
    const plot = this.farms.get(cell);
    if (!plot || plot.state !== 'untilled') return;
    if (world.fg[cell] !== AIR) {
      // Grass tufts and flowers in the plot are cleared away.
      world.fg[cell] = AIR;
      this.bus.emit('TileChanged', { x: job.x, y: job.y });
    }
    world.fg[cell + world.width] = this.cropKinds.farmland;
    this.bus.emit('TileChanged', { x: job.x, y: job.y + 1 });
    this.farms.setState(plot, 'empty');
    this.postFarmJob(plot);
  }

  /** A dwarf sowed the seed it carried: a sprout appears. False if it had no seed. */
  completePlant(job: Job, by: Dwarf): boolean {
    if (!takeFrom(by.carrying, job.inputs)) return false;
    this.jobs.remove(job.id);
    const { world } = this;
    const cell = world.index(job.x, job.y);
    const plot = this.farms.get(cell);
    if (!plot || plot.state !== 'empty') {
      // The plot went while the seed was on its way: the seed stays where it would have gone.
      for (const { item, count } of job.inputs) this.dropItems(item, count, job.x, job.y);
      return true;
    }
    world.fg[cell] = this.cropKinds.crops[plot.crop]!.stages[0]!;
    this.bus.emit('TileChanged', { x: job.x, y: job.y });
    this.farms.setState(plot, 'growing');
    return true;
  }

  /** A dwarf picked a ripe crop: the crop and its seeds drop where it grew, and the plot waits to be sown again. */
  private harvestCrop(plot: Plot, job: Job, by: Dwarf): void {
    const { world } = this;
    this.jobs.remove(job.id);
    world.fg[plot.cell] = AIR;
    this.bus.emit('TileChanged', { x: job.x, y: job.y });
    for (const { item, count } of this.cropKinds.crops[plot.crop]!.harvest) this.dropItems(item, count, job.x, job.y);
    this.farms.setState(plot, 'empty');
    this.bus.emit('Harvested', { x: job.x, y: job.y, dwarf: by.id });
    this.postFarmJob(plot);
  }

  /** Crops grow where they get light enough, ripen, and every plot keeps its next job posted. */
  private tendFarms(): void {
    const { world, farms } = this;
    for (const plot of [...farms.all()]) {
      if (!this.plotValid(plot)) {
        // Its soil was dug away, say, or something else took the spot.
        this.removePlot(plot, false);
        continue;
      }
      if (plot.state === 'growing') {
        const crop = this.cropKinds.crops[plot.crop]!;
        const x = plot.cell % world.width;
        const y = (plot.cell - x) / world.width;
        plot.lit = this.lightNow(x, y) >= crop.minLight;
        if (plot.lit) plot.growth += FARM_CHECK_TICKS;
        const total = growTicks(crop, this.time.settings.dayTicks);
        const tile = stageTile(crop, plot.growth, total);
        if (world.fg[plot.cell] !== tile) {
          world.fg[plot.cell] = tile;
          this.bus.emit('TileChanged', { x, y });
        }
        if (plot.growth >= total) {
          farms.setState(plot, 'ripe');
          this.bus.emit('CropRipe', { x, y, crop: crop.index });
        }
      }
      this.postFarmJob(plot);
    }
  }

  /** The job a plot needs next (tilling, sowing or harvesting), unless it has one already. */
  private postFarmJob(plot: Plot): void {
    const { world } = this;
    const x = plot.cell % world.width;
    const y = (plot.cell - x) / world.width;
    if (this.jobs.at(x, y) || plot.state === 'growing') return;
    const crop = this.cropKinds.crops[plot.crop]!;
    const priority = plot.priority as Priority;
    const base = { x, y, priority, tick: this.tick, cells: [plot.cell] };
    const job =
      plot.state === 'untilled'
        ? this.jobs.add({ ...base, type: 'till', target: crop.index })
        : plot.state === 'empty'
          ? this.jobs.add({ ...base, type: 'plant', inputs: [{ item: crop.seed, count: 1 }], target: crop.index })
          : this.jobs.add({ ...base, type: 'harvest', target: world.fg[plot.cell]! });
    this.flagIfBlocked(job);
  }

  /** A plot still has what it needs: its soil (farmland once tilled), and its cell free or its crop in it. */
  private plotValid(plot: Plot): boolean {
    const { world, cropKinds } = this;
    const below = world.fg[plot.cell + world.width];
    if (below === undefined) return false;
    if (below !== cropKinds.farmland && (plot.state !== 'untilled' || !cropKinds.soil.has(below))) return false;
    const here = world.fg[plot.cell]!;
    if (plot.state === 'growing' || plot.state === 'ripe') return cropKinds.stageTiles.has(here);
    const x = plot.cell % world.width;
    return this.cellOpen(x, (plot.cell - x) / world.width);
  }

  /** Stop farming a plot. Its jobs go; a crop in it is cleared away (with `refund`, its seed or its harvest drops). */
  private removePlot(plot: Plot, refund: boolean): void {
    const { world, cropKinds } = this;
    this.farms.remove(plot.cell);
    const x = plot.cell % world.width;
    const y = (plot.cell - x) / world.width;
    const job = this.jobs.at(x, y);
    if (job && (job.type === 'till' || job.type === 'plant' || (job.type === 'harvest' && cropKinds.stageTiles.has(job.target)))) this.jobs.remove(job.id);
    if (!cropKinds.stageTiles.has(world.fg[plot.cell]!)) return;
    world.fg[plot.cell] = AIR;
    this.bus.emit('TileChanged', { x, y });
    if (!refund) return;
    const crop = cropKinds.crops[plot.crop]!;
    if (plot.state === 'ripe') for (const { item, count } of crop.harvest) this.dropItems(item, count, x, y);
    else this.dropItems(crop.seed, 1, x, y);
  }

  private plotsIn(rect: CellRect): Plot[] {
    const r = this.clampRect(rect);
    const plots: Plot[] = [];
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const plot = this.farms.get(this.world.index(x, y));
        if (plot) plots.push(plot);
      }
    }
    return plots;
  }

  /** A dwarf took a piece of furniture apart. */
  completeDismantle(job: Job): void {
    this.jobs.remove(job.id);
    const piece = this.furniture.get(job.furnitureId);
    if (piece) this.removeFurniture(piece);
  }

  /** A dwarf at a store puts on the gear it fetched; whatever it wore before goes into storage. */
  equip(dwarf: Dwarf, job: Job): void {
    this.jobs.remove(job.id);
    const item = job.target;
    const equip = this.items.get(item).equip;
    if (!equip || !takeFrom(dwarf.carrying, [{ item, count: 1 }])) return;
    const old = dwarf.equipment[equip.slot];
    dwarf.equipment[equip.slot] = item;
    if (old !== null) this.storage.add(old, 1);
    this.bus.emit('Equipped', { dwarf: dwarf.id, name: dwarf.name, item });
  }

  /** Grass tufts, flowers and the like would float without the block under them. */
  private clearLooseTop(x: number, y: number): void {
    const { world, tiles } = this;
    const above = world.fgAt(x, y - 1);
    if (y > 0 && !tiles.solid[above] && tiles.replaceable[above] && tiles.tiles[above]?.art.style === 'sprite') {
      world.fg[world.index(x, y - 1)] = AIR;
      this.bus.emit('TileChanged', { x, y: y - 1 });
    }
  }

  /**
   * Put a block into a cell. Items lying there are pushed out to `by`'s feet. A block or
   * door a dwarf builds is marked as built: monsters that smash built things can break it.
   */
  placeBlock(x: number, y: number, tile: number, by?: Dwarf): void {
    const { world } = this;
    const i = world.index(x, y);
    world.fg[i] = tile;
    this.tileDamage.clear(i);
    if (this.tiles.solid[tile] || this.tiles.door[tile]) world.flags[i] = world.flags[i]! | FLAG_BUILT;
    if (this.tiles.solid[tile]) {
      world.liquidType[i] = NO_LIQUID;
      world.liquidAmount[i] = 0;
      if (by) this.ground.moveAll(x, y, by.x, by.y);
    }
    this.bus.emit('TileChanged', { x, y });
    this.terrainChanged(x, y);
  }

  /** Put up a background wall. Walls can be climbed, so the ways dwarves can go change. */
  placeWall(x: number, y: number, wall: number): void {
    this.world.bg[this.world.index(x, y)] = wall;
    this.bus.emit('TileChanged', { x, y });
    this.navChanged(x, y);
  }

  /** Set a piece of furniture down, standing on (x, y). Grass and leaves in its way go. */
  placeFurniture(kind: number, x: number, y: number): PlacedFurniture {
    const { world } = this;
    for (const cell of this.rectCells(this.furniture.footprint(kind, x, y))) {
      if (world.fg[cell] === AIR) continue;
      world.fg[cell] = AIR;
      const cx = cell % world.width;
      this.bus.emit('TileChanged', { x: cx, y: (cell - cx) / world.width });
    }
    const piece = this.furniture.place(kind, x, y);
    if (piece.def.storage > 0) {
      this.storage.capacity += piece.def.storage;
      this.storesVersion++;
    }
    if (piece.def.light > 0) {
      const at = this.furniture.lightCell(piece);
      this.bus.emit('LightChanged', this.lighting.setPointLight(at.x, at.y, piece.def.light));
    }
    this.roomsDirty = true;
    this.bus.emit('FurnitureChanged', { id: piece.id, placed: true });
    if (piece.def.wins && !this.worldWon) {
      this.worldWon = true;
      this.bus.emit('WorldWon', { day: this.time.day(this.tick) });
    }
    return piece;
  }

  /** Take a piece of furniture away; the item it was built from drops where it stood. */
  removeFurniture(piece: PlacedFurniture): void {
    this.furniture.remove(piece.id);
    if (piece.def.storage > 0) {
      this.storage.capacity -= piece.def.storage;
      this.storesVersion++;
    }
    if (piece.def.light > 0) {
      const at = this.furniture.lightCell(piece);
      this.bus.emit('LightChanged', this.lighting.setPointLight(at.x, at.y, 0));
    }
    this.roomsDirty = true;
    // A crafter using it as a station stops (the materials go back to storage); a dwarf
    // sleeping in it wakes up; one about to eat at it eats where it is.
    for (const job of [...this.jobs.all()]) {
      if (job.furnitureId !== piece.id || job.claimedBy === 0) continue;
      if (job.type === 'craft' || job.type === 'sleep') this.jobs.release(job.id, job.claimedBy);
      if (job.type === 'eat') job.furnitureId = 0;
    }
    const item = this.furnitureItems.get(piece.kind);
    if (item !== undefined) this.dropItems(item, 1, piece.x, piece.y);
    this.bus.emit('FurnitureChanged', { id: piece.id, placed: false });
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

  dwarfDied(dwarf: Dwarf, cause: DeathCause, by: string | null): void {
    this.bus.emit('DwarfDied', { dwarf: dwarf.id, name: dwarf.name, cause, by, revivable: this.revivable(dwarf) && this.reviveItem >= 0 });
    if (!this.colonyLost && this.dwarves.every((d) => d.phase === 'dead')) {
      this.colonyLost = true;
      this.bus.emit('ColonyLost');
    }
  }

  /** Every dwarf has died. */
  get lost(): boolean {
    return this.colonyLost;
  }

  skillUp(dwarf: Dwarf, skill: Skill): void {
    this.bus.emit('SkillUp', { dwarf: dwarf.id, name: dwarf.name, skill, level: dwarf.skills[skill].level });
  }

  /** Debug: lift the fog of war everywhere. */
  revealAll(): void {
    this.bus.emit('ExploredChanged', this.world.revealAll());
  }

  // ---- Creatures and combat ----------------------------------------------------------------------

  /** A living creature by id. */
  creature(id: number): Creature | undefined {
    if (id === 0) return undefined;
    const creature = this.creatures.find((c) => c.id === id);
    return creature && !creature.gone ? creature : undefined;
  }

  creatureDef(creature: Creature): CreatureDef {
    return this.creatureKinds.get(creature.kind);
  }

  isHostile(creature: Creature): boolean {
    return this.creatureKinds.get(creature.kind).hostile;
  }

  /** How a kind of creature gets about. */
  navFor(kind: number): CreatureNav {
    return this.creatureNavs[kind]!;
  }

  /** Hostile creatures in the world now. */
  get hostileCount(): number {
    let n = 0;
    for (const creature of this.creatures) if (!creature.gone && this.isHostile(creature)) n++;
    return n;
  }

  /** Put a creature into the world; monsters are tougher the later the day. */
  spawnCreature(kind: number, x: number, y: number, origin: CreatureOrigin): Creature {
    const def = this.creatureKinds.get(kind);
    const day = this.time.day(this.tick);
    const s = this.threats.scaling;
    const scaling = { health: toughness(day, s.healthPerDay, s.maxFactor), damage: toughness(day, s.damagePerDay, s.maxFactor) };
    const creature = createCreature(this.nextCreatureId++, kind, def, x, y, origin, scaling, x < this.hearth.x ? 1 : -1);
    this.creatures.push(creature);
    this.bus.emit('CreatureSpawned', { id: creature.id, kind, x, y, origin });
    return creature;
  }

  /** Debug: a creature (creatures.json id) standing on the ground `dx` tiles from the Hearth. Null if there's nowhere to stand. */
  spawnCreatureNear(id: string, dx: number): Creature | null {
    if (!this.creatureKinds.has(id)) return null;
    const kind = this.creatureKinds.id(id);
    const nav = this.navFor(kind);
    const x = Math.max(0, Math.min(this.world.width - 1, this.hearth.x + dx));
    for (let y = this.hearth.y - 12; y <= this.hearth.y + 12; y++) {
      if (this.world.inBounds(x, y) && nav.open(x, y) && nav.standable(x, y)) return this.spawnCreature(kind, x, y, 'debug');
    }
    return null;
  }

  /** Debug: an invasion tonight: by day the clock moves on to `warningTicks` before dusk. */
  startWave(warningTicks = 200): void {
    this.spawner.debugWave(warningTicks);
  }

  inRoom(x: number, y: number): boolean {
    return this.rooms.roomAt(x, y) !== undefined;
  }

  /** How far along the colony is, for the size of invasions: the tech tier it has reached (0 is the first). */
  techTier(): number {
    return this.research.tier;
  }

  setPortalLight(at: { x: number; y: number } | null): void {
    const old = this.portalLight;
    if (old) this.bus.emit('LightChanged', this.lighting.setPointLight(old.x, Math.max(0, old.y - 1), 0));
    this.portalLight = at;
    if (at) this.bus.emit('LightChanged', this.lighting.setPointLight(at.x, Math.max(0, at.y - 1), PORTAL_LIGHT));
  }

  announce(event: SpawnerEvent): void {
    switch (event.type) {
      case 'NightThreat':
        this.bus.emit('NightThreat', { day: event.day });
        break;
      case 'WaveWarning':
        this.bus.emit('WaveWarning', { day: event.day, x: event.x, y: event.y, ticks: event.ticks });
        break;
      case 'WaveStarted':
        this.bus.emit('WaveStarted', { day: event.day, x: event.x, y: event.y, size: event.size });
        break;
      case 'WaveEnded':
        this.bus.emit('WaveEnded', { day: event.day, defeated: event.defeated });
        break;
    }
  }

  /** The invasion as the HUD shows it: coming (ticks to go), under way (invaders left), or none. */
  waveView(): WaveView {
    const wave = this.spawner.wave;
    if (!wave || wave.phase === 'over') return null;
    const side = wave.portal.x < this.hearth.x ? -1 : 1;
    if (wave.phase === 'warning') return { phase: 'warning', ticksLeft: Math.max(0, wave.nextSpawnTick - this.tick), side };
    let alive = 0;
    for (const creature of this.creatures) if (!creature.gone && creature.origin === 'wave') alive++;
    return { phase: 'open', left: alive + Math.max(0, wave.size - wave.spawned), side };
  }

  /** Where the invasion portal stands while it's open (or about to open), or null. */
  get portal(): { x: number; y: number; open: boolean } | null {
    const wave = this.spawner.wave;
    if (!wave || wave.phase === 'over') return null;
    return { ...wave.portal, open: wave.phase === 'open' };
  }

  // ---- Blows, missiles and deaths -------------------------------------------------------------

  /** A creature strikes a dwarf. */
  hitDwarf(dwarf: Dwarf, damage: number, by: Creature): void {
    this.hurtDwarf(dwarf, damage, by.id, this.creatureKinds.get(by.kind).name);
  }

  /** Damage through the dwarf's armour; at 0 health it dies. */
  private hurtDwarf(dwarf: Dwarf, damage: number, byId: number, byName: string): void {
    if (dwarf.phase === 'dead') return;
    const amount = armoredDamage(damage, this.armorOf(dwarf), this.threats.armorScale);
    dwarf.health -= amount;
    dwarf.hurtTicks = 0;
    dwarf.lastAttacker = byId;
    dwarf.lastHurtTick = this.tick;
    this.bus.emit('DwarfHurt', { dwarf: dwarf.id, amount, x: dwarf.x, y: dwarf.y });
    if (dwarf.health <= 0) this.ai.kill(dwarf, 'monster', byName);
  }

  /** A creature is struck (by dwarf `by`, or 0 for a trap or turret); a hurt animal runs. */
  hitCreature(creature: Creature, damage: number, by: number): void {
    if (creature.gone) return;
    const def = this.creatureKinds.get(creature.kind);
    const amount = armoredDamage(damage, def.armor, this.threats.armorScale);
    creature.health -= amount;
    creature.hurtTicks = 0;
    if (by !== 0) creature.lastHitBy = by;
    if (!def.hostile) {
      creature.fleeTicks = ANIMAL_FLEE_TICKS;
      creature.path = null;
    }
    this.bus.emit('CreatureHurt', { id: creature.id, amount, x: creature.x, y: creature.y });
    if (creature.health <= 0) this.killCreature(creature, by);
  }

  /** A creature dies: it drops what it drops, and the dwarf that killed it learns from it. */
  killCreature(creature: Creature, by: number): void {
    if (creature.gone) return;
    creature.gone = true;
    creature.health = 0;
    const def = this.creatureKinds.get(creature.kind);
    for (const drop of def.drops) {
      if (this.creatureRng.chance(drop.chance)) this.dropItems(this.items.item(drop.item), drop.count, creature.x, creature.y);
    }
    const killer = by !== 0 ? this.dwarf(by) : undefined;
    if (killer && killer.phase !== 'dead') this.learnCombat(killer, def.xp);
    this.forgetCreature(creature);
    this.bus.emit('CreatureDied', { id: creature.id, kind: creature.kind, x: creature.x, y: creature.y, by });
  }

  /** A creature of the night leaves (at dawn, or back through the portal). */
  creatureLeaves(creature: Creature): void {
    if (creature.gone) return;
    creature.gone = true;
    this.forgetCreature(creature);
    this.bus.emit('CreatureLeft', { id: creature.id, x: creature.x, y: creature.y });
  }

  /** A creature that's gone takes its hunting mark with it (dwarves fighting it notice by themselves). */
  private forgetCreature(creature: Creature): void {
    const hunt = this.huntJobFor(creature.id);
    if (hunt) this.jobs.remove(hunt.id);
    this.hunts.delete(creature.id);
  }

  /** A dwarf lands a blow on a creature. */
  strikeCreature(dwarf: Dwarf, creature: Creature, damage: number): void {
    this.hitCreature(creature, damage, dwarf.id);
  }

  dwarfShoots(dwarf: Dwarf, creature: Creature, weapon: Weapon): void {
    this.shoot(weapon.projectile ?? 'bolt', 'colony', dwarf.x + 0.5, dwarf.y + 0.5, creature.x + 0.5, creature.y + 0.5, weapon.damage, weapon.range, dwarf.id, -1);
  }

  creatureShoots(creature: Creature, def: CreatureDef, target: Dwarf): void {
    const kind = def.projectile ?? 'spit';
    this.shoot(kind, 'monster', creature.x + 0.5, creature.y + 0.5, target.x + 0.5, target.y + 0.5, creature.damage, def.range, creature.id, creature.kind);
  }

  private shoot(kind: ProjectileKind, team: 'colony' | 'monster', fromX: number, fromY: number, toX: number, toY: number, damage: number, range: number, source: number, sourceKind: number): void {
    this.projectiles.fire(kind, team, fromX, fromY, toX, toY, this.threats.projectileSpeed[kind], damage, range, source, sourceKind);
    this.bus.emit('ProjectileFired', { kind, x: fromX, y: fromY, colony: team === 'colony' });
  }

  /** What a missile strikes in a cell: a wall, or someone on the other side. */
  private projectileHits(projectile: Projectile, x: number, y: number): ProjectileImpact | null {
    const { world } = this;
    if (!seeThrough(world, this.tiles, x, y)) return { kind: 'wall' };
    const cell = y * world.width + x;
    if (projectile.team === 'colony') {
      for (const creature of this.creatures) {
        if (!creature.gone && (creature.y * world.width + creature.x === cell || creature.movement?.to === cell)) return { kind: 'creature', id: creature.id };
      }
      return null;
    }
    for (const dwarf of this.dwarves) {
      if (dwarf.phase !== 'dead' && (dwarf.y * world.width + dwarf.x === cell || dwarf.movement?.to === cell)) return { kind: 'dwarf', id: dwarf.id };
    }
    return null;
  }

  private projectileLands(projectile: Projectile, hit: ProjectileImpact | null): void {
    if (!hit) return;
    if (hit.kind === 'creature') {
      const creature = this.creature(hit.id);
      if (creature) {
        this.hitCreature(creature, projectile.damage, projectile.team === 'colony' ? projectile.source : 0);
        const shooter = projectile.source !== 0 ? this.dwarf(projectile.source) : undefined;
        if (shooter && shooter.phase !== 'dead') this.learnCombat(shooter, this.colony.combat.xpPerHit);
      }
    } else if (hit.kind === 'dwarf') {
      const dwarf = this.dwarf(hit.id);
      const name = projectile.sourceKind >= 0 ? this.creatureKinds.get(projectile.sourceKind).name : '';
      if (dwarf) this.hurtDwarf(dwarf, projectile.damage, projectile.source, name);
    }
    this.bus.emit('ProjectileHit', { kind: projectile.kind, x: projectile.x, y: projectile.y });
  }

  /** Combat experience, with the level-up news. */
  learnCombat(dwarf: Dwarf, xp: number): void {
    if (gainXp(dwarf, 'combat', xp, this.colony.skills.levels)) this.skillUp(dwarf, 'combat');
  }

  /**
   * A creature strikes a door or block. The damage stays with the block, whoever struck
   * it, so monsters battering the same block together break it all the sooner; it breaks
   * once the damage reaches its durability.
   */
  damageTile(x: number, y: number, damage: number, _by: Creature): void {
    const i = this.world.index(x, y);
    const total = this.tileDamage.add(i, damage);
    this.noise = { x, y, tick: this.tick };
    this.bus.emit('TileDamaged', { x, y });
    if (total >= this.tileHp(this.world.fg[i]!)) this.breakTile(x, y);
  }

  /** How much damage a tile takes to break: its "hp" (durability), or failing that its hardness times threats.json's tileHpPerHardness. */
  tileHp(tile: number): number {
    const def = this.tiles.tiles[tile]!;
    return def.hp ?? def.hardness * this.threats.tileHpPerHardness;
  }

  /** A monster broke a door or block: nothing is left of it. */
  breakTile(x: number, y: number): void {
    const { world } = this;
    const i = world.index(x, y);
    world.fg[i] = AIR;
    world.flags[i] = world.flags[i]! & ~FLAG_BUILT;
    this.tileDamage.clear(i);
    this.bus.emit('TileChanged', { x, y });
    this.clearLooseTop(x, y);
    const job = this.jobs.at(x, y);
    if (job?.type === 'dig') this.jobs.remove(job.id);
    this.terrainChanged(x, y);
    this.bus.emit('TileBroken', { x, y });
  }

  /** Whether something loud (a door being smashed) happened near (x, y) just now. */
  noiseNear(x: number, y: number, radius = NOISE_RADIUS): boolean {
    const noise = this.noise;
    return noise !== null && this.tick - noise.tick <= NOISE_TICKS && Math.max(Math.abs(noise.x - x), Math.abs(noise.y - y)) <= radius;
  }

  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    return clearShot(this.world, this.tiles, x0, y0, x1, y1);
  }

  /** What a dwarf fights with: its weapon, or its fists. Combat skill makes every blow harder. */
  weaponOf(dwarf: Dwarf): Weapon {
    const c = this.colony.combat;
    const item = dwarf.equipment.weapon;
    const equip = item !== null ? this.items.get(item).equip : null;
    const skill = 1 + c.damagePerLevel * (dwarf.skills.combat.level - 1);
    return {
      damage: (equip ? equip.damage : c.bareHandsDamage) * skill,
      attackTicks: equip && equip.attackTicks > 0 ? equip.attackTicks : c.attackTicks,
      range: equip?.range ?? 1,
      projectile: equip?.projectile ?? null,
    };
  }

  /** The armour a dwarf wears, all told. */
  armorOf(dwarf: Dwarf): number {
    let armor = 0;
    for (const slot of EQUIP_SLOTS) {
      const item = dwarf.equipment[slot];
      if (item !== null) armor += this.items.get(item).equip?.armor ?? 0;
    }
    return armor;
  }

  /** The nearest hostile creature within `range` tiles of a dwarf that it isn't steering clear of. */
  nearestHostile(dwarf: Dwarf, range: number): Creature | undefined {
    let best: Creature | undefined;
    let bestDistance = Infinity;
    for (const creature of this.creatures) {
      if (creature.gone || !this.isHostile(creature) || dwarf.ignoring.some((entry) => entry.creature === creature.id)) continue;
      const distance = Math.max(Math.abs(creature.x - dwarf.x), Math.abs(creature.y - dwarf.y));
      if (distance <= range && distance < bestDistance) {
        best = creature;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** A dwarf squares up to a creature: a fight of its own, claimed at once. */
  startFight(dwarf: Dwarf, creature: Creature): Job {
    const job = this.jobs.add({ type: 'fight', x: creature.x, y: creature.y, priority: 4, tick: this.tick, target: creature.id });
    this.jobs.claim(job.id, dwarf.id);
    return job;
  }

  dwarfRetreating(dwarf: Dwarf): void {
    this.bus.emit('DwarfRetreating', { dwarf: dwarf.id, name: dwarf.name });
  }

  // ---- Hunting and reviving (player orders) ------------------------------------------------

  /** The hunting mark on a creature, if it has one. */
  huntJobFor(creatureId: number): Job | undefined {
    const id = this.hunts.get(creatureId);
    if (id === undefined) return undefined;
    const job = this.jobs.get(id);
    if (job && job.type === 'hunt') return job;
    this.hunts.delete(creatureId);
    return undefined;
  }

  /** Mark an animal the player can see to be hunted. */
  designateHunt(creatureId: number, priority: Priority): boolean {
    const creature = this.creature(creatureId);
    if (!creature || this.isHostile(creature) || !this.world.isVisible(creature.x, creature.y) || this.huntJobFor(creatureId)) return false;
    const job = this.jobs.add({ type: 'hunt', x: creature.x, y: creature.y, priority, tick: this.tick, target: creature.id });
    this.hunts.set(creature.id, job.id);
    return true;
  }

  /** A fallen dwarf that a revival draught could bring back (not one lost in lava). */
  revivable(dwarf: Dwarf): boolean {
    return dwarf.phase === 'dead' && dwarf.deathCause !== 'lava';
  }

  /** The revival mark on a fallen dwarf, if it has one. */
  reviveJobFor(dwarfId: number): Job | undefined {
    for (const job of this.jobs.all()) if (job.type === 'revive' && job.target === dwarfId) return job;
    return undefined;
  }

  /** Mark a fallen dwarf to be brought back: a dwarf fetches a revival draught and pours it. */
  designateRevive(dwarfId: number, priority: Priority): boolean {
    const dwarf = this.dwarf(dwarfId);
    if (!dwarf || !this.revivable(dwarf) || this.reviveItem < 0 || this.reviveJobFor(dwarfId)) return false;
    const job = this.jobs.add({ type: 'revive', x: dwarf.x, y: dwarf.y, priority, tick: this.tick, target: dwarfId, inputs: [{ item: this.reviveItem, count: 1 }] });
    this.flagIfBlocked(job);
    return true;
  }

  /** A dwarf pours the revival draught it carries on a fallen dwarf, who gets up again. */
  completeRevive(job: Job, by: Dwarf): boolean {
    const dwarf = this.dwarf(job.target);
    const potion = this.items.get(job.inputs[0]!.item).revive;
    if (!dwarf || !this.revivable(dwarf) || !potion || !takeFrom(by.carrying, job.inputs)) return false;
    this.jobs.remove(job.id);
    this.ai.revive(dwarf, potion.health);
    this.bus.emit('DwarfRevived', { dwarf: dwarf.id, name: dwarf.name, by: by.id });
    return true;
  }

  // ---- Traps and turrets -----------------------------------------------------------------------

  /** Traps stab the creatures standing on them; turrets shoot the nearest monster they can see. */
  private stepDefences(): void {
    for (const piece of this.furniture.all()) {
      const { trap, turret } = piece.def;
      if (!trap && !turret) continue;
      if (piece.cooldown > 0) {
        piece.cooldown--;
        continue;
      }
      if (trap) {
        const victim = this.creatures.find((c) => !c.gone && c.x === piece.x && c.y === piece.y);
        if (!victim) continue;
        piece.cooldown = trap.cooldownTicks;
        this.bus.emit('TrapSprung', { x: piece.x, y: piece.y });
        this.hitCreature(victim, trap.damage, 0);
      } else if (turret) {
        const target = this.turretTarget(piece.x, piece.y, turret.range);
        if (!target) continue;
        piece.cooldown = turret.cooldownTicks;
        this.shoot('bolt', 'colony', piece.x + 0.5, piece.y + 0.3, target.x + 0.5, target.y + 0.5, turret.damage, turret.range, 0, -1);
      }
    }
  }

  /** The nearest hostile creature within range that a turret at (x, y) has a clear shot at. */
  private turretTarget(x: number, y: number, range: number): Creature | undefined {
    let best: Creature | undefined;
    let bestDistance = range * range;
    for (const creature of this.creatures) {
      if (creature.gone || !this.isHostile(creature)) continue;
      const dx = creature.x - x;
      const dy = creature.y - y;
      const distance = dx * dx + dy * dy;
      if (distance > bestDistance || !this.lineOfSight(x, y, creature.x, creature.y)) continue;
      best = creature;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * What each kind of creature can smash its way through (null: nothing). Breaking a block
   * costs a path as many steps as the blows it still needs would take, so a block others
   * have already battered is the cheaper way in and monsters pile onto it; but never more
   * than BREAK_COST_CAP steps, so a monster would rather smash a door than walk a long way
   * round (and searches stay small).
   */
  private breakerFor(def: CreatureDef): Breaker | null {
    if (def.breaks === 'none' || def.breakDamage <= 0) return null;
    return {
      canBreak: (x, y) => this.canBreak(def, x, y),
      cost: (x, y) => {
        const i = this.world.index(x, y);
        const left = Math.max(1, this.tileHp(this.world.fg[i]!) - this.tileDamage.get(i));
        return Math.min(BREAK_COST_CAP, (Math.ceil(left / def.breakDamage) * def.breakTicks) / def.movement.walkTicks);
      },
    };
  }

  private canBreak(def: CreatureDef, x: number, y: number): boolean {
    const { world, tiles } = this;
    if (!world.inBounds(x, y)) return false;
    const i = world.index(x, y);
    const tile = world.fg[i]!;
    // Never ladders, bedrock, open air or plants, nor what holds up the Hearth, a tree or furniture.
    if (!tiles.diggable[tile] || tiles.climbable[tile] || world.liquidType[i] === this.lavaType) return false;
    if (this.blockReason(x, y) !== null) return false;
    if (tiles.door[tile]) return true;
    if (def.breaks === 'doors') return false;
    if ((world.flags[i]! & FLAG_BUILT) !== 0) return true;
    return def.breaks === 'soft' && tiles.solid[tile] === 1 && tiles.tiles[tile]!.hardness <= def.digHardness;
  }

  // ---- Internals --------------------------------------------------------------------------------

  /** A plant that can be picked, seen by the player. */
  harvestable(x: number, y: number): boolean {
    const { world, tiles } = this;
    if (!world.inBounds(x, y) || !world.isVisible(x, y)) return false;
    const cell = world.index(x, y);
    return tiles.tiles[world.fg[cell]!]!.harvest !== null || this.farms.get(cell)?.state === 'ripe';
  }

  private markHarvest(x: number, y: number, priority: Priority): boolean {
    if (!this.harvestable(x, y) || this.jobs.at(x, y)) return false;
    const cell = this.world.index(x, y);
    this.flagIfBlocked(this.jobs.add({ type: 'harvest', x, y, priority, tick: this.tick, cells: [cell], target: this.world.fg[cell]! }));
    return true;
  }

  /** Picked plants whose time has come grow back, if nothing else took their place. */
  private regrow(): void {
    const { world } = this;
    for (let k = this.regrowth.length - 1; k >= 0; k--) {
      const entry = this.regrowth[k]!;
      if (entry.at > this.tick) continue;
      this.regrowth.splice(k, 1);
      if (world.fg[entry.cell] !== entry.from) continue;
      world.fg[entry.cell] = entry.to;
      const x = entry.cell % world.width;
      this.bus.emit('TileChanged', { x, y: (entry.cell - x) / world.width });
    }
  }

  /**
   * The nearest piece of furniture with a use (a bed, a table) within `reach` tiles of a
   * dwarf, that it can get to; with `free`, only one nobody is using.
   */
  private nearestFurniture(use: 'bed' | 'table', dwarf: Dwarf, reach: number, free: boolean): PlacedFurniture | null {
    let best: PlacedFurniture | null = null;
    let bestDistance = Infinity;
    for (const piece of this.furniture.all()) {
      if (piece.def.use !== use || (free && piece.user !== 0 && piece.user !== dwarf.id)) continue;
      if (this.jobs.at(piece.x, piece.y)?.type === 'dismantle') continue;
      const distance = Math.max(Math.abs(piece.x - dwarf.x), Math.abs(piece.y - dwarf.y));
      if (distance > reach || distance >= bestDistance || !this.stationWorkable(piece)) continue;
      best = piece;
      bestDistance = distance;
    }
    return best;
  }

  /** Find the rooms again (the Hearth's fire counts as a light inside one). */
  private rebuildRooms(): void {
    this.rooms.rebuild(this.furniture, [this.world.index(this.hearth.x, this.hearth.y)]);
    this.roomsDirty = false;
    this.roomsTick = this.tick;
    this.bus.emit('RoomsChanged');
  }

  private markDig(x: number, y: number, priority: Priority): boolean {
    if (this.digStatus(x, y) !== 'ok' || this.jobs.at(x, y)) return false;
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
    const def = tiles.tiles[tile]!;
    // Blocks, ladders and doors can be dug out; open air, trees and grass can't.
    if (!def.solid && !def.door && !def.climbable) return 'nothing-to-dig';
    if (!tiles.diggable[tile]) return 'indestructible';
    if (y === this.hearth.y + 1 && Math.abs(x - this.hearth.x) <= 1) return 'supports-hearth';
    if (this.logTiles.has(world.fgAt(x, y - 1))) return 'supports-tree';
    if (this.holdsUpFurniture(x, y)) return 'supports-furniture';
    return null;
  }

  /** Whether some furniture would lose its footing without the block at (x, y). */
  private holdsUpFurniture(x: number, y: number): boolean {
    const above = this.furniture.at(x, y - 1);
    if (above && above.def.mount === 'floor' && above.y === y - 1) return true;
    for (const [dx, dy] of NEIGHBOURS) {
      const piece = this.furniture.at(x + dx, y + dy);
      if (piece && piece.def.mount === 'wall' && !this.wallMountHeld(piece.rect, x, y)) return true;
    }
    return false;
  }

  /** Whether something other than the cell (ignoreX, ignoreY) holds up a wall-mounted footprint. */
  private wallMountHeld(rect: CellRect, ignoreX: number, ignoreY: number): boolean {
    const { world } = this;
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        if (world.bg[world.index(x, y)] !== 0) return true;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if ((nx !== ignoreX || ny !== ignoreY) && this.nav.solidAt(nx, ny) && world.inBounds(nx, ny)) return true;
        }
      }
    }
    return false;
  }

  /** In the world and seen by the player. */
  private visibleCell(x: number, y: number): 'ok' | 'out-of-bounds' | 'unexplored' {
    if (!this.world.inBounds(x, y)) return 'out-of-bounds';
    return this.world.isVisible(x, y) ? 'ok' : 'unexplored';
  }

  /** Free for a block or furniture: open air (or grass and leaves to replace), no furniture, no lava, not the Hearth. */
  private cellOpen(x: number, y: number): boolean {
    const { world, tiles } = this;
    if (!world.inBounds(x, y)) return false;
    const tile = world.fg[world.index(x, y)]!;
    if (tile !== AIR && !(tiles.replaceable[tile] && !tiles.solid[tile])) return false;
    if (this.furniture.at(x, y)) return false;
    if (this.liquidAt(x, y) === this.lavaType) return false;
    const h = this.hearthArea;
    return x < h.x0 || x > h.x1 || y < h.y0 || y > h.y1;
  }

  private liquidAt(x: number, y: number): number {
    return this.world.liquidType[this.world.index(x, y)]!;
  }

  /** Something solid underfoot, or (with `planned`) a block planned there. */
  private floorAt(x: number, y: number, planned: boolean): boolean {
    if (this.nav.solidAt(x, y)) return true;
    if (!planned) return false;
    const job = this.jobs.at(x, y);
    return job !== undefined && job.type === 'build' && this.tiles.solid[job.target] === 1;
  }

  /**
   * What holds a block up: a block, ladder or door beside it, or a wall behind it. With
   * `planned`, blocks planned beside it count too, so a row can reach out from a cliff.
   */
  private blockSupport(x: number, y: number, planned: boolean): boolean {
    const { world, tiles } = this;
    if (world.bg[world.index(x, y)] !== 0) return true;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny >= world.height) return true;
      if (!world.inBounds(nx, ny)) continue;
      const tile = world.fg[world.index(nx, ny)]!;
      if (tiles.solid[tile] || tiles.climbable[tile] || tiles.door[tile]) return true;
      if (planned && this.jobs.at(nx, ny)?.type === 'build') return true;
    }
    return false;
  }

  /** What holds a wall up: a block in or beside its cell, or a wall beside it (planned ones too, with `planned`). */
  private wallSupport(x: number, y: number, planned: boolean): boolean {
    const { world } = this;
    if (this.nav.solidAt(x, y)) return true;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny >= world.height) return true;
      if (!world.inBounds(nx, ny)) continue;
      if (world.bg[world.index(nx, ny)] !== 0 || this.nav.solidAt(nx, ny)) return true;
      if (planned && (this.jobs.wallAt(nx, ny) || this.jobs.at(nx, ny)?.type === 'build')) return true;
    }
    return false;
  }

  /** Why a furniture footprint can't stand where it is, or null if it can (planned blocks count as floor with `planned`). */
  private furnitureMounted(kind: number, rect: CellRect, planned: boolean): 'needs-floor' | 'needs-wall' | null {
    const def = this.furnitureKinds.get(kind);
    if (def.mount === 'floor') {
      for (let x = rect.x0; x <= rect.x1; x++) if (!this.floorAt(x, rect.y1 + 1, planned)) return 'needs-floor';
      return null;
    }
    return this.wallMountHeld(rect, -1, -1) ? null : 'needs-wall';
  }

  /** A planned block, wall or piece of furniture waiting for what will hold it up to be built first. */
  waitingForSupport(job: Job): boolean {
    return (job.type === 'build' || job.type === 'wall' || job.type === 'place') && this.siteValid(job) && !this.siteReady(job);
  }

  /** Whether a planned job's site is ready for work now: what holds it up exists, not just planned. */
  private siteReady(job: Job): boolean {
    if (!this.siteValid(job)) return false;
    switch (job.type) {
      case 'build':
        return this.tiles.door[job.target] ? this.floorAt(job.x, job.y + 1, false) : this.blockSupport(job.x, job.y, false);
      case 'wall':
        return this.wallSupport(job.x, job.y, false);
      case 'place':
        return this.furnitureMounted(job.target, this.furniture.footprint(job.target, job.x, job.y), false) === null;
      default:
        return true;
    }
  }

  /**
   * Plan work over a rectangle, spreading out from the cells that can be planned now: each
   * planned cell can make its neighbours plannable (a planned block holds up the next).
   */
  private planSpreading(rect: CellRect, tryPlan: (x: number, y: number) => boolean): number {
    const r = this.clampRect(rect);
    const width = r.x1 - r.x0 + 1;
    const done = new Uint8Array(width * (r.y1 - r.y0 + 1));
    const queue: Array<[number, number]> = [];
    let planned = 0;
    const attempt = (x: number, y: number): void => {
      const k = (y - r.y0) * width + (x - r.x0);
      if (done[k] || !tryPlan(x, y)) return;
      done[k] = 1;
      planned++;
      queue.push([x, y]);
    };
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) attempt(x, y);
    while (queue.length > 0) {
      const [x, y] = queue.pop()!;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= r.x0 && nx <= r.x1 && ny >= r.y0 && ny <= r.y1) attempt(nx, ny);
      }
    }
    return planned;
  }

  private tileBuiltFrom(item: number): number {
    const builds = this.items.items[item]?.builds;
    return builds && 'tile' in builds ? this.tiles.tile(builds.tile) : -1;
  }

  private wallBuiltFrom(item: number): number {
    const id = this.items.items[item]?.id;
    if (id === undefined) return -1;
    return this.tiles.walls.findIndex((wall) => wall.material === id);
  }

  private furnitureBuiltFrom(item: number): number {
    const builds = this.items.items[item]?.builds;
    return builds && 'furniture' in builds ? this.furnitureKinds.id(builds.furniture) : -1;
  }

  private rectCells(rect: CellRect): number[] {
    const cells: number[] = [];
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) cells.push(this.world.index(x, y));
    return cells;
  }

  /** The nearest free station of a kind that a dwarf can work at from a cell it can get home from. */
  private freeStation(kind: string, dwarf: Dwarf): PlacedFurniture | null {
    let best: PlacedFurniture | null = null;
    let bestDistance = Infinity;
    for (const station of this.furniture.stations(kind)) {
      if (station.user !== 0 && station.user !== dwarf.id) continue;
      if (this.jobs.at(station.x, station.y)?.type === 'dismantle') continue;
      const distance = Math.max(Math.abs(station.x - dwarf.x), Math.abs(station.y - dwarf.y));
      if (distance >= bestDistance || !this.stationWorkable(station)) continue;
      best = station;
      bestDistance = distance;
    }
    return best;
  }

  private stationWorkable(station: PlacedFurniture): boolean {
    const { world, homeMaps } = this;
    const r = station.rect;
    for (let y = r.y0 - 1; y <= r.y1 + 1; y++) {
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
        if (world.inBounds(x, y) && homeMaps.workable(world.index(x, y))) return true;
      }
    }
    return false;
  }

  /** A job was given back or removed: free what it had set aside. */
  private letGo(job: Job): void {
    if (job.reserved) {
      this.storage.unreserveAll(job.inputs);
      job.reserved = false;
    }
    if ((job.type === 'craft' || job.type === 'sleep') && job.furnitureId !== 0) {
      const piece = this.furniture.get(job.furnitureId);
      if (piece && piece.user === job.claimedBy) piece.user = 0;
      job.furnitureId = 0;
    }
  }

  /** Every few ticks: crafting orders get their jobs, build jobs their missing-materials flags. */
  private checkSupplies(): void {
    this.syncCraftJobs();
    // Hand out what's in storage to the waiting jobs, most urgent and oldest first; the
    // ones left without are flagged as missing materials.
    const waiting: Job[] = [];
    for (const job of this.jobs.all()) {
      if (PERSONAL_JOBS.has(job.type)) {
        // A trip for gear, a meal or a nap that was interrupted isn't anyone's any more.
        if (job.claimedBy === 0) this.jobs.remove(job.id);
        continue;
      }
      // Plans overtaken by events (something else filled the spot, the furniture is gone) go.
      const planned =
        job.type === 'build' ||
        job.type === 'wall' ||
        job.type === 'place' ||
        job.type === 'dismantle' ||
        job.type === 'harvest' ||
        job.type === 'till' ||
        job.type === 'plant' ||
        job.type === 'hunt' ||
        job.type === 'revive';
      if (planned && job.claimedBy === 0 && !this.siteValid(job)) {
        this.jobs.remove(job.id);
        continue;
      }
      if (job.inputs.length === 0) continue;
      if (job.claimedBy !== 0) this.jobs.setMissing(job, false);
      else waiting.push(job);
    }
    waiting.sort((a, b) => b.priority - a.priority || a.createdTick - b.createdTick || a.id - b.id);
    const left = new Map<number, number>();
    const available = (item: number): number => left.get(item) ?? this.storage.available(item);
    for (const job of waiting) {
      const enough = job.inputs.every(({ item, count }) => available(item) >= count);
      this.jobs.setMissing(job, !enough);
      // Jobs nobody can get to don't hold materials back from the others.
      if (enough && !job.blocked) for (const { item, count } of job.inputs) left.set(item, available(item) - count);
    }
  }

  /** Keep one open job on the board for every crafting order that still needs hands. */
  private syncCraftJobs(): void {
    const open = new Map<number, Job[]>();
    const busy = new Map<number, number>();
    for (const job of this.jobs.all()) {
      if (job.type !== 'craft') continue;
      if (job.claimedBy !== 0) busy.set(job.orderId, (busy.get(job.orderId) ?? 0) + 1);
      else open.set(job.orderId, [...(open.get(job.orderId) ?? []), job]);
    }
    for (const order of this.crafting.orders) {
      const jobs = open.get(order.id) ?? [];
      open.delete(order.id);
      const wanted = order.count - order.made - (busy.get(order.id) ?? 0) > 0 ? 1 : 0;
      while (jobs.length > wanted) this.jobs.remove(jobs.pop()!.id);
      if (jobs.length < wanted) this.addCraftJob(order);
    }
    // Open jobs left over from orders that are gone.
    for (const jobs of open.values()) for (const job of jobs) this.jobs.remove(job.id);
  }

  private addCraftJob(order: CraftOrder): void {
    const recipe: Recipe = this.recipes.recipes[order.recipe]!;
    const station = recipe.station === HAND_CRAFTED ? undefined : this.furniture.stations(recipe.station)[0];
    this.jobs.add({
      type: 'craft',
      x: station?.x ?? this.hearth.x,
      y: station?.y ?? this.hearth.y,
      priority: DEFAULT_PRIORITY,
      tick: this.tick,
      inputs: recipe.inputs,
      target: recipe.index,
      orderId: order.id,
    });
  }

  private dropOrderJobs(orderId: number): void {
    for (const job of [...this.jobs.all()]) if (job.type === 'craft' && job.orderId === orderId) this.jobs.remove(job.id);
  }

  private noticeStorageFull(): void {
    if (this.tick - this.lastStorageNotice < STORAGE_FULL_NOTICE_TICKS) return;
    this.lastStorageNotice = this.tick;
    this.bus.emit('StorageFull');
  }

  /** Keep lighting, exploration, cached paths, rooms and blocked jobs in step with a changed cell. */
  private terrainChanged(x: number, y: number): void {
    const relit = this.lighting.cellChanged(x, y);
    this.bus.emit('LightChanged', relit);
    const discovered = this.lighting.discover(relit);
    if (discovered) this.bus.emit('ExploredChanged', discovered);
    this.navChanged(x, y);
  }

  /** The ways dwarves can move near (x, y) changed (a block, ladder or wall came or went), and maybe the rooms. */
  private navChanged(x: number, y: number): void {
    this.paths.terrainChanged(x, y);
    this.creaturePaths.terrainChanged(x, y);
    this.jobs.terrainChanged(x, y);
    this.terrainVersion++;
    this.roomsDirty = true;
  }

  /** Show a new job as blocked straight away if nobody can do it. */
  private flagIfBlocked(job: Job): void {
    this.jobs.setBlocked(job, this.isBlocked(job));
  }

  /**
   * Nobody can do the job from a cell that leads home, or doing it would strand someone.
   * A build waiting for what will hold it up (the wall below it, say) isn't blocked: it
   * becomes doable as the work before it gets done.
   */
  private isBlocked(job: Job): boolean {
    if (job.unsafe) return true;
    const waitingForSupport = (job.type === 'build' || job.type === 'wall' || job.type === 'place') && !this.siteReady(job);
    return !waitingForSupport && !this.jobWorkable(job);
  }

  /** Redo the home maps, then flag the jobs nobody can do from a cell that leads back home. */
  private rebuildMaps(): void {
    this.homeMaps.rebuild(this.storeArea, 1);
    this.mapsVersion = this.terrainVersion;
    this.mapsTick = this.tick;
    this.jobs.mapsRebuilt();
    for (const job of this.jobs.all()) this.jobs.setBlocked(job, this.isBlocked(job));
  }

  private clampRect(rect: CellRect): CellRect {
    return {
      x0: Math.max(0, Math.min(rect.x0, rect.x1)),
      y0: Math.max(0, Math.min(rect.y0, rect.y1)),
      x1: Math.min(this.world.width - 1, Math.max(rect.x0, rect.x1)),
      y1: Math.min(this.world.height - 1, Math.max(rect.y0, rect.y1)),
    };
  }

  /**
   * The starting dwarves stand on the ground either side of the Hearth: travellers through
   * a World Gate if any came, new dwarves otherwise.
   */
  private spawnDwarves(travellers: readonly Traveller[]): void {
    const rng = this.rng.fork('dwarves');
    const names = new Set<string>(travellers.map((traveller) => traveller.name));
    const offsets = [-2, 2, 4, -4, 6, -6, 8, -8, 3, -3, 5, -5];
    const itemNumber = (id: string): number | undefined => (this.items.has(id) ? this.items.item(id) : undefined);
    for (let n = 0; n < Math.max(this.colony.startingDwarves, Math.min(travellers.length, this.colony.maxDwarves)); n++) {
      const spot = this.standingSpotNear(this.hearth.x + offsets[n % offsets.length]!, this.hearth.y);
      const fresh = createDwarf(n + 1, spot.x, spot.y, rng, this.colony, names);
      const traveller = travellers[n];
      const dwarf = traveller ? arrivedTraveller(fresh, traveller, itemNumber) : fresh;
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

/** The needs' per-day settings as per-tick rates for this length of day and night. */
function needRates(colony: ColonySettings, time: TimeOfDay): NeedRates {
  const n = colony.needs;
  const { dayTicks, nightTicks } = time.settings;
  const cycle = dayTicks + nightTicks;
  return {
    hunger: n.hungerPerDay / cycle,
    energy: n.energyPerDay / dayTicks,
    sleep: n.sleepPerNight / nightTicks,
    heal: n.healPerNight / nightTicks,
    starve: n.starvingDamagePerDay / cycle,
    rest: colony.combat.restHealPerDay / cycle,
  };
}

/** Add items to a carried list, joining counts of the same item. */
export function addTo(bag: ItemCount[], items: readonly ItemCount[]): void {
  for (const { item, count } of items) {
    if (count <= 0) continue;
    const held = bag.find((entry) => entry.item === item);
    if (held) held.count += count;
    else bag.push({ item, count });
  }
}

/** Take items out of a carried list: all of them, or (returning false) none. */
export function takeFrom(bag: ItemCount[], items: readonly ItemCount[]): boolean {
  if (!items.every(({ item, count }) => (bag.find((entry) => entry.item === item)?.count ?? 0) >= count)) return false;
  for (const { item, count } of items) {
    const index = bag.findIndex((entry) => entry.item === item);
    const held = bag[index]!;
    held.count -= count;
    if (held.count === 0) bag.splice(index, 1);
  }
  return true;
}
