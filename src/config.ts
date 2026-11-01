/**
 * Engine-level constants. Game *content* (tiles, items, recipes, creatures...) lives in
 * JSON under src/data/; this file only holds numbers the code itself is built around.
 */

export const GAME_TITLE = 'Gatewright';

/** Shown on the title screen so testers know which build they are playing. */
export const MILESTONE = 2;

// ---- Simulation clock -------------------------------------------------------------

/** Simulation ticks per second at 1x speed. */
export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** A single rendered frame never advances the simulation by more than this. */
export const MAX_FRAME_MS = 250;
/** Upper bound on ticks run in one frame (3x speed on a slow frame); excess time is dropped. */
export const MAX_TICKS_PER_FRAME = 8;
/** Player-selectable speeds (top bar and keys 1, 2, 3). */
export const GAME_SPEEDS = [1, 2, 3] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

// ---- World ------------------------------------------------------------------------

export const TILE_SIZE = 16;
export const WORLD_WIDTH = 400;
export const WORLD_HEIGHT = 200;
export const CHUNK_SIZE = 32;

// ---- Camera -----------------------------------------------------------------------

/** Zoom levels in CSS pixels per world pixel. Converted to whole device pixels on high-DPI screens. */
export const ZOOM_LEVELS = [1, 2, 3, 4] as const;
export const DEFAULT_ZOOM = 2;
