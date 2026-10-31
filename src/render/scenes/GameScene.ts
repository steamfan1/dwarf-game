/**
 * The in-game scene. It draws the session's world and turns pointer input into orders.
 *
 * Each animation frame it:
 *   1. hands the frame's real time to the session, which runs 0..n fixed simulation ticks;
 *   2. moves the camera (real time, so it works while paused) and gives tilemap layers
 *      to the chunks in view (see WorldView);
 *   3. updates the tile cursor, the minimap's view box and, if open, the debug overlay.
 *
 * Changes in the world arrive as events (TileChanged, ExploredChanged) and redraw only
 * the cells concerned; the fog texture is uploaded at most once per frame.
 */
import * as Phaser from 'phaser';
import { gameContext } from '../../app/context';
import { CHUNK_SIZE, TILE_SIZE } from '../../config';
import { cellsOnLine } from '../../core/cameraMath';
import { BIOMES, TILES } from '../../sim/content';
import type { GameSession } from '../../sim/GameSession';
import { TERRAIN_LAYOUT } from '../assets/manifest';
import { CameraController } from '../CameraController';
import { DEPTH } from '../depths';
import { describeCell } from '../world/describeCell';
import { FogOverlay } from '../world/FogOverlay';
import { SkyBackdrop } from '../world/SkyBackdrop';
import { TileCursor } from '../world/TileCursor';
import { WorldView } from '../world/WorldView';
import { SceneKeys } from './keys';

const STATS_INTERVAL_MS = 250;
/** Don't play the dig sound more often than this while dragging. */
const DIG_SOUND_GAP_MS = 70;

export class GameScene extends Phaser.Scene {
  private session!: GameSession;
  private worldView!: WorldView;
  private fog!: FogOverlay;
  private sky!: SkyBackdrop;
  private cursor!: TileCursor;
  private cameraControl!: CameraController;
  private chunkGrid!: Phaser.GameObjects.Graphics;
  private readonly cleanup: Array<() => void> = [];

  private hovered: { x: number; y: number } | null = null;
  private hoverDirty = true;
  private digging = false;
  private lastDug: { x: number; y: number } | null = null;
  private lastDigSound = 0;
  private gridZoom = 0;
  private lastSize = { width: 0, height: 0, scale: 1 };

  private statsElapsedMs = 0;
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
    const world = session.world;
    // Phaser reuses scene instances, so reset per-world state explicitly.
    this.hovered = null;
    this.hoverDirty = true;
    this.digging = false;
    this.lastDug = null;
    this.gridZoom = 0;
    this.statsElapsedMs = 0;

    this.sky = new SkyBackdrop(this, BIOMES.get(world.biome).sky);
    this.worldView = new WorldView(this, world, TILES, TERRAIN_LAYOUT, 'terrain');
    this.add
      .sprite((session.sim.hearth.x + 0.5) * TILE_SIZE, (session.sim.hearth.y + 1) * TILE_SIZE, 'hearth', 0)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.objects)
      .play('hearthFire');
    this.fog = new FogOverlay(this, world);
    this.cursor = new TileCursor(this);
    this.chunkGrid = this.add.graphics().setDepth(DEPTH.debug).setVisible(false);

    this.cameraControl = new CameraController(this, world, context.input, context.settings, () => gameContext().dpr);
    this.cameraControl.centerOnTile(session.sim.hearth.x, session.sim.hearth.y - 2);
    this.lastSize = { width: this.scale.width, height: this.scale.height, scale: this.cameraControl.scale };
    this.worldView.cull(this.cameraControl.view);

    this.cleanup.push(
      session.bus.on('TileChanged', ({ x, y }) => {
        this.worldView.refreshCell(x, y);
        this.hoverDirty = true;
      }),
      session.bus.on('ExploredChanged', (rect) => {
        this.fog.update(rect);
        // A newly explored cell under the pointer has something new to describe.
        this.hoverDirty = true;
      }),
    );
    this.listenForPointer();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    this.rateWindowStart = this.time.now;
    this.rateWindowTick = session.sim.tick;
    context.worldReady({ centerOnTile: (x, y) => this.cameraControl.centerOnTile(x, y) });
  }

  override update(time: number, delta: number): void {
    const context = gameContext();
    this.session.frame(delta);
    this.cameraControl.update(delta);

    const view = this.cameraControl.view;
    this.worldView.cull(view);
    this.fog.flush();
    this.sky.fit(this.scale.width, this.scale.height, this.cameraControl.scale);
    context.reportView({ x: view.x / TILE_SIZE, y: view.y / TILE_SIZE, width: view.width / TILE_SIZE, height: view.height / TILE_SIZE });

    this.refreshHover();
    if (context.debugVisible) {
      this.drawChunkGrid();
      this.reportStats(time, delta);
    } else if (this.chunkGrid.visible) {
      this.chunkGrid.setVisible(false);
    }
  }

  // ---- Pointer: hover and digging ------------------------------------------------------

  private listenForPointer(): void {
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      const cell = this.cellAt(pointer);
      if (!this.hovered || cell.x !== this.hovered.x || cell.y !== this.hovered.y) {
        this.hovered = cell;
        this.hoverDirty = true;
      }
      if (this.digging && pointer.leftButtonDown()) this.digTo(cell);
    };
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.rightButtonDown()) {
        // Right-click cancels whatever the left button was doing.
        this.digging = false;
        return;
      }
      if (!pointer.leftButtonDown()) return;
      this.digging = true;
      this.lastDug = null;
      this.digTo(this.cellAt(pointer));
    };
    const onUp = (pointer: Phaser.Input.Pointer): void => {
      if (!pointer.leftButtonDown()) this.digging = false;
    };
    const onOut = (): void => {
      this.hovered = null;
      this.hoverDirty = true;
    };
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    this.input.on(Phaser.Input.Events.GAME_OUT, onOut);
    this.cleanup.push(() => {
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      this.input.off(Phaser.Input.Events.GAME_OUT, onOut);
    });
  }

  private cellAt(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
  }

  /** Dig every cell from the last dug cell to this one, so a fast drag leaves no gaps. */
  private digTo(cell: { x: number; y: number }): void {
    const from = this.lastDug ?? cell;
    let dugAny = false;
    for (const [x, y] of cellsOnLine(from.x, from.y, cell.x, cell.y)) {
      if (this.session.sim.dig(x, y) === 'dug') dugAny = true;
    }
    this.lastDug = cell;
    if (dugAny && this.time.now - this.lastDigSound > DIG_SOUND_GAP_MS) {
      this.lastDigSound = this.time.now;
      gameContext().audio?.play('dig', 0.7);
    }
  }

  private refreshHover(): void {
    if (!this.hoverDirty) return;
    this.hoverDirty = false;
    const context = gameContext();
    const cell = this.hovered;
    const info = cell ? describeCell(this.session.sim, cell.x, cell.y) : null;
    if (!cell || !info) {
      this.cursor.hide();
      context.reportHover(null);
      return;
    }
    this.cursor.show(cell.x, cell.y, info.diggable ? 'ok' : 'blocked', this.cameraControl.scale);
    context.reportHover(info);
  }

  // ---- Resizing, debug, cleanup -------------------------------------------------------------

  private onResize(): void {
    const { width, height, scale } = this.lastSize;
    this.cameras.main.setSize(this.scale.width, this.scale.height);
    this.cameraControl.handleResize(width, height, scale);
    this.lastSize = { width: this.scale.width, height: this.scale.height, scale: this.cameraControl.scale };
    this.hoverDirty = true;
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

  private reportStats(time: number, delta: number): void {
    const { session } = this;
    if (time - this.rateWindowStart >= 1000) {
      this.ticksPerSecond = ((session.sim.tick - this.rateWindowTick) * 1000) / (time - this.rateWindowStart);
      this.rateWindowStart = time;
      this.rateWindowTick = session.sim.tick;
    }
    this.statsElapsedMs += delta;
    if (this.statsElapsedMs < STATS_INTERVAL_MS) return;
    this.statsElapsedMs = 0;
    const view = this.cameraControl.view;
    gameContext().reportDebugStats({
      fps: this.game.loop.actualFps,
      frameMs: delta,
      tickCostMs: session.tickCostMs,
      tick: session.sim.tick,
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
    });
  }

  private teardown(): void {
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.cameraControl.destroy();
    this.worldView.destroy();
    this.fog.destroy();
    this.sky.destroy();
    this.digging = false;
    this.hovered = null;
  }
}
