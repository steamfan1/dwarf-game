import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests. Every test runs twice in headless Chromium:
 *   - "build": against the production build (`npm run build`, then served by `vite preview`);
 *   - "dev":   against the development server (`npm run dev`).
 * Any console error fails a test. CI runs both on every push.
 */
const PREVIEW_URL = 'http://localhost:4173/';
const DEV_URL = 'http://localhost:5173/';
const CI = Boolean(process.env.CI);

const chromium = {
  ...devices['Desktop Chrome'],
  // Software WebGL on machines without a GPU (CI runners).
  launchOptions: { args: ['--enable-unsafe-swiftshader'] },
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // One browser at a time keeps timing checks (ticks per second) reliable on small CI machines.
  workers: CI ? 1 : undefined,
  retries: 0,
  // In CI, failures also become GitHub annotations, and results.json summarises the run.
  reporter: CI ? [['list'], ['github'], ['json', { outputFile: 'test-results/results.json' }]] : 'list',
  outputDir: 'test-results',
  use: {
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'build', use: { ...chromium, baseURL: PREVIEW_URL } },
    { name: 'dev', use: { ...chromium, baseURL: DEV_URL } },
  ],
  webServer: [
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: PREVIEW_URL,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: DEV_URL,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
