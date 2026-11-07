import { describe, expect, it } from 'vitest';
import { SafeKeyValueStore } from '../platform/storage';
import { CAMPAIGN_STORAGE_KEY, loadCampaign, nextBiome, saveCampaign, winWorld } from './campaign';

const BIOMES = ['temperate', 'snow'];

function memoryStore(initial: Record<string, string> = {}): SafeKeyValueStore {
  const map = new Map(Object.entries(initial));
  return new SafeKeyValueStore(() => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }));
}

describe('the campaign', () => {
  it('starts in the first biome, and reads back what was saved', () => {
    const store = memoryStore();
    expect(loadCampaign(store, BIOMES)).toEqual({ unlockedBiomes: ['temperate'], worldsWon: 0 });
    saveCampaign(store, { unlockedBiomes: ['temperate', 'snow'], worldsWon: 1 });
    expect(loadCampaign(store, BIOMES)).toEqual({ unlockedBiomes: ['temperate', 'snow'], worldsWon: 1 });
  });

  it('shrugs off damaged or strange data', () => {
    expect(loadCampaign(memoryStore({ [CAMPAIGN_STORAGE_KEY]: '{oops' }), BIOMES).unlockedBiomes).toEqual(['temperate']);
    const odd = memoryStore({ [CAMPAIGN_STORAGE_KEY]: JSON.stringify({ unlockedBiomes: ['lava', 7, 'snow'], worldsWon: -3 }) });
    expect(loadCampaign(odd, BIOMES)).toEqual({ unlockedBiomes: ['temperate', 'snow'], worldsWon: 0 });
  });

  it('opens the next biome with each world won, then just counts the wins', () => {
    const first = winWorld({ unlockedBiomes: ['temperate'], worldsWon: 0 }, 'temperate', BIOMES);
    expect(first).toEqual({ campaign: { unlockedBiomes: ['temperate', 'snow'], worldsWon: 1 }, opened: 'snow' });
    const second = winWorld(first.campaign, 'snow', BIOMES);
    expect(second).toEqual({ campaign: { unlockedBiomes: ['temperate', 'snow'], worldsWon: 2 }, opened: null });
    expect(nextBiome(first.campaign, 'temperate', BIOMES)).toBe('snow');
    expect(nextBiome(first.campaign, 'snow', BIOMES)).toBe('temperate');
    expect(nextBiome({ unlockedBiomes: ['temperate'], worldsWon: 0 }, 'temperate', BIOMES)).toBe('temperate');
  });
});
