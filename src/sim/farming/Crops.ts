/**
 * Farming content (src/data/crops.json): what can be grown, from which seeds, how long it
 * takes and what a harvest gives, plus which blocks can be tilled into farmland.
 *
 * A crop grows only while its cell is lit at least `minLight` (sunlight by day, or a torch
 * or lamp nearby); `growDays` is how many days of daylight it needs. Each crop shows as a
 * row of tiles in tiles.json, one per stage, the last being the ripe crop.
 *
 * Pure: no Phaser and no DOM.
 */
import { Validator } from '../../core/validate';
import type { ItemCount, ItemRegistry } from '../items/ItemRegistry';
import type { TileRegistry } from '../world/TileRegistry';

export interface CropDef {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  /** The item sown (one per plant). */
  readonly seed: number;
  /** Days of daylight it needs to ripen. */
  readonly growDays: number;
  /** The light (0-15) its cell needs for it to grow. */
  readonly minLight: number;
  /** Its tiles, from sprout to ripe (the last). */
  readonly stages: readonly number[];
  /** What a ripe plant gives when picked: its crop, and seeds to sow again. */
  readonly harvest: readonly ItemCount[];
}

export class CropRegistry {
  readonly crops: readonly CropDef[];
  /** Blocks that can be tilled. */
  readonly soil: ReadonlySet<number>;
  /** The tilled block. */
  readonly farmland: number;
  /** Ticks a beginner takes to till a plot, and to sow it. */
  readonly tillTicks: number;
  readonly plantTicks: number;
  /** Every crop stage tile. */
  readonly stageTiles: ReadonlySet<number>;

  private constructor(fields: Omit<CropRegistry, 'bySeed' | 'cropOfTile'>) {
    this.crops = fields.crops;
    this.soil = fields.soil;
    this.farmland = fields.farmland;
    this.tillTicks = fields.tillTicks;
    this.plantTicks = fields.plantTicks;
    this.stageTiles = fields.stageTiles;
  }

  static fromJson(data: unknown, tiles: TileRegistry, items: ItemRegistry): CropRegistry {
    const v = new Validator('crops.json');
    const root = v.object(data, '');
    const tile = (raw: unknown, path: string): number => {
      const id = v.identifier(raw, path);
      if (!tiles.hasTile(id)) {
        v.problem(`${path} refers to unknown tile "${id}"`);
        return 0;
      }
      return tiles.tile(id);
    };
    const item = (raw: unknown, path: string): number => {
      const id = v.identifier(raw, path);
      if (!items.has(id)) {
        v.problem(`${path} refers to unknown item "${id}"`);
        return 0;
      }
      return items.item(id);
    };
    const soil = new Set(v.array(root?.soil, 'soil').map((raw, i) => tile(raw, `soil[${i}]`)));
    const farmland = tile(root?.farmland, 'farmland');
    if (tiles.tiles[farmland] && !tiles.solid[farmland]) v.problem('farmland must be a solid block');
    const stageTiles = new Set<number>();
    const crops = v.array(root?.crops, 'crops').map((raw, index): CropDef => {
      const path = `crops[${index}]`;
      const o = v.object(raw, path);
      const stages = v.array(o?.stages, `${path}.stages`).map((s, i) => tile(s, `${path}.stages[${i}]`));
      if (stages.length < 2) v.problem(`${path}.stages needs at least two tiles (growing and ripe)`);
      for (const stage of stages) {
        if (tiles.solid[stage] || tiles.replaceable[stage]) v.problem(`${path}.stages: crop tiles must be neither solid nor replaceable`);
        stageTiles.add(stage);
      }
      const harvest = v.array(o?.harvest, `${path}.harvest`).map((h, i) => {
        const ho = v.object(h, `${path}.harvest[${i}]`);
        return { item: item(ho?.item, `${path}.harvest[${i}].item`), count: Math.round(v.number(ho?.count, `${path}.harvest[${i}].count`, 1, 99)) };
      });
      if (harvest.length === 0) v.problem(`${path}.harvest must not be empty`);
      return {
        index,
        id: v.identifier(o?.id, `${path}.id`),
        name: v.string(o?.name, `${path}.name`),
        seed: item(o?.seed, `${path}.seed`),
        growDays: v.number(o?.growDays, `${path}.growDays`, 0.05, 100),
        minLight: Math.round(v.number(o?.minLight, `${path}.minLight`, 0, 15)),
        stages,
        harvest,
      };
    });
    v.unique(
      crops.map((crop) => crop.id),
      'crop id',
    );
    v.unique(
      crops.map((crop) => String(crop.seed)),
      'crop seed',
    );
    const fields = {
      crops,
      soil,
      farmland,
      tillTicks: Math.round(v.number(root?.tillTicks, 'tillTicks', 1, 10_000)),
      plantTicks: Math.round(v.number(root?.plantTicks, 'plantTicks', 1, 10_000)),
      stageTiles,
    };
    v.throwIfProblems();
    return new CropRegistry(fields);
  }

  /** The crop grown from a seed item, if any. */
  bySeed(item: number): CropDef | undefined {
    return this.crops.find((crop) => crop.seed === item);
  }

  /** The crop a stage tile belongs to, if any. */
  cropOfTile(tile: number): CropDef | undefined {
    return this.crops.find((crop) => crop.stages.includes(tile));
  }
}
