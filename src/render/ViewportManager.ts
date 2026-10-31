/**
 * Keeps the Phaser canvas filling the window at full device resolution.
 *
 * The canvas's CSS size is pinned to its container by the stylesheet (ui.css); this class
 * sizes the drawing buffer to CSS size x devicePixelRatio (see core/viewport.ts) whenever
 * the window is resized, the browser zoom changes, or the window moves to a screen with a
 * different pixel density. Phaser then emits its usual RESIZE event, and scenes re-fit
 * their cameras.
 */
import type * as Phaser from 'phaser';
import { backingStoreSize, effectiveDpr } from '../core/viewport';

export class ViewportManager {
  private readonly game: Phaser.Game;
  private readonly container: HTMLElement;
  private readonly observer: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private frameRequest = 0;
  private currentDpr = 1;

  constructor(game: Phaser.Game, container: HTMLElement) {
    this.game = game;
    this.container = container;
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(container);
    this.watchPixelRatio();
    this.apply();
  }

  /** The devicePixelRatio the canvas is currently rendered at. */
  get dpr(): number {
    return this.currentDpr;
  }

  /** Canvas size in device pixels for the container's current CSS size. */
  static measure(container: HTMLElement): { width: number; height: number; dpr: number } {
    const dpr = effectiveDpr(window.devicePixelRatio);
    const rect = container.getBoundingClientRect();
    return { ...backingStoreSize(rect.width, rect.height, dpr), dpr };
  }

  destroy(): void {
    this.observer.disconnect();
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    cancelAnimationFrame(this.frameRequest);
  }

  /** Coalesce bursts of resize notifications into one resize per frame. */
  private schedule(): void {
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.apply();
    });
  }

  private apply(): void {
    const { width, height, dpr } = ViewportManager.measure(this.container);
    const pixelRatioChanged = dpr !== this.currentDpr;
    this.currentDpr = dpr;
    const scale = this.game.scale;
    if (pixelRatioChanged || scale.width !== width || scale.height !== height) {
      scale.resize(width, height);
    }
  }

  /** devicePixelRatio has no change event; a resolution media query that matches the current ratio does. */
  private watchPixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private readonly onPixelRatioChange = (): void => {
    this.watchPixelRatio();
    this.schedule();
  };
}
