/**
 * Where something stepping between two cells is drawn, between the last two simulation
 * ticks (`alpha`), so movement looks smooth at any frame rate: walking slides, a jump
 * follows a small arc, stepping off an edge walks first and then falls. Shared by dwarves
 * and creatures.
 */
import type { Movement } from '../../sim/dwarves/Dwarf';

/** Where it is drawn, in tiles (x of its centre column, y of the row it stands in). */
export interface Place {
  x: number;
  y: number;
  airborne: boolean;
}

/**
 * `walkTicks` is how long a plain step takes it, so a step off an edge spends that long
 * walking before it falls. Without a movement, it stands at (x, y).
 */
export function movementPlace(movement: Movement | null, x: number, y: number, falling: boolean, alpha: number, width: number, walkTicks: number): Place {
  if (!movement) return { x, y, airborne: falling };
  const fx = movement.from % width;
  const fy = (movement.from - fx) / width;
  const tx = movement.to % width;
  const ty = (movement.to - tx) / width;
  const t = Math.min(1, Math.max(0, (movement.elapsed + alpha) / movement.duration));
  switch (movement.kind) {
    case 'jump':
      return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t - Math.sin(Math.PI * t) * 0.45, airborne: true };
    case 'drop': {
      if (tx === fx) return { x: tx, y: fy + (ty - fy) * t, airborne: true };
      // Walk to the edge, then fall.
      const walkPart = Math.min(0.9, walkTicks / movement.duration);
      if (t < walkPart) return { x: fx + ((tx - fx) * t) / walkPart, y: fy, airborne: false };
      return { x: tx, y: fy + ((ty - fy) * (t - walkPart)) / (1 - walkPart), airborne: true };
    }
    case 'fall':
      return { x: tx, y: fy + (ty - fy) * t, airborne: true };
    default:
      return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t, airborne: false };
  }
}
