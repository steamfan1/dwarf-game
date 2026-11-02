/**
 * Colony tuning from src/data/dwarves.json: how many dwarves there are, how they are
 * named and dressed, how fast they move and work, how much the Hearth stores, and how
 * their skills grow.
 */
import { Validator } from '../../core/validate';

export interface ColonySettings {
  startingDwarves: number;
  maxDwarves: number;
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
    /** Idle dwarves wander up to this many tiles from the Hearth. */
    wanderRadius: number;
  };
  skills: {
    /** Experience needed to reach each level, starting with level 1 at 0. */
    levels: number[];
    /** Work speed gained per level above 1 (0.12 = 12% faster each level). */
    speedPerLevel: number;
    xp: { digPerHardness: number; chop: number; build: number; craftPerSecond: number };
  };
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
      },
    },
  };
  if (settings.maxDwarves < settings.startingDwarves) v.problem('maxDwarves must be at least startingDwarves');
  v.throwIfProblems();
  return settings;
}
