/**
 * The rectangle dragged out with a toolbar tool, tinted by what it will do: dig and chop
 * marks in the priority's colour, cancelling in red, re-prioritising in white.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { Priority } from '../../sim/jobs/JobBoard';
import type { CellRect } from '../../sim/world/World';
import type { Tool } from '../../ui/state';
import { PRIORITY_COLOURS } from '../assets/colonyArt';
import { DEPTH } from '../depths';

const CANCEL_COLOUR = 0xff6a55;
const PRIORITY_TOOL_COLOUR = 0xf4f1ea;

export class SelectionBox {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH.selection);
  }

  /** `zoom` keeps the outline two device pixels wide. */
  show(rect: CellRect, tool: Tool, priority: Priority, zoom: number): void {
    const colour =
      tool === 'cancel' ? CANCEL_COLOUR : tool === 'priority' ? PRIORITY_TOOL_COLOUR : Number.parseInt(PRIORITY_COLOURS[priority].slice(1), 16);
    const x = Math.min(rect.x0, rect.x1) * TILE_SIZE;
    const y = Math.min(rect.y0, rect.y1) * TILE_SIZE;
    const width = (Math.abs(rect.x1 - rect.x0) + 1) * TILE_SIZE;
    const height = (Math.abs(rect.y1 - rect.y0) + 1) * TILE_SIZE;
    const line = 2 / zoom;
    this.graphics.clear();
    this.graphics.fillStyle(colour, 0.14);
    this.graphics.fillRect(x, y, width, height);
    this.graphics.lineStyle(line, colour, 0.95);
    this.graphics.strokeRect(x + line / 2, y + line / 2, width - line, height - line);
  }

  hide(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
