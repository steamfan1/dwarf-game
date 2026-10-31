/**
 * Tiny pixel-art helpers for the runtime-drawn placeholder art.
 *
 * Sprites are written as rows of palette characters, which keeps them readable and easy
 * to tweak in code review:
 *
 *   const rows = ['.kk.', 'kHhk', '.kk.'];
 *   drawPixelRows(ctx, rows, { k: '#000', H: '#fff', h: '#888' }, 0, 0);
 *
 * '.' (or any character missing from the palette) is transparent.
 */

export type Palette = Readonly<Record<string, string>>;

/** Draw character rows at (x, y). With `flipX`, the rows are mirrored horizontally. */
export function drawPixelRows(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  palette: Palette,
  x: number,
  y: number,
  flipX = false,
): void {
  const width = Math.max(...rows.map((row) => row.length));
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const color = palette[row[dx]!];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + (flipX ? width - 1 - dx : dx), y + dy, 1, 1);
    }
  });
}

/** Check that every row has the same width and only uses known palette characters. */
export function validatePixelRows(rows: readonly string[], palette: Palette, expectedWidth?: number): string[] {
  const problems: string[] = [];
  const width = expectedWidth ?? rows[0]?.length ?? 0;
  rows.forEach((row, y) => {
    if (row.length !== width) problems.push(`row ${y} is ${row.length} wide, expected ${width}`);
    for (const ch of row) {
      if (ch !== '.' && !(ch in palette)) problems.push(`row ${y} uses unknown colour '${ch}'`);
    }
  });
  return problems;
}

/** Fill one pixel. */
export function plot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

/** Mix two #rrggbb colours; t = 0 gives `a`, t = 1 gives `b`. */
export function mixColor(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const ch = (i: number): string =>
    Math.round(pa[i]! + (pb[i]! - pa[i]!) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
