import { describe, expect, it } from 'vitest';
import { fractal1D, fractal2D, hash2, valueNoise1D, valueNoise2D } from './noise';

describe('noise', () => {
  it('hash2 is deterministic, in [0, 1), and sensitive to every input', () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    for (const [x, y, s] of [[0, 0, 0], [-7, 9, 1], [123456, -98765, 42]] as const) {
      const v = hash2(x, y, s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(3, 4, 6));
  });

  it('value noise passes through the lattice values and changes smoothly between them', () => {
    expect(valueNoise1D(7, 1)).toBeCloseTo(hash2(7, 0, 1), 10);
    let previous = valueNoise1D(0, 9);
    for (let x = 0.01; x < 20; x += 0.01) {
      const v = valueNoise1D(x, 9);
      expect(Math.abs(v - previous)).toBeLessThan(0.05);
      previous = v;
    }
    expect(valueNoise2D(2, 3, 1)).toBeCloseTo(hash2(2, 3, 1), 10);
  });

  it('fractal noise stays in [0, 1)', () => {
    for (let i = 0; i < 2000; i++) {
      const a = fractal1D(i * 0.37, 5, { octaves: 4, frequency: 1 / 40 });
      const b = fractal2D(i * 0.37, i * 0.11, 5, { octaves: 3, frequency: 1 / 30 });
      for (const v of [a, b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});
