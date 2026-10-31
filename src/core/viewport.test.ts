import { describe, expect, it } from 'vitest';
import { backingStoreSize, deviceZoom, effectiveDpr, MAX_RENDER_DPR } from './viewport';

describe('viewport math', () => {
  it('sizes the canvas in device pixels', () => {
    expect(backingStoreSize(800, 600, 1)).toEqual({ width: 800, height: 600 });
    expect(backingStoreSize(800, 600, 2)).toEqual({ width: 1600, height: 1200 });
    expect(backingStoreSize(1366, 768, 1.25)).toEqual({ width: 1708, height: 960 });
  });

  it('never produces a zero-sized canvas', () => {
    expect(backingStoreSize(0, 0, 1)).toEqual({ width: 1, height: 1 });
  });

  it('turns zoom levels into whole device pixels', () => {
    expect(deviceZoom(2, 1)).toBe(2);
    expect(deviceZoom(2, 1.5)).toBe(3);
    expect(deviceZoom(3, 2)).toBe(6);
    expect(deviceZoom(1, 1.25)).toBe(1);
    expect(deviceZoom(1, 0.5)).toBe(1);
  });

  it('caps very high pixel ratios and repairs invalid ones', () => {
    expect(effectiveDpr(4)).toBe(MAX_RENDER_DPR);
    expect(effectiveDpr(Number.NaN)).toBe(1);
    expect(effectiveDpr(0)).toBe(1);
  });
});
