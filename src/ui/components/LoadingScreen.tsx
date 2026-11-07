/** Shown while the world is generated in the background worker. */
import { t, type StringKey } from '../../core/strings';
import { useStore } from '../hooks';
import { uiState, type LoadingStage } from '../state';

const STAGE_TEXT: Record<LoadingStage, StringKey> = {
  terrain: 'loading.terrain',
  caves: 'loading.caves',
  water: 'loading.water',
  ores: 'loading.ores',
  plants: 'loading.plants',
  finishing: 'loading.finishing',
  building: 'loading.building',
  loading: 'loading.save',
};

export function LoadingScreen() {
  const loading = useStore(uiState, (s) => s.loading);
  const progress = Math.round((loading?.progress ?? 0) * 100);
  return (
    <div class="loading-screen" data-testid="loading-screen">
      <section class="panel loading-panel" aria-busy="true">
        <h2>{t('loading.title')}</h2>
        <div
          class="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('loading.title')}
        >
          <div class="progress-fill" style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
        <p class="loading-stage">{loading ? t(STAGE_TEXT[loading.stage]) : ''}</p>
      </section>
    </div>
  );
}
