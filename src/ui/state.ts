/**
 * Everything the HTML UI displays, in one observable store. The app and the scenes write
 * here; Preact components subscribe with `useStore`. The UI never reads game objects
 * directly, which keeps it decoupled from Phaser and from the simulation's internals.
 */
import type { TimeState } from '../core/TimeControl';
import { Store } from '../core/Store';

export type Screen = 'boot' | 'title' | 'game' | 'fatal';

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
  /** null until storage has been probed; false means settings and saves won't persist. */
  storagePersistent: boolean | null;
  storageWarningDismissed: boolean;
  menuOpen: boolean;
  settingsOpen: boolean;
  debugOpen: boolean;
  time: TimeState | null;
  debug: DebugStats | null;
  toasts: readonly Toast[];
}

export const uiState = new Store<UiState>({
  screen: 'boot',
  fatalMessage: '',
  storagePersistent: null,
  storageWarningDismissed: false,
  menuOpen: false,
  settingsOpen: false,
  debugOpen: false,
  time: null,
  debug: null,
  toasts: [],
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
