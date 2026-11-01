/** Draw order of everything in the game scene, back to front. */
export const DEPTH = {
  sky: -100,
  walls: 0,
  blocks: 10,
  /** Dig and chop marks on designated work. */
  marks: 12,
  /** Cracks spreading through a block being dug. */
  cracks: 13,
  /** The Hearth. */
  objects: 20,
  items: 21,
  dwarves: 22,
  /** What a dwarf carries, above its head. */
  carried: 23,
  fog: 50,
  /** The rectangle dragged out with a tool. */
  selection: 55,
  cursor: 60,
  debug: 70,
} as const;
