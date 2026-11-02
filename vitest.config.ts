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

    /**
     * Thirty seconds, not the five-second default.
     *
     * That default is sized for unit tests. Much of this suite is numerical
     * integration: the adaptive integrator is checked against a brute-force
     * symplectic reference that takes five million steps, and it is accurate
     * precisely because it is expensive. On a CI runner about four times
     * slower than the machine these were written on, that test took 5.4
     * seconds and was killed mid-run, which looks like a correctness failure
     * and is not one.
     *
     * Still bounded, so a genuine hang is still caught. Individual tests that
     * need longer say so themselves.
     */
    testTimeout: 30_000,
  },
});
