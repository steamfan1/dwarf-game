import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, rebind } from '../core/actions';
import { InputActions, isEditableTarget, type KeyEventLike } from './InputActions';

interface FakeKeyEvent extends KeyEventLike {
  prevented: boolean;
}

function key(code: string, extra: Partial<Omit<KeyEventLike, 'preventDefault'>> = {}): FakeKeyEvent {
  const event: FakeKeyEvent = {
    code,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...extra,
  };
  return event;
}

describe('InputActions', () => {
  it('tracks held state across both keys of an action', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    input.handleKeyDown(key('KeyW'));
    input.handleKeyDown(key('ArrowUp'));
    expect(input.isDown('panUp')).toBe(true);
    input.handleKeyUp(key('KeyW'));
    expect(input.isDown('panUp')).toBe(true);
    input.handleKeyUp(key('ArrowUp'));
    expect(input.isDown('panUp')).toBe(false);
  });

  it('fires pressed handlers once per press, ignoring auto-repeat', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    let presses = 0;
    input.onPressed('pause', () => presses++);
    input.handleKeyDown(key('Space'));
    input.handleKeyDown(key('Space', { repeat: true }));
    input.handleKeyUp(key('Space'));
    input.handleKeyDown(key('Space'));
    expect(presses).toBe(2);
  });

  it('suppresses the browser default for game keys only', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    const space = key('Space');
    const enter = key('Enter');
    input.handleKeyDown(space);
    input.handleKeyDown(enter);
    expect(space.prevented).toBe(true);
    expect(enter.prevented).toBe(false);
  });

  it('leaves Ctrl/Alt/Meta combinations to the browser', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    const ctrlS = key('KeyS', { ctrlKey: true });
    const metaW = key('KeyW', { metaKey: true });
    input.handleKeyDown(ctrlS);
    input.handleKeyDown(metaW);
    expect(ctrlS.prevented).toBe(false);
    expect(metaW.prevented).toBe(false);
    expect(input.isDown('panDown')).toBe(false);
    expect(input.isDown('panUp')).toBe(false);
  });

  it('ignores keys typed into form fields', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    const typing = key('KeyW', { target: { tagName: 'INPUT' } as unknown as EventTarget });
    input.handleKeyDown(typing);
    expect(input.isDown('panUp')).toBe(false);
    expect(typing.prevented).toBe(false);
  });

  it('follows rebinding immediately', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    input.setBindings(rebind(DEFAULT_BINDINGS, 'pause', 0, 'KeyP').bindings);
    let presses = 0;
    input.onPressed('pause', () => presses++);
    input.handleKeyDown(key('Space'));
    input.handleKeyDown(key('KeyP'));
    expect(presses).toBe(1);
  });

  it('ignores inactive actions and leaves their keys to the browser', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    input.setActiveFilter((action) => action !== 'pause');
    const space = key('Space');
    input.handleKeyDown(space);
    expect(space.prevented).toBe(false);
    expect(input.isDown('pause')).toBe(false);
    const debugKey = key('Backquote');
    input.handleKeyDown(debugKey);
    expect(debugKey.prevented).toBe(true);
  });

  it('releases everything when disabled or on releaseAll (window blur)', () => {
    const input = new InputActions(DEFAULT_BINDINGS);
    input.handleKeyDown(key('KeyA'));
    input.releaseAll();
    expect(input.isDown('panLeft')).toBe(false);
    input.handleKeyDown(key('KeyA'));
    input.setEnabled(false);
    expect(input.isDown('panLeft')).toBe(false);
    input.handleKeyDown(key('KeyA'));
    expect(input.isDown('panLeft')).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('recognises form fields and editable content', () => {
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
