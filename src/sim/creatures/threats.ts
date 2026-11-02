/**
 * When and where danger comes from (src/data/threats.json): monsters creeping out of the
 * dark at night, animals on the hills by day, invasion waves through a portal every few
 * nights, how monsters toughen as the days go by, and the numbers combat shares (how hard
 * blocks are to break, how much armour helps, how fast missiles fly).
 *
 * Times are given in seconds (at 1x) or in-game days and turned into ticks here.
 * Pure: no Phaser and no DOM.
 */
import { TICKS_PER_SECOND } from '../../config';
import { Validator } from '../../core/validate';
import type { ProjectileKind } from '../items/ItemRegistry';

export interface ThreatSettings {
  night: {
    /** Monsters appear between these distances (tiles, across) from the Hearth... */
    minDistance: number;
    maxDistance: number;
    /** ...from this many rows above the Hearth to this many below it... */
    rows: [number, number];
    /** ...never closer than this to a dwarf... */
    dwarfDistance: number;
    /** ...only in cells this dark or darker (light 0..15)... */
    maxLight: number;
    /** ...and never inside a room. How many come in a night: base + perDay * (day - 1), at most max. */
    base: number;
    perDay: number;
    max: number;
    /** No more night monsters than this alive at once. */
    maxAlive: number;
    /** They come out over this fraction of the night (0..1). */
    spreadOver: number;
  };
  dawn: {
    /** At dawn, night monsters in at least this much light slink away... */
    leaveLight: number;
    /** ...one by one over this many ticks. */
    leaveTicks: number;
  };
  animals: {
    max: number;
    /** Animals out on the hills when a world starts. */
    start: number;
    /** By day, a new animal may wander in this often (ticks)... */
    checkTicks: number;
    /** ...between these distances (tiles, across) from the Hearth. */
    minDistance: number;
    maxDistance: number;
  };
  waves: {
    /** An invasion comes every this many nights (the nights of days every, 2 * every...). */
    every: number;
    /** The colony is warned this many ticks before nightfall. */
    warningTicks: number;
    /** Invaders: base + perDay * day + perTier * tech tier, at most max. */
    base: number;
    perDay: number;
    perTier: number;
    max: number;
    /** The portal opens on the surface between these distances (tiles, across) from the Hearth. */
    portalDistance: [number, number];
    /** One invader comes through every this many ticks. */
    spawnTicks: number;
  };
  /** Monsters get tougher every day: health and damage grow by these fractions per day, up to maxFactor times. */
  scaling: { healthPerDay: number; damagePerDay: number; maxFactor: number };
  /** Tiles per tick. */
  projectileSpeed: Record<ProjectileKind, number>;
  /** A block's hit points are its hardness times this (unless tiles.json gives "hp"). */
  tileHpPerHardness: number;
  /** Armour a softens a hit of d to d * armorScale / (armorScale + a). */
  armorScale: number;
}

export function parseThreatSettings(data: unknown): ThreatSettings {
  const v = new Validator('threats.json');
  const root = v.object(data, '');
  const section = (name: string): Record<string, unknown> | undefined => v.object(root?.[name], name);
  const night = section('night');
  const dawn = section('dawn');
  const animals = section('animals');
  const waves = section('waves');
  const scaling = section('scaling');
  const projectiles = section('projectiles');
  const num = (o: Record<string, unknown> | undefined, path: string, key: string, min: number, max: number): number =>
    v.number(o?.[key], `${path}.${key}`, min, max);
  const ticks = (o: Record<string, unknown> | undefined, path: string, key: string, max: number): number =>
    Math.max(1, Math.round(num(o, path, key, 0, max) * TICKS_PER_SECOND));
  const rows = v.range(night?.rows, 'night.rows', -200, 200);

  const settings: ThreatSettings = {
    night: {
      minDistance: num(night, 'night', 'minDistance', 0, 400),
      maxDistance: num(night, 'night', 'maxDistance', 1, 400),
      rows,
      dwarfDistance: num(night, 'night', 'dwarfDistance', 0, 100),
      maxLight: num(night, 'night', 'maxLight', 0, 15),
      base: num(night, 'night', 'base', 0, 1000),
      perDay: num(night, 'night', 'perDay', 0, 1000),
      max: Math.round(num(night, 'night', 'max', 0, 1000)),
      maxAlive: Math.round(num(night, 'night', 'maxAlive', 0, 1000)),
      spreadOver: num(night, 'night', 'spreadOver', 0.05, 1),
    },
    dawn: {
      leaveLight: num(dawn, 'dawn', 'leaveLight', 0, 15),
      leaveTicks: ticks(dawn, 'dawn', 'leaveSeconds', 3600),
    },
    animals: {
      max: Math.round(num(animals, 'animals', 'max', 0, 100)),
      start: Math.round(num(animals, 'animals', 'start', 0, 100)),
      checkTicks: ticks(animals, 'animals', 'checkSeconds', 3600),
      minDistance: num(animals, 'animals', 'minDistance', 0, 400),
      maxDistance: num(animals, 'animals', 'maxDistance', 1, 400),
    },
    waves: {
      every: Math.round(num(waves, 'waves', 'every', 1, 100)),
      warningTicks: ticks(waves, 'waves', 'warningSeconds', 3600),
      base: num(waves, 'waves', 'base', 0, 1000),
      perDay: num(waves, 'waves', 'perDay', 0, 1000),
      perTier: num(waves, 'waves', 'perTier', 0, 1000),
      max: Math.round(num(waves, 'waves', 'max', 1, 1000)),
      portalDistance: v.range(waves?.portalDistance, 'waves.portalDistance', 1, 400),
      spawnTicks: ticks(waves, 'waves', 'spawnSeconds', 600),
    },
    scaling: {
      healthPerDay: num(scaling, 'scaling', 'healthPerDay', 0, 10),
      damagePerDay: num(scaling, 'scaling', 'damagePerDay', 0, 10),
      maxFactor: num(scaling, 'scaling', 'maxFactor', 1, 100),
    },
    projectileSpeed: {
      bolt: num(projectiles, 'projectiles', 'bolt', 0.05, 1),
      spit: num(projectiles, 'projectiles', 'spit', 0.05, 1),
    },
    tileHpPerHardness: v.number(root?.tileHpPerHardness, 'tileHpPerHardness', 1, 100000),
    armorScale: v.number(root?.armorScale, 'armorScale', 0.1, 10000),
  };
  if (settings.night.maxDistance < settings.night.minDistance) v.problem('night.maxDistance must not be below night.minDistance');
  if (settings.animals.maxDistance < settings.animals.minDistance) v.problem('animals.maxDistance must not be below animals.minDistance');
  if (settings.animals.start > settings.animals.max) v.problem('animals.start must not be above animals.max');
  v.throwIfProblems();
  return settings;
}
