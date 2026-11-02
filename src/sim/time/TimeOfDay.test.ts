import { describe, expect, it } from 'vitest';
import { TIME } from '../content';
import { parseTimeSettings, TimeOfDay } from './TimeOfDay';

const SECOND = 20;
const MINUTE = 60 * SECOND;

describe('TimeOfDay', () => {
  it('has about 6 minutes of daylight and 3 of night at 1x, as time.json says', () => {
    expect(TIME.dayTicks).toBe(6 * MINUTE);
    expect(TIME.nightTicks).toBe(3 * MINUTE);
    const time = new TimeOfDay(TIME, TIME.dayStartHour);
    expect(time.cycleTicks).toBe(9 * MINUTE);
    expect(time.isNight(0)).toBe(false);
    expect(time.isNight(6 * MINUTE - 1)).toBe(false);
    expect(time.isNight(6 * MINUTE)).toBe(true);
    expect(time.isNight(9 * MINUTE)).toBe(false);
  });

  it('counts days from 1, each starting at dawn', () => {
    const time = new TimeOfDay(TIME, TIME.dayStartHour);
    expect(time.day(0)).toBe(1);
    expect(time.day(9 * MINUTE - 1)).toBe(1);
    expect(time.day(9 * MINUTE)).toBe(2);
  });

  it('dims the sun smoothly at dusk and brightens it at dawn, to moonlight at night', () => {
    const time = new TimeOfDay(TIME, TIME.dayStartHour);
    expect(time.daylight(3 * MINUTE)).toBe(1);
    expect(time.daylight(7 * MINUTE)).toBe(TIME.nightLight);
    let previous = time.daylight(0);
    let biggestStep = 0;
    for (let tick = 1; tick < time.cycleTicks; tick++) {
      const now = time.daylight(tick);
      biggestStep = Math.max(biggestStep, Math.abs(now - previous));
      previous = now;
    }
    // A change no bigger than a fraction of a percent per tick: no visible jumps.
    expect(biggestStep).toBeLessThan(0.005);
    expect(time.phase(10)).toBe('dawn');
    expect(time.phase(2 * MINUTE)).toBe('day');
    expect(time.phase(6 * MINUTE - 10)).toBe('dusk');
    expect(time.phase(7 * MINUTE)).toBe('night');
  });

  it('keeps a 24-hour clock: dawn at 5:00, nightfall at 21:00, and starts a world at 8:00', () => {
    const time = new TimeOfDay(TIME);
    expect(time.clock(0)).toEqual({ hour: 8, minute: 0 });
    expect(time.clock(time.ticksUntilNight(0))).toEqual({ hour: 21, minute: 0 });
    const dawn = time.ticksUntilNight(0) + TIME.nightTicks;
    expect(time.clock(dawn)).toEqual({ hour: 5, minute: 0 });
    expect(time.day(dawn)).toBe(2);
    // Midnight comes three hours into the eight-hour night.
    expect(time.clock(time.ticksUntilNight(0) + (3 / 8) * TIME.nightTicks)).toEqual({ hour: 0, minute: 0 });
  });

  it('can start at any hour, and skip ahead to nightfall', () => {
    const late = new TimeOfDay(TIME, 22);
    expect(late.isNight(0)).toBe(true);
    expect(late.day(0)).toBe(1);
    const time = new TimeOfDay(TIME);
    time.skipToNight(100);
    expect(time.isNight(100)).toBe(true);
    expect(time.clock(100)).toEqual({ hour: 21, minute: 0 });
    expect(time.day(100)).toBe(1);
  });

  it('rejects settings that make no sense', () => {
    expect(() => parseTimeSettings({ ...rawTime(), dayStartHour: 22, nightStartHour: 20 })).toThrow('nightStartHour must come after dayStartHour');
    expect(() => parseTimeSettings({ ...rawTime(), transitionSeconds: 1000 })).toThrow('transitionSeconds must be at most half the day');
  });
});

function rawTime(): Record<string, number> {
  return { dayMinutes: 6, nightMinutes: 3, transitionSeconds: 30, nightLight: 0.2, dayStartHour: 5, nightStartHour: 21, startHour: 8 };
}
