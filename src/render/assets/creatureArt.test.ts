import { describe, expect, it } from 'vitest';
import { CREATURES } from '../../sim/content';
import { CREATURE_STYLES } from '../../sim/creatures/CreatureRegistry';
import { CREATURE_FRAME_SIZE, CREATURE_FRAMES, CREATURE_SPRITES, creatureFrameRows, creaturePalette } from './creatureArt';
import { validatePixelRows } from './pixelArt';

describe('creature art', () => {
  it('draws every frame of every creature 16 x 16, from colours its palette knows', () => {
    const palette = creaturePalette({ style: 'gloomling', base: '#000000', dark: '#000000', light: '#000000', accent: '#000000' });
    for (const style of CREATURE_STYLES) {
      expect(CREATURE_SPRITES[style].legs).toHaveLength(3);
      for (let frame = 0; frame < CREATURE_FRAMES.count; frame++) {
        const rows = creatureFrameRows(style, frame);
        expect(rows, `${style} frame ${frame}`).toHaveLength(CREATURE_FRAME_SIZE);
        expect(validatePixelRows(rows, palette, CREATURE_FRAME_SIZE), `${style} frame ${frame}`).toEqual([]);
      }
    }
  });

  it('has a sprite for every creature in creatures.json', () => {
    for (const def of CREATURES.defs) expect(CREATURE_SPRITES[def.art.style], def.id).toBeDefined();
  });
});
