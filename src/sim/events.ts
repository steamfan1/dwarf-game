/**
 * Every cross-system message in the game and its payload. Systems emit these on the
 * session's EventBus; renderers, the HTML UI, audio and other systems subscribe.
 *
 * Later milestones add their events here too, so this file doubles as a catalogue of
 * what can happen.
 */
import type { TimeState } from '../core/TimeControl';
import type { CreatureOrigin } from './creatures/Creature';
import type { Skill } from './dwarves/Dwarf';
import type { ProjectileKind } from './items/ItemRegistry';
import type { JobType } from './jobs/JobBoard';
import type { CellRect } from './world/World';

export type DeathCause = 'fall' | 'lava' | 'starvation' | 'monster';

export type GameEvents = {
  /** Speed or pause state changed (player input, menu, tab visibility, debug console). */
  TimeChanged: TimeState;
  /** Something in one cell changed (block, wall or liquid). Renderers redraw it and its neighbours. */
  TileChanged: { x: number; y: number };
  /** Light levels changed inside this rectangle (a block dug or built, a torch set down). */
  LightChanged: CellRect;
  /** The sun came up: day `day` begins. */
  DayStarted: { day: number };
  /** Night fell on day `day`. */
  NightStarted: { day: number };
  /** Rooms were found again after the blocks, walls, doors or furniture changed. */
  RoomsChanged: void;
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
  /** A dwarf picked a plant (berries, mushrooms). */
  Harvested: { x: number; y: number; dwarf: number };
  /** A dwarf finished building a block, a wall or a piece of furniture. */
  BlockBuilt: { x: number; y: number; dwarf: number };
  /** A piece of furniture was set down (placed) or taken away. */
  FurnitureChanged: { id: number; placed: boolean };
  /** A dwarf finished a craft. */
  ItemCrafted: { item: number; count: number; dwarf: number; name: string };
  /** Every craft of an order is done: `count` items made in all. */
  CraftOrderDone: { item: number; count: number };
  /** A dwarf put on better gear from storage. */
  Equipped: { dwarf: number; name: string; item: number };
  /** Something was put away in storage. */
  StorageChanged: void;
  /** Items are waiting to be stored, but storage has no room (build chests). */
  StorageFull: void;
  /** A dwarf's skill went up a level. */
  SkillUp: { dwarf: number; name: string; skill: Skill; level: number };
  /** `by`: the creature that killed it, by name, if one did. `revivable`: a revival draught can bring it back. */
  DwarfDied: { dwarf: number; name: string; cause: DeathCause; by: string | null; revivable: boolean };
  /** A dwarf was brought back to life by `by`. */
  DwarfRevived: { dwarf: number; name: string; by: number };
  /** Every dwarf is dead. */
  ColonyLost: void;
  /** A creature struck a dwarf. */
  DwarfHurt: { dwarf: number; amount: number; x: number; y: number };
  /** A badly hurt dwarf broke off a fight and is falling back to the Hearth. */
  DwarfRetreating: { dwarf: number; name: string };
  CreatureSpawned: { id: number; kind: number; x: number; y: number; origin: CreatureOrigin };
  CreatureHurt: { id: number; amount: number; x: number; y: number };
  /** `by`: the dwarf that finished it off (0: a trap, a turret, lava). */
  CreatureDied: { id: number; kind: number; x: number; y: number; by: number };
  /** A creature of the night slunk away at dawn (or an invader went back through the portal). */
  CreatureLeft: { id: number; x: number; y: number };
  /** A bolt or a glob of bile was shot from (x, y), by the colony or by a monster. */
  ProjectileFired: { kind: ProjectileKind; x: number; y: number; colony: boolean };
  ProjectileHit: { kind: ProjectileKind; x: number; y: number };
  /** A monster struck a door or block (cracks show how close it is to breaking). */
  TileDamaged: { x: number; y: number };
  /** A monster broke a door or block. */
  TileBroken: { x: number; y: number };
  /** A trap struck a creature. */
  TrapSprung: { x: number; y: number };
  /** The first monster of the night has come out near the colony. */
  NightThreat: { day: number };
  /** An invasion is coming: a portal opens at (x, y) at nightfall, `ticks` from now. */
  WaveWarning: { day: number; x: number; y: number; ticks: number };
  /** The portal opened: `size` invaders are coming through. */
  WaveStarted: { day: number; x: number; y: number; size: number };
  /** The invasion is over: every invader died (`defeated`), or dawn drove the rest back. */
  WaveEnded: { day: number; defeated: boolean };
  /** A dwarf has nothing left to eat and is losing health. */
  DwarfStarving: { dwarf: number; name: string };
  /** A dwarf ran out of energy and fell asleep where it stood. */
  DwarfCollapsed: { dwarf: number; name: string };
  /** An item was made for the first time: `points` research towards the tier in progress. */
  ResearchGained: { item: number; points: number; total: number; needed: number; tier: number };
  /** A new tier of the tech tree was reached: its recipes unlock, and `dwarves` new dwarves come. */
  TierReached: { tier: number; name: string; dwarves: number };
  /** A new dwarf came to join the colony (a tier of the tech tree brought it). */
  DwarfArrived: { dwarf: number; name: string };
  /** A crop ripened in a farm plot. */
  CropRipe: { x: number; y: number; crop: number };
  /** The World Gate is built: this world is won. */
  WorldWon: { day: number };
};
