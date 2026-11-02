/**
 * Debug overlay for the colony: each dwarf's remaining path (cyan), a line to the job it
 * has reserved (gold), and the rooms, each tinted its own colour. Drawn only while the
 * debug overlay is open; the rooms are redrawn only when they change.
 */
import type * as Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { Simulation } from '../../sim/Simulation';
import { DEPTH } from '../depths';
import type { DwarfSprites } from './DwarfSprites';

const PATH_COLOUR = 0x5ee7ff;
const JOB_COLOUR = 0xffd166;
const ROOM_COLOURS = [0x6be675, 0x6bb5e6, 0xe6c36b, 0xd66be6, 0xe6816b, 0x6be6d1];

export class ColonyDebug {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly roomGraphics: Phaser.GameObjects.Graphics;
  private roomsDrawn = -1;

  constructor(scene: Phaser.Scene) {
    this.roomGraphics = scene.add.graphics().setDepth(DEPTH.debug);
    this.graphics = scene.add.graphics().setDepth(DEPTH.debug);
  }

  draw(sim: Simulation, sprites: DwarfSprites, alpha: number, zoom: number): void {
    this.drawRooms(sim);
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
    this.roomGraphics.clear();
    this.roomsDrawn = -1;
  }

  destroy(): void {
    this.graphics.destroy();
    this.roomGraphics.destroy();
  }

  /** Every room's cells, tinted by room. */
  private drawRooms(sim: Simulation): void {
    const { rooms, world } = sim;
    if (this.roomsDrawn === rooms.version) return;
    this.roomsDrawn = rooms.version;
    const g = this.roomGraphics;
    g.clear();
    for (const room of rooms.all()) {
      g.fillStyle(ROOM_COLOURS[room.id % ROOM_COLOURS.length]!, 0.28);
      for (let y = room.rect.y0; y <= room.rect.y1; y++) {
        for (let x = room.rect.x0; x <= room.rect.x1; x++) {
          if (rooms.roomOf[world.index(x, y)] === room.id) g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }
}
