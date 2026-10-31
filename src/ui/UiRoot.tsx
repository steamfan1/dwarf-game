/** Root of the HTML overlay: picks what to show for the current screen and open panels. */
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import type { Settings } from '../core/settings';
import type { Store } from '../core/Store';
import { CommandsContext, SettingsContext, type UiCommands } from './commands';
import { DebugPanel } from './components/DebugPanel';
import { GameHud } from './components/GameHud';
import { GameMenu } from './components/GameMenu';
import { LoadingScreen } from './components/LoadingScreen';
import { NewWorldDialog } from './components/NewWorldDialog';
import { FatalScreen, StorageWarning, Toasts } from './components/Notices';
import { SettingsPanel } from './components/SettingsPanel';
import { TitleMenu } from './components/TitleMenu';
import { useStore } from './hooks';
import { uiState } from './state';

function UiRoot() {
  const screen = useStore(uiState, (s) => s.screen);
  const menuOpen = useStore(uiState, (s) => s.menuOpen);
  const settingsOpen = useStore(uiState, (s) => s.settingsOpen);
  const debugOpen = useStore(uiState, (s) => s.debugOpen);

  // Exposed for CSS and for the browser smoke test.
  useEffect(() => {
    document.body.dataset.scene = screen;
  }, [screen]);

  return (
    <>
      {screen === 'title' && <TitleMenu />}
      {screen === 'title' && !settingsOpen && <NewWorldDialog />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'game' && <GameHud />}
      {screen === 'fatal' && <FatalScreen />}
      {screen === 'game' && menuOpen && !settingsOpen && <GameMenu />}
      {settingsOpen && <SettingsPanel />}
      {debugOpen && <DebugPanel />}
      <StorageWarning />
      <Toasts />
    </>
  );
}

export interface UiDependencies {
  commands: UiCommands;
  settings: Store<Settings>;
}

export function mountUi(root: HTMLElement, { commands, settings }: UiDependencies): void {
  render(
    <CommandsContext.Provider value={commands}>
      <SettingsContext.Provider value={settings}>
        <UiRoot />
      </SettingsContext.Provider>
    </CommandsContext.Provider>,
    root,
  );
}
