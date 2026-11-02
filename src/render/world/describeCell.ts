/**
 * The words the HUD shows for whatever is under the pointer: a cell (what it is, how deep,
 * any planned work on it, and what the current tool would do there) or a dwarf (who, and
 * what it's doing). Pure, apart from looking up UI strings.
 */
import { t, type StringKey } from '../../core/strings';
import type { Dwarf } from '../../sim/dwarves/Dwarf';
import type { Job, Priority } from '../../sim/jobs/JobBoard';
import type { BuildStatus, DigStatus, Simulation } from '../../sim/Simulation';
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
  'supports-furniture': 'dig.supports-furniture',
};

export function priorityName(priority: Priority): string {
  return t(`priority.${priority}`);
}

/**
 * `buildItem` is what the current build tool builds with (an item number), for the
 * Build, Walls and Furniture tools.
 */
export function describeCell(sim: Simulation, x: number, y: number, tool: Tool, priority: Priority, buildItem: number | null = null): HoverInfo | null {
  const { world, tiles, hearth } = sim;
  if (!world.inBounds(x, y)) return null;
  if (!world.isVisible(x, y)) return { title: t('hover.unexplored'), detail: t('hover.unexploredDetail'), action: 'none' };
  const h = sim.hearthArea;
  if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 && !isBuildTool(tool)) {
    return { title: t('hover.hearth'), detail: t('hover.hearthDetail'), action: 'none' };
  }

  // Depth is measured from the ground the colony stands on.
  const ground = hearth.y + 1;
  const depth = y > ground ? t('hover.depth', { depth: y - ground }) : y === ground ? t('hover.surface') : t('hover.above', { height: ground - y });

  const i = world.index(x, y);
  const tile = world.fg[i]!;
  const liquid = tiles.liquidDef(world.liquidType[i]!);
  const wall = world.bg[i]!;
  const piece = sim.furniture.at(x, y);
  let title: string;
  const details: string[] = [depth];
  if (piece) {
    title = piece.def.name;
    if (piece.def.station) details.push(t('hover.station'));
    if (piece.def.storage > 0) details.push(t('hover.chest', { slots: piece.def.storage }));
    if (piece.def.light > 0) details.push(t('hover.light'));
  } else if (tile !== AIR) title = tiles.tiles[tile]!.name;
  else if (liquid) title = liquid.name;
  else if (world.isSky(x, y)) title = wall === 0 ? t('hover.sky') : tiles.walls[wall]!.name; // a wall built in the open
  else if (wall !== 0) {
    title = t('hover.cave');
    details.push(t('hover.caveDetail', { wall: tiles.walls[wall]!.name }));
  } else title = tiles.tiles[AIR]!.name;

  const job = sim.jobs.at(x, y);
  const wallJob = sim.jobs.wallAt(x, y);
  if (job) details.push(describeMark(sim, job));
  if (wallJob) details.push(describeMark(sim, wallJob));

  const { action, hint } = toolHint(sim, x, y, tool, priority, job ?? wallJob, buildItem);
  if (hint) details.push(hint);
  return { title, detail: details.join(' · '), action };
}

function isBuildTool(tool: Tool): boolean {
  return tool === 'build' || tool === 'wall' || tool === 'furniture';
}

/** What a planned job will put in place, in words. */
function plannedThing(sim: Simulation, job: Job): string {
  if (job.type === 'build') return sim.tiles.tiles[job.target]!.name;
  if (job.type === 'wall') return sim.tiles.walls[job.target]!.name;
  if (job.type === 'place') return sim.furnitureKinds.get(job.target).name;
  return '';
}

/** A mark: what's planned, its priority, who is on it, or why nobody can be. */
export function describeMark(sim: Simulation, job: Job): string {
  const building = job.type === 'build' || job.type === 'wall' || job.type === 'place';
  const status = markStatus(sim, job);
  return building ? `${t('hover.planned', { thing: plannedThing(sim, job) })}, ${status}` : status;
}

function markStatus(sim: Simulation, job: Job): string {
  const building = job.type === 'build' || job.type === 'wall' || job.type === 'place';
  if (job.unsafe) return t(job.type === 'build' ? 'mark.unsafeBuild' : 'mark.unsafe');
  if (job.blocked) return t('mark.blocked');
  const worker = job.claimedBy !== 0 ? sim.dwarf(job.claimedBy) : undefined;
  if (worker && worker.phase === 'working') return t('mark.working', { name: worker.name, percent: Math.round(sim.jobProgress(job) * 100) });
  if (worker) return t('mark.claimed', { name: worker.name });
  if (building && job.missing) return t('mark.missing', { item: sim.items.get(job.inputs[0]!.item).name.toLowerCase() });
  if (building && sim.waitingForSupport(job)) return t('mark.support');
  if (building) return priorityName(job.priority);
  if (job.type === 'dismantle') return t('mark.dismantle', { priority: priorityName(job.priority) });
  return t(job.type === 'dig' ? 'mark.dig' : 'mark.chop', { priority: priorityName(job.priority) });
}

const BUILD_REASONS: Record<Exclude<BuildStatus, 'ok'>, StringKey> = {
  'out-of-bounds': 'build.out-of-bounds',
  unexplored: 'build.unexplored',
  marked: 'build.marked',
  occupied: 'build.occupied',
  'has-wall': 'build.has-wall',
  unsupported: 'build.unsupported',
  'needs-floor': 'build.needs-floor',
  'needs-wall': 'build.needs-wall',
  'cannot-build': 'build.cannot-build',
};

function toolHint(
  sim: Simulation,
  x: number,
  y: number,
  tool: Tool,
  priority: Priority,
  job: Job | undefined,
  buildItem: number | null,
): { action: HoverAction; hint: string } {
  switch (tool) {
    case 'auto': {
      if (job) return { action: 'ok', hint: t('tool.auto.unmark') };
      const target = sim.autoTarget(x, y);
      if (target === 'chop') return { action: 'ok', hint: t('tool.auto.chop') };
      if (target === 'dig') return { action: 'ok', hint: t('tool.auto.dig') };
      if (target === 'dismantle') return { action: 'ok', hint: t('tool.auto.dismantle') };
      // Say why a block can't be dug; open air needs no explanation.
      const status = sim.digStatus(x, y);
      if (status === 'nothing-to-dig' || status === 'marked') return { action: 'none', hint: '' };
      return { action: 'blocked', hint: t(DIG_REASONS[status as Exclude<DigStatus, 'ok'>]) };
    }
    case 'dig': {
      if (!job && sim.furniture.at(x, y)) return { action: 'ok', hint: t('tool.auto.dismantle') };
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
    case 'build':
    case 'wall':
    case 'furniture': {
      if (buildItem === null) return { action: 'none', hint: '' };
      const status =
        tool === 'build' ? sim.buildStatus(buildItem, x, y) : tool === 'wall' ? sim.wallStatus(buildItem, x, y) : sim.furnitureStatus(buildItem, x, y);
      if (status === 'ok') return { action: 'ok', hint: t(`tool.${tool}.hint`) };
      return { action: 'blocked', hint: t(BUILD_REASONS[status]) };
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
  const lower = (item: number): string => sim.items.get(item).name.toLowerCase();
  const list = (items: ReadonlyArray<{ item: number }>): string => items.map(({ item }) => lower(item)).join(', ');
  const carried = list(dwarf.carrying);
  switch (dwarf.phase) {
    case 'dead':
      return t('activity.dead');
    case 'falling':
      return t('activity.falling');
    case 'to-supply':
    case 'fetching':
      if (job?.type === 'equip') return t('activity.toEquip', { item: lower(job.target) });
      return t('activity.toSupply', { item: job ? list(job.inputs) : '' });
    case 'to-job':
    case 'working': {
      const working = dwarf.phase === 'working';
      switch (job?.type) {
        case 'chop':
          return t(working ? 'activity.chopping' : 'activity.toChop');
        case 'build':
        case 'wall':
        case 'place':
          return working ? t('activity.building', { item: plannedThing(sim, job).toLowerCase() }) : t('activity.toBuild', { item: carried });
        case 'dismantle': {
          const name = (sim.furniture.get(job.furnitureId)?.def.name ?? '').toLowerCase();
          return t(working ? 'activity.dismantling' : 'activity.toDismantle', { item: name });
        }
        case 'craft': {
          const recipe = sim.recipes.recipes[job.target]!;
          if (working) return t('activity.crafting', { item: lower(recipe.output.item) });
          const station = sim.furniture.get(job.furnitureId)?.def.name ?? recipe.station;
          return t('activity.toCraft', { station: station.toLowerCase() });
        }
        default: {
          const block = job ? sim.tiles.tiles[sim.world.fgAt(job.x, job.y)]!.name.toLowerCase() : '';
          return t(working ? 'activity.digging' : 'activity.toDig', { block });
        }
      }
    }
    case 'to-item':
    case 'picking-up': {
      const stack = job && job.type === 'haul' ? sim.ground.get(job.stackId) : undefined;
      const fetched = stack ? lower(stack.item) : '';
      return t(dwarf.phase === 'to-item' ? 'activity.fetching' : 'activity.pickingUp', { item: fetched });
    }
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
