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
import type { GameEvents } from './events';
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

  /** `startHour` sets the clock for a new world (the morning, from time.json, by default). */
  constructor(world: World, content: GameContent, now: () => number = () => performance.now(), startHour?: number) {
    this.sim = new Simulation({ world, ...content, bus: this.bus, startHour });
    this.now = now;
    this.unsubscribeTime = this.time.onChange((state) => this.bus.emit('TimeChanged', state));
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
