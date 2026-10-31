/**
 * Debug overlay (backtick key): frame and simulation timing. In-world overlays (paths,
 * job reservations, rooms, light levels, chunk borders) are added by later milestones.
 */
import { t } from '../../core/strings';
import { useStore } from '../hooks';
import { uiState } from '../state';

function fixed(value: number | undefined, digits: number): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

export function DebugPanel() {
  const stats = useStore(uiState, (s) => s.debug);
  const time = useStore(uiState, (s) => s.time);
  const speed = !time
    ? '—'
    : time.paused
      ? t('debug.paused', { reasons: time.reasons.join(', ') })
      : t('debug.running', { speed: time.speed * time.debugMultiplier });

  return (
    <aside class="debug-panel" data-testid="debug-panel" aria-label={t('debug.title')}>
      <dl>
        <dt>{t('debug.fps')}</dt>
        <dd>{fixed(stats?.fps, 0)}</dd>
        <dt>{t('debug.frame')}</dt>
        <dd>{fixed(stats?.frameMs, 1)} ms</dd>
        <dt>{t('debug.tickCost')}</dt>
        <dd>{fixed(stats?.tickCostMs, 3)} ms</dd>
        <dt>{t('debug.ticks')}</dt>
        <dd data-testid="debug-ticks">{stats ? stats.tick : '—'}</dd>
        <dt>{t('debug.tps')}</dt>
        <dd>{fixed(stats?.ticksPerSecond, 1)}</dd>
        <dt>{t('debug.speed')}</dt>
        <dd data-testid="debug-speed">{speed}</dd>
        <dt>{t('debug.dropped')}</dt>
        <dd>{fixed(stats?.droppedMs, 0)} ms</dd>
        <dt>{t('debug.canvas')}</dt>
        <dd>{stats ? `${stats.canvasWidth}×${stats.canvasHeight} @${stats.dpr}x` : '—'}</dd>
        <dt>{t('debug.zoom')}</dt>
        <dd>{stats ? `${stats.zoom}×` : '—'}</dd>
      </dl>
    </aside>
  );
}
