/**
 * A minimal PNG reader for checking screenshot pixels in the browser tests. It handles
 * what Chromium's screenshots use: 8-bit RGB or RGBA, not interlaced.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  width: number;
  height: number;
  /** 3 (RGB) or 4 (RGBA) bytes per pixel, rows top to bottom. */
  channels: number;
  data: Uint8Array;
}

export function decodePng(png: Uint8Array): DecodedImage {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [bitDepth, colorType, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      compressed.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? data[row + i - channels]! : 0;
      const up = y > 0 ? data[row - stride + i]! : 0;
      const upLeft = i >= channels && y > 0 ? data[row - stride + i - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        predictor = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      }
      data[row + i] = (raw[line + i]! + predictor) & 255;
    }
  }
  return { width, height, channels, data };
}

/** The [r, g, b] of one pixel. */
export function pixelAt(image: DecodedImage, x: number, y: number): [number, number, number] {
  const o = (Math.round(y) * image.width + Math.round(x)) * image.channels;
  return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!];
}
