/**
 * A creature in the world: a monster out for dwarves, or an animal grazing on the hills.
 *
 * Plain data, like a dwarf, so it is easy to inspect, test and (in Milestone 6) save.
 * CreatureAI decides what it does each tick; creatures.json says what kind it is.
 */
import type { Movement } from '../dwarves/Dwarf';
import type { CreatureDef } from './CreatureRegistry';

/** Where it came from: out of the dark at night, through an invasion portal, a grazing animal, or the debug console. */
export type CreatureOrigin = 'night' | 'wave' | 'animal' | 'debug';

/**
 * What it is doing:
 *   idle      thinking, or standing about
 *   moving    on its way somewhere (after prey, towards the colony, wandering, fleeing)
 *   attacking next to (or in range of) its prey, striking whenever it can
 *   breaking  smashing a door or block that stands in its way
 *   falling
 */
export type CreaturePhase = 'idle' | 'moving' | 'attacking' | 'breaking' | 'falling';

export interface Creature {
  readonly id: number;
  /** Index into the CreatureRegistry. */
  readonly kind: number;
  readonly origin: CreatureOrigin;
  x: number;
  y: number;
  facing: -1 | 1;
  health: number;
  maxHealth: number;
  /** Damage per attack, toughened by the day it appeared on. */
  damage: number;
  phase: CreaturePhase;
  movement: Movement | null;
  /** Cells still to step through (read-only: it may be shared with the path cache). */
  path: readonly number[] | null;
  pathIndex: number;
  /** The cell its path leads to (to tell when the prey has moved on), or -1. */
  pathGoal: number;
  /** The dwarf it is after, or 0. */
  target: number;
  /** Ticks until it may strike again (prey, door or block). */
  cooldown: number;
  /** The cell it is breaking through, or -1. */
  breaking: number;
  /** Ticks until it looks for prey again. */
  thinkTicks: number;
  /** Ticks until it wanders on (prowling monsters, grazing animals). */
  restTicks: number;
  /** Ticks until it may plan another path. */
  planTicks: number;
  /** Animals: ticks left running away. */
  fleeTicks: number;
  /** The dwarf that hurt it last, or 0. */
  lastHitBy: number;
  /** Ticks since it was last hurt and since it last struck (for the picture). */
  hurtTicks: number;
  strikeTicks: number;
  fallRows: number;
  /** Prey it couldn't find a way to, and until which tick it won't try again. */
  unreachable: Array<{ dwarf: number; until: number }>;
  /** Night monsters leave at dawn: the tick it slinks off, or 0. */
  leaveAt: number;
  /** Set once it has died or left; it is then removed. */
  gone: boolean;
}

/** How much tougher monsters are on a given day (1 on day 1). */
export function toughness(day: number, perDay: number, maxFactor: number): number {
  return Math.min(maxFactor, 1 + perDay * Math.max(0, day - 1));
}

export function createCreature(
  id: number,
  kind: number,
  def: CreatureDef,
  x: number,
  y: number,
  origin: CreatureOrigin,
  scaling: { health: number; damage: number },
  facing: -1 | 1,
): Creature {
  const health = Math.round(def.health * (def.hostile ? scaling.health : 1));
  return {
    id,
    kind,
    origin,
    x,
    y,
    facing,
    health,
    maxHealth: health,
    damage: def.damage * (def.hostile ? scaling.damage : 1),
    phase: 'idle',
    movement: null,
    path: null,
    pathIndex: 0,
    pathGoal: -1,
    target: 0,
    cooldown: 0,
    breaking: -1,
    thinkTicks: 0,
    restTicks: 0,
    planTicks: 0,
    fleeTicks: 0,
    lastHitBy: 0,
    hurtTicks: 1000,
    strikeTicks: 1000,
    fallRows: 0,
    unreachable: [],
    leaveAt: 0,
    gone: false,
  };
}
