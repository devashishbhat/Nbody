import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Runs against the production build, so the worker chunk and the module
    // graph are the ones that actually ship.
    //
    // The host is pinned to 127.0.0.1 rather than left to default. Vite
    // listens on "localhost", and since Node 17 that name is no longer
    // reordered to prefer IPv4, so on a Linux CI runner it can resolve to ::1
    // and the server ends up listening only on IPv6 while this config polls
    // the IPv4 address. The result is a server that started fine and a sixty
    // second timeout that says nothing about why.
    command: 'pnpm --filter @nbody/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Surfaced so that a server which fails to start says so, instead of
    // being diagnosed from a bare timeout.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
