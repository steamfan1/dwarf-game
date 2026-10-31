/**
 * Screen-size math for crisp pixel art on any display.
 *
 * The canvas backing store is sized in *device* pixels (CSS size x devicePixelRatio), so
 * a 4K laptop at 200% scaling draws at full resolution instead of being upscaled and
 * blurred by the browser. Camera zoom is then a whole number of device pixels per world
 * pixel, which keeps every pixel of the art the same size on screen.
 */

/** Largest devicePixelRatio we render at; beyond this the cost outweighs the sharpness. */
export const MAX_RENDER_DPR = 3;

export function effectiveDpr(devicePixelRatio: number): number {
  if (!(devicePixelRatio > 0)) return 1;
  return Math.min(MAX_RENDER_DPR, devicePixelRatio);
}

/** Canvas backing-store size for a CSS-pixel size on a screen with this devicePixelRatio. */
export function backingStoreSize(cssWidth: number, cssHeight: number, dpr: number): { width: number; height: number } {
  const ratio = effectiveDpr(dpr);
  return {
    width: Math.max(1, Math.round(cssWidth * ratio)),
    height: Math.max(1, Math.round(cssHeight * ratio)),
  };
}

/**
 * Whole device pixels per world pixel for a zoom level given in CSS pixels per world pixel.
 * On a 150% display, zoom 2 becomes exactly 3 device pixels, not a blurry 3.0-ish.
 */
export function deviceZoom(cssZoom: number, dpr: number): number {
  return Math.max(1, Math.round(cssZoom * effectiveDpr(dpr)));
}
