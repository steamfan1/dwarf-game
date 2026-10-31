/**
 * The in-game scene. Each animation frame it:
 *   1. hands the frame's real time to the session, which runs 0..n fixed simulation ticks;
 *   2. draws every entity at its position blended between the last two ticks (alpha),
 *      so motion is smooth at any frame rate while the simulation stays at 20 ticks/s.
 *
 * Milestone 0: a strip of ground and the placeholder walker. Milestone 1 replaces this
 * with the generated world, chunked tilemaps and the camera controls.
 */
import * as Phaser from 'phaser';
import { gameContext } from '../../app/context';
import { DEFAULT_ZOOM, TILE_SIZE } from '../../config';
import { deviceZoom } from '../../core/viewport';
import type { GameSession } from '../../sim/GameSession';
import { SceneKeys } from './keys';

/** World-pixel y of the top of the ground strip. */
const GROUND_Y = 0;
const GROUND_LEFT_TILES = -40;
const GROUND_WIDTH_TILES = 100;
/** The point the camera looks at: the middle of the walker's patrol, a little above the ground. */
const FOCUS = { x: 8.5 * TILE_SIZE, y: GROUND_Y - 2 * TILE_SIZE };
const STATS_INTERVAL_MS = 250;

export class GameScene extends Phaser.Scene {
  private walker!: Phaser.GameObjects.Sprite;
  private statsElapsedMs = 0;
  private rateWindowStart = 0;
  private rateWindowTick = 0;
  private ticksPerSecond = 0;

  constructor() {
    super(SceneKeys.game);
  }

  create(): void {
    this.cameras.main.setOrigin(0, 0).setBackgroundColor('#6d9ccc');

    const left = GROUND_LEFT_TILES * TILE_SIZE;
    const width = GROUND_WIDTH_TILES * TILE_SIZE;
    this.add.tileSprite(left, GROUND_Y, width, TILE_SIZE, 'groundGrass').setOrigin(0, 0);
    this.add.tileSprite(left, GROUND_Y + TILE_SIZE, width, TILE_SIZE * 12, 'groundDirt').setOrigin(0, 0);
    this.walker = this.add.sprite(0, GROUND_Y + 2, 'dwarf', 0).setOrigin(0.5, 1);

    this.rateWindowStart = this.time.now;
    this.rateWindowTick = gameContext().session?.sim.tick ?? 0;

    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    });
  }

  override update(time: number, delta: number): void {
    const context = gameContext();
    const session = context.session;
    if (!session) return;

    session.frame(delta);
    this.drawWalker(session);

    if (context.debugVisible) this.reportStats(session, time, delta);
  }

  private drawWalker(session: GameSession): void {
    const { walker } = session.sim;
    const zoom = this.cameras.main.zoom;
    const tileX = walker.prevX + (walker.x - walker.prevX) * session.alpha;
    // Snap to whole device pixels: smooth motion, but never a blurry half-pixel.
    const x = Math.round((tileX * TILE_SIZE + TILE_SIZE / 2) * zoom) / zoom;
    this.walker.setPosition(x, GROUND_Y + 2);
    this.walker.setFlipX(walker.direction === -1);

    const speed = session.time.effectiveSpeed;
    if (walker.walking && speed > 0) {
      this.walker.anims.timeScale = speed;
      if (!this.walker.anims.isPlaying) this.walker.play('dwarfWalk');
    } else if (speed === 0) {
      if (this.walker.anims.isPlaying) this.walker.anims.pause();
    } else {
      this.walker.anims.stop();
      this.walker.setFrame(0);
    }
    if (speed > 0 && this.walker.anims.isPaused) this.walker.anims.resume();
  }

  /** Integer zoom for crisp pixels, with the camera scrolled to whole device pixels. */
  private fitCamera(): void {
    const camera = this.cameras.main;
    const zoom = deviceZoom(DEFAULT_ZOOM, gameContext().dpr);
    camera.setSize(this.scale.width, this.scale.height);
    camera.setZoom(zoom);
    const viewWidth = this.scale.width / zoom;
    const viewHeight = this.scale.height / zoom;
    camera.setScroll(
      Math.round((FOCUS.x - viewWidth / 2) * zoom) / zoom,
      Math.round((FOCUS.y - viewHeight / 2) * zoom) / zoom,
    );
  }

  private reportStats(session: GameSession, time: number, delta: number): void {
    if (time - this.rateWindowStart >= 1000) {
      this.ticksPerSecond = ((session.sim.tick - this.rateWindowTick) * 1000) / (time - this.rateWindowStart);
      this.rateWindowStart = time;
      this.rateWindowTick = session.sim.tick;
    }
    this.statsElapsedMs += delta;
    if (this.statsElapsedMs < STATS_INTERVAL_MS) return;
    this.statsElapsedMs = 0;
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
      zoom: this.cameras.main.zoom,
    });
  }
}
