/**
 * Which cells the colony can safely work in: where a dwarf can get to from the Hearth,
 * and where it can get back to the Hearth from.
 *
 * Moves aren't all reversible (a dwarf can drop four tiles but only jump up one), so a
 * dwarf could walk into a pit it can never climb out of. Two flood fills over the
 * navigation graph answer both questions for every cell at once:
 *   - `fromHome`: forward from the cells around the Hearth;
 *   - `toHome`: backward from the same cells, following moves in reverse.
 * A cell in both is "workable": dwarves only take jobs they can do while standing in a
 * workable cell, so a job they can't come back from is never started (it shows as
 * blocked instead).
 *
 * The maps are rebuilt after the terrain changes, at most every few ticks; they are a
 * guide for choosing jobs, while every actual step is still checked against the live grid.
 */
import type { CellRect } from '../world/World';
import type { NavGrid } from './NavGrid';

export class HomeMaps {
  private readonly nav: NavGrid;
  private readonly from: Uint32Array;
  private readonly to: Uint32Array;
  private readonly queue: Int32Array;
  private stamp = 0;
  /** Cells visited by the last rebuild, for the debug overlay. */
  sizes = { fromHome: 0, toHome: 0 };

  constructor(nav: NavGrid) {
    this.nav = nav;
    const cells = nav.world.width * nav.world.height;
    this.from = new Uint32Array(cells);
    this.to = new Uint32Array(cells);
    this.queue = new Int32Array(cells);
  }

  canReachFromHome(cell: number): boolean {
    return this.stamp !== 0 && this.from[cell] === this.stamp;
  }

  canGetHome(cell: number): boolean {
    return this.stamp !== 0 && this.to[cell] === this.stamp;
  }

  /** A dwarf can get here from the Hearth and back again. */
  workable(cell: number): boolean {
    return this.stamp !== 0 && this.from[cell] === this.stamp && this.to[cell] === this.stamp;
  }

  /** Rebuild both maps around a home area: the cells within `reach` of it that a dwarf can stand in. */
  rebuild(home: CellRect, reach: number): void {
    const { nav, from, to, queue } = this;
    const { world } = nav;
    this.stamp++;
    const stamp = this.stamp;

    const seeds: number[] = [];
    for (let y = home.y0 - reach; y <= home.y1 + reach; y++) {
      for (let x = home.x0 - reach; x <= home.x1 + reach; x++) {
        if (nav.standable(x, y)) seeds.push(world.index(x, y));
      }
    }

    // Forward: everywhere a dwarf can walk to from home.
    let head = 0;
    let tail = 0;
    for (const seed of seeds) {
      from[seed] = stamp;
      queue[tail++] = seed;
    }
    const visitForward = (next: number): void => {
      if (from[next] === stamp) return;
      from[next] = stamp;
      queue[tail++] = next;
    };
    while (head < tail) nav.forEachMove(queue[head++]!, visitForward);
    this.sizes.fromHome = tail;

    // Backward: everywhere a dwarf can walk home from.
    head = 0;
    tail = 0;
    for (const seed of seeds) {
      to[seed] = stamp;
      queue[tail++] = seed;
    }
    while (head < tail) {
      const cell = queue[head++]!;
      this.forEachMoveInto(cell, (previous) => {
        if (to[previous] === stamp) return;
        to[previous] = stamp;
        queue[tail++] = previous;
      });
    }
    this.sizes.toHome = tail;
  }

  /**
   * Every cell with a move that ends in `cell`. Candidates are the only places a move
   * into `cell` can start from (beside it, below it for jumps and climbs, above it for
   * climbs down and drops); each is confirmed with the forward move rules, so the two
   * directions can never disagree.
   */
  private forEachMoveInto(cell: number, visit: (previous: number) => void): void {
    const { nav } = this;
    const width = nav.world.width;
    const x = cell % width;
    const y = (cell - x) / width;
    const consider = (px: number, py: number): void => {
      if (!nav.standable(px, py)) return;
      const previous = py * width + px;
      if (nav.canStep(previous, cell)) visit(previous);
    };
    for (let dx = -1; dx <= 1; dx += 2) {
      consider(x + dx, y); // walk
      consider(x + dx, y + 1); // jump up
      for (let k = 1; k <= nav.safeDrop; k++) consider(x + dx, y - k); // step off and drop
    }
    consider(x, y + 1); // climb or swim up
    consider(x, y - 1); // climb or swim down
    for (let k = 2; k <= nav.safeDrop; k++) consider(x, y - k); // let go of a ladder
  }
}
