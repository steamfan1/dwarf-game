/**
 * What a dwarf does each tick. The player never steers dwarves; they pick up work from
 * the job board by themselves.
 *
 * Each tick a dwarf, in order:
 *   1. starts falling if the ground under it has gone;
 *   2. carries on with the step it's taking (a walk, jump, climb or fall takes several
 *      ticks), and checks each new step is still possible before taking it;
 *   3. otherwise does what its phase calls for: look for a job, travel, dig, chop, pick
 *      up or drop off.
 *
 * Dwarves look after themselves: they only take jobs they can do from a cell they can
 * get home from (see HomeMaps), and before removing a block they check that nobody,
 * themselves included, would be left in a hole they can't climb out of. A dwarf that is
 * stranded anyway (say, the floor gave way) can still take any job it can reach, which
 * lets the player dig it out.
 *
 * Paths come from the PathService, which may say 'busy' when this tick's pathfinding
 * budget is used up; the dwarf then asks again next tick. Work progress is kept on the
 * job, so an interrupted dig isn't lost.
 *
 * Pure: no Phaser and no DOM. Changes to the world go through the ColonyContext, which
 * keeps lighting, pathfinding, the job board and the renderer in step.
 */
import type { Rng } from '../../core/Rng';
import type { ColonyStorage, GroundItems } from '../items/Items';
import type { ItemRegistry } from '../items/ItemRegistry';
import type { Job, JobBoard } from '../jobs/JobBoard';
import type { HomeMaps } from '../nav/HomeMaps';
import type { NavGrid } from '../nav/NavGrid';
import type { PathGoal } from '../nav/Pathfinder';
import type { PathService } from '../nav/PathService';
import type { TileRegistry } from '../world/TileRegistry';
import type { Tree, TreeFinder } from '../world/trees';
import type { CellRect, World } from '../world/World';
import { gainXp, skillSpeed, type Dwarf, type Movement } from './Dwarf';
import type { ColonySettings } from './settings';

/** Everything the dwarves need from the simulation. */
export interface ColonyContext {
  readonly world: World;
  readonly tiles: TileRegistry;
  readonly items: ItemRegistry;
  readonly colony: ColonySettings;
  readonly nav: NavGrid;
  readonly paths: PathService;
  readonly homeMaps: HomeMaps;
  readonly jobs: JobBoard;
  readonly ground: GroundItems;
  readonly storage: ColonyStorage;
  readonly trees: TreeFinder;
  readonly rng: Rng;
  readonly hearth: { x: number; y: number };
  /** Where hauled items are delivered: dwarves stand within one tile of it. */
  readonly storeArea: CellRect;
  readonly dwarves: readonly Dwarf[];
  readonly tick: number;
  /** Whether a block can still be dug (it's there, diggable, and holds up nothing important). */
  canDigNow(x: number, y: number): boolean;
  /** Whether a dwarf standing in `cell` could do `job` from there. */
  workCellOk(job: Job, cell: number): boolean;
  /** Whether some dwarf could do `job` from a cell it can get to from home and back. */
  jobWorkable(job: Job): boolean;
  /** A dwarf finished digging a block. */
  removeBlock(x: number, y: number, by: Dwarf): void;
  /** A dwarf finished chopping a tree. */
  fellTree(tree: Tree, by: Dwarf): void;
  /** Drop items in a cell, with a haul job for each new stack. `skipDwarf` won't take that job. */
  dropItems(item: number, count: number, x: number, y: number, skipDwarf?: number): void;
  /** Uncover the cells around a dwarf. */
  reveal(x: number, y: number, radius: number): void;
  dwarfDied(dwarf: Dwarf, cause: 'fall' | 'lava'): void;
  skillUp(dwarf: Dwarf, skill: 'mining'): void;
}

function isDead(dwarf: Dwarf): boolean {
  return dwarf.phase === 'dead';
}

/** On its feet and able to act: not dead and not in the middle of a fall. */
function isActive(dwarf: Dwarf): boolean {
  return dwarf.phase !== 'dead' && dwarf.phase !== 'falling';
}

/** Idle dwarves look for work this often (ticks). */
const IDLE_CHECK_TICKS = 10;
/** Chance per idle check that a dwarf with nothing to do goes for a stroll. */
const WANDER_CHANCE = 0.25;

export class DwarfAI {
  private readonly ctx: ColonyContext;

  constructor(ctx: ColonyContext) {
    this.ctx = ctx;
  }

  update(dwarf: Dwarf): void {
    if (isDead(dwarf)) return;
    const { nav } = this.ctx;

    if (!dwarf.movement && isActive(dwarf) && !nav.standable(dwarf.x, dwarf.y)) this.startFalling(dwarf);

    if (dwarf.movement) {
      dwarf.movement.elapsed++;
      if (dwarf.movement.elapsed < dwarf.movement.duration) return;
      this.arrive(dwarf);
      if (!isActive(dwarf)) return;
    }

    if (dwarf.path && this.followPath(dwarf)) return;

    if (dwarf.restTicks > 0) dwarf.restTicks--;
    switch (dwarf.phase) {
      case 'idle':
        if (dwarf.restTicks === 0) this.chooseWork(dwarf);
        break;
      case 'to-job':
      case 'to-item':
      case 'to-storage':
      case 'wandering':
        this.travel(dwarf);
        break;
      case 'working':
        this.work(dwarf);
        break;
      case 'picking-up':
        this.pickUp(dwarf);
        break;
      case 'dropping-off':
        this.dropOff(dwarf);
        break;
      case 'falling':
      case 'dead':
        break;
    }
  }

  /** A dwarf that can't get home from where it stands (it fell into a hole, say). */
  isStranded(dwarf: Dwarf): boolean {
    return !this.ctx.homeMaps.canGetHome(this.ctx.world.index(dwarf.x, dwarf.y));
  }

  // ---- Choosing what to do ------------------------------------------------------------

  private chooseWork(dwarf: Dwarf): void {
    const { jobs, ground } = this.ctx;
    const stranded = this.isStranded(dwarf);
    const job = jobs.bestFor(dwarf.id, dwarf.x, dwarf.y, (candidate) => {
      if (candidate.type === 'haul') {
        const stack = ground.get(candidate.stackId);
        if (!stack || stack.falling) return false;
      }
      // A stranded dwarf may try anything it can reach; it might be digging its way out.
      return stranded || this.ctx.jobWorkable(candidate);
    });
    if (job && jobs.claim(job.id, dwarf.id)) {
      dwarf.jobId = job.id;
      dwarf.phase = job.type === 'haul' ? 'to-item' : 'to-job';
      dwarf.path = null;
      this.travel(dwarf);
      return;
    }
    dwarf.restTicks = IDLE_CHECK_TICKS;
    if (!stranded && this.ctx.rng.chance(WANDER_CHANCE)) this.startWandering(dwarf);
  }

  private startWandering(dwarf: Dwarf): void {
    const { nav, hearth, colony, rng, world, homeMaps } = this.ctx;
    const radius = colony.work.wanderRadius;
    if (radius === 0) return;
    const x = hearth.x + rng.int(-radius, radius);
    // Somewhere to stand in that column, near the Hearth's level, that leads back home.
    for (let y = hearth.y - 3; y <= hearth.y + 3; y++) {
      if (!world.inBounds(x, y) || (x === dwarf.x && y === dwarf.y)) continue;
      if (nav.standable(x, y) && homeMaps.workable(world.index(x, y))) {
        dwarf.wanderTarget = world.index(x, y);
        dwarf.phase = 'wandering';
        dwarf.path = null;
        return;
      }
    }
  }

  // ---- Travelling ------------------------------------------------------------------------

  /** Where the current phase is heading, or null if there is nothing to head for. */
  private goalFor(dwarf: Dwarf): PathGoal | null {
    const { jobs, world, homeMaps } = this.ctx;
    if (dwarf.phase === 'wandering') {
      if (dwarf.wanderTarget < 0) return null;
      const x = dwarf.wanderTarget % world.width;
      const y = (dwarf.wanderTarget - x) / world.width;
      return { area: { x0: x, y0: y, x1: x, y1: y }, reach: 0 };
    }
    if (dwarf.phase === 'to-storage') return { area: this.ctx.storeArea, reach: 1, cacheKey: 'store' };
    const job = jobs.get(dwarf.jobId);
    if (!job) return null;
    const stranded = this.isStranded(dwarf);
    const area = { x0: job.x, y0: job.y, x1: job.x, y1: job.y };
    // Stand somewhere the job can be done from, and (unless already stranded) that leads back home.
    const accept = (cell: number): boolean => this.ctx.workCellOk(job, cell) && (stranded || homeMaps.workable(cell));
    return { area, reach: job.type === 'haul' ? 0 : 1, accept };
  }

  private travel(dwarf: Dwarf): void {
    const { paths, world } = this.ctx;
    if (dwarf.path) return;
    const goal = this.goalFor(dwarf);
    if (!goal) {
      this.giveUp(dwarf);
      return;
    }
    const outcome = paths.request(world.index(dwarf.x, dwarf.y), goal);
    if (outcome === 'busy') return;
    if (!outcome.found) {
      this.cannotReach(dwarf);
      return;
    }
    dwarf.path = outcome.cells;
    dwarf.pathIndex = 0;
    this.followPath(dwarf);
  }

  /** Take the next step of the path, or finish it. Returns true while still on the way. */
  private followPath(dwarf: Dwarf): boolean {
    const { nav, world } = this.ctx;
    const path = dwarf.path!;
    if (dwarf.pathIndex >= path.length) {
      dwarf.path = null;
      this.reachedDestination(dwarf);
      return false;
    }
    const from = world.index(dwarf.x, dwarf.y);
    const to = path[dwarf.pathIndex]!;
    if (!nav.canStep(from, to)) {
      // The terrain changed under the plan: plan again from here.
      dwarf.path = null;
      return false;
    }
    dwarf.pathIndex++;
    this.startMove(dwarf, from, to);
    return true;
  }

  private reachedDestination(dwarf: Dwarf): void {
    dwarf.workTicks = 0;
    switch (dwarf.phase) {
      case 'to-job':
        dwarf.phase = 'working';
        break;
      case 'to-item':
        dwarf.phase = 'picking-up';
        break;
      case 'to-storage':
        dwarf.phase = 'dropping-off';
        break;
      case 'wandering':
        dwarf.phase = 'idle';
        dwarf.wanderTarget = -1;
        dwarf.restTicks = this.ctx.rng.int(40, 140);
        break;
      default:
        break;
    }
  }

  /** No way to the goal: skip that job, or put down what the dwarf carries. */
  private cannotReach(dwarf: Dwarf): void {
    const { jobs } = this.ctx;
    const wasWandering = dwarf.phase === 'wandering';
    if (dwarf.phase === 'to-storage' && dwarf.carrying) {
      if (dwarf.jobId !== 0) jobs.remove(dwarf.jobId);
      this.ctx.dropItems(dwarf.carrying.item, dwarf.carrying.count, dwarf.x, dwarf.y, dwarf.id);
      dwarf.carrying = null;
    } else if (dwarf.jobId !== 0) {
      jobs.markUnreachable(dwarf.jobId, dwarf.id);
      jobs.release(dwarf.jobId, dwarf.id);
    }
    this.toIdle(dwarf);
    // After a failed stroll, wait a moment; after an unreachable job, try the next one at once.
    if (wasWandering) dwarf.restTicks = IDLE_CHECK_TICKS;
  }

  private giveUp(dwarf: Dwarf): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    if (dwarf.carrying) {
      this.ctx.dropItems(dwarf.carrying.item, dwarf.carrying.count, dwarf.x, dwarf.y);
      dwarf.carrying = null;
    }
    this.toIdle(dwarf);
  }

  private toIdle(dwarf: Dwarf): void {
    dwarf.phase = 'idle';
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.wanderTarget = -1;
    dwarf.workTicks = 0;
  }

  // ---- Moving ------------------------------------------------------------------------------

  private startMove(dwarf: Dwarf, from: number, to: number): void {
    const { nav, colony, world } = this.ctx;
    const kind = nav.moveKind(from, to);
    const m = colony.movement;
    const fx = from % world.width;
    const tx = to % world.width;
    const ty = (to - tx) / world.width;
    const rows = ty - (from - fx) / world.width;
    let duration: number;
    switch (kind) {
      case 'walk':
        duration = nav.waterAt(tx, ty) ? m.swimTicks : m.walkTicks;
        break;
      case 'jump':
        duration = m.jumpTicks;
        break;
      case 'climb':
        duration = m.climbTicks;
        break;
      case 'swim':
        duration = m.swimTicks;
        break;
      case 'drop':
        duration = (tx !== fx ? m.walkTicks : 0) + rows * m.fallTicksPerRow;
        break;
    }
    if (tx !== fx) dwarf.facing = tx > fx ? 1 : -1;
    dwarf.movement = { from, to, kind, elapsed: 0, duration: Math.max(1, duration) } satisfies Movement;
  }

  private arrive(dwarf: Dwarf): void {
    const { world, nav, colony } = this.ctx;
    const movement = dwarf.movement!;
    dwarf.movement = null;
    const x = movement.to % world.width;
    const y = (movement.to - x) / world.width;
    dwarf.x = x;
    dwarf.y = y;
    this.ctx.reveal(x, y, colony.vision.radius);
    if (movement.kind !== 'fall') return;

    dwarf.fallRows++;
    if (!nav.standable(x, y)) {
      this.fallOneRow(dwarf);
      return;
    }
    const excess = dwarf.fallRows - colony.movement.safeDrop;
    dwarf.fallRows = 0;
    dwarf.phase = 'idle';
    if (excess > 0) {
      dwarf.health -= excess * colony.movement.fallDamagePerRow;
      if (dwarf.health <= 0) this.die(dwarf, 'fall');
    }
  }

  private startFalling(dwarf: Dwarf): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.wanderTarget = -1;
    dwarf.phase = 'falling';
    dwarf.fallRows = 0;
    this.fallOneRow(dwarf);
  }

  private fallOneRow(dwarf: Dwarf): void {
    const { world, nav, colony } = this.ctx;
    if (!nav.passable(dwarf.x, dwarf.y + 1)) {
      // Nothing to fall into: lava below kills, anything else means the dwarf has landed.
      if (world.inBounds(dwarf.x, dwarf.y + 1) && !nav.solidAt(dwarf.x, dwarf.y + 1)) this.die(dwarf, 'lava');
      else dwarf.phase = 'idle';
      return;
    }
    const from = world.index(dwarf.x, dwarf.y);
    dwarf.movement = { from, to: from + world.width, kind: 'fall', elapsed: 0, duration: colony.movement.fallTicksPerRow };
  }

  private die(dwarf: Dwarf, cause: 'fall' | 'lava'): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    if (dwarf.carrying) {
      this.ctx.dropItems(dwarf.carrying.item, dwarf.carrying.count, dwarf.x, dwarf.y);
      dwarf.carrying = null;
    }
    dwarf.health = 0;
    dwarf.phase = 'dead';
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.movement = null;
    this.ctx.dwarfDied(dwarf, cause);
  }

  // ---- Working --------------------------------------------------------------------------------

  private work(dwarf: Dwarf): void {
    const { jobs, colony, trees } = this.ctx;
    const job = jobs.get(dwarf.jobId);
    if (!job) {
      this.toIdle(dwarf);
      return;
    }
    const tree = job.type === 'chop' ? trees.treeAt(job.x, job.y) : null;
    const stillThere = job.type === 'dig' ? this.ctx.canDigNow(job.x, job.y) : tree !== null && tree.base === job.y;
    if (!stillThere) {
      jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (Math.max(Math.abs(job.x - dwarf.x), Math.abs(job.y - dwarf.y)) > 1) {
      // Out of reach (it fell, or was pushed): walk back.
      dwarf.phase = 'to-job';
      dwarf.path = null;
      return;
    }
    if (job.x !== dwarf.x) dwarf.facing = job.x > dwarf.x ? 1 : -1;

    const speed = skillSpeed(dwarf, 'mining', colony.skills.speedPerLevel);
    const hardness = job.type === 'dig' ? this.ctx.tiles.tiles[this.blockAt(job.x, job.y)]!.hardness : 0;
    const required = job.type === 'dig' ? (colony.work.digTicksPerHardness * hardness) / speed : colony.work.chopTicks / speed;
    if (job.progress < required) {
      job.progress++;
      dwarf.workTicks++;
      if (job.progress < required) return;
    }

    if (job.type === 'dig') {
      const safety = this.safeToRemove(dwarf, job.x, job.y);
      if (safety === 'wait') return;
      if (safety === 'unsafe') {
        // Leave it standing: digging it would strand somebody in a hole.
        jobs.release(job.id, dwarf.id);
        jobs.markUnsafe(job.id);
        this.toIdle(dwarf);
        dwarf.restTicks = IDLE_CHECK_TICKS;
        return;
      }
      jobs.remove(job.id);
      this.toIdle(dwarf);
      this.ctx.removeBlock(job.x, job.y, dwarf);
      if (gainXp(dwarf, 'mining', colony.skills.xp.digPerHardness * hardness, colony.skills.levels)) this.ctx.skillUp(dwarf, 'mining');
    } else {
      jobs.remove(job.id);
      this.toIdle(dwarf);
      this.ctx.fellTree(tree!, dwarf);
      if (gainXp(dwarf, 'mining', colony.skills.xp.chop, colony.skills.levels)) this.ctx.skillUp(dwarf, 'mining');
    }
  }

  /**
   * Would removing the block at (x, y) be safe for the digger and for anyone standing on
   * it? Each of them must land within the safe drop and, unless already stranded, still be
   * able to walk home afterwards. 'wait' means this tick's pathfinding budget ran out.
   */
  private safeToRemove(digger: Dwarf, x: number, y: number): 'safe' | 'unsafe' | 'wait' {
    const { world, nav, paths, colony } = this.ctx;
    const affected = this.ctx.dwarves.filter((d) => d.phase !== 'dead' && (d === digger || (d.x === x && d.y === y - 1)));
    const stranded = new Set(affected.filter((d) => this.isStranded(d)));
    const i = world.index(x, y);
    const block = world.fg[i]!;
    world.fg[i] = 0; // pretend it's gone (restored below)
    let verdict: 'safe' | 'unsafe' | 'wait' = 'safe';
    for (const dwarf of affected) {
      let landing = dwarf.y;
      if (dwarf.x === x && dwarf.y === y - 1) {
        const fall = nav.fallAfterRemoving(x, y);
        if (fall > colony.movement.safeDrop) {
          verdict = 'unsafe';
          break;
        }
        landing = dwarf.y + fall;
      }
      if (stranded.has(dwarf)) continue;
      const outcome = paths.request(world.index(dwarf.x, landing), { area: this.ctx.storeArea, reach: 1 });
      if (outcome === 'busy') {
        verdict = 'wait';
        break;
      }
      if (!outcome.found) {
        verdict = 'unsafe';
        break;
      }
    }
    world.fg[i] = block;
    return verdict;
  }

  private blockAt(x: number, y: number): number {
    return this.ctx.world.fg[this.ctx.world.index(x, y)]!;
  }

  // ---- Hauling --------------------------------------------------------------------------------

  private pickUp(dwarf: Dwarf): void {
    const { jobs, ground, colony } = this.ctx;
    const job = jobs.get(dwarf.jobId);
    const stack = job ? ground.get(job.stackId) : undefined;
    if (!job || !stack) {
      if (job) jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (stack.x !== dwarf.x || stack.y !== dwarf.y) {
      // It fell, or was moved: go after it.
      job.x = stack.x;
      job.y = stack.y;
      dwarf.phase = 'to-item';
      dwarf.path = null;
      return;
    }
    if (++dwarf.workTicks < colony.work.pickUpTicks) return;
    ground.remove(stack.id);
    dwarf.carrying = { item: stack.item, count: stack.count };
    dwarf.workTicks = 0;
    dwarf.phase = 'to-storage';
    dwarf.path = null;
  }

  private dropOff(dwarf: Dwarf): void {
    const { jobs, storage, colony } = this.ctx;
    if (++dwarf.workTicks < colony.work.dropOffTicks) return;
    if (dwarf.carrying) storage.add(dwarf.carrying.item, dwarf.carrying.count);
    dwarf.carrying = null;
    if (dwarf.jobId !== 0) jobs.remove(dwarf.jobId);
    this.toIdle(dwarf);
  }
}
