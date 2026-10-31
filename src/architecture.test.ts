/**
 * Guards the architecture rule from the brief: pure game logic (src/core and src/sim)
 * must not depend on Phaser, the DOM, the UI layer or anything browser-specific, so it
 * stays unit-testable and can run inside a Web Worker. It must also stay deterministic,
 * so Math.random() is banned there in favour of the seeded Rng.
 */
import { describe, expect, it } from 'vitest';

const pureModules = import.meta.glob(['./core/**/*.ts', './sim/**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const RULES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from\s+['"]phaser['"]/, reason: 'imports Phaser' },
  { pattern: /from\s+['"]preact/, reason: 'imports Preact' },
  { pattern: /from\s+['"](?:\.\.\/)+(?:render|ui|platform|app|debug)\//, reason: 'imports a browser-side layer' },
  { pattern: /\b(?:window|document|navigator)\./, reason: 'touches the DOM' },
  { pattern: /\blocalStorage\b|\bindexedDB\b/, reason: 'touches browser storage' },
  { pattern: /\bMath\.random\s*\(/, reason: 'uses Math.random instead of the seeded Rng' },
];

describe('architecture', () => {
  it('finds the pure-logic modules to check', () => {
    expect(Object.keys(pureModules).length).toBeGreaterThan(5);
  });

  for (const [path, source] of Object.entries(pureModules)) {
    it(`${path} stays free of Phaser, DOM and randomness`, () => {
      // Ignore comments, which may legitimately mention these names.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const violations = RULES.filter((rule) => rule.pattern.test(code)).map((rule) => rule.reason);
      expect(violations).toEqual([]);
    });
  }
});
