/**
 * The game's content, loaded from src/data/*.json and validated once at startup.
 * A mistake in a JSON file stops the game with a message naming the file and field,
 * rather than causing odd behaviour later.
 */
import biomesJson from '../data/biomes.json';
import dwarvesJson from '../data/dwarves.json';
import itemsJson from '../data/items.json';
import tilesJson from '../data/tiles.json';
import worldgenJson from '../data/worldgen.json';
import { parseColonySettings, type ColonySettings } from './dwarves/settings';
import { ItemRegistry } from './items/ItemRegistry';
import { TileRegistry } from './world/TileRegistry';
import { parseBiomes, parseWorldgenSettings } from './worldgen/settings';

export const TILES = TileRegistry.fromJson(tilesJson);
export const ITEMS = ItemRegistry.fromJson(itemsJson);
export const BIOMES = parseBiomes(biomesJson, TILES);
export const WORLDGEN = parseWorldgenSettings(worldgenJson, TILES);
export const COLONY = parseColonySettings(dwarvesJson);

checkDrops(TILES, ITEMS);

/** The content a running world uses (tests can swap in their own). */
export interface GameContent {
  tiles: TileRegistry;
  items: ItemRegistry;
  colony: ColonySettings;
}

export const CONTENT: GameContent = { tiles: TILES, items: ITEMS, colony: COLONY };

/** Every block's `drops` must name an item, or digging it would fail at runtime. */
export function checkDrops(tiles: TileRegistry, items: ItemRegistry): void {
  const missing = tiles.tiles.filter((tile) => tile.drops !== null && !items.has(tile.drops));
  if (missing.length > 0) {
    const list = missing.map((tile) => `  - tile "${tile.id}" drops "${tile.drops}", which is not in items.json`).join('\n');
    throw new Error(`tiles.json has ${missing.length} problem(s):\n${list}`);
  }
}
