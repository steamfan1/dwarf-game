/**
 * What Phaser scenes need from the rest of the app. Scenes are constructed by Phaser, so
 * they can't take constructor arguments; instead the app provides this context once at
 * startup and scenes read it with `gameContext()`.
 */
import type { Settings } from '../core/settings';
import type { Store } from '../core/Store';
import type { InputActions } from '../platform/InputActions';
import type { AudioService } from '../render/AudioService';
import type { TileViewRect } from '../render/Minimap';
import type { GameSession } from '../sim/GameSession';
import type { Priority } from '../sim/jobs/JobBoard';
import type { CellRect } from '../sim/world/World';
import type { DebugStats, HoverInfo, Tool } from '../ui/state';

/** Controls the game scene offers back to the app once the world is on screen. */
export interface GameView {
  /** Centre the camera on a tile (used by minimap clicks). */
  centerOnTile(x: number, y: number): void;
}

export interface GameContext {
  readonly input: InputActions;
  readonly settings: Store<Settings>;
  /** The running world, or null on the title screen. */
  readonly session: GameSession | null;
  readonly audio: AudioService | null;
  /** devicePixelRatio the canvas renders at. */
  readonly dpr: number;
  /** True while the debug overlay is open, so scenes only gather stats when they're shown. */
  readonly debugVisible: boolean;
  /** Called by the boot scene once textures and sounds exist. */
  bootComplete(): void;
  /** Called by the game scene once the world is built and visible. */
  worldReady(view: GameView): void;
  /** The camera's view in tiles, every frame (for the minimap). */
  reportView(view: TileViewRect): void;
  /** What's under the pointer changed (null when the pointer left the world). */
  reportHover(hover: HoverInfo | null): void;
  /** Called a few times a second by the game scene while the debug overlay is open. */
  reportDebugStats(stats: DebugStats): void;
  /** Called a few times a second: refresh the dwarf roster and the stored resources. */
  reportColony(): void;

  /** The toolbar's current tool and priority. */
  readonly tool: Tool;
  readonly priority: Priority;
  /** The item the current build tool builds with (an item number), or null for other tools. */
  readonly buildItem: number | null;
  /** Use the current tool on a rectangle of cells (a click is a 1 x 1 rectangle). */
  applyTool(rect: CellRect): void;
  /** Right-click: put the current tool down (back to selecting). */
  dropTool(): void;
  readonly selectedDwarf: number | null;
  selectDwarf(id: number | null): void;
  /** Auto tool on an animal: mark it for hunting, or call the hunt off. */
  toggleHunt(creatureId: number): void;
  /** Auto tool on a fallen dwarf: mark it for revival, or call that off. */
  toggleRevive(dwarfId: number): void;
  /** Debug overlay option: show light levels instead of the fog of war. */
  readonly debugLight: boolean;
}

let current: GameContext | null = null;

export function provideGameContext(context: GameContext): void {
  current = context;
}

export function gameContext(): GameContext {
  if (!current) throw new Error('Game context used before the app provided it');
  return current;
}
