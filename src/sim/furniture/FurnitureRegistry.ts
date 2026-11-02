/**
 * Furniture definitions (src/data/furniture.json), checked and turned into numeric ids.
 *
 * Furniture stands in front of the tile grid, covering `size` cells (width x height)
 * from its bottom-left corner. Dwarves walk past it. Some furniture does a job:
 *   - `storage`: stacks of goods it holds; dwarves drop off and pick up the colony's goods
 *     there as at the Hearth;
 *   - `station`: a crafting station, named by recipes (workbench, furnace, anvil...);
 *   - `light`: it glows (torches, furnaces).
 * `mount` says what it needs: "floor" (solid ground under its whole width, the default)
 * or "wall" (a background wall behind it, or a block beside or below it).
 */
import { Validator } from '../../core/validate';

export type FurnitureMount = 'floor' | 'wall';

/** How the placeholder sprite is painted (see render/assets/furnitureArt.ts). */
export const FURNITURE_STYLES = [
  'chest',
  'torch',
  'workbench',
  'furnace',
  'anvil',
  'loom',
  'stove',
  'bed',
  'table',
  'chair',
  'trap',
] as const;
export type FurnitureStyle = (typeof FURNITURE_STYLES)[number];

export interface FurnitureArt {
  style: FurnitureStyle;
  base: string;
  dark: string;
  light: string;
  accent?: string;
}

export interface FurnitureDef {
  id: string;
  name: string;
  /** Width and height in cells. */
  width: number;
  height: number;
  mount: FurnitureMount;
  /** Stacks of goods it adds to the colony's storage (0 for none). */
  storage: number;
  /** Crafting station kind, or null. */
  station: string | null;
  light: number;
  mapColor: string;
  art: FurnitureArt;
}

export class FurnitureRegistry {
  readonly defs: readonly FurnitureDef[];
  private readonly ids: ReadonlyMap<string, number>;

  private constructor(defs: FurnitureDef[]) {
    this.defs = defs;
    this.ids = new Map(defs.map((def, i) => [def.id, i]));
  }

  static fromJson(data: unknown): FurnitureRegistry {
    const v = new Validator('furniture.json');
    const root = v.object(data, '');
    const defs = v.array(root?.furniture, 'furniture').map((raw, i) => parseFurniture(v, raw, `furniture[${i}]`));
    v.unique(
      defs.map((def) => def.id),
      'furniture id',
    );
    v.throwIfProblems();
    return new FurnitureRegistry(defs);
  }

  /** Numeric id; throws for unknown ids so typos in content fail loudly. */
  id(name: string): number {
    const n = this.ids.get(name);
    if (n === undefined) throw new Error(`Unknown furniture "${name}"`);
    return n;
  }

  has(name: string): boolean {
    return this.ids.has(name);
  }

  get(id: number): FurnitureDef {
    const def = this.defs[id];
    if (!def) throw new Error(`Unknown furniture number ${id}`);
    return def;
  }

  /** Every crafting station kind some furniture provides. */
  get stations(): ReadonlySet<string> {
    return new Set(this.defs.flatMap((def) => (def.station ? [def.station] : [])));
  }
}

function parseFurniture(v: Validator, raw: unknown, path: string): FurnitureDef {
  const o = v.object(raw, path);
  const size = v.array(o?.size, `${path}.size`).map((n, i) => Math.round(v.number(n, `${path}.size[${i}]`, 1, 4)));
  if (size.length !== 2) v.problem(`${path}.size must be [width, height]`);
  const art = v.object(o?.art, `${path}.art`);
  return {
    id: v.identifier(o?.id, `${path}.id`),
    name: v.string(o?.name, `${path}.name`),
    width: size[0] ?? 1,
    height: size[1] ?? 1,
    mount: o?.mount === undefined ? 'floor' : (v.oneOf(o.mount, ['floor', 'wall'] as const, `${path}.mount`) ?? 'floor'),
    storage: o?.storage === undefined ? 0 : Math.round(v.number(o.storage, `${path}.storage`, 0, 1000)),
    station: o?.station === undefined ? null : v.identifier(o.station, `${path}.station`),
    light: o?.light === undefined ? 0 : Math.round(v.number(o.light, `${path}.light`, 0, 15)),
    mapColor: v.color(o?.mapColor, `${path}.mapColor`),
    art: {
      style: v.oneOf(art?.style, FURNITURE_STYLES, `${path}.art.style`) ?? 'chest',
      base: v.color(art?.base, `${path}.art.base`),
      dark: v.color(art?.dark, `${path}.art.dark`),
      light: v.color(art?.light, `${path}.art.light`),
      ...(art?.accent !== undefined ? { accent: v.color(art.accent, `${path}.art.accent`) } : {}),
    },
  };
}
