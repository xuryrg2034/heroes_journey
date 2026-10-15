import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { rtAvailableNodes, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_PROFILE_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { SCHEDULE_ELEMENTS } from '../src/realtime/run/schedule';

/**
 * Task 26 «Расписание леса» (design 15.10.2026; docs/realtime-slice.md, «Расписание леса») at 1280×720 by real input: a viewer
 * who has met the whole forest (the profile's history) presses «Обучение» on the gear, skips the prologue back to the same run,
 * starts a new run (the gear's «Новый поход») — the new run goes the newcomer's path: its snapshot is empty and its first fight
 * is «Поляна» with only basic enemies (no wolf, no boar) for 20 s of game time. The order of the arcs, the loadout rules and the
 * saves: Node (`npm run test:realtime-schedule`).
 */
const PROLOGUE_KEY = 'ashen-oath-realtime-prologue-done';
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

test('task 26: «Обучение» empties the viewer\'s history — the next new run\'s first fight is «Поляна» with only basic enemies', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(([key, profileKey, seen]) => {
    localStorage.clear();
    localStorage.setItem(key, '1');
    localStorage.setItem(profileKey, JSON.stringify({ version: 1, giftFull: false, seen }));
  }, [PROLOGUE_KEY, RT_PROFILE_STORAGE_KEY, [...SCHEDULE_ELEMENTS].sort()] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 31);
  await page.getByTestId('gift-1').click();
  const before = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(before.schedule?.seen.length).toBe(SCHEDULE_ELEMENTS.length);
  // The gear: «Обучение» plays the prologue; «Пропустить» returns to the same run.
  await page.getByTestId('run-settings').click();
  await page.getByTestId('prologue-start').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime.snapshot().prologue.active)).toBe(true);
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ashen-oath-rt-profile-v1')!).seen)).toEqual([]);
  // A new run: the header's «Новый поход», confirmed.
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await page.getByTestId('gift-1').click();
  const run = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(run.schedule?.seen).toEqual([]);
  const first = rtAvailableNodes(run)[0];
  await page.getByTestId(`node-${first.id}`).click();
  await page.screenshot({ path: 'artifacts/realtime-schedule-first-card.png' });
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  // Every kind on the arena, read in the page every frame for 20 s of game time.
  const kinds = await untilFrame(page, (s: any, _arg: null, late: boolean) => {
    const w = window as any, seen: string[] = w.__scheduleKinds ??= [];
    for (const e of s.enemies) if (!seen.includes(e.kind)) seen.push(e.kind);
    return late ? seen : undefined;
  }, null, 20);
  expect((await snap(page)).arena).toBe('glade');
  expect(kinds.length).toBeGreaterThan(0);
  expect(kinds.filter(kind => kind !== 'basic')).toEqual([]);
  await page.screenshot({ path: 'artifacts/realtime-schedule-first-fight.png' });
  expect(errors).toEqual([]);
});
