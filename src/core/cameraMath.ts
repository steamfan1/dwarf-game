/**
 * Camera arithmetic, kept pure so it can be tested without a renderer.
 * Positions are in world pixels; `scale` is device pixels per world pixel (the camera zoom).
 */

/** Keep a view inside the world on one axis, or centre it when the view is wider than the world. */
export function clampScroll(scroll: number, viewSize: number, worldSize: number): number {
  if (viewSize >= worldSize) return (worldSize - viewSize) / 2;
  return Math.min(worldSize - viewSize, Math.max(0, scroll));
}

/** The scroll that keeps the world point under `anchor` (screen pixels) fixed while the scale changes. */
export function scrollAfterZoom(scroll: number, anchor: number, oldScale: number, newScale: number): number {
  return scroll + anchor / oldScale - anchor / newScale;
}

/**
 * Phaser zooms a camera around its centre, so its `scroll` is not the world position of
 * the screen's left (or top) edge: zooming pushes part of the scrolled area off each side.
 * This is the scroll that puts world position `edge` at the edge of a screen `screenSize`
 * device pixels long, at `scale` device pixels per world pixel.
 */
export function phaserScroll(edge: number, screenSize: number, scale: number): number {
  return edge - (screenSize - screenSize / scale) / 2;
}

/** Round a scroll position to whole device pixels, so pixel art never lands between pixels. */
export function snapToDevicePixel(scroll: number, scale: number): number {
  return Math.round(scroll * scale) / scale;
}

/** -1, 0 or 1: whether a pointer position lies within `margin` of either end of an axis. */
export function edgeDirection(position: number, size: number, margin: number): -1 | 0 | 1 {
  if (position < margin) return -1;
  if (position > size - margin) return 1;
  return 0;
}

/** Step through a list of zoom levels, staying at the ends. */
export function stepZoom(levels: readonly number[], current: number, steps: number): number {
  const index = levels.indexOf(current);
  const from = index === -1 ? 0 : index;
  return levels[Math.max(0, Math.min(levels.length - 1, from + steps))]!;
}

/** Cells along a straight line between two cells (Bresenham), so a fast drag leaves no gaps. */
export function cellsOnLine(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    cells.push([x, y]);
    if (x === x1 && y === y1) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** An inclusive range of chunk columns and rows. Empty when cx1 < cx0 or cy1 < cy0. */
export interface ChunkRange {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

/**
 * The chunks a view rectangle (world pixels), grown by `margin` pixels on every side,
 * touches, clamped to a world of `cols` x `rows` chunks of `chunkPx` pixels.
 */
export function chunkRange(
  view: { x: number; y: number; width: number; height: number },
  chunkPx: number,
  cols: number,
  rows: number,
  margin: number,
): ChunkRange {
  return {
    cx0: Math.max(0, Math.floor((view.x - margin) / chunkPx)),
    cy0: Math.max(0, Math.floor((view.y - margin) / chunkPx)),
    cx1: Math.min(cols - 1, Math.floor((view.x + view.width + margin) / chunkPx)),
    cy1: Math.min(rows - 1, Math.floor((view.y + view.height + margin) / chunkPx)),
  };
}

export function inChunkRange(range: ChunkRange, cx: number, cy: number): boolean {
  return cx >= range.cx0 && cx <= range.cx1 && cy >= range.cy0 && cy <= range.cy1;
}

