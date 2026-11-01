import { describe, expect, it } from 'vitest';
import { TILES } from '../content';
import { World } from '../world/World';
import { NavGrid } from './NavGrid';
import { Pathfinder, type PathGoal } from './Pathfinder';
import { PathService } from './PathService';

/**
 * Build a small world from a picture: '#' stone, 'H' ladder, '~' water, 'L' lava, '.' air,
 * 'w' air with a background wall behind it. Below the last row counts as solid ground.
 */
function worldFrom(rows: string[]): World {
  const world = World.empty(rows[0]!.length, rows.length, 'nav-test', 'temperate');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = world.index(x, y);
      if (ch === '#') world.fg[i] = TILES.tile('stone');
      else if (ch === 'H') world.fg[i] = TILES.tile('ladder');
      else if (ch === '~') world.liquidType[i] = TILES.liquid('water');
      else if (ch === 'L') world.liquidType[i] = TILES.liquid('lava');
      else if (ch === 'w') world.bg[i] = TILES.wall('stone_wall');
    });
  });
  return world;
}

function setup(rows: string[], maxExpanded = 10_000) {
  const world = worldFrom(rows);
  const nav = new NavGrid(world, TILES, { safeDrop: 4 });
  const pathfinder = new Pathfinder(nav, { maxExpanded });
  const at = (x: number, y: number): number => world.index(x, y);
  const xy = (cell: number): [number, number] => [cell % world.width, Math.floor(cell / world.width)];
  /** The path from (fx, fy) to standing on (tx, ty). */
  const route = (fx: number, fy: number, tx: number, ty: number) =>
    pathfinder.find(at(fx, fy), { area: { x0: tx, y0: ty, x1: tx, y1: ty }, reach: 0 });
  return { world, nav, pathfinder, at, xy, route };
}

describe('NavGrid moves', () => {
  it('walks along flat ground', () => {
    const { route, xy } = setup(['......', '######']);
    const path = route(0, 0, 5, 0);
    expect(path.found && path.cells.map(xy)).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
    expect(path.found && path.cost).toBe(5);
  });

  it('jumps up a one-tile step', () => {
    const { route, xy } = setup(['......', '...###', '######']);
    const path = route(0, 1, 5, 0);
    expect(path.found && path.cells.map(xy)).toEqual([[1, 1], [2, 1], [3, 0], [4, 0], [5, 0]]);
    expect(path.found && path.cost).toBe(6);
  });

  it('cannot get over a wall two tiles high', () => {
    const { route } = setup(['......', '...#..', '...#..', '######']);
    expect(route(0, 2, 5, 2).found).toBe(false);
  });

  it('needs headroom to jump', () => {
    // The block right above the dwarf at (2, 2) stops the jump onto the ledge at (3, 1).
    const { route } = setup(['......', '..#...', '...###', '######']);
    expect(route(2, 2, 3, 1).found).toBe(false);
  });

  it('drops up to four tiles, but no further', () => {
    const four = setup(['......', '##....', '......', '......', '......', '######']);
    const path = four.route(1, 0, 3, 4);
    expect(path.found && path.cells.map(four.xy)).toEqual([[2, 4], [3, 4]]);
    expect(path.found && path.cost).toBe(1 + 4 + 1);

    const five = setup(['......', '##....', '......', '......', '......', '......', '######']);
    expect(five.route(1, 0, 3, 5).found).toBe(false);
  });

  it('climbs ladders up and down', () => {
    const { route, xy } = setup(['......', '####H#', '....H.', '....H.', '######']);
    const up = route(0, 3, 0, 0);
    expect(up.found).toBe(true);
    if (!up.found) return;
    expect(up.cells.some((cell) => xy(cell)[0] === 4 && xy(cell)[1] < 3)).toBe(true);
    expect(xy(up.cells[up.cells.length - 1]!)).toEqual([0, 0]);
    expect(route(0, 0, 0, 3).found).toBe(true);
  });

  it('climbs the background wall of a dug-out shaft, down and back up', () => {
    const { route, nav, xy } = setup(['......', '###w##', '###w##', '###w##', '###w##', '######']);
    expect(nav.standable(3, 2)).toBe(true);
    const down = route(0, 0, 3, 4);
    expect(down.found && down.cells.map(xy).slice(-2)).toEqual([[3, 3], [3, 4]]);
    expect(route(3, 4, 0, 0).found).toBe(true);
    expect(nav.moveKind(nav.world.index(3, 3), nav.world.index(3, 2))).toBe('climb');
  });

  it('moves along a cave wall without falling, but not through open air with no wall', () => {
    const { route, nav } = setup(['www...', 'www...', 'www...', '######']);
    expect(nav.standable(1, 0)).toBe(true);
    expect(nav.standable(4, 0)).toBe(false);
    expect(route(2, 0, 0, 0).found).toBe(true);
    expect(route(2, 0, 4, 0).found).toBe(false);
  });

  it('swims through water', () => {
    const { route } = setup(['......', '#~~~~#', '#~~~~#', '######']);
    expect(route(0, 0, 3, 2).found).toBe(true);
    expect(route(3, 2, 5, 0).found).toBe(true);
  });

  it('never steps into lava, so lava in the floor blocks the way', () => {
    const { route, nav } = setup(['......', '##L###', '######']);
    expect(nav.passable(2, 1)).toBe(false);
    expect(nav.standable(2, 0)).toBe(false);
    expect(route(0, 0, 5, 0).found).toBe(false);
  });

  it('names the kind of each step', () => {
    const { nav, at } = setup(['......', '##....', '......', '....H.', '######']);
    expect(nav.moveKind(at(0, 0), at(1, 0))).toBe('walk');
    expect(nav.moveKind(at(2, 3), at(1, 2))).toBe('jump');
    expect(nav.moveKind(at(1, 0), at(2, 3))).toBe('drop');
    expect(nav.moveKind(at(4, 3), at(4, 2))).toBe('climb');
  });
});

describe('Pathfinder goals and limits', () => {
  it('stops next to a goal area when reach is 1, honouring extra conditions', () => {
    const { pathfinder, at, xy } = setup(['........', '########']);
    const goal: PathGoal = { area: { x0: 6, y0: 1, x1: 6, y1: 1 }, reach: 1 };
    const path = pathfinder.find(at(0, 0), goal);
    expect(path.found && xy(path.cells[path.cells.length - 1]!)).toEqual([5, 0]);
    // Refuse the end cell (5, 0): the next best is (6, 0), straight above the target.
    const fussy = pathfinder.find(at(0, 0), { ...goal, accept: (cell) => cell !== at(5, 0) });
    expect(fussy.found && xy(fussy.cells[fussy.cells.length - 1]!)).toEqual([6, 0]);
  });

  it('returns an empty path when the dwarf is already there', () => {
    const { pathfinder, at } = setup(['....', '####']);
    expect(pathfinder.find(at(1, 0), { area: { x0: 2, y0: 1, x1: 2, y1: 1 }, reach: 1 })).toMatchObject({ found: true, cells: [], cost: 0 });
  });

  it('gives up with "too-far" after its search limit', () => {
    const { pathfinder, at } = setup(['.'.repeat(60), '#'.repeat(60)], 20);
    const result = pathfinder.find(at(0, 0), { area: { x0: 59, y0: 0, x1: 59, y1: 0 }, reach: 0 });
    expect(result).toMatchObject({ found: false, reason: 'too-far' });
  });

  it('reports a goal it cannot reach', () => {
    const { pathfinder, at } = setup(['###.###', '...#...', '#######']);
    const result = pathfinder.find(at(0, 1), { area: { x0: 6, y0: 1, x1: 6, y1: 1 }, reach: 0 });
    expect(result).toMatchObject({ found: false, reason: 'unreachable' });
  });
});

describe('PathService', () => {
  it('runs at most N searches per tick and answers repeats from its cache', () => {
    const { world, pathfinder, at } = setup(['..........', '##########']);
    const service = new PathService(world, pathfinder, { searchesPerTick: 2, cacheSize: 8 });
    const goal = (x: number): PathGoal => ({ area: { x0: x, y0: 0, x1: x, y1: 0 }, reach: 0, cacheKey: `to-${x}` });
    service.beginTick();
    expect(service.request(at(0, 0), goal(5))).not.toBe('busy');
    expect(service.request(at(0, 0), goal(6))).not.toBe('busy');
    expect(service.request(at(0, 0), goal(7))).toBe('busy');
    expect(service.request(at(0, 0), goal(5))).not.toBe('busy');
    expect(service.stats).toMatchObject({ searches: 2, cacheHits: 1, busy: 1 });
    service.beginTick();
    expect(service.request(at(0, 0), goal(7))).not.toBe('busy');
  });

  it('forgets cached paths only in the chunk where terrain changed', () => {
    const world = World.empty(96, 4, 'cache-test', 'temperate');
    world.fg.fill(TILES.tile('stone'), 3 * 96, 4 * 96);
    const nav = new NavGrid(world, TILES, { safeDrop: 4 });
    const service = new PathService(world, new Pathfinder(nav, { maxExpanded: 10_000 }), { searchesPerTick: 10, cacheSize: 8 });
    const at = (x: number): number => world.index(x, 2);
    service.beginTick();
    service.request(at(0), { area: { x0: 10, y0: 2, x1: 10, y1: 2 }, reach: 0, cacheKey: 'near' });
    service.request(at(70), { area: { x0: 90, y0: 2, x1: 90, y1: 2 }, reach: 0, cacheKey: 'far' });
    expect(service.cachedPaths).toBe(2);
    service.terrainChanged(5, 3); // chunk 0, under the first path only
    expect(service.cachedPaths).toBe(1);
  });
});
