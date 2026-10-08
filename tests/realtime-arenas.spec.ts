import { test, expect, type Page } from '@playwright/test';

/**
 * The mixed arenas 8–10 of the slice in the sandbox (stage 2 of the transition, step 4; docs/realtime-slice.md, section 5
 * and 11, «Шаг 4»). Runs through playwright.realtime.config.ts only. Each arena opens from the sandbox menu (keys 8, 9
 * and 0) or by `?arena=8…10`; the test looks at what the player sees: the goal on the HUD, the start elites, the
 * newcomers that come, no page errors. The rules themselves are checked in Node (`npm run test:realtime-arenas`).
 */
interface Snap {
  arena: string;
  status: string;
  time: number;
  enemies: { id: number; kind: string; marked: boolean; elite: boolean }[];
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

const ARENAS = [
  { key: '8', n: 8, id: 'ford', name: 'Брод', goal: 'отмеченные 0 / 5', elites: 0, marked: 5, note: /Брод.*кабанов нет/ },
  { key: '9', n: 9, id: 'outpost', name: 'Застава', goal: 'убито 0 / 30', elites: 2, marked: 0, note: /Застава.*стай волков и кабанов нет/ },
  { key: '0', n: 10, id: 'last-stand', name: 'Последний рубеж', goal: 'убито 0 / 40', elites: 2, marked: 0, note: /Последний рубеж.*своя таблица фаз/ },
];

test('arenas 8–10: the sandbox menu lists ten arenas; keys 8, 9 and 0 open «Брод», «Застава» and «Последний рубеж» without errors', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/realtime.html?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.locator('[data-testid^="arena-"]')).toHaveCount(10);
  for (const arena of ARENAS) {
    await expect(page.getByTestId(`arena-${arena.n}`)).toContainText(arena.name);
    await expect(page.getByTestId(`arena-${arena.n}`).locator('kbd')).toHaveText(arena.key);
  }
  for (const arena of ARENAS) {
    if (!(await page.getByTestId('menu').isVisible())) await page.keyboard.press('KeyM');
    await expect(page.getByTestId('menu')).toBeVisible();
    await page.keyboard.press(arena.key);
    await expect(page.getByTestId('menu')).toBeHidden();
    await expect.poll(async () => (await snap(page)).arena).toBe(arena.id);
    await expect(page.getByTestId('goal')).toHaveText(arena.goal);
    await expect(page.getByTestId('phase-arena-note')).toHaveText(arena.note);
    const start = await snap(page);
    expect(start.enemies.filter(e => e.elite).length, `${arena.id}: elites from the start`).toBe(arena.elites);
    expect(start.enemies.filter(e => e.marked).length, `${arena.id}: marked`).toBe(arena.marked);
    // The horde comes: game time, not wall time (the software renderer may run the crowd slowly).
    await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 0));
    await expect.poll(async () => (await snap(page)).time, { timeout: 30_000 }).toBeGreaterThan(4);
    expect((await snap(page)).enemies.length, `${arena.id}: newcomers`).toBeGreaterThan(start.enemies.length);
    await page.screenshot({ path: `artifacts/realtime-arena-${arena.n}.png` });
  }
  expect(errors).toEqual([]);
});

test('arenas 8–10: `?arena=8…10` opens the arena at once', async ({ page }) => {
  const errors = collectErrors(page);
  for (const arena of ARENAS) {
    await page.goto(`/realtime.html?sandbox=1&arena=${arena.n}`);
    await expect.poll(() => page.evaluate(() => (window as any).__realtime?.snapshot().arena)).toBe(arena.id);
    await expect(page.getByTestId('menu')).toBeHidden();
    await expect(page.getByTestId('goal')).toHaveText(arena.goal);
  }
  expect(errors).toEqual([]);
});
