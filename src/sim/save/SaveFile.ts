/**
 * Save files: a running world packed into bytes, and back.
 *
 * Layout (before the platform layer gzips the whole thing):
 *   "GWSV"                     4 bytes, says what this is
 *   format version             uint16
 *   header length              uint32, then the header as UTF-8 JSON: the meta data the
 *                              title screen shows, the world's size, seed, biome and Hearth,
 *                              the tile, wall and liquid ids its numbers stand for, and the
 *                              simulation state (SimState)
 *   five grids                 each a uint32 length and then the grid run-length encoded
 *                              chunk by chunk (see rle.ts): blocks, walls, liquids, liquid
 *                              amounts and cell flags
 *   surface                    int16 per column
 *
 * The world's numbers are mapped through the saved id lists when loading, so a save stays
 * good after tiles.json is reordered or grows; blocks that have since gone become air.
 * Version rules: a save from a newer format is refused, as is one from a format this
 * version no longer reads. All numbers are little-endian.
 *
 * Pure: no Phaser and no DOM.
 */
import { CHUNK_SIZE } from '../../config';
import { AIR, NO_LIQUID, NO_WALL, type TileRegistry } from '../world/TileRegistry';
import { World } from '../world/World';
import { decodeChunks, encodeChunks } from './rle';
import type { SimState } from './SimState';

/** Bumped whenever the layout or SimState changes in a way older code can't read. */
export const SAVE_FORMAT = 1;
/** The oldest format this version can still read. */
export const OLDEST_READABLE_FORMAT = 1;

const MAGIC = [0x47, 0x57, 0x53, 0x56]; // "GWSV"

/** What the title screen shows about a save, without loading it. */
export interface SaveMeta {
  day: number;
  /** Living dwarves. */
  dwarves: number;
  seed: string;
  biome: string;
  /** When it was saved (ms since 1970), from the caller's clock. */
  savedAt: number;
}

export interface SaveHeader {
  format: number;
  meta: SaveMeta;
  world: {
    width: number;
    height: number;
    seed: string;
    biome: string;
    spawn: { x: number; y: number };
    tileIds: string[];
    wallIds: string[];
    liquidIds: string[];
  };
  state: SimState;
}

export type SaveProblem = 'newer' | 'older' | 'damaged';

/** A save that can't be loaded, and why (for a clear message). */
export class SaveError extends Error {
  readonly problem: SaveProblem;

  constructor(problem: SaveProblem, detail: string) {
    super(detail);
    this.name = 'SaveError';
    this.problem = problem;
  }
}

/** Pack a world and its simulation state into bytes. */
export function encodeSave(world: World, tiles: TileRegistry, meta: SaveMeta, state: SimState): Uint8Array {
  const header: SaveHeader = {
    format: SAVE_FORMAT,
    meta,
    world: {
      width: world.width,
      height: world.height,
      seed: world.seed,
      biome: world.biome,
      spawn: { ...world.spawn },
      tileIds: tiles.tiles.map((tile) => tile.id),
      wallIds: tiles.walls.map((wall) => wall.id),
      // Liquid numbers start at 1 (0 is none).
      liquidIds: ['', ...tiles.liquids.map((liquid) => liquid.id)],
    },
    state,
  };
  const grids = [world.fg, world.bg, world.liquidType, world.liquidAmount, world.flags].map((grid) =>
    encodeChunks(grid, world.width, world.height, CHUNK_SIZE),
  );
  const json = new TextEncoder().encode(JSON.stringify(header));
  const size = 4 + 2 + 4 + json.length + grids.reduce((sum, grid) => sum + 4 + grid.byteLength, 0) + world.surface.byteLength;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  bytes.set(MAGIC, at);
  at += 4;
  view.setUint16(at, SAVE_FORMAT, true);
  at += 2;
  view.setUint32(at, json.length, true);
  at += 4;
  bytes.set(json, at);
  at += json.length;
  for (const grid of grids) {
    view.setUint32(at, grid.length, true);
    at += 4;
    for (const value of grid) {
      view.setUint16(at, value, true);
      at += 2;
    }
  }
  for (const value of world.surface) {
    view.setInt16(at, value, true);
    at += 2;
  }
  return bytes;
}

/** Just the format and meta data of a save (for the title screen). Throws SaveError. */
export function readSaveHeader(bytes: Uint8Array): SaveHeader {
  return parse(bytes).header;
}

/**
 * Unpack a save into a World for the current content (its numbers mapped through the
 * saved id lists) and the simulation state to restore into it. Throws SaveError.
 */
export function decodeSave(bytes: Uint8Array, tiles: TileRegistry): { header: SaveHeader; world: World } {
  const { header, view, at: start } = parse(bytes);
  const { width, height } = header.world;
  const cells = width * height;
  if (!(width > 0 && height > 0 && cells <= 4_000_000)) throw new SaveError('damaged', 'Odd world size');
  let at = start;
  const readGrid = <T extends Uint8Array | Uint16Array>(into: T): T => {
    if (at + 4 > view.byteLength) throw new SaveError('damaged', 'The save ends too soon');
    const length = view.getUint32(at, true);
    at += 4;
    if (at + length * 2 > view.byteLength) throw new SaveError('damaged', 'The save ends too soon');
    const runs = new Uint16Array(length);
    for (let i = 0; i < length; i++) runs[i] = view.getUint16(at + i * 2, true);
    at += length * 2;
    try {
      decodeChunks(runs, into, width, height, CHUNK_SIZE);
    } catch (error) {
      throw new SaveError('damaged', (error as Error).message);
    }
    return into;
  };
  const fg = readGrid(new Uint16Array(cells));
  const bg = readGrid(new Uint16Array(cells));
  const liquidType = readGrid(new Uint8Array(cells));
  const liquidAmount = readGrid(new Uint8Array(cells));
  const flags = readGrid(new Uint8Array(cells));
  if (at + width * 2 !== view.byteLength) throw new SaveError('damaged', 'The save is the wrong length');
  const surface = new Int16Array(width);
  for (let x = 0; x < width; x++) surface[x] = view.getInt16(at + x * 2, true);

  // Saved numbers stand for the ids listed in the save; map them onto today's content.
  const { tileIds, wallIds, liquidIds } = header.world;
  const tileMap = tileIds.map((id) => (tiles.hasTile(id) ? tiles.tile(id) : AIR));
  const wallMap = wallIds.map((id) => (tiles.hasWall(id) ? tiles.wall(id) : NO_WALL));
  const liquidMap = liquidIds.map((id) => (tiles.hasLiquid(id) ? tiles.liquid(id) : NO_LIQUID));
  for (let i = 0; i < cells; i++) {
    fg[i] = tileMap[fg[i]!] ?? AIR;
    bg[i] = wallMap[bg[i]!] ?? NO_WALL;
    if (liquidType[i] !== NO_LIQUID) {
      liquidType[i] = liquidMap[liquidType[i]!] ?? NO_LIQUID;
      if (liquidType[i] === NO_LIQUID) liquidAmount[i] = 0;
    }
  }
  const world = World.fromSnapshot({
    width,
    height,
    seed: header.world.seed,
    biome: header.world.biome,
    spawn: { ...header.world.spawn },
    fg,
    bg,
    liquidType,
    liquidAmount,
    flags,
    surface,
  });
  return { header, world };
}

function parse(bytes: Uint8Array): { header: SaveHeader; view: DataView; at: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 10 || MAGIC.some((byte, i) => bytes[i] !== byte)) throw new SaveError('damaged', 'Not a save file');
  const format = view.getUint16(4, true);
  if (format > SAVE_FORMAT) throw new SaveError('newer', `Save format ${format} is newer than ${SAVE_FORMAT}`);
  if (format < OLDEST_READABLE_FORMAT) throw new SaveError('older', `Save format ${format} is no longer read`);
  const length = view.getUint32(6, true);
  if (10 + length > bytes.length) throw new SaveError('damaged', 'The save ends too soon');
  let header: SaveHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(10, 10 + length))) as SaveHeader;
  } catch {
    throw new SaveError('damaged', 'The save header is unreadable');
  }
  if (typeof header !== 'object' || header === null || typeof header.world !== 'object' || typeof header.state !== 'object' || typeof header.meta !== 'object') {
    throw new SaveError('damaged', 'The save header is incomplete');
  }
  return { header, view, at: 10 + length };
}
