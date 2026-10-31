/**
 * What Phaser scenes need from the rest of the app. Scenes are constructed by Phaser, so
 * they can't take constructor arguments; instead the app provides this context once at
 * startup and scenes read it with `gameContext()`.
 */
import type { Settings } from '../core/settings';
import type { Store } from '../core/Store';
import type { InputActions } from '../platform/InputActions';
import type { AudioService } from '../render/AudioService';
import type { GameSession } from '../sim/GameSession';
import type { DebugStats } from '../ui/state';

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
