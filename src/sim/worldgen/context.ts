/**
 * Shared state for the world-generation steps: the world being built, the content and
 * settings, the base materials the code refers to by name, and depth helpers.
 */
import { hashString, type Rng } from '../../core/Rng';
import type { TileRegistry } from '../world/TileRegistry';
import type { World } from '../world/World';
import type { BiomeDef, WorldgenSettings } from './settings';

export interface GenContext {
  world: World;
  tiles: TileRegistry;
  biome: BiomeDef;
  settings: WorldgenSettings;
  /** Root generator; each step forks its own stream from it. */
  rng: Rng;
  /** Numeric seed for the noise functions. */
  noiseSeed: number;
  /** Base materials the generator places by name. */
  ids: {
    dirt: number;
    stone: number;
    deepStone: number;
    basalt: number;
    bedrock: number;
    clay: number;
    sand: number;
    mushroom: number;
    water: number;
    lava: number;
  };
  walls: { dirt: number; stone: number; deepStone: number; basalt: number };
  /** Filled in by the terrain step. */
  heights: Int16Array;
  spawnX: number;
  /** Average surface row, the zero point for depth fractions. */
  surfaceMean: number;
  /** First row of the bedrock layer in each column. */
  bedrockTop: Int16Array;
}

export function createContext(world: World, tiles: TileRegistry, biome: BiomeDef, settings: WorldgenSettings, rng: Rng): GenContext {
  return {
    world,
    tiles,
    biome,
    settings,
    rng,
    noiseSeed: hashString(`${world.seed}:noise`) | 0,
    ids: {
      dirt: tiles.tile('dirt'),
      stone: tiles.tile('stone'),
      deepStone: tiles.tile('deep_stone'),
      basalt: tiles.tile('basalt'),
      bedrock: tiles.tile('bedrock'),
      clay: tiles.tile('clay'),
      sand: tiles.tile('sand'),
      mushroom: tiles.tile('mushroom'),
      water: tiles.liquid('water'),
      lava: tiles.liquid('lava'),
    },
    walls: {
      dirt: tiles.wall('dirt_wall'),
      stone: tiles.wall('stone_wall'),
      deepStone: tiles.wall('deep_stone_wall'),
      basalt: tiles.wall('basalt_wall'),
    },
    heights: new Int16Array(world.width),
    spawnX: Math.floor(world.width / 2),
    surfaceMean: 0,
    bedrockTop: new Int16Array(world.width).fill(world.height),
  };
}

/** How deep a row is, from 0 at the average surface to 1 at the bottom of the world. */
export function depthFraction(ctx: GenContext, y: number): number {
  return Math.max(0, Math.min(1, (y - ctx.surfaceMean) / (ctx.world.height - ctx.surfaceMean)));
}

/** The row at a given depth fraction. */
export function rowAtDepth(ctx: GenContext, fraction: number): number {
  return Math.round(ctx.surfaceMean + fraction * (ctx.world.height - ctx.surfaceMean));
}

/** Call `fn` for every cell inside a roughly round blob, with a slightly ragged edge. */
export function forEachInBlob(
  ctx: GenContext,
  cx: number,
  cy: number,
  radius: number,
  rng: Rng,
  fn: (x: number, y: number, index: number) => void,
): void {
  const { world } = ctx;
  const r = Math.ceil(radius + 1);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!world.inBounds(x, y)) continue;
      const jitter = (rng.next() - 0.5) * 1.1;
      if (withinEllipse(x - cx, y - cy, radius + jitter, radius + jitter)) fn(x, y, world.index(x, y));
    }
  }
}

/**
 * Whether (dx, dy) lies strictly inside an axis-aligned ellipse with radii rx and ry.
 *
 * World generation compares squared distances instead of calling Math.hypot, Math.pow or
 * `**`: those may round differently from one browser engine to another, while +, -, *
 * and / are exact under IEEE 754. That keeps a seed producing the same world in Chrome,
 * Firefox and Safari. (The architecture test enforces this for all game logic.)
 */
export function withinEllipse(dx: number, dy: number, rx: number, ry: number): boolean {
  const nx = dx / rx;
  const ny = dy / ry;
  return nx * nx + ny * ny <= 1;
}
