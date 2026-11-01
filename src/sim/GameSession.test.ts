import { describe, expect, it } from 'vitest';
import { CONTENT } from './content';
import { GameSession } from './GameSession';
import { World } from './world/World';

/** 64 FPS frames are exact binary fractions, so one second is exactly 64 of them. */
const FRAME_MS = 15.625;

function playSeconds(session: GameSession, seconds: number): void {
  for (let i = 0; i < 64 * seconds; i++) session.frame(FRAME_MS);
}

function newSession(): GameSession {
  return new GameSession(World.empty(16, 16, 'test', 'temperate'), CONTENT);
}

describe('GameSession', () => {
  it('advances 20 ticks per second at 1x and 60 at 3x', () => {
    const session = newSession();
    playSeconds(session, 1);
    expect(session.sim.tick).toBe(20);
    session.time.setSpeed(3);
    playSeconds(session, 1);
    expect(session.sim.tick).toBe(80);
  });

  it('does not advance while paused', () => {
    const session = newSession();
    session.time.togglePause();
    playSeconds(session, 2);
    expect(session.sim.tick).toBe(0);
  });

  it('forwards time changes to the event bus until disposed', () => {
    const session = newSession();
    const speeds: number[] = [];
    session.bus.on('TimeChanged', (s) => speeds.push(s.speed));
    session.time.setSpeed(2);
    expect(speeds).toEqual([2]);
    session.dispose();
    session.time.setSpeed(3);
    expect(speeds).toEqual([2]);
  });

  it('routes simulation events through its bus', () => {
    const session = newSession();
    let explored = 0;
    session.bus.on('ExploredChanged', () => explored++);
    session.sim.revealAll();
    expect(explored).toBe(1);
  });
});
