/**
 * Settings: volumes, interface size, edge panning and key bindings. Changes apply
 * immediately and are saved per browser by the app (see App.ts).
 */
import { useEffect, useState } from 'preact/hooks';
import {
  ACTIONS,
  actionLabelKey,
  BINDING_SLOTS,
  isBindable,
  keyLabel,
  rebind,
  type Action,
} from '../../core/actions';
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, type Settings } from '../../core/settings';
import { t, type StringKey } from '../../core/strings';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { Modal } from './Modal';

type VolumeKey = 'masterVolume' | 'sfxVolume' | 'musicVolume';

const VOLUMES: ReadonlyArray<{ key: VolumeKey; label: StringKey }> = [
  { key: 'masterVolume', label: 'settings.masterVolume' },
  { key: 'sfxVolume', label: 'settings.sfxVolume' },
  { key: 'musicVolume', label: 'settings.musicVolume' },
];

interface Capture {
  action: Action;
  slot: number;
}

export function SettingsPanel() {
  const commands = useCommands();
  const settingsStore = useSettingsStore();
  const settings = useStore(settingsStore, (s) => s);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // While waiting for a new key, swallow the next key press (Esc cancels).
  useEffect(() => {
    if (!capture) return;
    commands.setGameInputEnabled(false);
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setCapture(null);
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (!isBindable(event.code)) {
        setMessage(t('settings.reservedKey', { key: keyLabel(event.code) || event.key }));
        return;
      }
      const result = rebind(settingsStore.get().bindings, capture.action, capture.slot, event.code);
      commands.updateSettings({ bindings: result.bindings });
      setMessage(
        result.swappedWith
          ? t('settings.keyMoved', { key: keyLabel(event.code), action: t(actionLabelKey(result.swappedWith)) })
          : null,
      );
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      commands.setGameInputEnabled(true);
    };
  }, [capture, commands, settingsStore]);

  const update = (patch: Partial<Settings>): void => commands.updateSettings(patch);
  const setVolume = (key: VolumeKey, percent: number): void => {
    const patch: Partial<Settings> = {};
    patch[key] = percent / 100;
    update(patch);
  };
  const close = (): void => {
    if (capture) {
      setCapture(null);
      return;
    }
    commands.playSound('uiClose');
    commands.closeSettings();
  };

  return (
    <Modal
      title={t('settings.title')}
      onClose={close}
      wide
      testId="settings-panel"
      footer={
        <>
          <button
            type="button"
            class="btn"
            onClick={() => {
              commands.playSound('uiClick');
              commands.resetSettings();
              setMessage(null);
            }}
          >
            {t('settings.resetDefaults')}
          </button>
          <button type="button" class="btn btn-primary" onClick={close}>
            {t('settings.close')}
          </button>
        </>
      }
    >
      <section class="settings-section">
        <h3>{t('settings.audio')}</h3>
        {VOLUMES.map(({ key, label }) => (
          <label class="setting-row" key={key}>
            <span>{t(label)}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(settings[key] * 100)}
              onInput={(event) => setVolume(key, Number(event.currentTarget.value))}
            />
            <output>{Math.round(settings[key] * 100)}%</output>
          </label>
        ))}
      </section>

      <section class="settings-section">
        <h3>{t('settings.display')}</h3>
        <label class="setting-row">
          <span>{t('settings.uiScale')}</span>
          <input
            type="range"
            min={UI_SCALE_MIN * 100}
            max={UI_SCALE_MAX * 100}
            step={UI_SCALE_STEP * 100}
            value={Math.round(settings.uiScale * 100)}
            // Apply on release, so the panel doesn't resize under the pointer while dragging.
            onChange={(event) => update({ uiScale: Number(event.currentTarget.value) / 100 })}
          />
          <output>{Math.round(settings.uiScale * 100)}%</output>
        </label>
      </section>

      <section class="settings-section">
        <h3>{t('settings.controls')}</h3>
        <label class="checkbox-row">
          <input type="checkbox" checked={settings.edgePan} onChange={(event) => update({ edgePan: event.currentTarget.checked })} />
          <span>{t('settings.edgePan')}</span>
        </label>

        <h3 class="subheading">{t('settings.keyBindings')}</h3>
        <p class="settings-hint">{t('settings.rebindHint')}</p>
        <table class="bindings">
          <tbody>
            {ACTIONS.map((action) => (
              <tr key={action}>
                <th scope="row">{t(actionLabelKey(action))}</th>
                {Array.from({ length: BINDING_SLOTS }, (_, slot) => {
                  const capturing = capture?.action === action && capture.slot === slot;
                  const code = settings.bindings[action][slot];
                  return (
                    <td key={slot}>
                      <button
                        type="button"
                        class={`btn key-btn${capturing ? ' capturing' : ''}`}
                        aria-label={`${t(actionLabelKey(action))}: ${code ? keyLabel(code) : t('key.unbound')}`}
                        onClick={() => {
                          setMessage(null);
                          setCapture(capturing ? null : { action, slot });
                        }}
                      >
                        {capturing ? t('settings.pressKey') : code ? keyLabel(code) : t('key.unbound')}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p class="settings-message" role="status">
          {message}
        </p>
      </section>
    </Modal>
  );
}
