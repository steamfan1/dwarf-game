import { afterEach, describe, expect, it } from 'vitest';
import { resetStringTable, setStringTable, t } from './strings';

afterEach(() => resetStringTable());

describe('t()', () => {
  it('looks up English text', () => {
    expect(t('title.newGame')).toBe('New game');
  });

  it('fills {placeholders}', () => {
    expect(t('title.build', { milestone: 4 })).toBe('Milestone 4 build');
  });

  it('leaves unknown placeholders visible instead of dropping them', () => {
    expect(t('title.build', { other: 1 })).toBe('Milestone {milestone} build');
  });

  it('falls back to English for keys a translation is missing', () => {
    setStringTable({ 'title.newGame': 'Nouvelle partie' });
    expect(t('title.newGame')).toBe('Nouvelle partie');
    expect(t('title.settings')).toBe('Settings');
  });
});
