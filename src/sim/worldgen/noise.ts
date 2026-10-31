/**
 * Deterministic hashing and value noise for world generation.
 *
 * Value noise: random values on an integer lattice, smoothly interpolated in between.
 * Summing several octaves (fractal Brownian motion) gives natural-looking hills and
 * strata. Everything is a pure function of its inputs and a numeric seed, so the same
 * seed always produces the same world on every browser.
 */

/** Hash of two integers and a seed to a float in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Quintic ease (6t^5 - 15t^4 + 10t^3): smooth value and slope at lattice points. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function valueNoise1D(x: number, seed: number): number {
  const xi = Math.floor(x);
  const t = fade(x - xi);
  const a = hash2(xi, 0, seed);
  const b = hash2(xi + 1, 0, seed);
  return a + (b - a) * t;
}

export function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

export interface FractalOptions {
  octaves: number;
  /** Lattice cells per tile of the first octave, e.g. 1/48 for features ~48 tiles wide. */
  frequency: number;
  /** Amplitude multiplier per octave (default 0.5). */
  gain?: number;
  /** Frequency multiplier per octave (default 2). */
  lacunarity?: number;
}

/** Fractal 1D value noise, normalised to [0, 1). */
export function fractal1D(x: number, seed: number, options: FractalOptions): number {
  const { octaves, frequency, gain = 0.5, lacunarity = 2 } = options;
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let freq = frequency;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise1D(x * freq, seed + o * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Fractal 2D value noise, normalised to [0, 1). */
export function fractal2D(x: number, y: number, seed: number, options: FractalOptions): number {
  const { octaves, frequency, gain = 0.5, lacunarity = 2 } = options;
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let freq = frequency;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2D(x * freq, y * freq, seed + o * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
