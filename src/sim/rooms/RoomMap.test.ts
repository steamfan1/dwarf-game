import { describe, expect, it } from 'vitest';
import { FURNITURE, TILES } from '../content';
import { FurnitureSet } from '../furniture/Furniture';
import { World } from '../world/World';
import { RoomMap } from './RoomMap';

/**
 * A 20 x 12 world of open air with a box of stone: walls of blocks around the cells
 * x 5..10, y 4..7 (so the inside is 6 x 4), with a background wall behind the inside.
 */
function boxWorld(): { world: World; inside: Array<[number, number]> } {
  const world = World.empty(20, 12, 'rooms', 'temperate');
  const stone = TILES.tile('stone');
  const wall = TILES.wall('stone_wall');
  const inside: Array<[number, number]> = [];
  for (let y = 3; y <= 8; y++) {
    for (let x = 4; x <= 11; x++) {
      const edge = x === 4 || x === 11 || y === 3 || y === 8;
      const i = world.index(x, y);
      if (edge) world.fg[i] = stone;
      else {
        world.bg[i] = wall;
        inside.push([x, y]);
      }
    }
  }
  return { world, inside };
}

describe('RoomMap', () => {
  it('finds a space closed in by blocks, with a wall behind every cell, as a room', () => {
    const { world, inside } = boxWorld();
    const rooms = new RoomMap(world, TILES);
    rooms.rebuild();
    expect(rooms.size).toBe(1);
    const room = rooms.roomAt(5, 4)!;
    expect(room.size).toBe(inside.length);
    expect(room.rect).toEqual({ x0: 5, y0: 4, x1: 10, y1: 7 });
    for (const [x, y] of inside) expect(rooms.roomAt(x, y)).toBe(room);
    // Outside, and in the blocks themselves: no room.
    expect(rooms.roomAt(2, 2)).toBeUndefined();
    expect(rooms.roomAt(4, 5)).toBeUndefined();
  });

  it("isn't a room with a gap in its walls or a cell with no wall behind it", () => {
    const gap = boxWorld();
    gap.world.fg[gap.world.index(11, 5)] = 0;
    const open = new RoomMap(gap.world, TILES);
    open.rebuild();
    expect(open.roomAt(6, 5)).toBeUndefined();

    const bare = boxWorld();
    bare.world.bg[bare.world.index(7, 6)] = 0;
    const holed = new RoomMap(bare.world, TILES);
    holed.rebuild();
    expect(holed.roomAt(6, 5)).toBeUndefined();
  });

  it('counts a door as part of the enclosure, not of the room', () => {
    const { world } = boxWorld();
    world.fg[world.index(11, 7)] = TILES.tile('wooden_door');
    const rooms = new RoomMap(world, TILES);
    rooms.rebuild();
    expect(rooms.roomAt(10, 7)).toBeDefined();
    expect(rooms.roomAt(11, 7)).toBeUndefined();
  });

  it("doesn't count a space bigger than the limit (a vast cave)", () => {
    const { world } = boxWorld();
    const rooms = new RoomMap(world, TILES, 10);
    rooms.rebuild();
    expect(rooms.size).toBe(0);
  });

  it('counts the beds, tables and lights inside a room', () => {
    const { world } = boxWorld();
    const furniture = new FurnitureSet(world, FURNITURE);
    furniture.place(FURNITURE.id('bed'), 5, 7);
    furniture.place(FURNITURE.id('table'), 8, 7);
    furniture.place(FURNITURE.id('torch'), 10, 5);
    furniture.place(FURNITURE.id('chest'), 15, 10); // outside
    const rooms = new RoomMap(world, TILES);
    rooms.rebuild(furniture);
    expect(rooms.roomAt(6, 6)).toMatchObject({ beds: 1, tables: 1, lights: 1 });
  });
});
