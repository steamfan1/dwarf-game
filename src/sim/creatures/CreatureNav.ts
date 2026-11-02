/**
 * How one kind of creature can move through the tile grid: the creature counterpart of
 * NavGrid. The moves are the same (walk, jump, climb, swim, drop), with these differences:
 *
 *   - Doors stop creatures. Dwarves open them; a creature has to break one down.
 *   - `jump` sets how many tiles up it can leap onto a ledge, `safeDrop` the longest
 *     drop it will take.
 *   - What it climbs: nothing, ladders, or (spider-like) ladders, background walls and
 *     the sides of blocks.
 *   - A creature that breaks things may plan a path *through* a door or block it can
 *     break (see CreatureRegistry's `breaks`): such a cell counts as open, at an extra
 *     cost worked out by the Breaker from how long smashing it would take. So a monster
 *     weighs walking round to an open way in against breaking down the nearest door, and
 *     a burrower tunnels straight at its prey when that's quicker.
 *
 * Like NavGrid, the graph is implicit: moves are worked out from the tiles when the
 * pathfinder asks. Pure: no Phaser and no DOM.
 */
import { MOVE_COST, type MoveKind } from '../nav/NavGrid';
import type { NavGraph } from '../nav/Pathfinder';
import type { TileRegistry } from '../world/TileRegistry';
import type { World } from '../world/World';
import type { CreatureMovement } from './CreatureRegistry';

/** What a creature can smash its way through. */
export interface Breaker {
  /** Whether it can break into this cell (a door or block it is able to smash). */
  canBreak(x: number, y: number): boolean;
  /** The extra path cost of breaking into it, in tiles walked. */
  cost(x: number, y: number): number;
}

export class CreatureNav implements NavGraph {
  readonly world: World;
  readonly tiles: TileRegistry;
  readonly movement: CreatureMovement;
  private readonly breaker: Breaker | null;
  private readonly lavaType: number;
  private readonly waterType: number;

  constructor(world: World, tiles: TileRegistry, movement: CreatureMovement, breaker: Breaker | null) {
    this.world = world;
    this.tiles = tiles;
    this.movement = movement;
    this.breaker = breaker;
    this.lavaType = tiles.hasLiquid('lava') ? tiles.liquid('lava') : -1;
    this.waterType = tiles.hasLiquid('water') ? tiles.liquid('water') : -1;
  }

  /** Nothing in the way right now: not solid, not a door, not lava. */
  open(x: number, y: number): boolean {
    const { world, tiles } = this;
    if (!world.inBounds(x, y)) return false;
    const i = y * world.width + x;
    const tile = world.fg[i]!;
    return tiles.solid[tile] === 0 && tiles.door[tile] === 0 && world.liquidType[i] !== this.lavaType;
  }

  /** A door or block in the way that this creature could smash. */
  breakable(x: number, y: number): boolean {
    return this.breaker !== null && !this.open(x, y) && this.breaker.canBreak(x, y);
  }

  /** It could be in this cell: it's open, or it can be broken open. */
  passable(x: number, y: number): boolean {
    return this.open(x, y) || this.breakable(x, y);
  }

  /** Something to stand on, or to cling to: a block, or a door (to a creature, a door is as good as a wall). */
  solidAt(x: number, y: number): boolean {
    const { world, tiles } = this;
    if (y >= world.height) return true;
    if (!world.inBounds(x, y)) return false;
    const tile = world.fg[y * world.width + x]!;
    return tiles.solid[tile] === 1 || tiles.door[tile] === 1;
  }

  waterAt(x: number, y: number): boolean {
    const { world } = this;
    return world.inBounds(x, y) && world.liquidType[y * world.width + x] === this.waterType;
  }

  /** Something it can climb in this cell: a ladder, or (for climbers) a wall behind it or a block beside it. */
  climbableAt(x: number, y: number): boolean {
    const climbs = this.movement.climbs;
    if (climbs === 'none' || !this.passable(x, y)) return false;
    const { world } = this;
    const i = y * world.width + x;
    if (this.tiles.climbable[world.fg[i]!] === 1) return true;
    if (climbs !== 'walls') return false;
    return world.bg[i] !== 0 || this.solidAt(x - 1, y) || this.solidAt(x + 1, y);
  }

  /** It can stay here without falling (once the cell is broken open, if it has to be). */
  standable(x: number, y: number): boolean {
    if (!this.passable(x, y)) return false;
    return this.solidAt(x, y + 1) || this.climbableAt(x, y) || this.climbableAt(x, y + 1) || this.waterAt(x, y);
  }

  /**
   * Where it lands falling from (x, y): the first row at or below y it can stay in, or -1
   * if it would hit something or fall out of the world. With `firstBroken`, the cell
   * (x, y) itself is about to be broken open.
   */
  landingRow(x: number, y: number, firstBroken = false): number {
    for (let row = y; row < this.world.height; row++) {
      if (!this.open(x, row) && !(firstBroken && row === y)) return -1;
      if (this.solidAt(x, row + 1) || this.climbableAt(x, row) || this.climbableAt(x, row + 1) || this.waterAt(x, row)) return row;
    }
    return -1;
  }

  forEachMove(from: number, visit: (to: number, cost: number, kind: MoveKind) => void): void {
    const { world, movement } = this;
    const width = world.width;
    const x = from % width;
    const y = (from - x) / width;
    // (A cell on a planned path may still need breaking open: moves are planned from it as if it were.)
    if (!this.standable(x, y)) return;

    for (let dx = -1; dx <= 1; dx += 2) {
      const nx = x + dx;
      if (!world.inBounds(nx, y)) continue;
      if (this.standable(nx, y)) {
        visit(from + dx, (this.waterAt(nx, y) ? MOVE_COST.wade : MOVE_COST.walk) + this.extra(nx, y), 'walk');
      } else if (this.passable(nx, y)) {
        // Step (or break its way) off the edge and fall, if the landing is close enough.
        const land = this.landingRow(nx, y, !this.open(nx, y));
        if (land > y && land - y <= movement.safeDrop) visit(land * width + nx, MOVE_COST.drop + (land - y) + this.extra(nx, y), 'drop');
      }
      // Leap up onto a ledge up to `jump` tiles higher, with open air above its head.
      for (let h = 1; h <= movement.jump && y - h >= 0; h++) {
        if (!this.open(x, y - h)) break;
        if (this.standable(nx, y - h)) {
          visit((y - h) * width + nx, MOVE_COST.jump + (h - 1) + this.extra(nx, y - h), 'jump');
          break;
        }
      }
    }

    // Up a ladder or a wall, or swimming up.
    if (y > 0 && this.passable(x, y - 1) && (this.climbableAt(x, y) || this.waterAt(x, y)) && this.standable(x, y - 1)) {
      const swim = this.waterAt(x, y);
      visit(from - width, (swim ? MOVE_COST.swim : MOVE_COST.climb) + this.extra(x, y - 1), swim ? 'swim' : 'climb');
    }
    if (y + 1 >= world.height) return;
    if (this.open(x, y + 1) && (this.climbableAt(x, y + 1) || this.waterAt(x, y + 1))) {
      const swim = this.waterAt(x, y + 1);
      visit(from + width, swim ? MOVE_COST.swim : MOVE_COST.climb, swim ? 'swim' : 'climb');
    } else if (this.open(x, y + 1) && this.climbableAt(x, y)) {
      // Let go and drop.
      const land = this.landingRow(x, y + 1);
      if (land > y && land - y <= movement.safeDrop) visit(land * width + x, MOVE_COST.drop + (land - y), 'drop');
    } else if (this.breakable(x, y + 1)) {
      // Break through the floor and drop into the hole.
      const land = this.landingRow(x, y + 1, true);
      if (land > y && land - y <= movement.safeDrop) visit(land * width + x, MOVE_COST.drop + (land - y) + this.extra(x, y + 1), 'drop');
    }
  }

  /** The kind of a single step, if it is (still) possible; null if not. */
  stepKind(from: number, to: number): MoveKind | null {
    let kind: MoveKind | null = null;
    this.forEachMove(from, (cell, _cost, moveKind) => {
      if (cell === to && kind === null) kind = moveKind;
    });
    return kind;
  }

  /** The cell a step goes into first: what has to be broken before taking it, if anything. */
  firstCell(from: number, to: number): number {
    const width = this.world.width;
    const fx = from % width;
    const fy = (from - fx) / width;
    const tx = to % width;
    const ty = (to - tx) / width;
    if (ty <= fy) return to; // walking, jumping or climbing up: straight into it
    if (tx !== fx) return fy * width + tx; // dropping off the side: the cell beside it
    return from + width; // straight down: the floor below
  }

  /** Extra cost of getting into a cell: 0 if it's open, the time to break it otherwise. */
  private extra(x: number, y: number): number {
    return this.open(x, y) ? 0 : (this.breaker?.cost(x, y) ?? Infinity);
  }
}
