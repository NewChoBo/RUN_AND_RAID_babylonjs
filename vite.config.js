import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { lobbyHtml } from './tools/lobby-html.js';

// Public GLB filenames are also editor and archive references. Version their HTTP requests
// by content so a returning client loads the clips advertised by the current build.
const modelVersions = {};
for (const line of readFileSync(
  new URL('./.github/pages-assets.sha256', import.meta.url),
  'utf8',
).split(/\r?\n/)) {
  const [sha, path] = line.split('  ');
  if (path?.endsWith('.glb')) modelVersions['./' + path] = sha.slice(0, 12);
}

export default defineConfig({
  define: { __RAID_MODEL_VERSIONS__: JSON.stringify(modelVersions) },
  base: './',
  plugins: [lobbyHtml],
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
