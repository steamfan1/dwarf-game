import { describe, expect, it } from 'vitest';
import { FLAG_EXPLORED, unionRect, World } from './World';

describe('World', () => {
  it('indexes cells row by row and checks bounds', () => {
    const world = World.empty(10, 5, 's', 'temperate');
    expect(world.index(3, 2)).toBe(23);
    expect(world.inBounds(9, 4)).toBe(true);
    expect(world.inBounds(10, 0)).toBe(false);
    expect(world.inBounds(0, -1)).toBe(false);
    expect(world.fgAt(-5, 0)).toBe(0);
  });

  it('splits the 400 x 200 world into 13 x 7 chunks, with smaller edge chunks', () => {
    const world = World.empty(400, 200, 's', 'temperate');
    expect([world.chunkCols, world.chunkRows]).toEqual([13, 7]);
    expect(world.chunkIndex(0, 0)).toBe(0);
    expect(world.chunkIndex(399, 199)).toBe(13 * 7 - 1);
    expect(world.chunkCells(12)).toEqual({ x0: 384, y0: 0, x1: 399, y1: 31 });
    expect(world.chunkCells(13 * 6)).toEqual({ x0: 0, y0: 192, x1: 31, y1: 199 });
  });

  it('reveals an ellipse once and reports the changed area', () => {
    const world = World.empty(20, 20, 's', 'temperate');
    const rect = world.revealEllipse(10, 10, 2, 2);
    expect(rect).toEqual({ x0: 8, y0: 8, x1: 12, y1: 12 });
    expect(world.isExplored(10, 10)).toBe(true);
    expect(world.isExplored(14, 10)).toBe(false);
    expect(world.revealEllipse(10, 10, 2, 2)).toBeNull();
  });

  it('treats open sky as always visible', () => {
    const world = World.empty(4, 10, 's', 'temperate');
    world.surface.fill(5);
    expect(world.isVisible(1, 4)).toBe(true);
    expect(world.isVisible(1, 5)).toBe(false);
    world.flags[world.index(1, 5)] = FLAG_EXPLORED;
    expect(world.isVisible(1, 5)).toBe(true);
  });

  it('wraps a snapshot without copying and rejects mismatched arrays', () => {
    const world = World.empty(8, 4, 'seed', 'snow');
    world.fg[5] = 3;
    const copy = World.fromSnapshot(world.toSnapshot());
    expect(copy.fg).toBe(world.fg);
    expect(copy.biome).toBe('snow');
    expect(World.transferables(world.toSnapshot())).toHaveLength(6);
    expect(() => World.fromSnapshot({ ...world.toSnapshot(), fg: new Uint16Array(3) })).toThrow();
  });

  it('unions two cell rectangles', () => {
    expect(unionRect({ x0: 2, y0: 5, x1: 4, y1: 6 }, { x0: 3, y0: 1, x1: 9, y1: 5 })).toEqual({ x0: 2, y0: 1, x1: 9, y1: 6 });
  });
});
