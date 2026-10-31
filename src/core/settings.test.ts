import { describe, expect, it } from 'vitest';
import { rebind } from './actions';
import { DEFAULT_SETTINGS, parseSettings, sanitizeSettings, serializeSettings, UI_SCALE_MAX, UI_SCALE_MIN } from './settings';

describe('settings', () => {
  it('round-trips through serialize/parse', () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      masterVolume: 0.35,
      uiScale: 1.25,
      edgePan: false,
      bindings: rebind(DEFAULT_SETTINGS.bindings, 'pause', 0, 'KeyP').bindings,
    };
    expect(parseSettings(serializeSettings(custom))).toEqual(custom);
  });

  it('falls back to defaults for missing, corrupt or wrong-version data', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ version: 999, settings: { masterVolume: 0.1 } }))).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and repairs individual fields', () => {
    const s = sanitizeSettings({ masterVolume: 7, sfxVolume: -1, musicVolume: 'loud', uiScale: 9, edgePan: 'yes' });
    expect(s.masterVolume).toBe(1);
    expect(s.sfxVolume).toBe(0);
    expect(s.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(s.uiScale).toBe(UI_SCALE_MAX);
    expect(s.edgePan).toBe(DEFAULT_SETTINGS.edgePan);
    expect(sanitizeSettings({ uiScale: 0.1 }).uiScale).toBe(UI_SCALE_MIN);
  });

  it('snaps interface size to 5% steps', () => {
    expect(sanitizeSettings({ uiScale: 1.123 }).uiScale).toBe(1.1);
    expect(sanitizeSettings({ uiScale: 1.149 }).uiScale).toBe(1.15);
  });
});
