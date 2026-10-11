import { test, expect, type Page } from '@playwright/test';

/**
 * The view of the loop «Печать» (docs/realtime-loop-research.md, 3.2; loop research step 2) in the sandbox with the loop on:
 * the pulsing «замкни» ring on an open chain that could close, the closed ring filled and its enemy marked, the release and the
 * strike (the inner enemy is hit and held); the experiment `loopHint`. Runs through playwright.realtime.config.ts only.
 * The rules are checked in Node (`npm run test:realtime-loop`); this test looks at what the player sees and at the console.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The sandbox, quiet (only what the test places acts), the loop on; the hero at (8, 5.5). */
async function openLoopSandbox(page: Page, extra: [string, unknown][] = []): Promise<void> {
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.evaluate(params => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['loopEnabled', true], ...params] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5.5);
  }, extra);
}
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

/** A 1.6-unit square of four weak red enemies round one blue enemy of 3 HP; returns their ids. */
async function square(page: Page): Promise<{ corners: number[]; inner: number }> {
  const corners = [await place(page, 9.2, 4.7, 0, 1), await place(page, 10.8, 4.7, 0, 1), await place(page, 10.8, 6.3, 0, 1), await place(page, 9.2, 6.3, 0, 1)];
  return { corners, inner: await place(page, 10, 5.5, 1, 3) };
}

test('loop on: an open chain shows the «замкни» ring, the fourth link on the first closes it (ring filled, inner enemy marked); the release hits and holds the inner enemy', async ({ page }) => {
  const errors = collectErrors(page);
  await openLoopSandbox(page);
  const { corners, inner } = await square(page);
  const at = await Promise.all([[9.2, 4.7], [10.8, 4.7], [10.8, 6.3], [9.2, 6.3]].map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const k of [1, 2, 3]) { await page.mouse.move(at[k].x, at[k].y, { steps: 4 }); }
  await expect.poll(async () => (await snap(page)).chain).toEqual([corners[0], corners[1], corners[2], corners[3]]);
  // Four links, the first in reach of the last: the «замкни» ring pulses on the first link; nothing is closed yet.
  await expect.poll(async () => (await snap(page)).loop.shown.candidates).toBeGreaterThan(0);
  expect((await snap(page)).loop.closed).toBeNull();
  await page.screenshot({ path: 'artifacts/realtime-loop-candidate.png' });
  // The pointer to the first link closes the ring.
  await page.mouse.move(at[0].x, at[0].y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('first');
  await expect.poll(async () => (await snap(page)).loop.shown).toMatchObject({ closed: 1, marks: 1, candidates: 0 });
  await page.screenshot({ path: 'artifacts/realtime-loop-closed.png' });
  await page.mouse.up();
  // The strike at the end of the dash: the inner enemy loses 1 HP and is held (cold); the outline flashed (release, strike).
  await expect.poll(async () => (await snap(page)).enemies.find((e: any) => e.id === inner)?.hp, { timeout: 8000 }).toBe(2);
  const held = (await snap(page)).enemies.find((e: any) => e.id === inner);
  expect(held.chill).toBeGreaterThan(0);
  await expect.poll(async () => (await snap(page)).loop.shown.flashes).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: 'artifacts/realtime-loop-strike.png' });
  expect(errors).toEqual([]);
});

test('loop off (default): the same four links never show a ring or close', async ({ page }) => {
  const errors = collectErrors(page);
  await openLoopSandbox(page, [['loopEnabled', false]]);
  const { corners } = await square(page);
  const at = await Promise.all([[9.2, 4.7], [10.8, 4.7], [10.8, 6.3], [9.2, 6.3]].map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const k of [1, 2, 3, 0]) await page.mouse.move(at[k].x, at[k].y, { steps: 4 });
  const s = await snap(page);
  expect(s.chain).toEqual(corners);
  expect(s.loop.closed).toBeNull();
  expect(s.loop.shown).toMatchObject({ candidates: 0, closed: 0, marks: 0 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('experiment «Подсказка петли»: with the loop on, the toggle on and no chain drawn, one closable figure is outlined faintly; off — nothing', async ({ page }) => {
  const errors = collectErrors(page);
  await openLoopSandbox(page, [['loopHint', true]]);
  await square(page);
  await expect.poll(async () => (await snap(page)).loop.shown.hint).toBe(1);
  await page.mouse.move(640, 400);
  await page.screenshot({ path: 'artifacts/realtime-loop-hint.png' });
  await page.evaluate(() => (window as any).__realtime.setParam('loopHint', false));
  await expect.poll(async () => (await snap(page)).loop.shown.hint).toBe(0);
  expect(errors).toEqual([]);
});
