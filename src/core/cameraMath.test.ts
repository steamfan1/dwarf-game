import { describe, expect, it } from 'vitest';
import { cellsOnLine, chunkRange, clampScroll, edgeDirection, inChunkRange, phaserScroll, scrollAfterZoom, snapToDevicePixel, stepZoom } from './cameraMath';

describe('camera maths', () => {
  it('clamps the view inside the world, or centres it when the view is larger', () => {
    expect(clampScroll(-50, 100, 1000)).toBe(0);
    expect(clampScroll(950, 100, 1000)).toBe(900);
    expect(clampScroll(400, 100, 1000)).toBe(400);
    expect(clampScroll(0, 1200, 1000)).toBe(-100);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const scroll = 100;
    const anchor = 300; // screen px
    const before = scroll + anchor / 2; // world point under the cursor at scale 2
    const after = scrollAfterZoom(scroll, anchor, 2, 4);
    expect(after + anchor / 4).toBeCloseTo(before, 10);
  });

  it('snaps scroll positions to whole device pixels', () => {
    expect(snapToDevicePixel(10.3, 3)).toBeCloseTo(10.333333, 5);
    expect(snapToDevicePixel(10.3, 1)).toBe(10);
  });

  it('detects the screen edges', () => {
    expect(edgeDirection(5, 800, 12)).toBe(-1);
    expect(edgeDirection(400, 800, 12)).toBe(0);
    expect(edgeDirection(795, 800, 12)).toBe(1);
  });

  it('steps through zoom levels without leaving the list', () => {
    expect(stepZoom([1, 2, 3, 4], 2, 1)).toBe(3);
    expect(stepZoom([1, 2, 3, 4], 4, 1)).toBe(4);
    expect(stepZoom([1, 2, 3, 4], 1, -3)).toBe(1);
  });

  it('lists every cell on a line, ends included', () => {
    expect(cellsOnLine(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(cellsOnLine(0, 0, 2, 2)).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(cellsOnLine(5, 5, 5, 5)).toEqual([[5, 5]]);
    const steep = cellsOnLine(0, 0, 1, 4);
    expect(steep[0]).toEqual([0, 0]);
    expect(steep.at(-1)).toEqual([1, 4]);
    expect(steep).toHaveLength(5);
  });

  it('finds the chunks a view touches, with a margin, inside the world', () => {
    const view = { x: 600, y: 100, width: 640, height: 360 };
    // 512-px chunks in a 13 x 7 world: the view spans columns 1-2 and rows 0.
    expect(chunkRange(view, 512, 13, 7, 0)).toEqual({ cx0: 1, cy0: 0, cx1: 2, cy1: 0 });
    // A 128-px margin reaches column 0 on the left and row 1 below (460 + 128 > 512).
    expect(chunkRange(view, 512, 13, 7, 128)).toEqual({ cx0: 0, cy0: 0, cx1: 2, cy1: 1 });
    // Clamped at the world's far corner.
    expect(chunkRange({ x: 6000, y: 3000, width: 640, height: 360 }, 512, 13, 7, 512)).toEqual({ cx0: 10, cy0: 4, cx1: 12, cy1: 6 });
    const range = chunkRange(view, 512, 13, 7, 0);
    expect(inChunkRange(range, 2, 0)).toBe(true);
    expect(inChunkRange(range, 3, 0)).toBe(false);
  });

  it("converts the view's corner into Phaser's centre-based scroll", () => {
    // Phaser shows world x at screen x = (x - scroll - W/2) * zoom + W/2.
    const screenX = (worldX: number, scroll: number, width: number, zoom: number): number => (worldX - scroll - width / 2) * zoom + width / 2;
    for (const [width, zoom] of [
      [1280, 2],
      [1281, 3],
      [800, 1],
      [2560, 4],
    ] as const) {
      const scroll = phaserScroll(3344, width, zoom);
      expect(screenX(3344, scroll, width, zoom)).toBeCloseTo(0, 9);
      expect(screenX(3344 + width / zoom, scroll, width, zoom)).toBeCloseTo(width, 9);
    }
    expect(phaserScroll(3344, 1280, 1)).toBe(3344);
  });
});
