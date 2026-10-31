/**
 * Performance probe (diagnostics, not a pass/fail check on speed).
 *
 * It measures the frame rate in a few situations and records a CPU profile of the camera
 * panning. CI renders WebGL in software (SwiftShader), which is far slower than any real
 * graphics card: there, almost all of a frame is spent filling pixels, and script takes
 * a few milliseconds. So the numbers are only useful for comparing runs and for finding
 * where the time goes. Results go to perf.json in the test's output folder and to the
 * test's annotations; the test fails only on console errors.
 *
 * On the dev server, where `window.debug.app` exists, it also hides one part of the
 * picture at a time (fog, blocks, walls, sky, HTML overlay) to show what each one costs.
 */
import type { CDPSession, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

interface FrameWindow {
  label: string;
  /** Animation frames per second over the window. */
  fps: number;
  /** Frame interval percentiles, in milliseconds. */
  p50: number;
  p90: number;
  max: number;
  /** Main-thread time spent in tasks, script, layout and style during the window, in ms. */
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
}

const round = (value: number): number => Math.round(value * 10) / 10;

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((metric) => [metric.name, metric.value]));
}

/** Count animation frames for `ms` milliseconds while `during` runs. */
async function measure(page: Page, cdp: CDPSession, label: string, during?: () => Promise<void>, ms = 2000): Promise<FrameWindow> {
  const before = await metrics(cdp);
  const stamps = page.evaluate(
    (duration) =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        const step = (now: number): void => {
          times.push(now);
          if (now - times[0]! < duration) requestAnimationFrame(step);
          else resolve(times);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
  if (during) await during();
  const times = await stamps;
  const after = await metrics(cdp);
  const intervals = times
    .slice(1)
    .map((time, i) => time - times[i]!)
    .sort((a, b) => a - b);
  const quantile = (q: number): number => round(intervals[Math.min(intervals.length - 1, Math.floor(q * intervals.length))] ?? 0);
  const elapsed = (times[times.length - 1]! - times[0]!) / 1000;
  const delta = (name: string): number => round(((after[name] ?? 0) - (before[name] ?? 0)) * 1000);
  return {
    label,
    fps: round(intervals.length / Math.max(elapsed, 0.001)),
    p50: quantile(0.5),
    p90: quantile(0.9),
    max: quantile(1),
    taskMs: delta('TaskDuration'),
    scriptMs: delta('ScriptDuration'),
    layoutMs: delta('LayoutDuration'),
    styleMs: delta('RecalcStyleDuration'),
  };
}

/** Hide (or show again) one part of the game picture. Dev server only. */
async function setPartVisible(page: Page, part: string, visible: boolean): Promise<boolean> {
  return page.evaluate(
    ([name, show]) => {
      // Reaching into the scene's private fields is fine for a diagnostic probe.
      const app = (window as any).debug?.app;
      const scene = app?.game?.scene?.getScene('Game');
      if (!scene) return false;
      const alpha = show ? 1 : 0;
      // Every chunk layer pair, on screen or waiting in the pool (see WorldView).
      const pairs: any[] = [...scene.worldView.active.values(), ...scene.worldView.pool];
      switch (name) {
        case 'fog':
          scene.fog.image.setAlpha(alpha);
          return true;
        case 'blocks':
          pairs.forEach((pair) => pair.blocks.setAlpha(alpha));
          return true;
        case 'walls':
          pairs.forEach((pair) => pair.walls.setAlpha(alpha));
          return true;
        case 'sky':
          scene.sky.image.setAlpha(alpha);
          return true;
        case 'overlay':
          document.getElementById('ui')!.style.visibility = show ? '' : 'hidden';
          return true;
        default:
          return false;
      }
    },
    [part, visible] as const,
  );
}

test('performance probe', async ({ page, browserErrors }, testInfo) => {
  test.setTimeout(150_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const windows: FrameWindow[] = [];

  await page.goto('./');
  const newGame = page.getByRole('button', { name: 'New game' });
  await expect(newGame).toBeVisible({ timeout: 30_000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'no WebGL';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? `${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)} | ${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
  });
  await page.mouse.move(640, 600);
  windows.push(await measure(page, cdp, 'title screen'));

  await newGame.click();
  await page.getByTestId('seed-input').fill('smoke-test');
  await page.getByTestId('create-world').click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 30_000 });
  await page.mouse.move(640, 360);
  await page.waitForTimeout(500);

  windows.push(await measure(page, cdp, 'game, zoom 2, still'));
  windows.push(
    await measure(page, cdp, 'game, zoom 2, panning', async () => {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(1900);
      await page.keyboard.up('KeyD');
    }),
  );

  // Ablations: what each part of the picture costs (dev server only).
  for (const part of ['fog', 'blocks', 'walls', 'sky', 'overlay']) {
    if (!(await setPartVisible(page, part, false))) break;
    windows.push(await measure(page, cdp, `game, zoom 2, still, without ${part}`));
    await setPartVisible(page, part, true);
  }

  await page.keyboard.press('KeyM');
  windows.push(await measure(page, cdp, 'game, zoom 2, still, minimap closed'));
  await page.keyboard.press('KeyM');

  await page.keyboard.press('Minus');
  await page.waitForTimeout(300);
  windows.push(await measure(page, cdp, 'game, zoom 1, still'));
  await page.keyboard.press('Equal');
  await page.waitForTimeout(300);

  // A CPU profile of panning, to spot script hot spots. (A Chrome trace showed the rest of
  // the time is SwiftShader drawing the frame, which the page then waits for.)
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await cdp.send('Profiler.start');
  windows.push(
    await measure(page, cdp, 'game, zoom 2, panning (profiled)', async () => {
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(1900);
      await page.keyboard.up('KeyA');
    }),
  );
  const { profile } = await cdp.send('Profiler.stop');
  await writeFile(testInfo.outputPath('panning.cpuprofile'), JSON.stringify(profile));

  const report = { project: testInfo.project.name, renderer, windows };
  await writeFile(testInfo.outputPath('perf.json'), JSON.stringify(report, null, 2) + '\n');
  testInfo.annotations.push({ type: 'renderer', description: renderer });
  for (const w of windows) {
    testInfo.annotations.push({
      type: 'perf',
      description: `${w.label}: ${w.fps} fps (p50 ${w.p50} ms, p90 ${w.p90} ms, max ${w.max} ms); main thread ${w.taskMs} ms, script ${w.scriptMs} ms`,
    });
  }

  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});
