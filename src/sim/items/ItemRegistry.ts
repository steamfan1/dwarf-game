/**
 * Item definitions (src/data/items.json), checked and turned into numeric ids.
 *
 * An item's numeric id is its position in the JSON list. Item entities and storage use
 * numeric ids at runtime; saves will store the string ids, so reordering the JSON never
 * corrupts a saved world.
 */
import { Validator } from '../../core/validate';

export type ItemCategory = 'block' | 'material' | 'ore' | 'tool' | 'weapon' | 'armor' | 'food' | 'furniture';
const CATEGORIES: readonly ItemCategory[] = ['block', 'material', 'ore', 'tool', 'weapon', 'armor', 'food', 'furniture'];

/** How the placeholder icon is painted (see render/assets/itemArt.ts). */
export type IconStyle = 'lump' | 'pile' | 'ball' | 'gem' | 'ore' | 'log';
const ICON_STYLES: readonly IconStyle[] = ['lump', 'pile', 'ball', 'gem', 'ore', 'log'];

export interface ItemIcon {
  style: IconStyle;
  base: string;
  dark: string;
  light: string;
  /** Ore flecks. */
  accent?: string;
}

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  description: string;
  /** Most of one item that fits in a single stack (on the ground or in a dwarf's arms). */
  stack: number;
  icon: ItemIcon;
}

export const DEFAULT_STACK = 50;

export class ItemRegistry {
  readonly items: readonly ItemDef[];
  private readonly ids: ReadonlyMap<string, number>;

  private constructor(items: ItemDef[]) {
    this.items = items;
    this.ids = new Map(items.map((item, i) => [item.id, i]));
  }

  /** Validate raw JSON and build the registry. Throws one error listing every problem found. */
  static fromJson(data: unknown): ItemRegistry {
    const v = new Validator('items.json');
    const root = v.object(data, '');
    const items = v.array(root?.items, 'items').map((raw, i) => parseItem(v, raw, `items[${i}]`));
    v.unique(
      items.map((item) => item.id),
      'item id',
    );
    v.throwIfProblems();
    return new ItemRegistry(items);
  }

  /** Numeric id of an item; throws for unknown ids so typos in content fail loudly. */
  item(id: string): number {
    const n = this.ids.get(id);
    if (n === undefined) throw new Error(`Unknown item "${id}"`);
    return n;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get(item: number): ItemDef {
    const def = this.items[item];
    if (!def) throw new Error(`Unknown item number ${item}`);
    return def;
  }
}

function parseItem(v: Validator, raw: unknown, path: string): ItemDef {
  const o = v.object(raw, path);
  const icon = v.object(o?.icon, `${path}.icon`);
  return {
    id: v.identifier(o?.id, `${path}.id`),
    name: v.string(o?.name, `${path}.name`),
    category: v.oneOf(o?.category, CATEGORIES, `${path}.category`) ?? 'material',
    description: o?.description === undefined ? '' : v.string(o.description, `${path}.description`),
    stack: o?.stack === undefined ? DEFAULT_STACK : Math.round(v.number(o.stack, `${path}.stack`, 1, 999)),
    icon: {
      style: v.oneOf(icon?.style, ICON_STYLES, `${path}.icon.style`) ?? 'lump',
      base: v.color(icon?.base, `${path}.icon.base`),
      dark: v.color(icon?.dark, `${path}.icon.dark`),
      light: v.color(icon?.light, `${path}.icon.light`),
      ...(icon?.accent !== undefined ? { accent: v.color(icon.accent, `${path}.icon.accent`) } : {}),
    },
  };
}
