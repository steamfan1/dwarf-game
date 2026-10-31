import { describe, expect, it } from 'vitest';
import { shallowEqual, Store } from './Store';

describe('Store', () => {
  it('merges patches and notifies with the new and previous state', () => {
    const store = new Store({ a: 1, b: 'x' });
    const calls: Array<[number, number]> = [];
    store.subscribe((state, prev) => calls.push([state.a, prev.a]));
    store.set({ a: 2 });
    expect(store.get()).toEqual({ a: 2, b: 'x' });
    expect(calls).toEqual([[2, 1]]);
  });

  it('does not notify when nothing changed', () => {
    const store = new Store({ a: 1 });
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ a: 1 });
    store.set({});
    expect(calls).toBe(0);
  });

  it('update() derives the patch from current state', () => {
    const store = new Store({ count: 1 });
    store.update((s) => ({ count: s.count + 1 }));
    expect(store.get().count).toBe(2);
  });

  it('stops notifying after unsubscribe', () => {
    const store = new Store({ a: 1 });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    off();
    store.set({ a: 5 });
    expect(calls).toBe(0);
  });
});

describe('shallowEqual', () => {
  it('compares one level deep', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: [1] }, { a: [1] })).toBe(false);
    expect(shallowEqual<unknown>(null, {})).toBe(false);
  });
});
