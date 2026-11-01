/**
 * How dwarves can move through the tile grid. A dwarf is one tile tall and stands in a
 * cell; the moves are:
 *
 *   walk   one tile left or right onto ground          cost 1 (2 through water)
 *   jump   one tile up and one across, onto a ledge     cost 2 (needs headroom above)
 *   climb  one tile up or down a ladder                 cost 1.5
 *   swim   one tile up or down through water            cost 2
 *   drop   step off an edge and fall up to `safeDrop`   cost 1 + tiles fallen
 *          tiles (or let go of a ladder and fall)
 *
 * A cell can be stood in if it isn't solid or lava and has something to stand on: a
 * solid block or a ladder below, a ladder in the cell itself, or water to swim in.
 * Trees, grass and flowers don't get in the way.
 *
 * The navigation graph is implicit: `forEachMove` works out a cell's moves from the
 * tiles when the pathfinder asks, so terrain changes never leave a stale graph behind.
 * Pure: no Phaser and no DOM.
 */
import type { TileRegistry } from '../world/TileRegistry';
import type { World } from '../world/World';

export type MoveKind = 'walk' | 'jump' | 'climb' | 'swim' | 'drop';

export const MOVE_COST = {
  walk: 1,
  wade: 2,
  jump: 2,
  climb: 1.5,
  swim: 2,
  /** Plus one per tile fallen. */
  drop: 1,
} as const;

export interface NavOptions {
  /** Longest fall, in tiles, a planned move may include. */
  safeDrop: number;
}

export class NavGrid {
  readonly world: World;
  readonly tiles: TileRegistry;
  readonly safeDrop: number;
  private readonly lavaType: number;
  private readonly waterType: number;

  constructor(world: World, tiles: TileRegistry, options: NavOptions) {
    this.world = world;
    this.tiles = tiles;
    this.safeDrop = options.safeDrop;
    this.lavaType = tiles.hasLiquid('lava') ? tiles.liquid('lava') : -1;
    this.waterType = tiles.hasLiquid('water') ? tiles.liquid('water') : -1;
  }

  /** Not solid and not lava: a dwarf can be here, standing, climbing, swimming or falling. */
  passable(x: number, y: number): boolean {
    const { world } = this;
    if (!world.inBounds(x, y)) return false;
    const i = y * world.width + x;
    return !this.tiles.solid[world.fg[i]!] && world.liquidType[i] !== this.lavaType;
  }

  solidAt(x: number, y: number): boolean {
    const { world } = this;
    // Below the bottom of the world counts as solid ground.
    if (y >= world.height) return true;
    return world.inBounds(x, y) && this.tiles.solid[world.fg[y * world.width + x]!] === 1;
  }

  climbableAt(x: number, y: number): boolean {
    const { world } = this;
    return world.inBounds(x, y) && this.tiles.climbable[world.fg[y * world.width + x]!] === 1;
  }

  waterAt(x: number, y: number): boolean {
    const { world } = this;
    return world.inBounds(x, y) && world.liquidType[y * world.width + x] === this.waterType;
  }

  /** A dwarf can stay here without falling. */
  standable(x: number, y: number): boolean {
    if (!this.passable(x, y)) return false;
    return this.solidAt(x, y + 1) || this.climbableAt(x, y) || this.climbableAt(x, y + 1) || this.waterAt(x, y);
  }

  /**
   * Where a dwarf falling from (x, y) lands: the row of the first cell at or below y it
   * can stand in, or -1 if it would hit lava or fall out of the world. The fall's length
   * is the returned row minus y.
   */
  landingRow(x: number, y: number): number {
    for (let row = y; row < this.world.height; row++) {
      if (!this.passable(x, row)) return -1;
      if (this.standable(x, row)) return row;
    }
    return -1;
  }

  /**
   * How far a dwarf standing on top of the block at (x, y) would fall once that block is
   * removed: 1 if it lands straight on the block below, more over a hole, and Infinity if
   * it would fall into lava or out of the world.
   */
  fallAfterRemoving(x: number, y: number): number {
    let rows = 0;
    for (let row = y; row < this.world.height; row++) {
      rows++;
      // `row` is where the dwarf has fallen to; the removed block itself counts as open.
      const lands = this.solidAt(x, row + 1) || this.climbableAt(x, row + 1) || (row !== y && (this.climbableAt(x, row) || this.waterAt(x, row)));
      if (lands) return rows;
      if (!this.passable(x, row + 1)) return Infinity;
    }
    return Infinity;
  }

  /**
   * Call `visit` for every move from the cell `from` (a cell index). Moves are only
   * listed from cells a dwarf can stand in.
   */
  forEachMove(from: number, visit: (to: number, cost: number, kind: MoveKind) => void): void {
    const { world } = this;
    const width = world.width;
    const x = from % width;
    const y = (from - x) / width;
    if (!this.standable(x, y)) return;
    const headroom = this.passable(x, y - 1);

    for (let dx = -1; dx <= 1; dx += 2) {
      const nx = x + dx;
      if (this.standable(nx, y)) {
        visit(from + dx, this.waterAt(nx, y) ? MOVE_COST.wade : MOVE_COST.walk, 'walk');
      } else if (this.passable(nx, y)) {
        // Step off the edge and fall, if the landing is close enough.
        const land = this.landingRow(nx, y);
        if (land > y && land - y <= this.safeDrop) visit(land * width + nx, MOVE_COST.drop + (land - y), 'drop');
      }
      // Jump up onto a ledge one tile higher.
      if (headroom && this.standable(nx, y - 1)) visit(from - width + dx, MOVE_COST.jump, 'jump');
    }

    // Ladders and water: straight up and down.
    if (headroom && (this.climbableAt(x, y) || this.waterAt(x, y)) && this.standable(x, y - 1)) {
      visit(from - width, this.waterAt(x, y) ? MOVE_COST.swim : MOVE_COST.climb, this.waterAt(x, y) ? 'swim' : 'climb');
    }
    if (this.climbableAt(x, y + 1) || this.waterAt(x, y + 1)) {
      visit(from + width, this.waterAt(x, y + 1) ? MOVE_COST.swim : MOVE_COST.climb, this.waterAt(x, y + 1) ? 'swim' : 'climb');
    } else if (this.climbableAt(x, y) && this.passable(x, y + 1)) {
      // Let go of a ladder and drop.
      const land = this.landingRow(x, y + 1);
      if (land > y && land - y <= this.safeDrop) visit(land * width + x, MOVE_COST.drop + (land - y), 'drop');
    }
  }

  /** The kind of a single step between two cells, as produced by forEachMove. */
  moveKind(from: number, to: number): MoveKind {
    const width = this.world.width;
    const fx = from % width;
    const fy = (from - fx) / width;
    const tx = to % width;
    const ty = (to - tx) / width;
    if (ty === fy) return 'walk';
    if (ty === fy - 1) return tx === fx ? (this.waterAt(fx, fy) ? 'swim' : 'climb') : 'jump';
    if (tx === fx && ty === fy + 1 && (this.climbableAt(tx, ty) || this.waterAt(tx, ty))) return this.waterAt(tx, ty) ? 'swim' : 'climb';
    return 'drop';
  }

  /** Whether a single step is still possible (the terrain may have changed since it was planned). */
  canStep(from: number, to: number): boolean {
    let ok = false;
    this.forEachMove(from, (cell) => {
      if (cell === to) ok = true;
    });
    return ok;
  }
}
