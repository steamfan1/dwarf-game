/**
 * Seeded pseudo-random numbers (xoshiro128**), so that worlds and the simulation are
 * reproducible: the same seed plus the same player orders give the same game.
 *
 * Rule for the whole codebase: simulation code never calls Math.random(). It draws from
 * an Rng owned by the simulation, whose state is stored in the save file
 * (`getState()` / `Rng.fromState()`).
 */

export type RngState = readonly [number, number, number, number];

export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  /** Seed from a number or any string (e.g. a world seed the player typed). */
  constructor(seed: number | string) {
    this.reseed(typeof seed === 'string' ? hashString(seed) : seed >>> 0);
  }

  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.setState(state);
    return rng;
  }

  /** Next raw 32-bit unsigned integer. */
  nextU32(): number {
    const { a, b, c, d } = this;
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    const c1 = c ^ a;
    const d1 = d ^ b;
    this.b = (b ^ c1) >>> 0;
    this.a = (a ^ d1) >>> 0;
    this.c = (c1 ^ t) >>> 0;
    this.d = rotl(d1, 11);
    return result;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max (${max}) < min (${min})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Shuffles in place (Fisher-Yates) and returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * An independent generator derived from this one's current state and a label, without
   * advancing this generator. World generation uses it so each feature (caves, ores,
   * trees...) has its own stream and adding a feature doesn't reshuffle the others.
   */
  fork(label: string): Rng {
    const mixed = hashString(label) ^ this.a ^ rotl(this.b, 8) ^ rotl(this.c, 16) ^ rotl(this.d, 24);
    return new Rng(mixed >>> 0);
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  setState(state: RngState): void {
    const [a, b, c, d] = state;
    if ((a | b | c | d) === 0) throw new Error('Rng state must not be all zero');
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
  }

  private reseed(seed: number): void {
    // SplitMix32 spreads a single 32-bit seed over the 128-bit state.
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }
}

/** 32-bit FNV-1a hash of a string; stable across browsers and sessions. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
