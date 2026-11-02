/**
 * A* search over the moves in NavGrid.
 *
 * A search finds the cheapest way from a dwarf's cell to any cell close enough to a goal
 * area: next to a block to dig, beside a tree, at the Hearth. Every buffer it needs is a
 * typed array sized to the world and reused between searches (a search number marks
 * which entries are current), so searching allocates almost nothing and never stutters
 * the garbage collector. A cap on expanded cells bounds the cost of hopeless searches.
 *
 * The heuristic is the Chebyshev distance to the nearest goal area minus the reach. Every
 * move costs at least as much as the distance it covers, so the heuristic never
 * overestimates and paths are the cheapest possible. Ties go to the cell that has come further, and
 * nothing depends on timing or randomness, so the same question always gets the same path.
 */
import type { CellRect } from '../world/World';
import type { NavGrid } from './NavGrid';

export interface PathGoal {
  /** The cells to get near (inclusive). */
  area: CellRect;
  /** More places that would do as well (e.g. every chest): the search stops at whichever is cheapest to reach. */
  alternatives?: readonly CellRect[];
  /** How close the dwarf must stand: 0 = inside the area, 1 = in it or next to it (diagonals count). */
  reach: number;
  /** Extra condition on the end cell, e.g. "not on top of the block being dug". */
  accept?: (cell: number) => boolean;
  /** Identifies this goal for the path cache; goals without one are never cached. */
  cacheKey?: string;
}

export type PathOutcome =
  | { found: true; /** The cells to step through, ending at the goal; empty if already there. */ cells: number[]; cost: number; expanded: number }
  | { found: false; reason: 'unreachable' | 'too-far'; expanded: number };

export interface PathfinderOptions {
  /** Give up after expanding this many cells. */
  maxExpanded: number;
}

export class Pathfinder {
  readonly nav: NavGrid;
  private readonly maxExpanded: number;

  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;

  // Binary min-heap of open cells, ordered by f = g + h, ties to the larger g.
  private heapCell = new Int32Array(1024);
  private heapF = new Float32Array(1024);
  private heapG = new Float32Array(1024);
  private heapSize = 0;

  constructor(nav: NavGrid, options: PathfinderOptions) {
    this.nav = nav;
    this.maxExpanded = options.maxExpanded;
    const cells = nav.world.width * nav.world.height;
    this.g = new Float32Array(cells);
    this.parent = new Int32Array(cells);
    this.seen = new Uint32Array(cells);
    this.closed = new Uint32Array(cells);
  }

  /** Whether a cell already satisfies a goal. */
  isGoal(cell: number, goal: PathGoal): boolean {
    return distanceToGoal(cell, this.nav.world.width, goal) <= goal.reach && (goal.accept?.(cell) ?? true);
  }

  find(from: number, goal: PathGoal): PathOutcome {
    const { nav, g, parent, seen, closed } = this;
    const width = nav.world.width;
    if (this.search === 0xffffffff) {
      seen.fill(0);
      closed.fill(0);
      this.search = 0;
    }
    const search = ++this.search;
    const x = from % width;
    if (!nav.standable(x, (from - x) / width)) return { found: false, reason: 'unreachable', expanded: 0 };

    const heuristic = (cell: number): number => Math.max(0, distanceToGoal(cell, width, goal) - goal.reach);
    this.heapSize = 0;
    g[from] = 0;
    parent[from] = -1;
    seen[from] = search;
    this.push(from, heuristic(from), 0);

    let current = from;
    const relax = (to: number, cost: number): void => {
      const next = g[current]! + cost;
      if (seen[to] === search && next >= g[to]!) return;
      g[to] = next;
      parent[to] = current;
      seen[to] = search;
      this.push(to, next + heuristic(to), next);
    };

    let expanded = 0;
    while (this.heapSize > 0) {
      current = this.pop();
      if (closed[current] === search) continue;
      closed[current] = search;
      if (this.isGoal(current, goal)) return { found: true, cells: this.trace(current), cost: g[current]!, expanded };
      if (++expanded > this.maxExpanded) return { found: false, reason: 'too-far', expanded };
      nav.forEachMove(current, relax);
    }
    return { found: false, reason: 'unreachable', expanded };
  }

  private trace(end: number): number[] {
    const cells: number[] = [];
    for (let cell = end; this.parent[cell] !== -1; cell = this.parent[cell]!) cells.push(cell);
    return cells.reverse();
  }

  private push(cell: number, f: number, g: number): void {
    if (this.heapSize === this.heapCell.length) this.grow();
    let i = this.heapSize++;
    // Sift up.
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.before(f, g, this.heapF[up]!, this.heapG[up]!)) break;
      this.heapCell[i] = this.heapCell[up]!;
      this.heapF[i] = this.heapF[up]!;
      this.heapG[i] = this.heapG[up]!;
      i = up;
    }
    this.heapCell[i] = cell;
    this.heapF[i] = f;
    this.heapG[i] = g;
  }

  private pop(): number {
    const top = this.heapCell[0]!;
    const last = --this.heapSize;
    if (last > 0) {
      const cell = this.heapCell[last]!;
      const f = this.heapF[last]!;
      const g = this.heapG[last]!;
      // Sift down.
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= last) break;
        const right = left + 1;
        const child = right < last && this.before(this.heapF[right]!, this.heapG[right]!, this.heapF[left]!, this.heapG[left]!) ? right : left;
        if (!this.before(this.heapF[child]!, this.heapG[child]!, f, g)) break;
        this.heapCell[i] = this.heapCell[child]!;
        this.heapF[i] = this.heapF[child]!;
        this.heapG[i] = this.heapG[child]!;
        i = child;
      }
      this.heapCell[i] = cell;
      this.heapF[i] = f;
      this.heapG[i] = g;
    }
    return top;
  }

  /** Heap order: lower f first; on equal f, the cell that has come further (higher g). */
  private before(fa: number, ga: number, fb: number, gb: number): boolean {
    return fa < fb || (fa === fb && ga > gb);
  }

  private grow(): void {
    const size = this.heapCell.length * 2;
    const cells = new Int32Array(size);
    const f = new Float32Array(size);
    const g = new Float32Array(size);
    cells.set(this.heapCell);
    f.set(this.heapF);
    g.set(this.heapG);
    this.heapCell = cells;
    this.heapF = f;
    this.heapG = g;
  }
}

/** Chebyshev distance from a cell to the nearest of a goal's areas. */
export function distanceToGoal(cell: number, width: number, goal: PathGoal): number {
  let best = distanceToArea(cell, width, goal.area);
  if (goal.alternatives) for (const area of goal.alternatives) best = Math.min(best, distanceToArea(cell, width, area));
  return best;
}

/** Chebyshev distance (king moves) from a cell to the nearest cell of a rectangle; 0 inside it. */
export function distanceToArea(cell: number, width: number, area: CellRect): number {
  const x = cell % width;
  const y = (cell - x) / width;
  const dx = Math.max(area.x0 - x, 0, x - area.x1);
  const dy = Math.max(area.y0 - y, 0, y - area.y1);
  return Math.max(dx, dy);
}
