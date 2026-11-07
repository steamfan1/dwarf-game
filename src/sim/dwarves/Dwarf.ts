/**
 * A dwarf: who it is, how it's doing, and what it's in the middle of.
 *
 * Plain data, so it is easy to inspect, test and (in Milestone 6) save. DwarfAI decides
 * what a dwarf does each tick; this file only creates dwarves and handles their skills.
 */
import type { Rng } from '../../core/Rng';
import type { DeathCause } from '../events';
import type { ItemCount } from '../items/ItemRegistry';
import type { MoveKind } from '../nav/NavGrid';
import type { ColonySettings } from './settings';

export const SKILLS = ['mining', 'building', 'crafting', 'farming', 'combat'] as const;
export type Skill = (typeof SKILLS)[number];

export const EQUIPMENT_SLOTS = ['head', 'body', 'weapon', 'tool', 'accessory'] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export interface SkillState {
  level: number;
  xp: number;
}

/**
 * What a dwarf is doing, step by step:
 *   idle -> to-job -> working                                  dig, chop, dismantle
 *   idle -> to-item -> picking-up -> to-storage -> dropping-off   haul
 *   idle -> to-supply -> fetching -> to-job -> working            build, wall, place
 *   idle -> to-supply -> fetching -> to-job -> working -> to-storage -> dropping-off   craft
 *   idle -> to-supply -> fetching                                 equip
 *   idle -> to-supply -> fetching (-> to-job) -> working          eat (at a table, if one is near)
 *   idle -> to-job -> sleeping                                    sleep (in a bed, or by the Hearth)
 *   idle -> to-job -> working                                     harvest
 *   idle -> to-supply -> fetching -> to-job -> working            revive (a revival draught)
 *   idle -> fighting                                           hunt, or a monster came near
 *   fighting -> retreating -> idle                             badly hurt: back to the Hearth
 *   idle -> wandering                                          nothing to do
 * "Supply" and "storage" are the same places (the Hearth and the chests): whichever is
 * nearest. A hand-made craft is worked right where its materials were fetched. Falling
 * interrupts anything; a dwarf whose health reaches 0 is dead.
 */
export type Phase =
  | 'idle'
  | 'to-job'
  | 'working'
  | 'to-item'
  | 'picking-up'
  | 'to-storage'
  | 'dropping-off'
  | 'to-supply'
  | 'fetching'
  | 'sleeping'
  | 'fighting'
  | 'retreating'
  | 'wandering'
  | 'falling'
  | 'dead';

/** A step between two cells that takes several ticks; the renderer interpolates along it. */
export interface Movement {
  from: number;
  to: number;
  kind: MoveKind | 'fall';
  /** Ticks done so far. */
  elapsed: number;
  duration: number;
}

export interface Dwarf {
  readonly id: number;
  readonly name: string;
  /** Indexes into the colony's skin, beard and tunic colours. */
  readonly looks: { skin: number; beard: number; tunic: number };
  x: number;
  y: number;
  facing: -1 | 1;
  health: number;
  maxHealth: number;
  /** 100 is full, 0 is starving. Dwarves eat from storage when it runs low. */
  hunger: number;
  /** 100 is rested, 0 is exhausted. Dwarves sleep at night, in a bed if they have one. */
  energy: number;
  skills: Record<Skill, SkillState>;
  /** What it wears and wields, by item number. Dwarves equip better gear from storage by themselves. */
  equipment: Record<EquipmentSlot, number | null>;

  phase: Phase;
  /** The claimed job, or 0. */
  jobId: number;
  /** Cells still to step through (read-only: it may be shared with the path cache). */
  path: readonly number[] | null;
  pathIndex: number;
  movement: Movement | null;
  /** Rows fallen in the current fall. */
  fallRows: number;
  /** What it has in its arms: a hauled stack, a job's materials, a finished craft. Empty for nothing. */
  carrying: ItemCount[];
  /** Ticks spent on the current piece of work. */
  workTicks: number;
  /** Ticks spent waiting for someone to get out of the way. */
  waitTicks: number;
  /** Ticks to wait before looking for something to do again. */
  restTicks: number;
  /** Where a wandering dwarf is strolling to (a cell), or -1. */
  wanderTarget: number;
  /** Ticks until it can strike again, and since it last struck (for the swing). */
  attackCooldown: number;
  strikeTicks: number;
  /** Ticks until it next looks around for danger. */
  scanTicks: number;
  /** Chasing a creature: the cell its path leads to, and ticks until it may plan again. */
  chaseGoal: number;
  chaseTicks: number;
  /** The creature that hurt it last (0: none), when (tick), and ticks since (for the red flash). */
  lastAttacker: number;
  lastHurtTick: number;
  hurtTicks: number;
  /** Creatures it couldn't get to, and until which tick it won't try again. */
  ignoring: Array<{ creature: number; until: number }>;
  /** How it died (null while alive): a dwarf lost in lava can't be brought back. */
  deathCause: DeathCause | null;
}

/**
 * A dwarf going through the World Gate to the next world: who it is, what it has learned
 * and the gear it carries (by items.json id).
 */
export interface Traveller {
  name: string;
  looks: { skin: number; beard: number; tunic: number };
  skills: Record<Skill, SkillState>;
  equipment: Partial<Record<EquipmentSlot, string>>;
}

/** A dwarf as it would step through the gate. */
export function travellerOf(dwarf: Dwarf, itemId: (item: number) => string): Traveller {
  const equipment: Partial<Record<EquipmentSlot, string>> = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const item = dwarf.equipment[slot];
    if (item !== null) equipment[slot] = itemId(item);
  }
  const skills = Object.fromEntries(SKILLS.map((skill) => [skill, { ...dwarf.skills[skill] }])) as Record<Skill, SkillState>;
  return { name: dwarf.name, looks: { ...dwarf.looks }, skills, equipment };
}

/**
 * A new world's dwarf who came through the gate: its name, looks, skills and gear are the
 * traveller's (gear no longer in the game is left behind); everything else is fresh.
 */
export function arrivedTraveller(fresh: Dwarf, traveller: Traveller, itemNumber: (id: string) => number | undefined): Dwarf {
  const equipment = { ...fresh.equipment };
  for (const slot of EQUIPMENT_SLOTS) {
    const id = traveller.equipment[slot];
    const item = id === undefined ? undefined : itemNumber(id);
    if (item !== undefined) equipment[slot] = item;
  }
  const skills = Object.fromEntries(SKILLS.map((skill) => [skill, { ...(traveller.skills[skill] ?? fresh.skills[skill]) }])) as Record<Skill, SkillState>;
  return { ...fresh, name: traveller.name, looks: { ...traveller.looks }, skills, equipment };
}

/**
 * Create a dwarf with a name no other dwarf in `takenNames` has; first names are kept
 * distinct too while the list allows, so the roster never shows two Runas.
 */
export function createDwarf(id: number, x: number, y: number, rng: Rng, colony: ColonySettings, takenNames: ReadonlySet<string>): Dwarf {
  const takenFirst = new Set([...takenNames].map((taken) => taken.split(' ')[0]));
  let name = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    const first = rng.pick(colony.names.first);
    name = `${first} ${rng.pick(colony.names.familyStart)}${rng.pick(colony.names.familyEnd)}`;
    if (!takenNames.has(name) && (!takenFirst.has(first) || attempt >= 40)) break;
  }
  const skills = Object.fromEntries(SKILLS.map((skill) => [skill, { level: 1, xp: 0 }])) as Record<Skill, SkillState>;
  const equipment = Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])) as Record<EquipmentSlot, number | null>;
  return {
    id,
    name,
    looks: {
      skin: rng.int(0, colony.looks.skin.length - 1),
      beard: rng.int(0, colony.looks.beard.length - 1),
      tunic: (id - 1) % colony.looks.tunic.length,
    },
    x,
    y,
    facing: rng.chance(0.5) ? 1 : -1,
    health: colony.health.max,
    maxHealth: colony.health.max,
    hunger: 100,
    energy: 100,
    skills,
    equipment,
    phase: 'idle',
    jobId: 0,
    path: null,
    pathIndex: 0,
    movement: null,
    fallRows: 0,
    carrying: [],
    workTicks: 0,
    waitTicks: 0,
    restTicks: rng.int(0, 20),
    wanderTarget: -1,
    attackCooldown: 0,
    strikeTicks: 1000,
    scanTicks: id % 4,
    chaseGoal: -1,
    chaseTicks: 0,
    lastAttacker: 0,
    lastHurtTick: -1000,
    hurtTicks: 1000,
    ignoring: [],
    deathCause: null,
  };
}

/** The level that `xp` experience reaches, given each level's threshold. */
export function levelForXp(xp: number, levels: readonly number[]): number {
  let level = 1;
  for (let i = 1; i < levels.length; i++) {
    if (xp >= levels[i]!) level = i + 1;
  }
  return level;
}

/** Add experience to a skill; returns true if the skill went up a level. */
export function gainXp(dwarf: Dwarf, skill: Skill, xp: number, levels: readonly number[]): boolean {
  const state = dwarf.skills[skill];
  state.xp += xp;
  const level = levelForXp(state.xp, levels);
  if (level === state.level) return false;
  state.level = level;
  return true;
}

/** How much faster than a beginner a dwarf works at a skill (1 at level 1). */
export function skillSpeed(dwarf: Dwarf, skill: Skill, speedPerLevel: number): number {
  return 1 + speedPerLevel * (dwarf.skills[skill].level - 1);
}
