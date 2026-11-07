/**
 * Debug overlay (backtick key): frame and simulation timing, jobs and pathfinding. In the
 * world it draws chunk borders, each dwarf's path (cyan) and reserved job (gold), and can
 * swap the fog of war for the light levels. Room regions join in Milestone 4.
 */
import { t } from '../../core/strings';
import { useCommands } from '../commands';
import { useStore } from '../hooks';
import { uiState } from '../state';

function fixed(value: number | undefined, digits: number): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

export function DebugPanel() {
  const commands = useCommands();
  const stats = useStore(uiState, (s) => s.debug);
  const showLight = useStore(uiState, (s) => s.debugLight);
  const time = useStore(uiState, (s) => s.time);
  const world = useStore(uiState, (s) => s.world);
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
        <dd data-testid="debug-zoom">{stats ? `${stats.zoom}×` : '—'}</dd>
        <dt>{t('debug.camera')}</dt>
        <dd data-testid="debug-camera">{stats ? `${stats.cameraTile.x}, ${stats.cameraTile.y}` : '—'}</dd>
        <dt>{t('debug.cursor')}</dt>
        <dd>{stats?.cursorTile ? `${stats.cursorTile.x}, ${stats.cursorTile.y}` : '—'}</dd>
        <dt>{t('debug.chunks')}</dt>
        <dd data-testid="debug-chunks">{stats ? stats.chunksDrawn : '—'}</dd>
        <dt>{t('debug.chunkLayers')}</dt>
        <dd>{stats ? stats.chunkLayers : '—'}</dd>
        <dt>{t('debug.jobs')}</dt>
        <dd data-testid="debug-jobs">
          {stats
            ? t('debug.jobsValue', {
                dig: stats.jobs.dig,
                chop: stats.jobs.chop,
                farm: stats.jobs.till + stats.jobs.plant + stats.jobs.harvest,
                build: stats.jobs.build + stats.jobs.wall + stats.jobs.place + stats.jobs.dismantle,
                craft: stats.jobs.craft,
                haul: stats.jobs.haul,
                fight: stats.jobs.fight + stats.jobs.hunt,
                blocked: stats.jobs.blocked,
              })
            : '—'}
        </dd>
        <dt>{t('debug.paths')}</dt>
        <dd>{stats ? t('debug.pathsValue', { searches: stats.paths.searches, hits: stats.paths.cacheHits, busy: stats.paths.busy }) : '—'}</dd>
        <dt>{t('debug.home')}</dt>
        <dd>{stats ? t('debug.homeValue', { from: stats.homeCells.fromHome, to: stats.homeCells.toHome }) : '—'}</dd>
        <dt>{t('debug.rooms')}</dt>
        <dd data-testid="debug-rooms">{stats ? stats.rooms : '—'}</dd>
        <dt>{t('debug.creatures')}</dt>
        <dd data-testid="debug-creatures">
          {stats ? t('debug.creaturesValue', { hostile: stats.creatures.hostile, animals: stats.creatures.animals, missiles: stats.creatures.missiles }) : '—'}
        </dd>
        <dt>{t('debug.threat')}</dt>
        <dd>{stats ? t('debug.threatValue', { spawned: stats.threat.spawned, budget: stats.threat.budget, wave: stats.threat.waveDay }) : '—'}</dd>
        <dt>{t('debug.daylight')}</dt>
        <dd data-testid="debug-daylight">{stats ? `${Math.round(stats.daylight * 100)}%` : '—'}</dd>
        <dt>{t('debug.seed')}</dt>
        <dd>{world?.seed ?? '—'}</dd>
      </dl>
      <label class="debug-option">
        <input type="checkbox" checked={showLight} onChange={(event) => commands.setDebugLight(event.currentTarget.checked)} />
        {t('debug.showLight')}
      </label>
    </aside>
  );
}
