/**
 * One running world: the simulation, its clock, its speed/pause control and its event bus.
 *
 * Phaser-free. The render layer calls `frame(deltaMs)` once per animation frame; the
 * session turns real time into whole simulation ticks (20 per second at 1x) and exposes
 * `alpha` so sprites can be drawn between the last two ticks.
 */
import { MAX_FRAME_MS, MAX_TICKS_PER_FRAME, TICK_MS } from '../config';
import { EventBus } from '../core/EventBus';
import { FixedTimestep } from '../core/FixedTimestep';
import { TimeControl } from '../core/TimeControl';
import type { GameContent } from './content';
import type { Traveller } from './dwarves/Dwarf';
import type { GameEvents } from './events';
import { decodeSave, encodeSave, SaveError, type SaveMeta } from './save/SaveFile';
import { captureState, restoreState } from './save/SimState';
import { Simulation } from './Simulation';
import type { World } from './world/World';

export class GameSession {
  readonly bus = new EventBus<GameEvents>();
  readonly time = new TimeControl();
  readonly clock = new FixedTimestep(TICK_MS, MAX_FRAME_MS, MAX_TICKS_PER_FRAME);
  readonly sim: Simulation;

  /** Smoothed cost of one simulation tick in milliseconds, for the debug overlay. */
  tickCostMs = 0;

  private readonly now: () => number;
  private readonly unsubscribeTime: () => void;

  /**
   * `startHour` sets the clock for a new world (the morning, from time.json, by default);
   * `travellers` came through a World Gate and are its first dwarves. With `fresh` false
   * the world starts empty, for a save to be loaded into (see `fromSave`).
   */
  constructor(
    world: World,
    content: GameContent,
    now: () => number = () => performance.now(),
    startHour?: number,
    travellers?: readonly Traveller[],
    fresh = true,
  ) {
    this.sim = new Simulation({ world, ...content, bus: this.bus, startHour, travellers, fresh });
    this.now = now;
    this.unsubscribeTime = this.time.onChange((state) => this.bus.emit('TimeChanged', state));
  }

  /** A session for a saved game's bytes (see sim/save/SaveFile.ts). Throws SaveError. */
  static fromSave(bytes: Uint8Array, content: GameContent, now: () => number = () => performance.now()): GameSession {
    const { header, world } = decodeSave(bytes, content.tiles);
    const session = new GameSession(world, content, now, undefined, undefined, false);
    try {
      restoreState(session.sim, header.state);
    } catch (error) {
      session.dispose();
      throw new SaveError('damaged', (error as Error).message);
    }
    return session;
  }

  /** The running world packed into bytes, with what the title screen shows about it. */
  save(savedAt: number): { bytes: Uint8Array; meta: SaveMeta } {
    const { sim } = this;
    const meta: SaveMeta = { day: sim.time.day(sim.tick), dwarves: sim.livingDwarves.length, seed: sim.world.seed, biome: sim.world.biome, savedAt };
    return { bytes: encodeSave(sim.world, sim.tiles, meta, captureState(sim)), meta };
  }

  get world(): World {
    return this.sim.world;
  }

  /** Advance by one rendered frame of `frameMs` real milliseconds. Returns the ticks run. */
  frame(frameMs: number): number {
    const ticks = this.clock.advance(frameMs, this.time.effectiveSpeed);
    for (let i = 0; i < ticks; i++) {
      const start = this.now();
      this.sim.step();
      const cost = this.now() - start;
      this.tickCostMs = this.tickCostMs === 0 ? cost : this.tickCostMs * 0.95 + cost * 0.05;
    }
    return ticks;
  }

  /** How far rendering is between the previous and the latest tick (0..1). */
  get alpha(): number {
    return this.clock.alpha;
  }

  dispose(): void {
    this.unsubscribeTime();
    this.bus.clear();
  }
}
