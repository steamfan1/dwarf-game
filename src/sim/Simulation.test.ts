import { describe, expect, it } from 'vitest';
import { CONTENT, ITEMS, TILES } from './content';
import { at, newSim } from './testKit';
import { AIR } from './world/TileRegistry';
import { World } from './world/World';
import { generateWorld } from './worldgen/generateWorld';

describe('Simulation: dwarves change the world, the player only gives orders', () => {
  it('starts with three named dwarves beside the Hearth, and the sunlit surface already explored', () => {
    const { sim, world } = newSim();
    expect(sim.dwarves).toHaveLength(3);
    expect(new Set(sim.dwarves.map((d) => d.name)).size).toBe(3);
    for (const dwarf of sim.dwarves) {
      expect(dwarf.y).toBe(9);
      expect(sim.nav.standable(dwarf.x, dwarf.y)).toBe(true);
    }
    // Daylight reaches a few blocks into the ground everywhere, even far from the colony.
    expect(world.isExplored(1, 10)).toBe(true);
    expect(world.isExplored(46, 12)).toBe(true);
    // Deep rock stays unexplored.
    expect(world.isExplored(1, 20)).toBe(false);
  });

  it('marks a block for digging without changing it', () => {
    const { sim, world, bus } = newSim();
    const marks: string[] = [];
    bus.on('DesignationChanged', ({ x, y }) => marks.push(`${x},${y}`));
    expect(sim.designate('dig', at(26, 10), 2)).toBe(1);
    expect(world.fg[world.index(26, 10)]).toBe(TILES.tile('grass'));
    expect(sim.jobs.at(26, 10)?.type).toBe('dig');
    expect(marks).toEqual(['26,10']);
    expect(sim.digStatus(26, 10)).toBe('marked');
  });

  it('has a dwarf dig a marked block, then haul what it dropped to the Hearth', () => {
    const { sim, world, runUntil } = newSim();
    sim.designate('dig', at(26, 10), 2);
    runUntil(() => world.fg[world.index(26, 10)] === AIR);
    expect(sim.jobs.at(26, 10)).toBeUndefined();
    runUntil(() => sim.storage.count(ITEMS.item('dirt')) === 1);
    expect(sim.ground.size).toBe(0);
    expect(sim.jobs.size).toBe(0);
    // Somebody gained mining experience.
    expect(sim.dwarves.some((d) => d.skills.mining.xp > 0)).toBe(true);
  });

  it('digs out a whole pit, climbing its walls to get back out', () => {
    const { sim, world, runUntil } = newSim();
    // Only explored cells can be marked: pretend the player has seen below the sunlit rows.
    world.revealEllipse(25, 12, 6, 6);
    expect(sim.designate('dig', { x0: 24, y0: 10, x1: 27, y1: 13 }, 2)).toBe(16);
    // Done when no work is left, nobody is busy and everything is stored.
    runUntil(() => sim.jobs.size === 0 && sim.ground.size === 0 && sim.dwarves.every((d) => d.carrying.length === 0), 10_000);
    for (let y = 10; y <= 13; y++) for (let x = 24; x <= 27; x++) expect(world.fg[world.index(x, y)]).toBe(AIR);
    expect(sim.storage.count(ITEMS.item('dirt'))).toBe(16);
    // Everyone can still walk home.
    for (const dwarf of sim.dwarves) expect(sim.homeMaps.canGetHome(world.index(dwarf.x, dwarf.y))).toBe(true);
  });

  it('leaves a block standing if digging it would drop a dwarf into a hole with no way out', () => {
    const { sim, world, runUntil } = newSim();
    // A shaft with no background wall: nothing to climb once inside it.
    for (let y = 10; y <= 16; y++) world.bg[world.index(26, y)] = 0;
    world.revealEllipse(26, 13, 4, 6);
    expect(sim.designate('dig', { x0: 26, y0: 10, x1: 26, y1: 15 }, 2)).toBe(6);
    runUntil(() => [...sim.jobs.all()].every((job) => job.type === 'dig' && job.blocked && job.claimedBy === 0) && sim.ground.size === 0, 10_000);
    // Dwarves can drop four tiles but only jump up one, so the bottom of the shaft stays.
    expect(world.fg[world.index(26, 15)]).not.toBe(AIR);
    for (const dwarf of sim.dwarves) expect(sim.homeMaps.canGetHome(world.index(dwarf.x, dwarf.y))).toBe(true);
  });

  it('with the Auto tool, marks trees for felling and blocks for digging', () => {
    const { sim } = newSim();
    expect(sim.autoTarget(33, 4)).toBe('chop'); // a leaf of the oak
    expect(sim.autoTarget(40, 10)).toBe('dig');
    expect(sim.autoTarget(20, 5)).toBeNull(); // open air
    expect(sim.autoTarget(20, 10)).toBeNull(); // holds up the Hearth
    // A drag over the oak and the ground beside it: one tree, and the diggable blocks.
    expect(sim.designate('auto', { x0: 33, y0: 8, x1: 36, y1: 10 }, 2)).toBe(1 + 3);
    expect(sim.jobs.at(34, 9)?.type).toBe('chop');
    expect(sim.jobs.at(35, 10)?.type).toBe('dig');
    expect(sim.jobs.at(34, 10)).toBeUndefined(); // the oak stands on it
  });

  it('refuses to mark what cannot be dug, and says why', () => {
    const { sim } = newSim();
    expect(sim.digStatus(20, 5)).toBe('nothing-to-dig');
    expect(sim.digStatus(20, 10)).toBe('supports-hearth');
    expect(sim.digStatus(34, 10)).toBe('supports-tree');
    expect(sim.digStatus(5, 20)).toBe('unexplored');
    expect(sim.digStatus(-1, 0)).toBe('out-of-bounds');
    expect(sim.designate('dig', { x0: 19, y0: 10, x1: 21, y1: 10 }, 2)).toBe(0);
  });

  it('fells a whole tree when any part of it is marked, and the wood gets stored', () => {
    const { sim, world, runUntil } = newSim();
    expect(sim.designate('chop', at(33, 4), 2)).toBe(1); // a leaf
    expect(sim.jobs.at(34, 9)?.type).toBe('chop'); // the mark covers the trunk
    runUntil(() => world.fg[world.index(34, 9)] === AIR);
    for (let y = 3; y <= 9; y++) for (let x = 32; x <= 36; x++) expect(world.fg[world.index(x, y)]).toBe(AIR);
    runUntil(() => sim.storage.count(ITEMS.item('log')) > 0);
    expect(sim.digStatus(34, 10)).toBe('ok');
  });

  it('cancels marks, and a dwarf on that job stops', () => {
    const { sim, world, run } = newSim();
    sim.designate('dig', at(40, 10), 2);
    run(40);
    expect(sim.jobs.at(40, 10)?.claimedBy).not.toBe(0);
    expect(sim.cancelDesignations({ x0: 38, y0: 10, x1: 42, y1: 14 })).toBe(1);
    run(400);
    expect(world.fg[world.index(40, 10)]).toBe(TILES.tile('grass'));
    expect(sim.dwarves.every((d) => d.jobId === 0)).toBe(true);
  });

  it('takes urgent jobs before normal ones', () => {
    const { sim, run } = newSim();
    // Four normal jobs near the colony, two far-off ones made urgent.
    for (const x of [16, 17, 23, 24, 4, 44]) sim.designate('dig', at(x, 10), 2);
    expect(sim.prioritize(at(4, 10), 4) + sim.prioritize(at(44, 10), 4)).toBe(2);
    expect(sim.jobs.at(4, 10)?.priority).toBe(4);
    run(30);
    // Three dwarves: the two urgent jobs are taken first, then one normal job.
    expect(sim.jobs.at(4, 10)?.claimedBy).not.toBe(0);
    expect(sim.jobs.at(44, 10)?.claimedBy).not.toBe(0);
    expect([16, 17, 23, 24].filter((x) => sim.jobs.at(x, 10)?.claimedBy !== 0)).toHaveLength(1);
  });

  it('flags a job no dwarf can reach, and takes it on once a staircase leads there', () => {
    const { sim, run, runUntil } = newSim();
    // A block deep under solid ground: nowhere to stand next to it. (Only explored cells
    // can be marked, so pretend the player has already seen this patch of rock.)
    sim.world.revealEllipse(35, 13, 7, 7);
    expect(sim.designate('dig', at(38, 17), 2)).toBe(1);
    run(1);
    expect(sim.jobs.at(38, 17)?.blocked).toBe(true);
    // A staircase down to it: one tile across and one down per step, with headroom to jump back up.
    for (let k = 1; k <= 7; k++) {
      sim.designate('dig', at(30 + k, 9 + k), 3);
      if (k >= 2) sim.designate('dig', at(30 + k, 8 + k), 3);
    }
    runUntil(() => sim.world.fg[sim.world.index(38, 17)] === AIR, 20_000);
  });

  it('hurts a dwarf that falls further than the safe drop', () => {
    const { sim, world, run } = newSim();
    const dwarf = sim.dwarves[0]!;
    // Hollow out a pit six tiles deep under the dwarf (two more than the safe drop), with
    // no background wall to catch hold of.
    for (let y = 10; y <= 15; y++) {
      world.fg[world.index(dwarf.x, y)] = AIR;
      world.bg[world.index(dwarf.x, y)] = 0;
    }
    run(40);
    expect(dwarf.y).toBe(15);
    expect(dwarf.health).toBe(dwarf.maxHealth - 2 * CONTENT.colony.movement.fallDamagePerRow);
  });

  it('plays out identically from the same seed and orders', () => {
    const play = (): string => {
      const world = World.fromSnapshot(generateWorld({ seed: 'replay', biome: 'temperate' }).snapshot);
      const { sim, run } = newSim(world);
      const { x, y } = sim.hearth;
      sim.designate('dig', { x0: x + 3, y0: y + 1, x1: x + 8, y1: y + 3 }, 2);
      run(1200);
      const dwarves = sim.dwarves.map((d) => `${d.name}@${d.x},${d.y}:${d.phase}:${d.skills.mining.xp}`).join('|');
      let terrain = 0;
      for (let i = 0; i < world.fg.length; i++) terrain = (terrain * 31 + world.fg[i]!) | 0;
      return `${dwarves}#${terrain}#${sim.storage.entries().map((e) => `${e.item}x${e.count}`).join(',')}`;
    };
    expect(play()).toBe(play());
  });
});
