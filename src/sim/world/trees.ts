/**
 * Finding whole trees in the tile grid, for chopping.
 *
 * World generation grows each tree as a column of trunk tiles standing on the ground,
 * with a crown of leaf tiles around and above it (conifers also cover the upper trunk
 * with needles). Neighbouring crowns can touch, so a tree owns only the leaves closer to
 * its own trunk than to any other.
 */
import type { TileRegistry } from './TileRegistry';
import type { World } from './World';

export interface Tree {
  /** The trunk's column. */
  x: number;
  /** Row of the lowest trunk tile (it stands on the ground below). */
  base: number;
  /** Row of the highest tile in the trunk's column. */
  top: number;
  /** The trunk's column from base to top: where the chop marks go. */
  column: number[];
  /** Every cell that disappears when the tree is felled. */
  cells: number[];
  /** Wood it gives when felled. */
  wood: number;
}

/** How far leaves can spread from their trunk. */
const CROWN_REACH = 4;

export class TreeFinder {
  private readonly world: World;
  private readonly isLog: Uint8Array;
  private readonly isLeaf: Uint8Array;

  constructor(world: World, tiles: TileRegistry) {
    this.world = world;
    this.isLog = Uint8Array.from(tiles.tiles, (tile) => (tile.art.style === 'log' ? 1 : 0));
    this.isLeaf = Uint8Array.from(tiles.tiles, (tile) => (tile.art.style === 'leaves' ? 1 : 0));
  }

  logAt(x: number, y: number): boolean {
    return this.world.inBounds(x, y) && this.isLog[this.world.fg[this.world.index(x, y)]!] === 1;
  }

  leafAt(x: number, y: number): boolean {
    return this.world.inBounds(x, y) && this.isLeaf[this.world.fg[this.world.index(x, y)]!] === 1;
  }

  /** The tree a trunk or leaf cell belongs to, or null. */
  treeAt(x: number, y: number): Tree | null {
    const trunk = this.logAt(x, y) ? { x, y } : this.leafAt(x, y) ? this.trunkNearLeaf(x, y) : null;
    if (!trunk) return null;
    let base = trunk.y;
    while (this.logAt(trunk.x, base + 1)) base++;
    let top = trunk.y;
    while (this.logAt(trunk.x, top - 1) || this.leafAt(trunk.x, top - 1)) top--;

    const { world } = this;
    const column: number[] = [];
    for (let row = top; row <= base; row++) column.push(world.index(trunk.x, row));

    // Leaves joined to the trunk's column, nearer to this trunk than to any other.
    const others = this.otherTrunks(trunk.x, top, base);
    const owns = (leafX: number): boolean => others.every((other) => Math.abs(leafX - trunk.x) <= Math.abs(leafX - other));
    const cells = new Set(column);
    const queue = [...column];
    while (queue.length > 0) {
      const cell = queue.pop()!;
      const cx = cell % world.width;
      const cy = (cell - cx) / world.width;
      for (const [nx, ny] of [
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy - 1],
        [cx, cy + 1],
      ] as const) {
        if (Math.abs(nx - trunk.x) > CROWN_REACH || ny > base || !this.leafAt(nx, ny) || !owns(nx)) continue;
        const next = world.index(nx, ny);
        if (cells.has(next)) continue;
        cells.add(next);
        queue.push(next);
      }
    }
    return { x: trunk.x, base, top, column, cells: [...cells], wood: Math.max(2, Math.ceil(column.length / 2)) };
  }

  /** The trunk under or beside a leaf: the nearest column with trunk tiles below the leaf. */
  private trunkNearLeaf(x: number, y: number): { x: number; y: number } | null {
    for (let distance = 0; distance <= CROWN_REACH; distance++) {
      for (const tx of distance === 0 ? [x] : [x - distance, x + distance]) {
        for (let ty = y; ty <= y + 10; ty++) {
          if (this.logAt(tx, ty)) return { x: tx, y: ty };
          if (!this.logAt(tx, ty) && !this.leafAt(tx, ty) && ty > y) break;
        }
      }
    }
    return null;
  }

  /** Columns near a trunk that hold other trunks, between the given rows. */
  private otherTrunks(trunkX: number, top: number, base: number): number[] {
    const found: number[] = [];
    for (let x = trunkX - 2 * CROWN_REACH; x <= trunkX + 2 * CROWN_REACH; x++) {
      if (x === trunkX) continue;
      for (let y = top; y <= base + 1; y++) {
        if (this.logAt(x, y)) {
          found.push(x);
          break;
        }
      }
    }
    return found;
  }
}
