import { test, expect, type Page } from '@playwright/test';

/**
 * Casino stage 1: the view and the input of «Однорукий гоблин» in the sandbox (docs/realtime-casino.md): the panel button
 * «Гоблин» puts the idol near the hero (its marker first), a chain drawn with the mouse to the lever shows the odds line over
 * the idol, the release pulls the lever — the reels spin and stop, the result shows, the lever goes dark. Runs through
 * playwright.realtime.config.ts only. The rules themselves are checked in Node (src/realtime/sim/slot.spec.ts).
 */
interface SlotShown { idols: number; markers: number; spinning: number; stopped: number; dark: number; odds: number; oddsText: string; pulls: number; results: number; lastResult: string }
interface Snap { chain: number[]; chainLinks: { kind: string; id: number }[]; moving: string | null; slot: { goblin: { id: number; x: number; y: number; pulls: number; skulls: number[]; spinning: boolean } | null; shown: SlotShown; marks: number; flashes: number } }
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

test('the panel button «Гоблин», a mouse chain to the lever with the odds line, the reels spin and stop, the lever goes dark', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  // A quiet field: no newcomers, nobody walks or touches; the hero in the open middle.
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of Object.entries({ enemySpeed: 0, speedSpread: 0, baseIntervalMin: 20, baseIntervalMax: 20, baseFloor: 0, contactDamage: 0 })) rt.setParam(k, v);
    rt.clear(false);
    rt.teleport(8, 5);
  });
  expect(await page.evaluate(() => (window as any).__realtime.params.slot)).toBe(false);

  // The sandbox button: the toggle turns on, the goblin stands 3–7 from the hero, its marker first (the lever not a target).
  await page.keyboard.press('Backquote');
  await page.getByTestId('slot-goblin').click();
  await expect.poll(async () => (await snap(page)).slot.goblin !== null).toBe(true);
  expect(await page.evaluate(() => (window as any).__realtime.params.slot)).toBe(true);
  let s = await snap(page);
  const g = s.slot.goblin!;
  const d = Math.hypot(g.x - 8, g.y - 5);
  expect(d).toBeGreaterThanOrEqual(3 - 1e-6);
  expect(d).toBeLessThanOrEqual(7 + 1e-6);
  // The marker is drawn on the next frame (the view reads the world as it draws).
  await expect.poll(async () => (await snap(page)).slot.shown.markers, { timeout: 1_500 }).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-slot-marker.png' });
  await page.keyboard.press('Backquote');
  await expect.poll(async () => { const v = (await snap(page)).slot.shown; return v.markers === 0 && v.idols === 1 && v.dark === 0; }, { timeout: 5_000 }).toBe(true);

  // Two weak enemies on the line the hero saw the idol along, the hero behind them: a chain of 2 links and the lever.
  const ux = (8 - g.x) / d, uy = (5 - g.y) / d, step = Math.min(1.1, d / 3);
  const at = (k: number) => ({ x: g.x + ux * step * k, y: g.y + uy * step * k });
  const ids = await page.evaluate(([a, b, h]) => {
    const rt = (window as any).__realtime;
    rt.teleport(h.x, h.y);
    return [rt.place(b.x, b.y, 0, 0, 'basic'), rt.place(a.x, a.y, 0, 0, 'basic')];
  }, [at(1), at(2), at(3)] as const);
  await page.waitForTimeout(300);
  const first = await screen(page, at(2).x, at(2).y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([ids[0]]);
  const second = await screen(page, at(1).x, at(1).y);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
  // The chain can end on the lever now: the line over the idol (2 links take one skull off reel 1).
  await expect.poll(async () => (await snap(page)).slot.shown.odds).toBe(1);
  expect((await snap(page)).slot.shown.oddsText).toBe('дождь 2,2 % · залп 17,8 %');
  const leverAt = await screen(page, g.x, g.y);
  await page.mouse.move(leverAt.x, leverAt.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chainLinks.map(l => l.kind)).toEqual(['enemy', 'enemy', 'object']);
  s = await snap(page);
  expect(s.slot.shown.oddsText).toBe('дождь 2,2 % · залп 17,8 %');
  await page.screenshot({ path: 'artifacts/realtime-slot-odds.png' });
  await page.mouse.up();

  // The pull: the reels spin, then stop one by one; the result; the lever dark.
  await expect.poll(async () => (await snap(page)).slot.shown.spinning, { timeout: 5_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-slot-spin.png' });
  await expect.poll(async () => (await snap(page)).slot.shown.results, { timeout: 5_000 }).toBe(1);
  s = await snap(page);
  expect(s.slot.goblin!.pulls).toBe(1);
  expect(s.slot.shown.pulls).toBe(1);
  expect(s.slot.shown.dark).toBe(1);
  expect(s.slot.goblin!.skulls.reduce((a, b) => a + b, 0)).toBe(7);
  await page.screenshot({ path: 'artifacts/realtime-slot-result.png' });
  // The hint on the dark lever.
  await page.mouse.move(leverAt.x + 1, leverAt.y + 1);
  const hover = await screen(page, g.x, g.y);
  await page.mouse.move(hover.x, hover.y);
  await expect.poll(async () => page.evaluate(() => (window as any).__realtime.snapshot().hint)).toBe('lever');
  expect(errors).toEqual([]);
});
