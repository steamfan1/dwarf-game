/**
 * Player settings, saved per browser (see platform/storage.ts for where they go).
 *
 * Anything read back from storage is untrusted: it may be from an older build, edited by
 * hand, or corrupted. `sanitizeSettings` turns any input into valid settings, keeping
 * what it can and falling back to defaults field by field, so settings can never stop
 * the game from starting.
 */
import { DEFAULT_BINDINGS, sanitizeBindings, type KeyBindings } from './actions';

export interface Settings {
  /** 0..1, applied on top of the per-category volumes. */
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  /** Size of HTML panels and text, 0.75..1.5. */
  uiScale: number;
  /** Pan the camera when the pointer rests at a screen edge. */
  edgePan: boolean;
  bindings: KeyBindings;
}

export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 2;
/** The interface-size slider moves in steps of 1/20 (5%). */
const UI_SCALE_STEPS_PER_UNIT = 20;
export const UI_SCALE_STEP = 1 / UI_SCALE_STEPS_PER_UNIT;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  masterVolume: 0.8,
  sfxVolume: 0.8,
  musicVolume: 0.6,
  uiScale: 1,
  edgePan: true,
  bindings: DEFAULT_BINDINGS,
};

/** Bump when the stored shape changes in a way sanitize can't absorb. */
export const SETTINGS_VERSION = 1;

export function sanitizeSettings(raw: unknown): Settings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    masterVolume: unitNumber(src.masterVolume, DEFAULT_SETTINGS.masterVolume),
    sfxVolume: unitNumber(src.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    musicVolume: unitNumber(src.musicVolume, DEFAULT_SETTINGS.musicVolume),
    uiScale: uiScale(src.uiScale),
    edgePan: typeof src.edgePan === 'boolean' ? src.edgePan : DEFAULT_SETTINGS.edgePan,
    bindings: sanitizeBindings(src.bindings),
  };
}

/** Parse stored JSON; returns defaults for missing, malformed or incompatible data. */
export function parseSettings(json: string | null): Settings {
  if (!json) return sanitizeSettings(undefined);
  try {
    const data = JSON.parse(json) as unknown;
    const version = typeof data === 'object' && data !== null ? (data as { version?: unknown }).version : undefined;
    if (version !== SETTINGS_VERSION) return sanitizeSettings(undefined);
    return sanitizeSettings((data as { settings?: unknown }).settings);
  } catch {
    return sanitizeSettings(undefined);
  }
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, settings });
}

function unitNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function uiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.uiScale;
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
  // Snap to the slider's step so stored values always match a selectable position.
  return Math.round(clamped * UI_SCALE_STEPS_PER_UNIT) / UI_SCALE_STEPS_PER_UNIT;
}
