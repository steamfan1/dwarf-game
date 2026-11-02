/**
 * Placeholder art for creatures, and for what fighting looks like: missiles, puffs of
 * smoke and sparks, the invasion portal, and the marks on hunted animals and fallen
 * dwarves.
 *
 * Creatures are drawn from rows of palette characters, like the dwarves, in the colours
 * creatures.json gives them: k outline, d dark, b base, l light, a accent (eyes, teeth,
 * moss), w white, e near-black. Each sheet has CREATURE_FRAMES frames of 16 x 16, facing
 * right: standing, two steps of a walk, and a strike.
 *
 * Original art, drawn with the Canvas 2D API only.
 */
import type { CreatureArt, CreatureStyle } from '../../sim/creatures/CreatureRegistry';
import { drawPixelRows, mixColor, plot, type Palette } from './pixelArt';

export const CREATURE_FRAME_SIZE = 16;
/** Frames in a creature sheet. */
export const CREATURE_FRAMES = { stand: 0, walk: [1, 2], strike: 3, count: 4 } as const;

interface CreatureSprite {
  /** Rows 0-13: everything above the legs. */
  body: readonly string[];
  /** Rows 14-15 for standing and the two steps of the walk. */
  legs: readonly (readonly [string, string])[];
  /** Body rows replaced in the strike frame. */
  strike: Readonly<Record<number, string>>;
}

export const CREATURE_SPRITES: Record<CreatureStyle, CreatureSprite> = {
  gloomling: {
    body: [
      '................',
      '................',
      '................',
      '................',
      '....k....k......',
      '...kdk..kdk.....',
      '...kbbkkbbbk....',
      '..kbbbbbbbbbk...',
      '..kbbbbbwabwak..',
      '..kbbbbbaabaak..',
      '..kblbbbbbbbbk..',
      '.kbllbbbbbbbbdk.',
      '.kbbbbbbbbbbbdk.',
      '..kdbbbbbbbbdk..',
    ],
    legs: [
      ['...kdk....kdk...', '...kkk....kkk...'],
      ['..kdk......kdk..', '..kkk......kkk..'],
      ['....kdk..kdk....', '....kkk..kkk....'],
    ],
    strike: { 10: '..kblbbbbbbbbbkk', 11: '.kbllbbbbbbbbdlk', 12: '.kbbbbbbbbbbbdkd' },
  },
  cragskitter: {
    body: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.......kkkk.....',
      '......kbbbbk....',
      '.....kbllbbbk...',
      '....kbbbbbbakk..',
      '...kdbbbbbbbbak.',
      '..k.kddbbbbdkk..',
      '.k.k.kkdddkk.k..',
    ],
    legs: [
      ['k..k.k...k..k.k.', 'k.k..k...k...k.k'],
      ['.k.k..k.k..k.k..', 'k..k..k.k..k..k.'],
      ['k..k..k..k.k..k.', '.k..k..k..k..k..'],
    ],
    strike: { 10: '....kbbbbbbakkk.', 11: '...kdbbbbbbbbakk', 12: '..k.kddbbbbdkkk.' },
  },
  burrowmaw: {
    body: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '......kkkkk.....',
      '....kkbbbbbkk...',
      '..kkbbllbbbbbk..',
      '.kbbbllbbbbbkkk.',
      'kbdbbbbbbbbkaaak',
      'kbdbbdbbbdbkeeek',
      'kbddbddbddbkaaak',
    ],
    legs: [
      ['.kddddddddddkkk.', '..kkkkkkkkkkkk..'],
      ['.kdddddddddddkk.', '..kkkkkkkkkkkk..'],
      ['..kddddddddddkk.', '..kkkkkkkkkkkk..'],
    ],
    strike: { 10: '.kbbbllbbbbbkkkk', 11: 'kbdbbbbbbbbkaa.a', 12: 'kbdbbdbbbdbkeee.', 13: 'kbddbddbddbkaa.a' },
  },
  bilespitter: {
    body: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.....kk..kk.....',
      '....kawkkawk....',
      '...kbbbbbbbbk...',
      '..kbbblbbbbbbk..',
      '..kblbbbbblbbbk.',
      '.kbbbbbbbbbbbbk.',
      '.kbbbkkkkkkkkbk.',
      '.kbaaaaaaaaaabk.',
      '..kbaaaaaaaabk..',
    ],
    legs: [
      ['..kdk..kdk..kdk.', '.kkkk.kkkk.kkkk.'],
      ['.kdk..kdk..kdk..', 'kkkk.kkkk.kkkk..'],
      ['...kdk..kdk.kdk.', '..kkkk.kkkkkkkk.'],
    ],
    strike: { 11: '.kbbbkeeeeeeekk.', 12: '.kbaaakeeeeekkk.' },
  },
  mossback: {
    body: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '...aaaaaa.......',
      '..aalaaaaa......',
      '.kaaaaaaaaakk...',
      'kbbbbbbbbbbbbk..',
      'kbblbbbbbbbbbbk.',
      'kbbbbbbbbbbbebbk',
      'kdbbbbbbbbbbbblk',
      '.kddddddddddddk.',
    ],
    legs: [
      ['.kdk..kdk.kdk...', '.kkk..kkk.kkk...'],
      ['kdk..kdk..kdk...', 'kkk..kkk..kkk...'],
      ['..kdk..kdkkdk...', '..kkk..kkkkkk...'],
    ],
    strike: {},
  },
  woolhorn: {
    body: [
      '................',
      '................',
      '................',
      '................',
      '...........aa...',
      '..........a.ak..',
      '..........kbbk..',
      '..kkkkkkkkbbebk.',
      '.kllllllllbbbbk.',
      'kllwllllllkbbk..',
      'kllllwlllllk....',
      'klllllllllllk...',
      '.kllllllllllk...',
      '.kddk....kddk...',
    ],
    legs: [
      ['.kdk.....kdk....', '.kkk.....kkk....'],
      ['kdk.....kdk.....', 'kkk.....kkk.....'],
      ['..kdk.....kdk...', '..kkk.....kkk...'],
    ],
    strike: {},
  },
};

export function creaturePalette(art: CreatureArt): Palette {
  return {
    k: mixColor(art.dark, '#000000', 0.55),
    d: art.dark,
    b: art.base,
    l: art.light,
    a: art.accent,
    w: '#ffffff',
    e: '#1b1220',
  };
}

/** The rows of one frame of a creature sheet. */
export function creatureFrameRows(style: CreatureStyle, frame: number): string[] {
  const sprite = CREATURE_SPRITES[style];
  const body = [...sprite.body];
  if (frame === CREATURE_FRAMES.strike) for (const [row, line] of Object.entries(sprite.strike)) body[Number(row)] = line;
  const legs = sprite.legs[frame === CREATURE_FRAMES.walk[0] ? 1 : frame === CREATURE_FRAMES.walk[1] ? 2 : 0]!;
  return [...body, ...legs];
}

/** A creature's whole sheet: CREATURE_FRAMES.count frames side by side. */
export function paintCreatureSheet(ctx: CanvasRenderingContext2D, art: CreatureArt): void {
  const palette = creaturePalette(art);
  for (let frame = 0; frame < CREATURE_FRAMES.count; frame++) {
    drawPixelRows(ctx, creatureFrameRows(art.style, frame), palette, frame * CREATURE_FRAME_SIZE, 0);
  }
}

// ---- Missiles ------------------------------------------------------------------------------

export const BOLT_SIZE = { width: 9, height: 3 } as const;
export const SPIT_SIZE = { width: 5, height: 5 } as const;

/** A crossbow bolt, pointing right (the sprite is turned to its flight). */
export function paintBolt(ctx: CanvasRenderingContext2D): void {
  drawPixelRows(ctx, ['k.......w', 'fhhhhhhmm', 'k.......w'], { k: '#5e3a1a', f: '#d8cfb8', h: '#a87a4b', m: '#9aa1ab', w: '#d2d7de' }, 0, 0);
}

/** A glob of bile. */
export function paintSpit(ctx: CanvasRenderingContext2D): void {
  drawPixelRows(ctx, ['.kgk.', 'kglgk', 'gglgg', 'kgggk', '.kgk.'], { k: '#44591f', g: '#9dcc3a', l: '#eaf7a0' }, 0, 0);
}

// ---- Puffs and sparks --------------------------------------------------------------------

export const PUFF_SIZE = 12;
export const PUFF_FRAMES = 4;
export const SPARK_SIZE = 7;
export const SPARK_FRAMES = 3;

/** A puff of smoke spreading and thinning over PUFF_FRAMES frames, in white (tinted when used). */
export function paintPuff(ctx: CanvasRenderingContext2D): void {
  const centre = (PUFF_SIZE - 1) / 2;
  for (let frame = 0; frame < PUFF_FRAMES; frame++) {
    const radius = 1.5 + frame * 1.3;
    for (let y = 0; y < PUFF_SIZE; y++) {
      for (let x = 0; x < PUFF_SIZE; x++) {
        const dx = x - centre;
        const dy = y - centre;
        const d = Math.sqrt(dx * dx + dy * dy);
        // A ring that thins out: later frames keep fewer of its pixels.
        if (d > radius + 0.7 || d < radius - 1.6) continue;
        if (frame >= 2 && (x + y + frame) % (frame === 2 ? 2 : 3) !== 0) continue;
        plot(ctx, frame * PUFF_SIZE + x, y, d > radius - 0.4 ? '#c8c8d0' : '#ffffff');
      }
    }
  }
}

/** A small burst where a blow lands, shrinking over SPARK_FRAMES frames, in white (tinted when used). */
export function paintSpark(ctx: CanvasRenderingContext2D): void {
  const shapes = [
    ['w..w..w', '.w.w.w.', '..www..', 'wwwwwww', '..www..', '.w.w.w.', 'w..w..w'],
    ['.......', '..w.w..', '...w...', '.wwwww.', '...w...', '..w.w..', '.......'],
    ['.......', '.......', '...w...', '..www..', '...w...', '.......', '.......'],
  ];
  shapes.forEach((rows, frame) => drawPixelRows(ctx, rows, { w: '#ffffff' }, frame * SPARK_SIZE, 0));
}

// ---- Marks -----------------------------------------------------------------------------------

export const COMBAT_MARK_SIZE = 9;
/** Frames of the marks texture: 0 an animal marked for hunting, 1 a fallen dwarf marked for revival. */
export const COMBAT_MARKS = { hunt: 0, revive: 1 } as const;

export function paintCombatMarks(ctx: CanvasRenderingContext2D): void {
  // Crosshairs over a hunted animal.
  drawPixelRows(
    ctx,
    ['...kok...', '...kok...', '..kkokk..', 'kkk...kkk', 'ooo.o.ooo', 'kkk...kkk', '..kkokk..', '...kok...', '...kok...'],
    { k: '#2a1608', o: '#ffb347' },
    0,
    0,
  );
  // A small flame over a dwarf waiting to be brought back.
  drawPixelRows(
    ctx,
    ['....k....', '...kyk...', '..kyyk...', '..kyoyk..', '.kyooyk..', '.kyoroyk.', '.kyorroyk', '..kyooyk.', '...kkkk..'],
    { k: '#3a1606', y: '#ffe08a', o: '#ff9a3a', r: '#e2482a' },
    COMBAT_MARK_SIZE,
    0,
  );
}

// ---- The portal --------------------------------------------------------------------------------

export const PORTAL_WIDTH = 32;
export const PORTAL_HEIGHT = 48;
export const PORTAL_FRAMES = 4;

const PORTAL_COLOURS = ['#1a0a2e', '#3d1670', '#6a2fb8', '#9a5cf0', '#d6b8ff'];

/**
 * An oval rift standing on the ground, swirling through PORTAL_FRAMES frames: bands of
 * violet wind round its middle, darkest at the heart, with a bright rim.
 */
export function paintPortal(ctx: CanvasRenderingContext2D): void {
  const cx = (PORTAL_WIDTH - 1) / 2;
  const cy = PORTAL_HEIGHT - 22;
  const rx = 12.5;
  const ry = 20.5;
  for (let frame = 0; frame < PORTAL_FRAMES; frame++) {
    for (let y = 0; y < PORTAL_HEIGHT; y++) {
      for (let x = 0; x < PORTAL_WIDTH; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d = Math.sqrt(nx * nx + ny * ny);
        if (d > 0.97) continue;
        let colour: string;
        if (d > 0.86) colour = PORTAL_COLOURS[4]!;
        else {
          // Spiral bands: the angle round the middle plus the distance, turning with the frame.
          const turn = Math.atan2(ny, nx) / (2 * Math.PI) + d * 1.6 - frame / PORTAL_FRAMES;
          const band = ((Math.floor(turn * 6) % 3) + 3) % 3;
          colour = PORTAL_COLOURS[Math.min(3, Math.floor(d * 2.2) + (band === 0 ? 1 : 0))]!;
        }
        plot(ctx, frame * PORTAL_WIDTH + x, y, colour);
      }
    }
  }
}
