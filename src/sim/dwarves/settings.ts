/**
 * Colony tuning from src/data/dwarves.json: how many dwarves there are and what they
 * start with, how they are named and dressed, how fast they move and work, how much the
 * Hearth stores, how quickly they get hungry and tired, and how their skills grow.
 *
 * Need rates are given per in-game day (a whole day and night, see time.json), so they
 * keep the same rhythm if the day is made longer or shorter.
 */
import { Validator } from '../../core/validate';

export interface NeedSettings {
  /** Hunger lost over a whole day and night (hunger runs from 100, full, to 0). */
  hungerPerDay: number;
  /** A dwarf goes to eat when its hunger falls below this. */
  eatBelow: number;
  /** Below this it works slower ("hungry"); at 0 it starves and loses health. */
  hungryBelow: number;
  /** Health lost per day while starving. */
  starvingDamagePerDay: number;
  /** Energy lost over the daytime while awake (energy runs from 100, rested, to 0). */
  energyPerDay: number;
  /** At night a dwarf goes to bed when its energy is below this. */
  sleepAtNightBelow: number;
  /** At any time, a dwarf goes to bed when its energy falls below this. */
  sleepBelow: number;
  /** Below this it works slower ("tired"); at 0 it falls asleep where it stands. */
  tiredBelow: number;
  /** Energy regained by sleeping through a whole night in a bed. */
  sleepPerNight: number;
  /** Sleeping without a bed (on the floor) restores this fraction as fast. */
  floorSleep: number;
  /** A bed in a room with a light restores this many times as fast. */
  roomSleepBonus: number;
  /** Health healed by sleeping through a whole night (in bed; scaled like energy). */
  healPerNight: number;
  /** Work speed while hungry or tired (multiplied when both). */
  slowWork: number;
  /** Ticks to eat a meal. */
  eatTicks: number;
  /** A meal eaten at a table fills this many times as much. */
  tableBonus: number;
  /** ...and this many times as much at a table in a room. */
  roomTableBonus: number;
  /** Dwarves walk to a table to eat if one is at most this many tiles away. */
  tableReach: number;
}

/** How dwarves fight (weapons and armour come from items.json). */
export interface CombatSettings {
  /** Damage per hit with no weapon. */
  bareHandsDamage: number;
  /** Ticks between hits, for bare hands and weapons that don't set their own. */
  attackTicks: number;
  /** Dwarves go after hostile creatures within this many tiles. */
  engageRange: number;
  /** ...if their health is at least this fraction of the most it can be. */
  engageAbove: number;
  /** Below this fraction of its health a dwarf breaks off and falls back to the Hearth. */
  retreatBelow: number;
  /** Health regained per day while resting by the Hearth. */
  restHealPerDay: number;
  /** Damage gained per combat level above 1 (0.08 = 8% more each level). */
  damagePerLevel: number;
  /** Combat experience for each hit landed. */
  xpPerHit: number;
  /** Ticks to pour a revival draught on a fallen dwarf. */
  reviveTicks: number;
}

export interface ColonySettings {
  startingDwarves: number;
  maxDwarves: number;
  /** Goods in storage when a colony starts (item ids from items.json). */
  startingItems: Array<{ item: string; count: number }>;
  names: { first: string[]; familyStart: string[]; familyEnd: string[] };
  looks: { skin: string[]; beard: string[]; tunic: string[] };
  health: { max: number };
  /** Storage is counted in stacks (slots); chests add theirs (see furniture.json). */
  storage: { hearthSlots: number };
  movement: {
    /** Ticks to walk one tile (20 ticks = 1 second at 1x). */
    walkTicks: number;
    /** Ticks to jump up one tile. */
    jumpTicks: number;
    /** Ticks to climb one tile of ladder. */
    climbTicks: number;
    /** Ticks to swim one tile. */
    swimTicks: number;
    fallTicksPerRow: number;
    /** Highest drop, in tiles, that does no harm. Paths never plan a longer one. */
    safeDrop: number;
    /** Health lost for each tile fallen beyond the safe drop. */
    fallDamagePerRow: number;
  };
  /** Dwarves uncover the cells within this many tiles of themselves. */
  vision: { radius: number };
  work: {
    /** Ticks to dig a block of hardness 1 at mining level 1. */
    digTicksPerHardness: number;
    chopTicks: number;
    pickUpTicks: number;
    dropOffTicks: number;
    /** Ticks to build a block of hardness 1 at building level 1. */
    buildTicksPerHardness: number;
    /** Ticks to build a background wall. */
    wallTicks: number;
    /** Ticks to set up a piece of furniture, per cell it covers. */
    furnitureTicks: number;
    /** Ticks to take a piece of furniture apart. */
    dismantleTicks: number;
    /** A felled tree gives one fibre for every this many leaf tiles (at least one). */
    leavesPerFiber: number;
    /** Ticks to pick a plant (berries, mushrooms) at farming level 1. */
    harvestTicks: number;
    /** Idle dwarves wander up to this many tiles from the Hearth. */
    wanderRadius: number;
  };
  skills: {
    /** Experience needed to reach each level, starting with level 1 at 0. */
    levels: number[];
    /** Work speed gained per level above 1 (0.12 = 12% faster each level). */
    speedPerLevel: number;
    xp: { digPerHardness: number; chop: number; build: number; craftPerSecond: number; harvest: number };
  };
  needs: NeedSettings;
  combat: CombatSettings;
}

export function parseColonySettings(data: unknown): ColonySettings {
  const v = new Validator('dwarves.json');
  const root = v.object(data, '');
  const section = (name: string): Record<string, unknown> | undefined => v.object(root?.[name], name);
  const strings = (raw: unknown, path: string, check: (value: unknown, path: string) => string): string[] => {
    const list = v.array(raw, path).map((value, i) => check(value, `${path}[${i}]`));
    if (list.length === 0) v.problem(`${path} must not be empty`);
    return list;
  };
  const count = (o: Record<string, unknown> | undefined, key: string, path: string, min: number, max: number): number =>
    Math.round(v.number(o?.[key], `${path}.${key}`, min, max));

  const names = section('names');
  const looks = section('looks');
  const health = section('health');
  const storage = section('storage');
  const movement = section('movement');
  const vision = section('vision');
  const work = section('work');
  const needs = section('needs');
  const combat = section('combat');
  const skills = section('skills');
  const xp = v.object(skills?.xp, 'skills.xp');
  const text = (value: unknown, path: string): string => v.string(value, path);
  const color = (value: unknown, path: string): string => v.color(value, path);

  const levels = v.array(skills?.levels, 'skills.levels').map((value, i) => v.number(value, `skills.levels[${i}]`, 0, 1e9));
  if (levels[0] !== 0) v.problem('skills.levels must start with 0 (level 1 needs no experience)');
  levels.forEach((value, i) => {
    if (i > 0 && value <= levels[i - 1]!) v.problem(`skills.levels must keep rising, but level ${i + 1} needs ${value}`);
  });

  const settings: ColonySettings = {
    startingDwarves: count(root, 'startingDwarves', 'root', 1, 12),
    maxDwarves: count(root, 'maxDwarves', 'root', 1, 64),
    startingItems: v.array(root?.startingItems, 'startingItems').map((raw, i) => {
      const o = v.object(raw, `startingItems[${i}]`);
      return { item: v.identifier(o?.item, `startingItems[${i}].item`), count: count(o, 'count', `startingItems[${i}]`, 1, 999) };
    }),
    names: {
      first: strings(names?.first, 'names.first', text),
      familyStart: strings(names?.familyStart, 'names.familyStart', text),
      familyEnd: strings(names?.familyEnd, 'names.familyEnd', text),
    },
    looks: {
      skin: strings(looks?.skin, 'looks.skin', color),
      beard: strings(looks?.beard, 'looks.beard', color),
      tunic: strings(looks?.tunic, 'looks.tunic', color),
    },
    health: { max: count(health, 'max', 'health', 1, 10000) },
    storage: { hearthSlots: count(storage, 'hearthSlots', 'storage', 1, 1000) },
    movement: {
      walkTicks: count(movement, 'walkTicks', 'movement', 1, 100),
      jumpTicks: count(movement, 'jumpTicks', 'movement', 1, 100),
      climbTicks: count(movement, 'climbTicks', 'movement', 1, 100),
      swimTicks: count(movement, 'swimTicks', 'movement', 1, 100),
      fallTicksPerRow: count(movement, 'fallTicksPerRow', 'movement', 1, 20),
      safeDrop: count(movement, 'safeDrop', 'movement', 1, 20),
      fallDamagePerRow: v.number(movement?.fallDamagePerRow, 'movement.fallDamagePerRow', 0, 10000),
    },
    vision: { radius: count(vision, 'radius', 'vision', 1, 30) },
    work: {
      digTicksPerHardness: count(work, 'digTicksPerHardness', 'work', 1, 1000),
      chopTicks: count(work, 'chopTicks', 'work', 1, 1000),
      pickUpTicks: count(work, 'pickUpTicks', 'work', 1, 100),
      dropOffTicks: count(work, 'dropOffTicks', 'work', 1, 100),
      buildTicksPerHardness: count(work, 'buildTicksPerHardness', 'work', 1, 1000),
      wallTicks: count(work, 'wallTicks', 'work', 1, 1000),
      furnitureTicks: count(work, 'furnitureTicks', 'work', 1, 1000),
      dismantleTicks: count(work, 'dismantleTicks', 'work', 1, 1000),
      leavesPerFiber: count(work, 'leavesPerFiber', 'work', 1, 100),
      harvestTicks: count(work, 'harvestTicks', 'work', 1, 1000),
      wanderRadius: count(work, 'wanderRadius', 'work', 0, 50),
    },
    skills: {
      levels,
      speedPerLevel: v.number(skills?.speedPerLevel, 'skills.speedPerLevel', 0, 1),
      xp: {
        digPerHardness: v.number(xp?.digPerHardness, 'skills.xp.digPerHardness', 0, 1000),
        chop: v.number(xp?.chop, 'skills.xp.chop', 0, 1000),
        build: v.number(xp?.build, 'skills.xp.build', 0, 1000),
        craftPerSecond: v.number(xp?.craftPerSecond, 'skills.xp.craftPerSecond', 0, 1000),
        harvest: v.number(xp?.harvest, 'skills.xp.harvest', 0, 1000),
      },
    },
    needs: {
      hungerPerDay: v.number(needs?.hungerPerDay, 'needs.hungerPerDay', 0, 1000),
      eatBelow: v.number(needs?.eatBelow, 'needs.eatBelow', 0, 100),
      hungryBelow: v.number(needs?.hungryBelow, 'needs.hungryBelow', 0, 100),
      starvingDamagePerDay: v.number(needs?.starvingDamagePerDay, 'needs.starvingDamagePerDay', 0, 10000),
      energyPerDay: v.number(needs?.energyPerDay, 'needs.energyPerDay', 0, 1000),
      sleepAtNightBelow: v.number(needs?.sleepAtNightBelow, 'needs.sleepAtNightBelow', 0, 100),
      sleepBelow: v.number(needs?.sleepBelow, 'needs.sleepBelow', 0, 100),
      tiredBelow: v.number(needs?.tiredBelow, 'needs.tiredBelow', 0, 100),
      sleepPerNight: v.number(needs?.sleepPerNight, 'needs.sleepPerNight', 1, 10000),
      floorSleep: v.number(needs?.floorSleep, 'needs.floorSleep', 0.05, 1),
      roomSleepBonus: v.number(needs?.roomSleepBonus, 'needs.roomSleepBonus', 1, 10),
      healPerNight: v.number(needs?.healPerNight, 'needs.healPerNight', 0, 10000),
      slowWork: v.number(needs?.slowWork, 'needs.slowWork', 0.1, 1),
      eatTicks: count(needs, 'eatTicks', 'needs', 1, 1000),
      tableBonus: v.number(needs?.tableBonus, 'needs.tableBonus', 1, 10),
      roomTableBonus: v.number(needs?.roomTableBonus, 'needs.roomTableBonus', 1, 10),
      tableReach: count(needs, 'tableReach', 'needs', 0, 400),
    },
    combat: {
      bareHandsDamage: v.number(combat?.bareHandsDamage, 'combat.bareHandsDamage', 0, 1000),
      attackTicks: count(combat, 'attackTicks', 'combat', 1, 1000),
      engageRange: count(combat, 'engageRange', 'combat', 1, 50),
      engageAbove: v.number(combat?.engageAbove, 'combat.engageAbove', 0, 1),
      retreatBelow: v.number(combat?.retreatBelow, 'combat.retreatBelow', 0, 1),
      restHealPerDay: v.number(combat?.restHealPerDay, 'combat.restHealPerDay', 0, 10000),
      damagePerLevel: v.number(combat?.damagePerLevel, 'combat.damagePerLevel', 0, 1),
      xpPerHit: v.number(combat?.xpPerHit, 'combat.xpPerHit', 0, 1000),
      reviveTicks: count(combat, 'reviveTicks', 'combat', 1, 10000),
    },
  };
  if (settings.maxDwarves < settings.startingDwarves) v.problem('maxDwarves must be at least startingDwarves');
  if (settings.needs.hungryBelow > settings.needs.eatBelow) v.problem('needs.hungryBelow must not be above needs.eatBelow');
  if (settings.needs.sleepBelow > settings.needs.sleepAtNightBelow) v.problem('needs.sleepBelow must not be above needs.sleepAtNightBelow');
  if (settings.combat.retreatBelow > settings.combat.engageAbove) v.problem('combat.retreatBelow must not be above combat.engageAbove');
  v.throwIfProblems();
  return settings;
}
