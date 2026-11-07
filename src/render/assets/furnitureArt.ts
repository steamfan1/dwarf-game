/**
 * Placeholder sprites for furniture, painted from the `art` entry in furniture.json with
 * the Canvas 2D API: a few rectangles per piece, in the piece's base, dark, light and
 * accent colours, with a dark outline. Each piece is `width` x `height` cells of 16 px.
 * Torches flicker through FURNITURE_FRAMES frames; everything else has one frame.
 *
 * Original art. A real sprite sheet can replace any of these through the asset manifest.
 */
import type { FurnitureArt, FurnitureDef, FurnitureStyle } from '../../sim/furniture/FurnitureRegistry';
import { mixColor } from './pixelArt';

/** Animation frames per furniture style (others have one). */
export const FURNITURE_FRAMES: Partial<Record<FurnitureStyle, number>> = { torch: 3, gate: 4 };

export function furnitureFrames(def: FurnitureDef): number {
  return FURNITURE_FRAMES[def.art.style] ?? 1;
}

interface Pen {
  /** Fill a rectangle, in pixels from the frame's top-left corner. */
  rect(x: number, y: number, w: number, h: number, color: string): void;
  /** A rectangle with a one-pixel outline around it. */
  box(x: number, y: number, w: number, h: number, color: string): void;
  colors: { base: string; dark: string; light: string; accent: string; outline: string };
}

function pen(ctx: CanvasRenderingContext2D, ox: number, art: FurnitureArt): Pen {
  const outline = mixColor(art.dark, '#000000', 0.55);
  const rect = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, y, w, h);
  };
  return {
    rect,
    box: (x, y, w, h, color) => {
      rect(x - 1, y - 1, w + 2, h + 2, outline);
      rect(x, y, w, h, color);
    },
    colors: { base: art.base, dark: art.dark, light: art.light, accent: art.accent ?? art.light, outline },
  };
}

type Painter = (p: Pen, frame: number) => void;

const PAINTERS: Record<FurnitureStyle, Painter> = {
  chest: ({ rect, box, colors: c }) => {
    box(2, 6, 12, 9, c.base);
    rect(2, 6, 12, 2, c.light);
    rect(2, 9, 12, 1, c.dark);
    rect(2, 14, 12, 1, c.dark);
    rect(7, 8, 2, 3, c.accent);
    rect(2, 6, 1, 9, c.dark);
    rect(13, 6, 1, 9, c.dark);
  },
  torch: ({ rect, colors: c }, frame) => {
    rect(7, 8, 2, 7, c.base);
    rect(8, 8, 1, 7, c.dark);
    rect(6, 14, 4, 2, c.dark); // bracket
    const flames = [
      [6, 3, 4, 5],
      [6, 2, 4, 6],
      [7, 3, 3, 5],
    ] as const;
    const [fx, fy, fw, fh] = flames[frame % flames.length]!;
    rect(fx, fy, fw, fh, c.accent);
    rect(fx + 1, fy + 1, Math.max(1, fw - 2), fh - 2, c.light);
  },
  workbench: ({ rect, box, colors: c }) => {
    box(1, 6, 30, 3, c.base);
    rect(1, 6, 30, 1, c.light);
    box(3, 9, 3, 6, c.dark);
    box(26, 9, 3, 6, c.dark);
    rect(6, 12, 20, 1, c.dark); // stretcher
    // Tools on top: a saw and a hammer.
    rect(6, 4, 8, 2, c.accent);
    rect(13, 3, 2, 3, c.base);
    rect(20, 3, 4, 2, c.accent);
    rect(21, 5, 1, 1, c.dark);
  },
  furnace: ({ rect, box, colors: c }) => {
    box(3, 6, 26, 25, c.base);
    rect(20, 0, 6, 6, c.dark); // chimney
    // Stone courses.
    for (let y = 8; y < 32; y += 4) rect(3, y, 26, 1, c.dark);
    rect(3, 6, 26, 2, c.light);
    box(9, 17, 14, 10, '#1a1012');
    rect(10, 21, 12, 6, c.accent);
    rect(12, 23, 8, 4, c.light);
  },
  anvil: ({ rect, box, colors: c }) => {
    box(1, 6, 12, 3, c.base);
    rect(1, 6, 12, 1, c.light);
    rect(13, 7, 2, 1, c.base); // horn
    box(5, 9, 5, 3, c.dark);
    box(3, 12, 9, 3, c.accent); // stump
  },
  loom: ({ rect, box, colors: c }) => {
    box(3, 2, 3, 29, c.base);
    box(26, 2, 3, 29, c.base);
    box(3, 2, 26, 3, c.dark);
    for (let x = 8; x <= 24; x += 2) rect(x, 5, 1, 15, c.accent);
    box(7, 19, 18, 5, c.accent);
    rect(7, 19, 18, 1, c.light);
    box(3, 27, 26, 2, c.dark);
  },
  stove: ({ rect, box, colors: c }) => {
    box(2, 10, 28, 21, c.base);
    rect(2, 10, 28, 2, c.light);
    box(22, 1, 5, 9, c.dark); // flue
    box(5, 6, 8, 4, c.dark); // a pot
    rect(6, 5, 6, 1, c.dark);
    box(15, 7, 5, 3, c.dark); // a pan
    box(8, 18, 16, 9, '#1a1012');
    rect(9, 22, 14, 5, c.accent);
    rect(11, 24, 10, 3, c.light);
  },
  bed: ({ rect, box, colors: c }) => {
    box(1, 3, 3, 12, c.dark); // headboard
    box(4, 10, 27, 4, c.base);
    rect(4, 14, 2, 2, c.dark);
    rect(28, 14, 2, 2, c.dark);
    box(5, 7, 25, 3, c.light); // mattress
    box(5, 6, 6, 3, c.light); // pillow
    box(12, 7, 18, 4, c.accent); // blanket
    rect(12, 7, 18, 1, mixColor(c.accent, '#ffffff', 0.3));
  },
  table: ({ rect, box, colors: c }) => {
    box(1, 6, 30, 3, c.base);
    rect(1, 6, 30, 1, c.light);
    box(3, 9, 3, 6, c.dark);
    box(26, 9, 3, 6, c.dark);
  },
  chair: ({ rect, box, colors: c }) => {
    box(3, 1, 3, 14, c.dark);
    box(6, 8, 7, 2, c.base);
    rect(6, 8, 7, 1, c.light);
    box(11, 10, 2, 5, c.dark);
  },
  trap: ({ rect, box, colors: c }) => {
    box(1, 12, 14, 3, c.accent);
    for (const x of [2, 6, 10]) {
      rect(x + 1, 6, 1, 6, c.light);
      rect(x, 9, 3, 3, c.base);
      rect(x + 2, 7, 1, 5, c.dark);
    }
  },
  /** A crossbow on a post, aimed to the right. */
  turret: ({ rect, box, colors: c }) => {
    box(3, 13, 10, 2, c.dark); // foot
    box(7, 8, 2, 5, c.accent); // post
    box(2, 6, 9, 2, c.base); // stock
    rect(2, 6, 9, 1, c.light);
    box(11, 2, 1, 10, c.light); // bow
    rect(10, 3, 1, 1, c.outline);
    rect(10, 10, 1, 1, c.outline);
    rect(12, 6, 2, 1, c.accent); // bolt tip
  },
  /** The World Gate (48 x 64): a stone arch of runestones around a slowly turning swirl of light. */
  gate: ({ rect, box, colors: c }, frame) => {
    // The swirl: rings of light that drift inward, frame by frame.
    for (let y = 9; y < 60; y++) {
      for (let x = 12; x < 36; x++) {
        // Sampled off the centre line, so the spiral has no seam.
        const dx = (x - 23.5) / 12;
        const dy = (y - 33.8) / 26;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        const ring = (((d * 4 + frame / 4 + Math.atan2(dy, dx) / Math.PI) % 1) + 1) % 1;
        rect(x, y, 1, 1, ring < 0.18 ? c.light : ring < 0.5 ? c.accent : d < 0.35 ? '#e8fffc' : c.dark);
      }
    }
    // The arch: two pillars of runestone and a rounded top.
    box(3, 14, 8, 47, c.base);
    box(37, 14, 8, 47, c.base);
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * (i / 8);
      const x = Math.round(24 - Math.cos(angle) * 17 - 4);
      const y = Math.round(14 - Math.sin(angle) * 11);
      box(x, y, 8, 6, c.base);
      rect(x, y, 8, 1, c.light);
    }
    for (const x of [3, 37]) {
      rect(x, 14, 1, 47, c.light);
      for (let y = 18; y < 58; y += 10) {
        rect(x + 1, y, 6, 1, c.dark);
        rect(x + 3, y + 3, 2, 3, (frame + y / 10) % 4 < 2 ? c.accent : c.light); // runes
      }
    }
    // Steps in front.
    box(1, 61, 46, 2, c.dark);
    rect(1, 61, 46, 1, c.light);
  },
};

/** Paint every frame of a piece of furniture side by side, starting at the canvas's left edge. */
export function paintFurniture(ctx: CanvasRenderingContext2D, def: FurnitureDef): void {
  const frameWidth = def.width * 16;
  for (let frame = 0; frame < furnitureFrames(def); frame++) {
    PAINTERS[def.art.style](pen(ctx, frame * frameWidth, def.art), frame);
  }
}
