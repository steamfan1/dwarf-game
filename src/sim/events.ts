/**
 * Every cross-system message in the game and its payload. Systems emit these on the
 * session's EventBus; renderers, the HTML UI, audio and other systems subscribe.
 *
 * Later milestones add ItemCrafted, NightStarted, WaveIncoming and so on here, so this
 * file doubles as a catalogue of what can happen.
 */
import type { TimeState } from '../core/TimeControl';
import type { Skill } from './dwarves/Dwarf';
import type { JobType } from './jobs/JobBoard';
import type { CellRect } from './world/World';

export type GameEvents = {
  /** Speed or pause state changed (player input, menu, tab visibility, debug console). */
  TimeChanged: TimeState;
  /** Something in one cell changed (block, wall or liquid). Renderers redraw it and its neighbours. */
  TileChanged: { x: number; y: number };
  /** Cells in this rectangle were newly explored (fog of war lifted). */
  ExploredChanged: CellRect;
  /** A dig or chop mark appeared, changed (priority, blocked) or went away in this cell. */
  DesignationChanged: { x: number; y: number };
  /** A job can't be reached by any dwarf. */
  JobBlocked: { type: JobType; x: number; y: number };
  /** A dwarf finished digging a block. */
  BlockDug: { x: number; y: number; dwarf: number };
  /** A dwarf felled a tree. */
  TreeFelled: { x: number; y: number; dwarf: number };
  /** Something was put away or taken out of storage. */
  StorageChanged: void;
  /** A dwarf's skill went up a level. */
  SkillUp: { dwarf: number; name: string; skill: Skill; level: number };
  DwarfDied: { dwarf: number; name: string; cause: 'fall' | 'lava' };
};
