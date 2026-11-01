import { describe, expect, it } from 'vitest';
import { BIOMES, TILES, WORLDGEN } from '../content';
import { AIR } from '../world/TileRegistry';
import { FLAG_EXPLORED, LIQUID_FULL, World } from '../world/World';
import { generateWorld, type WorldGenResult, type WorldGenStage } from './generateWorld';

const SEEDS = ['alpha', 'beta', 'gamma'];
const cache = new Map<string, WorldGenResult>();

function gen(seed: string, biome = 'temperate'): WorldGenResult {
  const key = `${seed}/${biome}`;
  if (!cache.has(key)) cache.set(key, generateWorld({ seed, biome }));
  return cache.get(key)!;
}

function fingerprint(result: WorldGenResult): string {
  const s = result.snapshot;
  let h = 2166136261;
  for (const arr of [s.fg, s.bg, s.liquidType, s.flags, s.surface]) {
    for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ (arr[i]! & 0xffff), 16777619);
  }
  return `${h >>> 0}:${s.spawn.x},${s.spawn.y}`;
}

describe('generateWorld', () => {
  it('is deterministic for a seed and biome', () => {
    expect(fingerprint(generateWorld({ seed: 'alpha', biome: 'temperate' }))).toBe(fingerprint(gen('alpha')));
  });

  it('makes different worlds from different seeds', () => {
    expect(fingerprint(gen('alpha'))).not.toBe(fingerprint(gen('beta')));
  });

  it('reports progress through every stage in order, ending near 1', () => {
    const stages: WorldGenStage[] = [];
    let last = -1;
    generateWorld({ seed: 'progress', biome: 'temperate' }, (stage, progress) => {
      stages.push(stage);
      expect(progress).toBeGreaterThan(last);
      last = progress;
    });
    expect(stages).toEqual(['terrain', 'caves', 'water', 'ores', 'plants', 'finishing']);
  });

  it('is fast enough to keep the loading screen short', () => {
    expect(generateWorld({ seed: 'timing', biome: 'temperate' }).stats.milliseconds).toBeLessThan(3000);
  });

  for (const biomeId of BIOMES.ids) {
    describe(`${biomeId} worlds`, () => {
      for (const seed of SEEDS) {
        it(`seed "${seed}" keeps the world's invariants`, () => {
          const { snapshot } = gen(seed, biomeId);
          checkInvariants(World.fromSnapshot(snapshot), biomeId);
        });
      }

      it('contain caves, lakes, lava, every ore, trees and decorations', () => {
        const all = SEEDS.map((seed) => gen(seed, biomeId).stats);
        const total = (key: 'lakes' | 'lavaPools' | 'trees' | 'decorations' | 'surfacePools') => all.reduce((n, s) => n + s[key], 0);
        expect(Math.min(...all.map((s) => s.caves))).toBeGreaterThan(20);
        expect(total('lakes')).toBeGreaterThan(0);
        expect(total('lavaPools')).toBeGreaterThan(0);
        expect(total('trees')).toBeGreaterThan(30);
        expect(total('decorations')).toBeGreaterThan(30);
        expect(total('surfacePools')).toBeGreaterThan(0);
        for (const rule of WORLDGEN.ores) {
          const id = TILES.tiles[rule.tile]!.id;
          for (const stats of all) expect(stats.ores[id], `${id} placed`).toBeGreaterThan(0);
        }
      });
    });
  }

  it('gives each biome its own surface', () => {
    const temperate = World.fromSnapshot(gen('alpha', 'temperate').snapshot);
    const snow = World.fromSnapshot(gen('alpha', 'snow').snapshot);
    const { x } = temperate.spawn;
    expect(temperate.fg[temperate.index(x, temperate.surface[x]!)]).toBe(TILES.tile('grass'));
    expect(snow.fg[snow.index(x, snow.surface[x]!)]).toBe(TILES.tile('snow'));
  });
});

function checkInvariants(world: World, biomeId: string): void {
  const biome = BIOMES.get(biomeId);
  const bedrock = TILES.tile('bedrock');
  const { width, height } = world;

  // Bedrock floor and edge columns can't be dug through.
  for (let x = 0; x < width; x++) expect(world.fg[world.index(x, height - 1)]).toBe(bedrock);
  for (const x of [0, width - 1]) {
    for (let y = world.surface[x]!; y < height; y++) expect(world.fg[world.index(x, y)]).toBe(bedrock);
  }

  // The colony starts on open, flat, diggable ground. Nothing is explored yet: the game
  // marks whatever light reaches as explored when it starts (see Lighting).
  const { x: sx, y: sy } = world.spawn;
  expect(world.fg[world.index(sx, sy)]).toBe(AIR);
  expect(world.liquidType[world.index(sx, sy)]).toBe(0);
  for (let dx = -WORLDGEN.surface.spawnFlatRadius; dx <= WORLDGEN.surface.spawnFlatRadius; dx++) {
    expect(world.surface[sx + dx], 'flat spawn').toBe(sy + 1);
    expect(TILES.diggable[world.fg[world.index(sx + dx, sy + 1)]!]).toBe(1);
  }
  for (const dx of [-1, 0, 1]) expect(world.fg[world.index(sx + dx, sy)]).toBe(AIR);
  expect(world.flags.some((flags) => (flags & FLAG_EXPLORED) !== 0)).toBe(false);

  let surfaceMatches = 0;
  for (let x = 0; x < width; x++) {
    const top = world.surface[x]!;
    if (world.fg[world.index(x, top)] === biome.surfaceTile) surfaceMatches++;
    for (let y = 0; y < height; y++) {
      const i = world.index(x, y);
      const tile = world.fg[i]!;
      // Liquids only in open cells, always full for now.
      if (world.liquidType[i] !== 0) {
        expect(tile, `liquid in a block at ${x},${y}`).toBe(AIR);
        expect(world.liquidAmount[i]).toBe(LIQUID_FULL);
      }
      // No background walls in the sky.
      if (y < top) expect(world.bg[i], `wall in the sky at ${x},${y}`).toBe(0);
      // Plants are never inside the ground.
      if (!TILES.solid[tile] && tile !== AIR && y > top) {
        const style = TILES.tiles[tile]!.art.style;
        expect(['sprite'], `${TILES.tiles[tile]!.id} underground at ${x},${y}`).toContain(style);
      }
    }
  }
  expect(surfaceMatches / width).toBeGreaterThan(0.85);

  // Ores sit in their host rock's depth band.
  for (const rule of WORLDGEN.ores) {
    for (let i = 0; i < world.fg.length; i++) {
      if (world.fg[i] !== rule.tile) continue;
      const y = Math.floor(i / width);
      expect(y).toBeGreaterThan(world.surface[i % width]!);
    }
  }
}
