/**
 * The application shell and composition root.
 *
 * Owns the long-lived pieces (settings, keyboard input, storage, the Phaser game, audio)
 * and the running GameSession, and implements:
 *   - UiCommands: what the HTML UI can ask for (new game, pause, settings...);
 *   - GameContext: what Phaser scenes need to read (session, input, pixel ratio...).
 * Nothing else wires systems together, so this file is the map of how the app fits.
 */
import type * as Phaser from 'phaser';
import type { GameSpeed } from '../config';
import { keyLabel, type Action } from '../core/actions';
import { DEFAULT_SETTINGS, parseSettings, sanitizeSettings, serializeSettings, type Settings } from '../core/settings';
import { Store } from '../core/Store';
import { t } from '../core/strings';
import { effectiveDpr } from '../core/viewport';
import { installDebugApi } from '../debug/debugApi';
import { installBrowserGuards } from '../platform/browserGuards';
import { InputActions } from '../platform/InputActions';
import { probeStorage, SafeKeyValueStore, storageIsPersistent } from '../platform/storage';
import { AudioService } from '../render/AudioService';
import { createGame } from '../render/createGame';
import { SceneKeys } from '../render/scenes/keys';
import { ViewportManager } from '../render/ViewportManager';
import { GameSession } from '../sim/GameSession';
import type { UiCommands, UiSound } from '../ui/commands';
import { pushToast, uiState, type DebugStats } from '../ui/state';
import { mountUi } from '../ui/UiRoot';
import { provideGameContext, type GameContext } from './context';

const SETTINGS_STORAGE_KEY = 'gatewright.settings';
const SETTINGS_SAVE_DELAY_MS = 300;

export interface AppElements {
  /** Wraps the canvas and the overlay. */
  root: HTMLElement;
  /** Phaser's canvas goes in here. */
  game: HTMLElement;
  /** The HTML/CSS overlay is rendered in here. */
  ui: HTMLElement;
}

export class App implements UiCommands, GameContext {
  readonly settings: Store<Settings>;
  readonly input: InputActions;
  session: GameSession | null = null;
  audio: AudioService | null = null;

  private readonly elements: AppElements;
  private readonly storage = new SafeKeyValueStore();
  private game: Phaser.Game | null = null;
  private viewport: ViewportManager | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionCleanup: Array<() => void> = [];

  constructor(elements: AppElements) {
    this.elements = elements;
    this.settings = new Store(parseSettings(this.storage.getItem(SETTINGS_STORAGE_KEY)));
    this.input = new InputActions(this.settings.get().bindings);
  }

  start(): void {
    installBrowserGuards({ app: this.elements.root, world: this.elements.game });
    this.installErrorReporting();
    this.wireSettings();
    this.wireInput();
    this.wireVisibility();
    provideGameContext(this);
    mountUi(this.elements.ui, { commands: this, settings: this.settings });

    void probeStorage().then((status) => {
      uiState.set({ storagePersistent: storageIsPersistent(status) && this.storage.persistent });
    });

    if (import.meta.env.DEV) installDebugApi(this);
    this.bootPhaser();
  }

  // ---- GameContext -----------------------------------------------------------------

  get dpr(): number {
    return this.viewport?.dpr ?? effectiveDpr(window.devicePixelRatio);
  }

  get debugVisible(): boolean {
    return uiState.get().debugOpen;
  }

  bootComplete(): void {
    uiState.set({ screen: 'title' });
  }

  reportDebugStats(stats: DebugStats): void {
    uiState.set({ debug: stats });
  }

  // ---- UiCommands --------------------------------------------------------------------

  newGame(): void {
    const game = this.game;
    if (!game) return;
    this.audio?.unlock();
    this.endSession();

    const session = new GameSession(randomSeed());
    this.session = session;
    this.sessionCleanup.push(session.bus.on('TimeChanged', (time) => uiState.set({ time })));
    uiState.set({ screen: 'game', menuOpen: false, settingsOpen: false, time: session.time.state(), debug: null });

    game.scene.stop(SceneKeys.title);
    game.scene.start(SceneKeys.game);
    this.audio?.play('gameStart');
  }

  quitToTitle(): void {
    const game = this.game;
    if (!game) return;
    game.scene.stop(SceneKeys.game);
    this.endSession();
    game.scene.start(SceneKeys.title);
    uiState.set({ screen: 'title', menuOpen: false, settingsOpen: false, time: null, debug: null });
  }

  togglePause(): void {
    this.session?.time.togglePause();
  }

  setSpeed(speed: GameSpeed): void {
    this.session?.time.setSpeed(speed);
  }

  openMenu(): void {
    if (!this.session) return;
    this.session.time.pause('menu');
    uiState.set({ menuOpen: true });
  }

  closeMenu(): void {
    this.session?.time.resume('menu');
    uiState.set({ menuOpen: false, settingsOpen: false });
  }

  openSettings(): void {
    uiState.set({ settingsOpen: true });
  }

  closeSettings(): void {
    uiState.set({ settingsOpen: false });
  }

  toggleDebug(): void {
    uiState.update((s) => ({ debugOpen: !s.debugOpen, debug: s.debugOpen ? null : s.debug }));
  }

  dismissStorageWarning(): void {
    uiState.set({ storageWarningDismissed: true });
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings.set(sanitizeSettings({ ...this.settings.get(), ...patch }));
  }

  resetSettings(): void {
    this.settings.set({ ...DEFAULT_SETTINGS });
  }

  setGameInputEnabled(enabled: boolean): void {
    this.input.setEnabled(enabled);
  }

  playSound(sound: UiSound): void {
    // Every UI click is a user gesture, so it's also a chance to unlock browser audio.
    this.audio?.unlock();
    this.audio?.play(sound);
  }

  // ---- Wiring --------------------------------------------------------------------------

  private bootPhaser(): void {
    if (!hasWebGl()) {
      this.showFatal(t('fatal.webgl'));
      return;
    }
    try {
      const size = ViewportManager.measure(this.elements.game);
      this.game = createGame(this.elements.game, size, (game) => {
        this.viewport = new ViewportManager(game, this.elements.game);
        this.audio = new AudioService(game, this.settings);
      });
    } catch (error) {
      this.showFatal(t('fatal.boot', { message: errorMessage(error) }));
    }
  }

  private wireSettings(): void {
    applyUiScale(this.settings.get().uiScale);
    this.settings.subscribe((next, previous) => {
      if (next.bindings !== previous.bindings) this.input.setBindings(next.bindings);
      if (next.uiScale !== previous.uiScale) applyUiScale(next.uiScale);
      this.scheduleSettingsSave();
    });
    // Don't lose a change made in the last few hundred milliseconds before closing the tab.
    window.addEventListener('pagehide', () => this.saveSettingsNow());
  }

  private scheduleSettingsSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveSettingsNow(), SETTINGS_SAVE_DELAY_MS);
  }

  private saveSettingsNow(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.storage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(this.settings.get()));
  }

  private wireInput(): void {
    this.input.setActiveFilter((action) => this.isActionActive(action));
    this.input.onPressed('pause', () => this.togglePause());
    this.input.onPressed('speed1', () => this.setSpeed(1));
    this.input.onPressed('speed2', () => this.setSpeed(2));
    this.input.onPressed('speed3', () => this.setSpeed(3));
    this.input.onPressed('toggleDebug', () => this.toggleDebug());
    this.input.onPressed('cancel', () => this.cancel());
    this.input.attach(window);
  }

  /** Game keys only act in the running game with no dialog open; Esc and ` work everywhere. */
  private isActionActive(action: Action): boolean {
    if (action === 'toggleDebug' || action === 'cancel') return true;
    const ui = uiState.get();
    return ui.screen === 'game' && !ui.menuOpen && !ui.settingsOpen;
  }

  /** Esc: close the topmost dialog, or open the in-game menu. */
  private cancel(): void {
    const ui = uiState.get();
    if (ui.settingsOpen) {
      this.playSound('uiClose');
      this.closeSettings();
    } else if (ui.screen === 'game' && ui.menuOpen) {
      this.playSound('uiClose');
      this.closeMenu();
    } else if (ui.screen === 'game') {
      this.playSound('uiOpen');
      this.openMenu();
    }
  }

  /** Pause when the tab is hidden; stay paused (and say why) when the player comes back. */
  private wireVisibility(): void {
    document.addEventListener('visibilitychange', () => {
      const session = this.session;
      if (!session) return;
      if (session.time.setHidden(document.hidden)) {
        const key = keyLabel(this.settings.get().bindings.pause[0]) || t('key.unbound');
        pushToast(t('toast.pausedHidden', { key }), 'info', 7000);
      }
    });
  }

  private installErrorReporting(): void {
    window.addEventListener('error', (event) => this.reportError(event.error ?? event.message));
    window.addEventListener('unhandledrejection', (event) => this.reportError(event.reason));
  }

  private reportError(error: unknown): void {
    pushToast(t('toast.error', { message: errorMessage(error) }), 'error', 9000);
  }

  private showFatal(message: string): void {
    uiState.set({ screen: 'fatal', fatalMessage: message });
  }

  private endSession(): void {
    for (const cleanup of this.sessionCleanup) cleanup();
    this.sessionCleanup = [];
    this.session?.dispose();
    this.session = null;
  }
}

function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

/** A fresh world seed, e.g. "k3x9q1-2f8z0a". */
function randomSeed(): string {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return Array.from(words, (n) => n.toString(36)).join('-');
}

function hasWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    // Release the probe context straight away; browsers allow only a few at once.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}
