/**
 * Builds a complete world from a seed and a biome. Pure and deterministic: the same
 * inputs give an identical world on every machine. Runs inside a Web Worker in the game
 * (see src/workers/worldgen.worker.ts) and directly in unit tests.
 *
 * Steps, in order: terrain shape and layers, material blobs, caves, surface pools,
 * underground lakes and lava, ore veins, vegetation, then the spawn point.
 */
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { Rng } from '../../core/Rng';
import { BIOMES, TILES, WORLDGEN } from '../content';
import { World, type WorldSnapshot } from '../world/World';
import { carveCaves } from './caves';
import { createContext } from './context';
import { digSurfacePools, fillLakes } from './liquids';
import { placeOres } from './ores';
import { fillTerrain, scatterBlobs, shapeSurface } from './terrain';
import { growVegetation } from './vegetation';

export interface WorldGenOptions {
  seed: string;
  biome: string;
  width?: number;
  height?: number;
}

export type WorldGenStage = 'terrain' | 'caves' | 'water' | 'ores' | 'plants' | 'finishing';

/** Reports progress: the stage about to run and overall completion from 0 to 1. */
export type ProgressCallback = (stage: WorldGenStage, progress: number) => void;

export interface WorldGenStats {
  caves: number;
  caveCells: number;
  tunnels: number;
  lakes: number;
  lavaPools: number;
  surfacePools: number;
  trees: number;
  decorations: number;
  mushrooms: number;
  /** Cells of each ore, keyed by tile id string. */
  ores: Record<string, number>;
  milliseconds: number;
}

export interface WorldGenResult {
  snapshot: WorldSnapshot;
  stats: WorldGenStats;
}

export function generateWorld(options: WorldGenOptions, onProgress: ProgressCallback = () => {}): WorldGenResult {
  const started = Date.now();
  const width = options.width ?? WORLD_WIDTH;
  const height = options.height ?? WORLD_HEIGHT;
  const biome = BIOMES.get(options.biome);
  const world = World.empty(width, height, options.seed, biome.id);
  const ctx = createContext(world, TILES, biome, WORLDGEN, new Rng(options.seed));

  onProgress('terrain', 0);
  shapeSurface(ctx);
  fillTerrain(ctx);
  scatterBlobs(ctx);

  onProgress('caves', 0.2);
  const caves = carveCaves(ctx);

  onProgress('water', 0.5);
  const surfacePools = digSurfacePools(ctx);
  const { lakes, lavaPools } = fillLakes(ctx);

  onProgress('ores', 0.65);
  const ores = placeOres(ctx);

  onProgress('plants', 0.8);
  const vegetation = growVegetation(ctx);

  onProgress('finishing', 0.95);
  // The Hearth stands on the flat ground in the spawn area; the dwarves start beside it.
  // Nothing is explored yet: when the game starts, whatever light reaches is (see Lighting).
  world.spawn = { x: ctx.spawnX, y: ctx.heights[ctx.spawnX]! - 1 };

  return {
    snapshot: world.toSnapshot(),
    stats: {
      caves: caves.caves,
      caveCells: caves.openCells,
      tunnels: caves.tunnels,
      lakes,
      lavaPools,
      surfacePools,
      trees: vegetation.trees,
      decorations: vegetation.decorations,
      mushrooms: vegetation.mushrooms,
      ores: Object.fromEntries([...ores].map(([tile, cells]) => [TILES.tiles[tile]!.id, cells])),
      milliseconds: Date.now() - started,
    },
  };
}
