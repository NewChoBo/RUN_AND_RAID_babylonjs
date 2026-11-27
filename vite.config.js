import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5198,
    strictPort: true,
    watch: { ignored: ['**/.asset-work/**', '**/asset-sources/**'] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
    rolldownOptions: {
      input: {
        home: resolve('index.html'),
        game: resolve('game.html'),
        library: resolve('library.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            { name: 'shader-glsl', test: /@babylonjs[\\/]core[\\/]Shaders[\\/]/ },
            { name: 'shader-wgsl', test: /@babylonjs[\\/]core[\\/]ShadersWGSL[\\/]/ },
          ],
        },
      },
    },
  },
});
