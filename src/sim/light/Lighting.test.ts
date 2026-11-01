import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/Rng';
import { TILES } from '../content';
import { AIR } from '../world/TileRegistry';
import { World } from '../world/World';
import { generateWorld } from '../worldgen/generateWorld';
import { HEARTH_LIGHT, Lighting, MAX_LIGHT } from './Lighting';

const STONE = TILES.tile('stone');
const CRYSTAL = TILES.tile('crystal');
const LAVA = TILES.liquid('lava');
const WATER = TILES.liquid('water');

/** Air above row `ground`, stone from there down. */
function flatWorld(width = 40, height = 40, ground = 10): World {
  const world = World.empty(width, height, 'light-test', 'temperate');
  for (let y = ground; y < height; y++) world.fg.fill(STONE, y * width, (y + 1) * width);
  return world;
}

function column(lighting: Lighting, x: number, from: number, to: number): number[] {
  const values: number[] = [];
  for (let y = from; y <= to; y++) values.push(lighting.lightAt(x, y));
  return values;
}

describe('Lighting', () => {
  it('lights the sky fully and reaches about three blocks into the ground', () => {
    const lighting = new Lighting(flatWorld(), TILES);
    lighting.computeAll();
    expect(column(lighting, 20, 0, 14)).toEqual([15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 11, 7, 3, 0, 0]);
  });

  it('sends sunlight down a shaft once it is open to the sky', () => {
    const world = flatWorld();
    const lighting = new Lighting(world, TILES);
    lighting.computeAll();
    for (let y = 10; y <= 20; y++) {
      world.fg[world.index(20, y)] = AIR;
      lighting.cellChanged(20, y);
    }
    expect(lighting.lightAt(20, 20)).toBe(MAX_LIGHT);
    expect(lighting.lightAt(19, 20)).toBe(MAX_LIGHT - 4);
    expect(lighting.lightAt(18, 20)).toBe(MAX_LIGHT - 8);
    expect(lighting.sunDepth[20]).toBe(21);
  });

  it('dims light spreading through water more than through air', () => {
    const world = flatWorld();
    // A shaft at x = 20 down to row 12, with a dry tunnel to its right and a flooded one to its left.
    for (let y = 10; y <= 12; y++) world.fg[world.index(20, y)] = AIR;
    for (let x = 14; x <= 26; x++) world.fg[world.index(x, 12)] = AIR;
    for (let x = 14; x <= 19; x++) world.liquidType[world.index(x, 12)] = WATER;
    const lighting = new Lighting(world, TILES);
    lighting.computeAll();
    expect(lighting.lightAt(20, 12)).toBe(MAX_LIGHT);
    expect([21, 22, 23].map((x) => lighting.lightAt(x, 12))).toEqual([14, 13, 12]);
    expect([19, 18, 17].map((x) => lighting.lightAt(x, 12))).toEqual([13, 11, 9]);
  });

  it('makes lava, glow crystals and the Hearth give off light', () => {
    const world = flatWorld(60, 60);
    world.fg[world.index(10, 40)] = AIR;
    world.liquidType[world.index(10, 40)] = LAVA;
    world.fg[world.index(40, 40)] = CRYSTAL;
    const lighting = new Lighting(world, TILES);
    lighting.computeAll();
    expect(lighting.lightAt(10, 40)).toBe(12);
    expect(lighting.lightAt(11, 40)).toBe(8);
    expect(lighting.lightAt(40, 40)).toBe(8);
    expect(lighting.lightAt(41, 40)).toBe(4);
    expect(lighting.lightAt(25, 40)).toBe(0);

    world.fg[world.index(25, 40)] = AIR;
    lighting.cellChanged(25, 40);
    lighting.setPointLight(25, 40, HEARTH_LIGHT);
    expect(lighting.lightAt(25, 40)).toBe(HEARTH_LIGHT);
    lighting.setPointLight(25, 40, 0);
    expect(lighting.lightAt(25, 40)).toBe(0);
  });

  it('marks sunlit cells as explored, and reports only newly explored ones', () => {
    const world = flatWorld();
    const lighting = new Lighting(world, TILES);
    const all = lighting.computeAll();
    expect(lighting.discover(all)).toEqual({ x0: 0, y0: 0, x1: 39, y1: 12 });
    expect(world.isExplored(20, 12)).toBe(true);
    expect(world.isExplored(20, 13)).toBe(false);
    expect(lighting.discover(all)).toBeNull();
  });

  it('never uncovers what only lava, crystals or other glow light up', () => {
    const world = flatWorld(60, 60);
    world.fg[world.index(10, 40)] = AIR;
    world.liquidType[world.index(10, 40)] = LAVA;
    world.fg[world.index(40, 40)] = CRYSTAL;
    const lighting = new Lighting(world, TILES);
    lighting.discover(lighting.computeAll());
    expect(lighting.lightAt(10, 40)).toBe(12);
    expect(lighting.sunAt(10, 40)).toBe(0);
    expect(world.isExplored(10, 40)).toBe(false);
    expect(world.isExplored(11, 40)).toBe(false);
    expect(world.isExplored(40, 40)).toBe(false);
  });

  it('gives the same light after many local updates as a full recompute', () => {
    const world = World.fromSnapshot(generateWorld({ seed: 'light-check', biome: 'temperate' }).snapshot);
    const lighting = new Lighting(world, TILES);
    lighting.computeAll();
    const rng = new Rng('light-edits');
    for (let n = 0; n < 60; n++) {
      // Dig and fill around the surface, where sunlight changes most.
      const x = rng.int(0, world.width - 1);
      const y = Math.min(world.height - 4, Math.max(0, world.surface[x]! + rng.int(-3, 12)));
      const i = world.index(x, y);
      world.fg[i] = TILES.solid[world.fg[i]!] ? AIR : STONE;
      world.liquidType[i] = 0;
      lighting.cellChanged(x, y);
    }
    const fresh = new Lighting(world, TILES);
    fresh.computeAll();
    expect(Array.from(lighting.sunDepth)).toEqual(Array.from(fresh.sunDepth));
    let differences = 0;
    for (let i = 0; i < lighting.light.length; i++) {
      if (lighting.light[i] !== fresh.light[i] || lighting.sun[i] !== fresh.sun[i] || lighting.glow[i] !== fresh.glow[i]) differences++;
    }
    expect(differences).toBe(0);
  });
});
