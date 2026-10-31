import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  findActionForCode,
  isBindable,
  keyLabel,
  rebind,
  sanitizeBindings,
  unbind,
} from './actions';

describe('default bindings', () => {
  it('bind every action, use no key twice and avoid browser-reserved keys', () => {
    const seen = new Set<string>();
    for (const action of ACTIONS) {
      expect(DEFAULT_BINDINGS[action].length).toBeGreaterThan(0);
      for (const code of DEFAULT_BINDINGS[action]) {
        expect(isBindable(code)).toBe(true);
        expect(seen.has(code)).toBe(false);
        seen.add(code);
      }
    }
  });

  it('use the backtick key for the debug overlay', () => {
    expect(findActionForCode(DEFAULT_BINDINGS, 'Backquote')).toBe('toggleDebug');
  });
});

describe('isBindable', () => {
  it('rejects keys the browser owns', () => {
    for (const code of ['F3', 'F5', 'F11', 'F12', 'Tab', 'ControlLeft', 'MetaLeft', '']) {
      expect(isBindable(code)).toBe(false);
    }
    expect(isBindable('KeyQ')).toBe(true);
  });
});

describe('rebind', () => {
  it('assigns a free key to a slot', () => {
    const { bindings, swappedWith } = rebind(DEFAULT_BINDINGS, 'panUp', 0, 'KeyI');
    expect(bindings.panUp).toEqual(['KeyI', 'ArrowUp']);
    expect(swappedWith).toBeNull();
  });

  it('swaps keys when the new key belongs to another action', () => {
    const { bindings, swappedWith } = rebind(DEFAULT_BINDINGS, 'panUp', 0, 'KeyS');
    expect(swappedWith).toBe('panDown');
    expect(bindings.panUp).toEqual(['KeyS', 'ArrowUp']);
    expect(bindings.panDown).toEqual(['KeyW', 'ArrowDown']);
  });

  it('moves the key away from its owner when the target slot was empty', () => {
    const { bindings, swappedWith } = rebind(DEFAULT_BINDINGS, 'pause', 1, 'Digit3');
    expect(swappedWith).toBe('speed3');
    expect(bindings.pause).toEqual(['Space', 'Digit3']);
    expect(bindings.speed3).toEqual([]);
  });

  it('swaps the two slots of the same action', () => {
    const { bindings } = rebind(DEFAULT_BINDINGS, 'panLeft', 0, 'ArrowLeft');
    expect(bindings.panLeft).toEqual(['ArrowLeft', 'KeyA']);
  });

  it('refuses reserved keys and does not modify its input', () => {
    expect(() => rebind(DEFAULT_BINDINGS, 'pause', 0, 'F5')).toThrow();
    rebind(DEFAULT_BINDINGS, 'panUp', 0, 'KeyS');
    expect(DEFAULT_BINDINGS.panUp).toEqual(['KeyW', 'ArrowUp']);
  });

  it('unbind removes a slot', () => {
    expect(unbind(DEFAULT_BINDINGS, 'panUp', 0).panUp).toEqual(['ArrowUp']);
  });
});

describe('sanitizeBindings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeBindings('nope')).toEqual(DEFAULT_BINDINGS);
    expect(sanitizeBindings(null)).toEqual(DEFAULT_BINDINGS);
  });

  it('keeps valid custom keys, drops invalid ones and resolves duplicates', () => {
    const result = sanitizeBindings({
      panUp: ['KeyI', 'F5', 42],
      panDown: ['KeyI', 'KeyK'],
      unknownAction: ['KeyZ'],
    });
    expect(result.panUp).toEqual(['KeyI']);
    expect(result.panDown).toEqual(['KeyK']);
    expect(result.pause).toEqual(['Space']);
  });
});

describe('keyLabel', () => {
  it('turns key codes into short names', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit2')).toBe('2');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('Backquote')).toBe('`');
    expect(keyLabel('NumpadAdd')).toBe('Num +');
    expect(keyLabel(undefined)).toBe('');
  });
});
