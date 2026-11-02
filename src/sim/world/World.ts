/**
 * The tile grid. Every cell has a foreground block, a background wall, an optional
 * liquid and a few flag bits, each stored in its own typed array indexed by
 * `y * width + x`. That keeps a 400 x 200 world at about half a megabyte, makes
 * copying it to and from a Web Worker free (the arrays are transferred, not cloned),
 * and lets hot loops run without allocating objects.
 *
 * The grid is divided into CHUNK_SIZE x CHUNK_SIZE chunks; rendering, lighting and
 * pathfinding only redo work for the chunks a change touches.
 */
import { CHUNK_SIZE } from '../../config';
import { AIR, NO_LIQUID, NO_WALL } from './TileRegistry';

/** flags bit: the player has seen this cell. */
export const FLAG_EXPLORED = 1;
/** flags bit: the block in this cell was built by a dwarf (monsters that smash built things can break it). */
export const FLAG_BUILT = 2;

/** A liquid amount of 255 is a full cell; partial amounts are reserved for flowing liquids. */
export const LIQUID_FULL = 255;

/** Inclusive rectangle of cells. */
export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Everything needed to rebuild a World, in transferable form (used by the worldgen worker and saves). */
export interface WorldSnapshot {
  width: number;
  height: number;
  seed: string;
  biome: string;
  spawn: { x: number; y: number };
  fg: Uint16Array;
  bg: Uint16Array;
  liquidType: Uint8Array;
  liquidAmount: Uint8Array;
  flags: Uint8Array;
  /** Row of the first solid block in each column when the world was made; cells above it are open sky. */
  surface: Int16Array;
}

export class World {
  readonly width: number;
  readonly height: number;
  readonly seed: string;
  readonly biome: string;
  spawn: { x: number; y: number };

  readonly fg: Uint16Array;
  readonly bg: Uint16Array;
  readonly liquidType: Uint8Array;
  readonly liquidAmount: Uint8Array;
  readonly flags: Uint8Array;
  readonly surface: Int16Array;

  readonly chunkCols: number;
  readonly chunkRows: number;

  private constructor(snapshot: WorldSnapshot) {
    const cells = snapshot.width * snapshot.height;
    const arrays = [snapshot.fg, snapshot.bg, snapshot.liquidType, snapshot.liquidAmount, snapshot.flags];
    if (arrays.some((a) => a.length !== cells) || snapshot.surface.length !== snapshot.width) {
      throw new Error('World snapshot arrays do not match its size');
    }
    this.width = snapshot.width;
    this.height = snapshot.height;
    this.seed = snapshot.seed;
    this.biome = snapshot.biome;
    this.spawn = { ...snapshot.spawn };
    this.fg = snapshot.fg;
    this.bg = snapshot.bg;
    this.liquidType = snapshot.liquidType;
    this.liquidAmount = snapshot.liquidAmount;
    this.flags = snapshot.flags;
    this.surface = snapshot.surface;
    this.chunkCols = Math.ceil(this.width / CHUNK_SIZE);
    this.chunkRows = Math.ceil(this.height / CHUNK_SIZE);
  }

  /** An all-air world (world generation fills it in). */
  static empty(width: number, height: number, seed: string, biome: string): World {
    const cells = width * height;
    return new World({
      width,
      height,
      seed,
      biome,
      spawn: { x: Math.floor(width / 2), y: 0 },
      fg: new Uint16Array(cells).fill(AIR),
      bg: new Uint16Array(cells).fill(NO_WALL),
      liquidType: new Uint8Array(cells).fill(NO_LIQUID),
      liquidAmount: new Uint8Array(cells),
      flags: new Uint8Array(cells),
      surface: new Int16Array(width).fill(height),
    });
  }

  /** Wrap a snapshot's arrays (no copy). */
  static fromSnapshot(snapshot: WorldSnapshot): World {
    return new World(snapshot);
  }

  /** A snapshot sharing this world's arrays (no copy). */
  toSnapshot(): WorldSnapshot {
    return {
      width: this.width,
      height: this.height,
      seed: this.seed,
      biome: this.biome,
      spawn: { ...this.spawn },
      fg: this.fg,
      bg: this.bg,
      liquidType: this.liquidType,
      liquidAmount: this.liquidAmount,
      flags: this.flags,
      surface: this.surface,
    };
  }

  /** The arrays to list as transferables when posting a snapshot between threads. */
  static transferables(snapshot: WorldSnapshot): ArrayBuffer[] {
    return [snapshot.fg, snapshot.bg, snapshot.liquidType, snapshot.liquidAmount, snapshot.flags, snapshot.surface].map(
      (a) => a.buffer as ArrayBuffer,
    );
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Foreground tile at a cell; out-of-bounds cells read as AIR. */
  fgAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.fg[y * this.width + x] : AIR;
  }

  /** Open sky: above the original surface of its column. Sky is never hidden by fog. */
  isSky(x: number, y: number): boolean {
    return y < this.surface[x];
  }

  isExplored(x: number, y: number): boolean {
    return (this.flags[y * this.width + x] & FLAG_EXPLORED) !== 0;
  }

  /** Whether the player can see a cell: explored, or open sky. */
  isVisible(x: number, y: number): boolean {
    return this.inBounds(x, y) && (this.isSky(x, y) || this.isExplored(x, y));
  }

  /**
   * Mark an ellipse of cells as explored. Returns the bounding rectangle of the cells that
   * were newly revealed, or null if nothing changed.
   */
  revealEllipse(cx: number, cy: number, rx: number, ry: number): CellRect | null {
    let changed: CellRect | null = null;
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / (rx + 0.5);
        const dy = (y - cy) / (ry + 0.5);
        if (dx * dx + dy * dy > 1) continue;
        const i = y * this.width + x;
        if (this.flags[i] & FLAG_EXPLORED) continue;
        this.flags[i] |= FLAG_EXPLORED;
        changed = changed ? growRect(changed, x, y) : { x0: x, y0: y, x1: x, y1: y };
      }
    }
    return changed;
  }

  revealAll(): CellRect {
    for (let i = 0; i < this.flags.length; i++) this.flags[i] |= FLAG_EXPLORED;
    return { x0: 0, y0: 0, x1: this.width - 1, y1: this.height - 1 };
  }

  chunkIndex(x: number, y: number): number {
    return Math.floor(y / CHUNK_SIZE) * this.chunkCols + Math.floor(x / CHUNK_SIZE);
  }

  /** Cells covered by a chunk (edge chunks are smaller when the world size isn't a multiple of CHUNK_SIZE). */
  chunkCells(chunk: number): CellRect {
    const cx = chunk % this.chunkCols;
    const cy = Math.floor(chunk / this.chunkCols);
    return {
      x0: cx * CHUNK_SIZE,
      y0: cy * CHUNK_SIZE,
      x1: Math.min(this.width, (cx + 1) * CHUNK_SIZE) - 1,
      y1: Math.min(this.height, (cy + 1) * CHUNK_SIZE) - 1,
    };
  }
}

export function growRect(rect: CellRect, x: number, y: number): CellRect {
  return {
    x0: Math.min(rect.x0, x),
    y0: Math.min(rect.y0, y),
    x1: Math.max(rect.x1, x),
    y1: Math.max(rect.y1, y),
  };
}

/** The smallest rectangle covering both rectangles. */
export function unionRect(a: CellRect, b: CellRect): CellRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}
