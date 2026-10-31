import { describe, expect, it } from 'vitest';
import { ANIMATIONS, SOUNDS, TEXTURES } from './manifest';
import { DWARF_FRAME_COUNT, DWARF_FRAME_SIZE, DWARF_PALETTE, dwarfFrameRows, periodicRidge } from './painters';
import { validatePixelRows, mixColor } from './pixelArt';
import { PEAK, soundLength, synthesize } from './synth';
import { Rng } from '../../core/Rng';

describe('dwarf sprite', () => {
  it('has square, well-formed frames that only use palette colours', () => {
    for (let frame = 0; frame < DWARF_FRAME_COUNT; frame++) {
      const rows = dwarfFrameRows(frame);
      expect(rows).toHaveLength(DWARF_FRAME_SIZE);
      expect(validatePixelRows(rows, DWARF_PALETTE, DWARF_FRAME_SIZE)).toEqual([]);
    }
  });
});

describe('asset manifest', () => {
  it('references only animation frames that exist', () => {
    for (const anim of Object.values(ANIMATIONS)) {
      const source = TEXTURES[anim.texture];
      const count = 'frames' in source && source.frames ? source.frames.count : 1;
      for (const frame of anim.frames) expect(frame).toBeLessThan(count);
    }
  });

  it('gives generated textures sizes that fit their frame grids', () => {
    for (const source of Object.values(TEXTURES)) {
      if (source.kind !== 'generated' || !('frames' in source)) continue;
      const { frameWidth, frameHeight, count } = source.frames;
      const columns = Math.floor(source.width / frameWidth);
      expect(columns * Math.floor(source.height / frameHeight)).toBeGreaterThanOrEqual(count);
    }
  });
});

describe('painters', () => {
  it('periodicRidge wraps around so strips tile seamlessly', () => {
    const ridge = periodicRidge(new Rng(3), 256, 10, 50, 6);
    expect(ridge).toHaveLength(256);
    expect(Math.abs(ridge[0]! - ridge[255]!)).toBeLessThanOrEqual(2);
    for (const h of ridge) {
      expect(h).toBeGreaterThanOrEqual(10);
      expect(h).toBeLessThanOrEqual(50);
    }
  });

  it('mixColor blends hex colours', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColor('#102030', '#102030', 0.3)).toBe('#102030');
  });
});

describe('synth', () => {
  it('renders every manifest sound with the right length and no clipping', () => {
    for (const sound of Object.values(SOUNDS)) {
      if (sound.kind !== 'synth') continue;
      const samples = synthesize(sound.tones, 44100);
      expect(samples.length).toBe(Math.ceil(soundLength(sound.tones) * 44100));
      let peak = 0;
      for (const s of samples) peak = Math.max(peak, Math.abs(s));
      expect(peak).toBeCloseTo(PEAK, 5);
    }
  });

  it('is deterministic, noise included', () => {
    const tones = [{ wave: 'noise' as const, freq: 0, duration: 0.05 }];
    expect(synthesize(tones, 22050, 7)).toEqual(synthesize(tones, 22050, 7));
  });

  it('places delayed tones after silence', () => {
    const samples = synthesize([{ wave: 'sine', freq: 440, start: 0.1, duration: 0.1 }], 1000);
    expect(samples.length).toBe(200);
    for (let i = 0; i < 100; i++) expect(samples[i]).toBe(0);
  });
});
