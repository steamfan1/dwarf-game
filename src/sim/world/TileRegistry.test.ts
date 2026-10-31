import { describe, expect, it } from 'vitest';
import tilesJson from '../../data/tiles.json';
import { TILES } from '../content';
import { AIR, NO_WALL, TileRegistry } from './TileRegistry';

describe('shipped tiles.json', () => {
  it('validates, with air and "no wall" at id 0', () => {
    expect(TILES.tiles[AIR]!.id).toBe('air');
    expect(TILES.walls[NO_WALL]!.id).toBe('none');
    expect(TILES.tile('dirt')).toBeGreaterThan(0);
    expect(TILES.liquid('water')).toBeGreaterThan(0);
  });

  it('builds lookup tables that match the definitions', () => {
    const dirt = TILES.tile('dirt');
    const bedrock = TILES.tile('bedrock');
    const leaves = TILES.tile('leaves');
    expect([TILES.solid[dirt], TILES.diggable[dirt]]).toEqual([1, 1]);
    expect([TILES.solid[bedrock], TILES.diggable[bedrock]]).toEqual([1, 0]);
    expect([TILES.solid[leaves], TILES.diggable[leaves], TILES.replaceable[leaves]]).toEqual([0, 0, 1]);
  });

  it('joins all solid blocks visually, but leaves only with leaves', () => {
    expect(TILES.connectGroup[TILES.tile('dirt')]).toBe(TILES.connectGroup[TILES.tile('stone')]);
    expect(TILES.connectGroup[TILES.tile('leaves')]).not.toBe(TILES.connectGroup[TILES.tile('dirt')]);
    expect(TILES.connectGroup[TILES.tile('leaves')]).not.toBe(TILES.connectGroup[TILES.tile('pine_leaves')]);
    expect(TILES.connectGroup[TILES.tile('tall_grass')]).toBe(0);
  });

  it('throws on unknown ids, so content typos fail loudly', () => {
    expect(() => TILES.tile('dirtt')).toThrow('Unknown tile');
  });
});

describe('TileRegistry validation', () => {
  it('reports every problem in one error', () => {
    const broken = structuredClone(tilesJson) as { tiles: Array<Record<string, unknown>> };
    broken.tiles.push({ ...broken.tiles[1]! }); // duplicate "dirt"
    broken.tiles[2]!.mapColor = 'green';
    broken.tiles[3]!.art = { style: 'sparkly' };
    let message = '';
    try {
      TileRegistry.fromJson(broken);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('duplicate tile id "dirt"');
    expect(message).toContain('tiles[2].mapColor must be a colour');
    expect(message).toContain('tiles[3].art.style must be one of');
  });

  it('checks sprite rows against their palette and size', () => {
    const broken = structuredClone(tilesJson) as { tiles: Array<{ id: string; art: { rows?: string[] } }> };
    const grass = broken.tiles.find((t) => t.id === 'tall_grass')!;
    grass.art.rows = ['..a..', 'zzzzzzzzzzzzzzzz'];
    expect(() => TileRegistry.fromJson(broken)).toThrow(/rows\[0\] is 5 characters wide[\s\S]*rows\[1\] uses "z"/);
  });
});
