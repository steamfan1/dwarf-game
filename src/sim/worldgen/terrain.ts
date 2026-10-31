/**
 * Step 1: the shape of the land and what it is made of.
 *
 *  - a 1D noise heightmap gives hills and broad mountains, flattened around the spawn;
 *  - each column is filled top to bottom: surface block, optional cap (snow), soil,
 *    stone, deep stone, basalt and a ragged bedrock floor, with noisy band boundaries;
 *  - natural background walls start a couple of rows under the surface;
 *  - the left and right edge columns are bedrock;
 *  - blobs of clay in the soil and pockets of dirt in the stone add variety.
 */
import { forEachInBlob, type GenContext } from './context';
import { fractal1D, hash2 } from './noise';

export function shapeSurface(ctx: GenContext): void {
  const { world, settings, noiseSeed } = ctx;
  const s = settings.surface;
  const width = world.width;
  const base = world.height * s.baseDepth;
  const raw = new Float64Array(width);

  for (let x = 0; x < width; x++) {
    const hills = (fractal1D(x, noiseSeed + 11, { octaves: 4, frequency: 1 / 46 }) - 0.5) * 2 * s.hillAmplitude;
    const mountains = (fractal1D(x, noiseSeed + 23, { octaves: 2, frequency: 1 / 170 }) - 0.5) * 2 * s.mountainAmplitude;
    raw[x] = base + hills + mountains;
  }

  // Start the colony on the flattest stretch near the middle of the map.
  const flat = s.spawnFlatRadius;
  let bestX = Math.floor(width / 2);
  let bestRoughness = Infinity;
  for (let x = Math.floor(width * 0.42); x <= Math.floor(width * 0.58); x++) {
    let roughness = 0;
    for (let d = -flat; d <= flat; d++) roughness += Math.abs(raw[x + d]! - raw[x]!);
    if (roughness < bestRoughness) {
      bestRoughness = roughness;
      bestX = x;
    }
  }
  ctx.spawnX = bestX;

  // Flatten the spawn area and blend smoothly back into the hills.
  const target = raw[bestX]!;
  for (let x = 0; x < width; x++) {
    const d = Math.abs(x - bestX);
    if (d <= flat) raw[x] = target;
    else if (d <= flat + s.spawnBlend) {
      const t = (d - flat) / s.spawnBlend;
      const smooth = t * t * (3 - 2 * t);
      raw[x] = target + (raw[x]! - target) * smooth;
    }
  }

  // Round to rows, clamp, and remove one-column spikes and pits with a 3-tap median.
  const rounded = Array.from(raw, (h) => Math.min(s.maxY, Math.max(s.minY, Math.round(h))));
  let sum = 0;
  for (let x = 0; x < width; x++) {
    const a = rounded[Math.max(0, x - 1)]!;
    const b = rounded[x]!;
    const c = rounded[Math.min(width - 1, x + 1)]!;
    const median = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    ctx.heights[x] = Math.abs(x - bestX) <= flat ? b : median;
    sum += ctx.heights[x]!;
  }
  ctx.surfaceMean = sum / width;
}

export function fillTerrain(ctx: GenContext): void {
  const { world, settings, biome, ids, walls, noiseSeed } = ctx;
  const b = settings.bands;
  const width = world.width;
  const height = world.height;

  for (let x = 0; x < width; x++) {
    const top = ctx.heights[x]!;
    world.surface[x] = top;

    const soilDepth = Math.round(b.soilDepth[0] + (b.soilDepth[1] - b.soilDepth[0]) * fractal1D(x, noiseSeed + 31, { octaves: 2, frequency: 1 / 22 }));
    const soilBottom = top + soilDepth;
    const deepStart = Math.round(height * b.deepStoneAt + (fractal1D(x, noiseSeed + 41, { octaves: 3, frequency: 1 / 30 }) - 0.5) * 10);
    const basaltStart = Math.round(height * b.basaltAt + (fractal1D(x, noiseSeed + 53, { octaves: 3, frequency: 1 / 26 }) - 0.5) * 7);
    const bedrockStart = height - b.bedrockRows - Math.floor(hash2(x, 7, noiseSeed) * 2.5);
    ctx.bedrockTop[x] = bedrockStart;
    const capRows = biome.capTile === null ? 0 : Math.round(biome.capDepth[0] + (biome.capDepth[1] - biome.capDepth[0]) * fractal1D(x, noiseSeed + 61, { octaves: 2, frequency: 1 / 15 }));

    for (let y = top; y < height; y++) {
      const i = world.index(x, y);
      let tile: number;
      let wall: number;
      if (y >= bedrockStart) {
        tile = ids.bedrock;
        wall = walls.basalt;
      } else if (y === top) {
        tile = biome.surfaceTile;
        wall = walls.dirt;
      } else if (biome.capTile !== null && y <= top + capRows) {
        tile = biome.capTile;
        wall = walls.dirt;
      } else if (y < soilBottom) {
        tile = biome.soilTile;
        wall = walls.dirt;
      } else if (y >= basaltStart) {
        tile = ids.basalt;
        wall = walls.basalt;
      } else if (y >= deepStart) {
        tile = ids.deepStone;
        wall = walls.deepStone;
      } else {
        tile = ids.stone;
        wall = walls.stone;
      }
      world.fg[i] = tile;
      // Walls start a little under the surface, so a hole dug at the very top shows sky.
      world.bg[i] = y >= top + b.wallStartBelowSurface ? wall : 0;
    }
  }

  // The world's left and right edges are solid bedrock from the surface down.
  for (const x of [0, width - 1]) {
    for (let y = ctx.heights[x]!; y < height; y++) world.fg[world.index(x, y)] = ids.bedrock;
  }
}

export function scatterBlobs(ctx: GenContext): void {
  const { world, settings, ids, walls, biome } = ctx;
  const rng = ctx.rng.fork('blobs');
  const soilTile = biome.soilTile;

  for (let n = 0; n < settings.blobs.clay; n++) {
    const x = rng.int(4, world.width - 5);
    const y = ctx.heights[x]! + rng.int(3, settings.bands.soilDepth[0] + 2);
    forEachInBlob(ctx, x, y, rng.range(1.4, 2.8), rng, (_x, _y, i) => {
      if (world.fg[i] === soilTile) world.fg[i] = ids.clay;
    });
  }

  const stoneTop = Math.round(ctx.surfaceMean + settings.bands.soilDepth[1] + 3);
  const stoneBottom = Math.round(world.height * settings.bands.deepStoneAt) - 4;
  for (let n = 0; n < settings.blobs.dirtInStone; n++) {
    const x = rng.int(4, world.width - 5);
    const y = rng.int(stoneTop, Math.max(stoneTop, stoneBottom));
    forEachInBlob(ctx, x, y, rng.range(1.8, 3.6), rng, (_x, _y, i) => {
      if (world.fg[i] !== ids.stone) return;
      world.fg[i] = ids.dirt;
      if (world.bg[i] !== 0) world.bg[i] = walls.dirt;
    });
  }
}
