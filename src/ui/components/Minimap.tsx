/**
 * The minimap panel. The app's MinimapRenderer draws into this canvas; clicking or
 * dragging on it moves the camera there.
 */
import { useEffect, useRef } from 'preact/hooks';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { keyLabel } from '../../core/actions';
import { t } from '../../core/strings';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';

export function Minimap() {
  const commands = useCommands();
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const key = useStore(useSettingsStore(), (s) => s.bindings.toggleMinimap[0]);

  useEffect(() => {
    commands.attachMinimap(canvas.current);
    return () => commands.attachMinimap(null);
  }, [commands]);

  const jump = (event: PointerEvent): void => {
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * WORLD_WIDTH);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT);
    commands.centerCameraOn(Math.max(0, Math.min(WORLD_WIDTH - 1, x)), Math.max(0, Math.min(WORLD_HEIGHT - 1, y)));
  };

  return (
    <div class="minimap panel" title={t('hud.minimap', { key: keyLabel(key) })} data-testid="minimap">
      <canvas
        ref={canvas}
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          jump(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) jump(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      />
    </div>
  );
}
