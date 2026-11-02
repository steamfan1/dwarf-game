/**
 * What the toolbar palettes and the crafting panel offer, worked out once from the
 * content files: the blocks, wall materials and furniture there are to build with, the
 * crafting stations, and every recipe with its icons.
 */
import { TICKS_PER_SECOND } from '../config';
import { itemIconUrl } from '../render/assets/itemArt';
import type { GameContent } from '../sim/content';
import { HAND_CRAFTED } from '../sim/crafting/Recipes';
import type { Catalogue, CatalogueItem } from '../ui/state';

export function buildCatalogue({ items, tiles, furniture, recipes }: GameContent): Catalogue {
  const entry = (item: number): CatalogueItem => {
    const def = items.get(item);
    return { id: def.id, name: def.name, icon: itemIconUrl(items, item) };
  };
  const numbers = items.items.map((_, i) => i);
  const builds = (item: number, kind: 'tile' | 'furniture'): boolean => {
    const target = items.get(item).builds;
    return target !== null && kind in target;
  };
  const wallMaterials = new Set(tiles.walls.flatMap((wall) => (wall.material ? [wall.material] : [])));

  const stations: Catalogue['stations'] = [];
  for (const def of furniture.defs) {
    if (def.station && !stations.some((station) => station.id === def.station)) stations.push({ id: def.station, name: def.name });
  }

  return {
    blocks: numbers.filter((item) => builds(item, 'tile')).map(entry),
    walls: numbers.filter((item) => wallMaterials.has(items.get(item).id)).map(entry),
    furniture: numbers.filter((item) => builds(item, 'furniture')).map(entry),
    recipes: recipes.recipes.map((recipe) => ({
      id: recipe.id,
      output: { ...entry(recipe.output.item), count: recipe.output.count },
      inputs: recipe.inputs.map((input) => ({ ...entry(input.item), count: input.count })),
      station: recipe.station === HAND_CRAFTED ? null : recipe.station,
      seconds: Math.round((recipe.time / TICKS_PER_SECOND) * 10) / 10,
    })),
    stations,
  };
}
