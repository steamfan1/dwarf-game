import { describe, expect, it } from 'vitest';
import { CONTENT, CREATURES, ITEMS, TILES } from './content';
import type { ThreatSettings } from './creatures/threats';
import { newSim, PEACEFUL } from './testKit';
import { AIR } from './world/TileRegistry';

const T = CONTENT.threats;
const DAY = CONTENT.time.dayTicks;
const NIGHT = CONTENT.time.nightTicks;
/** Only night monsters (no animals, no invasions). */
const NIGHTS_ONLY: ThreatSettings = { ...T, animals: PEACEFUL.animals, waves: PEACEFUL.waves };

// The test world (see testKit.ts): open sky down to row 9, grass on row 10; the Hearth at
// (20, 9), 48 columns wide.

describe('Night', () => {
  it('monsters come out on dark cells away from the colony, a few more each night', () => {
    const { sim, bus, run } = newSim(undefined, { startHour: 20.5, threats: NIGHTS_ONLY });
    const spawns: Array<{ x: number; y: number; light: number; room: boolean; origin: string }> = [];
    bus.on('CreatureSpawned', ({ x, y, origin }) => spawns.push({ x, y, origin, light: sim.lightNow(x, y), room: sim.inRoom(x, y) }));
    let warned = 0;
    bus.on('NightThreat', () => warned++);
    run(NIGHT);
    expect(spawns).toHaveLength(sim.spawner.nightBudget(1));
    expect(warned).toBe(1);
    for (const spawn of spawns) {
      expect(spawn.origin).toBe('night');
      expect(spawn.light).toBeLessThanOrEqual(T.night.maxLight);
      expect(spawn.room).toBe(false);
      expect(Math.abs(spawn.x - sim.hearth.x)).toBeGreaterThanOrEqual(T.night.minDistance);
    }
    expect(sim.spawner.nightBudget(4)).toBeGreaterThan(sim.spawner.nightBudget(1));
  });

  it('never in a room, nor in a lit place', () => {
    const { sim, bus, run } = newSim(undefined, { startHour: 20.5, threats: { ...NIGHTS_ONLY, night: { ...T.night, base: 40, max: 40, maxAlive: 40 } } });
    const { world } = sim;
    // A dark pocket underground, closed in and walled: a room. And a torch on the far right.
    for (let x = 2; x <= 6; x++) world.fg[world.index(x, 12)] = AIR;
    sim.placeFurniture(CONTENT.furniture.id('torch'), 40, 9);
    run(30);
    expect(sim.inRoom(4, 12)).toBe(true);
    const spawns: Array<{ room: boolean; light: number }> = [];
    bus.on('CreatureSpawned', ({ x, y }) => spawns.push({ room: sim.inRoom(x, y), light: sim.lightNow(x, y) }));
    run(NIGHT / 2);
    expect(spawns.length).toBeGreaterThan(5);
    expect(spawns.filter((s) => s.room)).toEqual([]);
    expect(spawns.filter((s) => s.light > T.night.maxLight)).toEqual([]);
  });

  it('at dawn, monsters out in the light slink away', () => {
    const { sim, bus, run } = newSim(undefined, { startHour: 4.5, threats: PEACEFUL });
    sim.dwarves.splice(0);
    const gloomling = sim.spawnCreature(CREATURES.id('gloomling'), 4, 9, 'night');
    const visitor = sim.spawnCreature(CREATURES.id('gloomling'), 44, 9, 'debug');
    let left = 0;
    bus.on('CreatureLeft', () => left++);
    run(Math.round(NIGHT / 8) + T.dawn.leaveTicks + 40);
    expect(gloomling.gone).toBe(true);
    expect(left).toBe(1);
    expect(visitor.gone).toBe(false);
  });
});

describe('Invasions', () => {
  it('every few nights a portal opens, after a warning; invaders come through, and dawn takes back the rest', () => {
    const threats: ThreatSettings = { ...T, night: PEACEFUL.night, animals: PEACEFUL.animals, waves: { ...T.waves, every: 2 } };
    const { sim, bus, run } = newSim(undefined, { startHour: 12, threats });
    const heard: string[] = [];
    bus.on('WaveWarning', ({ day, ticks }) => heard.push(`warning ${day} ${ticks}`));
    bus.on('WaveStarted', ({ day, size }) => heard.push(`started ${day} ${size}`));
    bus.on('WaveEnded', ({ day }) => heard.push(`ended ${day}`));
    bus.on('NightStarted', ({ day }) => heard.push(`night ${day}`));
    let invaders = 0;
    bus.on('CreatureSpawned', ({ origin }) => origin === 'wave' && invaders++);
    // Day 1 is quiet; the night of day 2 brings the invasion.
    run(sim.time.ticksUntilNight(sim.tick) + NIGHT + DAY - T.waves.warningTicks - 1);
    expect(heard).toEqual(['night 1']);
    run(1);
    expect(heard).toEqual(['night 1', `warning 2 ${T.waves.warningTicks}`]);
    expect(sim.waveView()).toMatchObject({ phase: 'warning', ticksLeft: T.waves.warningTicks });
    const size = sim.spawner.waveSize(2);
    run(T.waves.warningTicks);
    expect(heard.slice(2)).toEqual(['night 2', `started 2 ${size}`]);
    expect(sim.portal).toMatchObject({ open: true });
    run(size * T.waves.spawnTicks + 5);
    expect(invaders).toBe(size);
    run(NIGHT);
    expect(heard[heard.length - 1]).toBe('ended 2');
    expect(sim.waveView()).toBeNull();
    run(T.dawn.leaveTicks);
    expect(sim.creatures.filter((c) => c.origin === 'wave')).toEqual([]);
  });

  it('come bigger as the days go by and the colony arms itself', () => {
    const { sim } = newSim(undefined, { threats: T });
    const day5 = sim.spawner.waveSize(5);
    expect(sim.spawner.waveSize(10)).toBeGreaterThan(day5);
    expect(sim.techTier()).toBe(0);
    sim.storage.add(ITEMS.item('iron_sword'), 1);
    expect(sim.techTier()).toBe(2);
    expect(sim.spawner.waveSize(5)).toBe(day5 + 2 * T.waves.perTier);
    expect(sim.spawner.isWaveNight(5)).toBe(true);
    expect(sim.spawner.isWaveNight(4)).toBe(false);
  });

  it('the debug helper brings an invasion on tonight', () => {
    const { sim, bus, run } = newSim(undefined, { startHour: 9, threats: { ...T, night: PEACEFUL.night, animals: PEACEFUL.animals } });
    let warned = 0;
    let started = 0;
    bus.on('WaveWarning', () => warned++);
    bus.on('WaveStarted', () => started++);
    sim.startWave(100);
    run(2);
    expect(warned).toBe(1);
    run(110);
    expect(started).toBe(1);
    expect(sim.isNight()).toBe(true);
  });
});

describe('Animals', () => {
  it('graze on the hills by day, away from the Hearth', () => {
    const threats: ThreatSettings = { ...T, night: PEACEFUL.night, waves: PEACEFUL.waves, animals: { ...T.animals, minDistance: 10, maxDistance: 26, start: 2 } };
    const { sim, run } = newSim(undefined, { threats });
    const animals = sim.creatures.filter((c) => c.origin === 'animal');
    expect(animals).toHaveLength(2);
    for (const animal of animals) {
      expect(CREATURES.get(animal.kind).hostile).toBe(false);
      expect(Math.abs(animal.x - sim.hearth.x)).toBeGreaterThanOrEqual(10);
      expect(sim.world.fg[sim.world.index(animal.x, animal.y + 1)]).toBe(TILES.tile('grass'));
    }
    const start = animals.map((a) => a.x);
    run(1200);
    expect(animals.some((a, i) => a.x !== start[i])).toBe(true);
  });
});
