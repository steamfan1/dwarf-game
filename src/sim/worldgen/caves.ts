/**
 * Step 2: caves.
 *
 * Cellular automata: underground cells start open at random (more often the deeper they
 * are), then a few smoothing passes turn the noise into organic caverns: a cell closes up
 * when most of its 8 neighbours are rock and opens when most are open. Tiny pockets are
 * filled back in. A few winding tunnels then connect the surface to the caves below.
 * The area around the spawn stays solid so the colony starts on firm ground.
 */
import type { Rng } from '../../core/Rng';
import { AIR } from '../world/TileRegistry';
import { depthFraction, withinEllipse, type GenContext } from './context';
import { fractal2D } from './noise';

export interface CaveStats {
  openCells: number;
  caves: number;
  tunnels: number;
}

export function carveCaves(ctx: GenContext): CaveStats {
  const { world, settings } = ctx;
  const c = settings.caves;
  const width = world.width;
  const height = world.height;
  const rng = ctx.rng.fork('caves');
  const spawnY = ctx.heights[ctx.spawnX]!;

  // Which cells may become cave at all.
  const eligible = new Uint8Array(width * height);
  for (let x = 1; x < width - 1; x++) {
    for (let y = ctx.heights[x]! + c.startBelowSurface; y < ctx.bedrockTop[x]! - 1; y++) {
      if (nearSpawn(ctx, x, y, spawnY)) continue;
      eligible[world.index(x, y)] = 1;
    }
  }

  // Random fill: more open the deeper it is, and much more open in some regions than
  // others, so the map has big cave systems separated by stretches of solid rock.
  let open = new Uint8Array(width * height);
  for (let i = 0; i < open.length; i++) {
    if (!eligible[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    const depth = depthFraction(ctx, y);
    const regional = fractal2D(x, y * 1.6, ctx.noiseSeed + 71, { octaves: 2, frequency: 1 / 38 }) - 0.5;
    const chance = c.openChanceTop + (c.openChanceBottom - c.openChanceTop) * depth + regional * c.regionalVariation;
    open[i] = rng.chance(chance) ? 1 : 0;
  }

  // Smoothing passes. Ineligible cells count as rock.
  let next = new Uint8Array(width * height);
  for (let pass = 0; pass < c.smoothingPasses; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!eligible[i]) {
          next[i] = 0;
          continue;
        }
        let rock = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = i + dy * width + dx;
            if (!eligible[j] || !open[j]) rock++;
          }
        }
        next[i] = rock >= 5 ? 0 : rock <= 3 ? 1 : open[i]!;
      }
    }
    [open, next] = [next, open];
  }

  // Fill back pockets too small to matter.
  const regions = labelRegions(open, width, height);
  let caves = 0;
  for (const region of regions) {
    if (region.length < c.minCaveSize) for (const i of region) open[i] = 0;
    else caves++;
  }

  let openCells = 0;
  for (let i = 0; i < open.length; i++) {
    if (!open[i]) continue;
    world.fg[i] = AIR;
    openCells++;
  }

  const tunnels = digTunnels(ctx, rng, spawnY);
  return { openCells, caves, tunnels };
}

/** Winding tunnels from the surface down into the rock, away from the spawn. */
function digTunnels(ctx: GenContext, rng: Rng, spawnY: number): number {
  const { world, settings } = ctx;
  let dug = 0;
  for (let t = 0; t < settings.caves.tunnels; t++) {
    let x = rng.int(20, world.width - 21);
    if (Math.abs(x - ctx.spawnX) < 40) x = (x + Math.floor(world.width / 2)) % (world.width - 40) + 20;
    let y = ctx.heights[x]!;
    let drift = rng.chance(0.5) ? 1 : -1;
    const length = rng.int(35, 75);
    for (let step = 0; step < length; step++) {
      const radius = rng.chance(0.25) ? 2 : 1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (dx * dx + dy * dy > radius * radius + 0.5) continue;
          if (tx < 1 || tx >= world.width - 1 || ty < 0 || ty >= ctx.bedrockTop[tx]! - 1) continue;
          if (nearSpawn(ctx, tx, ty, spawnY)) continue;
          if (ty >= ctx.heights[tx]!) world.fg[world.index(tx, ty)] = AIR;
        }
      }
      if (rng.chance(0.12)) drift = -drift;
      if (rng.chance(0.65)) y++;
      if (rng.chance(0.55)) x += drift;
      x = Math.max(2, Math.min(world.width - 3, x));
    }
    dug++;
  }
  return dug;
}

/**
 * The solid area kept around the spawn: an ellipse, flatter than it is wide (vertical
 * distance counts 1.4 times), so the colony starts on firm, cave-free ground.
 */
function nearSpawn(ctx: GenContext, x: number, y: number, spawnY: number): boolean {
  const r = ctx.settings.caves.spawnClearRadius;
  return withinEllipse(x - ctx.spawnX, y - spawnY, r, r / 1.4);
}

/** 4-connected regions of cells where `mask` is 1, as lists of cell indices. */
export function labelRegions(mask: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(mask.length);
  const regions: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const region: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y > 0) visit(i - width);
      if (y < height - 1) visit(i + width);
    }
    regions.push(region);
  }
  return regions;

  function visit(j: number): void {
    if (mask[j] && !seen[j]) {
      seen[j] = 1;
      stack.push(j);
    }
  }
}
