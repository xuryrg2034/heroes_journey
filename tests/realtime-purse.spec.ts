import { test, expect, type Page } from '@playwright/test';

/**
 * Casino «Котёл» (src/realtime/sim/purse.ts, docs/realtime-casino.md): the view with real mouse input in the sandbox — the
 * HUD line «котёл N» instead of «очки N», the forecast «≈ N» at the pointer in focus from 3 enemy links with «ещё 1 → ×жар»,
 * the caption «угли N · ×жар» under the power number during the dash and the cheque at the end («8 × 3 × ◆2 = 48»).
 */

async function open(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
}

/** Only the placed enemies, standing still (as `freeze` of realtime.spec.ts). */
async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false;
    rt.clear(false);
  });
}

const place = (page: Page, x: number, y: number, hp = 0): Promise<number> =>
  page.evaluate(([x, y, hp]) => (window as any).__realtime.place(x, y, 0, hp), [x, y, hp] as const);
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const purse = (page: Page): Promise<{ on: boolean; cauldron: number | null; forecast: string | null; shown: { captions: number; caption: string; cheques: string[] } }> =>
  page.evaluate(() => (window as any).__realtime.snapshot().purse);

test('the cauldron: «котёл N» in the HUD, the forecast at the pointer from 3 links, the caption under the power number, the cheque 8 × 3 × ◆2 = 48', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await freeze(page);
  // Off by default: the old score line.
  await expect(page.getByTestId('score')).toHaveText(/^очки \d+$/);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('purse', true); rt.params.dashSpeed = 5; rt.teleport(1, 9.2); });
  await expect(page.getByTestId('score')).toHaveText('котёл 0');
  // The sketch of the research (3.2): weak, weak, crystal, weak, weak, tough 4 HP at the end.
  await place(page, 2, 9.2); await place(page, 3, 9.2);
  await page.evaluate(() => (window as any).__realtime.placeCrystal(4, 9.2, 6));
  await place(page, 5, 9.2); await place(page, 6, 9.2); await place(page, 7, 9.2, 4);
  const points = [2, 3, 4, 5, 6, 7].map(x => ({ x, y: 9.2 }));
  const screens: { x: number; y: number }[] = [];
  for (const p of points) screens.push(await screen(page, p.x, p.y));
  await page.mouse.move(screens[0].x, screens[0].y);
  await page.mouse.down();
  for (const s of screens.slice(1, 3)) await page.mouse.move(s.x, s.y);
  // Two enemy links and the crystal: no forecast yet.
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().chain.length))).toBe(3);
  await expect(page.getByTestId('purse-forecast')).toBeHidden();
  // The third enemy link: 3 × 2 × ◆2 = 12, one more link would give the «добивание» (×3).
  await page.mouse.move(screens[3].x, screens[3].y);
  await expect(page.getByTestId('purse-forecast')).toHaveText('≈ 12 · ещё 1 → ×3');
  for (const s of screens.slice(4)) await page.mouse.move(s.x, s.y);
  // Five enemy links: 8 × 3 × ◆2 = 48; a 6th would be the next 3rd link (×4).
  await expect(page.getByTestId('purse-forecast')).toHaveText('≈ 48 · ещё 1 → ×4');
  await page.screenshot({ path: 'artifacts/realtime-purse-forecast.png' });
  await page.mouse.up();
  await expect(page.getByTestId('purse-forecast')).toBeHidden();
  // During the dash the caption under the power number grows with the links.
  await expect.poll(async () => (await purse(page)).shown.caption, { timeout: 8_000, intervals: [30] }).toMatch(/^угли \d+ · ×\d/);
  await page.screenshot({ path: 'artifacts/realtime-purse-caption.png' });
  await expect.poll(async () => (await purse(page)).shown.cheques, { timeout: 8_000, intervals: [30] }).toEqual(['8 × 3 × ◆2 = 48']);
  // The caption ends on the cheque's numbers (the last link and the «добивание» come in the tick the dash ends).
  expect((await purse(page)).shown.caption).toBe('угли 8 · ×3 · ◆2');
  await page.screenshot({ path: 'artifacts/realtime-purse-cheque.png' });
  const after = await purse(page);
  expect(after.cauldron).toBe(48);
  expect(after.shown.captions).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('score')).toHaveText('котёл 48');
  expect(errors).toEqual([]);
});

test('a run arena plays with the cauldron: the HUD shows «котёл N», the result shows the cauldron and the resources it pays', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await page.getByTestId('gift-1').click();
  await page.locator('[data-status="available"]').first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('score')).toHaveText(/^котёл \d+$/);
  expect((await purse(page)).on).toBe(true);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.snapshot().status), { timeout: 10_000 }).toBe('victory');
  const door = await page.evaluate(() => (window as any).__realtime.snapshot().purse.door) as { cauldron: number; oath: number; kinds: string[] };
  expect(door.oath).toBe(1);
  expect(door.kinds).toHaveLength(6);
  await expect(page.getByTestId('result')).toContainText('Котёл');
  await expect(page.getByTestId('result')).toContainText(`${door.cauldron} → ресурсов ${Math.min(3, Math.floor(door.cauldron / 40))}`);
  expect(errors).toEqual([]);
});
