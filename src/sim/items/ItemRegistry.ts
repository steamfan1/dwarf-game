/**
 * Item definitions (src/data/items.json), checked and turned into numeric ids.
 *
 * An item's numeric id is its position in the JSON list. Item entities and storage use
 * numeric ids at runtime; saves will store the string ids, so reordering the JSON never
 * corrupts a saved world.
 */
import { Validator } from '../../core/validate';

export type ItemCategory = 'block' | 'material' | 'ore' | 'tool' | 'weapon' | 'armor' | 'food' | 'potion' | 'furniture';
const CATEGORIES: readonly ItemCategory[] = ['block', 'material', 'ore', 'tool', 'weapon', 'armor', 'food', 'potion', 'furniture'];

/** How the placeholder icon is painted (see render/assets/itemArt.ts). */
export const ICON_STYLES = [
  'lump',
  'pile',
  'ball',
  'gem',
  'ore',
  'log',
  'plank',
  'brick',
  'pane',
  'bar',
  'fiber',
  'cloth',
  'hide',
  'wisp',
  'meat',
  'wheat',
  'bread',
  'berries',
  'mushroom',
  'bowl',
  'potion',
  'ladder',
  'door',
  'chest',
  'torch',
  'bench',
  'furnace',
  'anvil',
  'loom',
  'stove',
  'bed',
  'table',
  'chair',
  'trap',
  'turret',
  'pickaxe',
  'sword',
  'crossbow',
  'tunic',
  'helmet',
  'chestplate',
  'amulet',
] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

/** Equipment slots, as on a dwarf (see sim/dwarves/Dwarf.ts). */
export const EQUIP_SLOTS = ['head', 'body', 'weapon', 'tool', 'accessory'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** What a ranged weapon or a turret shoots. */
export const PROJECTILE_KINDS = ['bolt', 'spit'] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

/** What a dwarf can wear or wield. Higher tiers replace lower ones automatically. */
export interface EquipStats {
  slot: EquipSlot;
  tier: number;
  /** Tools: how many times faster than bare hands it digs (1 = no better). */
  digSpeed: number;
  /** Weapons: damage per hit. */
  damage: number;
  /** Weapons: ticks between hits (0 = the colony's usual pace, see dwarves.json combat). */
  attackTicks: number;
  /** Weapons: reach in tiles; more than 1 shoots `projectile`s. */
  range: number;
  projectile: ProjectileKind | null;
  /** Armour: how much it softens each hit (see threats.json armorScale). */
  armor: number;
}

/** Some number of one item: a recipe's input or output, what a dwarf carries, a stack. */
export interface ItemCount {
  item: number;
  count: number;
}

/** What building with an item puts into the world: a tile in the grid, or a piece of furniture. */
export type BuildTarget = { tile: string } | { furniture: string };

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
  /** Building with it places this, or null. */
  builds: BuildTarget | null;
  equip: EquipStats | null;
  /** Food: hunger restored by eating one, and health mended. */
  food: { hunger: number; heal: number } | null;
  /** Brings a fallen dwarf back to life, with this fraction of its health. */
  revive: { health: number } | null;
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

function parseBuilds(v: Validator, raw: unknown, path: string): BuildTarget | null {
  if (raw === undefined) return null;
  const o = v.object(raw, path);
  if (o?.tile !== undefined) return { tile: v.identifier(o.tile, `${path}.tile`) };
  if (o?.furniture !== undefined) return { furniture: v.identifier(o.furniture, `${path}.furniture`) };
  v.problem(`${path} needs "tile" or "furniture"`);
  return null;
}

function parseEquip(v: Validator, raw: unknown, path: string): EquipStats | null {
  if (raw === undefined) return null;
  const o = v.object(raw, path);
  const optional = (key: string, fallback: number, max: number): number =>
    o?.[key] === undefined ? fallback : v.number(o[key], `${path}.${key}`, 0, max);
  const range = optional('range', 1, 30);
  const projectile = o?.projectile === undefined ? null : (v.oneOf(o.projectile, PROJECTILE_KINDS, `${path}.projectile`) ?? null);
  if (range > 1 && projectile === null) v.problem(`${path} has a range of ${range}, so it needs a "projectile"`);
  return {
    slot: v.oneOf(o?.slot, EQUIP_SLOTS, `${path}.slot`) ?? 'tool',
    tier: Math.round(v.number(o?.tier, `${path}.tier`, 0, 10)),
    digSpeed: optional('digSpeed', 1, 10),
    damage: optional('damage', 0, 1000),
    attackTicks: Math.round(optional('attackTicks', 0, 1000)),
    range,
    projectile,
    armor: optional('armor', 0, 1000),
  };
}

function parseItem(v: Validator, raw: unknown, path: string): ItemDef {
  const o = v.object(raw, path);
  const icon = v.object(o?.icon, `${path}.icon`);
  const food = o?.food === undefined ? null : v.object(o.food, `${path}.food`);
  const revive = o?.revive === undefined ? null : v.object(o.revive, `${path}.revive`);
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
    builds: parseBuilds(v, o?.builds, `${path}.builds`),
    equip: parseEquip(v, o?.equip, `${path}.equip`),
    food: food
      ? {
          hunger: v.number(food.hunger, `${path}.food.hunger`, 0, 100),
          heal: food.heal === undefined ? 0 : v.number(food.heal, `${path}.food.heal`, 0, 1000),
        }
      : null,
    revive: revive ? { health: v.number(revive.health, `${path}.revive.health`, 0.05, 1) } : null,
  };
}
