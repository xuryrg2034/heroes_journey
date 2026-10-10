import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  // Anchored at a path separator: «telemetry» must not take tests/realtime-telemetry.spec.ts (the real-time suite runs it).
  testMatch: /(?:^|[\\/])(?:game|editor|trunk|telemetry|events-ui|desktop-ux|pit-editor|finale-editor|palette|refill|boar-ui|forest-map|forest-beasts-ui|forest-troll-ui|battle-readability|map-rules-ui|crystal-fall-ui|spin-toasts-ui|elite-ui|exit-ui)\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
