/**
 * Shown when the World Gate is built: the world is won. Up to three dwarves (the most
 * skilled are picked to start with) can step through into a new world, keeping their
 * skills and gear; or the colony can stay and keep playing here.
 */
import { useState } from 'preact/hooks';
import { t } from '../../core/strings';
import { useCommands } from '../commands';
import type { WonView } from '../state';
import { Modal } from './Modal';

export function WonDialog({ won }: { won: WonView }) {
  const commands = useCommands();
  const [chosen, setChosen] = useState<number[]>(() => won.dwarves.slice(0, won.max).map((dwarf) => dwarf.id));
  const stay = (): void => {
    commands.playSound('uiClose');
    commands.stayInWorld();
  };
  const toggle = (id: number): void => {
    commands.playSound('uiClick');
    setChosen((current) => (current.includes(id) ? current.filter((other) => other !== id) : current.length < won.max ? [...current, id] : current));
  };

  return (
    <Modal title={t('won.title')} onClose={stay} wide testId="world-won">
      <p class="won-text">{t('won.text', { day: won.day })}</p>
      {won.unlocked && <p class="won-unlocked">{t('won.unlocked', { biome: won.unlocked })}</p>}
      {won.dwarves.length > 0 && (
        <>
          <h3 class="field-label">{t('won.choose', { count: chosen.length, max: won.max })}</h3>
          <ul class="traveller-list">
            {won.dwarves.map((dwarf) => {
              const picked = chosen.includes(dwarf.id);
              return (
                <li key={dwarf.id}>
                  <label class={`traveller${picked ? ' chosen' : ''}`} data-testid="traveller">
                    <input type="checkbox" checked={picked} disabled={!picked && chosen.length >= won.max} onChange={() => toggle(dwarf.id)} />
                    <span>
                      <strong>{dwarf.name}</strong>
                      <small>{t('won.skills', { skill: dwarf.skill.toLowerCase(), level: dwarf.level })}</small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p class="settings-hint">{t('won.hint')}</p>
      <div class="menu-buttons">
        <button
          type="button"
          class="btn btn-primary"
          data-autofocus
          disabled={chosen.length === 0}
          data-testid="travel"
          onClick={() => {
            commands.playSound('uiClick');
            commands.travel(chosen);
          }}
        >
          {t('won.travel')}
        </button>
        <button type="button" class="btn" onClick={stay} data-testid="stay">
          {t('won.stay')}
        </button>
        <button
          type="button"
          class="btn btn-danger"
          onClick={() => {
            commands.playSound('uiClick');
            commands.stayInWorld();
            commands.quitToTitle();
          }}
        >
          {t('won.quit')}
        </button>
      </div>
    </Modal>
  );
}
