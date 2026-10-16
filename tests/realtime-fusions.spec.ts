import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';

/**
 * Task 44 «Сплавы» in the sandbox (docs/realtime-prototype.md, section 9ц): «Ледяная печать» chosen in the panel's menu «Песочница:
 * талисман на старте арены», the arena restarted by the key R; a ring of four links drawn and closed with the real mouse round an
 * enemy — the release strikes it and it stays frozen 3 s and brittle (the plain «Печать» holds 1.5 s without ×2). The rules are
 * checked in Node (`npm run test:realtime-fusions`); this test looks at the real input and at the console.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

test('task 44: «Ледяная печать» from the sandbox menu — the ring closed by the mouse freezes the enemy inside for 3 s, brittle', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.getByTestId('open-panel').click();
  const menu = page.locator('label.rt-row', { hasText: 'Песочница: талисман на старте арены' }).locator('select');
  await expect(menu.locator('option', { hasText: 'Сплав: Ледяная печать' })).toHaveCount(1);
  await menu.selectOption('fusion-ice-seal');
  await page.locator('.rt-close').first().click();
  // The next arena takes it (the key R restarts the sandbox arena): the fusion with its parts in the kit.
  await page.locator('#rt-app canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snap(page)).kit?.talismans ?? []).toEqual(expect.arrayContaining(['fusion-ice-seal', 'form-seal', 'frost-edge']));
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['loopEnabled', false]] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5.5);
  });
  const corners = [await place(page, 9.2, 4.7, 0, 1), await place(page, 10.8, 4.7, 0, 1), await place(page, 10.8, 6.3, 0, 1), await place(page, 9.2, 6.3, 0, 1)];
  const inner = await place(page, 10, 5.5, 1, 3);
  const at = await Promise.all([[9.2, 4.7], [10.8, 4.7], [10.8, 6.3], [9.2, 6.3]].map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const k of [1, 2, 3]) await page.mouse.move(at[k].x, at[k].y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chain).toEqual(corners);
  // The pointer back on the first link closes the ring («Печать» from the fusion; the panel's loop toggle is off).
  await page.mouse.move(at[0].x, at[0].y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('first');
  await page.screenshot({ path: 'artifacts/realtime-fusion-ice-seal-closed.png' });
  await page.mouse.up();
  // The strike: the inner enemy loses 1 HP and freezes — 3 s (more than the plain seal's 1.5 s), brittle.
  await expect.poll(async () => (await snap(page)).enemies.find((e: any) => e.id === inner)?.hp, { timeout: 8000 }).toBe(2);
  const frozen = (await snap(page)).enemies.find((e: any) => e.id === inner);
  expect(frozen.brittle).toBe(true);
  expect(frozen.chill).toBeGreaterThan(1.5);
  await page.screenshot({ path: 'artifacts/realtime-fusion-ice-seal-frozen.png' });
  expect(errors).toEqual([]);
});
