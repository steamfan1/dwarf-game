/** Small always-present overlays: the storage warning, toasts and the fatal-error screen. */
import { t } from '../../core/strings';
import { useCommands } from '../commands';
import { useStore } from '../hooks';
import { dismissToast, uiState } from '../state';
import { Icon } from './Icon';

/** Shown when the browser blocks storage, so the player knows progress won't be kept. */
export function StorageWarning() {
  const commands = useCommands();
  const persistent = useStore(uiState, (s) => s.storagePersistent);
  const dismissed = useStore(uiState, (s) => s.storageWarningDismissed);
  if (persistent !== false || dismissed) return null;

  return (
    <div class="storage-warning panel" role="alert" data-testid="storage-warning">
      <Icon name="warning" />
      <span>{t('storage.blocked')}</span>
      <button type="button" class="btn btn-small" onClick={() => commands.dismissStorageWarning()}>
        {t('storage.dismiss')}
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore(uiState, (s) => s.toasts);
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} class={`toast panel toast-${toast.kind}`} onClick={() => dismissToast(toast.id)}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}

export function FatalScreen() {
  const message = useStore(uiState, (s) => s.fatalMessage);
  return (
    <div class="fatal-screen">
      <section class="panel fatal-panel" role="alert">
        <h2>{t('fatal.title')}</h2>
        <p>{message}</p>
      </section>
    </div>
  );
}
