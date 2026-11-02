import { describe, expect, it } from 'vitest';
import { armoredDamage, lineOfSight } from './combat/Combat';
import { CONTENT, CREATURES, FURNITURE, ITEMS, TILES } from './content';
import { newSim } from './testKit';
import { AIR } from './world/TileRegistry';
import { FLAG_BUILT } from './world/World';

const item = (id: string): number => ITEMS.item(id);
const creature = (id: string): number => CREATURES.id(id);
const combat = CONTENT.colony.combat;
/** Dwarves that only fight what's right next to them (so they stay put in these tests). */
const STAY_PUT = { ...CONTENT.colony, combat: { ...combat, engageRange: 1 } };

// The test world (see testKit.ts): open sky down to row 9, grass on row 10, dirt to row
// 14, stone below; the Hearth at (20, 9); dwarves start beside it.

describe('Fighting', () => {
  it('dwarves see off a monster that comes near, and learn from it', () => {
    const { sim, bus, runUntil } = newSim();
    const gloomling = sim.spawnCreatureNear('gloomling', 9)!;
    expect(gloomling).toMatchObject({ x: 29, y: 9 });
    const killedBy: number[] = [];
    bus.on('CreatureDied', ({ by }) => killedBy.push(by));
    runUntil(() => sim.dwarves.some((d) => d.phase === 'fighting'), 200);
    runUntil(() => gloomling.gone, 2000);
    expect(killedBy).toHaveLength(1);
    expect(sim.dwarf(killedBy[0]!)).toBeDefined();
    expect(sim.dwarves.some((d) => d.skills.combat.xp > 0)).toBe(true);
    expect(sim.dwarves.every((d) => d.phase !== 'dead')).toBe(true);
  });

  it('armour softens every blow', () => {
    const { sim } = newSim();
    const dwarf = sim.dwarves[0]!;
    const gloomling = sim.spawnCreatureNear('gloomling', 20)!;
    sim.hitDwarf(dwarf, 12, gloomling);
    expect(dwarf.health).toBe(88);
    dwarf.health = 100;
    dwarf.equipment.body = item('iron_armor');
    dwarf.equipment.head = item('iron_helmet');
    expect(sim.armorOf(dwarf)).toBe(6);
    sim.hitDwarf(dwarf, 12, gloomling);
    expect(100 - dwarf.health).toBeCloseTo(armoredDamage(12, 6, CONTENT.threats.armorScale), 6);
    expect(100 - dwarf.health).toBeLessThan(7);
  });

  it('a weapon hits harder, and so does experience', () => {
    const { sim } = newSim();
    const dwarf = sim.dwarves[0]!;
    expect(sim.weaponOf(dwarf)).toMatchObject({ damage: combat.bareHandsDamage, range: 1, projectile: null });
    dwarf.equipment.weapon = item('iron_sword');
    expect(sim.weaponOf(dwarf).damage).toBe(12);
    dwarf.skills.combat.level = 3;
    expect(sim.weaponOf(dwarf).damage).toBeCloseTo(12 * (1 + 2 * combat.damagePerLevel), 6);
    dwarf.equipment.weapon = item('crossbow');
    expect(sim.weaponOf(dwarf)).toMatchObject({ range: 7, projectile: 'bolt', attackTicks: 30 });
  });

  it('a dwarf with a crossbow shoots monsters from a distance', () => {
    const { sim, bus, runUntil } = newSim();
    sim.dwarves.splice(1);
    const archer = sim.dwarves[0]!;
    archer.equipment.weapon = item('crossbow');
    const gloomling = sim.spawnCreatureNear('gloomling', 6)!;
    const shots: boolean[] = [];
    bus.on('ProjectileFired', ({ colony }) => shots.push(colony));
    runUntil(() => gloomling.gone, 2000);
    expect(shots.filter((colony) => colony).length).toBeGreaterThanOrEqual(2);
  });

  it('a badly hurt dwarf breaks off, runs for the Hearth and mends there', () => {
    const { sim, bus, run, runUntil } = newSim();
    sim.dwarves.splice(1);
    const dwarf = sim.dwarves[0]!;
    dwarf.x = 40;
    dwarf.health = 25;
    const gloomling = sim.spawnCreatureNear('gloomling', 26)!;
    const retreats: string[] = [];
    bus.on('DwarfRetreating', ({ name }) => retreats.push(name));
    runUntil(() => retreats.length > 0, 200);
    expect(dwarf.phase).toBe('retreating');
    sim.killCreature(gloomling, 0);
    runUntil(() => dwarf.phase === 'idle', 800);
    expect(Math.abs(dwarf.x - sim.hearth.x)).toBeLessThanOrEqual(3);
    const before = dwarf.health;
    run(300);
    expect(dwarf.health).toBeGreaterThan(before);
  });

  it('a sleeping dwarf wakes when a monster comes for it', () => {
    const { sim, runUntil } = newSim(undefined, { startHour: 22 });
    sim.dwarves.splice(1);
    const dwarf = sim.dwarves[0]!;
    dwarf.energy = 40;
    runUntil(() => dwarf.phase === 'sleeping', 400);
    sim.spawnCreatureNear('gloomling', 12);
    runUntil(() => dwarf.phase === 'fighting', 800);
  });

  it('a bilespitter spits at dwarves it can see, never through a wall', () => {
    const { sim, bus, runUntil } = newSim(undefined, { colony: STAY_PUT });
    sim.dwarves.splice(1);
    const spitter = sim.spawnCreatureNear('bilespitter', 7)!;
    const spits: number[] = [];
    bus.on('ProjectileFired', ({ colony, x }) => !colony && spits.push(x));
    runUntil(() => spits.length > 0, 400);
    expect(spits[0]).toBeCloseTo(spitter.x + 0.5, 5);
    const world = sim.world;
    expect(lineOfSight(world, TILES, 10, 9, 14, 9)).toBe(true);
    world.fg[world.index(12, 9)] = TILES.tile('stone');
    expect(lineOfSight(world, TILES, 10, 9, 14, 9)).toBe(false);
    world.fg[world.index(12, 9)] = TILES.tile('wooden_door');
    expect(lineOfSight(world, TILES, 10, 9, 14, 9)).toBe(false);
  });
});

describe('Monsters breaking in', () => {
  /** A brick house right of the Hearth: x 26..32, y 5..9, a wooden door at (26, 9), walls behind. */
  function buildHouse(sim: ReturnType<typeof newSim>['sim']): void {
    const { world } = sim;
    world.revealAll();
    for (let y = 5; y <= 9; y++) {
      for (let x = 26; x <= 32; x++) {
        const shell = x === 26 || x === 32 || y === 5;
        if (x === 26 && y === 9) sim.placeBlock(x, y, TILES.tile('wooden_door'));
        else if (shell) sim.placeBlock(x, y, TILES.tile('brick'));
        else sim.placeWall(x, y, TILES.wall('brick_wall'));
      }
    }
  }

  it('doors stop monsters: those that can smash them do, the rest go round', () => {
    const { sim } = newSim();
    buildHouse(sim);
    const door = { x: 26, y: 9 };
    const gloomling = sim.navFor(creature('gloomling'));
    const spitter = sim.navFor(creature('bilespitter'));
    const skitter = sim.navFor(creature('cragskitter'));
    expect(sim.nav.passable(door.x, door.y)).toBe(true); // dwarves walk through
    for (const nav of [gloomling, spitter, skitter]) expect(nav.open(door.x, door.y)).toBe(false);
    expect(gloomling.breakable(door.x, door.y)).toBe(true);
    expect(skitter.breakable(door.x, door.y)).toBe(true);
    expect(spitter.breakable(door.x, door.y)).toBe(false);
    // Built blocks: gloomlings smash them, cragskitters don't; natural ground is safe from both.
    expect(sim.world.flags[sim.world.index(27, 5)]! & FLAG_BUILT).toBe(FLAG_BUILT);
    expect(gloomling.breakable(27, 5)).toBe(true);
    expect(skitter.breakable(27, 5)).toBe(false);
    expect(gloomling.breakable(27, 11)).toBe(false);
  });

  it('a gloomling smashes the door of a room to get at the dwarf inside', () => {
    const { sim, bus, runUntil } = newSim(undefined, { colony: STAY_PUT });
    buildHouse(sim);
    sim.dwarves.splice(1);
    const dwarf = sim.dwarves[0]!;
    dwarf.x = 30;
    dwarf.y = 9;
    dwarf.restTicks = 1e9; // it stays put inside, rather than strolling out of the door
    runUntil(() => sim.inRoom(30, 8), 20);
    const gloomling = sim.spawnCreatureNear('gloomling', 2)!;
    const broken: string[] = [];
    bus.on('TileBroken', ({ x, y }) => broken.push(`${x},${y}`));
    runUntil(() => broken.length > 0, 3000);
    expect(broken).toEqual(['26,9']);
    expect(sim.world.fg[sim.world.index(26, 9)]).toBe(AIR);
    runUntil(() => dwarf.phase === 'fighting' || dwarf.phase === 'dead', 1000);
    expect(gloomling.gone || Math.abs(gloomling.x - dwarf.x) <= 1).toBe(true);
  });

  it('a burrowmaw tunnels through earth to reach a dwarf underground', () => {
    const { sim, bus, runUntil } = newSim(undefined, { colony: STAY_PUT });
    const { world } = sim;
    sim.dwarves.splice(1);
    const dwarf = sim.dwarves[0]!;
    // A pocket dug in the dirt, two rows under the grass.
    for (let x = 29; x <= 31; x++) world.fg[world.index(x, 12)] = AIR;
    dwarf.x = 30;
    dwarf.y = 12;
    const maw = sim.spawnCreatureNear('burrowmaw', 10)!;
    expect(maw).toMatchObject({ x: 30, y: 9 });
    const broken: number[] = [];
    bus.on('TileBroken', ({ x, y }) => broken.push(world.index(x, y)));
    runUntil(() => Math.max(Math.abs(maw.x - dwarf.x), Math.abs(maw.y - dwarf.y)) <= 1, 3000);
    expect(broken.length).toBeGreaterThanOrEqual(2);
    for (const cell of broken) expect(world.fg[cell]).toBe(AIR);
  });

  it('a cragskitter climbs the sides of blocks and leaps up two tiles; a gloomling only one', () => {
    const { sim } = newSim();
    const { world } = sim;
    world.fg[world.index(30, 9)] = TILES.tile('stone');
    world.fg[world.index(30, 8)] = TILES.tile('stone');
    const from = world.index(29, 9);
    const ledge = world.index(30, 7);
    const movesOf = (id: string): number[] => {
      const moves: number[] = [];
      sim.navFor(creature(id)).forEachMove(from, (to) => moves.push(to));
      return moves;
    };
    expect(movesOf('cragskitter')).toContain(ledge);
    expect(movesOf('gloomling')).not.toContain(ledge);
    const skitter = sim.navFor(creature('cragskitter'));
    expect(skitter.climbableAt(29, 8)).toBe(true); // beside the stone
    expect(sim.navFor(creature('gloomling')).climbableAt(29, 8)).toBe(false);
  });
});

describe('Traps and turrets', () => {
  it('a spike trap stabs a monster that stands on it', () => {
    const { sim, bus, run } = newSim();
    sim.dwarves.splice(0);
    sim.placeFurniture(FURNITURE.id('spike_trap'), 30, 9);
    const gloomling = sim.spawnCreature(creature('gloomling'), 30, 9, 'debug');
    const sprung: string[] = [];
    bus.on('TrapSprung', ({ x, y }) => sprung.push(`${x},${y}`));
    run(3);
    expect(sprung).toEqual(['30,9']);
    expect(gloomling.health).toBeLessThan(gloomling.maxHealth);
  });

  it('a bolt thrower shoots monsters in range that it can see', () => {
    const { sim, bus, runUntil } = newSim();
    sim.dwarves.splice(0);
    sim.placeFurniture(FURNITURE.id('bolt_thrower'), 12, 9);
    const gloomling = sim.spawnCreature(creature('gloomling'), 18, 9, 'debug');
    const shots: boolean[] = [];
    bus.on('ProjectileFired', ({ colony }) => shots.push(colony));
    runUntil(() => gloomling.health < gloomling.maxHealth, 400);
    expect(shots[0]).toBe(true);
  });
});

describe('Hunting and reviving', () => {
  it('a marked animal is hunted down, and leaves meat and a hide', () => {
    const { sim, runUntil } = newSim();
    const animal = sim.spawnCreatureNear('mossback', 12)!;
    expect(sim.designateHunt(animal.id, 2)).toBe(true);
    expect(sim.designateHunt(animal.id, 2)).toBe(false);
    runUntil(() => sim.dwarves.some((d) => d.phase === 'fighting'), 200);
    runUntil(() => animal.gone, 3000);
    runUntil(() => sim.storage.count(item('raw_meat')) >= 3 && sim.storage.count(item('hide')) >= 1, 3000);
    expect(sim.huntJobFor(animal.id)).toBeUndefined();
  });

  it('a rekindling draught brings a fallen dwarf back', () => {
    const { sim, bus, run, runUntil } = newSim();
    const fallen = sim.dwarves[0]!;
    const gloomling = sim.spawnCreatureNear('gloomling', 26)!;
    sim.hitDwarf(fallen, 1000, gloomling);
    sim.killCreature(gloomling, 0);
    expect(fallen.phase).toBe('dead');
    expect(sim.designateRevive(fallen.id, 2)).toBe(true);
    run(20);
    expect(sim.reviveJobFor(fallen.id)?.missing).toBe(true);
    const revived: string[] = [];
    bus.on('DwarfRevived', ({ name }) => revived.push(name));
    sim.storage.add(item('rekindling_draught'), 1);
    runUntil(() => fallen.phase !== 'dead', 3000);
    expect(revived).toEqual([fallen.name]);
    expect(fallen.health).toBe(fallen.maxHealth * 0.5);
    expect(sim.storage.count(item('rekindling_draught'))).toBe(0);
  });

  it('nothing brings back a dwarf lost in lava; when every dwarf is gone, the colony has fallen', () => {
    const { sim, bus } = newSim();
    const gloomling = sim.spawnCreatureNear('gloomling', 26)!;
    let lost = 0;
    bus.on('ColonyLost', () => lost++);
    const [first, second, third] = sim.dwarves;
    sim.hitDwarf(first!, 1000, gloomling);
    first!.deathCause = 'lava';
    expect(sim.designateRevive(first!.id, 2)).toBe(false);
    sim.hitDwarf(second!, 1000, gloomling);
    expect(lost).toBe(0);
    sim.hitDwarf(third!, 1000, gloomling);
    expect(lost).toBe(1);
    expect(sim.lost).toBe(true);
  });
});
