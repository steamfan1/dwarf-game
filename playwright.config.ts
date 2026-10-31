import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests: they run the production build (`npm run build` first) in headless
 * Chromium and fail on any console error. CI runs them on every push.
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  // In CI, failures also become GitHub annotations, and results.json summarises the run.
  reporter: process.env.CI
    ? [['list'], ['github'], ['json', { outputFile: 'test-results/results.json' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL on machines without a GPU (CI runners).
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
