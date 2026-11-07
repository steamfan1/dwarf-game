import { describe, expect, it } from 'vitest';
import tilesJson from '../../data/tiles.json';
import { CHUNK_SIZE } from '../../config';
import { Rng } from '../../core/Rng';
import { CONTENT, CROPS, FURNITURE, ITEMS, RECIPES, TILES } from '../content';
import { GameSession } from '../GameSession';
import { at, makeWorld, newSim } from '../testKit';
import { TileRegistry } from '../world/TileRegistry';
import { World } from '../world/World';
import { decodeChunks, encodeChunks } from './rle';
import { decodeSave, encodeSave, readSaveHeader, SAVE_FORMAT, SaveError } from './SaveFile';
import { captureState, type SimState } from './SimState';

const item = (id: string): number => ITEMS.item(id);

describe('Run-length encoding per chunk', () => {
  it('packs a grid and unpacks it exactly, whatever its size', () => {
    const rng = new Rng('rle');
    for (const [width, height] of [
      [64, 64],
      [70, 37],
      [5, 3],
    ] as const) {
      const grid = new Uint16Array(width * height);
      for (let i = 0; i < grid.length; i++) grid[i] = rng.chance(0.7) ? 3 : rng.int(0, 600);
      const packed = encodeChunks(grid, width, height, CHUNK_SIZE);
      const back = new Uint16Array(width * height);
      decodeChunks(packed, back, width, height, CHUNK_SIZE);
      expect(back).toEqual(grid);
    }
  });

  it('turns a chunk of one block into a single run', () => {
    const grid = new Uint8Array(32 * 32).fill(7);
    expect([...encodeChunks(grid, 32, 32, 32)]).toEqual([1, 7, 1024]);
  });

  it('refuses data that does not fit the grid', () => {
    const packed = encodeChunks(new Uint8Array(64 * 32).fill(1), 64, 32, 32);
    expect(() => decodeChunks(packed.subarray(0, packed.length - 1), new Uint8Array(64 * 32), 64, 32, 32)).toThrow();
    expect(() => decodeChunks(packed, new Uint8Array(32 * 32), 32, 32, 32)).toThrow();
  });
});

/** A colony with a bit of everything going on. */
function busyColony() {
  const made = newSim(undefined, { startHour: 8 });
  const { sim, world, run } = made;
  sim.storage.add(item('plank'), 30);
  sim.storage.add(item('log'), 5);
  sim.storage.add(item('iron_ore'), 4);
  sim.placeFurniture(FURNITURE.id('chest'), 14, 9);
  sim.placeFurniture(FURNITURE.id('workbench'), 16, 9);
  sim.designate('dig', at(24, 12), 3);
  sim.designateBuild(item('plank'), { x0: 27, y0: 9, x1: 28, y1: 9 }, 2);
  // Waiting for stone the colony doesn't have yet (it has 4, a furnace takes 10).
  sim.queueCraft(RECIPES.get('furnace').index, 1);
  sim.designateFarm(0, { x0: 9, y0: 9, x1: 10, y1: 9 }, 2);
  sim.dropItems(item('stone'), 4, 30, 9);
  const dwarf = sim.dwarves[0]!;
  dwarf.skills.mining = { level: 3, xp: 260 };
  dwarf.equipment.tool = item('copper_pickaxe');
  sim.dwarves[2]!.phase = 'dead';
  sim.dwarves[2]!.deathCause = 'fall';
  sim.spawnCreatureNear('mossback', 12);
  sim.research.add(25);
  sim.tileDamage.add(world.index(30, 10), 40);
  run(300);
  return made;
}

/** A state with lists put in a fixed order, for comparing two states. */
function normal(state: SimState): unknown {
  const sorted = <T>(list: T[]): T[] => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { ...state, storage: sorted(state.storage), ground: sorted(state.ground), jobs: sorted(state.jobs), furniture: sorted(state.furniture.map((piece) => ({ ...piece, id: 0 }))) };
}

describe('Saving and loading', () => {
  it('a saved world loads back the same, and plays on', () => {
    const { sim } = busyColony();
    const before = captureState(sim);
    const bytes = encodeSave(sim.world, TILES, { day: 1, dwarves: 2, seed: sim.world.seed, biome: sim.world.biome, savedAt: 0 }, before);
    const loaded = GameSession.fromSave(bytes, CONTENT);
    const after = captureState(loaded.sim);
    expect(normal(after)).toEqual(normal(before));
    for (const grid of ['fg', 'bg', 'liquidType', 'liquidAmount', 'flags', 'surface'] as const) expect(loaded.world[grid]).toEqual(sim.world[grid]);
    expect(loaded.sim.dwarves.map((d) => d.name)).toEqual(sim.dwarves.map((d) => d.name));
    expect(loaded.sim.dwarves[0]!.equipment.tool).toBe(item('copper_pickaxe'));
    expect(loaded.sim.dwarves[2]!.phase).toBe('dead');
    expect(loaded.sim.storage.capacity).toBe(sim.storage.capacity);
    expect(loaded.sim.time.day(loaded.sim.tick)).toBe(sim.time.day(sim.tick));
    expect(loaded.sim.time.clock(loaded.sim.tick)).toEqual(sim.time.clock(sim.tick));
    // It plays on: given the stone, the dwarves get back to work and finish the crafting order.
    expect(loaded.sim.crafting.orders).toHaveLength(1);
    loaded.sim.storage.add(item('stone'), 10);
    for (let i = 0; i < 3000 && loaded.sim.crafting.orders.length > 0; i++) loaded.sim.step();
    expect(loaded.sim.crafting.orders).toHaveLength(0);
    loaded.dispose();
  });

  it('goes through a session: the save says what the title screen shows', () => {
    const session = new GameSession(makeWorld(), CONTENT, () => 0, 9);
    for (let i = 0; i < 50; i++) session.sim.step();
    const { bytes, meta } = session.save(1234);
    expect(meta).toEqual({ day: 1, dwarves: 3, seed: 'sim-test', biome: 'temperate', savedAt: 1234 });
    expect(readSaveHeader(bytes).meta).toEqual(meta);
    const again = GameSession.fromSave(bytes, CONTENT);
    expect(again.sim.tick).toBe(50);
    expect(again.sim.dwarves).toHaveLength(3);
  });

  it('keeps farms, research and a finished gate', () => {
    const { sim, world, run } = newSim(undefined, { startHour: 8 });
    const wheat = CROPS.crops.findIndex((c) => c.id === 'wheat');
    const cell = world.index(26, 9);
    const plot = sim.farms.add(cell, wheat, 'growing', 3);
    world.fg[cell] = CROPS.crops[wheat]!.stages[0]!;
    world.fg[cell + world.width] = CROPS.farmland;
    run(100);
    sim.reachTier(2);
    sim.research.recordCraft(RECIPES.get('anvil').index, item('anvil'));
    sim.placeFurniture(FURNITURE.id('world_gate'), 30, 9);
    const bytes = encodeSave(sim.world, TILES, { day: 1, dwarves: 6, seed: 's', biome: 'temperate', savedAt: 0 }, captureState(sim));
    const loaded = GameSession.fromSave(bytes, CONTENT).sim;
    const back = loaded.farms.get(cell)!;
    expect(back).toMatchObject({ crop: wheat, state: 'growing', growth: plot.growth, priority: 3 });
    expect(loaded.research.tier).toBe(2);
    expect(loaded.research.crafted.has(item('anvil'))).toBe(true);
    expect(loaded.dwarves).toHaveLength(sim.dwarves.length);
    expect(loaded.won).toBe(true);
  });

  it('maps saved blocks onto the content files, even after they are reordered', () => {
    // A tiles.json with its tiles in another order (open air stays first).
    const json = structuredClone(tilesJson) as { tiles: unknown[] };
    json.tiles = [json.tiles[0], ...json.tiles.slice(1).reverse()];
    const other = TileRegistry.fromJson(json);
    const world = World.empty(40, 20, 'reordered', 'temperate');
    world.fg[world.index(3, 4)] = other.tile('stone');
    world.fg[world.index(5, 4)] = other.tile('wheat_ripe');
    const state = captureState(newSim().sim);
    const bytes = encodeSave(world, other, { day: 1, dwarves: 3, seed: 'reordered', biome: 'temperate', savedAt: 0 }, state);
    const { world: loaded } = decodeSave(bytes, TILES);
    expect(loaded.fg[loaded.index(3, 4)]).toBe(TILES.tile('stone'));
    expect(loaded.fg[loaded.index(5, 4)]).toBe(TILES.tile('wheat_ripe'));
    expect(loaded.fg[loaded.index(6, 4)]).toBe(0);
  });

  it('refuses saves from a newer version, and damaged ones, with the reason', () => {
    const session = new GameSession(makeWorld(), CONTENT);
    const { bytes } = session.save(0);
    const problem = (data: Uint8Array): string => {
      try {
        GameSession.fromSave(data, CONTENT);
      } catch (error) {
        return error instanceof SaveError ? error.problem : 'other';
      }
      return 'none';
    };
    expect(problem(bytes)).toBe('none');
    const newer = bytes.slice();
    new DataView(newer.buffer).setUint16(4, SAVE_FORMAT + 1, true);
    expect(problem(newer)).toBe('newer');
    expect(problem(bytes.slice(0, bytes.length - 10))).toBe('damaged');
    expect(problem(new TextEncoder().encode('not a save at all'))).toBe('damaged');
    const scrambled = bytes.slice();
    scrambled[10] = 0x5b; // the header JSON no longer parses
    expect(problem(scrambled)).toBe('damaged');
  });

  it('packs a whole world small', () => {
    const session = new GameSession(makeWorld(), CONTENT);
    const { bytes } = session.save(0);
    // 48 x 24 cells in five grids would be about 8 KB unpacked; runs make it far less.
    expect(bytes.length).toBeLessThan(6000);
  });
});
