/**
 * Keyboard input as named actions with rebindable keys.
 *
 *  - `isDown(action)`  held state, for continuous actions such as camera panning
 *  - `onPressed(action, fn)`  fires once per key press (auto-repeat is ignored)
 *
 * Keyboard handling uses DOM events with KeyboardEvent.code directly rather than
 * Phaser's key objects, which are keyed by the layout-dependent `keyCode`: bindings
 * here follow physical key positions and can be changed at runtime from Settings.
 *
 * Rules that keep the browser and the game from fighting:
 *  - keys typed into form fields (text, sliders, checkboxes) never reach the game;
 *  - combinations with Ctrl, Alt or Meta are always left to the browser;
 *  - keys bound to actions have their default behaviour suppressed, so Space pauses the
 *    game instead of clicking whichever button last had focus;
 *  - every held key is released when the window loses focus, so no key sticks.
 */
import { ACTIONS, type Action, type KeyBindings } from '../core/actions';

/** The parts of a KeyboardEvent this module reads (makes testing without a DOM easy). */
export interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

export class InputActions {
  private codeToAction = new Map<string, Action>();
  private readonly heldCodes = new Set<string>();
  private readonly downActions = new Set<Action>();
  private readonly pressHandlers = new Map<Action, Set<() => void>>();
  private enabled = true;
  private isActive: (action: Action) => boolean = () => true;
  private detachFn: (() => void) | null = null;

  constructor(bindings: KeyBindings) {
    this.setBindings(bindings);
  }

  setBindings(bindings: KeyBindings): void {
    const map = new Map<string, Action>();
    for (const action of ACTIONS) {
      for (const code of bindings[action]) if (!map.has(code)) map.set(code, action);
    }
    this.codeToAction = map;
    this.releaseAll();
  }

  /** Turn game input off (e.g. while Settings waits for a new key) or back on. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  /**
   * Decide which actions currently apply. Inactive actions are ignored entirely, so their
   * keys keep their normal browser meaning (e.g. Space presses a focused button on the
   * title screen, where there is no game to pause).
   */
  setActiveFilter(isActive: (action: Action) => boolean): void {
    this.isActive = isActive;
    this.releaseAll();
  }

  isDown(action: Action): boolean {
    return this.downActions.has(action);
  }

  onPressed(action: Action, handler: () => void): () => void {
    let handlers = this.pressHandlers.get(action);
    if (!handlers) {
      handlers = new Set();
      this.pressHandlers.set(action, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  /** The action a key event would trigger, or null if the game should ignore it. */
  actionFor(event: KeyEventLike): Action | null {
    if (!this.enabled || event.ctrlKey || event.altKey || event.metaKey) return null;
    if (isEditableTarget(event.target)) return null;
    const action = this.codeToAction.get(event.code);
    return action && this.isActive(action) ? action : null;
  }

  handleKeyDown(event: KeyEventLike): void {
    const action = this.actionFor(event);
    if (!action) return;
    event.preventDefault();
    this.heldCodes.add(event.code);
    this.downActions.add(action);
    if (event.repeat) return;
    const handlers = this.pressHandlers.get(action);
    if (handlers) for (const handler of [...handlers]) handler();
  }

  handleKeyUp(event: KeyEventLike): void {
    if (!this.heldCodes.delete(event.code)) {
      // Not a key we were tracking, but still stop e.g. Space activating a focused button.
      if (this.actionFor(event)) event.preventDefault();
      return;
    }
    event.preventDefault();
    const action = this.codeToAction.get(event.code);
    if (action && !this.anyHeldCodeFor(action)) this.downActions.delete(action);
  }

  releaseAll(): void {
    this.heldCodes.clear();
    this.downActions.clear();
  }

  /** Listen on a window. Capture phase, so focused elements can't swallow game keys first. */
  attach(target: Window): void {
    this.detach();
    const onDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
    const onUp = (e: KeyboardEvent): void => this.handleKeyUp(e);
    const onBlur = (): void => this.releaseAll();
    target.addEventListener('keydown', onDown, { capture: true });
    target.addEventListener('keyup', onUp, { capture: true });
    target.addEventListener('blur', onBlur);
    this.detachFn = () => {
      target.removeEventListener('keydown', onDown, { capture: true });
      target.removeEventListener('keyup', onUp, { capture: true });
      target.removeEventListener('blur', onBlur);
    };
  }

  detach(): void {
    this.detachFn?.();
    this.detachFn = null;
    this.releaseAll();
  }

  private anyHeldCodeFor(action: Action): boolean {
    for (const code of this.heldCodes) if (this.codeToAction.get(code) === action) return true;
    return false;
  }
}

/** True for form fields and editable content, where keys belong to the field, not the game. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}
