/**
 * The UI's view of the app: everything a button can ask for. The app implements this
 * interface; components get it from context. This keeps Preact components free of
 * Phaser and of the simulation, and makes the UI's capabilities easy to see in one place.
 */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { GameSpeed } from '../config';
import type { Settings } from '../core/settings';
import type { Store } from '../core/Store';

export type UiSound = 'uiClick' | 'uiOpen' | 'uiClose';

/** What the New world dialog asks for. */
export interface NewWorldChoice {
  seed: string;
  biome: string;
  /** Lift the fog of war over the whole map (from ?reveal=1, for testing). */
  reveal: boolean;
}

export interface UiCommands {
  /** Open the New world dialog. */
  newGame(): void;
  closeNewWorld(): void;
  /** Generate a world and start playing in it. */
  createWorld(choice: NewWorldChoice): void;
  quitToTitle(): void;
  togglePause(): void;
  setSpeed(speed: GameSpeed): void;
  openMenu(): void;
  closeMenu(): void;
  openSettings(): void;
  closeSettings(): void;
  toggleDebug(): void;
  dismissStorageWarning(): void;
  updateSettings(patch: Partial<Settings>): void;
  resetSettings(): void;
  /** Stop game keys from acting, e.g. while Settings waits for a new key binding. */
  setGameInputEnabled(enabled: boolean): void;
  playSound(sound: UiSound): void;
  /** Minimap clicks: move the camera to a tile. */
  centerCameraOn(tileX: number, tileY: number): void;
  /** The minimap's canvas, when it is shown (null when hidden). */
  attachMinimap(canvas: HTMLCanvasElement | null): void;
  toggleMinimap(): void;
}

export const CommandsContext = createContext<UiCommands | null>(null);
export const SettingsContext = createContext<Store<Settings> | null>(null);

export function useCommands(): UiCommands {
  const commands = useContext(CommandsContext);
  if (!commands) throw new Error('UI rendered without CommandsContext');
  return commands;
}

export function useSettingsStore(): Store<Settings> {
  const store = useContext(SettingsContext);
  if (!store) throw new Error('UI rendered without SettingsContext');
  return store;
}
