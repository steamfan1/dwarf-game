/**
 * Keyboard actions, their default keys, and the rules for rebinding them.
 *
 * Keys are stored as KeyboardEvent.code values (physical key positions such as "KeyW"),
 * so WASD stays in the same place on AZERTY, QWERTZ or Dvorak keyboards. Each action
 * has up to two keys: a primary and a secondary slot.
 */
import type { StringKey } from './strings';

export const ACTIONS = [
  'panUp',
  'panDown',
  'panLeft',
  'panRight',
  'zoomIn',
  'zoomOut',
  'pause',
  'speed1',
  'speed2',
  'speed3',
  'cancel',
  'toolSelect',
  'toolDig',
  'toolChop',
  'toolCancel',
  'toolPriority',
  'toggleMinimap',
  'toggleDebug',
] as const;

export type Action = (typeof ACTIONS)[number];
export type KeyBindings = { readonly [A in Action]: readonly string[] };

/** Number of keys an action can have (primary and secondary). */
export const BINDING_SLOTS = 2;

export const DEFAULT_BINDINGS: KeyBindings = {
  panUp: ['KeyW', 'ArrowUp'],
  panDown: ['KeyS', 'ArrowDown'],
  panLeft: ['KeyA', 'ArrowLeft'],
  panRight: ['KeyD', 'ArrowRight'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  pause: ['Space'],
  speed1: ['Digit1'],
  speed2: ['Digit2'],
  speed3: ['Digit3'],
  cancel: ['Escape'],
  toolSelect: ['KeyQ'],
  toolDig: ['KeyF'],
  toolChop: ['KeyC'],
  toolCancel: ['KeyX'],
  toolPriority: ['KeyP'],
  toggleMinimap: ['KeyM'],
  toggleDebug: ['Backquote'],
};

/**
 * Keys the game never binds because the browser or the OS owns them: F1 (help),
 * F3 (find), F5 (reload), F6 (address bar), F7 (caret browsing), F11 (full screen),
 * F12 (dev tools), Tab (focus navigation) and modifier/system keys. Combinations with
 * Ctrl, Alt or Meta (Ctrl+S, Ctrl+W, Ctrl+T, ...) are never treated as game input.
 */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'F1',
  'F3',
  'F5',
  'F6',
  'F7',
  'F11',
  'F12',
  'Tab',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'ContextMenu',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'PrintScreen',
]);

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/** True if a key code may be bound to a game action. */
export function isBindable(code: string): boolean {
  return /^[A-Za-z0-9]+$/.test(code) && !RESERVED_CODES.has(code);
}

export function actionLabelKey(action: Action): StringKey {
  return `action.${action}`;
}

/** Which action (if any) a key is bound to. */
export function findActionForCode(bindings: KeyBindings, code: string): Action | null {
  for (const action of ACTIONS) {
    if (bindings[action].includes(code)) return action;
  }
  return null;
}

export interface RebindResult {
  bindings: KeyBindings;
  /** Set when the key was taken from another action; that action received this slot's old key. */
  swappedWith: Action | null;
}

/**
 * Put `code` into `action`'s `slot`. If another action already used `code`, the two keys
 * are swapped so no key ever triggers two actions and no action silently loses a key.
 */
export function rebind(bindings: KeyBindings, action: Action, slot: number, code: string): RebindResult {
  if (!isBindable(code)) throw new Error(`Key ${code} cannot be bound`);
  if (slot < 0 || slot >= BINDING_SLOTS) throw new Error(`Invalid binding slot ${slot}`);

  const next: Record<Action, string[]> = cloneBindings(bindings);
  const previousKey = next[action][slot];
  const owner = findActionForCode(bindings, code);
  let swappedWith: Action | null = null;

  if (owner !== null && !(owner === action && next[action][slot] === code)) {
    const ownerSlot = next[owner].indexOf(code);
    if (owner === action) {
      // Same action, other slot: just swap the two slots.
      next[action][ownerSlot] = previousKey ?? '';
    } else {
      swappedWith = owner;
      if (previousKey) next[owner][ownerSlot] = previousKey;
      else next[owner].splice(ownerSlot, 1);
    }
  }

  next[action][slot] = code;
  return { bindings: compact(next), swappedWith };
}

/** Remove the key in `slot` from `action`. */
export function unbind(bindings: KeyBindings, action: Action, slot: number): KeyBindings {
  const next = cloneBindings(bindings);
  next[action].splice(slot, 1);
  return compact(next);
}

/**
 * Turn untrusted data (e.g. from localStorage) into valid bindings: unknown actions and
 * keys are dropped, reserved keys are rejected, a key used twice keeps its first use,
 * and any action left without keys gets its defaults back where those are still free.
 */
export function sanitizeBindings(raw: unknown): KeyBindings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const used = new Set<string>();
  const result = {} as Record<Action, string[]>;

  for (const action of ACTIONS) {
    const value = source[action];
    const keys: string[] = [];
    if (Array.isArray(value)) {
      for (const code of value) {
        if (typeof code === 'string' && isBindable(code) && !used.has(code) && keys.length < BINDING_SLOTS) {
          keys.push(code);
          used.add(code);
        }
      }
    }
    result[action] = keys;
  }

  for (const action of ACTIONS) {
    if (result[action].length > 0) continue;
    for (const code of DEFAULT_BINDINGS[action]) {
      if (!used.has(code) && result[action].length < BINDING_SLOTS) {
        result[action].push(code);
        used.add(code);
      }
    }
  }
  return result;
}

/** Short, readable name for a key code, e.g. "KeyW" -> "W", "ArrowUp" -> "↑". */
export function keyLabel(code: string | undefined): string {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) {
    const rest = code.slice(6);
    const symbols: Record<string, string> = { Add: '+', Subtract: '−', Multiply: '×', Divide: '÷', Decimal: '.', Enter: 'Enter' };
    return `Num ${symbols[rest] ?? rest}`;
  }
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    Escape: 'Esc',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backspace: 'Backspace',
    Enter: 'Enter',
    Delete: 'Del',
    Insert: 'Ins',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
  };
  return named[code] ?? code;
}

function cloneBindings(bindings: KeyBindings): Record<Action, string[]> {
  const copy = {} as Record<Action, string[]>;
  for (const action of ACTIONS) copy[action] = [...bindings[action]];
  return copy;
}

/** Drop empty slots and holes left by edits. */
function compact(bindings: Record<Action, string[]>): KeyBindings {
  for (const action of ACTIONS) {
    bindings[action] = bindings[action].filter((code): code is string => typeof code === 'string' && code.length > 0);
  }
  return bindings;
}
