import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two pages: the game (index.html) and the draft real-time prototype (realtime.html, docs/realtime-prototype.md).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        realtime: fileURLToPath(new URL('./realtime.html', import.meta.url)),
      },
    },
  },
});
