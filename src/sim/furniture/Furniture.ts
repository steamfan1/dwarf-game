/**
 * The furniture standing in the world: chests, torches, crafting stations, beds...
 *
 * Each piece covers a rectangle `width` cells wide and `height` tall, standing on its
 * bottom-left cell (x, y). A grid of piece ids by cell answers "what's here?" in one
 * lookup. Furniture isn't solid: dwarves walk past it and items can lie in front of it.
 *
 * Pure: no Phaser and no DOM.
 */
import type { CellRect, World } from '../world/World';
import type { FurnitureDef, FurnitureRegistry } from './FurnitureRegistry';

export interface PlacedFurniture {
  readonly id: number;
  /** Index into the FurnitureRegistry. */
  readonly kind: number;
  readonly def: FurnitureDef;
  /** Left column and bottom row. */
  readonly x: number;
  readonly y: number;
  /** The cells it covers. */
  readonly rect: CellRect;
  /** The dwarf using it as a crafting station, or 0. */
  user: number;
}

export class FurnitureSet {
  private readonly world: World;
  private readonly registry: FurnitureRegistry;
  private readonly pieces = new Map<number, PlacedFurniture>();
  /** Piece id per cell, 0 for none. */
  private readonly grid: Int32Array;
  private nextId = 1;
  /** Bumped whenever a piece is placed or removed. */
  version = 0;

  constructor(world: World, registry: FurnitureRegistry) {
    this.world = world;
    this.registry = registry;
    this.grid = new Int32Array(world.width * world.height);
  }

  get size(): number {
    return this.pieces.size;
  }

  all(): IterableIterator<PlacedFurniture> {
    return this.pieces.values();
  }

  get(id: number): PlacedFurniture | undefined {
    return this.pieces.get(id);
  }

  /** The piece covering a cell, if any. */
  at(x: number, y: number): PlacedFurniture | undefined {
    if (!this.world.inBounds(x, y)) return undefined;
    const id = this.grid[this.world.index(x, y)]!;
    return id === 0 ? undefined : this.pieces.get(id);
  }

  /** The cells a piece of this kind would cover standing on (x, y). */
  footprint(kind: number, x: number, y: number): CellRect {
    const def = this.registry.get(kind);
    return { x0: x, y0: y - def.height + 1, x1: x + def.width - 1, y1: y };
  }

  /** Whether a rectangle lies inside the world with no furniture in it. */
  isFree(rect: CellRect): boolean {
    const { world } = this;
    if (!world.inBounds(rect.x0, rect.y0) || !world.inBounds(rect.x1, rect.y1)) return false;
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) if (this.grid[world.index(x, y)] !== 0) return false;
    }
    return true;
  }

  place(kind: number, x: number, y: number): PlacedFurniture {
    const rect = this.footprint(kind, x, y);
    if (!this.isFree(rect)) throw new Error(`Furniture can't go at ${x},${y}: something is in the way`);
    const piece: PlacedFurniture = { id: this.nextId++, kind, def: this.registry.get(kind), x, y, rect, user: 0 };
    this.pieces.set(piece.id, piece);
    this.fill(rect, piece.id);
    this.version++;
    return piece;
  }

  remove(id: number): PlacedFurniture | undefined {
    const piece = this.pieces.get(id);
    if (!piece) return undefined;
    this.pieces.delete(id);
    this.fill(piece.rect, 0);
    this.version++;
    return piece;
  }

  /** Every cell index a piece covers. */
  cells(piece: PlacedFurniture): number[] {
    const cells: number[] = [];
    for (let y = piece.rect.y0; y <= piece.rect.y1; y++) {
      for (let x = piece.rect.x0; x <= piece.rect.x1; x++) cells.push(this.world.index(x, y));
    }
    return cells;
  }

  /** Pieces that hold goods (chests): more places to put things away and fetch them from. */
  storagePieces(): PlacedFurniture[] {
    return [...this.pieces.values()].filter((piece) => piece.def.storage > 0);
  }

  /** Stack slots all the storage furniture adds. */
  storageSlots(): number {
    let slots = 0;
    for (const piece of this.pieces.values()) slots += piece.def.storage;
    return slots;
  }

  /** The crafting stations of a kind (workbench, furnace...). */
  stations(kind: string): PlacedFurniture[] {
    return [...this.pieces.values()].filter((piece) => piece.def.station === kind);
  }

  /** The cell a piece's light shines from: its middle column, bottom row. */
  lightCell(piece: PlacedFurniture): { x: number; y: number } {
    return { x: piece.x + Math.floor((piece.def.width - 1) / 2), y: piece.y };
  }

  private fill(rect: CellRect, id: number): void {
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) this.grid[this.world.index(x, y)] = id;
    }
  }
}
