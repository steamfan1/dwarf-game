import { describe, expect, it } from 'vitest';
import { SafeKeyValueStore, storageIsPersistent, type KeyValueStore } from './storage';

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

class ThrowingStore implements KeyValueStore {
  getItem(): string | null {
    throw new DOMException('denied', 'SecurityError');
  }
  setItem(): void {
    throw new DOMException('full', 'QuotaExceededError');
  }
  removeItem(): void {
    throw new DOMException('denied', 'SecurityError');
  }
}

describe('SafeKeyValueStore', () => {
  it('reads and writes through to working storage', () => {
    const backend = new MemoryStore();
    const store = new SafeKeyValueStore(() => backend);
    store.setItem('k', 'v');
    expect(backend.data.get('k')).toBe('v');
    expect(store.getItem('k')).toBe('v');
    expect(store.persistent).toBe(true);
  });

  it('survives storage that throws, keeping data in memory for the session', () => {
    const store = new SafeKeyValueStore(() => new ThrowingStore());
    expect(() => store.setItem('k', 'v')).not.toThrow();
    expect(store.getItem('k')).toBe('v');
    expect(store.persistent).toBe(false);
    expect(() => store.removeItem('k')).not.toThrow();
    expect(store.getItem('k')).toBeNull();
  });

  it('survives storage whose mere access throws (e.g. blocked in an iframe)', () => {
    const store = new SafeKeyValueStore(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    store.setItem('a', '1');
    expect(store.getItem('a')).toBe('1');
    expect(store.persistent).toBe(false);
  });

  it('works when there is no storage at all', () => {
    const store = new SafeKeyValueStore(() => null);
    store.setItem('a', '1');
    expect(store.getItem('a')).toBe('1');
  });
});

describe('storageIsPersistent', () => {
  it('needs both localStorage and IndexedDB', () => {
    expect(storageIsPersistent({ localStorage: true, indexedDB: true })).toBe(true);
    expect(storageIsPersistent({ localStorage: true, indexedDB: false })).toBe(false);
    expect(storageIsPersistent({ localStorage: false, indexedDB: true })).toBe(false);
  });
});
