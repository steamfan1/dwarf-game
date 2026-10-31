/**
 * In-game overlay: the top bar with time controls and the menu button.
 * Day number, clock and resource counts join the top bar as their systems arrive.
 */
import { GAME_SPEEDS, GAME_TITLE } from '../../config';
import { keyLabel } from '../../core/actions';
import { t } from '../../core/strings';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { uiState } from '../state';
import { Icon } from './Icon';

export function GameHud() {
  const commands = useCommands();
  const time = useStore(uiState, (s) => s.time);
  const bindings = useStore(useSettingsStore(), (s) => s.bindings);
  const paused = time?.paused ?? false;
  const speedKeys = [bindings.speed1, bindings.speed2, bindings.speed3];

  return (
    <div class="hud" data-testid="hud">
      <div class="top-bar panel">
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

      {paused && (
        <div class="paused-banner" role="status">
          {t('hud.paused')}
        </div>
      )}
      <p class="hud-hint">{t('hud.placeholder')}</p>
    </div>
  );
}
