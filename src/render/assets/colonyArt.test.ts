import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../sim/content';
import { markFrame, MARK_FRAMES } from './colonyArt';
import { ICON_SHAPES, ITEM_ICON_SIZE, iconPalette } from './itemArt';
import { validatePixelRows } from './pixelArt';

describe('colony art', () => {
  it('gives every job state its own mark frame', () => {
    const frames = new Set<number>();
    for (const kind of ['dig', 'chop', 'build', 'dismantle', 'plain'] as const) {
      for (const priority of [1, 2, 3, 4] as const) frames.add(markFrame(kind, priority, false));
      frames.add(markFrame(kind, 2, true));
    }
    frames.add(markFrame('build', 2, false, true));
    expect(frames.size).toBe(MARK_FRAMES);
    expect(Math.max(...frames)).toBe(MARK_FRAMES - 1);
    // Blocked beats missing materials: getting there is the first problem to solve.
    expect(markFrame('build', 3, true, true)).toBe(markFrame('build', 2, true));
  });

  it('draws every item icon shape at the icon size with known colours', () => {
    for (const [style, rows] of Object.entries(ICON_SHAPES)) {
      expect(rows, style).toHaveLength(ITEM_ICON_SIZE);
      expect(validatePixelRows(rows, iconPalette({ style: style as 'lump', base: '#000000', dark: '#000000', light: '#000000' }), ITEM_ICON_SIZE)).toEqual([]);
    }
    // Every item in items.json has an icon style that exists.
    for (const item of ITEMS.items) expect(ICON_SHAPES[item.icon.style]).toBeDefined();
  });
});
