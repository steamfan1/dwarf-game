/** Draw order of everything in the game scene, back to front. */
export const DEPTH = {
  sky: -100,
  walls: 0,
  blocks: 10,
  /** Planned blocks, walls and furniture, drawn see-through where they will go. */
  plans: 11,
  /** Chests, torches, workbenches... */
  furniture: 12,
  /** Marks on designated work (dig, fell, build, take apart), over the furniture they may be on. */
  marks: 13,
  /** Cracks spreading through a block being dug. */
  cracks: 14,
  /** The Hearth. */
  objects: 20,
  items: 21,
  dwarves: 22,
  /** What a dwarf carries, above its head. */
  carried: 23,
  fog: 50,
  /** The rectangle dragged out with a tool, and the outline of what a build tool would put down. */
  selection: 55,
  cursor: 60,
  debug: 70,
} as const;
