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
 * so a hand-made replacement has to keep that layout. Furniture sprites follow
 * furniture.json: one texture per piece, `width` x `height` cells of 16 px per frame.
 * Creature sprites follow creatures.json: one texture per kind, CREATURE_FRAMES.count
 * frames of 16 x 16 (stand, walk, walk, strike), facing right.
 */
import type { Rng } from '../../core/Rng';
import { CREATURES, FURNITURE, ITEMS, TILES } from '../../sim/content';
import type { CreatureDef } from '../../sim/creatures/CreatureRegistry';
import type { FurnitureDef } from '../../sim/furniture/FurnitureRegistry';
import { createAtlasLayout, paintAtlas } from '../world/tileAtlas';
import {
  CRACK_FRAMES,
  DEFAULT_DWARF_COLOURS,
  DWARF_SHEET_FRAMES,
  MARK_FRAMES,
  paintCracks,
  paintSleepZ,
  SLEEP_SIZE,
  paintDwarfLookSheet,
  paintMarks,
  type DwarfColours,
} from './colonyArt';
import {
  BOLT_SIZE,
  COMBAT_MARK_SIZE,
  CREATURE_FRAME_SIZE,
  CREATURE_FRAMES,
  paintBolt,
  paintCombatMarks,
  paintCreatureSheet,
  paintPortal,
  paintPuff,
  paintSpark,
  paintSpit,
  PORTAL_FRAMES,
  PORTAL_HEIGHT,
  PORTAL_WIDTH,
  PUFF_FRAMES,
  PUFF_SIZE,
  SPARK_FRAMES,
  SPARK_SIZE,
  SPIT_SIZE,
} from './creatureArt';
import { furnitureFrames, paintFurniture } from './furnitureArt';
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
  /** "Zz" over a sleeping dwarf. */
  sleep: { kind: 'generated', width: SLEEP_SIZE.width, height: SLEEP_SIZE.height, paint: paintSleepZ },
  /** Cracks in a block being dug, or smashed by a monster, in four stages. */
  cracks: {
    kind: 'generated',
    width: 16 * CRACK_FRAMES,
    height: 16,
    frames: { frameWidth: 16, frameHeight: 16, count: CRACK_FRAMES },
    paint: paintCracks,
  },
  /** The invasion portal, swirling (2 x 3 tiles a frame). */
  portal: {
    kind: 'generated',
    width: PORTAL_WIDTH * PORTAL_FRAMES,
    height: PORTAL_HEIGHT,
    frames: { frameWidth: PORTAL_WIDTH, frameHeight: PORTAL_HEIGHT, count: PORTAL_FRAMES },
    paint: paintPortal,
  },
  bolt: { kind: 'generated', width: BOLT_SIZE.width, height: BOLT_SIZE.height, paint: paintBolt },
  spit: { kind: 'generated', width: SPIT_SIZE.width, height: SPIT_SIZE.height, paint: paintSpit },
  /** Smoke spreading out (white: tinted for each use). */
  puff: {
    kind: 'generated',
    width: PUFF_SIZE * PUFF_FRAMES,
    height: PUFF_SIZE,
    frames: { frameWidth: PUFF_SIZE, frameHeight: PUFF_SIZE, count: PUFF_FRAMES },
    paint: paintPuff,
  },
  /** A burst where a blow lands (white: tinted for each use). */
  spark: {
    kind: 'generated',
    width: SPARK_SIZE * SPARK_FRAMES,
    height: SPARK_SIZE,
    frames: { frameWidth: SPARK_SIZE, frameHeight: SPARK_SIZE, count: SPARK_FRAMES },
    paint: paintSpark,
  },
  /** Crosshairs over a hunted animal, a flame over a fallen dwarf to revive (see COMBAT_MARKS). */
  combatMarks: {
    kind: 'generated',
    width: COMBAT_MARK_SIZE * 2,
    height: COMBAT_MARK_SIZE,
    frames: { frameWidth: COMBAT_MARK_SIZE, frameHeight: COMBAT_MARK_SIZE, count: 2 },
    paint: paintCombatMarks,
  },
} satisfies Record<string, TextureSource>;

export type TextureKey = keyof typeof TEXTURES;

/** Texture key of a piece of furniture's sprite (furniture.json id). */
export function furnitureTextureKey(def: FurnitureDef): string {
  return `furniture:${def.id}`;
}

/** Animation key for furniture with more than one frame (torches flicker), or null. */
export function furnitureAnimationKey(def: FurnitureDef): string | null {
  return furnitureFrames(def) > 1 ? `furniture:${def.id}:flicker` : null;
}

/** One texture per piece of furniture in furniture.json; frames left to right. */
export const FURNITURE_TEXTURES: ReadonlyMap<string, GeneratedTexture> = new Map(
  FURNITURE.defs.map((def) => {
    const frameWidth = def.width * 16;
    const frameHeight = def.height * 16;
    const count = furnitureFrames(def);
    const texture: GeneratedTexture = {
      kind: 'generated',
      width: frameWidth * count,
      height: frameHeight,
      frames: { frameWidth, frameHeight, count },
      paint: (ctx) => paintFurniture(ctx, def),
    };
    return [furnitureTextureKey(def), texture];
  }),
);

/** Texture key of a creature's sprite sheet (creatures.json id). */
export function creatureTextureKey(def: CreatureDef): string {
  return `creature:${def.id}`;
}

/** One sheet per creature kind in creatures.json. */
export const CREATURE_TEXTURES: ReadonlyMap<string, GeneratedTexture> = new Map(
  CREATURES.defs.map((def) => {
    const texture: GeneratedTexture = {
      kind: 'generated',
      width: CREATURE_FRAME_SIZE * CREATURE_FRAMES.count,
      height: CREATURE_FRAME_SIZE,
      frames: { frameWidth: CREATURE_FRAME_SIZE, frameHeight: CREATURE_FRAME_SIZE, count: CREATURE_FRAMES.count },
      paint: (ctx) => paintCreatureSheet(ctx, def.art),
    };
    return [creatureTextureKey(def), texture];
  }),
);

/** Animations built from frame grids; keys are what sprites call `play()` with. */
export const ANIMATIONS = {
  dwarfWalk: { texture: 'dwarf', frames: [1, 2, 3, 4], frameRate: 8, repeat: -1 },
  hearthFire: { texture: 'hearth', frames: [0, 1, 2, 1], frameRate: 7, repeat: -1 },
  portalSwirl: { texture: 'portal', frames: [0, 1, 2, 3], frameRate: 8, repeat: -1 },
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
  /** A block, wall or piece of furniture put in place: a wooden knock. */
  build: {
    kind: 'synth',
    tones: [
      { wave: 'triangle', freq: 240, freqEnd: 150, duration: 0.07, release: 0.06, volume: 0.7 },
      { wave: 'noise', freq: 0, duration: 0.03, release: 0.025, volume: 0.25 },
      { wave: 'triangle', freq: 300, freqEnd: 190, start: 0.09, duration: 0.06, release: 0.05, volume: 0.45 },
    ],
  },
  /** Something crafted: a small bright ring. */
  craft: {
    kind: 'synth',
    tones: [
      { wave: 'sine', freq: 660, duration: 0.12, release: 0.1, volume: 0.45 },
      { wave: 'sine', freq: 990, start: 0.08, duration: 0.2, release: 0.18, volume: 0.4 },
    ],
  },
  /** A block dug out: a short gritty crunch. */
  dig: {
    kind: 'synth',
    tones: [
      { wave: 'noise', freq: 0, duration: 0.09, attack: 0.002, release: 0.08, volume: 0.55 },
      { wave: 'triangle', freq: 190, freqEnd: 85, duration: 0.08, release: 0.07, volume: 0.6 },
    ],
  },
  /** A blow landing: a dull thud. */
  hit: {
    kind: 'synth',
    tones: [
      { wave: 'noise', freq: 0, duration: 0.05, attack: 0.002, release: 0.05, volume: 0.5 },
      { wave: 'triangle', freq: 150, freqEnd: 70, duration: 0.08, release: 0.07, volume: 0.7 },
    ],
  },
  /** A crossbow or bolt thrower loosing: a short twang. */
  shoot: {
    kind: 'synth',
    tones: [
      { wave: 'square', freq: 520, freqEnd: 260, duration: 0.06, release: 0.05, volume: 0.25 },
      { wave: 'noise', freq: 0, duration: 0.03, release: 0.03, volume: 0.2 },
    ],
  },
  /** Bile spat: a wet splutter. */
  spit: {
    kind: 'synth',
    tones: [
      { wave: 'noise', freq: 0, duration: 0.08, attack: 0.01, release: 0.07, volume: 0.35 },
      { wave: 'sine', freq: 300, freqEnd: 520, duration: 0.06, release: 0.05, volume: 0.3 },
    ],
  },
  /** A creature falls: a falling squeal. */
  creatureDie: {
    kind: 'synth',
    tones: [
      { wave: 'square', freq: 640, freqEnd: 180, duration: 0.22, release: 0.2, volume: 0.25 },
      { wave: 'noise', freq: 0, start: 0.05, duration: 0.12, release: 0.1, volume: 0.2 },
    ],
  },
  /** A door or block smashed in: a crunch. */
  smash: {
    kind: 'synth',
    tones: [
      { wave: 'noise', freq: 0, duration: 0.16, attack: 0.002, release: 0.15, volume: 0.6 },
      { wave: 'triangle', freq: 110, freqEnd: 55, duration: 0.15, release: 0.14, volume: 0.6 },
    ],
  },
  /** A trap springing: a metal clank. */
  trap: {
    kind: 'synth',
    tones: [
      { wave: 'square', freq: 880, freqEnd: 700, duration: 0.05, release: 0.05, volume: 0.25 },
      { wave: 'square', freq: 1320, start: 0.02, duration: 0.06, release: 0.06, volume: 0.15 },
    ],
  },
  /** An invasion is coming: two low horn calls. */
  horn: {
    kind: 'synth',
    tones: [
      { wave: 'saw', freq: 147, duration: 0.5, attack: 0.06, release: 0.3, volume: 0.3 },
      { wave: 'saw', freq: 147, start: 0.65, duration: 0.7, attack: 0.06, release: 0.45, volume: 0.32 },
      { wave: 'sine', freq: 294, start: 0.65, duration: 0.7, attack: 0.06, release: 0.45, volume: 0.15 },
    ],
  },
  /** The portal tearing open: a rising, wavering whoosh. */
  portal: {
    kind: 'synth',
    tones: [
      { wave: 'noise', freq: 0, duration: 0.9, attack: 0.3, release: 0.5, volume: 0.35 },
      { wave: 'sine', freq: 90, freqEnd: 420, duration: 0.9, attack: 0.2, release: 0.5, volume: 0.3 },
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
