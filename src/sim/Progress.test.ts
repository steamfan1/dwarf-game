import { describe, expect, it } from 'vitest';
import { COLONY, CROPS, FURNITURE, ITEMS, RECIPES, TECH, TILES } from './content';
import { travellerOf } from './dwarves/Dwarf';
import { at, newSim } from './testKit';
import { AIR } from './world/TileRegistry';

const item = (id: string): number => ITEMS.item(id);
const recipe = (id: string): number => RECIPES.get(id).index;
const crop = (id: string): number => CROPS.crops.findIndex((c) => c.id === id);

// The test world (see testKit.ts): open sky down to row 9, grass on row 10, the Hearth
// at (20, 9), a tree on column 34.

describe('The tech tree', () => {
  it('starts with the first tier: later recipes cannot be queued yet', () => {
    const { sim } = newSim();
    expect(sim.research.tier).toBe(0);
    expect(sim.research.unlocked(recipe('planks'))).toBe(true);
    expect(sim.research.unlocked(recipe('copper_sword'))).toBe(false);
    expect(sim.queueCraft(recipe('copper_sword'), 1)).toBeNull();
    expect(sim.crafting.orders).toHaveLength(0);
  });

  it('earns research the first time each item is made, never again for the same item', () => {
    const { sim, bus, runUntil } = newSim();
    const gained: Array<{ item: number; points: number }> = [];
    bus.on('ResearchGained', ({ item: made, points }) => gained.push({ item: made, points }));
    sim.storage.add(item('log'), 4);
    sim.queueCraft(recipe('planks'), 2);
    runUntil(() => sim.crafting.orders.length === 0, 3000);
    expect(gained).toEqual([{ item: item('plank'), points: TECH.tiers[0]!.newItemResearch }]);
    expect(sim.research.points).toBe(TECH.tiers[0]!.newItemResearch);
    expect(sim.research.crafted.has(item('plank'))).toBe(true);
  });

  it('a full tier unlocks the next: new recipes, and the dwarves it brings walk up to the Hearth', () => {
    const { sim, bus, runUntil } = newSim();
    const reached: string[] = [];
    const arrived: string[] = [];
    bus.on('TierReached', ({ name }) => reached.push(name));
    bus.on('DwarfArrived', ({ name }) => arrived.push(name));
    // Four new items fill the first tier (40 research at 10 each).
    sim.storage.add(item('log'), 1);
    sim.storage.add(item('plank'), 8);
    sim.storage.add(item('fiber'), 1);
    for (const id of ['planks', 'torches', 'ladders', 'chest']) sim.queueCraft(recipe(id), 1);
    runUntil(() => sim.crafting.orders.length === 0, 4000);
    expect(reached).toEqual([TECH.tiers[1]!.name]);
    expect(sim.research.tier).toBe(1);
    expect(sim.research.unlocked(recipe('bed'))).toBe(true);
    expect(sim.queueCraft(recipe('bed'), 1)).not.toBeNull();
    expect(sim.dwarves).toHaveLength(COLONY.startingDwarves + TECH.tiers[1]!.dwarves);
    expect(arrived).toHaveLength(TECH.tiers[1]!.dwarves);
    const newcomer = sim.dwarves[sim.dwarves.length - 1]!;
    expect(Math.abs(newcomer.x - sim.hearth.x)).toBeLessThanOrEqual(4);
    expect(new Set(sim.dwarves.map((d) => d.name)).size).toBe(sim.dwarves.length);
  });

  it('research overflows into the next tier', () => {
    const { sim } = newSim();
    const reached = sim.research.add(TECH.tiers[0]!.research + 5);
    expect(reached.map((tier) => tier.index)).toEqual([1]);
    expect(sim.research.points).toBe(5);
  });

  it('brings the colony up to twelve dwarves by the last tier, and no further', () => {
    const { sim } = newSim();
    sim.reachTier(TECH.lastTier);
    expect(sim.research.complete).toBe(true);
    expect(sim.dwarves).toHaveLength(COLONY.maxDwarves);
    expect(sim.welcomeDwarf()).toBeNull();
    expect(sim.research.unlocked(recipe('world_gate'))).toBe(true);
  });
});

describe('Farming', () => {
  it('a plot is tilled, sown, grows in the light, ripens and is picked, then sown again', () => {
    const { sim, world, run, runUntil } = newSim(undefined, { startHour: 7 });
    const wheat = crop('wheat');
    const seeds = item('wheat_seeds');
    const startSeeds = sim.storage.count(seeds);
    expect(sim.farmStatus(26, 9)).toBe('ok');
    expect(sim.designateFarm(wheat, at(26, 9), 2)).toBe(1);
    expect(sim.jobs.at(26, 9)?.type).toBe('till');
    runUntil(() => world.fg[world.index(26, 10)] === CROPS.farmland, 2000);
    runUntil(() => sim.plotAt(26, 9)?.state === 'growing', 2000);
    expect(sim.storage.count(seeds)).toBe(startSeeds - 1);
    expect(world.fg[world.index(26, 9)]).toBe(CROPS.crops[wheat]!.stages[0]);
    expect(sim.dwarves.some((d) => d.skills.farming.xp > 0)).toBe(true);
    // It ripens after its days of daylight (sped up here), and a dwarf picks it.
    sim.ripenCrops();
    run(25);
    expect(sim.plotAt(26, 9)?.state).toBe('ripe');
    expect(world.fg[world.index(26, 9)]).toBe(CROPS.crops[wheat]!.stages.at(-1));
    runUntil(() => sim.storage.count(item('wheat')) >= 3, 3000);
    // The seeds come back with the harvest, and the plot is sown again.
    runUntil(() => sim.plotAt(26, 9)?.state === 'growing', 3000);
    runUntil(() => sim.storage.count(seeds) === startSeeds + 2 - 2, 3000);
  });

  it('crops only grow in light: a plot in the dark waits', () => {
    const { sim, world, run } = newSim(undefined, { startHour: 7 });
    sim.dwarves.splice(0);
    // A pocket underground, far from any light.
    for (let x = 28; x <= 30; x++) world.fg[world.index(x, 13)] = AIR;
    world.revealAll();
    const wheat = crop('wheat');
    const cell = world.index(29, 13);
    const plot = sim.farms.add(cell, wheat, 'growing', 2);
    world.fg[cell] = CROPS.crops[wheat]!.stages[0]!;
    world.fg[cell + world.width] = CROPS.farmland;
    run(200);
    expect(plot.growth).toBe(0);
    expect(plot.lit).toBe(false);
    // A torch beside it, and it grows.
    sim.placeFurniture(FURNITURE.id('torch'), 28, 13);
    run(200);
    expect(plot.growth).toBeGreaterThan(0);
    expect(sim.plotProgress(plot)).toBeGreaterThan(0);
  });

  it('a lit plot ripens after its days of daylight', () => {
    const { sim, world, run } = newSim(undefined, { startHour: 7 });
    sim.dwarves.splice(0);
    const sunroot = crop('sunroot');
    const cell = world.index(26, 9);
    const plot = sim.farms.add(cell, sunroot, 'growing', 2);
    world.fg[cell] = CROPS.crops[sunroot]!.stages[0]!;
    world.fg[cell + world.width] = CROPS.farmland;
    const days = CROPS.crops[sunroot]!.growDays;
    run(Math.round(days * sim.time.cycleTicks) + 400);
    expect(plot.state).toBe('ripe');
  });

  it('farms only open ground over soil, and the Cancel tool gives a growing seed back', () => {
    const { sim, world } = newSim();
    expect(sim.farmStatus(26, 12)).not.toBe('ok'); // inside the ground
    world.fg[world.index(27, 10)] = TILES.tile('stone');
    expect(sim.farmStatus(27, 9)).toBe('needs-soil');
    const wheat = crop('wheat');
    const cell = world.index(26, 9);
    sim.farms.add(cell, wheat, 'growing', 2);
    world.fg[cell] = CROPS.crops[wheat]!.stages[0]!;
    world.fg[cell + world.width] = CROPS.farmland;
    expect(sim.farmStatus(26, 9)).toBe('marked');
    expect(sim.buildStatus(item('plank'), 26, 9)).toBe('marked');
    expect(sim.cancelDesignations(at(26, 9))).toBe(1);
    expect(sim.plotAt(26, 9)).toBeUndefined();
    expect(world.fg[cell]).toBe(AIR);
    expect([...sim.ground.all()].some((stack) => stack.item === item('wheat_seeds'))).toBe(true);
  });

  it('a plot whose soil is dug away is given up', () => {
    const { sim, world, run } = newSim();
    sim.dwarves.splice(0);
    sim.designateFarm(crop('wheat'), at(26, 9), 2);
    expect(sim.plotAt(26, 9)).toBeDefined();
    world.fg[world.index(26, 10)] = AIR;
    run(25);
    expect(sim.plotAt(26, 9)).toBeUndefined();
    expect(sim.jobs.at(26, 9)).toBeUndefined();
  });

  it('cooking is worth it: cooked food fills far more than the raw food it is made from', () => {
    const food = (id: string): number => ITEMS.get(item(id)).food!.hunger;
    expect(food('cooked_meat')).toBeGreaterThanOrEqual(3 * food('raw_meat'));
    expect(food('baked_sunroot')).toBeGreaterThanOrEqual(3 * food('sunroot'));
    expect(food('bread')).toBeGreaterThanOrEqual(2 * 3 * food('wheat'));
  });
});

describe('The World Gate', () => {
  it('building it wins the world', () => {
    const { sim, bus } = newSim();
    const won: number[] = [];
    bus.on('WorldWon', ({ day }) => won.push(day));
    expect(sim.won).toBe(false);
    sim.placeFurniture(FURNITURE.id('world_gate'), 26, 9);
    expect(sim.won).toBe(true);
    expect(won).toEqual([1]);
    // Only once.
    sim.placeFurniture(FURNITURE.id('world_gate'), 30, 9);
    expect(won).toEqual([1]);
  });

  it('dwarves who step through it start the next world, with their skills and gear', () => {
    const first = newSim().sim;
    const veteran = first.dwarves[0]!;
    veteran.skills.mining = { level: 4, xp: 500 };
    veteran.equipment.tool = item('iron_pickaxe');
    const next = newSim(undefined, { travellers: [travellerOf(veteran, (n) => ITEMS.get(n).id)] }).sim;
    const arrived = next.dwarves[0]!;
    expect(arrived.name).toBe(veteran.name);
    expect(arrived.skills.mining).toEqual({ level: 4, xp: 500 });
    expect(arrived.equipment.tool).toBe(item('iron_pickaxe'));
    expect(arrived.health).toBe(arrived.maxHealth);
    expect(next.dwarves).toHaveLength(COLONY.startingDwarves);
    expect(next.dwarves[1]!.name).not.toBe(veteran.name);
  });
});
