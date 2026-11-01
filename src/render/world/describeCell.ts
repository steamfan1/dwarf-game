/**
 * The words the HUD shows for whatever is under the pointer: a cell (what it is, how deep,
 * any mark on it, and what the current tool would do there) or a dwarf (who, and what
 * it's doing). Pure, apart from looking up UI strings.
 */
import { t, type StringKey } from '../../core/strings';
import type { Dwarf } from '../../sim/dwarves/Dwarf';
import type { Job, Priority } from '../../sim/jobs/JobBoard';
import type { DigStatus, Simulation } from '../../sim/Simulation';
import { AIR } from '../../sim/world/TileRegistry';
import type { HoverAction, HoverInfo, Tool } from '../../ui/state';

const DIG_REASONS: Record<Exclude<DigStatus, 'ok'>, StringKey> = {
  marked: 'dig.marked',
  'out-of-bounds': 'dig.nothing-to-dig',
  unexplored: 'hover.unexploredDetail',
  'nothing-to-dig': 'dig.nothing-to-dig',
  indestructible: 'dig.indestructible',
  'supports-hearth': 'dig.supports-hearth',
  'supports-tree': 'dig.supports-tree',
};

export function priorityName(priority: Priority): string {
  return t(`priority.${priority}`);
}

export function describeCell(sim: Simulation, x: number, y: number, tool: Tool, priority: Priority): HoverInfo | null {
  const { world, tiles, hearth } = sim;
  if (!world.inBounds(x, y)) return null;
  if (!world.isVisible(x, y)) return { title: t('hover.unexplored'), detail: t('hover.unexploredDetail'), action: 'none' };
  if (y === hearth.y && Math.abs(x - hearth.x) <= 1) return { title: t('hover.hearth'), detail: t('hover.hearthDetail'), action: 'none' };

  // Depth is measured from the ground the colony stands on.
  const ground = hearth.y + 1;
  const depth = y > ground ? t('hover.depth', { depth: y - ground }) : y === ground ? t('hover.surface') : t('hover.above', { height: ground - y });

  const i = world.index(x, y);
  const tile = world.fg[i]!;
  const liquid = tiles.liquidDef(world.liquidType[i]!);
  const wall = world.bg[i]!;
  let title: string;
  const details: string[] = [depth];
  if (tile !== AIR) title = tiles.tiles[tile]!.name;
  else if (liquid) title = liquid.name;
  else if (world.isSky(x, y)) title = t('hover.sky');
  else if (wall !== 0) {
    title = t('hover.cave');
    details.push(t('hover.caveDetail', { wall: tiles.walls[wall]!.name }));
  } else title = tiles.tiles[AIR]!.name;

  const job = sim.jobs.at(x, y);
  if (job) details.push(describeMark(sim, job));

  const { action, hint } = toolHint(sim, x, y, tool, priority, job);
  if (hint) details.push(hint);
  return { title, detail: details.join(' · '), action };
}

/** A dig or chop mark: its priority, who is on it, or why nobody can be. */
export function describeMark(sim: Simulation, job: Job): string {
  if (job.unsafe) return t('mark.unsafe');
  if (job.blocked) return t('mark.blocked');
  const worker = job.claimedBy !== 0 ? sim.dwarf(job.claimedBy) : undefined;
  if (worker && worker.phase === 'working') return t('mark.working', { name: worker.name, percent: Math.round(sim.jobProgress(job) * 100) });
  if (worker) return t('mark.claimed', { name: worker.name });
  return t(job.type === 'dig' ? 'mark.dig' : 'mark.chop', { priority: priorityName(job.priority) });
}

function toolHint(sim: Simulation, x: number, y: number, tool: Tool, priority: Priority, job: Job | undefined): { action: HoverAction; hint: string } {
  switch (tool) {
    case 'dig': {
      const status = sim.digStatus(x, y);
      if (status === 'ok') return { action: 'ok', hint: t('tool.dig.hint') };
      return { action: status === 'marked' ? 'none' : 'blocked', hint: status === 'marked' ? '' : t(DIG_REASONS[status]) };
    }
    case 'chop': {
      const tree = sim.trees.treeAt(x, y);
      if (!tree) return { action: 'blocked', hint: t('tool.chop.noTree') };
      if (sim.jobs.at(tree.x, tree.base)) return { action: 'none', hint: '' };
      return { action: 'ok', hint: t('tool.chop.hint') };
    }
    case 'cancel':
      return job ? { action: 'ok', hint: t('tool.cancel.hint') } : { action: 'none', hint: '' };
    case 'priority':
      return job ? { action: 'ok', hint: t('tool.priority.hint', { priority: priorityName(priority) }) } : { action: 'none', hint: '' };
    default:
      return { action: 'none', hint: '' };
  }
}

/** What a dwarf is doing, in a few words. */
export function describeActivity(sim: Simulation, dwarf: Dwarf, stranded: boolean): string {
  const job = dwarf.jobId !== 0 ? sim.jobs.get(dwarf.jobId) : undefined;
  const blockName = job && job.type === 'dig' ? sim.tiles.tiles[sim.world.fgAt(job.x, job.y)]!.name.toLowerCase() : '';
  const carried = dwarf.carrying ? sim.items.get(dwarf.carrying.item).name.toLowerCase() : '';
  const stack = job && job.type === 'haul' ? sim.ground.get(job.stackId) : undefined;
  const fetched = stack ? sim.items.get(stack.item).name.toLowerCase() : '';
  switch (dwarf.phase) {
    case 'dead':
      return t('activity.dead');
    case 'falling':
      return t('activity.falling');
    case 'to-job':
      return job?.type === 'chop' ? t('activity.toChop') : t('activity.toDig', { block: blockName });
    case 'working':
      return job?.type === 'chop' ? t('activity.chopping') : t('activity.digging', { block: blockName });
    case 'to-item':
      return t('activity.fetching', { item: fetched });
    case 'picking-up':
      return t('activity.pickingUp', { item: fetched });
    case 'to-storage':
      return t('activity.carrying', { item: carried });
    case 'dropping-off':
      return t('activity.storing', { item: carried });
    case 'wandering':
      return t('activity.wandering');
    case 'idle':
      return stranded ? t('activity.stranded') : t('activity.idle');
  }
}
