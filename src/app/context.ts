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
import type { DebugStats, HoverInfo } from '../ui/state';

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
}

let current: GameContext | null = null;

export function provideGameContext(context: GameContext): void {
  current = context;
}

export function gameContext(): GameContext {
  if (!current) throw new Error('Game context used before the app provided it');
  return current;
}
