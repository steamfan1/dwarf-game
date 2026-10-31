import { defineConfig } from 'vitest/config';

// Unit tests cover pure logic only, so they run in plain Node with no browser or Phaser.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
