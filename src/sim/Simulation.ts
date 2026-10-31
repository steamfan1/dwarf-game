/**
 * All game state that advances in fixed ticks.
 *
 * Pure TypeScript: no Phaser and no DOM, so it runs in unit tests and could move into a
 * worker. All randomness comes from `rng`, never Math.random(), so a world can be
 * replayed exactly from its seed and the player's orders.
 *
 * Milestone 0 holds only the tick counter and a placeholder walker that exercises the
 * fixed-timestep and interpolation pipeline end to end. The world, dwarves and job
 * system replace the walker from Milestone 1 on.
 */
import { Rng } from '../core/Rng';

export interface SimulationOptions {
  seed: string;
}

export class Simulation {
  readonly seed: string;
  readonly rng: Rng;
  /** Number of ticks simulated since the world began. */
  tick = 0;
  readonly walker: PlaceholderWalker;

  constructor(options: SimulationOptions) {
    this.seed = options.seed;
    this.rng = new Rng(options.seed);
    this.walker = new PlaceholderWalker(this.rng.fork('walker'), 2, 14);
  }

  /** Advance the world by exactly one tick (1/20 s of game time at 1x speed). */
  step(): void {
    this.tick++;
    this.walker.step();
  }
}

/**
 * Milestone 0 placeholder: paces between two points on flat ground, idling for a random
 * moment at each end. Positions are in tiles; `prevX` is the position one tick earlier,
 * which the renderer blends with `x` to draw smooth motion between ticks.
 * Removed in Milestone 2, when real dwarves arrive.
 */
export class PlaceholderWalker {
  static readonly SPEED_TILES_PER_TICK = 0.075;

  x: number;
  prevX: number;
  direction: 1 | -1 = 1;
  /** Ticks left to stand still before walking again. */
  idleTicks = 0;

  private readonly rng: Rng;
  private readonly minX: number;
  private readonly maxX: number;

  constructor(rng: Rng, minX: number, maxX: number) {
    this.rng = rng;
    this.minX = minX;
    this.maxX = maxX;
    this.x = minX;
    this.prevX = minX;
  }

  get walking(): boolean {
    return this.idleTicks === 0;
  }

  step(): void {
    this.prevX = this.x;
    if (this.idleTicks > 0) {
      this.idleTicks--;
      return;
    }
    this.x += this.direction * PlaceholderWalker.SPEED_TILES_PER_TICK;
    if (this.x >= this.maxX || this.x <= this.minX) {
      this.x = Math.min(this.maxX, Math.max(this.minX, this.x));
      this.direction = this.direction === 1 ? -1 : 1;
      this.idleTicks = this.rng.int(10, 40);
    }
  }
}
