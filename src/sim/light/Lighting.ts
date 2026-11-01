/**
 * Light: two values per cell, each from 0 (pitch dark) to MAX_LIGHT (15, full daylight).
 *
 *  - `sun`: sunlight falls straight down every column until it meets a solid block, so
 *    open sky and the bottom of a shaft open to the sky are fully lit; from there it
 *    spreads sideways and into the ground.
 *  - `glow`: light from things that shine on their own: lava, glow crystals and point
 *    lights such as the Hearth (and, later, torches).
 *  - `light`: the brighter of the two, which is what the eye sees (the darkness overlay
 *    in Milestone 4, where night will dim the sun channel only).
 *
 * In both channels light spreads to the four neighbours of each lit cell by flood fill,
 * losing 1 per step through open space, 2 through water and 4 when it enters a solid
 * block. So daylight reaches about three blocks into the ground, which is enough to see
 * the surface everywhere, and a lava pool lights up a little of the cave around it.
 *
 * Only sunlight uncovers the map: `discover()` marks sunlit cells as explored. A lava
 * lake glowing deep underground stays hidden until a dwarf finds it.
 *
 * When a cell changes, only the cells it could affect are relit: those within 15 cells of
 * it, plus the column below it if sunlight now reaches further down (or less far). Light
 * from outside that area shines in from its edges. That keeps a dug block to a few
 * hundred cells of work instead of the whole 80,000-cell world.
 *
 * Pure: no Phaser and no DOM.
 */
import type { TileRegistry } from '../world/TileRegistry';
import { FLAG_EXPLORED, growRect, type CellRect, type World } from '../world/World';

export const MAX_LIGHT = 15;
/** Light given off by the Hearth's fire. */
export const HEARTH_LIGHT = 14;

const COST_OPEN = 1;
const COST_WATER = 2;
const COST_SOLID = 4;

export class Lighting {
  /** Sunlight per cell. */
  readonly sun: Uint8Array;
  /** Light from lava, glowing blocks and point lights per cell. */
  readonly glow: Uint8Array;
  /** The brighter of `sun` and `glow` per cell. */
  readonly light: Uint8Array;
  /** For each column, the row of the first solid block (sunlight stops there); the world's height if there is none. */
  readonly sunDepth: Int16Array;

  private readonly world: World;
  private readonly tiles: TileRegistry;
  /** Lights that aren't blocks or liquids, by cell index: the Hearth now, torches and lamps later. */
  private readonly pointLights = new Map<number, number>();
  /** Flood-fill work lists, one per light level, reused between updates. */
  private readonly buckets: number[][] = Array.from({ length: MAX_LIGHT + 1 }, () => []);
  private readonly waterType: number;

  constructor(world: World, tiles: TileRegistry) {
    this.world = world;
    this.tiles = tiles;
    const cells = world.width * world.height;
    this.sun = new Uint8Array(cells);
    this.glow = new Uint8Array(cells);
    this.light = new Uint8Array(cells);
    this.sunDepth = new Int16Array(world.width);
    for (let x = 0; x < world.width; x++) this.sunDepth[x] = this.scanSunDepth(x);
    this.waterType = tiles.hasLiquid('water') ? tiles.liquid('water') : 0;
  }

  lightAt(x: number, y: number): number {
    return this.world.inBounds(x, y) ? this.light[y * this.world.width + x]! : 0;
  }

  sunAt(x: number, y: number): number {
    return this.world.inBounds(x, y) ? this.sun[y * this.world.width + x]! : 0;
  }

  /** Light the whole world from scratch. Returns the area relit (all of it). */
  computeAll(): CellRect {
    const rect = { x0: 0, y0: 0, x1: this.world.width - 1, y1: this.world.height - 1 };
    this.relight(rect);
    return rect;
  }

  /**
   * A cell's block or liquid has changed: relight everything that change can affect.
   * Returns that area, so callers can redraw it and look for newly lit cells.
   */
  cellChanged(x: number, y: number): CellRect {
    const before = this.sunDepth[x]!;
    const after = this.scanSunDepth(x);
    this.sunDepth[x] = after;
    const { width, height } = this.world;
    // If sunlight now reaches further down the column (or stops sooner), every cell down
    // to the deeper end of the old or new beam can change, and so can its glow.
    const lowest = before === after ? y : Math.max(y, Math.max(before, after) - 1);
    const rect = {
      x0: Math.max(0, x - MAX_LIGHT),
      y0: Math.max(0, y - MAX_LIGHT),
      x1: Math.min(width - 1, x + MAX_LIGHT),
      y1: Math.min(height - 1, lowest + MAX_LIGHT),
    };
    this.relight(rect);
    return rect;
  }

  /** Add, change or (with level 0) remove a point light, and relight around it. */
  setPointLight(x: number, y: number, level: number): CellRect {
    const i = this.world.index(x, y);
    if (level > 0) this.pointLights.set(i, Math.min(MAX_LIGHT, level));
    else this.pointLights.delete(i);
    const rect = {
      x0: Math.max(0, x - MAX_LIGHT),
      y0: Math.max(0, y - MAX_LIGHT),
      x1: Math.min(this.world.width - 1, x + MAX_LIGHT),
      y1: Math.min(this.world.height - 1, y + MAX_LIGHT),
    };
    this.relight(rect);
    return rect;
  }

  /**
   * Mark every sunlit cell in a rectangle as explored. Returns the bounding box of the
   * cells that were newly explored, or null if there were none. Glow doesn't count.
   */
  discover(rect: CellRect): CellRect | null {
    const { world, sun } = this;
    const flags = world.flags;
    let found: CellRect | null = null;
    for (let y = rect.y0; y <= rect.y1; y++) {
      let i = y * world.width + rect.x0;
      for (let x = rect.x0; x <= rect.x1; x++, i++) {
        if (sun[i] === 0 || flags[i]! & FLAG_EXPLORED) continue;
        flags[i] = flags[i]! | FLAG_EXPLORED;
        found = found ? growRect(found, x, y) : { x0: x, y0: y, x1: x, y1: y };
      }
    }
    return found;
  }

  /** Row of the first solid block in a column (sunlight stops there), or the world's height. */
  private scanSunDepth(x: number): number {
    const { world, tiles } = this;
    for (let y = 0; y < world.height; y++) {
      if (tiles.solid[world.fg[y * world.width + x]!]) return y;
    }
    return world.height;
  }

  /** Light needed to enter a cell: solid blocks and water dim light faster than open air. */
  private cost(i: number): number {
    if (this.tiles.solid[this.world.fg[i]!]) return COST_SOLID;
    return this.waterType !== 0 && this.world.liquidType[i] === this.waterType ? COST_WATER : COST_OPEN;
  }

  /** Recompute both channels inside `r`, then the combined light. */
  private relight(r: CellRect): void {
    const { world, tiles, sunDepth, pointLights } = this;
    const width = world.width;

    this.spread(this.sun, r, (push) => {
      for (let x = r.x0; x <= r.x1; x++) {
        const bottom = Math.min(r.y1, sunDepth[x]! - 1);
        for (let y = r.y0; y <= bottom; y++) push(y * width + x, MAX_LIGHT);
      }
    });

    this.spread(this.glow, r, (push) => {
      for (let y = r.y0; y <= r.y1; y++) {
        let i = y * width + r.x0;
        for (let x = r.x0; x <= r.x1; x++, i++) {
          const glow = Math.max(tiles.lightEmitted[world.fg[i]!]!, tiles.liquidLight[world.liquidType[i]!] ?? 0);
          if (glow > 0) push(i, glow);
        }
      }
      for (const [i, level] of pointLights) {
        const x = i % width;
        const y = (i - x) / width;
        if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) push(i, level);
      }
    });

    const { sun, glow, light } = this;
    for (let y = r.y0; y <= r.y1; y++) {
      const end = y * width + r.x1;
      for (let i = y * width + r.x0; i <= end; i++) light[i] = sun[i]! > glow[i]! ? sun[i]! : glow[i]!;
    }
  }

  /**
   * Recompute one channel inside `r`, treating its values outside `r` as fixed. Cells are
   * lit by `seed` (sources inside `r`) and by lit cells just outside its edge; then light
   * spreads brightest-first, so every cell ends up with the best light any path brings.
   */
  private spread(channel: Uint8Array, r: CellRect, seed: (push: (i: number, level: number) => void) => void): void {
    const { world, buckets } = this;
    const width = world.width;
    const push = (i: number, level: number): void => {
      if (level <= channel[i]!) return;
      channel[i] = level;
      buckets[level]!.push(i);
    };

    for (let y = r.y0; y <= r.y1; y++) channel.fill(0, y * width + r.x0, y * width + r.x1 + 1);
    seed(push);

    // Light from just outside the area shines in across its edges.
    const shineIn = (outside: number, inside: number): void => {
      const level = channel[outside]! - this.cost(inside);
      if (level > 0) push(inside, level);
    };
    for (let x = r.x0; x <= r.x1; x++) {
      if (r.y0 > 0) shineIn((r.y0 - 1) * width + x, r.y0 * width + x);
      if (r.y1 < world.height - 1) shineIn((r.y1 + 1) * width + x, r.y1 * width + x);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      if (r.x0 > 0) shineIn(y * width + r.x0 - 1, y * width + r.x0);
      if (r.x1 < width - 1) shineIn(y * width + r.x1 + 1, y * width + r.x1);
    }

    // Spread, brightest first. A cell is only ever raised, never lowered, so each bucket
    // can hold stale entries; they are skipped when the cell has since got brighter.
    for (let level = MAX_LIGHT; level >= 2; level--) {
      const bucket = buckets[level]!;
      while (bucket.length > 0) {
        const i = bucket.pop()!;
        if (channel[i] !== level) continue;
        const x = i % width;
        const y = (i - x) / width;
        if (x > r.x0) push(i - 1, level - this.cost(i - 1));
        if (x < r.x1) push(i + 1, level - this.cost(i + 1));
        if (y > r.y0) push(i - width, level - this.cost(i - width));
        if (y < r.y1) push(i + width, level - this.cost(i + width));
      }
    }
    buckets[1]!.length = 0;
  }
}
