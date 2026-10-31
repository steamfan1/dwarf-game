/**
 * The text the HUD shows for the cell under the pointer: what it is, how deep it is, and
 * whether (or why not) it can be dug. Pure, apart from looking up UI strings.
 */
import { t, type StringKey } from '../../core/strings';
import type { DigResult, Simulation } from '../../sim/Simulation';
import { AIR } from '../../sim/world/TileRegistry';
import type { HoverInfo } from '../../ui/state';

const REASONS: Partial<Record<DigResult, StringKey>> = {
  indestructible: 'dig.indestructible',
  'supports-hearth': 'dig.supports-hearth',
  'supports-tree': 'dig.supports-tree',
};

export function describeCell(sim: Simulation, x: number, y: number): HoverInfo | null {
  const { world, tiles, hearth } = sim;
  if (!world.inBounds(x, y)) return null;
  if (!world.isVisible(x, y)) return { title: t('hover.unexplored'), detail: t('hover.unexploredDetail'), diggable: false };
  if (y === hearth.y && Math.abs(x - hearth.x) <= 1) {
    return { title: t('hover.hearth'), detail: t('hover.hearthDetail'), diggable: false };
  }

  // Depth is measured from the ground the colony stands on.
  const ground = hearth.y + 1;
  const depth = y > ground ? t('hover.depth', { depth: y - ground }) : y === ground ? t('hover.surface') : t('hover.above', { height: ground - y });

  const i = world.index(x, y);
  const tile = world.fg[i]!;
  const liquid = tiles.liquidDef(world.liquidType[i]!);
  const wall = world.bg[i]!;
  let title: string;
  let detail = depth;
  if (tile !== AIR) title = tiles.tiles[tile]!.name;
  else if (liquid) title = liquid.name;
  else if (world.isSky(x, y)) title = t('hover.sky');
  else if (wall !== 0) {
    title = t('hover.cave');
    detail = `${depth} · ${t('hover.caveDetail', { wall: tiles.walls[wall]!.name })}`;
  } else title = tiles.tiles[AIR]!.name;

  const result = sim.canDig(x, y);
  const reason = REASONS[result];
  if (result === 'dug') detail = `${detail} · ${t('hover.canDig')}`;
  else if (reason) detail = t(reason);
  return { title, detail, diggable: result === 'dug' };
}
