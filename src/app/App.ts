/**
 * The application shell and composition root.
 *
 * Owns the long-lived pieces (settings, keyboard input, storage, the Phaser game, audio)
 * and the running GameSession, and implements:
 *   - UiCommands: what the HTML UI can ask for (new game, pause, tools, settings...);
 *   - GameContext: what Phaser scenes need to read (session, input, current tool...).
 * Nothing else wires systems together, so this file is the map of how the app fits.
 *
 * Player orders go through here to the simulation, and only ever mark work (dig, fell,
 * cancel, re-prioritise): the dwarves are the ones who change the world.
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
import { generateWorldInWorker } from '../platform/worldgenClient';
import { AudioService } from '../render/AudioService';
import { createGame } from '../render/createGame';
import { itemIconUrl } from '../render/assets/itemArt';
import { MinimapRenderer, type TileViewRect } from '../render/Minimap';
import { SceneKeys } from '../render/scenes/keys';
import { ViewportManager } from '../render/ViewportManager';
import { describeActivity } from '../render/world/describeCell';
import { BIOMES, CONTENT, TILES } from '../sim/content';
import { EQUIPMENT_SLOTS, SKILLS, type Dwarf } from '../sim/dwarves/Dwarf';
import { GameSession } from '../sim/GameSession';
import type { Priority } from '../sim/jobs/JobBoard';
import type { Simulation } from '../sim/Simulation';
import { World, type CellRect } from '../sim/world/World';
import type { NewWorldChoice, UiCommands, UiSound } from '../ui/commands';
import { DEFAULT_TOOL, pushToast, uiState, type DebugStats, type DwarfSummary, type HoverInfo, type Tool } from '../ui/state';
import { mountUi } from '../ui/UiRoot';
import { provideGameContext, type GameContext, type GameView } from './context';
import { randomSeed, worldOptionsFromQuery } from './worldOptions';

const SETTINGS_STORAGE_KEY = 'gatewright.settings';
const SETTINGS_SAVE_DELAY_MS = 300;
/** "Some work can't be reached" is said at most this often. */
const BLOCKED_TOAST_GAP_MS = 20_000;

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
  private gameView: GameView | null = null;
  private minimap: MinimapRenderer | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private pendingReveal = false;
  /** Bumped on every new game or quit, so a slow world generation can tell it was abandoned. */
  private generation = 0;
  private lastBlockedToast = -Infinity;

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

  worldReady(view: GameView): void {
    this.gameView = view;
    if (this.pendingReveal) {
      this.pendingReveal = false;
      this.session?.sim.revealAll();
    }
    uiState.set({ screen: 'game', loading: null });
    this.audio?.play('gameStart');
  }

  reportView(view: TileViewRect): void {
    if (!this.minimap || !uiState.get().minimapOpen) return;
    this.minimap.setView(view);
    this.minimap.draw();
  }

  reportHover(hover: HoverInfo | null): void {
    uiState.set({ hover });
  }

  reportDebugStats(stats: DebugStats): void {
    uiState.set({ debug: stats });
  }

  /** Refresh the HUD's dwarf roster and stored resources from the simulation. */
  reportColony(): void {
    const sim = this.session?.sim;
    if (!sim) return;
    const resources = sim.storage.entries().map(({ item, count }) => {
      const def = sim.items.get(item);
      return { id: def.id, name: def.name, count, icon: itemIconUrl(sim.items, item) };
    });
    uiState.set({ colony: { dwarves: sim.dwarves.map((dwarf) => summarizeDwarf(sim, dwarf)), resources } });
  }

  get tool(): Tool {
    return uiState.get().tool;
  }

  get priority(): Priority {
    return uiState.get().priority;
  }

  get selectedDwarf(): number | null {
    return uiState.get().selectedDwarf;
  }

  get debugLight(): boolean {
    return uiState.get().debugLight;
  }

  /** Use the current tool on a rectangle of cells. Tools only mark work; dwarves do it. */
  applyTool(rect: CellRect): void {
    const sim = this.session?.sim;
    if (!sim) return;
    const { tool, priority } = uiState.get();
    let changed: number;
    let removed = false;
    if (tool === 'auto') {
      const click = rect.x0 === rect.x1 && rect.y0 === rect.y1;
      const marked = click ? sim.jobs.at(rect.x0, rect.y0) : undefined;
      if (marked && marked.type !== 'haul') {
        // Clicking a mark again takes it away.
        changed = sim.cancelDesignations(rect);
        removed = true;
      } else {
        changed = sim.designate('auto', rect, priority);
        // A click on nothing that can be marked deselects the dwarf, as with Select.
        if (click && changed === 0) this.selectDwarf(null);
      }
    } else if (tool === 'dig' || tool === 'chop') changed = sim.designate(tool, rect, priority);
    else if (tool === 'cancel') {
      changed = sim.cancelDesignations(rect);
      removed = true;
    } else if (tool === 'priority') changed = sim.prioritize(rect, priority);
    else return;
    if (changed > 0) this.audio?.play(removed ? 'uiClose' : 'uiClick');
  }

  /** Right-click: put the tool down (back to Auto), or, with Auto in hand, deselect the dwarf. */
  dropTool(): void {
    const ui = uiState.get();
    if (ui.tool !== DEFAULT_TOOL) this.setTool(DEFAULT_TOOL);
    else if (ui.selectedDwarf !== null) this.selectDwarf(null);
  }

  // ---- UiCommands --------------------------------------------------------------------

  /** Open the New world dialog, preset from the page address if it names a seed or biome. */
  newGame(): void {
    if (!this.game) return;
    this.audio?.unlock();
    uiState.set({ newWorld: worldOptionsFromQuery(window.location.search, BIOMES.ids, randomSeed) });
  }

  closeNewWorld(): void {
    uiState.set({ newWorld: null });
  }

  createWorld(choice: NewWorldChoice): void {
    const game = this.game;
    if (!game) return;
    this.audio?.unlock();
    uiState.set({ newWorld: null });
    this.endSession();
    void this.startWorld(game, choice);
  }

  quitToTitle(): void {
    const game = this.game;
    if (!game) return;
    game.scene.stop(SceneKeys.game);
    this.endSession();
    game.scene.start(SceneKeys.title);
    uiState.set({ screen: 'title', menuOpen: false, settingsOpen: false, time: null, debug: null, hover: null, world: null, ...FRESH_COLONY_UI });
  }

  centerCameraOn(tileX: number, tileY: number): void {
    this.gameView?.centerOnTile(tileX, tileY);
  }

  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.minimapCanvas = canvas;
    this.minimap?.attach(canvas);
  }

  toggleMinimap(): void {
    uiState.update((s) => ({ minimapOpen: !s.minimapOpen }));
  }

  setTool(tool: Tool): void {
    uiState.set({ tool });
  }

  setPriority(priority: Priority): void {
    uiState.set({ priority });
  }

  selectDwarf(id: number | null, focus = false): void {
    uiState.set({ selectedDwarf: id });
    if (!focus || id === null) return;
    const dwarf = this.session?.sim.dwarf(id);
    if (dwarf) this.gameView?.centerOnTile(dwarf.x, dwarf.y);
  }

  setDebugLight(on: boolean): void {
    uiState.set({ debugLight: on });
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

  /** Debug: lift the fog of war over the whole map. */
  revealMap(): boolean {
    if (!this.session) return false;
    this.session.sim.revealAll();
    return true;
  }

  // ---- Starting a world --------------------------------------------------------------------

  /**
   * Generate a world in the worker behind the loading screen, then hand it to the game
   * scene. The title scene keeps animating behind the loading panel until the world is ready.
   */
  private async startWorld(game: Phaser.Game, options: NewWorldChoice): Promise<void> {
    const generation = ++this.generation;
    uiState.set({ screen: 'loading', loading: { stage: 'terrain', progress: 0 }, menuOpen: false, settingsOpen: false });
    try {
      const result = await generateWorldInWorker({ seed: options.seed, biome: options.biome }, (stage, progress) => {
        if (generation === this.generation) uiState.set({ loading: { stage, progress } });
      });
      if (generation !== this.generation) return;
      console.info(`World "${options.seed}" (${options.biome}) generated in ${result.stats.milliseconds} ms`, result.stats);

      const session = new GameSession(World.fromSnapshot(result.snapshot), CONTENT);
      this.session = session;
      this.pendingReveal = options.reveal;
      this.minimap = new MinimapRenderer(session.world, TILES, BIOMES.get(session.world.biome).sky);
      this.minimap.attach(this.minimapCanvas);
      const minimap = this.minimap;
      this.sessionCleanup.push(
        session.bus.on('TimeChanged', (time) => uiState.set({ time })),
        session.bus.on('TileChanged', ({ x, y }) => minimap.updateCells({ x0: x, y0: y, x1: x, y1: y })),
        session.bus.on('ExploredChanged', (rect) => minimap.updateCells(rect)),
        session.bus.on('SkillUp', ({ name, skill, level }) => {
          pushToast(t('toast.skillUp', { name, skill: t(`skill.${skill}`), level }), 'info', 5000);
        }),
        session.bus.on('DwarfDied', ({ name, cause }) => {
          pushToast(t('toast.dwarfDied', { name, cause: t(`toast.cause.${cause}`) }), 'error', 9000);
        }),
        session.bus.on('JobBlocked', () => {
          const now = performance.now();
          if (now - this.lastBlockedToast < BLOCKED_TOAST_GAP_MS) return;
          this.lastBlockedToast = now;
          pushToast(t('toast.jobBlocked'), 'warning', 7000);
        }),
      );
      uiState.set({
        loading: { stage: 'building', progress: 0.97 },
        time: session.time.state(),
        debug: null,
        hover: null,
        world: { seed: options.seed, biomeName: BIOMES.get(options.biome).name },
        ...FRESH_COLONY_UI,
      });
      // Let the loading screen show its last step before building the map blocks the thread briefly.
      await nextFrame();
      if (generation !== this.generation) return;
      game.scene.stop(SceneKeys.title);
      game.scene.start(SceneKeys.game);
    } catch (error) {
      if (generation !== this.generation) return;
      this.endSession();
      pushToast(t('loading.failed', { message: errorMessage(error) }), 'error', 9000);
      uiState.set({ screen: 'title', loading: null });
    }
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
    this.input.onPressed('toggleMinimap', () => this.toggleMinimap());
    this.input.onPressed('toolAuto', () => this.setTool('auto'));
    this.input.onPressed('toolSelect', () => this.setTool('select'));
    this.input.onPressed('toolDig', () => this.setTool('dig'));
    this.input.onPressed('toolChop', () => this.setTool('chop'));
    this.input.onPressed('toolCancel', () => this.setTool('cancel'));
    this.input.onPressed('toolPriority', () => this.setTool('priority'));
    this.input.onPressed('cancel', () => this.cancel());
    this.input.attach(window);
  }

  /** Game keys only act in the running game with no dialog open; Esc and ` work everywhere. */
  private isActionActive(action: Action): boolean {
    if (action === 'toggleDebug' || action === 'cancel') return true;
    const ui = uiState.get();
    return ui.screen === 'game' && !ui.menuOpen && !ui.settingsOpen;
  }

  /** Esc: close the topmost dialog, put down the tool, deselect the dwarf, or else open the in-game menu. */
  private cancel(): void {
    const ui = uiState.get();
    if (ui.settingsOpen) {
      this.playSound('uiClose');
      this.closeSettings();
    } else if (ui.newWorld) {
      this.playSound('uiClose');
      this.closeNewWorld();
    } else if (ui.screen === 'game' && ui.menuOpen) {
      this.playSound('uiClose');
      this.closeMenu();
    } else if (ui.screen === 'game' && (ui.tool !== DEFAULT_TOOL || ui.selectedDwarf !== null)) {
      this.dropTool();
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
    this.generation++;
    for (const cleanup of this.sessionCleanup) cleanup();
    this.sessionCleanup = [];
    this.session?.dispose();
    this.session = null;
    this.gameView = null;
    this.minimap = null;
    this.pendingReveal = false;
  }
}

/** The HUD's colony state for a world that has just started (or ended). */
const FRESH_COLONY_UI = { tool: DEFAULT_TOOL, selectedDwarf: null, colony: null } as const;

/** One dwarf as the roster and the dwarf panel show it. */
function summarizeDwarf(sim: Simulation, dwarf: Dwarf): DwarfSummary {
  const levels = sim.colony.skills.levels;
  const dead = dwarf.phase === 'dead';
  const stranded = !dead && !sim.homeMaps.canGetHome(sim.world.index(dwarf.x, dwarf.y));
  return {
    id: dwarf.id,
    name: dwarf.name,
    activity: describeActivity(sim, dwarf, stranded),
    health: Math.max(0, Math.round(dwarf.health)),
    maxHealth: dwarf.maxHealth,
    hunger: Math.round(dwarf.hunger),
    energy: Math.round(dwarf.energy),
    skills: SKILLS.map((skill) => {
      const { level, xp } = dwarf.skills[skill];
      const from = levels[level - 1] ?? 0;
      const to = levels[level];
      return { skill, level, progress: to === undefined ? 1 : Math.min(1, (xp - from) / (to - from)) };
    }),
    equipment: EQUIPMENT_SLOTS.map((slot) => {
      const item = dwarf.equipment[slot];
      return { slot, item: item === null ? null : sim.items.get(item).name };
    }),
    carrying: dwarf.carrying
      ? { name: sim.items.get(dwarf.carrying.item).name, count: dwarf.carrying.count, icon: itemIconUrl(sim.items, dwarf.carrying.item) }
      : null,
    dead,
    stranded,
    tunic: sim.colony.looks.tunic[dwarf.looks.tunic] ?? '#888888',
  };
}

function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

/** Resolves after the browser has painted the next frame. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
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
