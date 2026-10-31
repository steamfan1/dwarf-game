/**
 * A minimal observable state container.
 *
 * Used for state the HTML UI displays (screen, HUD numbers, settings). The game writes
 * to a store, the UI subscribes, and neither needs to know about the other. Updates are
 * shallow merges; listeners only fire when at least one field actually changed.
 */

export type StoreListener<T> = (state: T, previous: T) => void;

export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<StoreListener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  /** Shallow-merge `patch` into the state. No-op (and no notification) if nothing changed. */
  set(patch: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(patch[key], this.state[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const previous = this.state;
    this.state = { ...previous, ...patch };
    for (const listener of [...this.listeners]) listener(this.state, previous);
  }

  /** Like `set`, but computes the patch from the current state. */
  update(fn: (state: T) => Partial<T>): void {
    this.set(fn(this.state));
  }

  subscribe(listener: StoreListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Equality on the first level of two objects; handy for UI selectors returning objects. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keysA = Object.keys(a) as (keyof T)[];
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((k) => Object.is(a[k], b[k]));
}
