import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus';
import { TILES } from './content';
import type { GameEvents } from './events';
import { Simulation } from './Simulation';
import { AIR } from './world/TileRegistry';
import { FLAG_EXPLORED, World } from './world/World';

/**
 * A tiny hand-built world, 12 x 10:
 *   rows 0-4 sky, row 5 grass surface, rows 6-9 dirt over stone, bedrock at the bottom.
 *   The Hearth stands at (3, 4). A tree trunk stands on (8, 5); tall grass on (6, 5).
 */
function makeWorld(): World {
  const world = World.empty(12, 10, 'test', 'temperate');
  world.surface.fill(5);
  for (let x = 0; x < 12; x++) {
    for (let y = 5; y < 10; y++) {
      const tile = y === 5 ? 'grass' : y === 9 ? 'bedrock' : y >= 8 ? 'stone' : 'dirt';
      world.fg[world.index(x, y)] = TILES.tile(tile);
      if (y >= 7) world.bg[world.index(x, y)] = TILES.wall('dirt_wall');
    }
  }
  world.fg[world.index(8, 4)] = TILES.tile('log');
  world.fg[world.index(6, 4)] = TILES.tile('tall_grass');
  world.spawn = { x: 3, y: 4 };
  for (let x = 0; x < 12; x++) for (let y = 5; y < 8; y++) world.flags[world.index(x, y)] = FLAG_EXPLORED;
  return world;
}

describe('Simulation.dig', () => {
  let world: World;
  let bus: EventBus<GameEvents>;
  let sim: Simulation;
  let changed: string[];
  let revealed: number;

  beforeEach(() => {
    world = makeWorld();
    bus = new EventBus<GameEvents>();
    sim = new Simulation({ world, tiles: TILES, bus });
    changed = [];
    revealed = 0;
    bus.on('TileChanged', ({ x, y }) => changed.push(`${x},${y}`));
    bus.on('ExploredChanged', () => revealed++);
  });

  it('removes a visible block, keeps its wall, announces the change and reveals around it', () => {
    expect(sim.dig(10, 7)).toBe('dug');
    expect(world.fg[world.index(10, 7)]).toBe(AIR);
    expect(world.bg[world.index(10, 7)]).toBe(TILES.wall('dirt_wall'));
    expect(changed).toEqual(['10,7']);
    expect(revealed).toBe(1);
    expect(world.isExplored(10, 9)).toBe(true);
  });

  it('takes the grass tuft resting on a dug block with it', () => {
    expect(sim.dig(6, 5)).toBe('dug');
    expect(world.fg[world.index(6, 4)]).toBe(AIR);
    expect(changed).toEqual(['6,5', '6,4']);
  });

  it('explains why a cell cannot be dug, without changing anything', () => {
    expect(sim.dig(-1, 5)).toBe('out-of-bounds');
    expect(sim.dig(5, 8)).toBe('unexplored');
    expect(sim.dig(5, 2)).toBe('nothing-to-dig');
    expect(sim.dig(3, 5)).toBe('supports-hearth');
    expect(sim.dig(8, 5)).toBe('supports-tree');
    world.flags[world.index(5, 9)] = FLAG_EXPLORED;
    expect(sim.dig(5, 9)).toBe('indestructible');
    expect(changed).toEqual([]);
    expect(revealed).toBe(0);
  });

  it('canDig agrees with dig', () => {
    expect(sim.canDig(10, 6)).toBe('dug');
    expect(world.fg[world.index(10, 6)]).toBe(TILES.tile('dirt'));
  });

  it('puts the Hearth at the spawn', () => {
    expect(sim.hearth).toEqual({ x: 3, y: 4 });
  });

  it('revealAll lifts the fog everywhere', () => {
    sim.revealAll();
    expect(world.isExplored(0, 9)).toBe(true);
    expect(revealed).toBe(1);
  });
});
