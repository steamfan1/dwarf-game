/**
 * The terrain atlas: one image holding a frame for every tile, wall and liquid, and the
 * maths that picks the right frame for each cell of the world.
 *
 * Layout: frames are 16 x 16 with a 1-pixel extruded border (18 x 18 cells), 32 per row.
 *  - one row per foreground tile: frame = mask * 2 + variant, where `mask` says which of
 *    its four sides touch something it doesn't join with (see tileArt.ts);
 *  - one row per background wall: frames 0-1 are its two variants;
 *  - one row for liquids: 4 frames each (body, body, surface, surface).
 * The extruded border stops neighbouring frames bleeding into each other when the
 * camera sits between pixels. Phaser reads it as a tileset with margin 1 and spacing 2.
 *
 * Pure apart from painting onto a 2D canvas context.
 */
import { Rng } from '../../core/Rng';
import { AIR, NO_LIQUID, NO_WALL, type TileRegistry } from '../../sim/world/TileRegistry';
import type { World } from '../../sim/world/World';
import { hash2 } from '../../sim/worldgen/noise';
import {
  EXPOSED_BOTTOM,
  EXPOSED_LEFT,
  EXPOSED_RIGHT,
  EXPOSED_TOP,
  FRAME,
  paintLiquid,
  paintTile,
  paintWall,
  type Pixels,
} from './tileArt';

export const ATLAS_MARGIN = 1;
export const ATLAS_SPACING = 2;
export const ATLAS_CELL = FRAME + ATLAS_SPACING;
export const ATLAS_COLUMNS = 32;
export const VARIANTS = 2;
const LIQUID_FRAMES = 4;

export interface AtlasLayout {
  width: number;
  height: number;
  /** Atlas row of each tile id, or -1 for air. */
  tileRow: Int16Array;
  /** Atlas row of each wall id, or -1 for "no wall". */
  wallRow: Int16Array;
  liquidRow: number;
}

export function createAtlasLayout(tiles: TileRegistry): AtlasLayout {
  let row = 0;
  const tileRow = new Int16Array(tiles.tiles.length).fill(-1);
  tiles.tiles.forEach((_tile, id) => {
    if (id !== AIR) tileRow[id] = row++;
  });
  const wallRow = new Int16Array(tiles.walls.length).fill(-1);
  tiles.walls.forEach((_wall, id) => {
    if (id !== NO_WALL) wallRow[id] = row++;
  });
  if (tiles.liquids.length * LIQUID_FRAMES > ATLAS_COLUMNS) throw new Error('Too many liquids for one atlas row');
  const liquidRow = row++;
  return { width: ATLAS_COLUMNS * ATLAS_CELL, height: row * ATLAS_CELL, tileRow, wallRow, liquidRow };
}

/** Top-left pixel of a frame's 16 x 16 image inside the atlas. */
export function framePosition(frame: number): { x: number; y: number } {
  return {
    x: ATLAS_MARGIN + (frame % ATLAS_COLUMNS) * ATLAS_CELL,
    y: ATLAS_MARGIN + Math.floor(frame / ATLAS_COLUMNS) * ATLAS_CELL,
  };
}

export function tileFrame(layout: AtlasLayout, tile: number, mask: number, variant: number): number {
  const row = layout.tileRow[tile]!;
  return row < 0 ? -1 : row * ATLAS_COLUMNS + mask * VARIANTS + variant;
}

export function wallFrame(layout: AtlasLayout, wall: number, variant: number): number {
  const row = layout.wallRow[wall]!;
  return row < 0 ? -1 : row * ATLAS_COLUMNS + variant;
}

export function liquidFrame(layout: AtlasLayout, liquid: number, surface: boolean, variant: number): number {
  if (liquid === NO_LIQUID) return -1;
  return layout.liquidRow * ATLAS_COLUMNS + (liquid - 1) * LIQUID_FRAMES + (surface ? 2 : 0) + variant;
}

/** Which of two texture variants a cell uses; fixed per position so the ground doesn't shimmer. */
export function cellVariant(x: number, y: number): number {
  return hash2(x, y, 1337) < 0.5 ? 0 : 1;
}

/** Sides of a cell's foreground tile that don't join a neighbour (EXPOSED_* bits). */
export function exposureMask(world: World, tiles: TileRegistry, x: number, y: number): number {
  const group = tiles.connectGroup[world.fg[world.index(x, y)]!]!;
  if (group === 0) return 0;
  const joins = (nx: number, ny: number): boolean =>
    !world.inBounds(nx, ny) || tiles.connectGroup[world.fg[world.index(nx, ny)]!] === group;
  let mask = 0;
  if (!joins(x, y - 1)) mask |= EXPOSED_TOP;
  if (!joins(x + 1, y)) mask |= EXPOSED_RIGHT;
  if (!joins(x, y + 1)) mask |= EXPOSED_BOTTOM;
  if (!joins(x - 1, y)) mask |= EXPOSED_LEFT;
  return mask;
}

/** Frame for a cell's foreground layer: its block, or its liquid, or -1 for nothing. */
export function foregroundFrameAt(world: World, tiles: TileRegistry, layout: AtlasLayout, x: number, y: number): number {
  const i = world.index(x, y);
  const tile = world.fg[i]!;
  if (tile !== AIR) return tileFrame(layout, tile, exposureMask(world, tiles, x, y), cellVariant(x, y));
  const liquid = world.liquidType[i]!;
  if (liquid === NO_LIQUID) return -1;
  // The top layer of a pool shows a bright surface line, unless a block sits right on it.
  const above = y > 0 ? i - world.width : -1;
  const surface = above >= 0 && world.liquidType[above] !== liquid && !tiles.solid[world.fg[above]!];
  return liquidFrame(layout, liquid, surface, cellVariant(x, y));
}

/** Frame for a cell's background layer, or -1 for no wall. */
export function backgroundFrameAt(world: World, layout: AtlasLayout, x: number, y: number): number {
  return wallFrame(layout, world.bg[world.index(x, y)]!, cellVariant(x, y));
}

/** Paint the whole atlas. Each tile's frames share one base texture per variant, so only edges differ between masks. */
export function paintAtlas(ctx: CanvasRenderingContext2D, tiles: TileRegistry, layout: AtlasLayout): void {
  const image = ctx.createImageData(layout.width, layout.height);
  const put = (frame: number, pixels: Pixels): void => blitExtruded(image, framePosition(frame), pixels);

  tiles.tiles.forEach((tile, id) => {
    if (id === AIR) return;
    for (let variant = 0; variant < VARIANTS; variant++) {
      for (let mask = 0; mask < 16; mask++) {
        const rng = new Rng(`tile:${tile.id}:${variant}`);
        put(tileFrame(layout, id, mask, variant), paintTile(tile.art, tile.solid, mask, rng));
      }
    }
  });
  tiles.walls.forEach((wall, id) => {
    if (id === NO_WALL) return;
    for (let variant = 0; variant < VARIANTS; variant++) {
      put(wallFrame(layout, id, variant), paintWall(wall.art, new Rng(`wall:${wall.id}:${variant}`)));
    }
  });
  tiles.liquids.forEach((liquid, index) => {
    for (let variant = 0; variant < VARIANTS; variant++) {
      for (const surface of [false, true]) {
        put(liquidFrame(layout, index + 1, surface, variant), paintLiquid(liquid, surface, new Rng(`liquid:${liquid.id}:${variant}`)));
      }
    }
  });
  ctx.putImageData(image, 0, 0);
}

/** Copy a 16 x 16 frame into the atlas and extend its outermost pixels one step outwards. */
function blitExtruded(image: ImageData, at: { x: number; y: number }, pixels: Pixels): void {
  const { data, width } = image;
  const copy = (sx: number, sy: number, dx: number, dy: number): void => {
    const s = (sy * FRAME + sx) * 4;
    const d = (dy * width + dx) * 4;
    data[d] = pixels.data[s]!;
    data[d + 1] = pixels.data[s + 1]!;
    data[d + 2] = pixels.data[s + 2]!;
    data[d + 3] = pixels.data[s + 3]!;
  };
  for (let y = -1; y <= FRAME; y++) {
    for (let x = -1; x <= FRAME; x++) {
      const sx = Math.min(FRAME - 1, Math.max(0, x));
      const sy = Math.min(FRAME - 1, Math.max(0, y));
      copy(sx, sy, at.x + x, at.y + y);
    }
  }
}
