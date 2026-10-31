import { describe, expect, it } from 'vitest';
import { cellsOnLine, clampScroll, edgeDirection, scrollAfterZoom, snapToDevicePixel, stepZoom } from './cameraMath';

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
});
