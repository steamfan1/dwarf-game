import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs, so one dist/ works at a domain root, a GitHub Pages sub-path
  // (user.github.io/repo/) and inside itch.io's iframe without rebuilding.
  base: './',

  // HTML panels are Preact components written in JSX.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },

  // World generation runs in a module worker (Milestone 1).
  worker: { format: 'es' },

  build: {
    sourcemap: true,
    // Phaser alone is over 1 MB minified; bundle splitting is tuned in Milestone 8.
    chunkSizeWarningLimit: 2000,
  },

  server: { port: 5173 },
  preview: { port: 4173 },
});
