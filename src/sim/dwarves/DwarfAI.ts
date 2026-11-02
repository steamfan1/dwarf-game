/**
 * What a dwarf does each tick. The player never steers dwarves; they pick up work from
 * the job board by themselves.
 *
 * Each tick a dwarf, in order:
 *   1. starts falling if the ground under it has gone;
 *   2. carries on with the step it's taking (a walk, jump, climb or fall takes several
 *      ticks), and checks each new step is still possible before taking it;
 *   3. otherwise does what its phase calls for: look for a job, travel, work, pick up,
 *      fetch materials or put things away (see Phase in Dwarf.ts for the sequences).
 *
 * Dwarves look after themselves: they only take jobs they can do from a cell they can
 * get home from (see HomeMaps), and before removing or placing a block they check that
 * nobody, themselves included, would be left somewhere they can't get home from. A
 * dwarf that is stranded anyway (say, the floor gave way) can still take any job it can
 * reach that needs no materials, which lets the player dig it out.
 *
 * Anything a dwarf is left holding (its job was cancelled, it fell, the station it used
 * was taken apart) goes back to storage before it takes on anything else, so materials
 * are never lost.
 *
 * Paths come from the PathService, which may say 'busy' when this tick's pathfinding
 * budget is used up; the dwarf then asks again next tick. Work progress is kept on the
 * job, so an interrupted dig or craft isn't lost.
 *
 * Pure: no Phaser and no DOM. Changes to the world go through the ColonyContext, which
 * keeps lighting, pathfinding, the job board, storage and the renderer in step.
 */
import type { Rng } from '../../core/Rng';
import type { ColonyStorage, GroundItems } from '../items/Items';
import type { ItemRegistry } from '../items/ItemRegistry';
import type { Job, JobBoard } from '../jobs/JobBoard';
import type { HomeMaps } from '../nav/HomeMaps';
import type { NavGrid } from '../nav/NavGrid';
import { distanceToArea, type PathGoal } from '../nav/Pathfinder';
import type { PathService } from '../nav/PathService';
import type { TileRegistry } from '../world/TileRegistry';
import type { Tree, TreeFinder } from '../world/trees';
import type { CellRect, World } from '../world/World';
import { gainXp, type Dwarf, type Movement, type Skill } from './Dwarf';
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
  /** The Hearth's cells: home, where dwarves must always be able to get back to. */
  readonly storeArea: CellRect;
  readonly dwarves: readonly Dwarf[];
  readonly tick: number;
  /** Whether a block can still be dug (it's there, diggable, and holds up nothing important). */
  canDigNow(x: number, y: number): boolean;
  /** Whether a dwarf standing in `cell` could do `job` from there. */
  workCellOk(job: Job, cell: number): boolean;
  /** Whether some dwarf could do `job` from a cell it can get to from home and back. */
  jobWorkable(job: Job): boolean;
  /** Whether a dwarf could take a job on now (materials in storage, a free station, room for a haul...). */
  canTake(job: Job, dwarf: Dwarf): boolean;
  /** Claim a job and set aside what it needs. False if that's no longer possible. */
  takeJob(job: Job, dwarf: Dwarf): boolean;
  /** A trip to fetch better gear from storage, already claimed by the dwarf, or null if there's none. */
  startEquip(dwarf: Dwarf): Job | null;
  /** The places goods are stored and fetched: the Hearth and every chest, whichever is nearest. */
  storageGoal(): PathGoal;
  /** The cells a job is done beside (the block, a furniture footprint, the station). */
  jobArea(job: Job): CellRect;
  /** Whether a job can still be done as planned; if not, it is dropped. */
  siteValid(job: Job): boolean;
  /** Ticks of work a job needs from this dwarf (or, without one, from a beginner with bare hands). */
  workRequired(job: Job, dwarf?: Dwarf): number;
  /** A cell a builder needs clear (a block is about to go there). */
  wantsClear(cell: number): boolean;
  /** A hand-made craft, worked where its materials were fetched. */
  isHandCraft(job: Job): boolean;
  /** Take the materials reserved for a job out of storage into the dwarf's arms. False if they're gone. */
  fetchFor(job: Job, dwarf: Dwarf): boolean;
  /** Put everything a dwarf carries into storage. */
  storeCarried(dwarf: Dwarf): void;
  /** Put on the gear an equip trip fetched. */
  equip(dwarf: Dwarf, job: Job): void;
  /** A dwarf finished a block, wall or piece of furniture with what it carries. */
  completeBuild(job: Job, by: Dwarf): boolean;
  /** A dwarf finished a craft: the output goes into its arms. */
  completeCraft(job: Job, by: Dwarf): boolean;
  /** A dwarf took a piece of furniture apart. */
  completeDismantle(job: Job): void;
  /** A dwarf finished digging a block. */
  removeBlock(x: number, y: number, by: Dwarf): void;
  /** A dwarf finished chopping a tree. */
  fellTree(tree: Tree, by: Dwarf): void;
  /** Drop items in a cell, with a haul job for each new stack. `skipDwarf` won't take that job. */
  dropItems(item: number, count: number, x: number, y: number, skipDwarf?: number): void;
  /** Uncover the cells around a dwarf. */
  reveal(x: number, y: number, radius: number): void;
  dwarfDied(dwarf: Dwarf, cause: 'fall' | 'lava'): void;
  skillUp(dwarf: Dwarf, skill: Skill): void;
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
/** A builder waits this long (ticks) for someone to get out of the way before giving up. */
const MAX_WAIT_TICKS = 100;
/** Before a block goes in, dwarves this close (tiles) are checked to still have a way home. */
const PLACE_SAFETY_RADIUS = 8;

export class DwarfAI {
  private readonly ctx: ColonyContext;

  constructor(ctx: ColonyContext) {
    this.ctx = ctx;
  }

  update(dwarf: Dwarf): void {
    if (isDead(dwarf)) return;
    const { nav, world } = this.ctx;

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
        // Standing where a block is about to go: make way.
        if (this.ctx.wantsClear(world.index(dwarf.x, dwarf.y))) this.stepAside(dwarf);
        else if (dwarf.restTicks === 0) this.chooseWork(dwarf);
        break;
      case 'to-job':
      case 'to-item':
      case 'to-storage':
      case 'to-supply':
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
      case 'fetching':
        this.fetch(dwarf);
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
    const { jobs } = this.ctx;
    // Hands full (a job fell through)? Put it all away first.
    if (dwarf.carrying.length > 0) {
      dwarf.phase = 'to-storage';
      dwarf.path = null;
      this.travel(dwarf);
      return;
    }
    const stranded = this.isStranded(dwarf);
    // Better gear in storage comes first: it makes the rest of the work go faster.
    const equip = stranded ? null : this.ctx.startEquip(dwarf);
    if (equip) {
      this.begin(dwarf, equip, 'to-supply');
      return;
    }
    const job = jobs.bestFor(dwarf.id, dwarf.x, dwarf.y, (candidate) => {
      // A stranded dwarf can't get to storage, so it only takes work that needs nothing from there.
      if (stranded && (candidate.type === 'haul' || candidate.inputs.length > 0)) return false;
      return this.ctx.canTake(candidate, dwarf) && (stranded || this.ctx.jobWorkable(candidate));
    });
    if (job && this.ctx.takeJob(job, dwarf)) {
      this.begin(dwarf, job, job.type === 'haul' ? 'to-item' : job.inputs.length > 0 ? 'to-supply' : 'to-job');
      return;
    }
    dwarf.restTicks = IDLE_CHECK_TICKS;
    if (!stranded && this.ctx.rng.chance(WANDER_CHANCE)) this.startWandering(dwarf);
  }

  private begin(dwarf: Dwarf, job: Job, phase: 'to-item' | 'to-supply' | 'to-job'): void {
    dwarf.jobId = job.id;
    dwarf.phase = phase;
    dwarf.path = null;
    dwarf.workTicks = 0;
    dwarf.waitTicks = 0;
    this.travel(dwarf);
  }

  /** The dwarf's job, if it still holds it (a job can be cancelled, or taken back when its station goes). */
  private myJob(dwarf: Dwarf): Job | undefined {
    const job = dwarf.jobId === 0 ? undefined : this.ctx.jobs.get(dwarf.jobId);
    return job && job.claimedBy === dwarf.id ? job : undefined;
  }

  private startWandering(dwarf: Dwarf): void {
    const { nav, hearth, colony, rng, world, homeMaps } = this.ctx;
    const radius = colony.work.wanderRadius;
    if (radius === 0) return;
    const x = hearth.x + rng.int(-radius, radius);
    // Somewhere to stand in that column, near the Hearth's level, that leads back home.
    for (let y = hearth.y - 3; y <= hearth.y + 3; y++) {
      if (!world.inBounds(x, y) || (x === dwarf.x && y === dwarf.y)) continue;
      if (nav.standable(x, y) && homeMaps.workable(world.index(x, y)) && !this.ctx.wantsClear(world.index(x, y))) {
        dwarf.wanderTarget = world.index(x, y);
        dwarf.phase = 'wandering';
        dwarf.path = null;
        return;
      }
    }
  }

  /** Move off a cell a builder needs: one step to anywhere nobody is about to build. */
  private stepAside(dwarf: Dwarf): void {
    const { nav, world } = this.ctx;
    let target = -1;
    nav.forEachMove(world.index(dwarf.x, dwarf.y), (to) => {
      if (target < 0 && !this.ctx.wantsClear(to)) target = to;
    });
    if (target < 0) return;
    dwarf.wanderTarget = target;
    dwarf.phase = 'wandering';
    dwarf.path = null;
    this.travel(dwarf);
  }

  // ---- Travelling ------------------------------------------------------------------------

  /** Where the current phase is heading, or null if there is nothing to head for. */
  private goalFor(dwarf: Dwarf): PathGoal | null {
    const { world, homeMaps } = this.ctx;
    if (dwarf.phase === 'wandering') {
      if (dwarf.wanderTarget < 0) return null;
      const x = dwarf.wanderTarget % world.width;
      const y = (dwarf.wanderTarget - x) / world.width;
      return { area: { x0: x, y0: y, x1: x, y1: y }, reach: 0 };
    }
    if (dwarf.phase === 'to-storage' || dwarf.phase === 'to-supply') {
      if (dwarf.phase === 'to-supply' && !this.myJob(dwarf)) return null;
      return this.ctx.storageGoal();
    }
    const job = this.myJob(dwarf);
    if (!job) return null;
    const stranded = this.isStranded(dwarf);
    // Stand somewhere the job can be done from, and (unless already stranded) that leads back home.
    const accept = (cell: number): boolean => this.ctx.workCellOk(job, cell) && (stranded || homeMaps.workable(cell));
    return { area: this.ctx.jobArea(job), reach: job.type === 'haul' ? 0 : 1, accept };
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
      case 'to-supply':
        dwarf.phase = 'fetching';
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
    if (dwarf.phase === 'to-storage' && dwarf.carrying.length > 0) {
      // No way to any store: leave the load here for someone else (or later).
      const job = this.myJob(dwarf);
      if (job?.type === 'haul') jobs.remove(job.id);
      this.dropAll(dwarf, dwarf.id);
    } else if (dwarf.jobId !== 0) {
      jobs.markUnreachable(dwarf.jobId, dwarf.id);
      jobs.release(dwarf.jobId, dwarf.id);
    }
    this.toIdle(dwarf);
    // After a failed stroll, wait a moment; after an unreachable job, try the next one at once.
    if (wasWandering) dwarf.restTicks = IDLE_CHECK_TICKS;
  }

  /** The job went away: stop. Anything carried is put away on the next look for work. */
  private giveUp(dwarf: Dwarf): void {
    if (dwarf.jobId !== 0) this.ctx.jobs.release(dwarf.jobId, dwarf.id);
    this.toIdle(dwarf);
  }

  private toIdle(dwarf: Dwarf): void {
    dwarf.phase = 'idle';
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.wanderTarget = -1;
    dwarf.workTicks = 0;
    dwarf.waitTicks = 0;
  }

  private dropAll(dwarf: Dwarf, skipDwarf?: number): void {
    for (const { item, count } of dwarf.carrying) this.ctx.dropItems(item, count, dwarf.x, dwarf.y, skipDwarf);
    dwarf.carrying = [];
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
    this.dropAll(dwarf);
    dwarf.health = 0;
    dwarf.phase = 'dead';
    dwarf.jobId = 0;
    dwarf.path = null;
    dwarf.movement = null;
    this.ctx.dwarfDied(dwarf, cause);
  }

  // ---- Working --------------------------------------------------------------------------------

  private work(dwarf: Dwarf): void {
    const job = this.myJob(dwarf);
    if (!job) {
      this.toIdle(dwarf);
      return;
    }
    switch (job.type) {
      case 'dig':
      case 'chop':
        this.harvest(dwarf, job);
        break;
      case 'build':
      case 'wall':
      case 'place':
        this.build(dwarf, job);
        break;
      case 'dismantle':
        this.dismantle(dwarf, job);
        break;
      case 'craft':
        this.craft(dwarf, job);
        break;
      default:
        this.giveUp(dwarf);
    }
  }

  /**
   * Do one tick of work on a job. Returns true once it's all done; false while there's
   * more to do, or if the dwarf had to walk back within reach first.
   */
  private labour(dwarf: Dwarf, job: Job): boolean {
    const area = this.ctx.jobArea(job);
    if (distanceToArea(this.ctx.world.index(dwarf.x, dwarf.y), this.ctx.world.width, area) > 1) {
      // Out of reach (it fell, or was pushed): walk back.
      dwarf.phase = 'to-job';
      dwarf.path = null;
      return false;
    }
    if (area.x1 < dwarf.x) dwarf.facing = -1;
    else if (area.x0 > dwarf.x) dwarf.facing = 1;
    const required = this.ctx.workRequired(job, dwarf);
    if (job.progress < required) {
      job.progress++;
      dwarf.workTicks++;
      if (job.progress < required) return false;
    }
    return true;
  }

  private harvest(dwarf: Dwarf, job: Job): void {
    const { jobs, colony, trees } = this.ctx;
    const tree = job.type === 'chop' ? trees.treeAt(job.x, job.y) : null;
    const stillThere = job.type === 'dig' ? this.ctx.canDigNow(job.x, job.y) : tree !== null && tree.base === job.y;
    if (!stillThere) {
      jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    // The block's hardness is read before the work finishes, while it's still there.
    const hardness = job.type === 'dig' ? this.ctx.tiles.tiles[this.blockAt(job.x, job.y)]!.hardness : 0;
    if (!this.labour(dwarf, job)) return;

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
      this.learn(dwarf, 'mining', colony.skills.xp.digPerHardness * hardness);
    } else {
      jobs.remove(job.id);
      this.toIdle(dwarf);
      this.ctx.fellTree(tree!, dwarf);
      this.learn(dwarf, 'mining', colony.skills.xp.chop);
    }
  }

  private build(dwarf: Dwarf, job: Job): void {
    const { jobs, tiles } = this.ctx;
    if (!this.ctx.siteValid(job)) {
      // Something else filled the spot: the plan is void (the materials go back to storage).
      jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (!this.labour(dwarf, job)) return;
    if (job.type === 'build' && tiles.solid[job.target]) {
      const safety = this.safeToPlace(dwarf, job);
      if (safety === 'wait') {
        // Someone is in the way. Give it a while, then leave the job to others.
        if (++dwarf.waitTicks > MAX_WAIT_TICKS) {
          jobs.markUnreachable(job.id, dwarf.id);
          jobs.release(job.id, dwarf.id);
          this.toIdle(dwarf);
        }
        return;
      }
      if (safety === 'unsafe') {
        jobs.release(job.id, dwarf.id);
        jobs.markUnsafe(job.id);
        this.toIdle(dwarf);
        dwarf.restTicks = IDLE_CHECK_TICKS;
        return;
      }
    }
    this.toIdle(dwarf);
    if (this.ctx.completeBuild(job, dwarf)) this.learn(dwarf, 'building', this.ctx.colony.skills.xp.build);
    else jobs.release(job.id, dwarf.id);
  }

  private dismantle(dwarf: Dwarf, job: Job): void {
    if (!this.ctx.siteValid(job)) {
      this.ctx.jobs.remove(job.id);
      this.toIdle(dwarf);
      return;
    }
    if (!this.labour(dwarf, job)) return;
    this.toIdle(dwarf);
    this.ctx.completeDismantle(job);
    this.learn(dwarf, 'building', this.ctx.colony.skills.xp.build);
  }

  private craft(dwarf: Dwarf, job: Job): void {
    const { jobs, colony } = this.ctx;
    if (!this.ctx.siteValid(job)) {
      jobs.release(job.id, dwarf.id);
      this.toIdle(dwarf);
      return;
    }
    // A hand-made craft is worked right at the store; anything else at its station.
    const hand = this.ctx.isHandCraft(job);
    if (hand) {
      const required = this.ctx.workRequired(job, dwarf);
      if (job.progress < required) {
        job.progress++;
        dwarf.workTicks++;
        if (job.progress < required) return;
      }
    } else if (!this.labour(dwarf, job)) {
      return;
    }
    // Experience goes by how long the recipe takes a beginner, however quick this dwarf is.
    const seconds = this.ctx.workRequired(job) / 20;
    if (!this.ctx.completeCraft(job, dwarf)) {
      jobs.release(job.id, dwarf.id);
      this.toIdle(dwarf);
      return;
    }
    this.learn(dwarf, 'crafting', colony.skills.xp.craftPerSecond * seconds);
    // Carry what was made to storage.
    this.toIdle(dwarf);
    dwarf.phase = 'to-storage';
    this.travel(dwarf);
  }

  private learn(dwarf: Dwarf, skill: Skill, xp: number): void {
    if (gainXp(dwarf, skill, xp, this.ctx.colony.skills.levels)) this.ctx.skillUp(dwarf, skill);
  }

  /**
   * Would removing the block at (x, y) be safe for the digger and for anyone standing on
   * it? Each of them must land within the safe drop and, unless already stranded, still be
   * able to walk home afterwards. 'wait' means this tick's pathfinding budget ran out.
   */
  private safeToRemove(digger: Dwarf, x: number, y: number): 'safe' | 'unsafe' | 'wait' {
    const { world, nav, colony } = this.ctx;
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
      verdict = this.wayHome(world.index(dwarf.x, landing));
      if (verdict !== 'safe') break;
    }
    world.fg[i] = block;
    return verdict;
  }

  /**
   * Would putting a solid block in a build job's cell be safe? Nobody may be in the cell
   * (or stepping into it): that's a 'wait'. And everyone nearby who can get home now must
   * still be able to afterwards, or the block would wall them in: 'unsafe'.
   */
  private safeToPlace(builder: Dwarf, job: Job): 'safe' | 'unsafe' | 'wait' {
    const { world } = this.ctx;
    const i = world.index(job.x, job.y);
    const living = this.ctx.dwarves.filter((d) => d.phase !== 'dead');
    if (living.some((d) => world.index(d.x, d.y) === i || d.movement?.to === i)) return 'wait';
    const nearby = living.filter(
      (d) => (d === builder || Math.max(Math.abs(d.x - job.x), Math.abs(d.y - job.y)) <= PLACE_SAFETY_RADIUS) && !this.isStranded(d),
    );
    const before = world.fg[i]!;
    world.fg[i] = job.target; // pretend it's there (restored below)
    let verdict: 'safe' | 'unsafe' | 'wait' = 'safe';
    for (const dwarf of nearby) {
      verdict = this.wayHome(world.index(dwarf.x, dwarf.y));
      if (verdict !== 'safe') break;
    }
    world.fg[i] = before;
    return verdict;
  }

  /** Whether there's a way home from a cell: 'wait' if this tick's path budget is spent. */
  private wayHome(from: number): 'safe' | 'unsafe' | 'wait' {
    const outcome = this.ctx.paths.request(from, { area: this.ctx.storeArea, reach: 1 });
    if (outcome === 'busy') return 'wait';
    return outcome.found ? 'safe' : 'unsafe';
  }

  private blockAt(x: number, y: number): number {
    return this.ctx.world.fg[this.ctx.world.index(x, y)]!;
  }

  // ---- Fetching, hauling and storing ----------------------------------------------------------

  /** At a store: take the job's materials, then go and use them (or, for gear, put it on). */
  private fetch(dwarf: Dwarf): void {
    const { jobs, colony } = this.ctx;
    if (++dwarf.workTicks < colony.work.pickUpTicks) return;
    dwarf.workTicks = 0;
    const job = this.myJob(dwarf);
    if (!job || !this.ctx.fetchFor(job, dwarf)) {
      if (job) jobs.release(job.id, dwarf.id);
      this.toIdle(dwarf);
      return;
    }
    if (job.type === 'equip') {
      this.ctx.equip(dwarf, job);
      this.toIdle(dwarf);
      return;
    }
    if (this.ctx.isHandCraft(job)) {
      dwarf.phase = 'working';
      return;
    }
    dwarf.phase = 'to-job';
    dwarf.path = null;
  }

  private pickUp(dwarf: Dwarf): void {
    const { jobs, ground, colony } = this.ctx;
    const job = this.myJob(dwarf);
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
    dwarf.carrying = [{ item: stack.item, count: stack.count }];
    dwarf.workTicks = 0;
    dwarf.phase = 'to-storage';
    dwarf.path = null;
  }

  private dropOff(dwarf: Dwarf): void {
    const { jobs, colony } = this.ctx;
    if (++dwarf.workTicks < colony.work.dropOffTicks) return;
    this.ctx.storeCarried(dwarf);
    const job = this.myJob(dwarf);
    if (job?.type === 'haul') jobs.remove(job.id);
    this.toIdle(dwarf);
  }
}
