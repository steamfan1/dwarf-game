/**
 * The game's content, loaded from src/data/*.json and validated once at startup.
 * A mistake in a JSON file stops the game with a message naming the file and field,
 * rather than causing odd behaviour later.
 *
 * Each file is checked on its own when it's parsed; `checkLinks` then checks the ids
 * the files use to refer to each other (a block's drop, what an item builds, a wall's
 * material, a recipe's station...).
 */
import biomesJson from '../data/biomes.json';
import dwarvesJson from '../data/dwarves.json';
import furnitureJson from '../data/furniture.json';
import itemsJson from '../data/items.json';
import recipesJson from '../data/recipes.json';
import tilesJson from '../data/tiles.json';
import worldgenJson from '../data/worldgen.json';
import { RecipeBook } from './crafting/Recipes';
import { parseColonySettings, type ColonySettings } from './dwarves/settings';
import { FurnitureRegistry } from './furniture/FurnitureRegistry';
import { ItemRegistry } from './items/ItemRegistry';
import { TileRegistry } from './world/TileRegistry';
import { parseBiomes, parseWorldgenSettings } from './worldgen/settings';

export const TILES = TileRegistry.fromJson(tilesJson);
export const ITEMS = ItemRegistry.fromJson(itemsJson);
export const FURNITURE = FurnitureRegistry.fromJson(furnitureJson);
export const RECIPES = RecipeBook.fromJson(recipesJson, ITEMS, FURNITURE.stations);
export const BIOMES = parseBiomes(biomesJson, TILES);
export const WORLDGEN = parseWorldgenSettings(worldgenJson, TILES);
export const COLONY = parseColonySettings(dwarvesJson);

checkLinks(TILES, ITEMS, FURNITURE);

/** The content a running world uses (tests can swap in their own). */
export interface GameContent {
  tiles: TileRegistry;
  items: ItemRegistry;
  furniture: FurnitureRegistry;
  recipes: RecipeBook;
  colony: ColonySettings;
}

export const CONTENT: GameContent = { tiles: TILES, items: ITEMS, furniture: FURNITURE, recipes: RECIPES, colony: COLONY };

/**
 * Check the ids the content files use to refer to each other, so a typo fails at start-up
 * instead of when a dwarf first digs that block or builds that chair.
 */
export function checkLinks(tiles: TileRegistry, items: ItemRegistry, furniture: FurnitureRegistry): void {
  const problems: string[] = [];
  for (const tile of tiles.tiles) {
    if (tile.drops !== null && !items.has(tile.drops)) problems.push(`tile "${tile.id}" drops "${tile.drops}", which is not in items.json`);
  }
  for (const wall of tiles.walls) {
    if (wall.material !== null && !items.has(wall.material)) problems.push(`wall "${wall.id}" is built from "${wall.material}", which is not in items.json`);
  }
  const builtBy = new Map<string, string[]>();
  for (const item of items.items) {
    const target = item.builds;
    if (!target) continue;
    if ('tile' in target) {
      if (!tiles.hasTile(target.tile)) problems.push(`item "${item.id}" builds tile "${target.tile}", which is not in tiles.json`);
      else if (tiles.tiles[tiles.tile(target.tile)]!.drops !== item.id) {
        problems.push(`item "${item.id}" builds tile "${target.tile}", which should drop "${item.id}" when dug (so nothing is lost)`);
      }
    } else if (!furniture.has(target.furniture)) {
      problems.push(`item "${item.id}" builds furniture "${target.furniture}", which is not in furniture.json`);
    } else {
      builtBy.set(target.furniture, [...(builtBy.get(target.furniture) ?? []), item.id]);
    }
  }
  for (const def of furniture.defs) {
    const by = builtBy.get(def.id) ?? [];
    if (by.length !== 1) problems.push(`furniture "${def.id}" must be built by exactly one item, but ${by.length === 0 ? 'none is' : `${by.join(', ')} are`}`);
  }
  if (problems.length > 0) {
    throw new Error(`The content files have ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}
