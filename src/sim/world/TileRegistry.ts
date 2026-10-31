/**
 * Tile, wall and liquid definitions (src/data/tiles.json), checked and turned into
 * numeric ids plus typed-array lookup tables for hot paths such as rendering and,
 * later, pathfinding.
 *
 * Numeric ids are positions in the JSON lists, so tile 0 must be "air" and wall 0 must
 * be "none". Liquid ids start at 1 (0 means "no liquid"). Saves will store string ids,
 * so reordering the JSON never corrupts a saved world.
 */
import { Validator } from '../../core/validate';

export type ArtStyle = 'none' | 'soil' | 'rock' | 'ore' | 'crystal' | 'ice' | 'log' | 'leaves' | 'sprite';
const ART_STYLES: readonly ArtStyle[] = ['none', 'soil', 'rock', 'ore', 'crystal', 'ice', 'log', 'leaves', 'sprite'];

/** A layer drawn on a block's top edge when nothing sits on top of it (grass, snow). */
export interface CapArt {
  base: string;
  light: string;
  dark: string;
  tip?: string;
}

export interface OreArt {
  main: string;
  light: string;
  shadow: string;
  accent?: string;
}

/** How the placeholder art for a tile or wall is painted (see render/world/tileArt.ts). */
export interface TileArt {
  style: ArtStyle;
  base?: string;
  dark?: string;
  light?: string;
  pebble?: string;
  /** Snow dusting on foliage. */
  snow?: string;
  cap?: CapArt;
  ore?: OreArt;
  /** For style "sprite": up to 16 rows of 16 palette characters, drawn bottom-aligned. */
  rows?: string[];
  palette?: Record<string, string>;
}

/** What a tile visually joins up with: other solid blocks, only its own kind, or nothing. */
export type ConnectRule = 'solid' | 'self' | 'none';

export interface TileDef {
  id: string;
  name: string;
  /** Blocks movement and can be stood on. */
  solid: boolean;
  /** Can never be dug (bedrock, world edges). */
  indestructible: boolean;
  /** Relative time to dig; 1 is dirt. */
  hardness: number;
  /** Item id dropped when dug (items arrive in Milestone 3). */
  drops: string | null;
  /** Building or growing over it simply replaces it (grass tufts, leaves). */
  replaceable: boolean;
  connect: ConnectRule;
  mapColor: string;
  art: TileArt;
}

export interface WallDef {
  id: string;
  name: string;
  /** Generated with the world, as opposed to built by dwarves. */
  natural: boolean;
  mapColor: string;
  art: TileArt;
}

export interface LiquidDef {
  id: string;
  name: string;
  mapColor: string;
  art: { base: string; light: string; dark: string; alpha: number };
}

export const AIR = 0;
export const NO_WALL = 0;
export const NO_LIQUID = 0;

export class TileRegistry {
  readonly tiles: readonly TileDef[];
  readonly walls: readonly WallDef[];
  /** Liquid type `n` is `liquids[n - 1]`. */
  readonly liquids: readonly LiquidDef[];

  /** 1 where a tile id blocks movement. */
  readonly solid: Uint8Array;
  /** 1 where a tile id can be dug. */
  readonly diggable: Uint8Array;
  /** 1 where a tile id can be built over or replaced by generation. */
  readonly replaceable: Uint8Array;
  /** Tiles with equal non-zero groups join up visually; 0 never joins anything. */
  readonly connectGroup: Uint16Array;

  private readonly tileIds: ReadonlyMap<string, number>;
  private readonly wallIds: ReadonlyMap<string, number>;
  private readonly liquidIds: ReadonlyMap<string, number>;

  private constructor(tiles: TileDef[], walls: WallDef[], liquids: LiquidDef[]) {
    this.tiles = tiles;
    this.walls = walls;
    this.liquids = liquids;
    this.tileIds = new Map(tiles.map((t, i) => [t.id, i]));
    this.wallIds = new Map(walls.map((w, i) => [w.id, i]));
    this.liquidIds = new Map(liquids.map((l, i) => [l.id, i + 1]));

    this.solid = new Uint8Array(tiles.length);
    this.diggable = new Uint8Array(tiles.length);
    this.replaceable = new Uint8Array(tiles.length);
    this.connectGroup = new Uint16Array(tiles.length);
    tiles.forEach((tile, i) => {
      this.solid[i] = tile.solid ? 1 : 0;
      this.diggable[i] = tile.solid && !tile.indestructible ? 1 : 0;
      this.replaceable[i] = tile.replaceable ? 1 : 0;
      this.connectGroup[i] = tile.connect === 'solid' ? 1 : tile.connect === 'self' ? 2 + i : 0;
    });
  }

  /** Validate raw JSON and build the registry. Throws one error listing every problem found. */
  static fromJson(data: unknown): TileRegistry {
    const v = new Validator('tiles.json');
    const root = v.object(data, '');
    const tiles = v.array(root?.tiles, 'tiles').map((raw, i) => parseTile(v, raw, `tiles[${i}]`));
    const walls = v.array(root?.walls, 'walls').map((raw, i) => parseWall(v, raw, `walls[${i}]`));
    const liquids = v.array(root?.liquids, 'liquids').map((raw, i) => parseLiquid(v, raw, `liquids[${i}]`));

    if (tiles[0]?.id !== 'air') v.problem('tiles[0] must be "air"');
    if (walls[0]?.id !== 'none') v.problem('walls[0] must be "none"');
    v.unique(tiles.map((t) => t.id), 'tile id');
    v.unique(walls.map((w) => w.id), 'wall id');
    v.unique(liquids.map((l) => l.id), 'liquid id');
    v.throwIfProblems();
    return new TileRegistry(tiles, walls, liquids);
  }

  /** Numeric id of a tile; throws for unknown ids so typos in content fail loudly. */
  tile(id: string): number {
    const n = this.tileIds.get(id);
    if (n === undefined) throw new Error(`Unknown tile "${id}"`);
    return n;
  }

  wall(id: string): number {
    const n = this.wallIds.get(id);
    if (n === undefined) throw new Error(`Unknown wall "${id}"`);
    return n;
  }

  liquid(id: string): number {
    const n = this.liquidIds.get(id);
    if (n === undefined) throw new Error(`Unknown liquid "${id}"`);
    return n;
  }

  hasTile(id: string): boolean {
    return this.tileIds.has(id);
  }

  hasWall(id: string): boolean {
    return this.wallIds.has(id);
  }

  hasLiquid(id: string): boolean {
    return this.liquidIds.has(id);
  }

  liquidDef(type: number): LiquidDef | undefined {
    return type > 0 ? this.liquids[type - 1] : undefined;
  }
}

function parseArt(v: Validator, raw: unknown, path: string): TileArt {
  const o = v.object(raw, path);
  const style = v.oneOf(o?.style, ART_STYLES, `${path}.style`) ?? 'none';
  const art: TileArt = { style };
  for (const key of ['base', 'dark', 'light', 'pebble', 'snow'] as const) {
    if (o?.[key] !== undefined) art[key] = v.color(o[key], `${path}.${key}`);
  }
  if (['soil', 'rock', 'ore', 'crystal', 'ice', 'log', 'leaves'].includes(style)) {
    for (const key of ['base', 'dark', 'light'] as const) {
      if (!art[key]) v.problem(`${path}.${key} is required for style "${style}"`);
    }
  }
  if (o?.cap !== undefined) {
    const cap = v.object(o.cap, `${path}.cap`);
    art.cap = {
      base: v.color(cap?.base, `${path}.cap.base`),
      light: v.color(cap?.light, `${path}.cap.light`),
      dark: v.color(cap?.dark, `${path}.cap.dark`),
      ...(cap?.tip !== undefined ? { tip: v.color(cap.tip, `${path}.cap.tip`) } : {}),
    };
  }
  if (style === 'ore' || style === 'crystal') {
    const ore = v.object(o?.ore, `${path}.ore`);
    art.ore = {
      main: v.color(ore?.main, `${path}.ore.main`),
      light: v.color(ore?.light, `${path}.ore.light`),
      shadow: v.color(ore?.shadow, `${path}.ore.shadow`),
      ...(ore?.accent !== undefined ? { accent: v.color(ore.accent, `${path}.ore.accent`) } : {}),
    };
  }
  if (style === 'sprite') {
    const palette = v.object(o?.palette, `${path}.palette`) ?? {};
    art.palette = {};
    for (const [ch, color] of Object.entries(palette)) {
      if (ch.length !== 1 || ch === '.') v.problem(`${path}.palette key "${ch}" must be one character other than "."`);
      art.palette[ch] = v.color(color, `${path}.palette.${ch}`);
    }
    const rows = v.array(o?.rows, `${path}.rows`).map((row, y) => v.string(row, `${path}.rows[${y}]`));
    if (rows.length === 0 || rows.length > 16) v.problem(`${path}.rows must have 1 to 16 rows`);
    rows.forEach((row, y) => {
      if (row.length !== 16) v.problem(`${path}.rows[${y}] is ${row.length} characters wide, expected 16`);
      for (const ch of row) {
        if (ch !== '.' && !(ch in (art.palette ?? {}))) v.problem(`${path}.rows[${y}] uses "${ch}", which is not in the palette`);
      }
    });
    art.rows = rows;
  }
  return art;
}

function parseTile(v: Validator, raw: unknown, path: string): TileDef {
  const o = v.object(raw, path);
  const solid = v.boolean(o?.solid, `${path}.solid`);
  const connect = o?.connect === undefined ? (solid ? 'solid' : 'none') : v.oneOf(o.connect, ['solid', 'self', 'none'] as const, `${path}.connect`) ?? 'none';
  return {
    id: v.identifier(o?.id, `${path}.id`),
    name: v.string(o?.name, `${path}.name`),
    solid,
    indestructible: o?.indestructible === undefined ? false : v.boolean(o.indestructible, `${path}.indestructible`),
    hardness: o?.hardness === undefined ? 1 : v.number(o.hardness, `${path}.hardness`, 0.1, 100),
    drops: o?.drops === undefined ? null : v.identifier(o.drops, `${path}.drops`),
    replaceable: o?.replaceable === undefined ? false : v.boolean(o.replaceable, `${path}.replaceable`),
    connect,
    mapColor: v.color(o?.mapColor, `${path}.mapColor`),
    art: parseArt(v, o?.art, `${path}.art`),
  };
}

function parseWall(v: Validator, raw: unknown, path: string): WallDef {
  const o = v.object(raw, path);
  return {
    id: v.identifier(o?.id, `${path}.id`),
    name: v.string(o?.name, `${path}.name`),
    natural: v.boolean(o?.natural, `${path}.natural`),
    mapColor: v.color(o?.mapColor, `${path}.mapColor`),
    art: parseArt(v, o?.art, `${path}.art`),
  };
}

function parseLiquid(v: Validator, raw: unknown, path: string): LiquidDef {
  const o = v.object(raw, path);
  const art = v.object(o?.art, `${path}.art`);
  return {
    id: v.identifier(o?.id, `${path}.id`),
    name: v.string(o?.name, `${path}.name`),
    mapColor: v.color(o?.mapColor, `${path}.mapColor`),
    art: {
      base: v.color(art?.base, `${path}.art.base`),
      light: v.color(art?.light, `${path}.art.light`),
      dark: v.color(art?.dark, `${path}.art.dark`),
      alpha: v.number(art?.alpha, `${path}.art.alpha`, 0, 1),
    },
  };
}
