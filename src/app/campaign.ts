/**
 * Campaign progress, kept per browser: which biomes are open. A new player starts in the
 * forest; every World Gate a colony builds opens the next biome in biomes.json's order.
 *
 * Stored as a small JSON string under one localStorage key (through SafeKeyValueStore, so
 * blocked storage only means progress isn't kept between visits).
 */
import type { KeyValueStore } from '../platform/storage';

export const CAMPAIGN_STORAGE_KEY = 'gatewright.campaign';

export interface Campaign {
  /** Biomes that can be picked for a new world, in biomes.json's order. */
  unlockedBiomes: string[];
  /** World Gates built, in any world. */
  worldsWon: number;
}

/** Read the campaign; anything missing or unreadable starts afresh, with the first biome open. */
export function loadCampaign(store: KeyValueStore, biomes: readonly string[]): Campaign {
  let raw: unknown = null;
  try {
    raw = JSON.parse(store.getItem(CAMPAIGN_STORAGE_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const listed = Array.isArray(o.unlockedBiomes) ? o.unlockedBiomes.filter((id): id is string => typeof id === 'string') : [];
  const unlocked = biomes.filter((id, i) => i === 0 || listed.includes(id));
  const won = typeof o.worldsWon === 'number' && Number.isFinite(o.worldsWon) ? Math.max(0, Math.floor(o.worldsWon)) : 0;
  return { unlockedBiomes: unlocked, worldsWon: won };
}

export function saveCampaign(store: KeyValueStore, campaign: Campaign): void {
  store.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaign));
}

/**
 * A World Gate was built in a world of `biome`: count the win and open the next biome that
 * isn't open yet (the one after `biome` first). Returns the new campaign and the biome
 * opened, or null if every biome was open already.
 */
export function winWorld(campaign: Campaign, biome: string, biomes: readonly string[]): { campaign: Campaign; opened: string | null } {
  const start = Math.max(0, biomes.indexOf(biome));
  let opened: string | null = null;
  for (let step = 1; step <= biomes.length; step++) {
    const candidate = biomes[(start + step) % biomes.length]!;
    if (!campaign.unlockedBiomes.includes(candidate)) {
      opened = candidate;
      break;
    }
  }
  const unlocked = opened ? biomes.filter((id) => id === opened || campaign.unlockedBiomes.includes(id)) : campaign.unlockedBiomes;
  return { campaign: { unlockedBiomes: unlocked, worldsWon: campaign.worldsWon + 1 }, opened };
}

/** The biome a gate leads to: the next one in the list that's open, after `biome`. */
export function nextBiome(campaign: Campaign, biome: string, biomes: readonly string[]): string {
  const start = Math.max(0, biomes.indexOf(biome));
  for (let step = 1; step <= biomes.length; step++) {
    const candidate = biomes[(start + step) % biomes.length]!;
    if (campaign.unlockedBiomes.includes(candidate)) return candidate;
  }
  return biome;
}
