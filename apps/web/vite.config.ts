import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  /**
   * Served from the site root in development and from a repository
   * subdirectory on GitHub Pages, so the base has to come from the
   * environment rather than being hard-coded. The deploy workflow sets it
   * from the repository name.
   *
   * This matters more than it looks: the simulation worker is referenced with
   * `new URL('../worker.ts', import.meta.url)`, and Vite rewrites that
   * against the base. Get it wrong and the page loads but never simulates.
   */
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [react(), tailwindcss()],
  worker: {
    // The simulation worker is an ES module and imports the engine package as
    // source, so it must not be bundled as a classic script.
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
