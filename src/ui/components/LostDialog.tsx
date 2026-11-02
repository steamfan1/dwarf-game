/** Shown when every dwarf has died: start again, keep watching, or go back to the title. */
import { t } from '../../core/strings';
import { useCommands } from '../commands';
import { Modal } from './Modal';

export function LostDialog() {
  const commands = useCommands();
  const watch = (): void => {
    commands.playSound('uiClose');
    commands.dismissColonyLost();
  };
  return (
    <Modal title={t('lost.title')} onClose={watch} testId="colony-lost">
      <p class="lost-text">{t('lost.text')}</p>
      <div class="menu-buttons">
        <button
          type="button"
          class="btn btn-primary"
          data-autofocus
          onClick={() => {
            commands.playSound('uiClick');
            commands.dismissColonyLost();
            commands.newGame();
          }}
        >
          {t('lost.newGame')}
        </button>
        <button type="button" class="btn" onClick={watch}>
          {t('lost.watch')}
        </button>
        <button
          type="button"
          class="btn btn-danger"
          onClick={() => {
            commands.playSound('uiClick');
            commands.dismissColonyLost();
            commands.quitToTitle();
          }}
        >
          {t('lost.quit')}
        </button>
      </div>
    </Modal>
  );
}
