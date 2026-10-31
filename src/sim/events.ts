/**
 * Every cross-system message in the game and its payload. Systems emit these on the
 * session's EventBus; renderers, the HTML UI, audio and other systems subscribe.
 *
 * Later milestones add TileChanged, ItemDropped, ItemCrafted, JobBlocked, NightStarted,
 * WaveIncoming and so on here, so this file doubles as a catalogue of what can happen.
 */
import type { TimeState } from '../core/TimeControl';

export type GameEvents = {
  /** Speed or pause state changed (player input, menu, tab visibility, debug console). */
  TimeChanged: TimeState;
};
