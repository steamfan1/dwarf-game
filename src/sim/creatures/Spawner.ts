/**
 * Where creatures come from (numbers in threats.json):
 *
 *  - Night: monsters creep out on dark cells around the colony (never in a room, never
 *    in light, never right next to a dwarf), a few more each night, spread over the first
 *    part of the night. Light is the colony's first defence: torches keep them off.
 *  - Dawn: night monsters out in the light slink away (one by one over half a minute);
 *    those that found a dark cave stay, and keep hunting.
 *  - Invasions: every few nights (`waves.every`), a portal opens on the surface at
 *    nightfall and invaders pour through it, more each time: their number grows with the
 *    day and with the colony's tech tier. The colony is warned a while before dusk, and
 *    the place is chosen then, so the player can get ready. At dawn the portal pulls
 *    any invaders still about back through it.
 *  - Animals graze on the hills by day, a few at a time, well away from the Hearth.
 *
 * Pure: no Phaser and no DOM. All randomness comes from the Rng it is given.
 */
import type { Rng, RngState } from '../../core/Rng';
import type { Dwarf } from '../dwarves/Dwarf';
import type { TimeOfDay } from '../time/TimeOfDay';
import type { World } from '../world/World';
import type { Creature, CreatureOrigin } from './Creature';
import type { CreatureNav } from './CreatureNav';
import type { CreatureDef, CreatureRegistry } from './CreatureRegistry';
import type { ThreatSettings } from './threats';

export interface SpawnerContext {
  readonly world: World;
  readonly creatureKinds: CreatureRegistry;
  readonly threats: ThreatSettings;
  readonly time: TimeOfDay;
  readonly tick: number;
  readonly hearth: { x: number; y: number };
  readonly creatures: readonly Creature[];
  readonly dwarves: readonly Dwarf[];
  navFor(kind: number): CreatureNav;
  /** The light a cell gets right now (0..15). */
  lightNow(x: number, y: number): number;
  inRoom(x: number, y: number): boolean;
  /** How advanced the colony is (0 to start with): bigger invasions come for stronger colonies. */
  techTier(): number;
  spawnCreature(kind: number, x: number, y: number, origin: CreatureOrigin): Creature;
  /** The portal's glow: on at a cell, or off (null). */
  setPortalLight(at: { x: number; y: number } | null): void;
  /** News for the colony (WaveWarning, WaveStarted, WaveEnded, NightThreat). */
  announce(event: SpawnerEvent): void;
}

export type SpawnerEvent =
  | { type: 'NightThreat'; day: number }
  | { type: 'WaveWarning'; day: number; x: number; y: number; ticks: number }
  | { type: 'WaveStarted'; day: number; x: number; y: number; size: number }
  | { type: 'WaveEnded'; day: number; defeated: boolean };

/** An invasion: announced, under way, or over. */
export interface Wave {
  day: number;
  phase: 'warning' | 'open' | 'over';
  /** Where the portal stands (its bottom cell). */
  portal: { x: number; y: number };
  size: number;
  spawned: number;
  nextSpawnTick: number;
  /** The invaders that came through, by id. */
  invaders: number[];
}

/** Tries at finding a cell for one creature before giving up for now. */
const SPOT_TRIES = 40;
/** A night spawn that found nowhere to appear tries again this soon (ticks). */
const RETRY_TICKS = 20;
/** By day, creatures of the night that wander into the light are sent off this often (ticks). */
const DAYLIGHT_CHECK_TICKS = 40;

/** The spawner as a save keeps it. */
export interface SpawnerState {
  wave: Wave | null;
  nightSpawned: number;
  nextNightSpawn: number;
  announcedNight: boolean;
  wasNight: boolean;
  nextAnimalCheck: number;
  forcedWaveDay: number;
  rng: number[];
}

export class Spawner {
  /** The latest invasion (the one under way or coming, or the last one). */
  wave: Wave | null = null;
  /** Night monsters out so far tonight, and when the next may come. */
  nightSpawned = 0;
  private nextNightSpawn = 0;
  private announcedNight = false;
  private wasNight: boolean;
  private nextAnimalCheck = 0;
  /** A day whose night brings an invasion whatever the schedule says (debug), or 0. */
  private forcedWaveDay = 0;
  private readonly ctx: SpawnerContext;
  private readonly rng: Rng;

  constructor(ctx: SpawnerContext, rng: Rng) {
    this.ctx = ctx;
    this.rng = rng;
    this.wasNight = ctx.time.isNight(ctx.tick);
    this.nextAnimalCheck = ctx.tick + ctx.threats.animals.checkTicks;
  }

  /** What a save keeps of the spawner: the invasion, tonight's tally and the timers. */
  save(): SpawnerState {
    const wave = this.wave ? { ...this.wave, portal: { ...this.wave.portal }, invaders: [...this.wave.invaders] } : null;
    return {
      wave,
      nightSpawned: this.nightSpawned,
      nextNightSpawn: this.nextNightSpawn,
      announcedNight: this.announcedNight,
      wasNight: this.wasNight,
      nextAnimalCheck: this.nextAnimalCheck,
      forcedWaveDay: this.forcedWaveDay,
      rng: [...this.rng.getState()],
    };
  }

  restore(state: SpawnerState): void {
    this.wave = state.wave ? { ...state.wave, portal: { ...state.wave.portal }, invaders: [...state.wave.invaders] } : null;
    this.nightSpawned = state.nightSpawned;
    this.nextNightSpawn = state.nextNightSpawn;
    this.announcedNight = state.announcedNight;
    this.wasNight = state.wasNight;
    this.nextAnimalCheck = state.nextAnimalCheck;
    this.forcedWaveDay = state.forcedWaveDay;
    this.rng.setState(state.rng as unknown as RngState);
  }

  /** Put the first animals out on the hills (when a world starts). */
  populate(): void {
    for (let n = 0; n < this.ctx.threats.animals.start; n++) this.spawnAnimal();
  }

  /** Whether the night of `day` brings an invasion. */
  isWaveNight(day: number): boolean {
    return day === this.forcedWaveDay || day % this.ctx.threats.waves.every === 0;
  }

  /** How many invaders come on the night of `day`. */
  waveSize(day: number): number {
    const w = this.ctx.threats.waves;
    return Math.max(1, Math.min(w.max, Math.round(w.base + w.perDay * day + w.perTier * this.ctx.techTier())));
  }

  /** How many monsters come out on an ordinary night of `day`. */
  nightBudget(day: number): number {
    const n = this.ctx.threats.night;
    return Math.min(n.max, Math.round(n.base + n.perDay * (day - 1)));
  }

  /** The next invasion's day (today's, if tonight brings one). */
  nextWaveDay(): number {
    const day = this.ctx.time.day(this.ctx.tick);
    const every = this.ctx.threats.waves.every;
    return Math.ceil(day / every) * every;
  }

  step(): void {
    const { ctx } = this;
    const tick = ctx.tick;
    const night = ctx.time.isNight(tick);
    const day = ctx.time.day(tick);
    if (night !== this.wasNight) {
      this.wasNight = night;
      if (night) this.nightFalls();
      else this.dawn();
    }
    this.stepWave(tick, night, day);
    if (night && !this.isWaveNight(day)) this.stepNight(tick, day);
    if (!night) {
      if (tick >= this.nextAnimalCheck) {
        this.nextAnimalCheck = tick + ctx.threats.animals.checkTicks;
        if (this.count('animal') < ctx.threats.animals.max) this.spawnAnimal();
      }
      if (tick % DAYLIGHT_CHECK_TICKS === 0) this.sendOffInLight(false);
    }
  }

  /**
   * Debug: an invasion tonight. By day the clock moves on to `ticks` before nightfall, so
   * the warning comes now and the portal opens at dusk; at night it opens straight away.
   */
  debugWave(ticks: number): void {
    const { time, tick } = this.ctx;
    if (!time.isNight(tick)) time.skipToBeforeNight(tick, ticks);
    this.forcedWaveDay = time.day(tick);
  }

  // ---- Night -------------------------------------------------------------------------------

  private nightFalls(): void {
    this.nightSpawned = 0;
    this.nextNightSpawn = this.ctx.tick + RETRY_TICKS;
    this.announcedNight = false;
  }

  private stepNight(tick: number, day: number): void {
    if (tick < this.nextNightSpawn) return;
    const { ctx } = this;
    const n = ctx.threats.night;
    const budget = this.nightBudget(day);
    if (this.nightSpawned >= budget) return;
    if (this.count('night') >= n.maxAlive) {
      this.nextNightSpawn = tick + RETRY_TICKS * 2;
      return;
    }
    const kind = this.pickKind((def) => (def.hostile && def.spawn.fromDay <= day ? def.spawn.night : 0));
    const spot = kind < 0 ? null : this.findDarkSpot(kind);
    if (!spot) {
      this.nextNightSpawn = tick + RETRY_TICKS;
      return;
    }
    ctx.spawnCreature(kind, spot.x, spot.y, 'night');
    this.nightSpawned++;
    this.nextNightSpawn = tick + Math.max(RETRY_TICKS, Math.floor((ctx.time.settings.nightTicks * n.spreadOver) / Math.max(1, budget)));
    if (!this.announcedNight) {
      this.announcedNight = true;
      ctx.announce({ type: 'NightThreat', day });
    }
  }

  /** A dark cell near the colony where a creature of this kind could stand, or null. */
  private findDarkSpot(kind: number): { x: number; y: number } | null {
    const { ctx, rng } = this;
    const n = ctx.threats.night;
    const nav = ctx.navFor(kind);
    for (let attempt = 0; attempt < SPOT_TRIES; attempt++) {
      const side = rng.chance(0.5) ? 1 : -1;
      const x = ctx.hearth.x + side * rng.int(Math.round(n.minDistance), Math.round(n.maxDistance));
      const top = ctx.hearth.y + rng.int(n.rows[0], n.rows[1]);
      const spot = this.standingSpot(nav, x, top, 6);
      if (!spot) continue;
      if (ctx.inRoom(spot.x, spot.y) || ctx.lightNow(spot.x, spot.y) > n.maxLight || nav.waterAt(spot.x, spot.y)) continue;
      if (this.nearDwarf(spot.x, spot.y, n.dwarfDistance)) continue;
      return spot;
    }
    return null;
  }

  // ---- Dawn --------------------------------------------------------------------------------

  /** The night is over: the portal (if open) takes its invaders back; night monsters in the light leave. */
  private dawn(): void {
    const wave = this.wave;
    if (wave && wave.phase !== 'over') {
      const leaveTicks = this.ctx.threats.dawn.leaveTicks;
      for (const creature of this.ctx.creatures) {
        if (!creature.gone && creature.origin === 'wave' && creature.leaveAt === 0) creature.leaveAt = this.ctx.tick + this.rng.int(0, Math.floor(leaveTicks / 2));
      }
      if (wave.phase === 'open') this.ctx.announce({ type: 'WaveEnded', day: wave.day, defeated: false });
      this.closePortal(wave);
    }
    this.sendOffInLight(true);
  }

  /** Creatures of the night standing in daylight slink away (at dawn: one by one, over a while). */
  private sendOffInLight(spread: boolean): void {
    const { ctx } = this;
    const { leaveLight, leaveTicks } = ctx.threats.dawn;
    for (const creature of ctx.creatures) {
      if (creature.gone || creature.leaveAt !== 0 || (creature.origin !== 'night' && creature.origin !== 'wave')) continue;
      if (ctx.lightNow(creature.x, creature.y) < leaveLight) continue;
      creature.leaveAt = ctx.tick + (spread ? this.rng.int(0, leaveTicks) : this.rng.int(0, 20));
    }
  }

  // ---- Invasions ---------------------------------------------------------------------------

  private stepWave(tick: number, night: boolean, day: number): void {
    const { ctx } = this;
    const waves = ctx.threats.waves;
    let wave = this.wave;
    const thisNight = wave !== null && wave.day === day;
    if (!night && this.isWaveNight(day) && !thisNight && ctx.time.ticksUntilNight(tick) <= waves.warningTicks) {
      this.warn(day, ctx.time.ticksUntilNight(tick));
      wave = this.wave;
    }
    if (night && this.isWaveNight(day) && !thisNight) {
      // Night fell without a warning (the clock was moved on): open straight away.
      this.warn(day, 0);
      wave = this.wave;
    }
    if (!wave || wave.phase === 'over') return;
    if (wave.phase === 'warning') {
      if (tick >= wave.nextSpawnTick) this.openPortal(wave);
      return;
    }
    if (wave.spawned < wave.size && tick >= wave.nextSpawnTick) {
      const kind = this.pickKind((def) => (def.hostile && def.spawn.fromDay <= Math.max(day, wave.day) ? def.spawn.wave : 0));
      if (kind >= 0) {
        const creature = ctx.spawnCreature(kind, wave.portal.x, wave.portal.y, 'wave');
        wave.invaders.push(creature.id);
      }
      wave.spawned++;
      wave.nextSpawnTick = tick + waves.spawnTicks;
    }
    if (wave.spawned >= wave.size && !ctx.creatures.some((c) => !c.gone && c.origin === 'wave')) {
      ctx.announce({ type: 'WaveEnded', day: wave.day, defeated: true });
      this.closePortal(wave);
    }
  }

  /** Announce an invasion: pick where the portal opens, `ticks` from now. */
  private warn(day: number, ticks: number): void {
    const portal = this.portalSpot();
    this.wave = { day, phase: 'warning', portal, size: this.waveSize(day), spawned: 0, nextSpawnTick: this.ctx.tick + ticks, invaders: [] };
    this.ctx.announce({ type: 'WaveWarning', day, x: portal.x, y: portal.y, ticks });
  }

  private openPortal(wave: Wave): void {
    wave.phase = 'open';
    wave.nextSpawnTick = this.ctx.tick;
    this.ctx.setPortalLight(wave.portal);
    this.ctx.announce({ type: 'WaveStarted', day: wave.day, x: wave.portal.x, y: wave.portal.y, size: wave.size });
  }

  private closePortal(wave: Wave): void {
    if (wave.phase === 'open') this.ctx.setPortalLight(null);
    wave.phase = 'over';
  }

  /** A place on the surface, some way off to one side of the Hearth, where invaders can stand. */
  private portalSpot(): { x: number; y: number } {
    const { ctx, rng } = this;
    const [near, far] = ctx.threats.waves.portalDistance;
    const walker = this.pickKind((def) => (def.hostile ? def.spawn.wave + def.spawn.night : 0));
    const nav = ctx.navFor(Math.max(0, walker));
    const firstSide = rng.chance(0.5) ? 1 : -1;
    for (let attempt = 0; attempt < SPOT_TRIES; attempt++) {
      const side = attempt < SPOT_TRIES / 2 ? firstSide : -firstSide;
      const x = ctx.hearth.x + side * rng.int(Math.round(near), Math.round(far));
      const spot = this.surfaceSpot(nav, x);
      if (spot && !nav.waterAt(spot.x, spot.y) && !ctx.inRoom(spot.x, spot.y)) return spot;
    }
    return { x: Math.max(0, Math.min(ctx.world.width - 1, ctx.hearth.x + firstSide * Math.round(near))), y: ctx.hearth.y };
  }

  // ---- Animals -------------------------------------------------------------------------------

  private spawnAnimal(): void {
    const { ctx, rng } = this;
    const biome = ctx.world.biome;
    const kind = this.pickKind((def) => (def.hostile ? 0 : (def.spawn.animal[biome] ?? 0)));
    if (kind < 0) return;
    const nav = ctx.navFor(kind);
    const a = ctx.threats.animals;
    for (let attempt = 0; attempt < SPOT_TRIES; attempt++) {
      const side = rng.chance(0.5) ? 1 : -1;
      const x = ctx.hearth.x + side * rng.int(Math.round(a.minDistance), Math.round(a.maxDistance));
      const spot = this.surfaceSpot(nav, x);
      if (!spot || nav.waterAt(spot.x, spot.y) || ctx.inRoom(spot.x, spot.y) || this.nearDwarf(spot.x, spot.y, 8)) continue;
      ctx.spawnCreature(kind, spot.x, spot.y, 'animal');
      return;
    }
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  /** A creature kind picked at random by weight (-1 if no kind has any). */
  private pickKind(weight: (def: CreatureDef) => number): number {
    const defs = this.ctx.creatureKinds.defs;
    let total = 0;
    for (const def of defs) total += Math.max(0, weight(def));
    if (total <= 0) return -1;
    let roll = this.rng.next() * total;
    for (let kind = 0; kind < defs.length; kind++) {
      roll -= Math.max(0, weight(defs[kind]!));
      if (roll < 0) return kind;
    }
    return defs.length - 1;
  }

  /** The first cell from row `top` down (at most `depth` rows) where a creature could stand. */
  private standingSpot(nav: CreatureNav, x: number, top: number, depth: number): { x: number; y: number } | null {
    const { world } = this.ctx;
    for (let y = Math.max(0, top); y <= top + depth && y < world.height; y++) {
      if (!world.inBounds(x, y)) return null;
      if (nav.open(x, y) && nav.standable(x, y)) return { x, y };
    }
    return null;
  }

  /** Where a creature would stand on the ground in column x, coming down from the sky. */
  private surfaceSpot(nav: CreatureNav, x: number): { x: number; y: number } | null {
    const { world } = this.ctx;
    if (x < 0 || x >= world.width) return null;
    for (let y = 0; y < world.height; y++) {
      if (!nav.open(x, y)) return null;
      if (nav.standable(x, y)) return { x, y };
    }
    return null;
  }

  private nearDwarf(x: number, y: number, distance: number): boolean {
    return this.ctx.dwarves.some((d) => d.phase !== 'dead' && Math.max(Math.abs(d.x - x), Math.abs(d.y - y)) < distance);
  }

  private count(origin: CreatureOrigin): number {
    let n = 0;
    for (const creature of this.ctx.creatures) if (!creature.gone && creature.origin === origin) n++;
    return n;
  }
}
