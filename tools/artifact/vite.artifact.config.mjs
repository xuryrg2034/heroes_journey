// Vite lib build of the realtime game for the playtest artifact (tools/artifact/README.md).
// One IIFE realtime.js plus realtime.css; pixi.js comes from the CDN as the global PIXI.
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const out = process.env.ARTIFACT_OUT || fileURLToPath(new URL('./out', import.meta.url));

export default {
  root: repo,
  publicDir: false,
  define: { __RT_BUILD__: JSON.stringify(process.env.RT_BUILD || 'unknown') },
  build: {
    outDir: out,
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('../../src/realtime/view/main.ts', import.meta.url)),
      formats: ['iife'],
      name: 'AshenOathRealtime',
      fileName: () => 'realtime.js',
      cssFileName: 'realtime',
    },
    rollupOptions: { external: ['pixi.js'], output: { globals: { 'pixi.js': 'PIXI' } } },
  },
};
