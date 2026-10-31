/**
 * Step 5: life on the surface and in the caves.
 *
 *  - Trees grow on the biome's surface block, spaced apart and kept off the spawn:
 *    round-crowned broadleaf trees in temperate worlds, tiered conifers in frozen ones.
 *  - Grass tufts, flowers or shrubs decorate open ground.
 *  - Mushrooms sprout on cave floors.
 */
import type { Rng } from '../../core/Rng';
import { AIR } from '../world/TileRegistry';
import type { GenContext } from './context';
import { fractal1D } from './noise';

export interface VegetationStats {
  trees: number;
  decorations: number;
  mushrooms: number;
}

/** Columns either side of the spawn kept free of trees, so the Hearth has room. */
const SPAWN_TREE_GAP = 5;

export function growVegetation(ctx: GenContext): VegetationStats {
  const rng = ctx.rng.fork('vegetation');
  const trees = plantTrees(ctx, rng);
  const decorations = decorateSurface(ctx, rng);
  const mushrooms = growMushrooms(ctx, rng);
  return { trees, decorations, mushrooms };
}

function plantTrees(ctx: GenContext, rng: Rng): number {
  const { world, biome } = ctx;
  const spec = biome.trees;
  let lastTree = -Infinity;
  let count = 0;

  for (let x = 3; x < world.width - 3; x++) {
    if (Math.abs(x - ctx.spawnX) <= SPAWN_TREE_GAP) continue;
    if (x - lastTree < spec.minSpacing) continue;
    const ground = ctx.heights[x]!;
    if (world.fg[world.index(x, ground)] !== biome.surfaceTile) continue;
    if (world.liquidType[world.index(x, ground - 1)] !== 0) continue;
    // Groves and clearings: the chance swings from a third to double along the map.
    const grove = 0.33 + 1.67 * fractal1D(x, ctx.noiseSeed + 81, { octaves: 2, frequency: 1 / 36 });
    if (!rng.chance(spec.chance * grove)) continue;

    const trunk = rng.int(spec.height[0], spec.height[1]);
    const crownTop = ground - trunk - (spec.shape === 'conifer' ? 5 : 3);
    if (crownTop < 2) continue;

    for (let i = 1; i <= trunk; i++) place(ctx, x, ground - i, spec.log);
    if (spec.shape === 'broadleaf') {
      // A full, rounded crown centred just below the top of the trunk.
      const cy = ground - trunk;
      const rx = trunk >= 6 ? 3 : 2;
      for (let dy = -3; dy <= 1; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          const ex = dx / (rx + 0.6);
          const ey = (dy + 1) / 2.6;
          const edge = ex * ex + ey * ey;
          if (edge > 1 || (edge > 0.82 && rng.chance(0.35))) continue;
          place(ctx, x + dx, cy + dy, spec.leaves);
        }
      }
    } else {
      // Conifer: tiers that narrow towards a single-cell tip. The needles cover the trunk
      // inside the crown (only the trunk below the lowest tier shows), so the tree reads as
      // one solid cone rather than a trunk with separate tufts either side of it.
      const base = ground - Math.max(1, Math.floor(trunk / 2));
      const tiers = [2, 2, 1, 1, 0];
      tiers.forEach((halfWidth, tier) => {
        const y = base - tier - 1;
        for (let dx = -halfWidth; dx <= halfWidth; dx++) {
          const i = world.index(x + dx, y);
          if (dx === 0 && world.fg[i] === spec.log) world.fg[i] = spec.leaves;
          else place(ctx, x + dx, y, spec.leaves);
        }
      });
      place(ctx, x, base - tiers.length - 1, spec.leaves);
    }
    lastTree = x;
    count++;
  }
  return count;
}

/** Put a plant tile in an empty, dry cell of open sky (never into a cave mouth below ground level). */
function place(ctx: GenContext, x: number, y: number, tile: number): void {
  const { world } = ctx;
  if (!world.inBounds(x, y) || y >= world.surface[x]!) return;
  const i = world.index(x, y);
  if (world.fg[i] === AIR && world.liquidType[i] === 0) world.fg[i] = tile;
}

function decorateSurface(ctx: GenContext, rng: Rng): number {
  const { world, biome } = ctx;
  let count = 0;
  for (let x = 1; x < world.width - 1; x++) {
    if (Math.abs(x - ctx.spawnX) <= 1) continue; // the Hearth stands here
    const ground = ctx.heights[x]!;
    if (world.fg[world.index(x, ground)] !== biome.surfaceTile) continue;
    const above = world.index(x, ground - 1);
    if (world.fg[above] !== AIR || world.liquidType[above] !== 0) continue;
    for (const decoration of biome.decorations) {
      if (rng.chance(decoration.chance)) {
        world.fg[above] = decoration.tile;
        count++;
        break;
      }
    }
  }
  return count;
}

function growMushrooms(ctx: GenContext, rng: Rng): number {
  const { world, tiles, ids, settings } = ctx;
  let count = 0;
  for (let x = 1; x < world.width - 1; x++) {
    for (let y = ctx.heights[x]! + 8; y < world.height - 1; y++) {
      const i = world.index(x, y);
      if (world.fg[i] !== AIR || world.liquidType[i] !== 0) continue;
      const floor = world.fg[i + world.width]!;
      if (!tiles.solid[floor] || floor === ids.bedrock) continue;
      if (rng.chance(settings.decorations.caveMushroomChance)) {
        world.fg[i] = ids.mushroom;
        count++;
      }
    }
  }
  return count;
}
