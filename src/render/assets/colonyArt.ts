/**
 * Placeholder art for the colony: dwarf sprite sheets in each dwarf's own colours, the
 * cracks that spread through a block being dug, and the marks on designated work.
 * Original art, drawn with the Canvas 2D API only (see painters.ts).
 */
import type { Priority } from '../../sim/jobs/JobBoard';
import { dwarfFrameRows, DWARF_FRAME_SIZE, DWARF_PALETTE } from './painters';
import { drawPixelRows, mixColor, plot, type Palette } from './pixelArt';

// ---- Dwarves --------------------------------------------------------------------------

/** Frames in a dwarf sheet. */
export const DWARF_FRAMES = {
  stand: 0,
  /** Walk cycle: frames 1-4. */
  walk: [1, 2, 3, 4],
  /** Pick raised, then striking. */
  windUp: 5,
  strike: 6,
  /** Jumping or falling: legs tucked. */
  airborne: 7,
  /** Lying on the ground. */
  fallen: 8,
} as const;
export const DWARF_SHEET_FRAMES = 9;

export interface DwarfColours {
  skin: string;
  beard: string;
  tunic: string;
}

export function dwarfPalette(colours: DwarfColours): Palette {
  return {
    ...DWARF_PALETTE,
    s: colours.skin,
    S: mixColor(colours.skin, '#5a2e1a', 0.25),
    b: colours.beard,
    B: mixColor(colours.beard, '#000000', 0.3),
    w: mixColor(colours.beard, '#ffffff', 0.35),
    t: colours.tunic,
    T: mixColor(colours.tunic, '#000000', 0.3),
  };
}

const TOOL: Palette = { h: '#8a5a2b', H: '#5e3a1a', m: '#cfd5dd', M: '#7d848f' };

/** Pixels laid over the standing frame: [x, y, colour key]. */
const WIND_UP: ReadonlyArray<[number, number, string]> = [
  [12, 6, 'M'],
  [13, 5, 'm'],
  [14, 5, 'm'],
  [15, 6, 'M'],
  [14, 6, 'h'],
  [14, 7, 'h'],
  [13, 8, 'h'],
  [13, 9, 'H'],
  [13, 10, 'h'],
];
const STRIKE: ReadonlyArray<[number, number, string]> = [
  [13, 11, 'h'],
  [14, 11, 'H'],
  [15, 9, 'M'],
  [15, 10, 'm'],
  [15, 11, 'm'],
  [15, 12, 'm'],
  [15, 13, 'M'],
];
const TUCKED_LEGS = ['...kppppk.......', '....koook.......'];

function standRows(): string[] {
  return dwarfFrameRows(0);
}

/** Rotate 16 x 16 character rows a quarter turn clockwise. */
function rotateClockwise(rows: readonly string[]): string[] {
  const size = rows.length;
  return Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => rows[size - 1 - c]![r] ?? '.').join(''));
}

/** A full dwarf sheet, DWARF_SHEET_FRAMES frames of 16 x 16, facing right. */
export function paintDwarfLookSheet(ctx: CanvasRenderingContext2D, colours: DwarfColours): void {
  const palette = dwarfPalette(colours);
  const at = (frame: number): number => frame * DWARF_FRAME_SIZE;
  for (let frame = 0; frame <= 4; frame++) drawPixelRows(ctx, dwarfFrameRows(frame), palette, at(frame), 0);

  for (const [frame, overlay] of [
    [DWARF_FRAMES.windUp, WIND_UP],
    [DWARF_FRAMES.strike, STRIKE],
  ] as const) {
    drawPixelRows(ctx, standRows(), palette, at(frame), 0);
    for (const [x, y, key] of overlay) plot(ctx, at(frame) + x, y, TOOL[key]!);
  }

  drawPixelRows(ctx, [...standRows().slice(0, 14), ...TUCKED_LEGS], palette, at(DWARF_FRAMES.airborne), 0);

  // Lying down: the standing dwarf turned on its side, resting on the bottom of the frame.
  const lying = rotateClockwise(standRows());
  drawPixelRows(ctx, lying.slice(0, 14), palette, at(DWARF_FRAMES.fallen), 2);
}

/** The default dwarf (title screen): the first colours in the original palette. */
export const DEFAULT_DWARF_COLOURS: DwarfColours = { skin: DWARF_PALETTE.s!, beard: DWARF_PALETTE.b!, tunic: DWARF_PALETTE.t! };

// ---- Cracks -----------------------------------------------------------------------------

export const CRACK_FRAMES = 4;

const CRACK_STAGES: ReadonlyArray<ReadonlyArray<[number, number]>> = [
  [
    [7, 7],
    [8, 8],
    [8, 9],
  ],
  [
    [6, 6],
    [5, 6],
    [9, 9],
    [9, 10],
    [9, 7],
  ],
  [
    [10, 8],
    [11, 8],
    [6, 9],
    [5, 10],
    [7, 5],
    [7, 4],
    [10, 11],
  ],
  [
    [12, 7],
    [13, 6],
    [4, 11],
    [3, 11],
    [11, 12],
    [8, 3],
    [2, 6],
    [4, 6],
    [12, 9],
  ],
];

/** Four frames of cracks, each adding to the last, for a block 0-25%, 25-50%... dug. */
export function paintCracks(ctx: CanvasRenderingContext2D): void {
  for (let frame = 0; frame < CRACK_FRAMES; frame++) {
    for (let stage = 0; stage <= frame; stage++) {
      for (const [x, y] of CRACK_STAGES[stage]!) {
        ctx.fillStyle = 'rgba(22, 15, 10, 0.7)';
        ctx.fillRect(frame * 16 + x, y, 1, 1);
        ctx.fillStyle = 'rgba(255, 244, 220, 0.22)';
        ctx.fillRect(frame * 16 + x + 1, y + 1, 1, 1);
      }
    }
  }
}

// ---- Designation marks --------------------------------------------------------------

export const PRIORITY_COLOURS: Record<Priority, string> = {
  1: '#8fa3b8',
  2: '#f2c14e',
  3: '#f08a3c',
  4: '#ff5a7a',
};
const BLOCKED_COLOUR = '#ff3b30';

const MISSING_COLOUR = '#f2a33a';

/**
 * What a mark shows: the work (a pick to dig, an axe to fell, a hammer to build, a cross
 * to take apart) or, on the other cells of a large piece of planned furniture, just the
 * border.
 */
export type MarkKind = 'dig' | 'chop' | 'build' | 'dismantle' | 'plain';

const MARK_BASE: Record<MarkKind, number> = { dig: 0, chop: 4, build: 10, dismantle: 14, plain: 18 };
const BLOCKED_FRAME: Record<MarkKind, number> = { dig: 8, chop: 9, build: 23, dismantle: 23, plain: 23 };
/** Planned building waiting for materials that aren't in storage. */
const MISSING_FRAME = 22;

/**
 * Frame of the marks texture for a job: dig 0-3, chop 4-7 (by priority), blocked dig 8,
 * blocked chop 9, build 10-13, dismantle 14-17, plain 18-21, missing materials 22 and
 * blocked (anything else) 23.
 */
export function markFrame(kind: MarkKind, priority: Priority, blocked: boolean, missing = false): number {
  if (blocked) return BLOCKED_FRAME[kind];
  if (missing && kind !== 'plain') return MISSING_FRAME;
  return MARK_BASE[kind] + priority - 1;
}
export const MARK_FRAMES = 24;

const PICK = ['.mmm.', 'm.h.m', '..h..', '..h..', '..h..'];
const AXE = ['.mm..', 'mmh..', '.mh..', '..h..', '..h..'];
const HAMMER = ['mmmm.', 'mmmmh', '..h..', '..h..', '..h..'];
const CROSS = ['m...m', '.m.m.', '..m..', '.m.m.', 'm...m'];
const WARNING = ['.rrr.', 'rrwrr', 'rrwrr', 'rrwrr', 'rrrrr', 'rrwrr', '.rrr.'];
const QUESTION = ['.qqq.', 'q...q', '....q', '...q.', '..q..', '.....', '..q..'];

function rgba(hex: string, alpha: number): string {
  const v = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

function paintMark(ctx: CanvasRenderingContext2D, ox: number, colour: string, icon: readonly string[], pips: number, iconPalette: Palette): void {
  ctx.fillStyle = rgba(colour, 0.16);
  ctx.fillRect(ox + 1, 1, 14, 14);
  // A dashed border, so neighbouring marks read as a grid of separate blocks.
  ctx.fillStyle = rgba(colour, 0.92);
  for (let i = 0; i < 16; i++) {
    if (i % 4 >= 2) continue;
    ctx.fillRect(ox + i, 0, 1, 1);
    ctx.fillRect(ox + i, 15, 1, 1);
    ctx.fillRect(ox, i, 1, 1);
    ctx.fillRect(ox + 15, i, 1, 1);
  }
  drawPixelRows(ctx, icon, iconPalette, ox + 2, 2);
  for (let p = 0; p < pips; p++) plot(ctx, ox + 2 + p * 2, 13, colour);
}

/** Every designation mark, 16 x 16, in one row (see markFrame). */
export function paintMarks(ctx: CanvasRenderingContext2D): void {
  const iconColours: Palette = { m: '#f4f1ea', h: '#d7b98e' };
  ([1, 2, 3, 4] as const).forEach((priority) => {
    paintMark(ctx, markFrame('dig', priority, false) * 16, PRIORITY_COLOURS[priority], PICK, priority, iconColours);
    paintMark(ctx, markFrame('chop', priority, false) * 16, PRIORITY_COLOURS[priority], AXE, priority, iconColours);
    paintMark(ctx, markFrame('build', priority, false) * 16, PRIORITY_COLOURS[priority], HAMMER, priority, iconColours);
    paintMark(ctx, markFrame('dismantle', priority, false) * 16, PRIORITY_COLOURS[priority], CROSS, priority, iconColours);
    paintMark(ctx, markFrame('plain', priority, false) * 16, PRIORITY_COLOURS[priority], [], 0, iconColours);
  });
  const warning: Palette = { r: BLOCKED_COLOUR, w: '#fff6f0' };
  paintMark(ctx, markFrame('dig', 2, true) * 16, BLOCKED_COLOUR, WARNING, 0, warning);
  paintMark(ctx, markFrame('chop', 2, true) * 16, BLOCKED_COLOUR, WARNING, 0, warning);
  paintMark(ctx, markFrame('build', 2, true) * 16, BLOCKED_COLOUR, WARNING, 0, warning);
  paintMark(ctx, markFrame('build', 2, false, true) * 16, MISSING_COLOUR, QUESTION, 0, { q: '#ffd27a' });
}
