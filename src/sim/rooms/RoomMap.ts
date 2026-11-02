/**
 * Room detection. A room is a space enclosed by solid blocks and doors, with a background
 * wall behind every cell of it, found by flood fill:
 *
 *   - the open cells (not solid, not a door) are split into 4-connected regions;
 *   - a region is a room if it has a wall behind every cell, never reaches the edge of
 *     the world, holds no lava, and is at most `maxCells` big (a vast cave isn't a room).
 *
 * Doors close a room off but don't belong to it. Rooms matter for what's in them: a bed
 * in a room with a light gives a better night's sleep, a table in a room a better meal,
 * and from Milestone 5 monsters can't appear inside one.
 *
 * Rebuilding looks at every open cell once (about 80,000 in a full world), so the
 * simulation does it at most every few ticks, and only after blocks, walls, doors or
 * furniture change. Pure: no Phaser and no DOM.
 */
import type { FurnitureSet } from '../furniture/Furniture';
import type { TileRegistry } from '../world/TileRegistry';
import type { CellRect, World } from '../world/World';

export interface Room {
  readonly id: number;
  /** Number of cells. */
  readonly size: number;
  /** Bounding box of its cells. */
  readonly rect: CellRect;
  beds: number;
  tables: number;
  /** Light sources inside it: torches, furnaces, the Hearth... */
  lights: number;
}

/** Larger enclosed spaces (big natural caves) aren't rooms. */
export const MAX_ROOM_CELLS = 400;

export class RoomMap {
  /** Room id per cell, 0 outside any room. */
  readonly roomOf: Int32Array;
  /** Bumped on every rebuild. */
  version = 0;
  private readonly world: World;
  private readonly tiles: TileRegistry;
  private readonly maxCells: number;
  private readonly rooms = new Map<number, Room>();
  private readonly seen: Uint32Array;
  private readonly queue: Int32Array;
  private stamp = 0;
  private readonly lavaType: number;

  constructor(world: World, tiles: TileRegistry, maxCells = MAX_ROOM_CELLS) {
    this.world = world;
    this.tiles = tiles;
    this.maxCells = maxCells;
    const cells = world.width * world.height;
    this.roomOf = new Int32Array(cells);
    this.seen = new Uint32Array(cells);
    this.queue = new Int32Array(cells);
    this.lavaType = tiles.hasLiquid('lava') ? tiles.liquid('lava') : -1;
  }

  get size(): number {
    return this.rooms.size;
  }

  all(): IterableIterator<Room> {
    return this.rooms.values();
  }

  get(id: number): Room | undefined {
    return this.rooms.get(id);
  }

  /** The room a cell is in, if any. */
  roomAt(x: number, y: number): Room | undefined {
    if (!this.world.inBounds(x, y)) return undefined;
    const id = this.roomOf[this.world.index(x, y)]!;
    return id === 0 ? undefined : this.rooms.get(id);
  }

  /** Whether a cell is part of a room's space (not solid and not a door). */
  isOpen(i: number): boolean {
    const tile = this.world.fg[i]!;
    return this.tiles.solid[tile] === 0 && this.tiles.door[tile] === 0;
  }

  /**
   * Find every room again, then count what's in each: beds, tables and lights among the
   * furniture, plus `lightCells` (other light sources, such as the Hearth).
   */
  rebuild(furniture?: FurnitureSet, lightCells: readonly number[] = []): void {
    const { world, roomOf, seen, queue } = this;
    const { width, height } = world;
    const cells = width * height;
    roomOf.fill(0);
    this.rooms.clear();
    if (++this.stamp === 0xffffffff) {
      seen.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    let nextId = 1;
    const { solid, door } = this.tiles;
    const fg = world.fg;
    const open = (i: number): boolean => solid[fg[i]!] === 0 && door[fg[i]!] === 0;

    for (let start = 0; start < cells; start++) {
      if (seen[start] === stamp || !open(start)) continue;
      // Flood the region from `start`, noting whether it can still be a room.
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      seen[start] = stamp;
      let enclosed = true;
      let x0 = width;
      let y0 = height;
      let x1 = -1;
      let y1 = -1;
      while (head < tail) {
        const i = queue[head++]!;
        const x = i % width;
        const y = (i - x) / width;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (world.bg[i] === 0 || world.liquidType[i] === this.lavaType) enclosed = false;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) enclosed = false;
        if (x > 0 && seen[i - 1] !== stamp && open(i - 1)) {
          seen[i - 1] = stamp;
          queue[tail++] = i - 1;
        }
        if (x < width - 1 && seen[i + 1] !== stamp && open(i + 1)) {
          seen[i + 1] = stamp;
          queue[tail++] = i + 1;
        }
        if (y > 0 && seen[i - width] !== stamp && open(i - width)) {
          seen[i - width] = stamp;
          queue[tail++] = i - width;
        }
        if (y < height - 1 && seen[i + width] !== stamp && open(i + width)) {
          seen[i + width] = stamp;
          queue[tail++] = i + width;
        }
      }
      if (!enclosed || tail > this.maxCells) continue;
      const id = nextId++;
      for (let k = 0; k < tail; k++) roomOf[queue[k]!] = id;
      this.rooms.set(id, { id, size: tail, rect: { x0, y0, x1, y1 }, beds: 0, tables: 0, lights: 0 });
    }

    if (furniture) {
      for (const piece of furniture.all()) {
        const room = this.rooms.get(roomOf[world.index(piece.x, piece.y)]!);
        if (!room) continue;
        if (piece.def.use === 'bed') room.beds++;
        if (piece.def.use === 'table') room.tables++;
        if (piece.def.light > 0) room.lights++;
      }
    }
    for (const cell of lightCells) {
      const room = this.rooms.get(roomOf[cell]!);
      if (room) room.lights++;
    }
    this.version++;
  }

}
