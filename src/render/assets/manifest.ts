/**
 * The asset manifest: the single place that says where every texture and sound comes
 * from. Game code refers to assets only by these keys (TEXTURES.dwarf, SOUNDS.uiClick),
 * never by file name, so placeholder art can be swapped for real art in one place.
 *
 * To replace a generated placeholder with a real sprite:
 *   1. put the PNG somewhere under src/assets/ (e.g. src/assets/dwarf.png);
 *   2. import its URL here:  import dwarfUrl from '../../assets/dwarf.png';
 *   3. change the entry to:  dwarf: { kind: 'image', url: dwarfUrl, frames: DWARF_FRAMES }
 * Same for sounds: { kind: 'file', url: clickUrl } with an imported .ogg/.mp3.
 * Keep the same frame size and frame order so animations keep working.
 *
 * The terrain atlas is special: its layout follows tiles.json (see render/world/tileAtlas.ts),
 * so a hand-made replacement has to keep that layout.
 */
import type { Rng } from '../../core/Rng';
import { ITEMS, TILES } from '../../sim/content';
import { createAtlasLayout, paintAtlas } from '../world/tileAtlas';
import {
  CRACK_FRAMES,
  DEFAULT_DWARF_COLOURS,
  DWARF_SHEET_FRAMES,
  MARK_FRAMES,
  paintCracks,
  paintDwarfLookSheet,
  paintMarks,
  type DwarfColours,
} from './colonyArt';
import { ITEM_ICON_SIZE, paintItemAtlas } from './itemArt';
import {
  DWARF_FRAME_SIZE,
  GATE_HEIGHT,
  GATE_WIDTH,
  GROUND_STRIP_WIDTH,
  HEARTH_FRAMES,
  HEARTH_HEIGHT,
  HEARTH_WIDTH,
  paintDirtStrip,
  paintGate,
  paintGateGlow,
  paintGrassStrip,
  paintHearth,
  paintHills,
  paintSky,
  paintStars,
  SKY_BAND_HEIGHT,
} from './painters';
import type { Tone } from './synth';

/** Frame layout of the terrain atlas, derived from tiles.json. */
export const TERRAIN_LAYOUT = createAtlasLayout(TILES);

/** How a texture is cut into equally sized animation frames, numbered left to right, top to bottom. */
export interface FrameGrid {
  frameWidth: number;
  frameHeight: number;
  count: number;
}

/** Drawn at startup by a painter function. */
export interface GeneratedTexture {
  kind: 'generated';
  width: number;
  height: number;
  frames?: FrameGrid;
  paint(ctx: CanvasRenderingContext2D, rng: Rng): void;
}

/** Loaded from an image file bundled by Vite. */
export interface ImageTexture {
  kind: 'image';
  url: string;
  frames?: FrameGrid;
}

export type TextureSource = GeneratedTexture | ImageTexture;

export const DWARF_FRAMES: FrameGrid = {
  frameWidth: DWARF_FRAME_SIZE,
  frameHeight: DWARF_FRAME_SIZE,
  count: DWARF_SHEET_FRAMES,
};

/**
 * A dwarf sheet in one dwarf's colours (frames in colonyArt.ts DWARF_FRAMES). Each dwarf
 * gets its own texture, made the first time it appears; see dwarfTextureKey.
 */
export function dwarfSheet(colours: DwarfColours): GeneratedTexture {
  return {
    kind: 'generated',
    width: DWARF_FRAME_SIZE * DWARF_SHEET_FRAMES,
    height: DWARF_FRAME_SIZE,
    frames: DWARF_FRAMES,
    paint: (ctx) => paintDwarfLookSheet(ctx, colours),
  };
}

export function dwarfTextureKey(colours: DwarfColours): string {
  return `dwarf:${colours.skin}:${colours.beard}:${colours.tunic}`;
}

export const TEXTURES = {
  /** The title screen's dwarves, in the default colours. */
  dwarf: dwarfSheet(DEFAULT_DWARF_COLOURS),
  groundGrass: { kind: 'generated', width: GROUND_STRIP_WIDTH, height: 16, paint: paintGrassStrip },
  groundDirt: { kind: 'generated', width: GROUND_STRIP_WIDTH, height: 16, paint: paintDirtStrip },
  titleSky: { kind: 'generated', width: 8, height: SKY_BAND_HEIGHT * 12, paint: paintSky },
  titleStars: {
    kind: 'generated',
    width: 256,
    height: 100,
    paint: (ctx, rng) => paintStars(ctx, rng, 256, 100),
  },
  titleHillsFar: {
    kind: 'generated',
    width: 256,
    height: 64,
    paint: (ctx, rng) => paintHills(ctx, rng, 256, 64, { body: '#2a2747', rim: '#3d3964' }, 18, 54, false),
  },
  titleHillsNear: {
    kind: 'generated',
    width: 256,
    height: 80,
    paint: (ctx, rng) => paintHills(ctx, rng, 256, 80, { body: '#16211f', rim: '#25352f' }, 14, 44, true),
  },
  titleGate: { kind: 'generated', width: GATE_WIDTH, height: GATE_HEIGHT, paint: paintGate },
  titleGateGlow: { kind: 'generated', width: GATE_WIDTH, height: GATE_HEIGHT, paint: paintGateGlow },
  /** Every block, wall and liquid frame (see render/world/tileAtlas.ts). */
  terrain: {
    kind: 'generated',
    width: TERRAIN_LAYOUT.width,
    height: TERRAIN_LAYOUT.height,
    paint: (ctx) => paintAtlas(ctx, TILES, TERRAIN_LAYOUT),
  },
  hearth: {
    kind: 'generated',
    width: HEARTH_WIDTH * HEARTH_FRAMES,
    height: HEARTH_HEIGHT,
    frames: { frameWidth: HEARTH_WIDTH, frameHeight: HEARTH_HEIGHT, count: HEARTH_FRAMES },
    paint: paintHearth,
  },
  /** Item icons from items.json; frame n is item number n. */
  items: {
    kind: 'generated',
    width: ITEM_ICON_SIZE * ITEMS.items.length,
    height: ITEM_ICON_SIZE,
    frames: { frameWidth: ITEM_ICON_SIZE, frameHeight: ITEM_ICON_SIZE, count: ITEMS.items.length },
    paint: (ctx) => paintItemAtlas(ctx, ITEMS),
  },
  /** Dig and chop marks by priority, and blocked marks (see colonyArt.ts markFrame). */
  marks: { kind: 'generated', width: 16 * MARK_FRAMES, height: 16, paint: paintMarks },
  /** Cracks in a block being dug, in four stages. */
  cracks: {
    kind: 'generated',
    width: 16 * CRACK_FRAMES,
    height: 16,
    frames: { frameWidth: 16, frameHeight: 16, count: CRACK_FRAMES },
    paint: paintCracks,
  },
} satisfies Record<string, TextureSource>;

export type TextureKey = keyof typeof TEXTURES;

/** Animations built from frame grids; keys are what sprites call `play()` with. */
export const ANIMATIONS = {
  dwarfWalk: { texture: 'dwarf', frames: [1, 2, 3, 4], frameRate: 8, repeat: -1 },
  hearthFire: { texture: 'hearth', frames: [0, 1, 2, 1], frameRate: 7, repeat: -1 },
} satisfies Record<string, { texture: TextureKey; frames: number[]; frameRate: number; repeat: number }>;

export type AnimationKey = keyof typeof ANIMATIONS;

// ---- Sounds --------------------------------------------------------------------------------

/** Generated at startup by the synthesizer. */
export interface SynthSound {
  kind: 'synth';
  tones: readonly Tone[];
}

/** Loaded from an audio file bundled by Vite. */
export interface FileSound {
  kind: 'file';
  url: string;
}

export type SoundSource = SynthSound | FileSound;

export const SOUNDS = {
  /** Button press: a short wooden tick. */
  uiClick: {
    kind: 'synth',
    tones: [
      { wave: 'triangle', freq: 880, freqEnd: 620, duration: 0.05, release: 0.04, volume: 0.8 },
      { wave: 'noise', freq: 0, duration: 0.02, release: 0.018, volume: 0.25 },
    ],
  },
  /** A panel opening: a soft rising chirp. */
  uiOpen: {
    kind: 'synth',
    tones: [{ wave: 'sine', freq: 420, freqEnd: 760, duration: 0.11, release: 0.08, volume: 0.7 }],
  },
  /** A panel closing: the same chirp falling. */
  uiClose: {
    kind: 'synth',
    tones: [{ wave: 'sine', freq: 700, freqEnd: 380, duration: 0.11, release: 0.08, volume: 0.7 }],
  },
  /** A block dug out: a short gritty crunch. */
  dig: {
    kind: 'synth',
    tones: [
      { wave: 'noise', freq: 0, duration: 0.09, attack: 0.002, release: 0.08, volume: 0.55 },
      { wave: 'triangle', freq: 190, freqEnd: 85, duration: 0.08, release: 0.07, volume: 0.6 },
    ],
  },
  /** New game: two anvil-like strikes. */
  gameStart: {
    kind: 'synth',
    tones: [
      { wave: 'square', freq: 523, duration: 0.18, release: 0.16, volume: 0.35 },
      { wave: 'sine', freq: 1046, duration: 0.25, release: 0.22, volume: 0.4 },
      { wave: 'square', freq: 784, start: 0.16, duration: 0.3, release: 0.28, volume: 0.35 },
      { wave: 'sine', freq: 1568, start: 0.16, duration: 0.4, release: 0.36, volume: 0.35 },
    ],
  },
} satisfies Record<string, SoundSource>;

export type SoundKey = keyof typeof SOUNDS;
