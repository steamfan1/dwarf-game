/**
 * Step 4: ore veins.
 *
 * Each ore rule in worldgen.json says which rock it grows in, between which depths
 * (0 = average surface, 1 = bottom) and how many veins to place. A vein is a short
 * random walk that only converts its host rock, so veins follow the rock layers and
 * show up on cave walls where caves cut through them.
 */
import { rowAtDepth, type GenContext } from './context';

const STEPS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** Returns how many cells of each ore tile were placed, keyed by tile id. */
export function placeOres(ctx: GenContext): Map<number, number> {
  const { world, settings } = ctx;
  const placed = new Map<number, number>();

  for (const rule of settings.ores) {
    const rng = ctx.rng.fork(`ore:${rule.tile}`);
    const top = rowAtDepth(ctx, rule.minDepth);
    const bottom = Math.min(world.height - 2, rowAtDepth(ctx, rule.maxDepth));
    let cells = 0;

    for (let v = 0; v < rule.veins; v++) {
      let x = rng.int(2, world.width - 3);
      let y = rng.int(top, Math.max(top, bottom));
      const size = rng.int(rule.size[0], rule.size[1]);
      let grown = 0;
      // A few extra attempts so veins that start in a cave still grow.
      for (let attempt = 0; attempt < size * 3 && grown < size; attempt++) {
        if (world.inBounds(x, y)) {
          const i = world.index(x, y);
          if (world.fg[i] === rule.host) {
            world.fg[i] = rule.tile;
            grown++;
          }
        }
        const [dx, dy] = rng.pick(STEPS);
        x = Math.max(1, Math.min(world.width - 2, x + dx));
        y = Math.max(top, Math.min(bottom, y + dy));
      }
      cells += grown;
    }
    placed.set(rule.tile, (placed.get(rule.tile) ?? 0) + cells);
  }
  return placed;
}
