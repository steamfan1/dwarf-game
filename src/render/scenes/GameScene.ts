/**
 * The in-game scene. It draws the session's world and colony, and turns pointer input
 * into orders. The player never changes the world from here: a tool only plans work (or
 * picks a dwarf), and the dwarves do the rest.
 *
 * Each animation frame it:
 *   1. hands the frame's real time to the session, which runs 0..n fixed simulation ticks.
 *      That is the time since the previous frame, measured here rather than taken from
 *      Phaser's `delta`: Phaser smooths its delta and, for a while after the game starts
 *      or regains focus, caps it at 1/60 s, so below 60 fps game time would run slow;
 *   2. moves the camera (real time, so it works while paused) and gives tilemap layers
 *      to the chunks in view (see WorldView);
 *   3. draws the dwarves and items between the last two ticks, so they move smoothly;
 *   4. updates the tile cursor, the minimap's view box, the HUD's colony panel and, if
 *      open, the debug overlay.
 *
 * Changes in the world arrive as events (TileChanged, DesignationChanged, ExploredChanged,
 * FurnitureChanged) and redraw only what they concern; the fog texture is uploaded at
 * most once per frame. Fights show as puffs, sparks and sounds, from their own events.
 */
import * as Phaser from 'phaser';
import { gameContext } from '../../app/context';
import { CHUNK_SIZE, TILE_SIZE } from '../../config';
import { BIOMES, TILES } from '../../sim/content';
import type { GameSession } from '../../sim/GameSession';
import type { Job } from '../../sim/jobs/JobBoard';
import type { CellRect } from '../../sim/world/World';
import { isBuildTool, type Tool } from '../../ui/state';
import { markFrame, type MarkKind } from '../assets/colonyArt';
import { TERRAIN_LAYOUT, type SoundKey } from '../assets/manifest';
import { CameraController } from '../CameraController';
import { DEPTH } from '../depths';
import { ColonyDebug } from '../world/ColonyDebug';
import { CombatEffects } from '../world/CombatEffects';
import { CreatureSprites } from '../world/CreatureSprites';
import { describeCell, describeCreature, describeDwarf } from '../world/describeCell';
import { DwarfSprites } from '../world/DwarfSprites';
import { FogOverlay } from '../world/FogOverlay';
import { FurnitureSprites } from '../world/FurnitureSprites';
import { HealthBars } from '../world/HealthBars';
import { ItemSprites } from '../world/ItemSprites';
import { PlanGhosts, type PlanPicture } from '../world/PlanGhosts';
import { SelectionBox } from '../world/SelectionBox';
import { SkyBackdrop } from '../world/SkyBackdrop';
import { TileCursor, type CursorState } from '../world/TileCursor';
import { WorkCracks } from '../world/WorkCracks';
import { WorldView } from '../world/WorldView';
import { SceneKeys } from './keys';

const STATS_INTERVAL_MS = 250;
/** The HUD's dwarf roster and stored resources refresh this often. */
const COLONY_REPORT_MS = 250;
/** What's under the pointer is described again this often, as dwarves come and go. */
const HOVER_REFRESH_MS = 200;
/** The light-level debug view is redrawn this often. */
const LIGHT_VIEW_REFRESH_MS = 500;
/** Don't play the same work sound more often than this. */
const WORK_SOUND_GAP_MS = 120;
/** Puff colours: creatures of the dark arriving or leaving, dust from smashed blocks, a creature falling. */
const DARK_PUFF = 0x8a6ad8;
const DUST_PUFF = 0xc9a77a;
const DEATH_PUFF = 0xd8d0c8;
const BLOOD_SPARK = 0xff5a4a;

type Cell = { x: number; y: number };

export class GameScene extends Phaser.Scene {
  private session!: GameSession;
  private worldView!: WorldView;
  private fog!: FogOverlay;
  private sky!: SkyBackdrop;
  private cursor!: TileCursor;
  private selection!: SelectionBox;
  private dwarfSprites!: DwarfSprites;
  private creatureSprites!: CreatureSprites;
  private combat!: CombatEffects;
  private healthBars!: HealthBars;
  private itemSprites!: ItemSprites;
  private furnitureSprites!: FurnitureSprites;
  private plans!: PlanGhosts;
  private cracks!: WorkCracks;
  private colonyDebug!: ColonyDebug;
  private cameraControl!: CameraController;
  private chunkGrid!: Phaser.GameObjects.Graphics;
  private readonly cleanup: Array<() => void> = [];

  /** The cell under the pointer, and the world point (for picking dwarves). */
  private hovered: Cell | null = null;
  private pointerWorld: { x: number; y: number } | null = null;
  private hoverDirty = true;
  private hoverAgeMs = 0;
  /** Where a tool drag started, while the left button is held with a tool other than Select. */
  private dragFrom: Cell | null = null;
  private dragTo: Cell | null = null;
  private lastSound = new Map<string, number>();
  private gridZoom = 0;
  private lastSize = { width: 0, height: 0, scale: 1 };

  /** Timestamp of the previous frame, or null before the first one. */
  private lastFrameTime: number | null = null;
  private statsElapsedMs = 0;
  private colonyElapsedMs = 0;
  private lightViewElapsedMs = 0;
  private rateWindowStart = 0;
  private rateWindowTick = 0;
  private ticksPerSecond = 0;

  constructor() {
    super(SceneKeys.game);
  }

  create(): void {
    const context = gameContext();
    const session = context.session;
    if (!session) throw new Error('The game scene started without a running session');
    this.session = session;
    const { sim } = session;
    const world = session.world;
    // Phaser reuses scene instances, so reset per-world state explicitly.
    this.hovered = null;
    this.pointerWorld = null;
    this.hoverDirty = true;
    this.hoverAgeMs = 0;
    this.dragFrom = null;
    this.dragTo = null;
    this.gridZoom = 0;
    this.lastFrameTime = null;
    this.statsElapsedMs = 0;
    this.colonyElapsedMs = COLONY_REPORT_MS;
    this.lightViewElapsedMs = 0;

    this.sky = new SkyBackdrop(this, BIOMES.get(world.biome).sky);
    this.worldView = new WorldView(this, world, TILES, TERRAIN_LAYOUT, { terrain: 'terrain', marks: 'marks' }, (x, y) => {
      // A planned wall shows its mark only where nothing else is planned in front of it.
      const job = sim.jobs.at(x, y) ?? sim.jobs.wallAt(x, y);
      return job && job.type !== 'haul' ? markFrame(markKind(job, x, y), job.priority, job.blocked, job.missing) : -1;
    });
    this.add
      .sprite((sim.hearth.x + 0.5) * TILE_SIZE, (sim.hearth.y + 1) * TILE_SIZE, 'hearth', 0)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.objects)
      .play('hearthFire');
    this.furnitureSprites = new FurnitureSprites(this, sim);
    this.plans = new PlanGhosts(this, sim, TERRAIN_LAYOUT);
    this.itemSprites = new ItemSprites(this);
    this.dwarfSprites = new DwarfSprites(this, world, sim.colony);
    this.creatureSprites = new CreatureSprites(this);
    this.combat = new CombatEffects(this, world);
    this.healthBars = new HealthBars(this);
    this.cracks = new WorkCracks(this);
    this.fog = new FogOverlay(this, world, sim.lighting, sim.daylight);
    this.selection = new SelectionBox(this);
    this.cursor = new TileCursor(this);
    this.chunkGrid = this.add.graphics().setDepth(DEPTH.debug).setVisible(false);
    this.colonyDebug = new ColonyDebug(this);

    this.cameraControl = new CameraController(this, world, context.input, context.settings, () => gameContext().dpr);
    this.cameraControl.centerOnTile(sim.hearth.x, sim.hearth.y - 2);
    this.lastSize = { width: this.scale.width, height: this.scale.height, scale: this.cameraControl.scale };
    this.worldView.cull(this.cameraControl.view);

    this.cleanup.push(
      session.bus.on('TileChanged', ({ x, y }) => {
        this.worldView.refreshCell(x, y);
        this.hoverDirty = true;
      }),
      session.bus.on('DesignationChanged', ({ x, y }) => {
        this.worldView.refreshMark(x, y);
        this.plans.invalidate();
        this.hoverDirty = true;
      }),
      session.bus.on('FurnitureChanged', ({ id, placed }) => {
        const piece = sim.furniture.get(id);
        this.furnitureSprites.changed(id, placed);
        if (piece) this.workSound('build', piece.x, piece.y);
        this.hoverDirty = true;
      }),
      session.bus.on('ExploredChanged', (rect) => {
        this.fog.update(rect);
        // A newly explored cell under the pointer has something new to describe.
        this.hoverDirty = true;
      }),
      session.bus.on('LightChanged', (rect) => this.fog.update(rect)),
      session.bus.on('RoomsChanged', () => {
        this.hoverDirty = true;
      }),
      session.bus.on('Harvested', ({ x, y }) => this.workSound('build', x, y)),
      session.bus.on('BlockDug', ({ x, y }) => this.workSound('dig', x, y)),
      session.bus.on('TreeFelled', ({ x, y }) => this.workSound('dig', x, y)),
      session.bus.on('BlockBuilt', ({ x, y }) => this.workSound('build', x, y)),
      session.bus.on('ItemCrafted', ({ dwarf }) => {
        const crafter = sim.dwarf(dwarf);
        if (crafter) this.workSound('craft', crafter.x, crafter.y);
      }),
      // Fights: puffs, sparks and sounds where they can be seen.
      session.bus.on('CreatureSpawned', ({ x, y }) => this.effectAt(x, y, () => this.combat.puff(cx(x), cy(y), DARK_PUFF))),
      session.bus.on('CreatureLeft', ({ x, y }) => this.effectAt(x, y, () => this.combat.puff(cx(x), cy(y), DARK_PUFF))),
      session.bus.on('CreatureDied', ({ x, y }) => {
        this.effectAt(x, y, () => this.combat.puff(cx(x), cy(y), DEATH_PUFF, 1.3));
        this.workSound('creatureDie', x, y);
      }),
      session.bus.on('CreatureHurt', ({ x, y }) => {
        this.effectAt(x, y, () => this.combat.spark(cx(x), cy(y) - 2, 0xffffff));
        this.workSound('hit', x, y);
      }),
      session.bus.on('DwarfHurt', ({ x, y }) => {
        this.effectAt(x, y, () => this.combat.spark(cx(x), cy(y) - 2, BLOOD_SPARK));
        this.workSound('hit', x, y);
      }),
      session.bus.on('TileDamaged', ({ x, y }) => {
        this.effectAt(x, y, () => this.combat.spark(cx(x), cy(y), DUST_PUFF));
        this.workSound('hit', x, y);
      }),
      session.bus.on('TileBroken', ({ x, y }) => {
        this.effectAt(x, y, () => this.combat.puff(cx(x), cy(y), DUST_PUFF, 1.4));
        this.workSound('smash', x, y);
      }),
      session.bus.on('TrapSprung', ({ x, y }) => this.workSound('trap', x, y)),
      session.bus.on('ProjectileFired', ({ kind, x, y }) => this.workSound(kind === 'bolt' ? 'shoot' : 'spit', Math.floor(x), Math.floor(y))),
      session.bus.on('ProjectileHit', ({ x, y }) => this.effectAt(Math.floor(x), Math.floor(y), () => this.combat.puff(x * TILE_SIZE, y * TILE_SIZE, DUST_PUFF, 0.5))),
      session.bus.on('WaveStarted', () => gameContext().audio?.play('portal', 0.8)),
    );
    this.listenForPointer();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    this.rateWindowStart = this.time.now;
    this.rateWindowTick = sim.tick;
    context.worldReady({ centerOnTile: (x, y) => this.cameraControl.centerOnTile(x, y) });
  }

  override update(time: number): void {
    const context = gameContext();
    const { sim } = this.session;
    // Real time since the last frame. FixedTimestep clamps long gaps (a background tab, a
    // debugger pause), and the game pauses itself while the tab is hidden anyway.
    const frameMs = this.lastFrameTime === null ? 0 : Math.max(0, time - this.lastFrameTime);
    this.lastFrameTime = time;
    this.session.frame(frameMs);
    this.cameraControl.update(frameMs);

    const view = this.cameraControl.view;
    this.worldView.cull(view);
    this.sky.fit(this.scale.width, this.scale.height, this.cameraControl.scale);
    // Day and night: the sky dims, and the darkness over the world deepens.
    this.sky.setDaylight(sim.daylight, sim.time.settings.nightLight);
    this.fog.setDaylight(sim.daylight);

    const alpha = this.session.alpha;
    this.plans.update();
    this.itemSprites.update(sim.ground, alpha);
    this.healthBars.clear();
    this.dwarfSprites.update(sim.dwarves, alpha, sim.tick, time, context.selectedDwarf, { revive: (dwarf) => sim.reviveJobFor(dwarf.id) !== undefined }, this.healthBars);
    this.creatureSprites.update(sim, alpha, time, this.healthBars);
    this.combat.update(sim.projectiles, alpha, frameMs, sim.portal, time);
    this.cracks.update(sim);
    this.updateLightView(frameMs);
    this.fog.flush();
    context.reportView({ x: view.x / TILE_SIZE, y: view.y / TILE_SIZE, width: view.width / TILE_SIZE, height: view.height / TILE_SIZE });

    this.hoverAgeMs += frameMs;
    if (this.hoverAgeMs >= HOVER_REFRESH_MS) this.hoverDirty = true;
    this.refreshHover();

    this.colonyElapsedMs += frameMs;
    if (this.colonyElapsedMs >= COLONY_REPORT_MS) {
      this.colonyElapsedMs = 0;
      context.reportColony();
    }

    if (context.debugVisible) {
      this.drawChunkGrid();
      this.colonyDebug.draw(sim, this.dwarfSprites, alpha, this.cameraControl.scale);
      this.reportStats(time, frameMs);
    } else if (this.chunkGrid.visible) {
      this.chunkGrid.setVisible(false);
      this.colonyDebug.hide();
    }
  }

  // ---- Pointer: hover, tools and picking dwarves ------------------------------------------

  private listenForPointer(): void {
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      this.trackPointer(pointer);
      if (this.dragFrom && pointer.leftButtonDown()) {
        this.dragTo = this.hovered;
        this.showSelection();
      }
    };
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      this.trackPointer(pointer);
      const context = gameContext();
      if (pointer.rightButtonDown()) {
        // Right-click cancels a drag in progress, or else puts the tool down.
        if (this.dragFrom) this.endDrag(false);
        else context.dropTool();
        return;
      }
      if (!pointer.leftButtonDown() || !this.hovered) return;
      // Select picks a dwarf (or none); Auto picks a dwarf if one is under the pointer
      // (marking a fallen one for revival), and marks an animal for hunting.
      const world = this.pointerWorld!;
      const { sim } = this.session;
      const dwarf = this.dwarfSprites.dwarfAt(world.x, world.y, sim.dwarves);
      if (context.tool === 'auto') {
        const fallen = dwarf !== null ? sim.dwarf(dwarf) : undefined;
        if (fallen && fallen.phase === 'dead') {
          context.toggleRevive(fallen.id);
          this.hoverDirty = true;
          return;
        }
        const creature = dwarf === null ? this.creatureSprites.creatureAt(world.x, world.y, sim) : null;
        const animal = creature !== null ? sim.creature(creature) : undefined;
        if (animal && !sim.isHostile(animal)) {
          context.toggleHunt(animal.id);
          this.hoverDirty = true;
          return;
        }
      }
      if (context.tool === 'select' || (context.tool === 'auto' && dwarf !== null)) {
        context.selectDwarf(dwarf);
        return;
      }
      // Furniture goes where it's clicked: there is nothing to drag out.
      if (context.tool === 'furniture') {
        const { x, y } = this.hovered;
        context.applyTool({ x0: x, y0: y, x1: x, y1: y });
        this.hoverDirty = true;
        return;
      }
      this.dragFrom = this.hovered;
      this.dragTo = this.hovered;
      this.showSelection();
    };
    const onUp = (pointer: Phaser.Input.Pointer): void => {
      if (this.dragFrom && !pointer.leftButtonDown()) this.endDrag(true);
    };
    const onOut = (): void => {
      this.hovered = null;
      this.pointerWorld = null;
      this.hoverDirty = true;
    };
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    // Releasing the button outside the canvas still finishes the drag.
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    this.input.on(Phaser.Input.Events.GAME_OUT, onOut);
    this.cleanup.push(() => {
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
      this.input.off(Phaser.Input.Events.GAME_OUT, onOut);
    });
  }

  private trackPointer(pointer: Phaser.Input.Pointer): void {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pointerWorld = { x: point.x, y: point.y };
    const cell = { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
    if (!this.hovered || cell.x !== this.hovered.x || cell.y !== this.hovered.y) {
      this.hovered = cell;
    }
    // A dwarf may have walked under a still pointer, so describe it again on every move.
    this.hoverDirty = true;
  }

  private dragRect(): CellRect | null {
    if (!this.dragFrom || !this.dragTo) return null;
    return { x0: this.dragFrom.x, y0: this.dragFrom.y, x1: this.dragTo.x, y1: this.dragTo.y };
  }

  private showSelection(): void {
    const rect = this.dragRect();
    const context = gameContext();
    if (rect) this.selection.show(rect, context.tool, context.priority, this.cameraControl.scale);
  }

  /** Finish a tool drag: apply the tool to the rectangle, or (`apply` false) just drop it. */
  private endDrag(apply: boolean): void {
    const rect = this.dragRect();
    this.dragFrom = null;
    this.dragTo = null;
    this.selection.hide();
    if (apply && rect) gameContext().applyTool(rect);
    this.hoverDirty = true;
  }

  private refreshHover(): void {
    if (!this.hoverDirty) return;
    this.hoverDirty = false;
    this.hoverAgeMs = 0;
    const context = gameContext();
    const { sim } = this.session;
    const cell = this.hovered;
    this.plans.hidePreview();
    if (!cell) {
      this.cursor.hide();
      context.reportHover(null);
      return;
    }

    // A dwarf under the pointer is described instead of the cell it stands in, except with
    // a build tool in hand: then what matters is whether something can be built there.
    const world = this.pointerWorld;
    const dwarfId = world && !isBuildTool(context.tool) ? this.dwarfSprites.dwarfAt(world.x, world.y, sim.dwarves) : null;
    const dwarf = dwarfId === null ? undefined : sim.dwarf(dwarfId);
    if (dwarf && this.dragFrom === null) {
      this.cursor.hide();
      context.reportHover(describeDwarf(sim, dwarf, context.tool));
      return;
    }
    // Likewise a creature (except with a build tool in hand).
    const creatureId = world && !isBuildTool(context.tool) ? this.creatureSprites.creatureAt(world.x, world.y, sim) : null;
    const creature = creatureId === null ? undefined : sim.creature(creatureId);
    if (creature && this.dragFrom === null) {
      this.cursor.hide();
      context.reportHover(describeCreature(sim, creature, context.tool));
      return;
    }

    const tool = context.tool;
    const buildItem = context.buildItem;
    const info = describeCell(sim, cell.x, cell.y, tool, context.priority, buildItem);
    if (!info) {
      this.cursor.hide();
      context.reportHover(null);
      return;
    }
    const state: CursorState = info.action === 'ok' ? 'ok' : info.action === 'blocked' ? 'blocked' : 'neutral';
    // A build tool shows what it would put here; furniture is outlined whole.
    const picture = buildItem === null || this.dragFrom !== null ? null : this.pictureFor(tool, buildItem);
    if (picture && sim.world.isVisible(cell.x, cell.y)) this.plans.showPreview(picture, cell.x, cell.y, info.action === 'ok');
    if (picture?.kind === 'furniture') {
      const { width, height } = picture.def;
      this.cursor.show(cell.x, cell.y - height + 1, state, this.cameraControl.scale, width, height);
    } else {
      this.cursor.show(cell.x, cell.y, state, this.cameraControl.scale);
    }
    context.reportHover(info);
  }

  /** What a build tool puts down with an item: a block, a wall or a piece of furniture. */
  private pictureFor(tool: Tool, item: number): PlanPicture | null {
    if (!isBuildTool(tool)) return null;
    const { sim } = this.session;
    const def = sim.items.items[item];
    if (!def) return null;
    if (tool === 'wall') {
      const wall = sim.tiles.walls.findIndex((w) => w.material === def.id);
      return wall < 0 ? null : { kind: 'wall', wall };
    }
    const builds = def.builds;
    if (tool === 'build' && builds && 'tile' in builds) return { kind: 'tile', tile: sim.tiles.tile(builds.tile) };
    if (tool === 'furniture' && builds && 'furniture' in builds) return { kind: 'furniture', def: sim.furnitureKinds.get(sim.furnitureKinds.id(builds.furniture)) };
    return null;
  }

  /** Something happened in view: a knock for digging and building, a ring for crafting, a thud for a blow... */
  private workSound(sound: SoundKey, x: number, y: number): void {
    if (!this.inView(x, y)) return;
    const last = this.lastSound.get(sound) ?? -Infinity;
    if (this.time.now - last < WORK_SOUND_GAP_MS) return;
    this.lastSound.set(sound, this.time.now);
    gameContext().audio?.play(sound, sound === 'craft' ? 0.4 : 0.55);
  }

  /** Show an effect for something at a cell, if the colony can see that cell. */
  private effectAt(x: number, y: number, show: () => void): void {
    if (this.session.world.isVisible(x, y) && this.inView(x, y)) show();
  }

  private inView(x: number, y: number): boolean {
    const view = this.cameraControl.view;
    const px = (x + 0.5) * TILE_SIZE;
    const py = (y + 0.5) * TILE_SIZE;
    return px >= view.x - TILE_SIZE && px <= view.x + view.width + TILE_SIZE && py >= view.y - TILE_SIZE && py <= view.y + view.height + TILE_SIZE;
  }

  // ---- Resizing, debug, cleanup -------------------------------------------------------------

  private onResize(): void {
    const { width, height, scale } = this.lastSize;
    this.cameras.main.setSize(this.scale.width, this.scale.height);
    this.cameraControl.handleResize(width, height, scale);
    this.lastSize = { width: this.scale.width, height: this.scale.height, scale: this.cameraControl.scale };
    this.hoverDirty = true;
  }

  /** The debug overlay's "show light levels" option swaps the fog for the light map. */
  private updateLightView(frameMs: number): void {
    const context = gameContext();
    const on = context.debugVisible && context.debugLight;
    this.fog.showLight(on ? this.session.sim.lighting.light : null);
    if (!on) return;
    this.lightViewElapsedMs += frameMs;
    if (this.lightViewElapsedMs < LIGHT_VIEW_REFRESH_MS) return;
    this.lightViewElapsedMs = 0;
    this.fog.refreshAll();
  }

  /** Chunk borders, two device pixels wide at any zoom. */
  private drawChunkGrid(): void {
    const zoom = this.cameraControl.scale;
    this.chunkGrid.setVisible(true);
    if (zoom === this.gridZoom) return;
    this.gridZoom = zoom;
    const world = this.session.world;
    const size = CHUNK_SIZE * TILE_SIZE;
    this.chunkGrid.clear();
    this.chunkGrid.lineStyle(2 / zoom, 0xff4fd8, 0.6);
    for (let cx = 0; cx <= world.chunkCols; cx++) this.chunkGrid.lineBetween(cx * size, 0, cx * size, world.height * TILE_SIZE);
    for (let cy = 0; cy <= world.chunkRows; cy++) this.chunkGrid.lineBetween(0, cy * size, world.width * TILE_SIZE, cy * size);
  }

  private reportStats(time: number, frameMs: number): void {
    const { session } = this;
    const { sim } = session;
    if (time - this.rateWindowStart >= 1000) {
      this.ticksPerSecond = ((sim.tick - this.rateWindowTick) * 1000) / (time - this.rateWindowStart);
      this.rateWindowStart = time;
      this.rateWindowTick = sim.tick;
    }
    this.statsElapsedMs += frameMs;
    if (this.statsElapsedMs < STATS_INTERVAL_MS) return;
    this.statsElapsedMs = 0;
    const view = this.cameraControl.view;
    let blocked = 0;
    for (const job of sim.jobs.all()) if (job.blocked) blocked++;
    const { searches, cacheHits, busy } = sim.paths.stats;
    gameContext().reportDebugStats({
      fps: this.game.loop.actualFps,
      frameMs,
      tickCostMs: session.tickCostMs,
      tick: sim.tick,
      ticksPerSecond: this.ticksPerSecond,
      droppedMs: session.clock.droppedMs,
      canvasWidth: this.scale.width,
      canvasHeight: this.scale.height,
      dpr: gameContext().dpr,
      zoom: this.cameraControl.scale,
      cameraTile: {
        x: Math.floor((view.x + view.width / 2) / TILE_SIZE),
        y: Math.floor((view.y + view.height / 2) / TILE_SIZE),
      },
      cursorTile: this.hovered,
      chunksDrawn: this.worldView.drawnChunks,
      chunkLayers: this.worldView.pooledChunks,
      jobs: { ...sim.jobs.counts(), blocked },
      paths: { searches, cacheHits, busy, cached: sim.paths.cachedPaths },
      homeCells: { ...sim.homeMaps.sizes },
      rooms: sim.rooms.size,
      daylight: sim.daylight,
      creatures: {
        hostile: sim.hostileCount,
        animals: sim.creatures.length - sim.hostileCount,
        missiles: sim.projectiles.activeCount,
      },
      threat: {
        spawned: sim.spawner.nightSpawned,
        budget: sim.spawner.nightBudget(sim.time.day(sim.tick)),
        waveDay: sim.spawner.nextWaveDay(),
      },
    });
  }

  private teardown(): void {
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.cameraControl.destroy();
    this.worldView.destroy();
    this.dwarfSprites.destroy();
    this.creatureSprites.destroy();
    this.combat.destroy();
    this.healthBars.destroy();
    this.itemSprites.destroy();
    this.furnitureSprites.destroy();
    this.plans.destroy();
    this.cracks.destroy();
    this.colonyDebug.destroy();
    this.selection.destroy();
    this.fog.destroy();
    this.sky.destroy();
    this.dragFrom = null;
    this.dragTo = null;
    this.hovered = null;
  }
}

/** The middle of a cell, in world pixels. */
function cx(x: number): number {
  return (x + 0.5) * TILE_SIZE;
}

function cy(y: number): number {
  return (y + 0.5) * TILE_SIZE;
}

/** What a job's mark shows in one of its cells: on furniture, the icon goes in its bottom-left cell only. */
function markKind(job: Job, x: number, y: number): MarkKind {
  switch (job.type) {
    case 'dig':
      return 'dig';
    case 'chop':
      return 'chop';
    case 'dismantle':
      return x === job.x && y === job.y ? 'dismantle' : 'plain';
    case 'place':
      return x === job.x && y === job.y ? 'build' : 'plain';
    default:
      return 'build';
  }
}
