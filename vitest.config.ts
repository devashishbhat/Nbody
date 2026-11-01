import { defineConfig } from 'vitest/config';

/**
 * Single node-environment project covering every package plus the
 * cross-package suites under `tests/`.
 *
 * Internal packages are consumed as TypeScript source, so there is no build
 * step to sequence before tests run.
 *
 * `tests/e2e` is excluded: those are Playwright specs, run with
 * `pnpm test:e2e`.
 *
 * Lane E: when the UI needs a DOM, add a second entry under `test.projects`
 * rather than switching this one to jsdom. The numeric suites must stay on
 * node.
 */
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tests/physics/**/*.test.ts',
    ],
    environment: 'node',
    reporters: ['default'],
  },
});
