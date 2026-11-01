/**
 * The left toolbar. A tool decides what a click or drag on the world does:
 *   Select      pick a dwarf to see its details;
 *   Dig         mark blocks for the dwarves to dig;
 *   Fell trees  mark trees for the dwarves to cut down;
 *   Cancel      remove marks;
 *   Priority    change which marked work is done first.
 * None of them changes the world itself: marking work is all the player does, and the
 * dwarves carry it out. New marks get the priority picked below the tools.
 */
import { keyLabel, type Action } from '../../core/actions';
import { t, type StringKey } from '../../core/strings';
import { PRIORITY_COLOURS } from '../../render/assets/colonyArt';
import { PRIORITIES } from '../../sim/jobs/JobBoard';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { uiState, type Tool } from '../state';
import { Icon, type IconName } from './Icon';

interface ToolSpec {
  tool: Tool;
  icon: IconName;
  label: StringKey;
  tip: StringKey;
  action: Action;
}

const TOOLS: readonly ToolSpec[] = [
  { tool: 'select', icon: 'select', label: 'tool.select', tip: 'tool.select.tip', action: 'toolSelect' },
  { tool: 'dig', icon: 'pick', label: 'tool.dig', tip: 'tool.dig.tip', action: 'toolDig' },
  { tool: 'chop', icon: 'axe', label: 'tool.chop', tip: 'tool.chop.tip', action: 'toolChop' },
  { tool: 'cancel', icon: 'close', label: 'tool.cancel', tip: 'tool.cancel.tip', action: 'toolCancel' },
  { tool: 'priority', icon: 'priority', label: 'tool.priority', tip: 'tool.priority.tip', action: 'toolPriority' },
];

/** Tools whose marks or changes use the priority level. */
const USES_PRIORITY: ReadonlySet<Tool> = new Set<Tool>(['dig', 'chop', 'priority']);

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
    </nav>
  );
}
