/**
 * Placeholder icons for items, painted from the `icon` entry in items.json. One painter
 * serves both the game world (as frames of the 'items' texture) and the HTML UI (as
 * data URLs), so an item looks the same everywhere.
 *
 * Icons are ITEM_ICON_SIZE pixels square, drawn from small character maps:
 *   k outline, l light, b base, d dark, a accent (ore flecks, the rings of a log).
 */
import type { IconStyle, ItemIcon, ItemRegistry } from '../../sim/items/ItemRegistry';
import { drawPixelRows, mixColor, type Palette } from './pixelArt';

export const ITEM_ICON_SIZE = 10;

const SHAPES: Record<IconStyle, readonly string[]> = {
  lump: [
    '..........',
    '...kkkk...',
    '..kllbbk..',
    '.klbbbbdk.',
    '.kbbbbbdk.',
    '.kbbbbddk.',
    '.kdbbdddk.',
    '..kddddk..',
    '...kkkk...',
    '..........',
  ],
  pile: [
    '..........',
    '..........',
    '....kk....',
    '...klbk...',
    '..klbbbk..',
    '..kbbbbdk.',
    '.klbbbbddk',
    '.kbbbbdddk',
    '.kkkkkkkkk',
    '..........',
  ],
  ball: [
    '..........',
    '...kkkk...',
    '..kllbbk..',
    '.kllbbbdk.',
    '.klbbbbdk.',
    '.kbbbbbdk.',
    '.kbbbbddk.',
    '..kbdddk..',
    '...kkkk...',
    '..........',
  ],
  gem: [
    '..........',
    '....kk....',
    '...klbk...',
    '..kllbbk..',
    '.kllbbbdk.',
    '.klbbbbdk.',
    '..kbbbdk..',
    '...kbdk...',
    '....kk....',
    '..........',
  ],
  ore: [
    '..........',
    '...kkkk...',
    '..klabbk..',
    '.klbbbadk.',
    '.kbabbbdk.',
    '.kbbbabdk.',
    '.kdabddak.',
    '..kddddk..',
    '...kkkk...',
    '..........',
  ],
  log: [
    '..........',
    '..........',
    '..........',
    '.kkkkkkkk.',
    'kbbbbbbklk',
    'kbdbbdbkak',
    'kddddddklk',
    '.kkkkkkkk.',
    '..........',
    '..........',
  ],
};

export function iconPalette(icon: ItemIcon): Palette {
  return {
    k: mixColor(icon.dark, '#000000', 0.55),
    l: icon.light,
    b: icon.base,
    d: icon.dark,
    a: icon.accent ?? (icon.style === 'log' ? icon.dark : icon.light),
  };
}

/** Paint one icon with its top-left corner at (x, y). */
export function paintItemIcon(ctx: CanvasRenderingContext2D, icon: ItemIcon, x: number, y: number): void {
  drawPixelRows(ctx, SHAPES[icon.style], iconPalette(icon), x, y);
}

/** Every item's icon in one row, item number = frame number. */
export function paintItemAtlas(ctx: CanvasRenderingContext2D, items: ItemRegistry): void {
  items.items.forEach((item, i) => paintItemIcon(ctx, item.icon, i * ITEM_ICON_SIZE, 0));
}

const iconUrls = new Map<number, string>();

/** A PNG data URL of an item's icon, for <img> tags in the HTML UI. Cached per item. */
export function itemIconUrl(items: ItemRegistry, item: number): string {
  const cached = iconUrls.get(item);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ITEM_ICON_SIZE;
  canvas.height = ITEM_ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  paintItemIcon(ctx, items.get(item).icon, 0, 0);
  const url = canvas.toDataURL();
  iconUrls.set(item, url);
  return url;
}

/** Shape maps by style, for tests. */
export const ICON_SHAPES = SHAPES;
