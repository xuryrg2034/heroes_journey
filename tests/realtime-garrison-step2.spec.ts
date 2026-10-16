import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait } from './realtimeFrames';

/**
 * Task 43 «Гарнизон, шаг 2», part Г (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 6): the sandbox menu holds the
 * two arenas of step 2 at its end — «Бойницы» (`?arena=28`: two crossbowmen, five crates) and «Ристалище» (`?arena=29`: a knight
 * in a guards' line). They open and play (a crossbowman aims within a few game seconds); shots 1280×720. The rules and
 * the run's pools: Node (`npm run test:realtime-garrison-step2`, `test:realtime-crossbow`, `test:realtime-knight`).
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page, query: string): Promise<void> {
  await page.goto(`/?sandbox=1${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

test('task 43 Г: the sandbox «Бойницы» (?arena=28) — two crossbowmen and a guards\' line; a crossbowman aims at the hero', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=28');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-loopholes');
  const s = await snap(page);
  expect(s.enemies.filter((e: any) => e.kind === 'crossbow').length).toBe(2);
  expect(s.enemies.filter((e: any) => e.kind === 'guard').length).toBe(3);
  // A crossbowman aims (`vars.cb` 1) once its reload is over and the hero is in sight.
  await expect.poll(async () => { await gameWait(page, 0.5); return (await snap(page)).enemies.some((e: any) => e.kind === 'crossbow' && e.vars.cb === 1); }, { timeout: 20_000 }).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-garrison-loopholes.png' });
  expect(errors).toEqual([]);
});

test('task 43 Г: the sandbox «Ристалище» (?arena=29) — a knight in armour in the middle of a guards\' line', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=29');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-armory');
  const s = await snap(page), knights = s.enemies.filter((e: any) => e.kind === 'knight');
  expect(knights.length).toBe(1);
  expect(knights[0].armor?.plates).toBe(2);
  expect(s.enemies.filter((e: any) => e.kind === 'guard' && e.vars.fm === knights[0].vars.fm).length).toBe(2);
  await gameWait(page, 1);
  await page.screenshot({ path: 'artifacts/realtime-garrison-armory.png' });
  expect(errors).toEqual([]);
});
