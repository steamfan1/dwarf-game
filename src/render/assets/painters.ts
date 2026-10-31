/**
 * Placeholder art, drawn at runtime onto canvases (see manifest.ts).
 *
 * Every painter is deterministic: randomness comes from the seeded Rng it is handed,
 * so the art looks identical on every machine and every reload. Painters only use the
 * Canvas 2D API, not Phaser, so they can be previewed or tested outside the game.
 * All art here is original to this project.
 */
import type { Rng } from '../../core/Rng';
import { drawPixelRows, mixColor, plot, type Palette } from './pixelArt';

// ---- Dwarf --------------------------------------------------------------------------

export const DWARF_FRAME_SIZE = 16;
/** Frame 0 is standing; frames 1-4 are the walk cycle. */
export const DWARF_FRAME_COUNT = 5;

export const DWARF_PALETTE: Palette = {
  k: '#1d1714', // outline
  h: '#8b95a5', // helmet
  H: '#cfd6df', // helmet highlight
  d: '#5f6878', // helmet shade
  s: '#eab38a', // skin
  S: '#c98d68', // nose and skin shade
  e: '#24170f', // eye
  b: '#dd8c3c', // beard
  B: '#a9622a', // beard shade
  w: '#f4bf78', // beard highlight
  t: '#4f8040', // tunic
  T: '#365c2c', // tunic shade
  l: '#5c3b23', // belt
  g: '#efc94c', // buckle
  p: '#4b3d34', // trousers
  P: '#362b25', // far leg
  o: '#2c231e', // boots
};

/** Helmet, face, beard and body (rows 0-13), facing right. */
const DWARF_UPPER = [
  '................',
  '................',
  '......kkkk......',
  '.....kHHhhk.....',
  '....kHhhhhhk....',
  '...khhhhhhhhk...',
  '...kddddddddkk..',
  '....kssssesSk...',
  '....ksssssSSSk..',
  '...ktwbbbbbbk...',
  '..ktTbbbwbbbBk..',
  '..kttbbbbbbBsk..',
  '..kTTkbbbbBkTk..',
  '..kllllgllllk...',
];

/** Short dwarf legs (rows 14-15) for each frame. */
const DWARF_LEGS: readonly (readonly string[])[] = [
  // 0: standing
  ['...kppk.kppk....', '...kook.koook...'],
  // 1: stride, far leg back
  ['..kPPk..kppk....', '.kook....koook..'],
  // 2: passing
  ['....kppppk......', '....koooook.....'],
  // 3: stride, near leg back
  ['..kppk..kPPk....', '.kook....koook..'],
  // 4: passing
  ['....kPPppk......', '....koooook.....'],
];

export function dwarfFrameRows(frame: number): string[] {
  const legs = DWARF_LEGS[frame];
  if (!legs) throw new Error(`No dwarf frame ${frame}`);
  return [...DWARF_UPPER, ...legs];
}

/** A strip of dwarf frames, 16x16 each, left to right. */
export function paintDwarfSheet(ctx: CanvasRenderingContext2D): void {
  for (let frame = 0; frame < DWARF_FRAME_COUNT; frame++) {
    drawPixelRows(ctx, dwarfFrameRows(frame), DWARF_PALETTE, frame * DWARF_FRAME_SIZE, 0);
  }
}

// ---- Ground tiles (Milestone 0 backdrop; the real tile atlas arrives in Milestone 1) --

const DIRT = { base: '#6b4a32', dark: '#563a27', light: '#80593c', pebble: '#8d8174', pebbleDark: '#5f564d' };
const GRASS = { base: '#5a9a3c', light: '#80bd52', dark: '#3d7429', tip: '#9fd36a' };

/**
 * Ground strips are 64 px wide (four tiles' worth of distinct noise), so a repeating
 * TileSprite shows its pattern only every 64 px instead of every 16.
 */
export const GROUND_STRIP_WIDTH = 64;

function paintDirt(ctx: CanvasRenderingContext2D, rng: Rng, width: number, fromRow: number): void {
  for (let y = fromRow; y < 16; y++) {
    for (let x = 0; x < width; x++) {
      const r = rng.next();
      plot(ctx, x, y, r < 0.12 ? DIRT.dark : r < 0.2 ? DIRT.light : DIRT.base);
    }
  }
  // A few small pebbles.
  for (let i = 0; i < width / 16; i++) {
    const px = rng.int(1, width - 3);
    const py = rng.int(Math.max(fromRow + 1, 2), 13);
    plot(ctx, px, py, DIRT.pebble);
    plot(ctx, px + 1, py, DIRT.pebble);
    plot(ctx, px, py + 1, DIRT.pebbleDark);
    plot(ctx, px + 1, py + 1, DIRT.pebbleDark);
  }
}

export function paintDirtStrip(ctx: CanvasRenderingContext2D, rng: Rng): void {
  paintDirt(ctx, rng, GROUND_STRIP_WIDTH, 0);
}

export function paintGrassStrip(ctx: CanvasRenderingContext2D, rng: Rng): void {
  paintDirt(ctx, rng, GROUND_STRIP_WIDTH, 3);
  for (let x = 0; x < GROUND_STRIP_WIDTH; x++) {
    // Each column of turf hangs a little lower or higher, and some blades poke up.
    const depth = 4 + rng.int(0, 2);
    for (let y = 1; y < depth; y++) {
      const shade = y === 1 ? GRASS.light : y >= depth - 1 ? GRASS.dark : GRASS.base;
      plot(ctx, x, y, shade);
    }
    if (rng.chance(0.4)) plot(ctx, x, 0, GRASS.tip);
  }
}

// ---- Title screen backdrop ------------------------------------------------------------

const SKY_BANDS = [
  '#0d1222', '#121a30', '#18223d', '#20294a', '#2b2f55', '#3b345b',
  '#4d3a5d', '#62405c', '#7a4859', '#955253', '#b0604c', '#c97446',
];
export const SKY_BAND_HEIGHT = 15;

/** A dusk gradient in dithered bands, 8 px wide; stretched across the screen. */
export function paintSky(ctx: CanvasRenderingContext2D): void {
  SKY_BANDS.forEach((color, band) => {
    const top = band * SKY_BAND_HEIGHT;
    ctx.fillStyle = color;
    ctx.fillRect(0, top, 8, SKY_BAND_HEIGHT);
    const next = SKY_BANDS[band + 1];
    if (!next) return;
    // Checkerboard dither on the last two rows of each band.
    for (let y = top + SKY_BAND_HEIGHT - 2; y < top + SKY_BAND_HEIGHT; y++) {
      for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) plot(ctx, x, y, next);
    }
  });
}

export function paintStars(ctx: CanvasRenderingContext2D, rng: Rng, width: number, height: number): void {
  for (let i = 0; i < 46; i++) {
    const x = rng.int(0, width - 1);
    const y = rng.int(0, height - 1);
    const warm = rng.chance(0.3);
    const color = warm ? '#ffe7b0' : '#dfe7ff';
    ctx.globalAlpha = rng.range(0.35, 1);
    plot(ctx, x, y, color);
    if (rng.chance(0.12)) {
      // A brighter star with a small cross.
      plot(ctx, x - 1, y, color);
      plot(ctx, x + 1, y, color);
      plot(ctx, x, y - 1, color);
      plot(ctx, x, y + 1, color);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Height profile that wraps around horizontally (the last column meets the first), so
 * the strip can repeat seamlessly in a TileSprite. Values are whole pixels.
 */
export function periodicRidge(rng: Rng, width: number, min: number, max: number, points: number): number[] {
  const coarse = Array.from({ length: points }, () => rng.next());
  const fine = Array.from({ length: points * 4 }, () => rng.next());
  const sample = (values: number[], x: number): number => {
    const f = (x / width) * values.length;
    const i = Math.floor(f);
    const t = f - i;
    const a = values[i % values.length]!;
    const b = values[(i + 1) % values.length]!;
    const smooth = (1 - Math.cos(t * Math.PI)) / 2;
    return a + (b - a) * smooth;
  };
  return Array.from({ length: width }, (_, x) => {
    const v = sample(coarse, x) * 0.8 + sample(fine, x) * 0.2;
    return Math.round(min + v * (max - min));
  });
}

export function paintHills(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  width: number,
  height: number,
  colors: { body: string; rim: string },
  minHeight: number,
  maxHeight: number,
  withTrees: boolean,
): void {
  const ridge = periodicRidge(rng, width, minHeight, maxHeight, 6);
  for (let x = 0; x < width; x++) {
    const top = height - ridge[x]!;
    ctx.fillStyle = colors.body;
    ctx.fillRect(x, top, 1, height - top);
    plot(ctx, x, top, colors.rim);
  }
  if (!withTrees) return;
  // Stepped pine silhouettes along the ridge.
  for (let i = 0; i < 14; i++) {
    const cx = rng.int(4, width - 5);
    const base = height - ridge[cx]! + 1;
    const tall = rng.int(7, 13);
    for (let dy = 0; dy < tall; dy++) {
      const half = Math.floor(((tall - dy) / tall) * 4);
      ctx.fillStyle = colors.body;
      ctx.fillRect(cx - half, base - dy, half * 2 + 1, 1);
    }
    plot(ctx, cx, base - tall, colors.rim);
  }
}

// ---- Title gate -------------------------------------------------------------------------

export const GATE_WIDTH = 48;
export const GATE_HEIGHT = 64;
const GATE_CENTER_X = 24;
const GATE_ARCH_Y = 27;
const GATE_INNER_RADIUS = 11;
const GATE_OUTER_RADIUS = 20;
const STONE = { base: '#6d7180', dark: '#4a4d59', light: '#8f94a1', key: '#a6abb8' };

/** True for pixels inside the gate's opening (where the portal glows). */
function insideOpening(x: number, y: number): boolean {
  const dx = x + 0.5 - GATE_CENTER_X;
  if (y >= GATE_ARCH_Y) return Math.abs(dx) < GATE_INNER_RADIUS;
  const dy = y + 0.5 - GATE_ARCH_Y;
  return dx * dx + dy * dy < GATE_INNER_RADIUS * GATE_INNER_RADIUS;
}

function insideStone(x: number, y: number): boolean {
  const dx = x + 0.5 - GATE_CENTER_X;
  if (insideOpening(x, y)) return false;
  if (y >= GATE_ARCH_Y) return Math.abs(dx) < GATE_OUTER_RADIUS;
  const dy = y + 0.5 - GATE_ARCH_Y;
  return dx * dx + dy * dy < GATE_OUTER_RADIUS * GATE_OUTER_RADIUS;
}

/** A stone arch with an empty opening; the glow is a separate texture so it can pulse. */
export function paintGate(ctx: CanvasRenderingContext2D, rng: Rng): void {
  for (let y = 0; y < GATE_HEIGHT; y++) {
    for (let x = 0; x < GATE_WIDTH; x++) {
      if (!insideStone(x, y)) continue;
      // Courses of stone blocks: horizontal mortar every 6 rows, staggered vertical joints.
      const course = Math.floor(y / 6);
      const mortarRow = y % 6 === 5;
      const mortarCol = (x + (course % 2) * 4) % 8 === 7;
      let color = mortarRow || mortarCol ? STONE.dark : STONE.base;
      if (!mortarRow && !mortarCol && (y % 6 === 0 || (x + (course % 2) * 4) % 8 === 0)) color = STONE.light;
      if (color === STONE.base && rng.chance(0.08)) color = mixColor(STONE.base, STONE.dark, 0.5);
      plot(ctx, x, y, color);
    }
  }
  // Keystone at the top of the arch.
  ctx.fillStyle = STONE.key;
  ctx.fillRect(GATE_CENTER_X - 3, GATE_ARCH_Y - GATE_OUTER_RADIUS + 1, 6, 7);
  ctx.fillStyle = STONE.dark;
  ctx.fillRect(GATE_CENTER_X - 3, GATE_ARCH_Y - GATE_OUTER_RADIUS + 8, 6, 1);
  // Threshold step.
  ctx.fillStyle = STONE.dark;
  ctx.fillRect(GATE_CENTER_X - GATE_OUTER_RADIUS - 2, GATE_HEIGHT - 3, GATE_OUTER_RADIUS * 2 + 4, 3);
  ctx.fillStyle = STONE.light;
  ctx.fillRect(GATE_CENTER_X - GATE_OUTER_RADIUS - 2, GATE_HEIGHT - 3, GATE_OUTER_RADIUS * 2 + 4, 1);
}

const GLOW_BANDS = ['#ffe8a8', '#ffd27a', '#f8b04f', '#ec8a3a', '#c9612a'];

/** The light inside the gate's opening, in concentric bands (brightest low in the middle). */
export function paintGateGlow(ctx: CanvasRenderingContext2D): void {
  const cx = GATE_CENTER_X;
  const cy = GATE_HEIGHT - 18;
  for (let y = 0; y < GATE_HEIGHT - 3; y++) {
    for (let x = 0; x < GATE_WIDTH; x++) {
      if (!insideOpening(x, y)) continue;
      const dx = (x + 0.5 - cx) / GATE_INNER_RADIUS;
      const dy = (y + 0.5 - cy) / 26;
      const d = Math.sqrt(dx * dx + dy * dy);
      const band = Math.min(GLOW_BANDS.length - 1, Math.floor(d * GLOW_BANDS.length * 0.95));
      plot(ctx, x, y, GLOW_BANDS[band]!);
    }
  }
}
