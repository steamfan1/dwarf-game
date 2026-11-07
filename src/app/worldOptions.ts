/**
 * Options for a new world. The New world dialog starts from a random seed and the
 * temperate biome; for testing and sharing worlds, the page address can preset them:
 *
 *   ?seed=mossy-cavern      a specific world (the same seed always gives the same world)
 *   ?biome=snow             start in another biome, even one the campaign hasn't opened yet
 *   ?reveal=1               lift the fog of war over the whole map
 *   ?hour=22                start at that hour (0-23) instead of the morning: 22 is night
 */
export interface NewWorldOptions {
  seed: string;
  biome: string;
  reveal: boolean;
  /** The hour to start at, or null for the usual morning. */
  hour: number | null;
  /** The biome the address named, if it named a known one (it can be picked even while locked). */
  forcedBiome: string | null;
}

export const DEFAULT_BIOME = 'temperate';

/** Pure: reads options from a query string such as `location.search`. */
export function worldOptionsFromQuery(query: string, knownBiomes: readonly string[], randomSeed: () => string): NewWorldOptions {
  const params = new URLSearchParams(query);
  const seed = params.get('seed')?.trim().slice(0, 64);
  const biome = params.get('biome')?.trim().toLowerCase();
  const reveal = params.get('reveal');
  const hour = Number.parseFloat(params.get('hour') ?? '');
  return {
    seed: seed || randomSeed(),
    biome: biome && knownBiomes.includes(biome) ? biome : DEFAULT_BIOME,
    reveal: reveal === '1' || reveal === 'true' || reveal === '',
    hour: Number.isFinite(hour) && hour >= 0 && hour < 24 ? hour : null,
    forcedBiome: biome && knownBiomes.includes(biome) ? biome : null,
  };
}

const SEED_ADJECTIVES = [
  'amber', 'ashen', 'autumn', 'bitter', 'bright', 'copper', 'crooked', 'deep', 'dusky', 'elder',
  'ember', 'frosty', 'gilded', 'granite', 'hidden', 'hollow', 'iron', 'jagged', 'lonely', 'misty',
  'mossy', 'northern', 'old', 'quiet', 'rusty', 'silent', 'silver', 'stony', 'sunken', 'tall',
  'twin', 'wild', 'windy', 'winter',
];
const SEED_NOUNS = [
  'anvil', 'barrow', 'brook', 'cairn', 'cavern', 'crag', 'dell', 'delve', 'fen', 'ford',
  'forge', 'glen', 'hearth', 'hill', 'knoll', 'ledge', 'marsh', 'mine', 'peak', 'pine',
  'quarry', 'ridge', 'root', 'shaft', 'spring', 'tarn', 'vale', 'vault', 'warren', 'well',
];

/**
 * A fresh, easy-to-share world seed such as "mossy-cavern-17". `random` returns a float
 * in [0, 1); it is a parameter so tests can make it predictable.
 */
export function randomSeed(random: () => number = cryptoRandom): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  return `${pick(SEED_ADJECTIVES)}-${pick(SEED_NOUNS)}-${1 + Math.floor(random() * 99)}`;
}

function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
}
