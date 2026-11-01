/**
 * Debug overlay for the colony: each dwarf's remaining path (cyan) and a line to the job
 * it has reserved (gold). Drawn only while the debug overlay is open.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { Simulation } from '../../sim/Simulation';
import { DEPTH } from '../depths';
import type { DwarfSprites } from './DwarfSprites';

const PATH_COLOUR = 0x5ee7ff;
const JOB_COLOUR = 0xffd166;

export class ColonyDebug {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH.debug);
  }

  draw(sim: Simulation, sprites: DwarfSprites, alpha: number, zoom: number): void {
    const g = this.graphics;
    const width = sim.world.width;
    const centre = (cell: number): [number, number] => {
      const x = cell % width;
      return [(x + 0.5) * TILE_SIZE, ((cell - x) / width + 0.5) * TILE_SIZE];
    };
    g.clear();
    for (const dwarf of sim.dwarves) {
      const place = sprites.placeOf(dwarf, alpha);
      const from: [number, number] = [(place.x + 0.5) * TILE_SIZE, (place.y + 0.5) * TILE_SIZE];
      if (dwarf.path && dwarf.pathIndex < dwarf.path.length) {
        g.lineStyle(2 / zoom, PATH_COLOUR, 0.85);
        g.beginPath();
        g.moveTo(from[0], from[1]);
        for (let i = dwarf.pathIndex; i < dwarf.path.length; i++) {
          const [x, y] = centre(dwarf.path[i]!);
          g.lineTo(x, y);
        }
        g.strokePath();
      }
      const job = dwarf.jobId !== 0 ? sim.jobs.get(dwarf.jobId) : undefined;
      if (job) {
        g.lineStyle(1 / zoom, JOB_COLOUR, 0.9);
        g.lineBetween(from[0], from[1], (job.x + 0.5) * TILE_SIZE, (job.y + 0.5) * TILE_SIZE);
        g.strokeRect(job.x * TILE_SIZE + 1, job.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      }
    }
  }

  hide(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
