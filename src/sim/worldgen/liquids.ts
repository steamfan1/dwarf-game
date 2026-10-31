/**
 * Step 3: water and lava.
 *
 *  - Underground lakes: some enclosed caves are partly flooded from the bottom up to a
 *    level line, so water always rests flat on rock. Caves near the bottom of the world
 *    hold lava instead.
 *  - Surface pools: shallow bowls dug into valleys and filled to the lower rim, with a
 *    sandy shore in temperate worlds or an ice crust in frozen ones.
 *
 * Liquids are static for now; flowing water is an optional later milestone, and the
 * world already stores liquid amounts for it.
 */
import { AIR } from '../world/TileRegistry';
import { LIQUID_FULL } from '../world/World';
import { labelRegions } from './caves';
import { depthFraction, type GenContext } from './context';

export interface LiquidStats {
  lakes: number;
  lavaPools: number;
  surfacePools: number;
}

export function fillLakes(ctx: GenContext): { lakes: number; lavaPools: number } {
  const { world, settings, ids } = ctx;
  const rng = ctx.rng.fork('lakes');
  const width = world.width;

  // Open cells under the original surface.
  const cave = new Uint8Array(world.fg.length);
  for (let i = 0; i < cave.length; i++) {
    const x = i % width;
    const y = (i - x) / width;
    if (world.fg[i] === AIR && y > world.surface[x]!) cave[i] = 1;
  }

  let lakes = 0;
  let lavaPools = 0;
  for (const region of labelRegions(cave, width, world.height)) {
    if (region.length < settings.liquids.minLakeRegion) continue;
    if (region.some((i) => touchesSky(ctx, i))) continue; // only sealed caves hold still water

    let top = Infinity;
    let bottom = -Infinity;
    for (const i of region) {
      const y = Math.floor(i / width);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    const isLava = depthFraction(ctx, bottom) >= settings.liquids.lavaFrom;
    if (!rng.chance(isLava ? settings.liquids.lavaChance : settings.liquids.lakeChance)) continue;

    const fill = Math.max(2, Math.round((bottom - top + 1) * rng.range(0.25, 0.45)));
    const level = bottom - fill + 1;
    for (const i of region) {
      if (Math.floor(i / width) < level) continue;
      world.liquidType[i] = isLava ? ids.lava : ids.water;
      world.liquidAmount[i] = LIQUID_FULL;
    }
    if (isLava) lavaPools++;
    else lakes++;
  }
  return { lakes, lavaPools };
}

function touchesSky(ctx: GenContext, i: number): boolean {
  const { world } = ctx;
  const x = i % world.width;
  const y = (i - x) / world.width;
  const neighbours: Array<[number, number]> = [
    [x, y - 1],
    [x - 1, y],
    [x + 1, y],
  ];
  return neighbours.some(([nx, ny]) => world.inBounds(nx, ny) && world.isSky(nx, ny) && world.fg[world.index(nx, ny)] === AIR);
}

export function digSurfacePools(ctx: GenContext): number {
  const { world, biome, settings } = ctx;
  const rng = ctx.rng.fork('pools');
  const heights = ctx.heights;
  const keepClear = settings.surface.spawnFlatRadius + settings.surface.spawnBlend + 8;

  // Valleys: columns at least as deep as their neighbours four columns either side.
  const valleys: number[] = [];
  for (let x = 12; x < world.width - 12; x++) {
    if (Math.abs(x - ctx.spawnX) < keepClear) continue;
    let isValley = true;
    for (let d = 1; d <= 4 && isValley; d++) {
      if (heights[x - d]! > heights[x]! || heights[x + d]! > heights[x]!) isValley = false;
    }
    if (isValley) valleys.push(x);
  }
  rng.shuffle(valleys);

  const wanted = rng.int(biome.pools.count[0], biome.pools.count[1]);
  const used: number[] = [];
  let made = 0;
  for (const centre of valleys) {
    if (made >= wanted) break;
    if (used.some((u) => Math.abs(u - centre) < 24)) continue;
    const half = rng.int(2, 4);
    const left = centre - half;
    const right = centre + half;
    // Water stops at the lower of the two rims, so it can't spill out.
    const level = Math.max(heights[left - 1]!, heights[right + 1]!);
    const depth = rng.int(2, 3);
    if (!digPool(ctx, left, right, level, depth)) continue;
    used.push(centre);
    made++;
  }
  return made;
}

/** Depth of a pool's bowl at column x: deepest in the middle, at least one row at the rim. */
function bowlDepth(x: number, centre: number, half: number, depth: number): number {
  const t = (x - centre) / (half + 1);
  return Math.max(1, Math.round(depth * (1 - t * t)));
}

function digPool(ctx: GenContext, left: number, right: number, level: number, depth: number): boolean {
  const { world, biome } = ctx;
  const half = (right - left) / 2;
  const centre = (left + right) / 2;

  // Don't flood trees' footing or carve through a cave roof: the bowl must sit in solid ground.
  for (let x = left; x <= right; x++) {
    const bowl = bowlDepth(x, centre, half, depth);
    for (let y = ctx.heights[x]!; y < ctx.heights[x]! + bowl + 1; y++) {
      if (world.fg[world.index(x, y)] === AIR) return false;
    }
  }

  for (let x = left; x <= right; x++) {
    const top = ctx.heights[x]!;
    const bowl = bowlDepth(x, centre, half, depth);
    const floor = top + bowl;
    // The bowl becomes open sky: no block and no background wall.
    for (let y = top; y < floor; y++) {
      world.fg[world.index(x, y)] = AIR;
      world.bg[world.index(x, y)] = 0;
    }
    for (let y = Math.min(level, floor); y < floor; y++) {
      const i = world.index(x, y);
      world.liquidType[i] = biome.pools.liquid;
      world.liquidAmount[i] = LIQUID_FULL;
    }
    if (biome.pools.shore !== null) world.fg[world.index(x, floor)] = biome.pools.shore;
    // The pool is part of the open landscape, not hidden underground.
    world.surface[x] = floor;
    ctx.heights[x] = floor;
  }

  if (biome.pools.shore !== null) {
    for (const x of [left - 1, right + 1]) world.fg[world.index(x, ctx.heights[x]!)] = biome.pools.shore;
  }

  if (biome.pools.frozenTop !== null) {
    for (let x = left; x <= right; x++) {
      const i = world.index(x, level);
      if (world.liquidType[i] === 0) continue;
      world.liquidType[i] = 0;
      world.liquidAmount[i] = 0;
      world.fg[i] = biome.pools.frozenTop;
    }
  }
  return true;
}
