/** Draw order of everything in the game scene, back to front. */
export const DEPTH = {
  sky: -100,
  walls: 0,
  blocks: 10,
  objects: 20,
  fog: 50,
  cursor: 60,
  debug: 70,
} as const;
