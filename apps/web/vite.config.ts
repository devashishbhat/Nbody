import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
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
