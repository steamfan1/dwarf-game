/**
 * The outline drawn around the tile under the mouse: light when the tool can act there,
 * red when not. With a furniture tool it outlines the whole footprint instead.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { DEPTH } from '../depths';

const OK_COLOR = 0xfff3d6;
const BLOCKED_COLOR = 0xff6a55;
const NEUTRAL_COLOR = 0xc8ccd8;

export type CursorState = 'ok' | 'blocked' | 'neutral';

export class TileCursor {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private last = '';

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH.cursor);
  }

  /**
   * Outline `cols` x `rows` cells from (x, y), the top-left one. `zoom` keeps the outline
   * two device pixels wide at any zoom level.
   */
  show(x: number, y: number, state: CursorState, zoom: number, cols = 1, rows = 1): void {
    const key = `${x},${y},${state},${zoom},${cols},${rows}`;
    if (key === this.last) return;
    this.last = key;
    const color = state === 'ok' ? OK_COLOR : state === 'blocked' ? BLOCKED_COLOR : NEUTRAL_COLOR;
    const width = 2 / zoom;
    const w = cols * TILE_SIZE;
    const h = rows * TILE_SIZE;
    this.graphics.clear();
    this.graphics.lineStyle(width, 0x000000, 0.45);
    this.graphics.strokeRect(x * TILE_SIZE - width, y * TILE_SIZE - width, w + width * 2, h + width * 2);
    this.graphics.lineStyle(width, color, 0.95);
    this.graphics.strokeRect(x * TILE_SIZE + width / 2, y * TILE_SIZE + width / 2, w - width, h - width);
  }

  hide(): void {
    if (this.last === '') return;
    this.last = '';
    this.graphics.clear();
  }
}
