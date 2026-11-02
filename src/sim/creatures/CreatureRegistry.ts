/**
 * Creature definitions (src/data/creatures.json), checked and turned into numeric ids.
 *
 * Hostile creatures come out at night and with invasion waves and go for the dwarves;
 * the others are animals that graze and can be hunted. How each one gets around and
 * what it can break decides how it attacks a colony:
 *
 *   attack    "melee" (it must stand next to its prey), "ranged" (it shoots
 *             `projectile`s from up to `range` tiles, if it can see its prey) or "none";
 *   movement  ticks per tile walked, how many tiles it can jump up, the longest drop it
 *             will take, and what it can climb: "none", "ladders", or "walls" (ladders,
 *             background walls, and the sides of blocks, like a spider);
 *   breaks    what it smashes through when that's the way to its prey: "none", "doors",
 *             "built" (doors and blocks the dwarves built) or "soft" (built blocks, and
 *             natural ones up to `digHardness`: it tunnels).
 *
 * Pure: no Phaser and no DOM.
 */
import { Validator } from '../../core/validate';
import { PROJECTILE_KINDS, type ProjectileKind } from '../items/ItemRegistry';

export type AttackKind = 'melee' | 'ranged' | 'none';
export type ClimbRule = 'none' | 'ladders' | 'walls';
export type BreakRule = 'none' | 'doors' | 'built' | 'soft';

/** How the placeholder sprite is painted (see render/assets/creatureArt.ts). */
export const CREATURE_STYLES = ['gloomling', 'cragskitter', 'burrowmaw', 'bilespitter', 'mossback', 'woolhorn'] as const;
export type CreatureStyle = (typeof CREATURE_STYLES)[number];

export interface CreatureMovement {
  /** Ticks to walk one tile (dwarves take 5). */
  walkTicks: number;
  /** Tiles it can jump straight up onto a ledge. */
  jump: number;
  /** The longest drop, in tiles, its paths take. */
  safeDrop: number;
  climbs: ClimbRule;
}

export interface CreatureDrop {
  item: string;
  count: number;
  /** 0..1: how likely it is to drop at all. */
  chance: number;
}

export interface CreatureSpawn {
  /** How often it is picked for night spawns and invasion waves, relative to the others (0: never). */
  night: number;
  wave: number;
  /** The first day it can appear. */
  fromDay: number;
  /** Animals: how common it is in each biome (biome id to weight). */
  animal: Readonly<Record<string, number>>;
}

export interface CreatureArt {
  style: CreatureStyle;
  base: string;
  dark: string;
  light: string;
  accent: string;
}

export interface CreatureDef {
  id: string;
  name: string;
  description: string;
  hostile: boolean;
  attack: AttackKind;
  health: number;
  /** Softens each hit it takes, like a dwarf's armour. */
  armor: number;
  damage: number;
  /** Ticks between attacks. */
  attackTicks: number;
  /** Tiles: 1 for melee. */
  range: number;
  projectile: ProjectileKind | null;
  /** Hostile creatures notice dwarves within this many tiles. */
  sight: number;
  movement: CreatureMovement;
  breaks: BreakRule;
  /** For "soft" breakers: the hardest natural block it tunnels through. */
  digHardness: number;
  /** Damage it does to a door or block with each blow, and the ticks between blows. */
  breakDamage: number;
  breakTicks: number;
  drops: CreatureDrop[];
  /** Combat experience for the dwarf that finishes it off. */
  xp: number;
  spawn: CreatureSpawn;
  mapColor: string;
  art: CreatureArt;
}

export class CreatureRegistry {
  readonly defs: readonly CreatureDef[];
  private readonly ids: ReadonlyMap<string, number>;

  private constructor(defs: CreatureDef[]) {
    this.defs = defs;
    this.ids = new Map(defs.map((def, i) => [def.id, i]));
  }

  static fromJson(data: unknown): CreatureRegistry {
    const v = new Validator('creatures.json');
    const root = v.object(data, '');
    const defs = v.array(root?.creatures, 'creatures').map((raw, i) => parseCreature(v, raw, `creatures[${i}]`));
    v.unique(
      defs.map((def) => def.id),
      'creature id',
    );
    if (!defs.some((def) => def.hostile && def.spawn.night > 0)) v.problem('at least one hostile creature needs a "night" spawn weight');
    v.throwIfProblems();
    return new CreatureRegistry(defs);
  }

  /** Numeric id; throws for unknown ids so typos fail loudly. */
  id(name: string): number {
    const n = this.ids.get(name);
    if (n === undefined) throw new Error(`Unknown creature "${name}"`);
    return n;
  }

  has(name: string): boolean {
    return this.ids.has(name);
  }

  get(kind: number): CreatureDef {
    const def = this.defs[kind];
    if (!def) throw new Error(`Unknown creature number ${kind}`);
    return def;
  }
}

function parseCreature(v: Validator, raw: unknown, path: string): CreatureDef {
  const o = v.object(raw, path);
  const movement = v.object(o?.movement, `${path}.movement`);
  const spawn = o?.spawn === undefined ? undefined : v.object(o.spawn, `${path}.spawn`);
  const art = v.object(o?.art, `${path}.art`);
  const num = (key: string, min: number, max: number, fallback?: number): number =>
    o?.[key] === undefined && fallback !== undefined ? fallback : v.number(o?.[key], `${path}.${key}`, min, max);
  const hostile = v.boolean(o?.hostile, `${path}.hostile`);
  const attack = v.oneOf(o?.attack, ['melee', 'ranged', 'none'] as const, `${path}.attack`) ?? 'none';
  const projectile = o?.projectile === undefined ? null : (v.oneOf(o.projectile, PROJECTILE_KINDS, `${path}.projectile`) ?? null);
  const attackTicks = Math.round(num('attackTicks', 1, 10000, 20));
  const breaks = o?.breaks === undefined ? 'none' : (v.oneOf(o.breaks, ['none', 'doors', 'built', 'soft'] as const, `${path}.breaks`) ?? 'none');
  if (attack === 'ranged' && projectile === null) v.problem(`${path} attacks from range, so it needs a "projectile"`);
  if (hostile && attack === 'none') v.problem(`${path} is hostile, so it needs an "attack"`);
  if (breaks !== 'none' && o?.breakDamage === undefined) v.problem(`${path} breaks things, so it needs a "breakDamage"`);
  if (breaks === 'soft' && o?.digHardness === undefined) v.problem(`${path} tunnels ("breaks": "soft"), so it needs a "digHardness"`);

  const weights = spawn?.animal === undefined ? undefined : v.object(spawn.animal, `${path}.spawn.animal`);
  const animal: Record<string, number> = {};
  for (const [biome, weight] of Object.entries(weights ?? {})) animal[v.identifier(biome, `${path}.spawn.animal key`)] = v.number(weight, `${path}.spawn.animal.${biome}`, 0, 1000);
  if (hostile && Object.keys(animal).length > 0) v.problem(`${path} is hostile, so it can't spawn as an animal`);

  return {
    id: v.identifier(o?.id, `${path}.id`),
    name: v.string(o?.name, `${path}.name`),
    description: o?.description === undefined ? '' : v.string(o.description, `${path}.description`),
    hostile,
    attack,
    health: num('health', 1, 100000),
    armor: num('armor', 0, 1000, 0),
    damage: num('damage', 0, 10000, 0),
    attackTicks,
    range: Math.round(num('range', 1, 30, 1)),
    projectile,
    sight: Math.round(num('sight', 1, 200, 12)),
    movement: {
      walkTicks: Math.round(v.number(movement?.walkTicks, `${path}.movement.walkTicks`, 1, 100)),
      jump: Math.round(v.number(movement?.jump, `${path}.movement.jump`, 0, 4)),
      safeDrop: Math.round(v.number(movement?.safeDrop, `${path}.movement.safeDrop`, 1, 30)),
      climbs: v.oneOf(movement?.climbs, ['none', 'ladders', 'walls'] as const, `${path}.movement.climbs`) ?? 'none',
    },
    breaks,
    digHardness: num('digHardness', 0, 100, 0),
    breakDamage: num('breakDamage', 0, 10000, 0),
    breakTicks: Math.round(num('breakTicks', 1, 10000, attackTicks)),
    drops: v.array(o?.drops ?? [], `${path}.drops`).map((rawDrop, i) => {
      const d = v.object(rawDrop, `${path}.drops[${i}]`);
      return {
        item: v.identifier(d?.item, `${path}.drops[${i}].item`),
        count: Math.round(v.number(d?.count, `${path}.drops[${i}].count`, 1, 999)),
        chance: d?.chance === undefined ? 1 : v.number(d.chance, `${path}.drops[${i}].chance`, 0, 1),
      };
    }),
    xp: num('xp', 0, 10000, 0),
    spawn: {
      night: spawn?.night === undefined ? 0 : v.number(spawn.night, `${path}.spawn.night`, 0, 1000),
      wave: spawn?.wave === undefined ? 0 : v.number(spawn.wave, `${path}.spawn.wave`, 0, 1000),
      fromDay: spawn?.fromDay === undefined ? 1 : Math.round(v.number(spawn.fromDay, `${path}.spawn.fromDay`, 1, 10000)),
      animal,
    },
    mapColor: v.color(o?.mapColor, `${path}.mapColor`),
    art: {
      style: v.oneOf(art?.style, CREATURE_STYLES, `${path}.art.style`) ?? 'gloomling',
      base: v.color(art?.base, `${path}.art.base`),
      dark: v.color(art?.dark, `${path}.art.dark`),
      light: v.color(art?.light, `${path}.art.light`),
      accent: v.color(art?.accent, `${path}.art.accent`),
    },
  };
}
