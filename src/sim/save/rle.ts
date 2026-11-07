/**
 * Run-length encoding of a world grid, chunk by chunk. Each chunk's cells (row by row
 * inside the chunk) become runs of one value: a chunk of solid stone is a single run, and a
 * whole world packs down to a few kilobytes before gzip even starts. Chunks are encoded
 * one after another in chunk order, each as its number of runs followed by
 * (value, length) pairs, all as 16-bit numbers.
 *
 * Pure: no Phaser and no DOM.
 */

/** A grid's values, readable by cell index. */
export interface GridValues {
  readonly length: number;
  readonly [index: number]: number;
}

/** A grid to decode into. */
export interface WritableGrid {
  readonly length: number;
  [index: number]: number;
}

/** Encode a width x height grid of 16-bit values, chunk by chunk. */
export function encodeChunks(values: GridValues, width: number, height: number, chunkSize: number): Uint16Array {
  const out: number[] = [];
  forEachChunk(width, height, chunkSize, (x0, y0, x1, y1) => {
    const countAt = out.length;
    out.push(0);
    let runs = 0;
    let value = -1;
    let length = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const v = values[y * width + x]!;
        if (v === value && length < 0xffff) {
          length++;
          continue;
        }
        if (length > 0) {
          out.push(value, length);
          runs++;
        }
        value = v;
        length = 1;
      }
    }
    out.push(value, length);
    runs++;
    out[countAt] = runs;
  });
  return Uint16Array.from(out);
}

/** Decode what `encodeChunks` made into `into`. Throws if the data doesn't fit the grid. */
export function decodeChunks(data: Uint16Array, into: WritableGrid, width: number, height: number, chunkSize: number): void {
  if (into.length !== width * height) throw new Error('Grid size does not match');
  let at = 0;
  const next = (): number => {
    if (at >= data.length) throw new Error('Run-length data ends too soon');
    return data[at++]!;
  };
  forEachChunk(width, height, chunkSize, (x0, y0, x1, y1) => {
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1);
    let runs = next();
    let filled = 0;
    let value = 0;
    let left = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (left === 0) {
          if (runs-- === 0) throw new Error('A chunk has too few runs');
          value = next();
          left = next();
          if (left === 0) throw new Error('A run is empty');
        }
        into[y * width + x] = value;
        left--;
        filled++;
      }
    }
    if (left !== 0 || runs !== 0 || filled !== cells) throw new Error('A chunk has too many runs');
  });
  if (at !== data.length) throw new Error('Run-length data is longer than the grid');
}

function forEachChunk(width: number, height: number, size: number, visit: (x0: number, y0: number, x1: number, y1: number) => void): void {
  for (let cy = 0; cy * size < height; cy++) {
    for (let cx = 0; cx * size < width; cx++) {
      visit(cx * size, cy * size, Math.min(width, (cx + 1) * size) - 1, Math.min(height, (cy + 1) * size) - 1);
    }
  }
}
