/** The title screen's menu. "New game" is also the click that unlocks browser audio. */
import { useEffect, useRef } from 'preact/hooks';
import { GAME_TITLE, MILESTONE } from '../../config';
import { t } from '../../core/strings';
import { useCommands } from '../commands';
import { useStore } from '../hooks';
import { uiState } from '../state';

export function TitleMenu() {
  const commands = useCommands();
  const newGameButton = useRef<HTMLButtonElement>(null);
  const save = useStore(uiState, (s) => s.save);
  const saving = useStore(uiState, (s) => s.saving);

  useEffect(() => {
    newGameButton.current?.focus();
  }, []);

  return (
    <div class="title-screen" data-testid="title-menu">
      <header class="title-heading">
        <h1 class="game-title">{GAME_TITLE}</h1>
        <p class="tagline">{t('title.tagline')}</p>
      </header>

      <nav class="title-menu panel" aria-label={GAME_TITLE}>
        <button
          ref={newGameButton}
          type="button"
          class="btn btn-primary"
          onClick={() => {
            commands.playSound('uiClick');
            commands.newGame();
          }}
        >
          {t('title.newGame')}
        </button>
        {save ? (
          <button
            type="button"
            class="btn"
            disabled={saving}
            title={t('title.continueTip', { day: save.day, dwarves: save.dwarves, seed: save.seed })}
            data-testid="continue"
            onClick={() => {
              commands.playSound('uiClick');
              commands.continueGame();
            }}
          >
            {t('title.continue')}
            <span class="continue-detail">{t('title.continueDetail', { day: save.day, dwarves: save.dwarves })}</span>
          </button>
        ) : (
          // The wrapper carries the tooltip because disabled buttons don't show one everywhere.
          <span class="tooltip-wrap" title={t('title.continueUnavailable')}>
            <button type="button" class="btn" disabled data-testid="continue">
              {t('title.continue')}
            </button>
          </span>
        )}
        <button
          type="button"
          class="btn"
          onClick={() => {
            commands.playSound('uiOpen');
            commands.openSettings();
          }}
        >
          {t('title.settings')}
        </button>
      </nav>

      <footer class="build-tag">{t('title.build', { milestone: MILESTONE })}</footer>
    </div>
  );
}
