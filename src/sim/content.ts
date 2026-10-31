/**
 * The game's content, loaded from src/data/*.json and validated once at startup.
 * A mistake in a JSON file stops the game with a message naming the file and field,
 * rather than causing odd behaviour later.
 */
import biomesJson from '../data/biomes.json';
import tilesJson from '../data/tiles.json';
import worldgenJson from '../data/worldgen.json';
import { TileRegistry } from './world/TileRegistry';
import { parseBiomes, parseWorldgenSettings } from './worldgen/settings';

export const TILES = TileRegistry.fromJson(tilesJson);
export const BIOMES = parseBiomes(biomesJson, TILES);
export const WORLDGEN = parseWorldgenSettings(worldgenJson, TILES);
