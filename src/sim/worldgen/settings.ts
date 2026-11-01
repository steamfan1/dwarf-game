/**
 * Biome definitions (src/data/biomes.json) and world-generation tuning
 * (src/data/worldgen.json), validated against the tile registry so a misspelt tile id
 * fails at startup with a clear message.
 */
import { Validator } from '../../core/validate';
import type { TileRegistry } from '../world/TileRegistry';

export type TreeShape = 'broadleaf' | 'conifer';

export interface BiomeDef {
  id: string;
  name: string;
  /** One line for the New world dialog. */
  description: string;
  /** Top block of the land (grass, snow). */
  surfaceTile: number;
  /** Ground below the surface down to the stone. */
  soilTile: number;
  /** Optional layer under the surface tile (snow over dirt). */
  capTile: number | null;
  capDepth: [number, number];
  trees: {
    log: number;
    leaves: number;
    shape: TreeShape;
    /** Chance per suitable column of starting a tree. */
    chance: number;
    minSpacing: number;
    height: [number, number];
  };
  decorations: Array<{ tile: number; chance: number }>;
  pools: { liquid: number; frozenTop: number | null; shore: number | null; count: [number, number] };
  sky: { top: string; bottom: string };
}

export interface OreRule {
  tile: number;
  /** Only this block is turned into ore, so veins blend with the surrounding rock. */
  host: number;
  /** Depth as a fraction of the way from the average surface (0) to the bottom (1). */
  minDepth: number;
  maxDepth: number;
  veins: number;
  size: [number, number];
}

export interface WorldgenSettings {
  surface: {
    baseDepth: number;
    hillAmplitude: number;
    mountainAmplitude: number;
    minY: number;
    maxY: number;
    spawnFlatRadius: number;
    spawnBlend: number;
  };
  bands: {
    soilDepth: [number, number];
    deepStoneAt: number;
    basaltAt: number;
    bedrockRows: number;
  };
  blobs: { clay: number; dirtInStone: number };
  caves: {
    startBelowSurface: number;
    openChanceTop: number;
    openChanceBottom: number;
    /** How much the open chance swings between cave-rich and solid regions. */
    regionalVariation: number;
    smoothingPasses: number;
    minCaveSize: number;
    spawnClearRadius: number;
    tunnels: number;
  };
  liquids: { lakeChance: number; minLakeRegion: number; lavaFrom: number; lavaChance: number };
  ores: OreRule[];
  decorations: { caveMushroomChance: number };
}

export class BiomeRegistry {
  readonly list: readonly BiomeDef[];

  constructor(list: BiomeDef[]) {
    this.list = list;
  }

  get ids(): string[] {
    return this.list.map((b) => b.id);
  }

  has(id: string): boolean {
    return this.list.some((b) => b.id === id);
  }

  get(id: string): BiomeDef {
    const biome = this.list.find((b) => b.id === id);
    if (!biome) throw new Error(`Unknown biome "${id}"`);
    return biome;
  }
}

function tileRef(v: Validator, tiles: TileRegistry, value: unknown, path: string): number {
  const id = v.identifier(value, path);
  if (id && !tiles.hasTile(id)) {
    v.problem(`${path} refers to unknown tile "${id}"`);
    return 0;
  }
  return id ? tiles.tile(id) : 0;
}

function optionalTileRef(v: Validator, tiles: TileRegistry, value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : tileRef(v, tiles, value, path);
}

export function parseBiomes(data: unknown, tiles: TileRegistry): BiomeRegistry {
  const v = new Validator('biomes.json');
  const root = v.object(data, '');
  const list = v.array(root?.biomes, 'biomes').map((raw, i): BiomeDef => {
    const p = `biomes[${i}]`;
    const o = v.object(raw, p);
    const trees = v.object(o?.trees, `${p}.trees`);
    const pools = v.object(o?.pools, `${p}.pools`);
    const sky = v.object(o?.sky, `${p}.sky`);
    const liquidId = v.identifier(pools?.liquid, `${p}.pools.liquid`);
    if (liquidId && !tiles.hasLiquid(liquidId)) v.problem(`${p}.pools.liquid refers to unknown liquid "${liquidId}"`);
    return {
      id: v.identifier(o?.id, `${p}.id`),
      name: v.string(o?.name, `${p}.name`),
      description: v.string(o?.description, `${p}.description`),
      surfaceTile: tileRef(v, tiles, o?.surfaceTile, `${p}.surfaceTile`),
      soilTile: tileRef(v, tiles, o?.soilTile, `${p}.soilTile`),
      capTile: optionalTileRef(v, tiles, o?.capTile, `${p}.capTile`),
      capDepth: v.range(o?.capDepth, `${p}.capDepth`, 0, 10),
      trees: {
        log: tileRef(v, tiles, trees?.log, `${p}.trees.log`),
        leaves: tileRef(v, tiles, trees?.leaves, `${p}.trees.leaves`),
        shape: v.oneOf(trees?.shape, ['broadleaf', 'conifer'] as const, `${p}.trees.shape`) ?? 'broadleaf',
        chance: v.number(trees?.chance, `${p}.trees.chance`, 0, 1),
        minSpacing: v.number(trees?.minSpacing, `${p}.trees.minSpacing`, 1, 50),
        height: v.range(trees?.height, `${p}.trees.height`, 1, 20),
      },
      decorations: v.array(o?.decorations, `${p}.decorations`).map((d, j) => {
        const dec = v.object(d, `${p}.decorations[${j}]`);
        return {
          tile: tileRef(v, tiles, dec?.tile, `${p}.decorations[${j}].tile`),
          chance: v.number(dec?.chance, `${p}.decorations[${j}].chance`, 0, 1),
        };
      }),
      pools: {
        liquid: liquidId && tiles.hasLiquid(liquidId) ? tiles.liquid(liquidId) : 0,
        frozenTop: optionalTileRef(v, tiles, pools?.frozenTop, `${p}.pools.frozenTop`),
        shore: optionalTileRef(v, tiles, pools?.shore, `${p}.pools.shore`),
        count: v.range(pools?.count, `${p}.pools.count`, 0, 20),
      },
      sky: { top: v.color(sky?.top, `${p}.sky.top`), bottom: v.color(sky?.bottom, `${p}.sky.bottom`) },
    };
  });
  if (list.length === 0) v.problem('biomes must list at least one biome');
  v.unique(list.map((b) => b.id), 'biome id');
  v.throwIfProblems();
  return new BiomeRegistry(list);
}

export function parseWorldgenSettings(data: unknown, tiles: TileRegistry): WorldgenSettings {
  const v = new Validator('worldgen.json');
  const root = v.object(data, '');
  const section = (name: string): Record<string, unknown> | undefined => v.object(root?.[name], name);
  const s = section('surface');
  const b = section('bands');
  const blobs = section('blobs');
  const c = section('caves');
  const l = section('liquids');
  const d = section('decorations');
  const fraction = (o: Record<string, unknown> | undefined, key: string, path: string): number =>
    v.number(o?.[key], `${path}.${key}`, 0, 1);
  const count = (o: Record<string, unknown> | undefined, key: string, path: string, max = 1000): number =>
    v.number(o?.[key], `${path}.${key}`, 0, max);

  const settings: WorldgenSettings = {
    surface: {
      baseDepth: fraction(s, 'baseDepth', 'surface'),
      hillAmplitude: count(s, 'hillAmplitude', 'surface', 60),
      mountainAmplitude: count(s, 'mountainAmplitude', 'surface', 60),
      minY: count(s, 'minY', 'surface', 1000),
      maxY: count(s, 'maxY', 'surface', 1000),
      spawnFlatRadius: count(s, 'spawnFlatRadius', 'surface', 50),
      spawnBlend: count(s, 'spawnBlend', 'surface', 50),
    },
    bands: {
      soilDepth: v.range(b?.soilDepth, 'bands.soilDepth', 1, 100),
      deepStoneAt: fraction(b, 'deepStoneAt', 'bands'),
      basaltAt: fraction(b, 'basaltAt', 'bands'),
      bedrockRows: count(b, 'bedrockRows', 'bands', 20),
    },
    blobs: { clay: count(blobs, 'clay', 'blobs'), dirtInStone: count(blobs, 'dirtInStone', 'blobs') },
    caves: {
      startBelowSurface: count(c, 'startBelowSurface', 'caves', 100),
      openChanceTop: fraction(c, 'openChanceTop', 'caves'),
      openChanceBottom: fraction(c, 'openChanceBottom', 'caves'),
      regionalVariation: fraction(c, 'regionalVariation', 'caves'),
      smoothingPasses: count(c, 'smoothingPasses', 'caves', 20),
      minCaveSize: count(c, 'minCaveSize', 'caves', 1000),
      spawnClearRadius: count(c, 'spawnClearRadius', 'caves', 100),
      tunnels: count(c, 'tunnels', 'caves', 50),
    },
    liquids: {
      lakeChance: fraction(l, 'lakeChance', 'liquids'),
      minLakeRegion: count(l, 'minLakeRegion', 'liquids', 100000),
      lavaFrom: fraction(l, 'lavaFrom', 'liquids'),
      lavaChance: fraction(l, 'lavaChance', 'liquids'),
    },
    ores: v.array(root?.ores, 'ores').map((raw, i) => {
      const p = `ores[${i}]`;
      const o = v.object(raw, p);
      return {
        tile: tileRef(v, tiles, o?.tile, `${p}.tile`),
        host: tileRef(v, tiles, o?.host, `${p}.host`),
        minDepth: fraction(o, 'minDepth', p),
        maxDepth: fraction(o, 'maxDepth', p),
        veins: count(o, 'veins', p, 10000),
        size: v.range(o?.size, `${p}.size`, 1, 100),
      };
    }),
    decorations: { caveMushroomChance: fraction(d, 'caveMushroomChance', 'decorations') },
  };
  if (settings.surface.minY >= settings.surface.maxY) v.problem('surface.minY must be below surface.maxY');
  settings.ores.forEach((ore, i) => {
    if (ore.minDepth >= ore.maxDepth) v.problem(`ores[${i}] needs minDepth < maxDepth`);
  });
  v.throwIfProblems();
  return settings;
}
