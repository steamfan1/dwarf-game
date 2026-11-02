/**
 * In-game overlay: the top bar (time controls, stored resources, the crafting and storage
 * buttons, menu), the toolbar, the crafting panel when open, the readout for whatever is
 * under the pointer, the minimap and a controls hint. The day number and clock join the
 * top bar in Milestone 4. The dwarf roster, storage and the debug panel sit in the
 * right-hand column (see UiRoot).
 */
import { GAME_SPEEDS, GAME_TITLE } from '../../config';
import { keyLabel } from '../../core/actions';
import { t } from '../../core/strings';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { uiState } from '../state';
import { CraftingPanel } from './CraftingPanel';
import { Icon } from './Icon';
import { Minimap } from './Minimap';
import { Toolbar } from './Toolbar';

/** The top bar shows this many kinds of stored item (the most plentiful); the colony panel lists them all. */
const TOP_BAR_RESOURCES = 6;

export function GameHud() {
  const commands = useCommands();
  const time = useStore(uiState, (s) => s.time);
  const minimapOpen = useStore(uiState, (s) => s.minimapOpen);
  const craftingOpen = useStore(uiState, (s) => s.craftingOpen);
  const storageOpen = useStore(uiState, (s) => s.storageOpen);
  const bindings = useStore(useSettingsStore(), (s) => s.bindings);
  const paused = time?.paused ?? false;
  const speedKeys = [bindings.speed1, bindings.speed2, bindings.speed3];
  const moveKeys = [bindings.panUp, bindings.panLeft, bindings.panDown, bindings.panRight].map((keys) => keyLabel(keys[0])).join('');

  return (
    <div class="hud" data-testid="hud">
      <div class="top-bar panel" data-testid="top-bar">
        <span class="top-bar-title">{GAME_TITLE}</span>

        <div class="time-controls" role="group" aria-label={t('action.pause')}>
          <button
            type="button"
            class={`btn btn-icon${paused ? ' active' : ''}`}
            aria-pressed={paused}
            title={t('hud.pause', { key: keyLabel(bindings.pause[0]) })}
            onClick={() => {
              commands.playSound('uiClick');
              commands.togglePause();
            }}
          >
            <Icon name="pause" />
          </button>
          {GAME_SPEEDS.map((speed, i) => {
            const active = !paused && time?.speed === speed;
            return (
              <button
                key={speed}
                type="button"
                class={`btn btn-icon btn-speed${active ? ' active' : ''}`}
                aria-pressed={active}
                title={t('hud.speed', { speed, key: keyLabel(speedKeys[i]?.[0]) })}
                onClick={() => {
                  commands.playSound('uiClick');
                  commands.setSpeed(speed);
                }}
              >
                {speed}×
              </button>
            );
          })}
        </div>

        <Clock />

        <ResourceBar />

        <div class="panel-buttons" role="group">
          <button
            type="button"
            class={`btn btn-icon${craftingOpen ? ' active' : ''}`}
            aria-pressed={craftingOpen}
            title={t('hud.crafting', { key: keyLabel(bindings.toggleCrafting[0]) })}
            aria-label={t('crafting.title')}
            data-testid="open-crafting"
            onClick={() => {
              commands.playSound(craftingOpen ? 'uiClose' : 'uiOpen');
              commands.toggleCrafting();
            }}
          >
            <Icon name="craft" />
          </button>
          <button
            type="button"
            class={`btn btn-icon${storageOpen ? ' active' : ''}`}
            aria-pressed={storageOpen}
            title={t('hud.storage', { key: keyLabel(bindings.toggleStorage[0]) })}
            aria-label={t('colony.storage')}
            data-testid="open-storage"
            onClick={() => {
              commands.playSound('uiClick');
              commands.toggleStorage();
            }}
          >
            <Icon name="chest" />
          </button>
        </div>

        <button
          type="button"
          class="btn btn-icon"
          title={t('hud.menu', { key: keyLabel(bindings.cancel[0]) })}
          aria-label={t('hud.menuLabel')}
          onClick={() => {
            commands.playSound('uiOpen');
            commands.openMenu();
          }}
        >
          <Icon name="menu" />
        </button>
      </div>

      <Toolbar />
      {craftingOpen && <CraftingPanel />}
      {paused && (
        <div class="paused-banner" role="status">
          {t('hud.paused')}
        </div>
      )}
      <HoverReadout />
      {minimapOpen && <Minimap />}
      <p class="hud-hint">{t('hud.hint', { keys: moveKeys })}</p>
    </div>
  );
}

/** The day number and the time: a sun by day, a moon at night. */
function Clock() {
  const clock = useStore(uiState, (s) => s.clock);
  if (!clock) return null;
  const time = `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
  const phase = t(clock.night ? 'hud.phase.night' : 'hud.phase.day');
  return (
    <div class={`clock${clock.night ? ' night' : ''}`} title={t('hud.clock', { day: clock.day, time, phase })} data-testid="clock">
      <Icon name={clock.night ? 'moon' : 'sun'} />
      <span class="clock-day">{t('hud.day', { day: clock.day })}</span>
      <span class="clock-time">{time}</span>
    </div>
  );
}

/** The most plentiful stored items, with their counts. */
function ResourceBar() {
  const resources = useStore(uiState, (s) => s.colony?.resources ?? null);
  if (!resources || resources.length === 0) return null;
  const shown = [...resources].sort((a, b) => b.count - a.count).slice(0, TOP_BAR_RESOURCES);
  return (
    <ul class="resource-bar" aria-label={t('colony.storage')} data-testid="resource-bar">
      {shown.map((entry) => (
        <li key={entry.id} title={entry.name}>
          <img class="item-icon" src={entry.icon} alt={entry.name} width={24} height={24} />
          <span>{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** What's under the pointer: what it is, how deep, any mark on it, and what the current tool would do. */
function HoverReadout() {
  const hover = useStore(uiState, (s) => s.hover);
  if (!hover) return null;
  return (
    <div class={`hover-readout panel action-${hover.action}`} data-testid="hover-readout" aria-live="polite">
      <strong data-testid="hover-title">{hover.title}</strong>
      <span>{hover.detail}</span>
    </div>
  );
}
