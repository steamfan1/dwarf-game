import { describe, expect, it } from 'vitest';
import { TimeControl, type TimeState } from './TimeControl';

describe('TimeControl', () => {
  it('starts running at 1x', () => {
    const time = new TimeControl();
    expect(time.paused).toBe(false);
    expect(time.effectiveSpeed).toBe(1);
  });

  it('toggles a player pause', () => {
    const time = new TimeControl();
    time.togglePause();
    expect(time.paused).toBe(true);
    expect(time.effectiveSpeed).toBe(0);
    time.togglePause();
    expect(time.paused).toBe(false);
  });

  it('choosing a speed resumes from a player pause', () => {
    const time = new TimeControl();
    time.togglePause();
    time.setSpeed(3);
    expect(time.paused).toBe(false);
    expect(time.effectiveSpeed).toBe(3);
  });

  it('stays paused while the menu is open, whatever else happens', () => {
    const time = new TimeControl();
    time.pause('menu');
    time.togglePause();
    time.setSpeed(2);
    expect(time.paused).toBe(true);
    time.resume('menu');
    expect(time.paused).toBe(false);
    expect(time.effectiveSpeed).toBe(2);
  });

  it('pauses when the tab is hidden and stays paused when it returns', () => {
    const time = new TimeControl();
    time.setHidden(true);
    expect(time.paused).toBe(true);
    expect(time.setHidden(false)).toBe(true);
    expect(time.paused).toBe(true);
    expect(time.state().reasons).toEqual(['player']);
    time.togglePause();
    expect(time.paused).toBe(false);
  });

  it('does not report a hand-over if the player had already paused', () => {
    const time = new TimeControl();
    time.togglePause();
    time.setHidden(true);
    expect(time.setHidden(false)).toBe(false);
    expect(time.state().reasons).toEqual(['player']);
  });

  it('notifies listeners with a snapshot on every change', () => {
    const time = new TimeControl();
    const states: TimeState[] = [];
    time.onChange((s) => states.push(s));
    time.setSpeed(2);
    time.togglePause();
    time.setSpeed(2);
    expect(states.map((s) => [s.speed, s.paused])).toEqual([
      [2, false],
      [2, true],
      [2, false],
    ]);
  });

  it('applies the debug multiplier on top of the speed, within limits', () => {
    const time = new TimeControl();
    time.setSpeed(2);
    time.setDebugMultiplier(5);
    expect(time.effectiveSpeed).toBe(10);
    time.setDebugMultiplier(1000);
    expect(time.state().debugMultiplier).toBe(20);
    time.setDebugMultiplier(Number.NaN);
    expect(time.state().debugMultiplier).toBe(1);
  });
});
