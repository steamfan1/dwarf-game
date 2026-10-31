/**
 * Milestone 0 smoke test: boots the production build in a real browser and checks the
 * things a player would notice first, failing on any console error along the way.
 */
import { expect, test, type Page } from '@playwright/test';

/** Collect console errors and uncaught exceptions for the whole test. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return errors;
}

async function readTick(page: Page): Promise<number> {
  return Number(await page.getByTestId('debug-ticks').textContent());
}

test('title screen, new game, running simulation, pause, menu and settings', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);

  await page.goto('./');
  const newGame = page.getByRole('button', { name: 'New game' });
  await expect(newGame).toBeVisible();
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title');
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('1-title.png') });

  await newGame.click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game');
  await expect(page.getByTestId('hud')).toBeVisible();

  // The debug overlay (backtick) shows the simulation tick, which should advance at ~20/s.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await expect.poll(() => readTick(page)).toBeGreaterThan(0);
  const start = await readTick(page);
  await page.waitForTimeout(1500);
  const ticked = (await readTick(page)) - start;
  expect(ticked, 'ticks in 1.5 s at 1x (expected about 30)').toBeGreaterThan(15);
  expect(ticked).toBeLessThan(45);
  await page.screenshot({ path: testInfo.outputPath('2-game.png') });

  // Space pauses: the tick counter stops.
  await page.keyboard.press('Space');
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  const pausedAt = await readTick(page);
  await page.waitForTimeout(800);
  expect(await readTick(page)).toBe(pausedAt);

  // Key 3 resumes at triple speed.
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('debug-speed')).toHaveText('3×');

  // Esc opens the in-game menu, which pauses; Settings opens from there.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('3-settings.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await expect(page.getByTestId('game-menu')).toBeVisible();

  // Quit to title.
  await page.getByRole('button', { name: 'Quit to title' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('right-click and the mouse wheel are kept away from the browser', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();

  const defaultPrevented = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas')!;
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    canvas.dispatchEvent(contextMenu);
    canvas.dispatchEvent(wheel);
    return { contextMenu: contextMenu.defaultPrevented, wheel: wheel.defaultPrevented };
  });
  expect(defaultPrevented).toEqual({ contextMenu: true, wheel: true });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('high-DPI screens get a full-resolution canvas that follows window resizes', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = watchForErrors(page);
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();

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
  await page.screenshot({ path: testInfo.outputPath('4-title-hidpi.png') });

  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});
