// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './src/realtime/view/nodeNavigator.testkit';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// The real-time game (docs/realtime-prototype.md, docs/realtime-slice.md): `npm test` or `npx playwright test -c playwright.realtime.config.ts`
// — the arena sandbox (realtime.spec.ts), the new enemies of the slice (realtime-enemies.spec.ts), the run (realtime-run.spec.ts)
// the abilities, consumables, elites and talismans of step 3 (realtime-kit.spec.ts) and the mixed arenas 8–10 of step 4
// (realtime-arenas.spec.ts), the terrain of stage 3a (realtime-terrain.spec.ts) its enemy behaviour (realtime-behavior.spec.ts) the camera (realtime-camera.spec.ts) the view of the loop (realtime-loop.spec.ts) the view of «Прямая» (realtime-pierce.spec.ts) the slot (realtime-slot.spec.ts) and the view of elite armour (realtime-elites.spec.ts) and the cauldron (realtime-purse.spec.ts) and the oath stake (realtime-oath.spec.ts) and the die at the door (realtime-die.spec.ts) and «Глубина звена» (realtime-link-depth.spec.ts) and «Часы сессии» (realtime-session.spec.ts) and «Второе дыхание» (realtime-second-wind.spec.ts) and «Личный рекорд» (realtime-record.spec.ts) and «Журнал удачи» (realtime-luck.spec.ts) and «Переброс» (realtime-reroll.spec.ts) and «Проклятый сундук» (realtime-chest.spec.ts) and «Игорный круг» with the live «Колесо костей» (realtime-casino.spec.ts) and «Новое на карте» (realtime-new-seen.spec.ts) and «Обучение v1» (realtime-onboarding.spec.ts) and the action bar, the power number and the node card of task 8 (realtime-actionbar.spec.ts) and the colour kept free of task 10 (realtime-color-keep.spec.ts) and the leaders and the horde of task 12 (realtime-marked.spec.ts) and the run's sound on the gear (realtime-sound.spec.ts) and the bag at the door of task 14 (realtime-bag.spec.ts) and the view of task 17 «Пологий вход» (realtime-gentle.spec.ts).
// Its own port per working tree, 4620–5019 from the tree's path (PLAYWRIGHT_PORT overrides it): parallel sessions and
// worktrees each start their own Vite — with `reuseExistingServer` a shared port made one tree's run test another tree's code.
const tree = fileURLToPath(new URL('.', import.meta.url)).toLowerCase();
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4620 + createHash('sha1').update(tree).digest().readUInt16BE(0) % 400);

export default defineConfig({
  testDir: './tests',
  testMatch: /realtime(?:-prologue|-run-end|-run|-enemies|-kit|-arenas|-terrain|-behavior|-camera|-telemetry|-loop|-pierce|-elites|-slot|-purse|-oath|-die|-link-depth|-session|-second-wind|-record|-luck|-reroll|-chest|-casino|-new-seen|-onboarding|-actionbar|-color-keep|-marked|-sound|-bag|-gentle|-heal|-feats|-ash|-schedule|-boss|-forms|-fusions|-juice|-juice2-screens|-meta|-garrison-step2|-garrison|-camp3|-gambler|-monk|-away|-keymaster|-castellan-full|-knight|-juice2|-troll|-chief|-knacks|-habits|-toad-fight|-toad-meta|-pc-input|-hearth-wide|-warmup|-castle|-warlock|-omens|-daily|-shooters)?\.spec\.ts/,
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
