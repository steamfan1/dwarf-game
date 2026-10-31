/**
 * Smoke tests: boot the game in a real browser and check what a player would notice
 * first. Any console error or uncaught exception fails the test. Every test also writes
 * the full browser console to console.txt in its output folder, so CI failures can be
 * diagnosed without a debugger.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

/** `browserErrors` collects console errors and uncaught exceptions for the whole test. */
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: async ({ page }, use, testInfo) => {
    const everything: string[] = [];
    const errors: string[] = [];
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      everything.push(line);
      if (message.type() === 'error') errors.push(line);
    });
    page.on('pageerror', (error) => {
      const line = `[uncaught] ${error.message}\n${error.stack ?? ''}`;
      everything.push(line);
      errors.push(line);
    });
    page.on('requestfailed', (request) => {
      everything.push(`[request failed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });
    await use(errors);
    await writeFile(testInfo.outputPath('console.txt'), everything.join('\n') + '\n');
  },
});

async function readNumber(page: Page, testId: string, part = 0): Promise<number> {
  const text = (await page.getByTestId(testId).textContent()) ?? '';
  return Number(text.split(',')[part]?.replace(/[^\d.-]/g, ''));
}

/** Title screen -> New world dialog -> generated world on screen. */
async function createWorld(page: Page, options: { seed: string; biome?: string }): Promise<void> {
  const newGame = page.getByRole('button', { name: 'New game' });
  // Generous on first load: the dev server pre-bundles Phaser the first time it's requested.
  await expect(newGame).toBeVisible({ timeout: 30_000 });
  await newGame.click();
  await expect(page.getByTestId('new-world')).toBeVisible();
  await page.getByTestId('seed-input').fill(options.seed);
  if (options.biome) await page.getByTestId(`biome-${options.biome}`).check();
  await page.getByTestId('create-world').click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 30_000 });
  await expect(page.getByTestId('hud')).toBeVisible();
}

test('a new world: terrain, digging, camera, minimap, pause and menus', async ({ page, browserErrors }, testInfo) => {
  await page.goto('./');
  await expect(page.locator('#game canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('1-title.png') });

  await createWorld(page, { seed: 'smoke-test' });
  await expect(page.getByTestId('minimap')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('2-world.png') });

  // The debug overlay (backtick) shows the simulation tick, which should advance at ~20/s.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await expect.poll(() => readNumber(page, 'debug-ticks')).toBeGreaterThan(0);
  const start = await readNumber(page, 'debug-ticks');
  await page.waitForTimeout(1500);
  const ticked = (await readNumber(page, 'debug-ticks')) - start;
  expect(ticked, 'ticks in 1.5 s at 1x (expected about 30)').toBeGreaterThan(15);
  expect(ticked).toBeLessThan(45);

  // The camera starts centred two tiles above the Hearth, which stands on the ground, so
  // the dirt three columns right and two rows down from the surface is 96 and 160 CSS
  // pixels from the centre of a 1280x720 view at the default zoom (2 device px per world px).
  const viewport = page.viewportSize()!;
  const dirt = { x: viewport.width / 2 + 3 * 16 * 2, y: viewport.height / 2 + 5 * 16 * 2 };
  await page.mouse.move(dirt.x, dirt.y);
  const readout = page.getByTestId('hover-title');
  await expect(readout).toHaveText(/Dirt|Clay|Stone/);
  await page.mouse.down();
  await page.mouse.up();
  await expect(readout).toHaveText('Open cave');
  await page.screenshot({ path: testInfo.outputPath('3-dug.png') });

  // Zoom with the + key and the mouse wheel; pan with D.
  await expect(page.getByTestId('debug-zoom')).toHaveText('2×');
  await page.keyboard.press('Equal');
  await expect(page.getByTestId('debug-zoom')).toHaveText('3×');
  await page.mouse.wheel(0, 300);
  await expect(page.getByTestId('debug-zoom')).toHaveText('2×');
  const cameraX = await readNumber(page, 'debug-camera', 0);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await expect.poll(() => readNumber(page, 'debug-camera', 0)).toBeGreaterThan(cameraX + 5);

  // Space pauses: the tick counter stops.
  await page.keyboard.press('Space');
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  const pausedAt = await readNumber(page, 'debug-ticks');
  await page.waitForTimeout(800);
  expect(await readNumber(page, 'debug-ticks')).toBe(pausedAt);

  // Key 3 resumes at triple speed.
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('debug-speed')).toHaveText('3×');

  // Esc opens the in-game menu, which names the world; Settings opens from there.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await expect(page.getByTestId('world-info')).toContainText('smoke-test');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await expect(page.getByTestId('game-menu')).toBeVisible();

  // Quit to title.
  await page.getByRole('button', { name: 'Quit to title' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title');

  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('a snowy world can be chosen in the New world dialog', async ({ page, browserErrors }, testInfo) => {
  await page.goto('./');
  await createWorld(page, { seed: 'frost-hollow', biome: 'snow' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('snow-world.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('world-info')).toContainText('Frozen north');
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('?reveal=1 lifts the fog of war over the whole map', async ({ page, browserErrors }, testInfo) => {
  await page.goto('./?seed=smoke-test&reveal=1');
  await createWorld(page, { seed: 'smoke-test' });
  // Zoomed all the way out, most of the map is in view.
  await page.mouse.move(640, 360);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Minus');
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('revealed.png') });
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test('right-click and the mouse wheel are kept away from the browser', async ({ page, browserErrors }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible({ timeout: 30_000 });

  const defaultPrevented = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas')!;
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    canvas.dispatchEvent(contextMenu);
    canvas.dispatchEvent(wheel);
    return { contextMenu: contextMenu.defaultPrevented, wheel: wheel.defaultPrevented };
  });
  expect(defaultPrevented).toEqual({ contextMenu: true, wheel: true });
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});

test.describe('on a high-DPI screen', () => {
  test.use({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });

  test('the canvas renders at full resolution and follows window resizes', async ({ page, browserErrors }, testInfo) => {
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'New game' })).toBeVisible({ timeout: 30_000 });

    const canvasSize = () =>
      page.locator('#game canvas').evaluate((canvas: HTMLCanvasElement) => ({
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
      }));

    await expect.poll(canvasSize).toEqual({ width: 1600, height: 1000, cssWidth: 800, cssHeight: 500 });
    await page.setViewportSize({ width: 1000, height: 600 });
    await expect.poll(canvasSize).toEqual({ width: 2000, height: 1200, cssWidth: 1000, cssHeight: 600 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('4-title-hidpi.png') });

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });
});
