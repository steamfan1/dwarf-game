/**
 * Everything the HTML UI displays, in one observable store. The app and the scenes write
 * here; Preact components subscribe with `useStore`. The UI never reads game objects
 * directly, which keeps it decoupled from Phaser and from the simulation's internals.
 */
import type { TimeState } from '../core/TimeControl';
import { Store } from '../core/Store';
import type { EquipmentSlot, Skill, Traveller } from '../sim/dwarves/Dwarf';
import type { JobType, Priority } from '../sim/jobs/JobBoard';
import type { CraftStatus } from '../sim/Simulation';
import type { WorldGenStage } from '../sim/worldgen/generateWorld';

export type Screen = 'boot' | 'title' | 'loading' | 'game' | 'fatal';

export interface DebugStats {
  fps: number;
  frameMs: number;
  tickCostMs: number;
  tick: number;
  ticksPerSecond: number;
  droppedMs: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  zoom: number;
  /** Tile at the centre of the view. */
  cameraTile: { x: number; y: number };
  /** Tile under the pointer, if any. */
  cursorTile: { x: number; y: number } | null;
  chunksDrawn: number;
  /** Chunk layer pairs created so far (drawn + waiting in the pool). */
  chunkLayers: number;
  /** Jobs on the board, by type, and how many are blocked. */
  jobs: Record<JobType, number> & { blocked: number };
  /** Path searches run, answered from the cache, and deferred to a later tick, since the world began. */
  paths: { searches: number; cacheHits: number; busy: number; cached: number };
  /** Cells dwarves can reach from the Hearth, and walk home from. */
  homeCells: { fromHome: number; toHome: number };
  /** Rooms found, and the sun's strength now (0..1). */
  rooms: number;
  daylight: number;
  /** Creatures alive, and missiles in flight. */
  creatures: { hostile: number; animals: number; missiles: number };
  /** Night monsters out so far tonight and how many may come, and the day of the next invasion. */
  threat: { spawned: number; budget: number; waveDay: number };
}

/** An invasion, for the top bar: coming (seconds of game time to go), or under way (invaders left). */
export type ThreatView = { phase: 'warning'; seconds: number; side: 'east' | 'west' } | { phase: 'open'; left: number; side: 'east' | 'west' } | null;

/** The time of day, for the top bar. */
export interface ClockView {
  day: number;
  hour: number;
  minute: number;
  night: boolean;
}

/** A need a dwarf is short of, worst first: shown as a warning beside its name. */
export type NeedWarning = 'starving' | 'hungry' | 'exhausted' | 'tired' | 'wounded';

/** What a click with the current tool would do to the cell under the pointer. */
export type HoverAction = 'ok' | 'blocked' | 'none';

/** What's under the pointer, shown in the HUD. */
export interface HoverInfo {
  title: string;
  detail: string;
  /** Colours the tile cursor: green if the current tool can act here, red if it can't. */
  action: HoverAction;
}

/**
 * The left toolbar's tools. Auto, Dig and Fell trees mark work (Auto picks digging,
 * felling or taking furniture apart for whatever is clicked); Build, Walls and Furniture
 * plan things to build, from the material picked in their palette. Dwarves do all of it.
 */
export type Tool = 'auto' | 'select' | 'dig' | 'chop' | 'farm' | 'build' | 'wall' | 'furniture' | 'cancel' | 'priority';

/** The tools that plan building, each from a material picked in its palette. */
export type BuildTool = 'build' | 'wall' | 'furniture';
export const BUILD_TOOLS: readonly BuildTool[] = ['build', 'wall', 'furniture'];

export function isBuildTool(tool: Tool): tool is BuildTool {
  return tool === 'build' || tool === 'wall' || tool === 'furniture';
}

/** The tool in hand when a world starts, and after a tool is put down. */
export const DEFAULT_TOOL: Tool = 'auto';

export interface SkillSummary {
  skill: Skill;
  level: number;
  /** Progress towards the next level, 0 to 1 (1 at the top level). */
  progress: number;
}

/** A dwarf as the roster and the dwarf panel show it. */
export interface DwarfSummary {
  id: number;
  name: string;
  /** What it is doing, in words. */
  activity: string;
  health: number;
  maxHealth: number;
  hunger: number;
  energy: number;
  skills: SkillSummary[];
  equipment: Array<{ slot: EquipmentSlot; item: string | null; icon: string | null }>;
  /** What it has in its arms (nothing: empty). */
  carrying: Array<{ name: string; count: number; icon: string }>;
  /** Needs running short. */
  needs: NeedWarning[];
  /** What it fights with, how hard it hits, and the armour it wears. */
  combat: { weapon: string | null; damage: number; armor: number };
  dead: boolean;
  /** Can't walk back to the Hearth from where it is. */
  stranded: boolean;
  tunic: string;
}

/** One stored item for the top bar. */
export interface ResourceEntry {
  id: string;
  name: string;
  count: number;
  /** Data URL of the item's icon. */
  icon: string;
}

/** A crafting order as the crafting panel shows it. */
export interface CraftOrderView {
  id: number;
  /** The recipe's id (recipes.json). */
  recipe: string;
  /** What it makes. */
  name: string;
  icon: string;
  outputCount: number;
  made: number;
  count: number;
  status: CraftStatus;
  /** The station it needs, by name, or null for by hand. */
  station: string | null;
  /** How far along the craft being worked on is, 0 to 1, or null if none is. */
  progress: number | null;
}

export interface ColonyView {
  dwarves: DwarfSummary[];
  resources: ResourceEntry[];
  /** Storage room in use and in all, in stacks. */
  storage: { used: number; capacity: number };
  orders: CraftOrderView[];
  /** Crafting stations built, by station kind. */
  stations: Record<string, number>;
}

/** An item as palettes and recipes show it. */
export interface CatalogueItem {
  id: string;
  name: string;
  icon: string;
}

export interface RecipeView {
  id: string;
  /** The tech tier that unlocks it (0 is the first). */
  tier: number;
  /** Research its first craft earns. */
  research: number;
  output: CatalogueItem & { count: number };
  inputs: Array<CatalogueItem & { count: number }>;
  /** Station kind (workbench, furnace...), or null for by hand. */
  station: string | null;
  /** Seconds a beginner takes over it. */
  seconds: number;
}

/** What can be built and crafted, from the content files; set when a world starts. */
export interface Catalogue {
  /** The Build tool's palette: blocks, ladders, doors. */
  blocks: CatalogueItem[];
  /** The Walls tool's palette: wall materials. */
  walls: CatalogueItem[];
  /** The Furniture tool's palette. */
  furniture: CatalogueItem[];
  recipes: RecipeView[];
  /** Crafting stations, in the order the crafting panel lists them, with their names. */
  stations: Array<{ id: string; name: string }>;
  /** The Farm tool's palette: each crop, with the seeds it's grown from. */
  crops: Array<{ id: string; name: string; seed: CatalogueItem }>;
  /** The tech tree's tiers, first to last. */
  tiers: Array<{ name: string; description: string; research: number; dwarves: number; recipes: string[] }>;
}

/** Where the colony stands in the tech tree. */
export interface ResearchView {
  /** The tier reached (0 is the first). */
  tier: number;
  points: number;
  /** Research the current tier needs (0 once the last is reached). */
  needed: number;
  /** Items made at least once (items.json ids). */
  crafted: string[];
}

/** The latest save in this browser, for the title screen's Continue button. */
export interface SaveSummary {
  day: number;
  dwarves: number;
  seed: string;
  biome: string;
  savedAt: number;
}

/** A dwarf who could step through the World Gate. */
export interface TravellerChoice {
  id: number;
  name: string;
  /** Its best skill and level. */
  skill: string;
  level: number;
}

/** The World Gate is built: the victory dialog. */
export interface WonView {
  day: number;
  /** A biome the win unlocked, by name (null if none was new). */
  unlocked: string | null;
  /** Living dwarves who could go, and how many may. */
  dwarves: TravellerChoice[];
  max: number;
}

export type LoadingStage = WorldGenStage | 'building' | 'loading';

/** What the New world dialog starts from. */
export interface NewWorldPreset {
  seed: string;
  biome: string;
  reveal: boolean;
  hour: number | null;
  /** A biome named in the page address: it can be picked even if the campaign hasn't opened it. */
  forcedBiome: string | null;
  /** Dwarves coming through the World Gate. */
  travellers: Traveller[];
}

export type ToastKind = 'info' | 'warning' | 'error';

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

export interface UiState {
  screen: Screen;
  /** Shown on the 'fatal' screen. */
  fatalMessage: string;
  loading: { stage: LoadingStage; progress: number } | null;
  /** Starting values for the New world dialog; the dialog is open while this is set. */
  newWorld: NewWorldPreset | null;
  /** Biomes the campaign has opened (each World Gate built opens the next). */
  unlockedBiomes: string[];
  /** The running world, for the menu. */
  world: { seed: string; biomeName: string } | null;
  /** null until storage has been probed; false means settings and saves won't persist. */
  storagePersistent: boolean | null;
  storageWarningDismissed: boolean;
  menuOpen: boolean;
  settingsOpen: boolean;
  debugOpen: boolean;
  minimapOpen: boolean;
  time: TimeState | null;
  hover: HoverInfo | null;
  debug: DebugStats | null;
  /** Debug overlay option: show light levels instead of the fog of war. */
  debugLight: boolean;
  toasts: readonly Toast[];
  tool: Tool;
  /** Priority given to new marks, and set by the Priority tool. */
  priority: Priority;
  /** The material each build tool builds with (an items.json id), or null before the first pick. */
  buildChoice: Record<BuildTool, string | null>;
  craftingOpen: boolean;
  storageOpen: boolean;
  techOpen: boolean;
  /** The crop the Farm tool plants (a crops.json id), or null before the first pick. */
  farmCrop: string | null;
  selectedDwarf: number | null;
  colony: ColonyView | null;
  catalogue: Catalogue | null;
  clock: ClockView | null;
  threat: ThreatView;
  /** Every dwarf has died: the "colony has fallen" dialog is up (until dismissed). */
  colonyLost: boolean;
  research: ResearchView | null;
  /** The World Gate was built: the victory dialog is up (until dismissed). */
  won: WonView | null;
  /** The latest save, if there is one (null: none, or not looked yet). */
  save: SaveSummary | null;
  /** A save or a load is under way. */
  saving: boolean;
}

export const uiState = new Store<UiState>({
  screen: 'boot',
  fatalMessage: '',
  loading: null,
  newWorld: null,
  unlockedBiomes: [],
  world: null,
  storagePersistent: null,
  storageWarningDismissed: false,
  menuOpen: false,
  settingsOpen: false,
  debugOpen: false,
  minimapOpen: true,
  time: null,
  hover: null,
  debug: null,
  debugLight: false,
  toasts: [],
  tool: DEFAULT_TOOL,
  priority: 2,
  buildChoice: { build: null, wall: null, furniture: null },
  craftingOpen: false,
  storageOpen: true,
  techOpen: false,
  farmCrop: null,
  selectedDwarf: null,
  colony: null,
  catalogue: null,
  clock: null,
  threat: null,
  colonyLost: false,
  research: null,
  won: null,
  save: null,
  saving: false,
});

let nextToastId = 1;

/** Show a short notification; it disappears after `durationMs`. */
export function pushToast(text: string, kind: ToastKind = 'info', durationMs = 5000): void {
  const toast: Toast = { id: nextToastId++, text, kind };
  uiState.update((s) => ({ toasts: [...s.toasts, toast].slice(-4) }));
  setTimeout(() => dismissToast(toast.id), durationMs);
}

/** Clear every notification (when a world ends: its news no longer matters). */
export function clearToasts(): void {
  uiState.set({ toasts: [] });
}

export function dismissToast(id: number): void {
  uiState.update((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
