/**
 * Moves the camera over the world:
 *  - WASD / arrow keys (rebindable), Shift to go faster;
 *  - resting the pointer at a screen edge, when "edge panning" is on in Settings;
 *  - dragging with the middle mouse button;
 *  - mouse wheel (or + / -) to zoom between the whole-number zoom levels, keeping the
 *    point under the pointer in place.
 *
 * The camera's zoom is always a whole number of device pixels per world pixel and its
 * scroll is snapped to device pixels, so the pixel art stays crisp (see core/viewport.ts).
 * Camera movement runs on real time, so it works while the game is paused.
 */
import * as Phaser from 'phaser';
import { DEFAULT_ZOOM, TILE_SIZE, ZOOM_LEVELS } from '../config';
import { clampScroll, edgeDirection, scrollAfterZoom, snapToDevicePixel, stepZoom } from '../core/cameraMath';
import type { Settings } from '../core/settings';
import type { Store } from '../core/Store';
import { deviceZoom } from '../core/viewport';
import type { InputActions } from '../platform/InputActions';

/** Pan speed in CSS pixels per second, so it feels the same at every zoom level. */
const PAN_SPEED = 900;
const FAST_MULTIPLIER = 2.2;
/** Width of the screen-edge panning zone, in CSS pixels. */
const EDGE_MARGIN = 14;
/** Trackpads send many small wheel deltas; this much scrolling counts as one zoom step. */
const WHEEL_STEP = 100;

export interface CameraView {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CameraController {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly input: InputActions;
  private readonly settings: Store<Settings>;
  private readonly dpr: () => number;
  private readonly worldWidth: number;
  private readonly worldHeight: number;

  /** CSS pixels per world pixel, one of ZOOM_LEVELS. */
  private zoomLevel = DEFAULT_ZOOM;
  private scrollX = 0;
  private scrollY = 0;
  private dragFrom: { x: number; y: number } | null = null;
  private pointerInside = false;
  private pointer = { x: 0, y: 0 };
  private wheelTotal = 0;
  private shiftHeld = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    worldTiles: { width: number; height: number },
    input: InputActions,
    settings: Store<Settings>,
    dpr: () => number,
  ) {
    this.scene = scene;
    this.camera = scene.cameras.main;
    this.input = input;
    this.settings = settings;
    this.dpr = dpr;
    this.worldWidth = worldTiles.width * TILE_SIZE;
    this.worldHeight = worldTiles.height * TILE_SIZE;
    this.camera.setOrigin(0, 0);
    this.listen();
  }

  /** Device pixels per world pixel right now. */
  get scale(): number {
    return deviceZoom(this.zoomLevel, this.dpr());
  }

  get level(): number {
    return this.zoomLevel;
  }

  /** The visible part of the world, in world pixels. */
  get view(): CameraView {
    const scale = this.scale;
    return { x: this.camera.scrollX, y: this.camera.scrollY, width: this.scene.scale.width / scale, height: this.scene.scale.height / scale };
  }

  /** Centre the view on a tile. */
  centerOnTile(tileX: number, tileY: number): void {
    const scale = this.scale;
    this.scrollX = (tileX + 0.5) * TILE_SIZE - this.scene.scale.width / scale / 2;
    this.scrollY = (tileY + 0.5) * TILE_SIZE - this.scene.scale.height / scale / 2;
    this.apply();
  }

  /** Zoom in (+) or out (-) by whole levels around a screen point (default: the centre). */
  zoomBy(steps: number, anchor?: { x: number; y: number }): void {
    const next = stepZoom(ZOOM_LEVELS, this.zoomLevel, steps);
    if (next === this.zoomLevel) return;
    const at = anchor ?? { x: this.scene.scale.width / 2, y: this.scene.scale.height / 2 };
    const before = this.scale;
    this.zoomLevel = next;
    const after = this.scale;
    this.scrollX = scrollAfterZoom(this.scrollX, at.x, before, after);
    this.scrollY = scrollAfterZoom(this.scrollY, at.y, before, after);
    this.apply();
  }

  /** Keep the same centre after the canvas is resized or the pixel ratio changes. */
  handleResize(previousWidth: number, previousHeight: number, previousScale: number): void {
    const centreX = this.scrollX + previousWidth / previousScale / 2;
    const centreY = this.scrollY + previousHeight / previousScale / 2;
    const scale = this.scale;
    this.scrollX = centreX - this.scene.scale.width / scale / 2;
    this.scrollY = centreY - this.scene.scale.height / scale / 2;
    this.apply();
  }

  /** Call every frame with the real (not game-speed) frame time. */
  update(deltaMs: number): void {
    const seconds = Math.min(deltaMs, 100) / 1000;
    let dx = (this.input.isDown('panRight') ? 1 : 0) - (this.input.isDown('panLeft') ? 1 : 0);
    let dy = (this.input.isDown('panDown') ? 1 : 0) - (this.input.isDown('panUp') ? 1 : 0);

    if (this.dragFrom === null && this.pointerInside && this.settings.get().edgePan && document.hasFocus()) {
      const margin = EDGE_MARGIN * this.dpr();
      dx = dx || edgeDirection(this.pointer.x, this.scene.scale.width, margin);
      dy = dy || edgeDirection(this.pointer.y, this.scene.scale.height, margin);
    }

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      const speed = (PAN_SPEED * (this.shiftHeld ? FAST_MULTIPLIER : 1)) / this.zoomLevel;
      this.scrollX += (dx / length) * speed * seconds;
      this.scrollY += (dy / length) * speed * seconds;
    }
    this.apply();
  }

  destroy(): void {
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
  }

  private apply(): void {
    const scale = this.scale;
    const viewWidth = this.scene.scale.width / scale;
    const viewHeight = this.scene.scale.height / scale;
    this.scrollX = clampScroll(this.scrollX, viewWidth, this.worldWidth);
    this.scrollY = clampScroll(this.scrollY, viewHeight, this.worldHeight);
    this.camera.setZoom(scale);
    this.camera.setScroll(snapToDevicePixel(this.scrollX, scale), snapToDevicePixel(this.scrollY, scale));
  }

  private listen(): void {
    const input = this.scene.input;
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      this.pointerInside = true;
      if (this.dragFrom) {
        const scale = this.scale;
        this.scrollX -= (pointer.x - this.dragFrom.x) / scale;
        this.scrollY -= (pointer.y - this.dragFrom.y) / scale;
        this.dragFrom = { x: pointer.x, y: pointer.y };
      }
      this.pointer = { x: pointer.x, y: pointer.y };
    };
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.middleButtonDown()) this.dragFrom = { x: pointer.x, y: pointer.y };
    };
    const onUp = (pointer: Phaser.Input.Pointer): void => {
      if (!pointer.middleButtonDown()) this.dragFrom = null;
    };
    const onWheel = (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, rawDeltaY: number): void => {
      // Firefox can report the wheel in lines or pages rather than pixels.
      const mode = pointer.event instanceof WheelEvent ? pointer.event.deltaMode : 0;
      const deltaY = rawDeltaY * (mode === 1 ? 40 : mode === 2 ? 800 : 1);
      this.wheelTotal += deltaY;
      if (Math.abs(this.wheelTotal) < WHEEL_STEP && Math.abs(deltaY) < WHEEL_STEP) return;
      const steps = this.wheelTotal < 0 ? 1 : -1;
      this.wheelTotal = 0;
      this.zoomBy(steps, { x: pointer.x, y: pointer.y });
    };
    const onOut = (): void => {
      this.pointerInside = false;
    };
    const onOver = (): void => {
      this.pointerInside = true;
    };
    input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    input.on(Phaser.Input.Events.POINTER_UP, onUp);
    input.on(Phaser.Input.Events.POINTER_WHEEL, onWheel);
    input.on(Phaser.Input.Events.GAME_OUT, onOut);
    input.on(Phaser.Input.Events.GAME_OVER, onOver);
    this.cleanup.push(() => {
      input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      input.off(Phaser.Input.Events.POINTER_UP, onUp);
      input.off(Phaser.Input.Events.POINTER_WHEEL, onWheel);
      input.off(Phaser.Input.Events.GAME_OUT, onOut);
      input.off(Phaser.Input.Events.GAME_OVER, onOver);
    });

    this.cleanup.push(this.input.onPressed('zoomIn', () => this.zoomBy(1)));
    this.cleanup.push(this.input.onPressed('zoomOut', () => this.zoomBy(-1)));

    // Shift isn't a bindable action (it's a modifier), so track it directly for "pan faster".
    const onKey = (event: KeyboardEvent): void => {
      this.shiftHeld = event.shiftKey;
    };
    const onBlur = (): void => {
      this.shiftHeld = false;
      this.pointerInside = false;
      this.dragFrom = null;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    });
  }
}
