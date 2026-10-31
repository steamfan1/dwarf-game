/**
 * Every cross-system message in the game and its payload. Systems emit these on the
 * session's EventBus; renderers, the HTML UI, audio and other systems subscribe.
 *
 * Later milestones add ItemDropped, ItemCrafted, JobBlocked, NightStarted,
 * WaveIncoming and so on here, so this file doubles as a catalogue of what can happen.
 */
import type { TimeState } from '../core/TimeControl';
import type { CellRect } from './world/World';

export type GameEvents = {
  /** Speed or pause state changed (player input, menu, tab visibility, debug console). */
  TimeChanged: TimeState;
  /** Something in one cell changed (block, wall or liquid). Renderers redraw it and its neighbours. */
  TileChanged: { x: number; y: number };
  /** Cells in this rectangle were newly explored (fog of war lifted). */
  ExploredChanged: CellRect;
};
