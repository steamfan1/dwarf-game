/**
 * All game state that advances in fixed ticks, and the commands that change it.
 *
 * Pure TypeScript: no Phaser and no DOM, so it runs in unit tests and could move into a
 * worker. All randomness comes from `rng`, never Math.random(), so a world can be
 * replayed exactly from its seed and the player's orders.
 *
 * Milestone 1: the generated world, the Hearth (the colony's home spot) and digging by
 * click. From Milestone 2, dwarves do the digging through the job system instead.
 */
import type { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import type { GameEvents } from './events';
import { AIR, type TileRegistry } from './world/TileRegistry';
import type { World } from './world/World';

export type DigResult =
  | 'dug'
  | 'out-of-bounds'
  | 'unexplored'
  | 'nothing-to-dig'
  | 'indestructible'
  | 'supports-hearth'
  | 'supports-tree';

/** Cells revealed around a freshly dug cell. */
export const DIG_REVEAL_RADIUS = 2;

export interface SimulationOptions {
  world: World;
  tiles: TileRegistry;
  bus: EventBus<GameEvents>;
}

export class Simulation {
  readonly world: World;
  readonly tiles: TileRegistry;
  readonly rng: Rng;
  /** The colony's home: retreat point, Recall target and respawn spot in later milestones. */
  readonly hearth: { x: number; y: number };
  /** Number of ticks simulated since the world began. */
  tick = 0;

  private readonly bus: EventBus<GameEvents>;
  private readonly logTiles: ReadonlySet<number>;

  constructor({ world, tiles, bus }: SimulationOptions) {
    this.world = world;
    this.tiles = tiles;
    this.bus = bus;
    this.rng = new Rng(`${world.seed}:simulation`);
    this.hearth = { ...world.spawn };
    this.logTiles = new Set(tiles.tiles.flatMap((t, i) => (t.art.style === 'log' ? [i] : [])));
  }

  /** Advance the world by exactly one tick (1/20 s of game time at 1x speed). */
  step(): void {
    this.tick++;
  }

  /** Why a cell can or can't be dug right now, without changing anything. */
  canDig(x: number, y: number): DigResult {
    const { world, tiles } = this;
    if (!world.inBounds(x, y)) return 'out-of-bounds';
    if (!world.isVisible(x, y)) return 'unexplored';
    const tile = world.fg[world.index(x, y)];
    if (!tiles.solid[tile]) return 'nothing-to-dig';
    if (!tiles.diggable[tile]) return 'indestructible';
    if (y === this.hearth.y + 1 && Math.abs(x - this.hearth.x) <= 1) return 'supports-hearth';
    if (this.logTiles.has(world.fgAt(x, y - 1))) return 'supports-tree';
    return 'dug';
  }

  /**
   * Player command (Milestone 1): remove the block in a cell straight away. Decorations
   * resting on it go too, and the cells around it are revealed.
   */
  dig(x: number, y: number): DigResult {
    const result = this.canDig(x, y);
    if (result !== 'dug') return result;

    const { world, tiles } = this;
    world.fg[world.index(x, y)] = AIR;
    this.bus.emit('TileChanged', { x, y });

    // Grass tufts, flowers and the like would float without the block under them.
    const above = world.fgAt(x, y - 1);
    if (y > 0 && !tiles.solid[above] && tiles.replaceable[above] && tiles.tiles[above]?.art.style === 'sprite') {
      world.fg[world.index(x, y - 1)] = AIR;
      this.bus.emit('TileChanged', { x, y: y - 1 });
    }

    const revealed = world.revealEllipse(x, y, DIG_REVEAL_RADIUS, DIG_REVEAL_RADIUS);
    if (revealed) this.bus.emit('ExploredChanged', revealed);
    return 'dug';
  }

  /** Debug: lift the fog of war everywhere. */
  revealAll(): void {
    this.bus.emit('ExploredChanged', this.world.revealAll());
  }
}
