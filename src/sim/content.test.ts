import { describe, expect, it } from 'vitest';
import furnitureJson from '../data/furniture.json';
import recipesJson from '../data/recipes.json';
import { checkLinks, CREATURES, FURNITURE, ITEMS, RECIPES, TILES } from './content';
import { CraftQueue, MAX_ORDER } from './crafting/CraftQueue';
import { HAND_CRAFTED, RecipeBook } from './crafting/Recipes';
import { FurnitureRegistry } from './furniture/FurnitureRegistry';
import { ItemRegistry } from './items/ItemRegistry';

function problems(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('shipped content', () => {
  it('has around forty starter items, every one reachable by digging, felling, picking, hunting or crafting', () => {
    expect(ITEMS.items.length).toBeGreaterThanOrEqual(40);
    const obtainable = new Set<string>();
    for (const tile of TILES.tiles) {
      if (tile.drops) obtainable.add(tile.drops);
      if (tile.harvest) obtainable.add(tile.harvest.item);
    }
    for (const recipe of RECIPES.recipes) obtainable.add(ITEMS.get(recipe.output.item).id);
    for (const creature of CREATURES.defs) for (const drop of creature.drops) obtainable.add(drop.item);
    // Wheat comes from farming (Milestone 6).
    const later = new Set(['wheat']);
    const unreachable = ITEMS.items.filter((item) => !obtainable.has(item.id) && !later.has(item.id)).map((item) => item.id);
    expect(unreachable).toEqual([]);
  });

  it('makes every recipe somewhere: by hand or at a station some furniture provides', () => {
    const stations = FURNITURE.stations;
    for (const recipe of RECIPES.recipes) {
      expect(recipe.station === HAND_CRAFTED || stations.has(recipe.station), recipe.id).toBe(true);
    }
    // Every station has something to make, and the first station can be made by hand.
    for (const station of stations) expect(RECIPES.recipes.some((r) => r.station === station), station).toBe(true);
    const workbench = RECIPES.recipes.find((r) => ITEMS.get(r.output.item).id === 'workbench')!;
    expect(workbench.station).toBe(HAND_CRAFTED);
  });

  it('builds every piece of furniture from exactly one item, and every block back into its item', () => {
    expect(() => checkLinks(TILES, ITEMS, FURNITURE)).not.toThrow();
    const broken = structuredClone(furnitureJson) as { furniture: Array<Record<string, unknown>> };
    broken.furniture.push({ ...broken.furniture[0]!, id: 'throne' });
    const message = problems(() => checkLinks(TILES, ITEMS, FurnitureRegistry.fromJson(broken)));
    expect(message).toContain('furniture "throne" must be built by exactly one item, but none is');
  });

  it('gives every chest room and every torch light', () => {
    expect(FURNITURE.get(FURNITURE.id('chest')).storage).toBeGreaterThan(0);
    expect(FURNITURE.get(FURNITURE.id('torch')).light).toBeGreaterThan(0);
    expect(FURNITURE.get(FURNITURE.id('torch')).mount).toBe('wall');
  });
});

describe('content validation', () => {
  it('rejects recipes that use unknown items or stations, all in one error', () => {
    const broken = structuredClone(recipesJson) as { recipes: Array<Record<string, unknown>> };
    broken.recipes[0]!.station = 'forge_of_ages';
    broken.recipes[1]!.inputs = [{ item: 'unobtainium', count: 1 }];
    broken.recipes[2]!.inputs = [];
    const message = problems(() => RecipeBook.fromJson(broken, ITEMS, FURNITURE.stations));
    expect(message).toContain('recipes[0].station "forge_of_ages" is not provided by any furniture');
    expect(message).toContain('recipes[1].inputs[0].item refers to unknown item "unobtainium"');
    expect(message).toContain('recipes[2].inputs must not be empty');
  });

  it('rejects furniture with a bad size or mount', () => {
    const broken = structuredClone(furnitureJson) as { furniture: Array<Record<string, unknown>> };
    broken.furniture[0]!.size = [2];
    broken.furniture[1]!.mount = 'ceiling';
    const message = problems(() => FurnitureRegistry.fromJson(broken));
    expect(message).toContain('furniture[0].size must be [width, height]');
    expect(message).toContain('furniture[1].mount must be one of');
  });

  it('rejects items whose gear or building fields are malformed', () => {
    const message = problems(() =>
      ItemRegistry.fromJson({
        items: [
          { id: 'odd', name: 'Odd', category: 'tool', icon: { style: 'lump', base: '#000000', dark: '#000000', light: '#000000' }, equip: { slot: 'tail', tier: 1 } },
          { id: 'odder', name: 'Odder', category: 'block', icon: { style: 'lump', base: '#000000', dark: '#000000', light: '#000000' }, builds: {} },
        ],
      }),
    );
    expect(message).toContain('items[0].equip.slot must be one of');
    expect(message).toContain('items[1].builds needs "tile" or "furniture"');
  });
});

describe('CraftQueue', () => {
  it('keeps orders in the order they were queued, merging repeats', () => {
    const queue = new CraftQueue();
    const a = queue.add(0, 2);
    const b = queue.add(1, 1);
    expect(queue.add(0, 3)).toBe(a);
    expect(queue.orders.map((order) => [order.recipe, order.count])).toEqual([
      [0, 5],
      [1, 1],
    ]);
    expect(queue.position(b.id)).toBe(1);
  });

  it('finishes an order once every craft is made', () => {
    const queue = new CraftQueue();
    const order = queue.add(0, 2);
    expect(queue.madeOne(order.id)).toBe(false);
    expect(queue.madeOne(order.id)).toBe(true);
    expect(queue.orders).toHaveLength(0);
  });

  it('caps an order, and counts what is left when changed', () => {
    const queue = new CraftQueue();
    const order = queue.add(0, 500);
    expect(order.count).toBe(MAX_ORDER);
    queue.madeOne(order.id);
    queue.setRemaining(order.id, 3);
    expect(order.count - order.made).toBe(3);
    queue.setRemaining(order.id, 0);
    expect(queue.get(order.id)).toBeUndefined();
  });
});
