/**
 * The application shell and composition root.
 *
 * Owns the long-lived pieces (settings, keyboard input, storage, the Phaser game, audio)
 * and the running GameSession, and implements:
 *   - UiCommands: what the HTML UI can ask for (new game, pause, tools, settings...);
 *   - GameContext: what Phaser scenes need to read (session, input, current tool...).
 * Nothing else wires systems together, so this file is the map of how the app fits.
 *
 * Player orders go through here to the simulation, and only ever plan work (dig, fell,
 * build, craft, cancel, re-prioritise): the dwarves are the ones who change the world.
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
import { SaveStore } from '../platform/saves';
import { probeStorage, SafeKeyValueStore, storageIsPersistent } from '../platform/storage';
import { generateWorldInWorker } from '../platform/worldgenClient';
import { AudioService } from '../render/AudioService';
import { createGame } from '../render/createGame';
import { itemIconUrl } from '../render/assets/itemArt';
import { MinimapRenderer, type MapMarker, type TileViewRect } from '../render/Minimap';
import { SceneKeys } from '../render/scenes/keys';
import { ViewportManager } from '../render/ViewportManager';
import { describeActivity } from '../render/world/describeCell';
import { BIOMES, CONTENT, TILES } from '../sim/content';
import { HAND_CRAFTED } from '../sim/crafting/Recipes';
import { EQUIPMENT_SLOTS, SKILLS, travellerOf, type Dwarf } from '../sim/dwarves/Dwarf';
import { GameSession } from '../sim/GameSession';
import type { Priority } from '../sim/jobs/JobBoard';
import { SaveError } from '../sim/save/SaveFile';
import type { Simulation } from '../sim/Simulation';
import { World, type CellRect } from '../sim/world/World';
import type { NewWorldChoice, UiCommands, UiSound } from '../ui/commands';
import {
  DEFAULT_TOOL,
  isBuildTool,
  pushToast,
  uiState,
  type BuildTool,
  type Catalogue,
  type ColonyView,
  type DebugStats,
  type DwarfSummary,
  type HoverInfo,
  type NeedWarning,
  type ThreatView,
  type Tool,
  type TravellerChoice,
} from '../ui/state';
import { mountUi } from '../ui/UiRoot';
import { loadCampaign, nextBiome, saveCampaign, winWorld, type Campaign } from './campaign';
import { buildCatalogue } from './catalogue';
import { provideGameContext, type GameContext, type GameView } from './context';
import { randomSeed, worldOptionsFromQuery } from './worldOptions';

const SETTINGS_STORAGE_KEY = 'gatewright.settings';
const SETTINGS_SAVE_DELAY_MS = 300;
/** "Some work can't be reached" is said at most this often. */
const BLOCKED_TOAST_GAP_MS = 20_000;
/** "X is badly hurt and falls back" is said at most this often for each dwarf. */
const RETREAT_TOAST_GAP_MS = 30_000;
/** Map dots: monsters, and the invasion portal. */
const MONSTER_DOT = '#ff4a3a';
const PORTAL_DOT = '#c48cff';
/** The one save slot of Milestone 6 (autosaves and "Save game" both use it). */
const SAVE_SLOT = 'main';

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
  private readonly lastRetreatToast = new Map<number, number>();
  private readonly saves = new SaveStore();
  private campaign: Campaign;
  /** The research version last shown in the HUD (-1: none yet). */
  private researchVersion = -1;

  constructor(elements: AppElements) {
    this.elements = elements;
    this.settings = new Store(parseSettings(this.storage.getItem(SETTINGS_STORAGE_KEY)));
    this.input = new InputActions(this.settings.get().bindings);
    this.campaign = loadCampaign(this.storage, BIOMES.ids);
  }

  start(): void {
    installBrowserGuards({ app: this.elements.root, world: this.elements.game });
    this.installErrorReporting();
    this.wireSettings();
    this.wireInput();
    this.wireVisibility();
    provideGameContext(this);
    mountUi(this.elements.ui, { commands: this, settings: this.settings });

    uiState.set({ unlockedBiomes: this.campaign.unlockedBiomes });
    void probeStorage().then((status) => {
      uiState.set({ storagePersistent: storageIsPersistent(status) && this.storage.persistent });
    });
    void this.saves.meta(SAVE_SLOT).then((save) => uiState.set({ save }));

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
    const sim = this.session?.sim;
    if (sim) {
      const markers: MapMarker[] = [];
      for (const creature of sim.creatures) {
        if (!creature.gone && sim.isHostile(creature) && sim.world.isVisible(creature.x, creature.y)) markers.push({ x: creature.x, y: creature.y, color: MONSTER_DOT, size: 3 });
      }
      const portal = sim.portal;
      if (portal) markers.push({ x: portal.x, y: portal.y - 1, color: PORTAL_DOT, size: 5 });
      this.minimap.setMarkers(markers);
    }
    this.minimap.draw();
  }

  reportHover(hover: HoverInfo | null): void {
    uiState.set({ hover });
  }

  reportDebugStats(stats: DebugStats): void {
    uiState.set({ debug: stats });
  }

  /** Refresh the HUD's dwarf roster, storage, crafting queue and clock from the simulation. */
  reportColony(): void {
    const sim = this.session?.sim;
    if (!sim) return;
    const { hour, minute } = sim.time.clock(sim.tick);
    // The clock moves in ten-minute steps, so it ticks over calmly even at triple speed.
    const clock = { day: sim.time.day(sim.tick), hour, minute: minute - (minute % 10), night: sim.isNight() };
    const previous = uiState.get().clock;
    const same = previous && previous.day === clock.day && previous.hour === clock.hour && previous.minute === clock.minute && previous.night === clock.night;
    const { research } = sim;
    let researchView = {};
    if (research.version !== this.researchVersion) {
      this.researchVersion = research.version;
      researchView = { research: { tier: research.tier, points: research.points, needed: research.needed, crafted: [...research.crafted].map((item) => sim.items.get(item).id) } };
    }
    uiState.set({ colony: summarizeColony(sim), threat: threatView(sim), ...researchView, ...(same ? {} : { clock }) });
  }

  get tool(): Tool {
    return uiState.get().tool;
  }

  get priority(): Priority {
    return uiState.get().priority;
  }

  get buildItem(): number | null {
    const ui = uiState.get();
    if (!isBuildTool(ui.tool)) return null;
    const id = ui.buildChoice[ui.tool];
    return id !== null && CONTENT.items.has(id) ? CONTENT.items.item(id) : null;
  }

  get farmCrop(): number | null {
    const id = uiState.get().farmCrop;
    const index = id === null ? -1 : CONTENT.crops.crops.findIndex((crop) => crop.id === id);
    return index < 0 ? null : index;
  }

  get selectedDwarf(): number | null {
    return uiState.get().selectedDwarf;
  }

  get debugLight(): boolean {
    return uiState.get().debugLight;
  }

  /** Use the current tool on a rectangle of cells. Tools only plan work; dwarves do it. */
  applyTool(rect: CellRect): void {
    const sim = this.session?.sim;
    if (!sim) return;
    const { tool, priority } = uiState.get();
    const click = rect.x0 === rect.x1 && rect.y0 === rect.y1;
    // A click on a piece of furniture with Auto or Dig marks it to be taken apart.
    const furniture = click && (tool === 'auto' || tool === 'dig') && !sim.jobs.at(rect.x0, rect.y0) ? sim.furniture.at(rect.x0, rect.y0) : undefined;
    const item = this.buildItem;
    let changed: number;
    let removed = false;
    if (furniture) {
      changed = sim.designateDismantle(rect.x0, rect.y0, priority) ? 1 : 0;
    } else if (tool === 'auto') {
      const marked = click ? (sim.jobs.at(rect.x0, rect.y0) ?? sim.jobs.wallAt(rect.x0, rect.y0)) : undefined;
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
    else if (tool === 'build' && item !== null) changed = sim.designateBuild(item, rect, priority);
    else if (tool === 'wall' && item !== null) changed = sim.designateWall(item, rect, priority);
    else if (tool === 'furniture' && item !== null) changed = sim.designateFurniture(item, rect.x0, rect.y0, priority) ? 1 : 0;
    else if (tool === 'farm' && this.farmCrop !== null) changed = sim.designateFarm(this.farmCrop, rect, priority);
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
    uiState.set({ newWorld: { ...worldOptionsFromQuery(window.location.search, BIOMES.ids, randomSeed), travellers: [] } });
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
    void this.saves.meta(SAVE_SLOT).then((save) => uiState.set({ save }));
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
    const ui = uiState.get();
    // The Farm tool picked up for the first time grows the first crop.
    if (tool === 'farm' && ui.farmCrop === null) {
      uiState.set({ tool, farmCrop: CONTENT.crops.crops[0]?.id ?? null });
      return;
    }
    // A build tool picked up for the first time starts with the first thing in its palette.
    if (isBuildTool(tool) && ui.buildChoice[tool] === null && ui.catalogue) {
      const first = paletteOf(ui.catalogue, tool)[0];
      uiState.set({ tool, buildChoice: { ...ui.buildChoice, [tool]: first?.id ?? null } });
      return;
    }
    uiState.set({ tool });
  }

  setBuildChoice(tool: BuildTool, item: string): void {
    uiState.update((s) => ({ tool, buildChoice: { ...s.buildChoice, [tool]: item } }));
  }

  setFarmCrop(crop: string): void {
    uiState.set({ tool: 'farm', farmCrop: crop });
  }

  toggleCrafting(): void {
    uiState.update((s) => ({ craftingOpen: !s.craftingOpen, techOpen: false }));
  }

  toggleTech(): void {
    uiState.update((s) => ({ techOpen: !s.techOpen, craftingOpen: false }));
  }

  toggleStorage(): void {
    uiState.update((s) => ({ storageOpen: !s.storageOpen }));
  }

  queueCraft(recipe: string, count: number): void {
    const sim = this.session?.sim;
    if (!sim || !sim.recipes.has(recipe)) return;
    sim.queueCraft(sim.recipes.get(recipe).index, count);
    this.reportColony();
  }

  setCraftRemaining(orderId: number, remaining: number): void {
    this.session?.sim.setCraftRemaining(orderId, remaining);
    this.reportColony();
  }

  cancelCraft(orderId: number): void {
    this.session?.sim.cancelCraft(orderId);
    this.reportColony();
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

  dismissColonyLost(): void {
    uiState.set({ colonyLost: false });
  }

  travel(dwarfIds: number[]): void {
    const sim = this.session?.sim;
    if (!sim || !this.game) return;
    const itemId = (item: number): string => sim.items.get(item).id;
    const travellers = dwarfIds.slice(0, sim.colony.startingDwarves).flatMap((id) => {
      const dwarf = sim.dwarf(id);
      return dwarf && dwarf.phase !== 'dead' ? [travellerOf(dwarf, itemId)] : [];
    });
    const biome = nextBiome(this.campaign, sim.world.biome, BIOMES.ids);
    this.quitToTitle();
    uiState.set({ newWorld: { seed: randomSeed(), biome, reveal: false, hour: null, forcedBiome: null, travellers } });
  }

  stayInWorld(): void {
    uiState.set({ won: null });
  }

  saveGame(): void {
    void this.saveNow(false);
  }

  continueGame(): void {
    const game = this.game;
    if (!game || uiState.get().saving) return;
    this.audio?.unlock();
    this.endSession();
    void this.loadSave(game);
  }

  toggleHunt(creatureId: number): void {
    const sim = this.session?.sim;
    if (!sim) return;
    const hunt = sim.huntJobFor(creatureId);
    if (hunt) sim.jobs.remove(hunt.id);
    else if (!sim.designateHunt(creatureId, uiState.get().priority)) return;
    this.audio?.play(hunt ? 'uiClose' : 'uiClick');
  }

  toggleRevive(dwarfId: number): void {
    const sim = this.session?.sim;
    if (!sim) return;
    const job = sim.reviveJobFor(dwarfId);
    if (job) sim.jobs.remove(job.id);
    else if (!sim.designateRevive(dwarfId, uiState.get().priority)) return;
    this.audio?.play(job ? 'uiClose' : 'uiClick');
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
      const session = new GameSession(World.fromSnapshot(result.snapshot), CONTENT, undefined, options.hour ?? undefined, options.travellers);
      await this.enterSession(game, session, generation, options.reveal);
      if (options.travellers.length > 0) {
        pushToast(t('toast.travellers', { names: options.travellers.map((traveller) => traveller.name).join(', ') }), 'info', 8000);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.endSession();
      pushToast(t('loading.failed', { message: errorMessage(error) }), 'error', 9000);
      uiState.set({ screen: 'title', loading: null });
    }
  }

  /** Load the saved game behind the loading screen and carry on playing it. */
  private async loadSave(game: Phaser.Game): Promise<void> {
    const generation = ++this.generation;
    uiState.set({ screen: 'loading', loading: { stage: 'loading', progress: 0.3 }, menuOpen: false, settingsOpen: false, newWorld: null, saving: true });
    try {
      const stored = await this.saves.get(SAVE_SLOT);
      if (generation !== this.generation) return;
      if (!stored) throw new SaveError('damaged', 'There is no saved game');
      uiState.set({ loading: { stage: 'loading', progress: 0.7 } });
      await nextFrame();
      const session = GameSession.fromSave(stored.bytes, CONTENT);
      console.info(`Loaded the save of world "${stored.meta.seed}", day ${stored.meta.day}`);
      await this.enterSession(game, session, generation, false);
    } catch (error) {
      if (generation !== this.generation) return;
      this.endSession();
      pushToast(t('toast.loadFailed', { message: saveErrorMessage(error) }), 'error', 10000);
      uiState.set({ screen: 'title', loading: null });
    } finally {
      uiState.set({ saving: false });
    }
  }

  /** Save the running world in the save slot (`auto`: the dawn autosave). */
  private async saveNow(auto: boolean): Promise<void> {
    const session = this.session;
    if (!session || uiState.get().saving) return;
    uiState.set({ saving: true });
    try {
      const { bytes, meta } = session.save(Date.now());
      await this.saves.put(SAVE_SLOT, { bytes, meta });
      uiState.set({ save: meta });
      if (!this.saves.persistent) uiState.set({ storagePersistent: false });
      pushToast(t(auto ? 'toast.autosaved' : 'toast.saved', { day: meta.day }), 'info', auto ? 3500 : 4000);
    } catch (error) {
      pushToast(t('toast.saveFailed', { message: errorMessage(error) }), 'error', 9000);
    } finally {
      uiState.set({ saving: false });
    }
  }

  /** Make a session the running world: wire its events to the HUD, toasts and sounds, and start the game scene. */
  private async enterSession(game: Phaser.Game, session: GameSession, generation: number, reveal: boolean): Promise<void> {
    this.session = session;
    this.pendingReveal = reveal;
    this.researchVersion = -1;
    this.minimap = new MinimapRenderer(session.world, TILES, BIOMES.get(session.world.biome).sky);
    this.minimap.attach(this.minimapCanvas);
    const minimap = this.minimap;
    const sim = session.sim;
    this.sessionCleanup.push(
      session.bus.on('TimeChanged', (time) => uiState.set({ time })),
      session.bus.on('TileChanged', ({ x, y }) => minimap.updateCells({ x0: x, y0: y, x1: x, y1: y })),
      session.bus.on('ExploredChanged', (rect) => minimap.updateCells(rect)),
      session.bus.on('SkillUp', ({ name, skill, level }) => {
        pushToast(t('toast.skillUp', { name, skill: t(`skill.${skill}`), level }), 'info', 5000);
      }),
      session.bus.on('DwarfDied', ({ name, cause, by, revivable }) => {
        const why = cause === 'monster' ? t('toast.cause.monster', { creature: by ?? '' }) : t(`toast.cause.${cause}`);
        pushToast(`${t('toast.dwarfDied', { name, cause: why })}${revivable ? ` ${t('toast.reviveHint')}` : ''}`, 'error', 10000);
      }),
      session.bus.on('JobBlocked', () => {
        const now = performance.now();
        if (now - this.lastBlockedToast < BLOCKED_TOAST_GAP_MS) return;
        this.lastBlockedToast = now;
        pushToast(t('toast.jobBlocked'), 'warning', 7000);
      }),
      session.bus.on('Equipped', ({ name, item }) => {
        pushToast(t('toast.equipped', { name, item: sim.items.get(item).name.toLowerCase() }), 'info', 5000);
      }),
      session.bus.on('StorageFull', () => pushToast(t('toast.storageFull'), 'warning', 7000)),
      session.bus.on('NightStarted', ({ day }) => pushToast(t('toast.night', { day }), 'info', 5000)),
      session.bus.on('DayStarted', ({ day }) => {
        pushToast(t('toast.day', { day }), 'info', 4000);
        // Autosave every dawn, once the tick that brought the dawn has finished.
        queueMicrotask(() => void this.saveNow(true));
      }),
      session.bus.on('DwarfStarving', ({ name }) => pushToast(t('toast.starving', { name }), 'error', 8000)),
      session.bus.on('DwarfCollapsed', ({ name }) => pushToast(t('toast.collapsed', { name }), 'warning', 6000)),
      session.bus.on('CraftOrderDone', ({ item, count }) => {
        pushToast(t('toast.orderDone', { count, item: sim.items.get(item).name }), 'info', 4000);
      }),
      session.bus.on('NightThreat', () => pushToast(t('toast.nightThreat'), 'warning', 7000)),
      session.bus.on('WaveWarning', ({ x }) => {
        const side = x < sim.hearth.x ? 'west' : 'east';
        pushToast(t('toast.waveWarning', { side: t(`side.${side}`) }), 'error', 10000);
        this.audio?.play('horn', 0.9);
      }),
      session.bus.on('WaveStarted', ({ size }) => pushToast(t('toast.waveStarted', { size }), 'error', 8000)),
      session.bus.on('WaveEnded', ({ defeated }) => pushToast(t(defeated ? 'toast.waveDefeated' : 'toast.waveRetreat'), 'info', 7000)),
      session.bus.on('DwarfRetreating', ({ dwarf, name }) => {
        const now = performance.now();
        if (now - (this.lastRetreatToast.get(dwarf) ?? -Infinity) < RETREAT_TOAST_GAP_MS) return;
        this.lastRetreatToast.set(dwarf, now);
        pushToast(t('toast.retreating', { name }), 'warning', 6000);
      }),
      session.bus.on('DwarfRevived', ({ name }) => pushToast(t('toast.dwarfRevived', { name }), 'info', 6000)),
      session.bus.on('ColonyLost', () => uiState.set({ colonyLost: true })),
      session.bus.on('ResearchGained', ({ item, points }) => {
        pushToast(t('toast.research', { item: sim.items.get(item).name.toLowerCase(), points }), 'info', 4500);
      }),
      session.bus.on('TierReached', ({ name, dwarves }) => {
        const key = dwarves > 1 ? 'toast.tierDwarves' : dwarves === 1 ? 'toast.tierDwarf' : 'toast.tierReached';
        pushToast(t(key, { tier: name, count: dwarves }), 'info', 9000);
        this.audio?.play('research');
      }),
      session.bus.on('DwarfArrived', ({ name }) => pushToast(t('toast.dwarfArrived', { name }), 'info', 7000)),
      session.bus.on('WorldWon', ({ day }) => this.worldWon(day)),
    );
    uiState.set({
      loading: { stage: 'building', progress: 0.97 },
      time: session.time.state(),
      debug: null,
      hover: null,
      world: { seed: session.world.seed, biomeName: BIOMES.get(session.world.biome).name },
      ...FRESH_COLONY_UI,
      catalogue: uiState.get().catalogue ?? buildCatalogue(CONTENT),
    });
    // Let the loading screen show its last step before building the map blocks the thread briefly.
    await nextFrame();
    if (generation !== this.generation) return;
    game.scene.stop(SceneKeys.title);
    game.scene.start(SceneKeys.game);
  }

  /** The World Gate is built: the campaign moves on, and the victory dialog comes up. */
  private worldWon(day: number): void {
    const sim = this.session?.sim;
    if (!sim) return;
    const { campaign, opened } = winWorld(this.campaign, sim.world.biome, BIOMES.ids);
    this.campaign = campaign;
    saveCampaign(this.storage, campaign);
    this.audio?.play('gateOpen');
    uiState.set({
      unlockedBiomes: campaign.unlockedBiomes,
      won: { day, unlocked: opened ? BIOMES.get(opened).name : null, dwarves: travellerChoices(sim), max: sim.colony.startingDwarves },
    });
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
    this.input.onPressed('toolFarm', () => this.setTool('farm'));
    this.input.onPressed('toolBuild', () => this.setTool('build'));
    this.input.onPressed('toolWall', () => this.setTool('wall'));
    this.input.onPressed('toolFurniture', () => this.setTool('furniture'));
    this.input.onPressed('toolCancel', () => this.setTool('cancel'));
    this.input.onPressed('toolPriority', () => this.setTool('priority'));
    this.input.onPressed('toggleCrafting', () => {
      this.playSound(uiState.get().craftingOpen ? 'uiClose' : 'uiOpen');
      this.toggleCrafting();
    });
    this.input.onPressed('toggleStorage', () => this.toggleStorage());
    this.input.onPressed('toggleTech', () => {
      this.playSound(uiState.get().techOpen ? 'uiClose' : 'uiOpen');
      this.toggleTech();
    });
    this.input.onPressed('cancel', () => this.cancel());
    this.input.attach(window);
  }

  /** Game keys only act in the running game with no dialog open; Esc and ` work everywhere. */
  private isActionActive(action: Action): boolean {
    if (action === 'toggleDebug' || action === 'cancel') return true;
    const ui = uiState.get();
    return ui.screen === 'game' && !ui.menuOpen && !ui.settingsOpen;
  }

  /** Esc: close the topmost dialog or panel, put down the tool, deselect the dwarf, or else open the in-game menu. */
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
    } else if (ui.screen === 'game' && ui.craftingOpen) {
      this.playSound('uiClose');
      this.toggleCrafting();
    } else if (ui.screen === 'game' && ui.techOpen) {
      this.playSound('uiClose');
      this.toggleTech();
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
const FRESH_COLONY_UI = {
  tool: DEFAULT_TOOL,
  selectedDwarf: null,
  colony: null,
  craftingOpen: false,
  techOpen: false,
  threat: null,
  colonyLost: false,
  research: null,
  won: null,
} as const;

/** The living dwarves who could step through the gate, the most skilled first. */
function travellerChoices(sim: Simulation): TravellerChoice[] {
  return sim.livingDwarves
    .map((dwarf) => {
      const best = SKILLS.reduce((top, skill) => (dwarf.skills[skill].level > dwarf.skills[top].level ? skill : top), SKILLS[0]);
      const total = SKILLS.reduce((sum, skill) => sum + dwarf.skills[skill].xp, 0);
      return { choice: { id: dwarf.id, name: dwarf.name, skill: t(`skill.${best}`), level: dwarf.skills[best].level }, total };
    })
    .sort((a, b) => b.total - a.total || a.choice.id - b.choice.id)
    .map(({ choice }) => choice);
}

/** Why a save couldn't be loaded, in words. */
function saveErrorMessage(error: unknown): string {
  if (error instanceof SaveError) {
    if (error.problem === 'newer') return t('error.saveVersionNewer');
    if (error.problem === 'older') return t('error.saveVersionOlder');
    return t('error.saveDamaged');
  }
  return errorMessage(error);
}

/** An invasion coming or under way, for the top bar. */
function threatView(sim: Simulation): ThreatView {
  const wave = sim.waveView();
  if (!wave) return null;
  const side = wave.side < 0 ? 'west' : 'east';
  if (wave.phase === 'warning') return { phase: 'warning', seconds: Math.ceil(wave.ticksLeft / 20), side };
  return { phase: 'open', left: wave.left, side };
}

function paletteOf(catalogue: Catalogue, tool: BuildTool): Catalogue['blocks'] {
  return tool === 'build' ? catalogue.blocks : tool === 'wall' ? catalogue.walls : catalogue.furniture;
}

/** The roster, storage and crafting queue as the HUD shows them. */
function summarizeColony(sim: Simulation): ColonyView {
  const resources = sim.storage.entries().map(({ item, count }) => {
    const def = sim.items.get(item);
    return { id: def.id, name: def.name, count, icon: itemIconUrl(sim.items, item) };
  });
  const stations: Record<string, number> = {};
  for (const piece of sim.furniture.all()) if (piece.def.station) stations[piece.def.station] = (stations[piece.def.station] ?? 0) + 1;
  const stationNames = new Map(sim.furnitureKinds.defs.flatMap((def) => (def.station ? [[def.station, def.name] as const] : [])));
  const orders = sim.crafting.orders.map((order) => {
    const recipe = sim.recipes.recipes[order.recipe]!;
    const output = sim.items.get(recipe.output.item);
    // The craft furthest along, if anyone is on it.
    let progress: number | null = null;
    for (const job of sim.jobs.all()) {
      if (job.type === 'craft' && job.orderId === order.id && job.claimedBy !== 0) progress = Math.max(progress ?? 0, sim.jobProgress(job));
    }
    return {
      id: order.id,
      recipe: recipe.id,
      name: output.name,
      icon: itemIconUrl(sim.items, recipe.output.item),
      outputCount: recipe.output.count,
      made: order.made,
      count: order.count,
      status: sim.craftStatus(order),
      station: recipe.station === HAND_CRAFTED ? null : (stationNames.get(recipe.station) ?? recipe.station),
      progress,
    };
  });
  return {
    dwarves: sim.dwarves.map((dwarf) => summarizeDwarf(sim, dwarf)),
    resources,
    storage: { used: sim.storage.slotsUsed(), capacity: sim.storage.capacity },
    orders,
    stations,
  };
}

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
      return { slot, item: item === null ? null : sim.items.get(item).name, icon: item === null ? null : itemIconUrl(sim.items, item) };
    }),
    carrying: dwarf.carrying.map(({ item, count }) => ({ name: sim.items.get(item).name, count, icon: itemIconUrl(sim.items, item) })),
    needs: dead ? [] : needWarnings(sim, dwarf),
    combat: combatSummary(sim, dwarf),
    dead,
    stranded,
    tunic: sim.colony.looks.tunic[dwarf.looks.tunic] ?? '#888888',
  };
}

/** The needs a dwarf is short of, worst first. */
function needWarnings(sim: Simulation, dwarf: Dwarf): NeedWarning[] {
  const n = sim.colony.needs;
  const warnings: NeedWarning[] = [];
  if (dwarf.hunger <= 0) warnings.push('starving');
  else if (dwarf.hunger < n.hungryBelow) warnings.push('hungry');
  if (dwarf.energy <= 0) warnings.push('exhausted');
  else if (dwarf.energy < n.tiredBelow) warnings.push('tired');
  if (dwarf.health < sim.colony.combat.engageAbove * dwarf.maxHealth) warnings.push('wounded');
  return warnings;
}

/** What a dwarf fights with (null: bare hands), the damage of a blow, and its armour. */
function combatSummary(sim: Simulation, dwarf: Dwarf): DwarfSummary['combat'] {
  const weapon = dwarf.equipment.weapon;
  return {
    weapon: weapon === null ? null : sim.items.get(weapon).name.toLowerCase(),
    damage: Math.round(sim.weaponOf(dwarf).damage * 10) / 10,
    armor: sim.armorOf(dwarf),
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
