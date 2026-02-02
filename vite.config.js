import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  base: '/starstrafe/',  // GitHub Pages subdirectory
  plugins: [wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ['@sparkjsdev/spark'],
  },
});
