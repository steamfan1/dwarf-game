/**
 * Moves the camera over the world:
 *  - WASD / arrow keys (rebindable), Shift to go faster;
 *  - resting the mouse at a screen edge, when "edge panning" is on in Settings;
 *  - dragging with the middle mouse button;
 *  - mouse wheel (or + / -) to zoom between the whole-number zoom levels, keeping the
 *    point under the pointer in place.
 *
 * The camera's zoom is always a whole number of device pixels per world pixel and the
 * view's corner is snapped to device pixels, so the pixel art stays crisp (see
 * core/viewport.ts). Camera movement runs on real time, so it works while the game is
 * paused.
 *
 * Positions here are the world position of the view's top-left corner. Phaser's camera
 * keeps its default origin (the centre), because Phaser computes the visible area
 * (`worldView`, which tilemap culling relies on) as if zoom happens around the centre;
 * `apply()` converts the corner into Phaser's scroll value.
 */
import * as Phaser from 'phaser';
import { DEFAULT_ZOOM, TILE_SIZE, ZOOM_LEVELS } from '../config';
import { clampScroll, edgeDirection, phaserScroll, scrollAfterZoom, snapToDevicePixel, stepZoom } from '../core/cameraMath';
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
  /** World position of the view's top-left corner, before snapping. */
  private left = 0;
  private top = 0;
  /** The same corner snapped to device pixels: what is actually on screen. */
  private shownLeft = 0;
  private shownTop = 0;
  private dragFrom: { x: number; y: number } | null = null;
  /**
   * Where the mouse is, for edge panning, taken from the browser's own pointer events
   * rather than from Phaser's pointer. Phaser only hears about the mouse while it moves
   * over the canvas, so after a click on an HTML dialog its pointer can still read (0, 0),
   * a screen corner, and the camera would drift off on its own. This is null until the
   * mouse has really moved in the window, and again once it leaves the window.
   */
  private mouse: { clientX: number; clientY: number; overGame: boolean } | null = null;
  /** The canvas's place on the page, cached between resizes. */
  private canvasRect: DOMRect | null = null;
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
    return { x: this.shownLeft, y: this.shownTop, width: this.scene.scale.width / scale, height: this.scene.scale.height / scale };
  }

  /** Centre the view on a tile. */
  centerOnTile(tileX: number, tileY: number): void {
    const scale = this.scale;
    this.left = (tileX + 0.5) * TILE_SIZE - this.scene.scale.width / scale / 2;
    this.top = (tileY + 0.5) * TILE_SIZE - this.scene.scale.height / scale / 2;
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
    this.left = scrollAfterZoom(this.left, at.x, before, after);
    this.top = scrollAfterZoom(this.top, at.y, before, after);
    this.apply();
  }

  /** Keep the same centre after the canvas is resized or the pixel ratio changes. */
  handleResize(previousWidth: number, previousHeight: number, previousScale: number): void {
    this.canvasRect = null;
    const centreX = this.left + previousWidth / previousScale / 2;
    const centreY = this.top + previousHeight / previousScale / 2;
    const scale = this.scale;
    this.left = centreX - this.scene.scale.width / scale / 2;
    this.top = centreY - this.scene.scale.height / scale / 2;
    this.apply();
  }

  /** Call every frame with the real (not game-speed) frame time. */
  update(deltaMs: number): void {
    const seconds = Math.min(deltaMs, 100) / 1000;
    let dx = (this.input.isDown('panRight') ? 1 : 0) - (this.input.isDown('panLeft') ? 1 : 0);
    let dy = (this.input.isDown('panDown') ? 1 : 0) - (this.input.isDown('panUp') ? 1 : 0);

    const edge = this.edgePanDirection();
    if (edge) {
      dx = dx || edge.dx;
      dy = dy || edge.dy;
    }

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      const speed = (PAN_SPEED * (this.shiftHeld ? FAST_MULTIPLIER : 1)) / this.zoomLevel;
      this.left += (dx / length) * speed * seconds;
      this.top += (dy / length) * speed * seconds;
    }
    this.apply();
  }

  destroy(): void {
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
  }

  /**
   * Which way the mouse is pushing at the screen edges, or null when edge panning doesn't
   * apply: it's off in Settings, the mouse isn't over the game (it's outside the window or
   * over an HTML panel), a dialog is open, the window isn't focused, or a drag is going on.
   */
  private edgePanDirection(): { dx: number; dy: number } | null {
    const mouse = this.mouse;
    if (!mouse || !mouse.overGame || this.dragFrom !== null) return null;
    if (!this.settings.get().edgePan || !this.input.allows('panLeft') || !document.hasFocus()) return null;
    const rect = (this.canvasRect ??= this.scene.game.canvas.getBoundingClientRect());
    return {
      dx: edgeDirection(mouse.clientX - rect.left, rect.width, EDGE_MARGIN),
      dy: edgeDirection(mouse.clientY - rect.top, rect.height, EDGE_MARGIN),
    };
  }

  private apply(): void {
    const scale = this.scale;
    const { width, height } = this.scene.scale;
    this.left = clampScroll(this.left, width / scale, this.worldWidth);
    this.top = clampScroll(this.top, height / scale, this.worldHeight);
    this.shownLeft = snapToDevicePixel(this.left, scale);
    this.shownTop = snapToDevicePixel(this.top, scale);
    this.camera.setZoom(scale);
    this.camera.setScroll(phaserScroll(this.shownLeft, width, scale), phaserScroll(this.shownTop, height, scale));
  }

  private listen(): void {
    const input = this.scene.input;
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      if (!this.dragFrom) return;
      const scale = this.scale;
      this.left -= (pointer.x - this.dragFrom.x) / scale;
      this.top -= (pointer.y - this.dragFrom.y) / scale;
      this.dragFrom = { x: pointer.x, y: pointer.y };
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
    input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    input.on(Phaser.Input.Events.POINTER_UP, onUp);
    input.on(Phaser.Input.Events.POINTER_WHEEL, onWheel);
    this.cleanup.push(() => {
      input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      input.off(Phaser.Input.Events.POINTER_UP, onUp);
      input.off(Phaser.Input.Events.POINTER_WHEEL, onWheel);
    });

    // The mouse for edge panning (see `mouse`). Capture-phase listeners on the window see
    // every mouse event, wherever it lands; touch and pen never pan at the edges.
    const canvas = this.scene.game.canvas;
    const onPointer = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      this.mouse = { clientX: event.clientX, clientY: event.clientY, overGame: event.target === canvas };
    };
    const onMouseOut = (event: MouseEvent): void => {
      // No related target means the mouse left the window altogether.
      if (event.relatedTarget === null) this.mouse = null;
    };
    const listenerOptions = { capture: true, passive: true } as const;
    for (const type of ['pointermove', 'pointerdown', 'pointerover'] as const) {
      window.addEventListener(type, onPointer, listenerOptions);
      this.cleanup.push(() => window.removeEventListener(type, onPointer, listenerOptions));
    }
    window.addEventListener('mouseout', onMouseOut, listenerOptions);
    this.cleanup.push(() => window.removeEventListener('mouseout', onMouseOut, listenerOptions));

    this.cleanup.push(this.input.onPressed('zoomIn', () => this.zoomBy(1)));
    this.cleanup.push(this.input.onPressed('zoomOut', () => this.zoomBy(-1)));

    // Shift isn't a bindable action (it's a modifier), so track it directly for "pan faster".
    const onKey = (event: KeyboardEvent): void => {
      this.shiftHeld = event.shiftKey;
    };
    const onBlur = (): void => {
      this.shiftHeld = false;
      this.mouse = null;
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
