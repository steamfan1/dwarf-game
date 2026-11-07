/**
 * The job queue. The player designates work (dig this, build a wall there, craft five
 * torches), the colony adds chores (haul this stack to storage), and idle dwarves claim
 * jobs for themselves.
 *
 *  - Priority first: a dwarf takes the most urgent open job, then the nearest one, then
 *    the oldest, so equal jobs get done in a sensible order.
 *  - Claiming reserves a job: two dwarves never take the same one. Whenever a claimed job
 *    is given back or removed, `onLetGo` runs, so whatever the job had set aside
 *    (materials in storage, a crafting station) is freed again.
 *  - Jobs no dwarf can reach (or come back from) are flagged as blocked, shown with a
 *    warning icon; the simulation works that out from its home maps after the terrain
 *    changes, so blocked jobs are retried whenever digging opens a new way. Build and
 *    craft jobs whose materials the colony doesn't have are flagged as missing them.
 *  - A dwarf whose path search to a job fails anyway skips it until the maps are next
 *    rebuilt. A job that would strand its digger in a hole is marked unsafe until the
 *    terrain near it changes.
 *  - Jobs in the world are indexed by cell, for the designation overlay and for
 *    designating, cancelling and re-prioritising by rectangle. There are two layers, so a
 *    background wall can be planned in a cell that also has a block or furniture planned:
 *    walls go in the back layer, everything else in the front.
 *
 * Pure: no Phaser and no DOM.
 */
import type { ItemCount } from '../items/ItemRegistry';
import type { CellRect, World } from '../world/World';

/**
 *   dig        remove a block                     chop      fell a tree
 *   harvest    pick berries or mushrooms          haul      carry a stack to storage
 *   build      put a block in a cell              wall      put up a background wall
 *   place      set down a piece of furniture      dismantle take a piece of furniture apart
 *   craft      make a recipe (one craft)
 *   till       turn the soil under a farm plot into farmland
 *   plant      sow a seed in a farm plot (the seed is fetched from storage)
 *   hunt       go after an animal the player marked, and kill it
 *   revive     pour a revival draught on a fallen dwarf
 * A dwarf's own needs are jobs too, taken by that dwarf alone:
 *   equip      fetch better gear                  eat       fetch a meal and eat it
 *   sleep      go to bed (or to the Hearth's floor) and sleep
 *   fight      take on a monster that came near
 */
export type JobType =
  | 'dig'
  | 'chop'
  | 'harvest'
  | 'haul'
  | 'build'
  | 'wall'
  | 'place'
  | 'dismantle'
  | 'craft'
  | 'till'
  | 'plant'
  | 'hunt'
  | 'revive'
  | 'equip'
  | 'eat'
  | 'sleep'
  | 'fight';
export const JOB_TYPES: readonly JobType[] = [
  'dig',
  'chop',
  'harvest',
  'haul',
  'build',
  'wall',
  'place',
  'dismantle',
  'craft',
  'till',
  'plant',
  'hunt',
  'revive',
  'equip',
  'eat',
  'sleep',
  'fight',
];

/** Jobs a dwarf makes for itself and keeps to itself. */
export const PERSONAL_JOBS: ReadonlySet<JobType> = new Set<JobType>(['equip', 'eat', 'sleep', 'fight']);

export type MarkLayer = 'front' | 'back';

/** 1 low, 2 normal, 3 high, 4 urgent. */
export type Priority = 1 | 2 | 3 | 4;
export const PRIORITIES: readonly Priority[] = [1, 2, 3, 4];
export const DEFAULT_PRIORITY: Priority = 2;
/** Hauling is what dwarves do when nothing more pressing is waiting. */
export const HAUL_PRIORITY: Priority = 1;

/** An unsafe job is reconsidered when the terrain within this many tiles of it changes. */
const UNSAFE_RADIUS = 4;

export interface Job {
  readonly id: number;
  readonly type: JobType;
  /**
   * Dig, build, wall: the cell. Chop: the bottom of the trunk. Haul: where the stack lies.
   * Place, dismantle: the furniture's bottom-left cell. Craft: the station (or the Hearth).
   * Hunt, fight: where the creature is (kept up to date). Revive: where the body lies.
   */
  x: number;
  y: number;
  priority: Priority;
  /** The dwarf doing it, or 0. */
  claimedBy: number;
  /** Dwarves whose path search to it failed since the home maps were last rebuilt. */
  readonly unreachableFor: Set<number>;
  /** No dwarf can do it right now: shown with a warning icon. */
  blocked: boolean;
  /** Doing it would leave a dwarf unable to get home. */
  unsafe: boolean;
  /** Waiting for materials the colony doesn't have. */
  missing: boolean;
  /** Ticks of work done so far. */
  progress: number;
  /** Haul: the item stack. */
  readonly stackId: number;
  /** Cells that carry the job's mark (dig: the block; chop: the trunk; place: the footprint...). */
  readonly cells: readonly number[];
  readonly layer: MarkLayer;
  /** What the job uses up, fetched from storage before the work starts. */
  readonly inputs: readonly ItemCount[];
  /**
   * Build: the tile. Wall: the wall. Place: the furniture kind. Craft: the recipe. Equip,
   * eat: the item. Harvest: the plant's tile. Till, plant: the crop. Hunt, fight: the
   * creature's id. Revive: the fallen dwarf's id. -1 otherwise.
   */
  readonly target: number;
  /** Craft: the order it belongs to. */
  readonly orderId: number;
  /**
   * Dismantle: the piece to take apart. Craft: the station claimed for it (0 for none yet,
   * or by hand). Sleep: the bed (0: the floor by the Hearth). Eat: the table (0: none).
   */
  furnitureId: number;
  /** Its inputs are reserved in storage (claimed, not fetched yet). */
  reserved: boolean;
  readonly createdTick: number;
}

export interface NewJob {
  type: JobType;
  x: number;
  y: number;
  priority: Priority;
  tick: number;
  stackId?: number;
  /** Cells to mark. Haul, craft and equip jobs mark none. */
  cells?: readonly number[];
  layer?: MarkLayer;
  inputs?: readonly ItemCount[];
  target?: number;
  orderId?: number;
  furnitureId?: number;
}

export class JobBoard {
  private readonly world: World;
  private readonly jobs = new Map<number, Job>();
  /** Job id marked on each cell, 0 for none: front layer and back (walls). */
  private readonly front: Int32Array;
  private readonly back: Int32Array;
  private nextId = 1;
  /** Called for each cell whose mark appears, changes or disappears. */
  onMarkChanged: (x: number, y: number) => void = () => {};
  /** Called when a job becomes blocked: no dwarf can reach it. */
  onBlocked: (job: Job) => void = () => {};
  /** Called when a claimed job is given back, and when any job is removed. */
  onLetGo: (job: Job) => void = () => {};

  constructor(world: World) {
    this.world = world;
    this.front = new Int32Array(world.width * world.height);
    this.back = new Int32Array(world.width * world.height);
  }

  get size(): number {
    return this.jobs.size;
  }

  all(): IterableIterator<Job> {
    return this.jobs.values();
  }

  get(id: number): Job | undefined {
    return this.jobs.get(id);
  }

  /** The job marked on a cell's front layer (dig, chop, build, place, dismantle), if any. */
  at(x: number, y: number): Job | undefined {
    return this.markAt(this.front, x, y);
  }

  /** The wall job marked on a cell, if any. */
  wallAt(x: number, y: number): Job | undefined {
    return this.markAt(this.back, x, y);
  }

  add(spec: NewJob): Job {
    const job: Job = {
      id: this.nextId++,
      type: spec.type,
      x: spec.x,
      y: spec.y,
      priority: spec.priority,
      claimedBy: 0,
      unreachableFor: new Set(),
      blocked: false,
      unsafe: false,
      missing: false,
      progress: 0,
      stackId: spec.stackId ?? 0,
      cells: spec.cells ?? [],
      layer: spec.layer ?? 'front',
      inputs: spec.inputs ?? [],
      target: spec.target ?? -1,
      orderId: spec.orderId ?? 0,
      furnitureId: spec.furnitureId ?? 0,
      reserved: false,
      createdTick: spec.tick,
    };
    this.jobs.set(job.id, job);
    const marks = this.layer(job);
    for (const cell of job.cells) marks[cell] = job.id;
    this.markChanged(job);
    return job;
  }

  remove(id: number): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    this.jobs.delete(id);
    const marks = this.layer(job);
    for (const cell of job.cells) {
      if (marks[cell] === id) marks[cell] = 0;
    }
    this.markChanged(job);
    this.onLetGo(job);
    return job;
  }

  /** Reserve a job for a dwarf. False if someone else already has it. */
  claim(id: number, dwarf: number): boolean {
    const job = this.jobs.get(id);
    if (!job || (job.claimedBy !== 0 && job.claimedBy !== dwarf)) return false;
    job.claimedBy = dwarf;
    return true;
  }

  /** Give a job back (the dwarf was interrupted); its progress is kept. */
  release(id: number, dwarf: number): void {
    const job = this.jobs.get(id);
    if (!job || job.claimedBy !== dwarf) return;
    this.onLetGo(job);
    job.claimedBy = 0;
  }

  /** A dwarf's path search to a job failed: it skips the job until the maps are rebuilt. */
  markUnreachable(id: number, dwarf: number): void {
    this.jobs.get(id)?.unreachableFor.add(dwarf);
  }

  /** Doing this job would strand a dwarf; leave it until the terrain near it changes. */
  markUnsafe(id: number): void {
    const job = this.jobs.get(id);
    if (!job || job.unsafe) return;
    job.unsafe = true;
    this.setBlocked(job, true);
  }

  /** Flag or unflag a job as blocked. */
  setBlocked(job: Job, blocked: boolean): void {
    if (job.blocked === blocked) return;
    job.blocked = blocked;
    this.markChanged(job);
    if (blocked) this.onBlocked(job);
  }

  /** Flag or unflag a job as waiting for materials. */
  setMissing(job: Job, missing: boolean): void {
    if (job.missing === missing) return;
    job.missing = missing;
    this.markChanged(job);
  }

  setPriority(id: number, priority: Priority): void {
    const job = this.jobs.get(id);
    if (!job || job.priority === priority) return;
    job.priority = priority;
    this.markChanged(job);
  }

  /** Jobs with a mark inside a rectangle, in either layer, each once. */
  inRect(rect: CellRect): Job[] {
    const found = new Set<number>();
    for (let y = Math.max(0, rect.y0); y <= Math.min(this.world.height - 1, rect.y1); y++) {
      for (let x = Math.max(0, rect.x0); x <= Math.min(this.world.width - 1, rect.x1); x++) {
        const i = this.world.index(x, y);
        if (this.front[i] !== 0) found.add(this.front[i]!);
        if (this.back[i] !== 0) found.add(this.back[i]!);
      }
    }
    return [...found].map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  /**
   * The job a dwarf at (x, y) should take next: unclaimed, not unsafe, not known to be out
   * of its reach, most urgent first, then nearest, then oldest. `allow` can rule out more.
   */
  bestFor(dwarf: number, x: number, y: number, allow: (job: Job) => boolean = () => true): Job | null {
    let best: Job | null = null;
    let bestDistance = Infinity;
    for (const job of this.jobs.values()) {
      if (job.claimedBy !== 0 || job.unsafe || job.unreachableFor.has(dwarf)) continue;
      const distance = Math.max(Math.abs(job.x - x), Math.abs(job.y - y));
      const better =
        best === null ||
        job.priority > best.priority ||
        (job.priority === best.priority && (distance < bestDistance || (distance === bestDistance && job.id < best.id)));
      // `allow` can be costly, so it is only asked about jobs that would win.
      if (!better || !allow(job)) continue;
      best = job;
      bestDistance = distance;
    }
    return best;
  }

  /** The terrain at (x, y) changed: unsafe jobs near it are worth another look. */
  terrainChanged(x: number, y: number): void {
    for (const job of this.jobs.values()) {
      if (job.unsafe && Math.abs(job.x - x) <= UNSAFE_RADIUS && Math.abs(job.y - y) <= UNSAFE_RADIUS) job.unsafe = false;
    }
  }

  /** The home maps were rebuilt: forget which dwarves failed to find a way to which jobs. */
  mapsRebuilt(): void {
    for (const job of this.jobs.values()) job.unreachableFor.clear();
  }

  /** Counts by type, for the debug overlay. */
  counts(): Record<JobType, number> {
    const counts = Object.fromEntries(JOB_TYPES.map((type) => [type, 0])) as Record<JobType, number>;
    for (const job of this.jobs.values()) counts[job.type]++;
    return counts;
  }

  private layer(job: Job): Int32Array {
    return job.layer === 'back' ? this.back : this.front;
  }

  private markAt(marks: Int32Array, x: number, y: number): Job | undefined {
    if (!this.world.inBounds(x, y)) return undefined;
    const id = marks[this.world.index(x, y)]!;
    return id === 0 ? undefined : this.jobs.get(id);
  }

  private markChanged(job: Job): void {
    for (const cell of job.cells) {
      const x = cell % this.world.width;
      this.onMarkChanged(x, (cell - x) / this.world.width);
    }
  }
}
