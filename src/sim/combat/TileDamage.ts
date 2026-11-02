/**
 * Damage done to doors and blocks by monsters smashing their way in. Only damaged cells
 * are kept (a handful at a time), by cell index. A block breaks when its damage reaches
 * its hit points (see Simulation.tileHp); digging or rebuilding a cell forgets its damage.
 *
 * Pure: no Phaser and no DOM.
 */
export class TileDamage {
  private readonly damage = new Map<number, number>();
  /** Bumped on every change, so the renderer redraws the cracks only when needed. */
  version = 0;

  get(cell: number): number {
    return this.damage.get(cell) ?? 0;
  }

  /** Add damage to a cell; returns its total damage now. */
  add(cell: number, amount: number): number {
    const total = this.get(cell) + amount;
    this.damage.set(cell, total);
    this.version++;
    return total;
  }

  clear(cell: number): void {
    if (this.damage.delete(cell)) this.version++;
  }

  /** Every damaged cell and its damage. */
  entries(): IterableIterator<[number, number]> {
    return this.damage.entries();
  }

  get size(): number {
    return this.damage.size;
  }
}
