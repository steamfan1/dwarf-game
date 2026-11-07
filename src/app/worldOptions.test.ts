import { describe, expect, it } from 'vitest';
import { randomSeed, worldOptionsFromQuery } from './worldOptions';

describe('randomSeed', () => {
  it('makes word seeds like "mossy-cavern-17"', () => {
    expect(randomSeed(() => 0)).toBe('amber-anvil-1');
    expect(randomSeed(() => 0.999999)).toMatch(/^winter-well-99$/);
    for (let i = 0; i < 50; i++) expect(randomSeed(Math.random)).toMatch(/^[a-z]+-[a-z]+-\d{1,2}$/);
  });
});

const BIOMES = ['temperate', 'snow'];
const random = (): string => 'random-seed';

describe('worldOptionsFromQuery', () => {
  it('defaults to a random seed in the temperate biome, fog on', () => {
    expect(worldOptionsFromQuery('', BIOMES, random)).toEqual({ seed: 'random-seed', biome: 'temperate', reveal: false, hour: null, forcedBiome: null });
  });

  it('reads seed, biome and reveal from the address', () => {
    expect(worldOptionsFromQuery('?seed=mossy&biome=SNOW&reveal=1&hour=22', BIOMES, random)).toEqual({ seed: 'mossy', biome: 'snow', reveal: true, hour: 22, forcedBiome: 'snow' });
    expect(worldOptionsFromQuery('?hour=25', BIOMES, random).hour).toBeNull();
    expect(worldOptionsFromQuery('?reveal', BIOMES, random).reveal).toBe(true);
  });

  it('ignores unknown biomes and blank seeds', () => {
    expect(worldOptionsFromQuery('?seed=%20&biome=lava', BIOMES, random)).toEqual({ seed: 'random-seed', biome: 'temperate', reveal: false, hour: null, forcedBiome: null });
  });
});
