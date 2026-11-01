/**
 * The job queue. The player designates work (dig this, chop that), the colony adds
 * chores (haul this stack to storage), and idle dwarves claim jobs for themselves.
 *
 *  - Priority first: a dwarf takes the most urgent open job, then the nearest one, then
 *    the oldest, so equal jobs get done in a sensible order.
 *  - Claiming reserves a job: two dwarves never take the same one.
 *  - Jobs no dwarf can reach (or come back from) are flagged as blocked, shown with a
 *    warning icon; the simulation works that out from its home maps after the terrain
 *    changes, so blocked jobs are retried whenever digging opens a new way.
 *  - A dwarf whose path search to a job fails anyway skips it until the maps are next
 *    rebuilt. A job that would strand its digger in a hole is marked unsafe until the
 *    terrain near it changes.
 *  - Dig and chop jobs are also indexed by cell, for the designation overlay and for
 *    designating, cancelling and re-prioritising by rectangle.
 *
 * Pure: no Phaser and no DOM.
 */
import type { CellRect, World } from '../world/World';

export type JobType = 'dig' | 'chop' | 'haul';

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
  /** Dig: the block. Chop: the bottom of the trunk. Haul: where the stack lies. */
  x: number;
  y: number;
  priority: Priority;
  /** The dwarf doing it, or 0. */
  claimedBy: number;
  /** Dwarves whose path search to it failed since the home maps were last rebuilt. */
  readonly unreachableFor: Set<number>;
  /** No dwarf can do it right now: shown with a warning icon. */
  blocked: boolean;
  /** Doing it would leave the digger unable to get home. */
  unsafe: boolean;
  /** Ticks of work done so far (dig and chop). */
  progress: number;
  /** Haul: the item stack. */
  readonly stackId: number;
  /** Chop: the trunk cells, which carry the designation marks. */
  readonly cells: readonly number[];
  readonly createdTick: number;
}

export interface NewJob {
  type: JobType;
  x: number;
  y: number;
  priority: Priority;
  tick: number;
  stackId?: number;
  /** Cells to mark (dig: the block; chop: the trunk). Haul jobs mark none. */
  cells?: readonly number[];
}

export class JobBoard {
  private readonly world: World;
  private readonly jobs = new Map<number, Job>();
  /** Dig or chop job id marked on each cell, 0 for none. */
  private readonly marks: Int32Array;
  private nextId = 1;
  /** Called for each cell whose designation mark appears, changes or disappears. */
  onMarkChanged: (x: number, y: number) => void = () => {};
  /** Called when a job becomes blocked: no dwarf can reach it. */
  onBlocked: (job: Job) => void = () => {};

  constructor(world: World) {
    this.world = world;
    this.marks = new Int32Array(world.width * world.height);
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

  /** The dig or chop job marked on a cell, if any. */
  at(x: number, y: number): Job | undefined {
    if (!this.world.inBounds(x, y)) return undefined;
    const id = this.marks[this.world.index(x, y)]!;
    return id === 0 ? undefined : this.jobs.get(id);
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
      progress: 0,
      stackId: spec.stackId ?? 0,
      cells: spec.cells ?? [],
      createdTick: spec.tick,
    };
    this.jobs.set(job.id, job);
    for (const cell of job.cells) this.marks[cell] = job.id;
    this.markChanged(job);
    return job;
  }

  remove(id: number): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    this.jobs.delete(id);
    for (const cell of job.cells) {
      if (this.marks[cell] === id) this.marks[cell] = 0;
    }
    this.markChanged(job);
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
    if (job && job.claimedBy === dwarf) job.claimedBy = 0;
  }

  /** A dwarf's path search to a job failed: it skips the job until the maps are rebuilt. */
  markUnreachable(id: number, dwarf: number): void {
    this.jobs.get(id)?.unreachableFor.add(dwarf);
  }

  /** Doing this job would strand the digger; leave it until the terrain near it changes. */
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

  setPriority(id: number, priority: Priority): void {
    const job = this.jobs.get(id);
    if (!job || job.priority === priority) return;
    job.priority = priority;
    this.markChanged(job);
  }

  /** Dig and chop jobs with a mark inside a rectangle, each once. */
  inRect(rect: CellRect): Job[] {
    const found = new Set<number>();
    for (let y = Math.max(0, rect.y0); y <= Math.min(this.world.height - 1, rect.y1); y++) {
      for (let x = Math.max(0, rect.x0); x <= Math.min(this.world.width - 1, rect.x1); x++) {
        const id = this.marks[this.world.index(x, y)]!;
        if (id !== 0) found.add(id);
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
      if (job.claimedBy !== 0 || job.unsafe || job.unreachableFor.has(dwarf) || !allow(job)) continue;
      const distance = Math.max(Math.abs(job.x - x), Math.abs(job.y - y));
      if (
        best === null ||
        job.priority > best.priority ||
        (job.priority === best.priority && (distance < bestDistance || (distance === bestDistance && job.id < best.id)))
      ) {
        best = job;
        bestDistance = distance;
      }
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
    const counts: Record<JobType, number> = { dig: 0, chop: 0, haul: 0 };
    for (const job of this.jobs.values()) counts[job.type]++;
    return counts;
  }

  private markChanged(job: Job): void {
    for (const cell of job.cells) {
      const x = cell % this.world.width;
      this.onMarkChanged(x, (cell - x) / this.world.width);
    }
  }
}
