import { describe, expect, it } from 'vitest';
import { FixedTimestep } from './FixedTimestep';

const TICK = 50; // 20 ticks per second

/** Frame lengths that are exact binary fractions, so the sums below are exact. */
const FRAME_TIMES_MS = [7.8125, 15.625, 31.25]; // 128, 64 and 32 FPS

function runOneSecond(clock: FixedTimestep, frameMs: number, speed: number): number {
  let ticks = 0;
  for (let elapsed = 0; elapsed < 1000; elapsed += frameMs) ticks += clock.advance(frameMs, speed);
  return ticks;
}

describe('FixedTimestep', () => {
  it('runs 20, 40 and 60 ticks per second at 1x, 2x and 3x, at any frame rate', () => {
    for (const frameMs of FRAME_TIMES_MS) {
      expect(runOneSecond(new FixedTimestep(TICK), frameMs, 1)).toBe(20);
      expect(runOneSecond(new FixedTimestep(TICK), frameMs, 2)).toBe(40);
      expect(runOneSecond(new FixedTimestep(TICK), frameMs, 3)).toBe(60);
    }
  });

  it('runs no ticks while paused (speed 0) and keeps alpha frozen', () => {
    const clock = new FixedTimestep(TICK);
    clock.advance(70, 1);
    const alpha = clock.alpha;
    expect(clock.advance(1000, 0)).toBe(0);
    expect(clock.alpha).toBe(alpha);
  });

  it('clamps a huge frame (e.g. after a tab switch) to maxFrameMs', () => {
    const clock = new FixedTimestep(TICK, 250, 100);
    expect(clock.advance(60_000, 1)).toBe(5);
  });

  it('caps ticks per frame and records the dropped time', () => {
    const clock = new FixedTimestep(TICK, 250, 8);
    // 250 ms at 3x is 750 ms of game time = 15 ticks; capped to 8, so 7 ticks (350 ms) are dropped.
    expect(clock.advance(250, 3)).toBe(8);
    expect(clock.droppedMs).toBe(350);
    expect(clock.alpha).toBe(0);
  });

  it('reports alpha as the fraction of the next tick already elapsed', () => {
    const clock = new FixedTimestep(TICK);
    expect(clock.advance(75, 1)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0.5, 10);
  });

  it('keeps alpha within [0, 1) under irregular frames', () => {
    const clock = new FixedTimestep(TICK);
    for (let i = 0; i < 1000; i++) {
      clock.advance(Math.random() * 40, 1 + Math.floor(Math.random() * 3));
      expect(clock.alpha).toBeGreaterThanOrEqual(0);
      expect(clock.alpha).toBeLessThan(1);
    }
  });

  it('ignores NaN and negative frame times', () => {
    const clock = new FixedTimestep(TICK);
    expect(clock.advance(Number.NaN, 1)).toBe(0);
    expect(clock.advance(-16, 1)).toBe(0);
  });
});
