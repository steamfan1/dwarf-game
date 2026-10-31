/**
 * Shared helpers for the browser tests.
 *
 * `test` adds a `browserErrors` fixture: it collects console errors and uncaught
 * exceptions for the whole test, and writes the full browser console to console.txt in
 * the test's output folder, so CI failures can be diagnosed without a debugger.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export { expect };

export const test = base.extend<{ browserErrors: string[] }>({
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

/** A number shown in the debug overlay (`part` picks one of several, e.g. "x, y"). */
export async function readNumber(page: Page, testId: string, part = 0): Promise<number> {
  const text = (await page.getByTestId(testId).textContent()) ?? '';
  return Number(text.split(',')[part]?.replace(/[^\d.-]/g, ''));
}

/** Title screen -> New world dialog -> generated world on screen. */
export async function createWorld(page: Page, options: { seed: string; biome?: string }): Promise<void> {
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
