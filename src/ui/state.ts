/**
 * Everything the HTML UI displays, in one observable store. The app and the scenes write
 * here; Preact components subscribe with `useStore`. The UI never reads game objects
 * directly, which keeps it decoupled from Phaser and from the simulation's internals.
 */
import type { TimeState } from '../core/TimeControl';
import { Store } from '../core/Store';
import type { EquipmentSlot, Skill } from '../sim/dwarves/Dwarf';
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
}

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
export type Tool = 'auto' | 'select' | 'dig' | 'chop' | 'build' | 'wall' | 'furniture' | 'cancel' | 'priority';

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
}

export type LoadingStage = WorldGenStage | 'building';

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
  newWorld: { seed: string; biome: string; reveal: boolean } | null;
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
  selectedDwarf: number | null;
  colony: ColonyView | null;
  catalogue: Catalogue | null;
}

export const uiState = new Store<UiState>({
  screen: 'boot',
  fatalMessage: '',
  loading: null,
  newWorld: null,
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
  selectedDwarf: null,
  colony: null,
  catalogue: null,
});

let nextToastId = 1;

/** Show a short notification; it disappears after `durationMs`. */
export function pushToast(text: string, kind: ToastKind = 'info', durationMs = 5000): void {
  const toast: Toast = { id: nextToastId++, text, kind };
  uiState.update((s) => ({ toasts: [...s.toasts, toast].slice(-4) }));
  setTimeout(() => dismissToast(toast.id), durationMs);
}

export function dismissToast(id: number): void {
  uiState.update((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
