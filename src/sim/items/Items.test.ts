import { describe, expect, it } from 'vitest';
import { ITEMS, TILES } from '../content';
import { World } from '../world/World';
import { ColonyStorage, GroundItems } from './Items';

const DIRT = ITEMS.item('dirt');
const STONE = ITEMS.item('stone');

/** Air over stone at row 8, with a lava cell at (6, 8) and a water pool at (3, 7). */
function setup() {
  const world = World.empty(10, 10, 'items-test', 'temperate');
  for (let x = 0; x < 10; x++) for (let y = 8; y < 10; y++) world.fg[world.index(x, y)] = TILES.tile('stone');
  world.fg[world.index(6, 8)] = 0;
  world.liquidType[world.index(6, 8)] = TILES.liquid('lava');
  world.liquidType[world.index(3, 7)] = TILES.liquid('water');
  return { world, ground: new GroundItems(world, TILES, ITEMS) };
}

describe('GroundItems', () => {
  it('drops a stack that falls until it rests on solid ground, sinking through water', () => {
    const { ground } = setup();
    const [stack] = ground.drop(DIRT, 1, 3, 2);
    expect(stack!.falling).toBe(true);
    for (let i = 0; i < 10; i++) ground.step();
    expect(stack).toMatchObject({ x: 3, y: 7, falling: false });
  });

  it('merges a drop into a resting stack of the same item, up to the stack size', () => {
    const { ground } = setup();
    ground.drop(DIRT, 1, 1, 7);
    expect(ground.drop(DIRT, 2, 1, 7)).toEqual([]);
    expect(ground.drop(STONE, 1, 1, 7)).toHaveLength(1);
    expect([...ground.all()].map((s) => s.count)).toEqual([3, 1]);
    const max = ITEMS.get(DIRT).stack;
    expect(ground.drop(DIRT, max, 1, 7)).toHaveLength(1);
    expect([...ground.all()].filter((s) => s.item === DIRT).map((s) => s.count)).toEqual([max, 3]);
  });

  it('burns stacks that fall into lava', () => {
    const { ground } = setup();
    const [stack] = ground.drop(DIRT, 1, 6, 5);
    let burned: number[] = [];
    for (let i = 0; i < 5; i++) burned = burned.concat(ground.step().map((s) => s.id));
    expect(burned).toEqual([stack!.id]);
    expect(ground.size).toBe(0);
  });
});

describe('ColonyStorage', () => {
  it('adds, counts and takes items', () => {
    const storage = new ColonyStorage();
    storage.add(DIRT, 3);
    storage.add(STONE, 2);
    storage.add(DIRT, 1);
    expect(storage.count(DIRT)).toBe(4);
    expect(storage.take(DIRT, 10)).toBe(4);
    expect(storage.take(DIRT, 1)).toBe(0);
    expect(storage.entries()).toEqual([{ item: STONE, count: 2 }]);
  });
});
