/**
 * Recipes (src/data/recipes.json): what goes in, what comes out, where it's made and how
 * long it takes, checked against the item list and the stations furniture provides.
 *
 * `station` is "none" (made by hand at the Hearth or a chest) or a station kind that some
 * furniture in furniture.json provides (workbench, furnace, anvil, loom, kitchen...).
 * `time` is in ticks (20 per second) for a dwarf at crafting level 1.
 */
import { Validator } from '../../core/validate';
import type { ItemCount, ItemRegistry } from '../items/ItemRegistry';

export const HAND_CRAFTED = 'none';

export interface Recipe {
  /** Position in the recipe list. */
  readonly index: number;
  readonly id: string;
  readonly output: ItemCount;
  readonly inputs: readonly ItemCount[];
  /** A station kind, or HAND_CRAFTED. */
  readonly station: string;
  readonly time: number;
}

export class RecipeBook {
  readonly recipes: readonly Recipe[];
  private readonly ids: ReadonlyMap<string, number>;

  private constructor(recipes: Recipe[]) {
    this.recipes = recipes;
    this.ids = new Map(recipes.map((recipe) => [recipe.id, recipe.index]));
  }

  /** Validate raw JSON against the items and the station kinds furniture provides. */
  static fromJson(data: unknown, items: ItemRegistry, stations: ReadonlySet<string>): RecipeBook {
    const v = new Validator('recipes.json');
    const root = v.object(data, '');
    const itemCount = (raw: unknown, path: string): ItemCount => {
      const o = v.object(raw, path);
      const id = v.identifier(o?.item, `${path}.item`);
      if (!items.has(id)) v.problem(`${path}.item refers to unknown item "${id}"`);
      return { item: items.has(id) ? items.item(id) : 0, count: Math.round(v.number(o?.count, `${path}.count`, 1, 999)) };
    };
    const recipes = v.array(root?.recipes, 'recipes').map((raw, index): Recipe => {
      const path = `recipes[${index}]`;
      const o = v.object(raw, path);
      const station = v.identifier(o?.station, `${path}.station`);
      if (station !== HAND_CRAFTED && !stations.has(station)) {
        v.problem(`${path}.station "${station}" is not provided by any furniture (and isn't "${HAND_CRAFTED}")`);
      }
      const inputs = v.array(o?.inputs, `${path}.inputs`).map((input, i) => itemCount(input, `${path}.inputs[${i}]`));
      if (inputs.length === 0) v.problem(`${path}.inputs must not be empty`);
      return {
        index,
        id: v.identifier(o?.id, `${path}.id`),
        output: itemCount(o?.output, `${path}.output`),
        inputs,
        station,
        time: Math.round(v.number(o?.time, `${path}.time`, 1, 10_000)),
      };
    });
    v.unique(
      recipes.map((recipe) => recipe.id),
      'recipe id',
    );
    v.throwIfProblems();
    return new RecipeBook(recipes);
  }

  get(id: string): Recipe {
    const index = this.ids.get(id);
    if (index === undefined) throw new Error(`Unknown recipe "${id}"`);
    return this.recipes[index]!;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }
}
