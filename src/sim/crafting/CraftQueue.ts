/**
 * The colony's crafting orders, in the order the player queued them.
 *
 * An order asks for `count` crafts of a recipe; it is finished once `made` reaches
 * `count`. The simulation keeps an open craft job on the job board for each order that
 * still needs hands, so several dwarves can work on one order at once (at different
 * stations, or by hand). Queuing a recipe that is already queued adds to that order.
 *
 * Pure: no Phaser and no DOM.
 */

export interface CraftOrder {
  readonly id: number;
  /** Index in the RecipeBook. */
  readonly recipe: number;
  /** Crafts wanted in all (each makes the recipe's output count). */
  count: number;
  /** Crafts finished so far. */
  made: number;
}

/** Most crafts one order can ask for. */
export const MAX_ORDER = 99;

export class CraftQueue {
  private list: CraftOrder[] = [];
  private nextId = 1;
  /** Bumped on every change (for the crafting panel). */
  version = 0;

  get orders(): readonly CraftOrder[] {
    return this.list;
  }

  get(id: number): CraftOrder | undefined {
    return this.list.find((order) => order.id === id);
  }

  /** Ask for `count` more crafts of a recipe: added to its order if it's already queued. */
  add(recipe: number, count: number): CraftOrder {
    const existing = this.list.find((order) => order.recipe === recipe);
    if (existing) {
      existing.count = Math.min(MAX_ORDER + existing.made, existing.count + count);
      this.version++;
      return existing;
    }
    const order: CraftOrder = { id: this.nextId++, recipe, count: Math.min(MAX_ORDER, Math.max(1, count)), made: 0 };
    this.list.push(order);
    this.version++;
    return order;
  }

  /** Change how many crafts are still wanted. At 0 the order is finished and removed. */
  setRemaining(id: number, remaining: number): void {
    const order = this.get(id);
    if (!order) return;
    const left = Math.max(0, Math.min(MAX_ORDER, Math.round(remaining)));
    if (left === 0) {
      this.remove(id);
      return;
    }
    order.count = order.made + left;
    this.version++;
  }

  remove(id: number): CraftOrder | undefined {
    const index = this.list.findIndex((order) => order.id === id);
    if (index < 0) return undefined;
    const [order] = this.list.splice(index, 1);
    this.version++;
    return order;
  }

  /** One craft of an order is done. Returns true if that finished the order (it's removed). */
  madeOne(id: number): boolean {
    const order = this.get(id);
    if (!order) return false;
    order.made++;
    this.version++;
    if (order.made < order.count) return false;
    this.remove(id);
    return true;
  }

  /** Where an order stands in the queue (0 is first), or -1. */
  position(id: number): number {
    return this.list.findIndex((order) => order.id === id);
  }
}
