/**
 * Cracks that spread through a block while a dwarf digs it, in four stages, so the
 * player can see how far along each dig is. One pooled sprite per dig in progress.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { Simulation } from '../../sim/Simulation';
import { CRACK_FRAMES } from '../assets/colonyArt';
import { DEPTH } from '../depths';

export class WorkCracks {
  private readonly scene: Phaser.Scene;
  private readonly pool: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(sim: Simulation): void {
    let used = 0;
    for (const dwarf of sim.dwarves) {
      if (dwarf.phase !== 'working' || dwarf.jobId === 0) continue;
      const job = sim.jobs.get(dwarf.jobId);
      if (!job || job.type !== 'dig' || job.progress === 0) continue;
      const stage = Math.min(CRACK_FRAMES - 1, Math.floor(sim.jobProgress(job) * CRACK_FRAMES));
      let image = this.pool[used];
      if (!image) {
        image = this.scene.add.image(0, 0, 'cracks', 0).setOrigin(0, 0).setDepth(DEPTH.cracks);
        this.pool.push(image);
      }
      used++;
      image.setFrame(stage).setPosition(job.x * TILE_SIZE, job.y * TILE_SIZE).setVisible(true);
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.setVisible(false);
  }

  destroy(): void {
    for (const image of this.pool) image.destroy();
    this.pool.length = 0;
  }
}
