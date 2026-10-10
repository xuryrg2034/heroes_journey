import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { rtTelemetryPlugin } from './vite/rtTelemetryPlugin';

// Build id for telemetry records (docs/realtime-telemetry.md): short commit, "+dirty" for local changes.
function rtBuildId(): string {
  try {
    const run = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const head = run('git rev-parse --short HEAD');
    return run('git status --porcelain') ? `${head}+dirty` : head;
  } catch {
    return 'unknown';
  }
}

// Two pages: the game (index.html) and the draft real-time prototype (realtime.html, docs/realtime-prototype.md).
export default defineConfig({
  plugins: [rtTelemetryPlugin()],
  define: { __RT_BUILD__: JSON.stringify(rtBuildId()) },
  server: { watch: { ignored: ['**/playtest-logs/**'] } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        realtime: fileURLToPath(new URL('./realtime.html', import.meta.url)),
      },
    },
  },
});
