/**
 * The left toolbar. A tool decides what a click or drag on the world does:
 *   Auto        mark whatever is clicked: blocks for digging, trees for felling,
 *               furniture to take apart (and pick a dwarf, or remove a mark, with a click);
 *   Select      pick a dwarf to see its details;
 *   Dig         mark blocks for the dwarves to dig;
 *   Fell trees  mark trees for the dwarves to cut down;
 *   Farm        mark farm plots for a crop: dwarves till, sow and harvest them, again and again;
 *   Build       plan blocks, ladders and doors;
 *   Walls       plan background walls (dwarves climb them);
 *   Furniture   plan chests, torches, crafting stations...;
 *   Cancel      remove planned work;
 *   Priority    change which planned work is done first.
 * None of them changes the world itself: planning work is all the player does, and the
 * dwarves carry it out. New plans get the priority picked below the tools. The building
 * tools also open a palette of what to build with, showing how much of each is stored.
 */
import { keyLabel, type Action } from '../../core/actions';
import { t, type StringKey } from '../../core/strings';
import { PRIORITY_COLOURS } from '../../render/assets/colonyArt';
import { PRIORITIES } from '../../sim/jobs/JobBoard';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { isBuildTool, uiState, type BuildTool, type CatalogueItem, type Tool } from '../state';
import { Icon, type IconName } from './Icon';

interface ToolSpec {
  tool: Tool;
  icon: IconName;
  label: StringKey;
  tip: StringKey;
  action: Action;
}

const TOOLS: readonly ToolSpec[] = [
  { tool: 'auto', icon: 'auto', label: 'tool.auto', tip: 'tool.auto.tip', action: 'toolAuto' },
  { tool: 'select', icon: 'select', label: 'tool.select', tip: 'tool.select.tip', action: 'toolSelect' },
  { tool: 'dig', icon: 'pick', label: 'tool.dig', tip: 'tool.dig.tip', action: 'toolDig' },
  { tool: 'chop', icon: 'axe', label: 'tool.chop', tip: 'tool.chop.tip', action: 'toolChop' },
  { tool: 'farm', icon: 'farm', label: 'tool.farm', tip: 'tool.farm.tip', action: 'toolFarm' },
  { tool: 'build', icon: 'build', label: 'tool.build', tip: 'tool.build.tip', action: 'toolBuild' },
  { tool: 'wall', icon: 'wall', label: 'tool.wall', tip: 'tool.wall.tip', action: 'toolWall' },
  { tool: 'furniture', icon: 'furniture', label: 'tool.furniture', tip: 'tool.furniture.tip', action: 'toolFurniture' },
  { tool: 'cancel', icon: 'close', label: 'tool.cancel', tip: 'tool.cancel.tip', action: 'toolCancel' },
  { tool: 'priority', icon: 'priority', label: 'tool.priority', tip: 'tool.priority.tip', action: 'toolPriority' },
];

/** Tools whose marks or changes use the priority level. */
const USES_PRIORITY: ReadonlySet<Tool> = new Set<Tool>(['auto', 'dig', 'chop', 'farm', 'build', 'wall', 'furniture', 'priority']);

export function Toolbar() {
  const commands = useCommands();
  const tool = useStore(uiState, (s) => s.tool);
  const priority = useStore(uiState, (s) => s.priority);
  const bindings = useStore(useSettingsStore(), (s) => s.bindings);

  return (
    <nav class="toolbar panel" aria-label={t('toolbar.label')} data-testid="toolbar">
      {TOOLS.map((spec) => {
        const key = keyLabel(bindings[spec.action][0]);
        const active = tool === spec.tool;
        return (
          <button
            key={spec.tool}
            type="button"
            class={`btn btn-tool${active ? ' active' : ''}`}
            aria-pressed={active}
            title={t(spec.tip, { key: key || t('key.unbound') })}
            data-testid={`tool-${spec.tool}`}
            onClick={() => {
              commands.playSound('uiClick');
              commands.setTool(spec.tool);
            }}
          >
            <Icon name={spec.icon} />
            <span class="btn-tool-label">{t(spec.label)}</span>
            {key && <kbd>{key}</kbd>}
          </button>
        );
      })}

      {USES_PRIORITY.has(tool) && (
        <div class="priority-picker" role="group" aria-label={t('tool.priority.level')} title={t('tool.priority.level')}>
          {PRIORITIES.map((level) => (
            <button
              key={level}
              type="button"
              class={`btn btn-priority${priority === level ? ' active' : ''}`}
              aria-pressed={priority === level}
              title={t(`priority.label.${level}`)}
              data-testid={`priority-${level}`}
              style={`--pip: ${PRIORITY_COLOURS[level]}`}
              onClick={() => {
                commands.playSound('uiClick');
                commands.setPriority(level);
              }}
            >
              <span class="pips" aria-hidden="true">
                {Array.from({ length: level }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span class="sr-only">{t(`priority.label.${level}`)}</span>
            </button>
          ))}
        </div>
      )}

      {isBuildTool(tool) && <Palette tool={tool} />}
      {tool === 'farm' && <CropPalette />}
    </nav>
  );
}

/** What a build tool builds with: each choice with how much of it is in storage. */
function Palette({ tool }: { tool: BuildTool }) {
  const commands = useCommands();
  const catalogue = useStore(uiState, (s) => s.catalogue);
  const choice = useStore(uiState, (s) => s.buildChoice[tool]);
  const resources = useStore(uiState, (s) => s.colony?.resources ?? null);
  if (!catalogue) return null;
  const entries: CatalogueItem[] = tool === 'build' ? catalogue.blocks : tool === 'wall' ? catalogue.walls : catalogue.furniture;
  const stock = new Map((resources ?? []).map((entry) => [entry.id, entry.count]));

  return (
    <div class="palette panel" role="listbox" aria-label={t('tool.palette')} data-testid="palette">
      <h4>{t('tool.palette')}</h4>
      {entries.map((entry) => {
        const count = stock.get(entry.id) ?? 0;
        const selected = entry.id === choice;
        return (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={selected}
            class={`palette-entry${selected ? ' selected' : ''}${count === 0 ? ' empty' : ''}`}
            title={`${entry.name}: ${count > 0 ? t('tool.palette.stock', { count }) : t('tool.palette.none')}`}
            data-testid={`palette-${entry.id}`}
            onClick={() => {
              commands.playSound('uiClick');
              commands.setBuildChoice(tool, entry.id);
            }}
          >
            <img class="item-icon" src={entry.icon} alt="" width={30} height={30} />
            <span class="name">{entry.name}</span>
            <span class="count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** What the Farm tool grows: each crop, with how many of its seeds are in storage. */
function CropPalette() {
  const commands = useCommands();
  const catalogue = useStore(uiState, (s) => s.catalogue);
  const choice = useStore(uiState, (s) => s.farmCrop);
  const resources = useStore(uiState, (s) => s.colony?.resources ?? null);
  if (!catalogue) return null;
  const stock = new Map((resources ?? []).map((entry) => [entry.id, entry.count]));

  return (
    <div class="palette panel" role="listbox" aria-label={t('tool.farm.palette')} data-testid="crop-palette">
      <h4>{t('tool.farm.palette')}</h4>
      {catalogue.crops.map((crop) => {
        const count = stock.get(crop.seed.id) ?? 0;
        const selected = crop.id === choice;
        return (
          <button
            key={crop.id}
            type="button"
            role="option"
            aria-selected={selected}
            class={`palette-entry${selected ? ' selected' : ''}${count === 0 ? ' empty' : ''}`}
            title={`${crop.name}: ${count > 0 ? t('tool.farm.seeds', { count }) : t('tool.farm.noSeeds')}`}
            data-testid={`crop-${crop.id}`}
            onClick={() => {
              commands.playSound('uiClick');
              commands.setFarmCrop(crop.id);
            }}
          >
            <img class="item-icon" src={crop.seed.icon} alt="" width={30} height={30} />
            <span class="name">{crop.name}</span>
            <span class="count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
