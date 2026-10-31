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
