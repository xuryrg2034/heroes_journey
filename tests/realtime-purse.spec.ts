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
  const door = await page.evaluate(() => (window as any).__realtime.snapshot().purse.door) as { cauldron: number; oath: number; kinds: string[]; rate: number; greed?: number };
  expect(door.oath).toBe(1);
  // The run's rate: 120 embers a resource (12.10.2026; the sandbox default stays 60).
  expect(door.rate).toBe(120);
  expect(door.kinds).toHaveLength(6);
  await expect(page.getByTestId('result')).toContainText('Котёл');
  await expect(page.getByTestId('result')).toContainText(`${door.cauldron} → ресурсов ${Math.min(3, Math.floor(door.cauldron * (door.greed ?? 1) / door.rate))}`);
  expect(errors).toEqual([]);
});

/** Draws a chain of weak enemies at `xs` (y 9.2) with the mouse from the hero at x 1 and lets the dash run until the cauldron grows. */
async function mouseChain(page: Page, xs: readonly number[]): Promise<void> {
  const before = (await purse(page)).cauldron ?? 0;
  await page.evaluate(() => (window as any).__realtime.teleport(1, 9.2));
  for (const x of xs) await place(page, x, 9.2);
  const screens: { x: number; y: number }[] = [];
  for (const x of xs) screens.push(await screen(page, x, 9.2));
  await page.mouse.move(screens[0].x, screens[0].y);
  await page.mouse.down();
  for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().chain.length))).toBe(xs.length);
  await page.mouse.up();
  await expect.poll(async () => (await purse(page)).cauldron ?? 0, { timeout: 8_000 }).toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime.snapshot().move), { timeout: 8_000 }).toBe(false);
}

test('П4 «Раздув за дела»: the panel toggle; after the goals the goal line shows the cauldron, its step and the next one; a hit takes a step off', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await freeze(page);
  // The sandbox: the debug panel's checkboxes (the cauldron and the rule).
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await page.locator('[data-param="purse"] input').check();
  await page.locator('[data-param="greedByDeeds"] input').check();
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeHidden();
  expect(await page.evaluate(() => { const p = (window as any).__realtime.params; return [p.purse, p.greedByDeeds]; })).toEqual([true, true]);
  await expect(page.getByTestId('goal')).not.toContainText('дверь открыта');
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await expect(page.getByTestId('goal')).toHaveText('дверь открыта · котёл 0 ×1 · ещё 2 цепи 3+ → ×1,5');
  // A chain of 3 enemy links (3 × 2 = 6) after the goals: one toward ×1,5.
  await mouseChain(page, [2, 3, 4]);
  await expect(page.getByTestId('goal')).toHaveText('дверь открыта · котёл 6 ×1 · ещё 1 цепь 3+ → ×1,5');
  await mouseChain(page, [2, 3, 4]);
  await expect(page.getByTestId('goal')).toHaveText('дверь открыта · котёл 12 ×1,5 · ещё 2 цепи 3+ → ×2');
  await expect(page.getByTestId('score')).toHaveText('котёл 12');
  await page.screenshot({ path: 'artifacts/realtime-greed-line.png' });
  // A touch: an enemy put on the hero hurts him — the step goes back to ×1.
  await page.evaluate(() => { const rt = (window as any).__realtime, h = rt.snapshot().hero; rt.place(h.x, h.y, 1, 0); });
  await expect(page.getByTestId('goal')).toHaveText('дверь открыта · котёл 12 ×1 · ещё 2 цепи 3+ → ×1,5', { timeout: 8_000 });
  await page.evaluate(() => (window as any).__realtime.clear(false));
  expect(errors).toEqual([]);
});

/** Draws a chain of weak enemies at `xs` (y 9.2) with the mouse from the hero at x 1 and waits for the dash to end. */
async function dashChain(page: Page, xs: readonly number[]): Promise<void> {
  await page.evaluate(() => (window as any).__realtime.teleport(1, 9.2));
  for (const x of xs) await place(page, x, 9.2);
  const screens: { x: number; y: number }[] = [];
  for (const x of xs) screens.push(await screen(page, x, 9.2));
  await page.mouse.move(screens[0].x, screens[0].y);
  await page.mouse.down();
  for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().chain.length))).toBe(xs.length);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.snapshot().lastChain?.kills ?? 0), { timeout: 8_000 }).toBe(xs.length);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime.snapshot().move), { timeout: 8_000 }).toBe(false);
}
const feel = (page: Page): Promise<{ popups: number; quiet: number; outlines: number; finals: number }> =>
  page.evaluate(() => (window as any).__realtime.snapshot().feel);

test('П2 «Тихая мелочь, громкая цепь»: a 2-link chain shows no pop-up over the hero, a 3-link chain does (with and without the cauldron)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await freeze(page);
  // The sandbox without the cauldron: the score «+N» over the hero only from 3 enemy links.
  await dashChain(page, [2, 3]);
  expect(await feel(page)).toMatchObject({ popups: 0, quiet: 1 });
  await expect(page.getByTestId('score')).toHaveText(/^очки [1-9]\d*$/);
  await dashChain(page, [2, 3, 4]);
  expect(await feel(page)).toMatchObject({ popups: 1, quiet: 1 });
  // The cauldron: a 2-link cheque goes only into the HUD line, a 3-link one pops up over the hero.
  await page.evaluate(() => (window as any).__realtime.setParam('purse', true));
  await dashChain(page, [2, 3]);
  await expect(page.getByTestId('score')).toHaveText('котёл 2');
  expect((await purse(page)).shown.cheques).toEqual([]);
  expect(await feel(page)).toMatchObject({ popups: 1, quiet: 2 });
  await dashChain(page, [2, 3, 4]);
  await expect.poll(async () => (await purse(page)).shown.cheques).toEqual(['3 × 2 = 6']);
  await expect(page.getByTestId('score')).toHaveText('котёл 8');
  expect(await feel(page)).toMatchObject({ popups: 2, quiet: 2 });
  // 6 links: the hero's outline flashes.
  await dashChain(page, [2, 3, 4, 5, 6, 7]);
  expect((await feel(page)).outlines).toBe(1);
  expect(errors).toEqual([]);
});

test('П3 «Финальная цепь»: a chain into the door shows «≈ N · дверь +1» from 1 link, the cheque «3 × 3 · дверь = 9», the final flash; the result screen ~0.8 s after the victory', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await freeze(page);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('purse', true); rt.setParam('doorFinale', true); rt.completeGoals(); });
  await expect(page.getByTestId('goal')).toContainText('дверь открыта');
  const door = await page.evaluate(() => (window as any).__realtime.snapshot().objects.find((o: { kind: string }) => o.kind === 'door')) as { x: number; y: number };
  // Enemies in a row from the door toward the middle of the arena, the hero beyond them.
  const dir = door.x > 8 ? -1 : 1, at = (i: number) => ({ x: door.x + dir * 1.4 * i, y: door.y });
  const drawTo = async (n: number): Promise<void> => {
    await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [at(n + 1).x, at(n + 1).y] as const);
    for (let i = n; i >= 1; i--) await place(page, at(i).x, at(i).y);
    const points = [...Array.from({ length: n }, (_, k) => at(n - k)), door];
    const screens: { x: number; y: number }[] = [];
    for (const p of points) screens.push(await screen(page, p.x, p.y));
    await page.mouse.move(screens[0].x, screens[0].y);
    await page.mouse.down();
    for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
    await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().chain.length))).toBe(n + 1);
  };
  // One weak enemy into the door: 1 × 2 (the door's +1 heat) — the forecast shows already at 1 link.
  await drawTo(1);
  await expect(page.getByTestId('purse-forecast')).toHaveText('≈ 2 · дверь +1');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.evaluate(() => (window as any).__realtime.clear(false));
  // Three weak enemies into the door: 3 × 3 = 9 (3rd link +1, the door +1).
  await drawTo(3);
  await expect(page.getByTestId('purse-forecast')).toHaveText('≈ 9 · дверь +1');
  // The result screen waits for the final flash: measured in the page from the victory's frame to the screen's frame.
  const timing = page.evaluate(() => new Promise<{ wait: number }>(resolve => {
    let won = 0;
    const step = (): void => {
      const s = (window as any).__realtime.snapshot(), el = document.querySelector('[data-testid="result"]') as HTMLElement | null;
      if (!won && s.status === 'victory') won = performance.now();
      if (won && el && !el.hidden) { resolve({ wait: performance.now() - won }); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
  await page.mouse.up();
  const { wait } = await timing;
  expect(wait).toBeGreaterThanOrEqual(700);
  expect(wait).toBeLessThan(3_000);
  expect((await purse(page)).shown.cheques).toEqual(['3 × 3 · дверь = 9']);
  expect((await feel(page)).finals).toBe(1);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await expect(page.getByTestId('result')).toContainText('Котёл');
  expect((await purse(page)).door.cauldron).toBe(9);
  expect(errors).toEqual([]);
});
