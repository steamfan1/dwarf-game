/**
 * The arithmetic of a fight, shared by dwarves, creatures, traps and turrets: how much a
 * blow hurts through armour, whether a shooter can see its target, and the missiles in
 * flight (crossbow bolts, spat bile).
 *
 * Missiles are kept in a pool and reused, so a long siege doesn't churn the garbage
 * collector: a spent missile is only marked inactive, and the next shot takes its slot.
 *
 * Pure: no Phaser and no DOM.
 */
import type { ProjectileKind } from '../items/ItemRegistry';
import type { TileRegistry } from '../world/TileRegistry';
import type { World } from '../world/World';

/** A hit of `damage` through `armor`: armour softens blows, but never stops one entirely. */
export function armoredDamage(damage: number, armor: number, armorScale: number): number {
  return (damage * armorScale) / (armorScale + Math.max(0, armor));
}

/** Nothing blocks a missile here: not solid (glass included) and not a door. */
export function seeThrough(world: World, tiles: TileRegistry, x: number, y: number): boolean {
  if (!world.inBounds(x, y)) return false;
  const tile = world.fg[y * world.width + x]!;
  return tiles.solid[tile] === 0 && tiles.door[tile] === 0;
}

/**
 * Whether a straight line between the centres of two cells passes only through open
 * cells (the end cells themselves don't count). Walks the line cell by cell (Bresenham).
 */
export function lineOfSight(world: World, tiles: TileRegistry, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if ((x !== x0 || y !== y0) && (x !== x1 || y !== y1) && !seeThrough(world, tiles, x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Distance between two cells, as the crow flies, without a square root: compare against range * range. */
export function distanceSquared(x0: number, y0: number, x1: number, y1: number): number {
  return (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0);
}

/** Which side fired: the colony's missiles hit creatures, the monsters' hit dwarves. */
export type Team = 'colony' | 'monster';

export interface Projectile {
  active: boolean;
  readonly slot: number;
  kind: ProjectileKind;
  team: Team;
  /** Position in tiles (cell centres are at .5), and velocity in tiles per tick. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  /** Ticks left before it falls harmlessly. */
  ttl: number;
  /** Who shot it: a dwarf id (colony), a creature id (monster), or 0 for a turret. */
  source: number;
  /** The kind of creature that shot it, or -1. */
  sourceKind: number;
}

/** What a missile ran into this tick. */
export type ProjectileImpact = { kind: 'wall' } | { kind: 'dwarf'; id: number } | { kind: 'creature'; id: number };

export class Projectiles {
  /** Every missile slot, in flight or free. */
  readonly pool: Projectile[] = [];
  private free: number[] = [];

  /**
   * Shoot from one point to another (in tiles) at `speed` tiles per tick; the missile
   * flies on past the target for a little while if it misses.
   */
  fire(
    kind: ProjectileKind,
    team: Team,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    speed: number,
    damage: number,
    range: number,
    source: number,
    sourceKind = -1,
  ): Projectile {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const slot = this.free.pop();
    const projectile: Projectile =
      slot !== undefined
        ? this.pool[slot]!
        : { active: false, slot: this.pool.length, kind, team, x: 0, y: 0, vx: 0, vy: 0, damage: 0, ttl: 0, source: 0, sourceKind: -1 };
    if (slot === undefined) this.pool.push(projectile);
    projectile.active = true;
    projectile.kind = kind;
    projectile.team = team;
    projectile.x = fromX;
    projectile.y = fromY;
    projectile.vx = (dx / length) * speed;
    projectile.vy = (dy / length) * speed;
    projectile.damage = damage;
    projectile.ttl = Math.ceil((range + 2) / speed);
    projectile.source = source;
    projectile.sourceKind = sourceKind;
    return projectile;
  }

  /**
   * Move every missile one tick. `hitAt` says what, if anything, it strikes in a cell;
   * `impact` is told about each one that stops (it hit something, or ran out of range).
   */
  step(hitAt: (projectile: Projectile, x: number, y: number) => ProjectileImpact | null, impact: (projectile: Projectile, hit: ProjectileImpact | null) => void): void {
    for (const projectile of this.pool) {
      if (!projectile.active) continue;
      projectile.x += projectile.vx;
      projectile.y += projectile.vy;
      const hit = hitAt(projectile, Math.floor(projectile.x), Math.floor(projectile.y));
      if (hit || --projectile.ttl <= 0) {
        projectile.active = false;
        this.free.push(projectile.slot);
        impact(projectile, hit);
      }
    }
  }

  get activeCount(): number {
    return this.pool.length - this.free.length;
  }

  clear(): void {
    for (const projectile of this.pool) projectile.active = false;
    this.free = this.pool.map((projectile) => projectile.slot);
  }
}
