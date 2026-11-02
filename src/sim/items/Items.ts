/**
 * Items lying in the world, and the colony's storage.
 *
 * A dug block or a felled tree drops an item stack where it was. Stacks fall until they
 * rest on something solid (through air, ladders and water; lava destroys them), merge
 * with a resting stack of the same item in the same cell, and wait there until a dwarf
 * hauls them to storage. The colony's inventory is the sum of all storage: the Hearth's
 * and every chest's.
 *
 * Pure: no Phaser and no DOM. The renderer keeps one pooled sprite per stack.
 */
import type { ItemCount, ItemRegistry } from './ItemRegistry';
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

  /** Move every stack in one cell to another (a block is being built where they lie). */
  moveAll(x: number, y: number, toX: number, toY: number): void {
    for (const stack of this.stacks.values()) {
      if (stack.x !== x || stack.y !== y) continue;
      stack.x = toX;
      stack.y = toY;
      stack.falling = this.falls(toX, toY);
      this.version++;
    }
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

/**
 * Everything the colony has put away, by item number.
 *
 * The colony has one store with several doors: the Hearth and every chest. A dwarf puts
 * anything away at, and fetches anything from, whichever of them is nearest; the HUD
 * shows the total.
 *
 *  - Room is counted in stacks: each item takes ceil(count / its stack size) of the slots
 *    the Hearth and the chests provide. Dwarves don't start hauling something that won't
 *    fit, but a delivery already on its way is always accepted, so nothing is ever lost
 *    (the store can run a little over).
 *  - A dwarf that takes on a job reserves the materials before setting off, so two
 *    builders never count on the same plank. Reserved goods stay in storage until they
 *    are fetched; `available` is what is left for new jobs.
 */
export class ColonyStorage {
  private readonly items: ItemRegistry;
  private readonly counts = new Map<number, number>();
  private readonly reserved = new Map<number, number>();
  /** Stack slots the Hearth and the chests provide. */
  capacity: number;
  /** Bumped on every change (for the HUD). */
  version = 0;

  constructor(items: ItemRegistry, capacity: number) {
    this.items = items;
    this.capacity = capacity;
  }

  add(item: number, count: number): void {
    if (count <= 0) return;
    this.counts.set(item, (this.counts.get(item) ?? 0) + count);
    this.version++;
  }

  count(item: number): number {
    return this.counts.get(item) ?? 0;
  }

  /** Stored and not promised to any job. */
  available(item: number): number {
    return this.count(item) - (this.reserved.get(item) ?? 0);
  }

  reservedCount(item: number): number {
    return this.reserved.get(item) ?? 0;
  }

  /** Whether every listed amount is available. */
  hasAll(list: readonly ItemCount[]): boolean {
    return list.every(({ item, count }) => this.available(item) >= count);
  }

  /** Promise all of a list to a job, or (returning false) none of it. */
  reserveAll(list: readonly ItemCount[]): boolean {
    if (!this.hasAll(list)) return false;
    for (const { item, count } of list) this.reserved.set(item, this.reservedCount(item) + count);
    this.version++;
    return true;
  }

  /** Give back a promise made with reserveAll (the job was dropped before the goods were fetched). */
  unreserveAll(list: readonly ItemCount[]): void {
    for (const { item, count } of list) {
      const left = this.reservedCount(item) - count;
      if (left > 0) this.reserved.set(item, left);
      else this.reserved.delete(item);
    }
    this.version++;
  }

  /** Fetch reserved goods: they leave storage and the promise is kept. Returns what was taken. */
  takeReserved(list: readonly ItemCount[]): ItemCount[] {
    const taken: ItemCount[] = [];
    for (const { item, count } of list) {
      const amount = Math.min(count, this.count(item));
      this.remove(item, amount);
      const left = this.reservedCount(item) - count;
      if (left > 0) this.reserved.set(item, left);
      else this.reserved.delete(item);
      if (amount > 0) taken.push({ item, count: amount });
    }
    this.version++;
    return taken;
  }

  /** Take up to `count` of what isn't reserved; returns how many were taken. */
  take(item: number, count: number): number {
    const taken = Math.max(0, Math.min(this.available(item), count));
    this.remove(item, taken);
    return taken;
  }

  /** Stack slots in use. */
  slotsUsed(): number {
    let slots = 0;
    for (const [item, count] of this.counts) slots += Math.ceil(count / this.items.get(item).stack);
    return slots;
  }

  /** Whether at least one more of an item fits: in a part-filled stack of it, or in a free slot. */
  hasRoom(item: number): boolean {
    const count = this.count(item);
    if (count % this.items.get(item).stack !== 0) return true;
    return this.slotsUsed() < this.capacity;
  }

  /** Every stored item with its count, in item order. */
  entries(): ItemCount[] {
    return [...this.counts].sort((a, b) => a[0] - b[0]).map(([item, count]) => ({ item, count }));
  }

  private remove(item: number, count: number): void {
    if (count <= 0) return;
    const left = this.count(item) - count;
    if (left > 0) this.counts.set(item, left);
    else this.counts.delete(item);
    this.version++;
  }
}
