/**
 * Paints placeholder tile art from the descriptions in tiles.json.
 *
 * Every frame is 16 x 16 pixels, painted into a small RGBA buffer and then copied into
 * the atlas. Solid blocks get an "exposure mask" (which sides touch open space): those
 * sides get a dark outline, the top a highlight, and fully exposed corners are rounded
 * off, so terrain reads clearly without hand-drawn edge tiles. Grass and snow caps only
 * appear on a block's top when its top is exposed.
 *
 * Pure: needs only the Canvas 2D API, so it can be previewed and tested outside Phaser.
 */
import type { Rng } from '../../core/Rng';
import type { LiquidDef, TileArt } from '../../sim/world/TileRegistry';

export const FRAME = 16;

/** Exposure mask bits: the neighbour on that side is not joined to this tile. */
export const EXPOSED_TOP = 1;
export const EXPOSED_RIGHT = 2;
export const EXPOSED_BOTTOM = 4;
export const EXPOSED_LEFT = 8;

type RGB = [number, number, number];

/** A 16 x 16 RGBA pixel buffer. */
export class Pixels {
  readonly data = new Uint8ClampedArray(FRAME * FRAME * 4);

  set(x: number, y: number, [r, g, b]: RGB, alpha = 255): void {
    if (x < 0 || y < 0 || x >= FRAME || y >= FRAME) return;
    const i = (y * FRAME + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = alpha;
  }

  get(x: number, y: number): RGB {
    const i = (y * FRAME + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!];
  }

  alpha(x: number, y: number): number {
    return this.data[(y * FRAME + x) * 4 + 3]!;
  }

  clear(x: number, y: number): void {
    this.data[(y * FRAME + x) * 4 + 3] = 0;
  }

  /** Multiply the colour of every opaque pixel (used to darken walls). */
  shade(factor: number, tint: RGB = [1, 1, 1]): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = this.data[i]! * factor * tint[0];
      this.data[i + 1] = this.data[i + 1]! * factor * tint[1];
      this.data[i + 2] = this.data[i + 2]! * factor * tint[2];
    }
  }
}

export function rgb(hex: string): RGB {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

// ---- Block styles --------------------------------------------------------------------------

/** Speckled earth: dirt, clay, sand, snow. */
function paintSoil(p: Pixels, art: TileArt, rng: Rng): void {
  const base = rgb(art.base!);
  const dark = rgb(art.dark!);
  const light = rgb(art.light!);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const r = rng.next();
      p.set(x, y, r < 0.13 ? dark : r < 0.22 ? light : base);
    }
  }
  if (art.pebble) {
    const pebble = rgb(art.pebble);
    for (let n = 0; n < 2; n++) {
      const x = rng.int(1, 13);
      const y = rng.int(2, 13);
      p.set(x, y, pebble);
      p.set(x + 1, y, pebble);
      p.set(x, y + 1, scale(pebble, 0.75));
      p.set(x + 1, y + 1, scale(pebble, 0.75));
    }
  }
}

/** Cobbled rock: Voronoi cells with dark cracks between them and lit upper-left rims. */
function paintRock(p: Pixels, art: TileArt, rng: Rng): void {
  const base = rgb(art.base!);
  const dark = rgb(art.dark!);
  const light = rgb(art.light!);
  const seeds = Array.from({ length: 6 }, () => ({ x: rng.range(0, FRAME), y: rng.range(0, FRAME), tone: rng.range(-0.25, 0.3) }));
  const cellAt = (x: number, y: number): { cell: number; edge: number } => {
    let best = Infinity;
    let second = Infinity;
    let cell = 0;
    seeds.forEach((s, i) => {
      // Wrap-around distance, so neighbouring tiles of the same variant meet seamlessly.
      const dx = Math.min(Math.abs(x + 0.5 - s.x), FRAME - Math.abs(x + 0.5 - s.x));
      const dy = Math.min(Math.abs(y + 0.5 - s.y), FRAME - Math.abs(y + 0.5 - s.y));
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) {
        second = best;
        best = d;
        cell = i;
      } else if (d < second) second = d;
    });
    return { cell, edge: second - best };
  };
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const { cell, edge } = cellAt(x, y);
      if (edge < 0.9) {
        p.set(x, y, dark);
        continue;
      }
      const tone = seeds[cell]!.tone;
      let color = tone > 0 ? mix(base, light, tone) : mix(base, dark, -tone);
      // Rim light where the cell above or to the left is a different stone.
      const above = cellAt(x, (y + FRAME - 1) % FRAME).cell;
      const left = cellAt((x + FRAME - 1) % FRAME, y).cell;
      if (above !== cell || left !== cell) color = mix(color, light, 0.45);
      if (rng.chance(0.06)) color = mix(color, dark, 0.35);
      p.set(x, y, color);
    }
  }
}

/**
 * Ore nuggets: chunky clusters with a lit corner and a shadowed underside, one per
 * quarter of the tile (one quarter left bare), so ore reads clearly at any zoom.
 */
function paintOre(p: Pixels, art: TileArt, rng: Rng): void {
  paintRock(p, art, rng);
  const ore = art.ore!;
  const main = rgb(ore.main);
  const light = rgb(ore.light);
  const shadow = rgb(ore.shadow);
  const quarters: Array<[number, number]> = rng.shuffle([
    [0, 0],
    [8, 0],
    [0, 8],
    [8, 8],
  ]);
  for (const [qx, qy] of quarters.slice(0, 3)) {
    const w = rng.int(2, 3);
    const h = rng.int(2, 3);
    const x = qx + rng.int(1, 6 - w);
    const y = qy + rng.int(1, 6 - h);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const corner = (dx === 0 || dx === w - 1) && (dy === 0 || dy === h - 1);
        if (corner && w * h > 4 && rng.chance(0.5)) continue;
        p.set(x + dx, y + dy, main);
      }
    }
    p.set(x, y, light);
    if (w > 2) p.set(x + 1, y, light);
    for (let dx = 0; dx < w; dx++) p.set(x + dx, y + h, shadow);
    p.set(x + w, y + h - 1, shadow);
  }
}

/** Crystal shards: thin angled prisms with a bright edge, in two colours. */
function paintCrystal(p: Pixels, art: TileArt, rng: Rng): void {
  paintRock(p, art, rng);
  const ore = art.ore!;
  const colors = [rgb(ore.main), rgb(ore.accent ?? ore.main)];
  const count = rng.int(2, 3);
  for (let n = 0; n < count; n++) {
    const color = colors[n % colors.length]!;
    const x = rng.int(3, 11);
    const y = rng.int(4, 12);
    const height = rng.int(3, 5);
    const lean = rng.chance(0.5) ? 1 : -1;
    for (let k = 0; k < height; k++) {
      const cx = x + Math.floor((k * lean) / 2);
      p.set(cx, y - k, color);
      p.set(cx + 1, y - k, scale(color, 0.7));
    }
    p.set(x + Math.floor(((height - 1) * lean) / 2), y - height + 1, rgb(ore.light));
    p.set(x, y + 1, rgb(ore.shadow));
  }
}

/** Ice: pale blue with diagonal light streaks. */
function paintIce(p: Pixels, art: TileArt, rng: Rng): void {
  const base = rgb(art.base!);
  const dark = rgb(art.dark!);
  const light = rgb(art.light!);
  const offset = rng.int(0, 15);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const diagonal = (x + y + offset) % 9;
      let color = diagonal === 0 ? light : diagonal === 1 ? mix(base, light, 0.5) : base;
      if (rng.chance(0.05)) color = dark;
      p.set(x, y, color);
    }
  }
}

/** Tree trunk: a bark column narrower than the tile, transparent either side. */
function paintLog(p: Pixels, art: TileArt, rng: Rng, mask: number): void {
  const base = rgb(art.base!);
  const dark = rgb(art.dark!);
  const light = rgb(art.light!);
  const outline: RGB = scale(dark, 0.7);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 4; x <= 11; x++) {
      let color = x === 4 || x === 11 ? outline : (x + Math.floor(y / 3)) % 4 === 0 ? dark : x === 6 ? light : base;
      if (rng.chance(0.06)) color = dark;
      p.set(x, y, color);
    }
  }
  // A knot now and then.
  if (rng.chance(0.5)) {
    const y = rng.int(3, 12);
    p.set(7, y, dark);
    p.set(8, y, outline);
    p.set(8, y - 1, dark);
  }
  // Roots flare out where the trunk meets the ground.
  if (mask & EXPOSED_BOTTOM) {
    for (const x of [2, 3, 12, 13]) p.set(x, FRAME - 1, outline);
    for (const x of [3, 12]) p.set(x, FRAME - 2, outline);
  }
}

/** Foliage: a dense mass of leaves with ragged, see-through edges where it meets open air. */
function paintLeaves(p: Pixels, art: TileArt, rng: Rng, mask: number): void {
  const base = rgb(art.base!);
  const dark = rgb(art.dark!);
  const light = rgb(art.light!);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const r = rng.next();
      p.set(x, y, r < 0.28 ? dark : r < 0.42 ? light : base);
    }
  }
  // Leaf clusters: lit top-left, shaded bottom-right.
  for (let n = 0; n < 5; n++) {
    const x = rng.int(1, 13);
    const y = rng.int(1, 13);
    p.set(x, y, light);
    p.set(x + 1, y, light);
    p.set(x + 1, y + 1, dark);
    p.set(x + 2, y + 1, dark);
  }
  // Ragged edges facing open air: the outermost pixels thin out, the next row barely.
  const ragged = (x: number, y: number, depth: number): void => {
    if (rng.chance(depth === 0 ? 0.55 : 0.12)) p.clear(x, y);
  };
  for (let i = 0; i < FRAME; i++) {
    for (let d = 0; d < 2; d++) {
      if (mask & EXPOSED_TOP) ragged(i, d, d);
      if (mask & EXPOSED_BOTTOM) ragged(i, FRAME - 1 - d, d);
      if (mask & EXPOSED_LEFT) ragged(d, i, d);
      if (mask & EXPOSED_RIGHT) ragged(FRAME - 1 - d, i, d);
    }
  }
  if (art.snow && mask & EXPOSED_TOP) {
    const snow = rgb(art.snow);
    for (let x = 0; x < FRAME; x++) {
      for (let y = 0; y < 4; y++) {
        if (p.alpha(x, y) > 0) {
          p.set(x, y, snow);
          if (rng.chance(0.5)) p.set(x, y + 1, mix(snow, base, 0.4));
          break;
        }
      }
    }
  }
}

/** Sawn boards: four planks with seams, staggered joints, grain and a nail or two. */
function paintPlanks(p: Pixels, art: TileArt, rng: Rng): void {
  const base = rgb(art.base!);
  const dark = rgb(art.dark!);
  const light = rgb(art.light!);
  for (let board = 0; board < 4; board++) {
    const top = board * 4;
    const tone = rng.range(-0.12, 0.12);
    const boardColor = tone > 0 ? mix(base, light, tone) : mix(base, dark, -tone);
    const joint = (board * 7 + rng.int(2, 13)) % FRAME;
    for (let y = top; y < top + 4; y++) {
      for (let x = 0; x < FRAME; x++) {
        let color = boardColor;
        if (y === top + 3) color = dark; // seam under each board
        else if (y === top) color = mix(boardColor, light, 0.35);
        else if (rng.chance(0.1)) color = mix(boardColor, dark, 0.4); // grain
        if (x === joint && y !== top + 3) color = dark;
        p.set(x, y, color);
      }
    }
    if (rng.chance(0.6)) p.set((joint + 2) % FRAME, top + 1, mix(light, [255, 255, 255], 0.3));
  }
}

/** Brickwork: three-pixel courses of bricks in light mortar, each course offset by half a brick. */
function paintBricks(p: Pixels, art: TileArt, rng: Rng): void {
  const base = rgb(art.base!);
  const dark = rgb(art.dark!);
  const mortar = rgb(art.light!);
  for (let y = 0; y < FRAME; y++) {
    const course = Math.floor(y / 4);
    const inCourse = y % 4;
    for (let x = 0; x < FRAME; x++) {
      if (inCourse === 3 || (x + (course % 2) * 4) % 8 === 7) {
        p.set(x, y, mortar);
        continue;
      }
      let color = inCourse === 0 ? mix(base, mortar, 0.18) : inCourse === 2 ? mix(base, dark, 0.3) : base;
      if (rng.chance(0.08)) color = mix(color, dark, 0.35);
      p.set(x, y, color);
    }
  }
}

/** Glass: a pale see-through fill with a couple of bright streaks. Edges come from paintEdges. */
function paintGlass(p: Pixels, art: TileArt, rng: Rng): void {
  const base = rgb(art.base!);
  const light = rgb(art.light!);
  const streak = rng.int(0, 5);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const diagonal = (x + y + streak) % 11;
      if (diagonal === 0 || diagonal === 1) p.set(x, y, light, 150);
      else p.set(x, y, base, 70);
    }
  }
}

/** A sprite drawn from palette rows, bottom-aligned (grass tufts, flowers, mushrooms). */
function paintSprite(p: Pixels, art: TileArt): void {
  const rows = art.rows ?? [];
  const top = FRAME - rows.length;
  rows.forEach((row, dy) => {
    for (let x = 0; x < FRAME; x++) {
      const color = art.palette?.[row[x]!];
      if (color) p.set(x, top + dy, rgb(color));
    }
  });
}

/** Grass or snow along the top edge, hanging a little way down with a ragged lower edge. */
function paintCap(p: Pixels, art: TileArt, rng: Rng): void {
  const cap = art.cap!;
  const base = rgb(cap.base);
  const light = rgb(cap.light);
  const dark = rgb(cap.dark);
  for (let x = 0; x < FRAME; x++) {
    const depth = 3 + rng.int(0, 2);
    for (let y = 0; y < depth; y++) p.set(x, y, y === 0 ? light : y === depth - 1 ? dark : base);
    if (cap.tip && rng.chance(0.35)) p.set(x, 0, rgb(cap.tip));
  }
}

/** Dark outline on exposed sides, a highlight just inside an exposed top, rounded outer corners. */
function paintEdges(p: Pixels, art: TileArt, mask: number): void {
  const outline = scale(rgb(art.dark!), 0.62);
  const highlight = rgb(art.cap ? art.cap.light : art.light!);
  if (mask & EXPOSED_TOP) {
    for (let x = 0; x < FRAME; x++) {
      p.set(x, 1, mix(p.get(x, 1), highlight, art.cap ? 0 : 0.5));
      p.set(x, 0, art.cap ? p.get(x, 0) : outline);
    }
  }
  if (mask & EXPOSED_BOTTOM) for (let x = 0; x < FRAME; x++) p.set(x, FRAME - 1, outline);
  if (mask & EXPOSED_LEFT) for (let y = 0; y < FRAME; y++) p.set(0, y, mix(p.get(0, y), outline, 0.85));
  if (mask & EXPOSED_RIGHT) for (let y = 0; y < FRAME; y++) p.set(FRAME - 1, y, mix(p.get(FRAME - 1, y), outline, 0.85));

  const corner = (cx: number, cy: number): void => {
    p.clear(cx, cy);
    const ix = cx === 0 ? 1 : FRAME - 2;
    const iy = cy === 0 ? 1 : FRAME - 2;
    p.set(ix, cy, outline);
    p.set(cx, iy, outline);
  };
  if ((mask & EXPOSED_TOP) && (mask & EXPOSED_LEFT)) corner(0, 0);
  if ((mask & EXPOSED_TOP) && (mask & EXPOSED_RIGHT)) corner(FRAME - 1, 0);
  if ((mask & EXPOSED_BOTTOM) && (mask & EXPOSED_LEFT)) corner(0, FRAME - 1);
  if ((mask & EXPOSED_BOTTOM) && (mask & EXPOSED_RIGHT)) corner(FRAME - 1, FRAME - 1);
}

// ---- Public painters ---------------------------------------------------------------------

/** A foreground tile frame for the given exposure mask. */
export function paintTile(art: TileArt, solid: boolean, mask: number, rng: Rng): Pixels {
  const p = new Pixels();
  switch (art.style) {
    case 'soil':
      paintSoil(p, art, rng);
      break;
    case 'rock':
      paintRock(p, art, rng);
      break;
    case 'ore':
      paintOre(p, art, rng);
      break;
    case 'crystal':
      paintCrystal(p, art, rng);
      break;
    case 'ice':
      paintIce(p, art, rng);
      break;
    case 'log':
      paintLog(p, art, rng, mask);
      return p;
    case 'leaves':
      paintLeaves(p, art, rng, mask);
      return p;
    case 'planks':
      paintPlanks(p, art, rng);
      break;
    case 'bricks':
      paintBricks(p, art, rng);
      break;
    case 'glass':
      paintGlass(p, art, rng);
      break;
    case 'sprite':
      paintSprite(p, art);
      return p;
    case 'none':
      return p;
  }
  if (art.cap && mask & EXPOSED_TOP) paintCap(p, art, rng);
  if (solid) paintEdges(p, art, mask);
  return p;
}

/** A background wall frame: the material's texture, darkened and cooled so it reads as "behind". */
export function paintWall(art: TileArt, rng: Rng): Pixels {
  const p = paintTile({ ...art, cap: undefined }, false, 0, rng);
  p.shade(0.46, [0.95, 0.97, 1.08]);
  return p;
}

/** Liquid frames: translucent water or glowing lava; the surface frame has a bright skin on top. */
export function paintLiquid(liquid: LiquidDef, surface: boolean, rng: Rng): Pixels {
  const p = new Pixels();
  const base = rgb(liquid.art.base);
  const light = rgb(liquid.art.light);
  const dark = rgb(liquid.art.dark);
  const alpha = Math.round(liquid.art.alpha * 255);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      let color = base;
      const wave = (x + y * 3 + rng.int(0, 1)) % 11;
      if (wave === 0) color = mix(base, light, 0.45);
      else if (rng.chance(0.08)) color = mix(base, dark, 0.5);
      p.set(x, y, color, alpha);
    }
  }
  if (surface) {
    for (let x = 0; x < FRAME; x++) {
      p.set(x, 0, light, Math.min(255, alpha + 40));
      if ((x + rng.int(0, 2)) % 5 === 0) p.set(x, 1, light, alpha);
    }
  }
  return p;
}
