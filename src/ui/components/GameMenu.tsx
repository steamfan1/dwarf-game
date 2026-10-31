/** The in-game menu (Esc). The game is paused while it is open. */
import { t } from '../../core/strings';
import { useCommands } from '../commands';
import { useStore } from '../hooks';
import { uiState } from '../state';
import { Modal } from './Modal';

export function GameMenu() {
  const commands = useCommands();
  const world = useStore(uiState, (s) => s.world);
  const close = (): void => {
    commands.playSound('uiClose');
    commands.closeMenu();
  };

  return (
    <Modal title={t('menu.title')} onClose={close} testId="game-menu">
      <div class="menu-buttons">
        <button type="button" class="btn btn-primary" data-autofocus onClick={close}>
          {t('menu.resume')}
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            commands.playSound('uiOpen');
            commands.openSettings();
          }}
        >
          {t('menu.settings')}
        </button>
        <button
          type="button"
          class="btn btn-danger"
          onClick={() => {
            commands.playSound('uiClick');
            commands.quitToTitle();
          }}
        >
          {t('menu.quitToTitle')}
        </button>
      </div>
      {world && (
        <p class="menu-world" data-testid="world-info">
          {t('menu.world', { seed: world.seed, biome: world.biomeName })}
        </p>
      )}
    </Modal>
  );
}
