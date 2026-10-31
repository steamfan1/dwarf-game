import { describe, expect, it } from 'vitest';
import { GameSession } from './GameSession';
import { PlaceholderWalker, Simulation } from './Simulation';

/** 64 FPS frames are exact binary fractions, so one second is exactly 64 of them. */
const FRAME_MS = 15.625;

function playSeconds(session: GameSession, seconds: number): void {
  for (let i = 0; i < 64 * seconds; i++) session.frame(FRAME_MS);
}

describe('GameSession', () => {
  it('advances 20 ticks per second at 1x and 60 at 3x', () => {
    const session = new GameSession('test');
    playSeconds(session, 1);
    expect(session.sim.tick).toBe(20);
    session.time.setSpeed(3);
    playSeconds(session, 1);
    expect(session.sim.tick).toBe(80);
  });

  it('does not advance while paused', () => {
    const session = new GameSession('test');
    session.time.togglePause();
    playSeconds(session, 2);
    expect(session.sim.tick).toBe(0);
  });

  it('forwards time changes to the event bus', () => {
    const session = new GameSession('test');
    const speeds: number[] = [];
    session.bus.on('TimeChanged', (s) => speeds.push(s.speed));
    session.time.setSpeed(2);
    expect(speeds).toEqual([2]);
    session.dispose();
    session.time.setSpeed(3);
    expect(speeds).toEqual([2]);
  });
});

describe('Simulation', () => {
  it('is deterministic for the same seed', () => {
    const a = new Simulation({ seed: 'repeatable' });
    const b = new Simulation({ seed: 'repeatable' });
    for (let i = 0; i < 2000; i++) {
      a.step();
      b.step();
    }
    expect(a.walker.x).toBe(b.walker.x);
    expect(a.rng.getState()).toEqual(b.rng.getState());
  });

  it('keeps the placeholder walker between its bounds and records its previous position', () => {
    const sim = new Simulation({ seed: 'bounds' });
    for (let i = 0; i < 3000; i++) {
      const before = sim.walker.x;
      sim.step();
      expect(sim.walker.prevX).toBe(before);
      expect(sim.walker.x).toBeGreaterThanOrEqual(2);
      expect(sim.walker.x).toBeLessThanOrEqual(14);
      expect(Math.abs(sim.walker.x - sim.walker.prevX)).toBeLessThanOrEqual(PlaceholderWalker.SPEED_TILES_PER_TICK + 1e-9);
    }
  });
});
