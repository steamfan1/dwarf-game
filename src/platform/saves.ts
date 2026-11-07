/**
 * Saved games in the browser: compressed with gzip (CompressionStream) and kept in
 * IndexedDB, which holds far more than localStorage's few megabytes.
 *
 * Every storage call is wrapped: if IndexedDB is missing, blocked (private browsing, some
 * embedded frames) or fails, saves are kept in memory instead, so saving and Continue
 * still work until the tab closes, and the UI's storage warning says progress won't last.
 * Browsers without CompressionStream store the bytes as they are.
 *
 * Milestone 6 uses one slot; Milestone 7 adds more slots, export and import.
 */
import type { SaveMeta } from '../sim/save/SaveFile';

export interface StoredSave {
  /** The save file (see sim/save/SaveFile.ts), before compression. */
  bytes: Uint8Array;
  meta: SaveMeta;
}

/** What IndexedDB holds per slot: the compressed bytes, flagged with how they were packed. */
interface SaveRecord {
  meta: SaveMeta;
  packed: ArrayBuffer;
}

const DB_NAME = 'gatewright';
const DB_VERSION = 1;
const STORE = 'saves';
/** IndexedDB calls that take longer than this are given up on. */
const TIMEOUT_MS = 8000;

/** First byte of packed data: how the rest is stored. */
const RAW = 0;
const GZIP = 1;

/** Compress a save for storage (gzip when the browser can, else as it is). */
export async function pack(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return prefixed(RAW, bytes);
  try {
    return prefixed(GZIP, await pipeThrough(bytes, new CompressionStream('gzip')));
  } catch {
    return prefixed(RAW, bytes);
  }
}

/** Undo `pack`. Throws if the data is damaged or can't be unpacked here. */
export async function unpack(packed: Uint8Array): Promise<Uint8Array> {
  const kind = packed[0];
  const body = packed.subarray(1);
  if (kind === RAW) return body;
  if (kind !== GZIP) throw new Error('Unknown save packing');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack compressed saves');
  return pipeThrough(body, new DecompressionStream('gzip'));
}

function prefixed(kind: number, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 1);
  out[0] = kind;
  out.set(bytes, 1);
  return out;
}

async function pipeThrough(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Saved games by slot name, in IndexedDB or (failing that) in memory. */
export class SaveStore {
  private readonly memory = new Map<string, SaveRecord>();
  private db: Promise<IDBDatabase | null> | null = null;
  private failed = false;

  /** False once IndexedDB has failed and saves only last until the tab closes. */
  get persistent(): boolean {
    return !this.failed;
  }

  async put(slot: string, save: StoredSave): Promise<void> {
    const packed = await pack(save.bytes);
    const record: SaveRecord = { meta: save.meta, packed: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer };
    this.memory.set(slot, record);
    const db = await this.open();
    if (!db) return;
    try {
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, slot));
    } catch {
      this.failed = true;
    }
  }

  /** The save in a slot, unpacked, or null if there is none. Throws if it can't be unpacked. */
  async get(slot: string): Promise<StoredSave | null> {
    const record = await this.record(slot);
    if (!record) return null;
    return { meta: record.meta, bytes: await unpack(new Uint8Array(record.packed)) };
  }

  /** Just what the title screen shows about a slot's save, or null. */
  async meta(slot: string): Promise<SaveMeta | null> {
    return (await this.record(slot))?.meta ?? null;
  }

  private async record(slot: string): Promise<SaveRecord | null> {
    const db = await this.open();
    if (db) {
      try {
        const found = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(slot))) as SaveRecord | undefined;
        if (found && typeof found === 'object' && found.packed instanceof ArrayBuffer) return found;
      } catch {
        this.failed = true;
      }
    }
    return this.memory.get(slot) ?? null;
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.failed) return Promise.resolve(null);
    this.db ??= new Promise<IDBDatabase | null>((resolve) => {
      const fail = (): void => {
        this.failed = true;
        resolve(null);
      };
      const timer = setTimeout(fail, TIMEOUT_MS);
      try {
        if (typeof indexedDB === 'undefined') {
          clearTimeout(timer);
          fail();
          return;
        }
        const opening = indexedDB.open(DB_NAME, DB_VERSION);
        opening.onupgradeneeded = () => {
          if (!opening.result.objectStoreNames.contains(STORE)) opening.result.createObjectStore(STORE);
        };
        opening.onsuccess = () => {
          clearTimeout(timer);
          resolve(opening.result);
        };
        opening.onerror = () => {
          clearTimeout(timer);
          fail();
        };
        opening.onblocked = () => {
          clearTimeout(timer);
          fail();
        };
      } catch {
        clearTimeout(timer);
        fail();
      }
    });
    return this.db;
  }
}

/** An IndexedDB request as a promise, given up on after TIMEOUT_MS. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Storage timed out')), TIMEOUT_MS);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error('Storage failed'));
    };
  });
}
