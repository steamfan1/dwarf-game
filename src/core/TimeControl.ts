/**
 * Game speed and pausing.
 *
 * Several things can pause the game at once (the player, the in-game menu, the tab
 * being hidden), so pausing is tracked as a set of reasons: the game runs only when
 * there are none. The simulation itself never sees any of this; it is simply stepped
 * fewer or more times per second.
 */
import { GAME_SPEEDS, type GameSpeed } from '../config';

export type PauseReason = 'player' | 'menu' | 'hidden';

export interface TimeState {
  readonly speed: GameSpeed;
  readonly paused: boolean;
  readonly reasons: readonly PauseReason[];
  /** Extra multiplier from the debug console (`debug.setSpeed(x)`); 1 in normal play. */
  readonly debugMultiplier: number;
}

export class TimeControl {
  private currentSpeed: GameSpeed = 1;
  private multiplier = 1;
  private readonly reasons = new Set<PauseReason>();
  private readonly listeners = new Set<(state: TimeState) => void>();

  get speed(): GameSpeed {
    return this.currentSpeed;
  }

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  /** Simulated seconds per real second: 0 while paused. */
  get effectiveSpeed(): number {
    return this.paused ? 0 : this.currentSpeed * this.multiplier;
  }

  state(): TimeState {
    return {
      speed: this.currentSpeed,
      paused: this.paused,
      reasons: [...this.reasons],
      debugMultiplier: this.multiplier,
    };
  }

  onChange(listener: (state: TimeState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  pause(reason: PauseReason): void {
    if (this.reasons.has(reason)) return;
    this.reasons.add(reason);
    this.notify();
  }

  resume(reason: PauseReason): void {
    if (this.reasons.delete(reason)) this.notify();
  }

  /**
   * The Space key / pause button. While the menu is open it does nothing (the menu owns
   * the pause); otherwise it pauses, or resumes from a player or background pause.
   */
  togglePause(): void {
    if (this.reasons.has('menu')) return;
    if (this.reasons.has('player') || this.reasons.has('hidden')) {
      this.reasons.delete('player');
      this.reasons.delete('hidden');
    } else {
      this.reasons.add('player');
    }
    this.notify();
  }

  /** Picking a speed also means "go": it clears player and background pauses. */
  setSpeed(speed: GameSpeed): void {
    if (!GAME_SPEEDS.includes(speed)) throw new Error(`Unsupported speed ${speed}`);
    const changed = speed !== this.currentSpeed || this.reasons.has('player') || this.reasons.has('hidden');
    this.currentSpeed = speed;
    this.reasons.delete('player');
    this.reasons.delete('hidden');
    if (changed) this.notify();
  }

  /** Debug-only time scale on top of the normal speed (0.1x .. 20x). */
  setDebugMultiplier(multiplier: number): void {
    const next = Number.isFinite(multiplier) ? Math.min(20, Math.max(0.1, multiplier)) : 1;
    if (next === this.multiplier) return;
    this.multiplier = next;
    this.notify();
  }

  /**
   * Tab visibility. Hiding the tab pauses the game; when the tab comes back, the game
   * stays paused (as a player pause) so nothing happens until the player is ready.
   * Returns true when that hand-over happened, so the caller can tell the player why
   * the game is paused.
   */
  setHidden(hidden: boolean): boolean {
    if (hidden) {
      if (!this.reasons.has('player')) this.pause('hidden');
      return false;
    }
    if (!this.reasons.has('hidden')) return false;
    this.reasons.delete('hidden');
    this.reasons.add('player');
    this.notify();
    return true;
  }

  private notify(): void {
    const snapshot = this.state();
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}
