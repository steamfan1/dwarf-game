/**
 * The simulation's front door to pathfinding: a per-tick budget and a path cache.
 *
 *  - Budget: at most `searchesPerTick` A* searches run per tick. A dwarf whose request
 *    doesn't fit gets 'busy' and asks again next tick, so a dozen dwarves picking new
 *    jobs at once spread the work over a few ticks instead of dropping a frame.
 *  - Cache: answers are remembered by start cell and goal (when the goal has a cacheKey),
 *    together with the chunks the path runs through. A terrain change throws away only
 *    the cached paths through the changed cell's chunk; the rest stay valid.
 */
import type { World } from '../world/World';
import type { PathGoal, PathOutcome, Pathfinder } from './Pathfinder';

interface CachedPath {
  outcome: PathOutcome;
  /** Chunks whose terrain the path depends on. */
  chunks: Set<number>;
}

export interface PathServiceOptions {
  searchesPerTick: number;
  /** Most paths remembered; the least recently used go first. */
  cacheSize: number;
}

export class PathService {
  readonly pathfinder: Pathfinder;
  private readonly world: World;
  private readonly searchesPerTick: number;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, CachedPath>();
  private searchesLeft: number;

  /** Totals for the debug overlay. */
  stats = { searches: 0, cacheHits: 0, busy: 0 };

  constructor(world: World, pathfinder: Pathfinder, options: PathServiceOptions) {
    this.world = world;
    this.pathfinder = pathfinder;
    this.searchesPerTick = options.searchesPerTick;
    this.cacheSize = options.cacheSize;
    this.searchesLeft = options.searchesPerTick;
  }

  /** Call at the start of every tick. */
  beginTick(): void {
    this.searchesLeft = this.searchesPerTick;
  }

  /** Find a path, or 'busy' if this tick's searches are used up (ask again next tick). */
  request(from: number, goal: PathGoal): PathOutcome | 'busy' {
    const key = goal.cacheKey === undefined ? null : `${from}>${goal.cacheKey}`;
    if (key !== null) {
      const hit = this.cache.get(key);
      if (hit) {
        // Refresh its place in the least-recently-used order.
        this.cache.delete(key);
        this.cache.set(key, hit);
        this.stats.cacheHits++;
        return hit.outcome;
      }
    }
    if (this.searchesLeft <= 0) {
      this.stats.busy++;
      return 'busy';
    }
    this.searchesLeft--;
    this.stats.searches++;
    const outcome = this.pathfinder.find(from, goal);
    // Only found paths are cached: "unreachable" is cheap to re-ask once terrain changes,
    // and "too far" depends on the search limit rather than the terrain.
    if (key !== null && outcome.found) {
      this.cache.set(key, { outcome, chunks: this.chunksOf(from, outcome.cells) });
      if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    }
    return outcome;
  }

  /** A cell's terrain changed: forget the cached paths that depend on its chunk. */
  terrainChanged(x: number, y: number): void {
    const chunk = this.world.chunkIndex(x, y);
    for (const [key, cached] of this.cache) {
      if (cached.chunks.has(chunk)) this.cache.delete(key);
    }
  }

  get cachedPaths(): number {
    return this.cache.size;
  }

  /**
   * The chunks a path's moves depend on: every cell on it and its eight neighbours, which
   * covers the floor under each step, the headroom for jumps and the column of every drop.
   */
  private chunksOf(from: number, cells: readonly number[]): Set<number> {
    const { world } = this;
    const chunks = new Set<number>();
    for (const cell of [from, ...cells]) {
      const x = cell % world.width;
      const y = (cell - x) / world.width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (world.inBounds(x + dx, y + dy)) chunks.add(world.chunkIndex(x + dx, y + dy));
        }
      }
    }
    return chunks;
  }
}
