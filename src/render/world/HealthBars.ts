/**
 * Small health bars over hurt dwarves and creatures, redrawn every frame into one
 * Graphics object (a dozen rectangles at most, so cheap). Two device pixels thick at any
 * zoom would be nicer, but at these sizes whole world pixels read fine.
 */
import type * as Phaser from 'phaser';
import { DEPTH } from '../depths';

const WIDTH = 12;
const HEIGHT = 2;

export class HealthBars {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH.carried);
  }

  /** Call once per frame before drawing the bars. */
  clear(): void {
    this.graphics.clear();
  }

  /** A bar centred on world point (x, y), filled to `fraction`: green, then amber, then red. */
  draw(x: number, y: number, fraction: number): void {
    const f = Math.max(0, Math.min(1, fraction));
    const left = Math.round(x - WIDTH / 2);
    const top = Math.round(y);
    const g = this.graphics;
    g.fillStyle(0x140d0a, 0.85);
    g.fillRect(left - 1, top - 1, WIDTH + 2, HEIGHT + 2);
    g.fillStyle(f > 0.6 ? 0x6fcf4a : f > 0.3 ? 0xf2b23a : 0xe2482a, 1);
    g.fillRect(left, top, Math.max(1, Math.round(WIDTH * f)), HEIGHT);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
