/**
 * Day and night (src/data/time.json): the clock, the day count, and how bright the sun is.
 *
 * One in-game day is a stretch of daylight followed by a night: about 6 and 3 minutes of
 * real time at 1x. Sunlight fades out over the last part of the day (dusk) and back in
 * over the first part (dawn), so lighting and the screen tint change smoothly; at night
 * the sun gives `nightLight` of its daytime brightness (moonlight).
 *
 * The 24-hour clock runs from `dayStartHour` (dawn) to `nightStartHour` (nightfall) over
 * the daylight, and on to the next dawn over the night, so the hours stay sensible
 * whatever the lengths are set to.
 *
 * Everything is worked out from the simulation tick, so it's deterministic and saving
 * the tick saves the time of day. Pure: no Phaser and no DOM.
 */
import { TICKS_PER_SECOND } from '../../config';
import { Validator } from '../../core/validate';

export interface TimeSettings {
  /** Ticks of daylight, from dawn to nightfall. */
  dayTicks: number;
  /** Ticks of night. */
  nightTicks: number;
  /** Ticks over which the light fades at dusk, and comes back at dawn. */
  transitionTicks: number;
  /** How bright the sun is at night, as a fraction of daylight (0 to 1). */
  nightLight: number;
  dayStartHour: number;
  nightStartHour: number;
  /** The hour a new world starts at. */
  startHour: number;
}

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export function parseTimeSettings(data: unknown): TimeSettings {
  const v = new Validator('time.json');
  const o = v.object(data, '');
  const minutes = (key: string): number => Math.round(v.number(o?.[key], key, 0.1, 600) * 60 * TICKS_PER_SECOND);
  const settings: TimeSettings = {
    dayTicks: minutes('dayMinutes'),
    nightTicks: minutes('nightMinutes'),
    transitionTicks: Math.round(v.number(o?.transitionSeconds, 'transitionSeconds', 0, 3600) * TICKS_PER_SECOND),
    nightLight: v.number(o?.nightLight, 'nightLight', 0, 1),
    dayStartHour: v.number(o?.dayStartHour, 'dayStartHour', 0, 23),
    nightStartHour: v.number(o?.nightStartHour, 'nightStartHour', 1, 24),
    startHour: v.number(o?.startHour, 'startHour', 0, 23.99),
  };
  if (settings.nightStartHour <= settings.dayStartHour) v.problem('nightStartHour must come after dayStartHour');
  if (settings.transitionTicks * 2 > settings.dayTicks) v.problem('transitionSeconds must be at most half the day');
  v.throwIfProblems();
  return settings;
}

/** t*t*(3-2t): eases in and out between 0 and 1. */
function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export class TimeOfDay {
  readonly settings: TimeSettings;
  /** Ticks from the dawn of day 1 to simulation tick 0; changed by `skipTo`. */
  private offset: number;

  /** `startHour` overrides the settings' starting hour (from the page address, for testing). */
  constructor(settings: TimeSettings, startHour = settings.startHour) {
    this.settings = settings;
    this.offset = this.ticksIntoDay(startHour);
  }

  get cycleTicks(): number {
    return this.settings.dayTicks + this.settings.nightTicks;
  }

  /** The day number, from 1. A day begins at dawn. */
  day(tick: number): number {
    return Math.floor((tick + this.offset) / this.cycleTicks) + 1;
  }

  /** Ticks since this day's dawn. */
  timeInDay(tick: number): number {
    const t = (tick + this.offset) % this.cycleTicks;
    return t < 0 ? t + this.cycleTicks : t;
  }

  isNight(tick: number): boolean {
    return this.timeInDay(tick) >= this.settings.dayTicks;
  }

  phase(tick: number): DayPhase {
    const { dayTicks, transitionTicks } = this.settings;
    const t = this.timeInDay(tick);
    if (t >= dayTicks) return 'night';
    if (t < transitionTicks) return 'dawn';
    if (t >= dayTicks - transitionTicks) return 'dusk';
    return 'day';
  }

  /** How strong sunlight is, from `nightLight` at night to 1 in full day, easing through dawn and dusk. */
  daylight(tick: number): number {
    const { dayTicks, transitionTicks, nightLight } = this.settings;
    const t = this.timeInDay(tick);
    if (t >= dayTicks) return nightLight;
    let sun = 1;
    if (transitionTicks > 0 && t < transitionTicks) sun = smooth(t / transitionTicks);
    else if (transitionTicks > 0 && t >= dayTicks - transitionTicks) sun = 1 - smooth((t - (dayTicks - transitionTicks)) / transitionTicks);
    return nightLight + (1 - nightLight) * sun;
  }

  /** The time on a 24-hour clock, as fractional hours (0 to 24). */
  hourOfDay(tick: number): number {
    const { dayTicks, nightTicks, dayStartHour, nightStartHour } = this.settings;
    const t = this.timeInDay(tick);
    const hours =
      t < dayTicks
        ? dayStartHour + ((nightStartHour - dayStartHour) * t) / dayTicks
        : nightStartHour + ((24 - nightStartHour + dayStartHour) * (t - dayTicks)) / nightTicks;
    return hours % 24;
  }

  /** Hours and minutes on a 24-hour clock. */
  clock(tick: number): { hour: number; minute: number } {
    const hours = this.hourOfDay(tick);
    const hour = Math.floor(hours);
    return { hour, minute: Math.min(59, Math.floor((hours - hour) * 60)) };
  }

  /** Ticks until the next nightfall (0 at nightfall itself; during the night, the next one). */
  ticksUntilNight(tick: number): number {
    const t = this.timeInDay(tick);
    const { dayTicks } = this.settings;
    return t < dayTicks ? dayTicks - t : this.cycleTicks - t + dayTicks;
  }

  /** Move the clock forward so that `tick` falls at the start of the next night (debug). */
  skipToNight(tick: number): void {
    if (this.isNight(tick)) return;
    this.offset += this.ticksUntilNight(tick);
  }

  /** Ticks after dawn at which the clock shows `hour`. */
  private ticksIntoDay(hour: number): number {
    const { dayTicks, nightTicks, dayStartHour, nightStartHour } = this.settings;
    const h = (((hour - dayStartHour) % 24) + 24) % 24; // hours since dawn
    const daylightHours = nightStartHour - dayStartHour;
    if (h < daylightHours) return Math.round((h / daylightHours) * dayTicks);
    return Math.round(dayTicks + ((h - daylightHours) / (24 - daylightHours)) * nightTicks);
  }
}
