import { describe, expect, it } from 'vitest';
import { FURNITURE } from '../../sim/content';
import { FURNITURE_STYLES } from '../../sim/furniture/FurnitureRegistry';
import { furnitureFrames, paintFurniture } from './furnitureArt';

/** A stand-in 2D context that records every rectangle painted. */
function recordingContext(): { ctx: CanvasRenderingContext2D; rects: Array<[number, number, number, number]> } {
  const rects: Array<[number, number, number, number]> = [];
  const ctx = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

describe('furniture art', () => {
  it('paints every piece inside its own frames', () => {
    for (const def of FURNITURE.defs) {
      const { ctx, rects } = recordingContext();
      paintFurniture(ctx, def);
      const frameWidth = def.width * 16;
      expect(rects.length, def.id).toBeGreaterThan(3);
      for (const [x, y, w, h] of rects) {
        const frame = Math.floor(x / frameWidth);
        expect(frame, def.id).toBeLessThan(furnitureFrames(def));
        // Each rectangle stays inside the frame it starts in.
        expect(x + w, def.id).toBeLessThanOrEqual((frame + 1) * frameWidth);
        expect(y, def.id).toBeGreaterThanOrEqual(0);
        expect(y + h, def.id).toBeLessThanOrEqual(def.height * 16);
      }
    }
  });

  it('has a painter for every style furniture.json may name', () => {
    for (const style of FURNITURE_STYLES) {
      const def = FURNITURE.defs.find((d) => d.art.style === style);
      expect(def, style).toBeDefined();
    }
  });
});
