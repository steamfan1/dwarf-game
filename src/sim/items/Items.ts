/**
 * Items lying in the world, and the colony's storage.
 *
 * A dug block or a felled tree drops an item stack where it was. Stacks fall until they
 * rest on something solid (through air, ladders and water; lava destroys them), merge
 * with a resting stack of the same item in the same cell, and wait there until a dwarf
 * hauls them to storage. The colony's inventory is the sum of all storage: for now the
 * Hearth's store, with chests joining it in Milestone 3.
 *
 * Pure: no Phaser and no DOM. The renderer keeps one pooled sprite per stack.
 */
import type { ItemRegistry } from './ItemRegistry';
import type { TileRegistry } from '../world/TileRegistry';
import type { World } from '../world/World';

export interface ItemStack {
  readonly id: number;
  /** Item number in the ItemRegistry. */
  readonly item: number;
  count: number;
  x: number;
  y: number;
  /** True while it is falling (it moves one row per tick). */
  falling: boolean;
  /** The haul job that will collect it (0 once that job is gone). */
  haulJob: number;
}

export class GroundItems {
  private readonly world: World;
  private readonly tiles: TileRegistry;
  private readonly items: ItemRegistry;
  private readonly stacks = new Map<number, ItemStack>();
  private nextId = 1;
  private readonly lavaType: number;
  /** Bumped whenever a stack appears, moves, changes or disappears (for the renderer). */
  version = 0;

  constructor(world: World, tiles: TileRegistry, items: ItemRegistry) {
    this.world = world;
    this.tiles = tiles;
    this.items = items;
    this.lavaType = tiles.hasLiquid('lava') ? tiles.liquid('lava') : -1;
  }

  get size(): number {
    return this.stacks.size;
  }

  all(): IterableIterator<ItemStack> {
    return this.stacks.values();
  }

  get(id: number): ItemStack | undefined {
    return this.stacks.get(id);
  }

  /**
   * Drop `count` of an item into a cell. It joins a resting stack of the same item there
   * if one has room, and otherwise starts new stacks. Returns the stacks created.
   */
  drop(item: number, count: number, x: number, y: number): ItemStack[] {
    const created: ItemStack[] = [];
    let left = count;
    const max = this.items.get(item).stack;
    if (!this.falls(x, y)) left = this.mergeInto(item, left, x, y);
    while (left > 0) {
      const amount = Math.min(left, max);
      left -= amount;
      const stack: ItemStack = { id: this.nextId++, item, count: amount, x, y, falling: this.falls(x, y), haulJob: 0 };
      this.stacks.set(stack.id, stack);
      created.push(stack);
    }
    this.version++;
    return created;
  }

  remove(id: number): ItemStack | undefined {
    const stack = this.stacks.get(id);
    if (!stack) return undefined;
    this.stacks.delete(id);
    this.version++;
    return stack;
  }

  /**
   * One tick of gravity: falling stacks drop a row; resting stacks start falling if their
   * floor was dug away. Returns the stacks destroyed by lava, so their jobs can go too.
   */
  step(): ItemStack[] {
    const burned: ItemStack[] = [];
    for (const stack of this.stacks.values()) {
      if (!this.falls(stack.x, stack.y)) {
        if (stack.falling) {
          stack.falling = false;
          this.version++;
        }
        continue;
      }
      stack.falling = true;
      stack.y++;
      this.version++;
      if (this.world.liquidType[this.world.index(stack.x, stack.y)] === this.lavaType) burned.push(stack);
    }
    for (const stack of burned) this.stacks.delete(stack.id);
    return burned;
  }

  /** Whether an item in this cell would fall: nothing solid below it, and not already in lava. */
  private falls(x: number, y: number): boolean {
    const { world } = this;
    if (y + 1 >= world.height) return false;
    if (world.liquidType[world.index(x, y)] === this.lavaType) return false;
    return !this.tiles.solid[world.fg[world.index(x, y + 1)]!];
  }

  /** Add to resting stacks of the same item in a cell; returns how many didn't fit. */
  private mergeInto(item: number, count: number, x: number, y: number): number {
    let left = count;
    const max = this.items.get(item).stack;
    for (const stack of this.stacks.values()) {
      if (left === 0) break;
      if (stack.item !== item || stack.x !== x || stack.y !== y || stack.falling || stack.count >= max) continue;
      const moved = Math.min(left, max - stack.count);
      stack.count += moved;
      left -= moved;
    }
    return left;
  }
}

/** Everything the colony has put away, by item number. */
export class ColonyStorage {
  private readonly counts = new Map<number, number>();
  /** Bumped on every change (for the HUD). */
  version = 0;

  add(item: number, count: number): void {
    if (count <= 0) return;
    this.counts.set(item, (this.counts.get(item) ?? 0) + count);
    this.version++;
  }

  /** Take up to `count`; returns how many were taken. */
  take(item: number, count: number): number {
    const have = this.counts.get(item) ?? 0;
    const taken = Math.min(have, count);
    if (taken === 0) return 0;
    if (have === taken) this.counts.delete(item);
    else this.counts.set(item, have - taken);
    this.version++;
    return taken;
  }

  count(item: number): number {
    return this.counts.get(item) ?? 0;
  }

  /** Every stored item with its count, in item order. */
  entries(): Array<{ item: number; count: number }> {
    return [...this.counts].sort((a, b) => a[0] - b[0]).map(([item, count]) => ({ item, count }));
  }
}
