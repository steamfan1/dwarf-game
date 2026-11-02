import { describe, expect, it } from 'vitest';
import { CONTENT, FURNITURE, ITEMS, TILES } from './content';
import { at, newSim } from './testKit';
import { AIR } from './world/TileRegistry';

const item = (id: string): number => ITEMS.item(id);
const kind = (id: string): number => FURNITURE.id(id);
const needs = CONTENT.colony.needs;
const CYCLE = CONTENT.time.dayTicks + CONTENT.time.nightTicks;

// The test world (see testKit.ts): open sky down to row 9, grass on row 10, the Hearth
// at (20, 9). A colony starts with some bread and berries in storage.

describe('Needs: hunger', () => {
  it('a hungry dwarf fetches the most filling food from storage and eats it', () => {
    const { sim, runUntil } = newSim();
    const dwarf = sim.dwarves[0]!;
    const bread = sim.storage.count(item('bread'));
    dwarf.hunger = 30;
    runUntil(() => dwarf.hunger > 60);
    expect(sim.storage.count(item('bread'))).toBe(bread - 1);
    // Bread fills 40; a little hunger comes back while it fetches and eats.
    expect(dwarf.hunger).toBeGreaterThan(69);
    expect(dwarf.hunger).toBeLessThanOrEqual(70);
  });

  it('eats at a table if one is near, and a meal there goes further', () => {
    const { sim, runUntil } = newSim();
    sim.placeFurniture(kind('table'), 26, 9);
    const dwarf = sim.dwarves[0]!;
    dwarf.hunger = 30;
    let ateAt = '';
    runUntil(() => {
      const job = sim.jobs.get(dwarf.jobId);
      if (job?.type === 'eat' && dwarf.phase === 'working') ateAt = `${dwarf.x},${dwarf.y}`;
      return dwarf.hunger > 70;
    });
    expect(['25,9', '26,9', '27,9', '28,9']).toContain(ateAt);
    expect(dwarf.hunger).toBeGreaterThan(30 + 40 * needs.tableBonus - 1);
  });

  it('with nothing to eat, a dwarf works slower, then starves: it says so and loses health', () => {
    const { sim, bus, run } = newSim();
    sim.storage.take(item('bread'), 999);
    sim.storage.take(item('berries'), 999);
    const dwarf = sim.dwarves[0]!;
    dwarf.hunger = needs.hungryBelow - 1;
    expect(sim.needsSpeed(dwarf)).toBe(needs.slowWork);
    dwarf.hunger = 0.01;
    const starving: string[] = [];
    bus.on('DwarfStarving', ({ name }) => starving.push(name));
    run(200);
    expect(starving).toEqual([dwarf.name]);
    expect(dwarf.health).toBeLessThan(dwarf.maxHealth);
  });

  it('starving to death is announced as starvation', () => {
    const { sim, bus, runUntil } = newSim();
    sim.storage.take(item('bread'), 999);
    sim.storage.take(item('berries'), 999);
    const dwarf = sim.dwarves[0]!;
    dwarf.hunger = 0;
    dwarf.health = 1;
    const causes: string[] = [];
    bus.on('DwarfDied', ({ cause }) => causes.push(cause));
    runUntil(() => dwarf.phase === 'dead');
    expect(causes).toEqual(['starvation']);
  });
});

describe('Needs: sleep', () => {
  it('at night tired dwarves go to bed: one in the bed, the others on the floor by the Hearth', () => {
    const { sim, runUntil } = newSim(undefined, { startHour: 21 });
    const bed = sim.placeFurniture(kind('bed'), 26, 9);
    for (const dwarf of sim.dwarves) dwarf.energy = 40;
    runUntil(() => sim.dwarves.every((d) => d.phase === 'sleeping'));
    const inBed = sim.dwarves.filter((d) => d.x >= bed.rect.x0 && d.x <= bed.rect.x1 && d.y === bed.y);
    expect(inBed).toHaveLength(1);
    expect(bed.user).toBe(inBed[0]!.id);
    const sleeper = inBed[0]!;
    const onFloor = sim.dwarves.find((d) => d !== sleeper)!;
    expect(sim.sleepRate(sleeper)).toBe(1);
    expect(sim.sleepRate(onFloor)).toBe(needs.floorSleep);
    expect(Math.abs(onFloor.x - sim.hearth.x)).toBeLessThanOrEqual(2);
  });

  it('they wake rested once the night is over, and the bed is free again', () => {
    const { sim, runUntil } = newSim(undefined, { startHour: 21 });
    const bed = sim.placeFurniture(kind('bed'), 26, 9);
    for (const dwarf of sim.dwarves) dwarf.energy = 40;
    runUntil(() => sim.dwarves.every((d) => d.phase === 'sleeping'));
    runUntil(() => !sim.isNight() && sim.dwarves.every((d) => d.phase !== 'sleeping'), CONTENT.time.nightTicks * 3);
    for (const dwarf of sim.dwarves) expect(dwarf.energy).toBeGreaterThan(95);
    expect(bed.user).toBe(0);
  });

  it('sleeps better in a bed in a room with a light', () => {
    const { sim, world, runUntil } = newSim(undefined, { startHour: 21 });
    // A little house on the ground: plank blocks round a 4 x 2 space with walls behind it,
    // a door on the left to get in, a bed and a torch inside.
    const plank = TILES.tile('plank');
    const wall = TILES.wall('plank_wall');
    world.revealAll();
    for (let y = 6; y <= 9; y++) {
      for (let x = 25; x <= 30; x++) {
        const edge = x === 25 || x === 30 || y === 6;
        if (y === 9 && x === 25) world.fg[world.index(x, y)] = TILES.tile('wooden_door');
        else if (edge) world.fg[world.index(x, y)] = plank;
        else world.bg[world.index(x, y)] = wall;
      }
    }
    for (let y = 6; y <= 9; y++) for (let x = 25; x <= 30; x++) sim.placeBlock(x, y, world.fg[world.index(x, y)]!);
    const bed = sim.placeFurniture(kind('bed'), 26, 9);
    sim.placeFurniture(kind('torch'), 29, 8);
    sim.step();
    runUntil(() => sim.rooms.roomAt(27, 8) !== undefined, 50);
    expect(sim.rooms.roomAt(27, 8)).toMatchObject({ beds: 1, lights: 1 });
    const dwarf = sim.dwarves[0]!;
    for (const d of sim.dwarves) d.energy = d === dwarf ? 30 : 100;
    runUntil(() => dwarf.phase === 'sleeping' && bed.user === dwarf.id, 3000);
    expect(sim.sleepRate(dwarf)).toBe(needs.roomSleepBonus);
  });

  it('a dwarf that runs out of energy falls asleep where it stands', () => {
    const { sim, bus, run } = newSim();
    const dwarf = sim.dwarves[0]!;
    dwarf.energy = needs.tiredBelow - 1;
    expect(sim.needsSpeed(dwarf)).toBe(needs.slowWork);
    dwarf.energy = 0.001;
    const collapsed: string[] = [];
    bus.on('DwarfCollapsed', ({ name }) => collapsed.push(name));
    run(3);
    expect(dwarf.phase).toBe('sleeping');
    expect(collapsed).toEqual([dwarf.name]);
  });
});

describe('Day and night', () => {
  it('announces nightfall and dawn, counting the days', () => {
    const { bus, run } = newSim(undefined, { startHour: 20 });
    const heard: string[] = [];
    bus.on('NightStarted', ({ day }) => heard.push(`night ${day}`));
    bus.on('DayStarted', ({ day }) => heard.push(`day ${day}`));
    run(CYCLE);
    expect(heard).toEqual(['night 1', 'day 2']);
  });

  it('lights the surface less at night, but a torch as brightly as ever', () => {
    const { sim } = newSim(undefined, { startHour: 12 });
    sim.placeFurniture(kind('torch'), 30, 9);
    const noonSky = sim.lightNow(10, 5);
    expect(noonSky).toBe(15);
    sim.skipToNight();
    expect(sim.lightNow(10, 5)).toBeCloseTo(noonSky * CONTENT.time.nightLight, 5);
    expect(sim.lightNow(30, 9)).toBe(FURNITURE.get(kind('torch')).light);
  });
});

describe('Wild food', () => {
  it('picking a berry bush gives berries, and the bush grows more two days later', () => {
    const { sim, world, run, runUntil } = newSim();
    const bush = TILES.tile('berry_bush');
    world.fg[world.index(26, 9)] = bush;
    expect(sim.autoTarget(26, 9)).toBe('harvest');
    const berries = sim.storage.count(item('berries'));
    expect(sim.designate('auto', at(26, 9), 2)).toBe(1);
    expect(sim.jobs.at(26, 9)?.type).toBe('harvest');
    runUntil(() => world.fg[world.index(26, 9)] === TILES.tile('berry_bush_bare'));
    runUntil(() => sim.storage.count(item('berries')) >= berries + 3);
    expect(sim.dwarves.some((d) => d.skills.farming.xp > 0)).toBe(true);
    run(2 * CYCLE);
    expect(world.fg[world.index(26, 9)]).toBe(bush);
    // Two days and nights went by: everyone ate and slept, and nobody went hungry.
    for (const dwarf of sim.dwarves) {
      expect(dwarf.phase).not.toBe('dead');
      expect(dwarf.hunger).toBeGreaterThan(0);
    }
  });

  it('a picked mushroom is gone for good', () => {
    const { sim, world, runUntil } = newSim();
    world.fg[world.index(28, 9)] = TILES.tile('mushroom');
    sim.designate('auto', at(28, 9), 2);
    runUntil(() => world.fg[world.index(28, 9)] === AIR);
    runUntil(() => sim.storage.count(item('mushroom')) === 1);
  });
});
