import { describe, expect, it } from 'vitest';
import { hashString, Rng } from './Rng';

function take(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextU32());
}

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    expect(take(new Rng(12345), 20)).toEqual(take(new Rng(12345), 20));
    expect(take(new Rng('mossy-cavern'), 20)).toEqual(take(new Rng('mossy-cavern'), 20));
  });

  it('gives different sequences for different seeds', () => {
    expect(take(new Rng(1), 10)).not.toEqual(take(new Rng(2), 10));
    expect(take(new Rng('a'), 10)).not.toEqual(take(new Rng('b'), 10));
  });

  it('produces floats in [0, 1) with a sensible mean', () => {
    const rng = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 20_000).toBeGreaterThan(0.48);
    expect(sum / 20_000).toBeLessThan(0.52);
  });

  it('int() covers both ends of its inclusive range and nothing outside', () => {
    const rng = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = rng.int(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it('round-trips its state, continuing the exact same sequence', () => {
    const rng = new Rng('save-me');
    take(rng, 37);
    const restored = Rng.fromState(rng.getState());
    expect(take(restored, 50)).toEqual(take(rng, 50));
  });

  it('fork() is deterministic and does not advance the parent', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    const forkA = a.fork('caves');
    expect(take(a, 5)).toEqual(take(b, 5));
    expect(take(forkA, 5)).toEqual(take(new Rng(5).fork('caves'), 5));
    expect(take(new Rng(5).fork('caves'), 5)).not.toEqual(take(new Rng(5).fork('ores'), 5));
  });

  it('shuffle() keeps every element', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = new Rng(3).shuffle([...items]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('rejects an all-zero state', () => {
    expect(() => Rng.fromState([0, 0, 0, 0])).toThrow();
  });
});

describe('hashString', () => {
  it('is stable and spreads similar strings apart', () => {
    expect(hashString('gatewright')).toBe(hashString('gatewright'));
    expect(hashString('seed1')).not.toBe(hashString('seed2'));
    expect(hashString('')).toBe(0x811c9dc5);
  });
});
