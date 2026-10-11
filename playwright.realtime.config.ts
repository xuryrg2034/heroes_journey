import { defineConfig } from '@playwright/test';

// The real-time game (docs/realtime-prototype.md, docs/realtime-slice.md): `npm test` or `npx playwright test -c playwright.realtime.config.ts`
// — the arena sandbox (realtime.spec.ts), the new enemies of the slice (realtime-enemies.spec.ts), the run (realtime-run.spec.ts)
// the abilities, consumables, elites and talismans of step 3 (realtime-kit.spec.ts) and the mixed arenas 8–10 of step 4
// (realtime-arenas.spec.ts), the terrain of stage 3a (realtime-terrain.spec.ts) its enemy behaviour (realtime-behavior.spec.ts) the camera (realtime-camera.spec.ts) the view of the loop (realtime-loop.spec.ts) the slot (realtime-slot.spec.ts) and the view of elite armour (realtime-elites.spec.ts) and the cauldron (realtime-purse.spec.ts) and the oath stake (realtime-oath.spec.ts) and the die at the door (realtime-die.spec.ts).
// Its own default port (PLAYWRIGHT_PORT overrides it).
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4620);

export default defineConfig({
  testDir: './tests',
  testMatch: /realtime(?:-run|-enemies|-kit|-arenas|-terrain|-behavior|-camera|-telemetry|-loop|-elites|-slot|-purse|-oath|-die)?\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    // RT_GPU=1 keeps the hardware GPU (for an fps reading); default is the software renderer of the main suite.
    launchOptions: { args: process.env.RT_GPU ? ['--enable-webgl', '--ignore-gpu-blocklist'] : ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
