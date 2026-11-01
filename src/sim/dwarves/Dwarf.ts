/**
 * A dwarf: who it is, how it's doing, and what it's in the middle of.
 *
 * Plain data, so it is easy to inspect, test and (in Milestone 6) save. DwarfAI decides
 * what a dwarf does each tick; this file only creates dwarves and handles their skills.
 */
import type { Rng } from '../../core/Rng';
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
 *   idle -> to-job -> working                          (dig, chop)
 *   idle -> to-item -> picking-up -> to-storage -> dropping-off   (haul)
 *   idle -> wandering                                  (nothing to do)
 * Falling interrupts anything; a dwarf whose health reaches 0 is dead.
 */
export type Phase =
  | 'idle'
  | 'to-job'
  | 'working'
  | 'to-item'
  | 'picking-up'
  | 'to-storage'
  | 'dropping-off'
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
  /** 100 is full. Hunger starts to matter in Milestone 4. */
  hunger: number;
  /** 100 is rested. Sleep arrives in Milestone 4. */
  energy: number;
  skills: Record<Skill, SkillState>;
  /** Item numbers; equipment arrives with crafting in Milestone 3. */
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
  carrying: { item: number; count: number } | null;
  /** Ticks spent on the current piece of work. */
  workTicks: number;
  /** Ticks to wait before looking for something to do again. */
  restTicks: number;
  /** Where a wandering dwarf is strolling to (a cell), or -1. */
  wanderTarget: number;
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
    carrying: null,
    workTicks: 0,
    restTicks: rng.int(0, 20),
    wanderTarget: -1,
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
