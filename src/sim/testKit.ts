/**
 * Helpers for the simulation's unit tests: a small hand-built world and a simulation
 * running on it, with ways to step it until something has happened.
 */
import { EventBus } from '../core/EventBus';
import { CONTENT, TILES } from './content';
import type { GameEvents } from './events';
import { Simulation } from './Simulation';
import { AIR } from './world/TileRegistry';
import { World } from './world/World';

/**
 * A hand-built world, 48 x 24:
 *   rows 0-9 sky, row 10 grass, rows 11-14 dirt, rows 15-22 stone, row 23 bedrock,
 *   background walls behind every block, as in a generated world. The Hearth stands at
 *   (20, 9); an oak with a four-tile trunk stands on (34, 10).
 */
export function makeWorld(): World {
  const width = 48;
  const height = 24;
  const world = World.empty(width, height, 'sim-test', 'temperate');
  world.surface.fill(10);
  for (let x = 0; x < width; x++) {
    for (let y = 10; y < height; y++) {
      const tile = y === 10 ? 'grass' : y === height - 1 ? 'bedrock' : y >= 15 ? 'stone' : 'dirt';
      world.fg[world.index(x, y)] = TILES.tile(tile);
      world.bg[world.index(x, y)] = TILES.wall('dirt_wall');
    }
  }
  for (let y = 6; y <= 9; y++) world.fg[world.index(34, y)] = TILES.tile('log');
  for (let y = 3; y <= 6; y++) {
    for (let x = 32; x <= 36; x++) if (world.fg[world.index(x, y)] === AIR) world.fg[world.index(x, y)] = TILES.tile('leaves');
  }
  world.spawn = { x: 20, y: 9 };
  return world;
}

/** A simulation on `world` (the test world by default); `startHour` sets the clock (8:00 otherwise). */
export function newSim(world = makeWorld(), options: { startHour?: number } = {}) {
  const bus = new EventBus<GameEvents>();
  const sim = new Simulation({ world, ...CONTENT, bus, startHour: options.startHour });
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) sim.step();
  };
  /** Step until `done` is true or `limit` ticks pass; returns the ticks taken. */
  const runUntil = (done: () => boolean, limit = 4000): number => {
    for (let i = 0; i < limit; i++) {
      if (done()) return i;
      sim.step();
    }
    throw new Error(`Still waiting after ${limit} ticks`);
  };
  return { world, bus, sim, run, runUntil };
}

/** A one-cell rectangle. */
export const at = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });
