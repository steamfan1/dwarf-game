/**
 * Fixed-timestep accumulator for the simulation clock.
 *
 * Every animation frame, call `advance(frameMs, speed)`. It returns how many simulation
 * ticks to run this frame. After running them, `alpha` (0..1) is how far rendering sits
 * between the previous tick and the latest one, so sprites can be interpolated smoothly
 * at any frame rate while the simulation itself always moves in whole ticks.
 *
 *  - Long frames (tab switches, debugger pauses, GC hitches) are clamped to `maxFrameMs`,
 *    so the game never tries to catch up on minutes of missed time at once.
 *  - At most `maxTicksPerFrame` ticks run per frame. Time beyond that is dropped and
 *    counted in `droppedMs` instead of piling up into a "spiral of death".
 *  - `speed` scales simulated time (1x, 2x, 3x). Speed 0 means paused: no ticks run and
 *    `alpha` holds still, so the picture freezes exactly where it was.
 */
export class FixedTimestep {
  readonly tickMs: number;
  readonly maxFrameMs: number;
  readonly maxTicksPerFrame: number;

  /** Total simulated time thrown away because of the per-frame tick cap. */
  droppedMs = 0;

  private accumulator = 0;
  private interpolation = 0;

  constructor(tickMs: number, maxFrameMs = 250, maxTicksPerFrame = 8) {
    if (!(tickMs > 0)) throw new Error(`tickMs must be positive, got ${tickMs}`);
    this.tickMs = tickMs;
    this.maxFrameMs = maxFrameMs;
    this.maxTicksPerFrame = Math.max(1, Math.floor(maxTicksPerFrame));
  }

  /** Feed one frame of real time; returns the number of ticks to simulate now. */
  advance(frameMs: number, speed: number): number {
    // `!(x > 0)` also rejects NaN, which a broken timer could hand us.
    if (!(frameMs > 0) || !(speed > 0)) return 0;

    this.accumulator += Math.min(frameMs, this.maxFrameMs) * speed;
    let ticks = Math.floor(this.accumulator / this.tickMs);

    if (ticks > this.maxTicksPerFrame) {
      const excess = ticks - this.maxTicksPerFrame;
      this.droppedMs += excess * this.tickMs;
      this.accumulator -= excess * this.tickMs;
      ticks = this.maxTicksPerFrame;
    }

    this.accumulator -= ticks * this.tickMs;
    this.interpolation = this.accumulator / this.tickMs;
    return ticks;
  }

  /** Interpolation factor between the previous and the latest tick, in [0, 1). */
  get alpha(): number {
    return this.interpolation;
  }

  reset(): void {
    this.accumulator = 0;
    this.interpolation = 0;
    this.droppedMs = 0;
  }
}
