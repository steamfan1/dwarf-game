/**
 * Browser storage that fails gracefully.
 *
 * Any storage call can throw: private browsing, storage blocked inside an itch.io iframe,
 * cookies disabled, quota exceeded. Nothing here ever throws to the caller. When the
 * real storage is unavailable, data is kept in memory for the session instead, and
 * `probeStorage()` reports the problem so the UI can warn that progress won't persist.
 *
 * Small data (settings) uses localStorage. Saved games use IndexedDB (Milestone 6),
 * because localStorage is limited to about 5 MB of strings.
 */

/** The subset of the Web Storage API the game uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * localStorage with try/catch around every call. If the backing storage throws once,
 * the store switches to an in-memory map for the rest of the session.
 */
export class SafeKeyValueStore implements KeyValueStore {
  private readonly memory = new Map<string, string>();
  private backend: KeyValueStore | null;

  /** `getBackend` is a function because merely touching `window.localStorage` can throw. */
  constructor(getBackend: () => KeyValueStore | null | undefined = defaultLocalStorage) {
    try {
      this.backend = getBackend() ?? null;
    } catch {
      this.backend = null;
    }
  }

  /** False once storage has failed and data only lives in memory. */
  get persistent(): boolean {
    return this.backend !== null;
  }

  getItem(key: string): string | null {
    if (this.backend) {
      try {
        return this.backend.getItem(key);
      } catch {
        this.fallBackToMemory();
      }
    }
    return this.memory.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.memory.set(key, value);
    if (!this.backend) return;
    try {
      this.backend.setItem(key, value);
    } catch {
      this.fallBackToMemory();
    }
  }

  removeItem(key: string): void {
    this.memory.delete(key);
    if (!this.backend) return;
    try {
      this.backend.removeItem(key);
    } catch {
      this.fallBackToMemory();
    }
  }

  private fallBackToMemory(): void {
    this.backend = null;
  }
}

export interface StorageStatus {
  /** localStorage can be written and read back. */
  localStorage: boolean;
  /** An IndexedDB database can be opened. */
  indexedDB: boolean;
}

/** True when both storage kinds work, i.e. settings and saves will survive a reload. */
export function storageIsPersistent(status: StorageStatus): boolean {
  return status.localStorage && status.indexedDB;
}

/** Check, once at startup, whether localStorage and IndexedDB actually work. */
export async function probeStorage(): Promise<StorageStatus> {
  const [local, idb] = await Promise.all([probeLocalStorage(), probeIndexedDb()]);
  return { localStorage: local, indexedDB: idb };
}

function probeLocalStorage(): boolean {
  try {
    const store = defaultLocalStorage();
    if (!store) return false;
    const key = '__gatewright_probe__';
    store.setItem(key, '1');
    const ok = store.getItem(key) === '1';
    store.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

function probeIndexedDb(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    // Some browsers have been known to never answer in private mode; don't wait forever.
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      if (typeof indexedDB === 'undefined') {
        clearTimeout(timer);
        finish(false);
        return;
      }
      const request = indexedDB.open('gatewright-probe', 1);
      request.onsuccess = () => {
        clearTimeout(timer);
        try {
          request.result.close();
        } catch {
          // Closing a probe connection can't meaningfully fail; ignore.
        }
        finish(true);
      };
      request.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      request.onblocked = () => {
        clearTimeout(timer);
        finish(false);
      };
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

function defaultLocalStorage(): KeyValueStore | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}
