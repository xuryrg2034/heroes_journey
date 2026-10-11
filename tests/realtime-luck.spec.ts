import { test, expect, type Page } from '@playwright/test';

/**
 * П5 «Журнал удачи» (src/realtime/run/rtLuck.ts, src/realtime/view/runView.ts, docs/realtime-slice.md, section 9): with real
 * input at 1280×720 — a run fight of seed 10 (`r5c0`): a mouse chain of 2 weak enemies to the goblin's lever (the odds line
 * «дождь 2,2 % · залп 17,8 %»), a chain that fills the cauldron, the door; «Бросить» at the die; a reload; the next fight is
 * lost. The run-end screen has the block «Удача похода», collapsed; opened, it says the goblin's pull with the odds the lever
 * showed and what came, and the die's roll with what came; a reload keeps it (collapsed again). The goblin is put by the
 * journalled debug command (`summonGoblin`); the arena is won by the run hook `winArena`.
 */

const SEED = 10;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const runState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const ready = (page: Page): Promise<void> => expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);

/** A quiet arena: nobody walks or comes, the arena's own enemies gone. */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0; rt.params.contactDamage = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false; rt.params.dashSpeed = 5;
    rt.clear(false);
  });
}

/** The cauldron by a chain drawn with the mouse along a free line from the hero (weak, ◆, weak, ◆, weak, weak, tough 4 HP). */
async function fillCauldron(page: Page): Promise<void> {
  const spec = ['weak', 'crystal', 'weak', 'crystal', 'weak', 'weak', 'tough'] as const;
  const start = (await snapshot(page)).hero as { x: number; y: number };
  for (const [ox, oy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0]]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (ox || oy) await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [start.x + ox, start.y + oy] as const);
    const hero = (await snapshot(page)).hero as { x: number; y: number };
    const points = spec.map((_, i) => ({ x: hero.x + dx * 1.2 * (i + 1), y: hero.y + dy * 1.2 * (i + 1) }));
    for (const [i, kind] of spec.entries()) {
      const p = points[i];
      if (kind === 'crystal') await page.evaluate(([x, y]) => (window as any).__realtime.placeCrystal(x, y, 6), [p.x, p.y] as const);
      else await page.evaluate(([x, y, hp]) => (window as any).__realtime.place(x, y, 0, hp), [p.x, p.y, kind === 'tough' ? 4 : 0] as const);
    }
    const screens: { x: number; y: number }[] = [];
    for (const p of points) screens.push(await screen(page, p.x, p.y));
    await page.mouse.move(screens[0].x, screens[0].y);
    await page.mouse.down();
    for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
    if ((await snapshot(page)).chain.length === spec.length) {
      await page.mouse.up();
      await expect.poll(async () => (await snapshot(page)).moving, { timeout: 8_000 }).toBeNull();
      await expect.poll(async () => (await snapshot(page)).purse.cauldron, { timeout: 8_000 }).toBeGreaterThan(0);
      return;
    }
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).moving, { timeout: 8_000 }).toBeNull();
    await page.evaluate(() => (window as any).__realtime.clear(false));
  }
  throw new Error('no free line for the chain');
}

/** The goblin near the hero; a mouse chain of two weak enemies to its lever pulls it; returns the odds line the lever showed. */
async function pullLever(page: Page): Promise<string> {
  const hero = (await snapshot(page)).hero as { x: number; y: number };
  expect(await page.evaluate(() => (window as any).__realtime.summonGoblin())).toBe(true);
  const g = (await snapshot(page)).slot.goblin as { x: number; y: number };
  // The marker runs out (the lever is no target meanwhile).
  await expect.poll(async () => { const v = (await snapshot(page)).slot.shown; return v.markers === 0 && v.idols === 1 && v.dark === 0; }, { timeout: 8_000 }).toBe(true);
  const d = Math.hypot(g.x - hero.x, g.y - hero.y), ux = (hero.x - g.x) / d, uy = (hero.y - g.y) / d, step = Math.min(1.1, d / 3);
  const at = (k: number) => ({ x: g.x + ux * step * k, y: g.y + uy * step * k });
  await page.evaluate(([a, b, h]) => { const rt = (window as any).__realtime; rt.teleport(h.x, h.y); rt.place(b.x, b.y, 0, 0, 'basic'); rt.place(a.x, a.y, 0, 0, 'basic'); }, [at(1), at(2), at(3)] as const);
  await page.waitForTimeout(300);
  const first = await screen(page, at(2).x, at(2).y), second = await screen(page, at(1).x, at(1).y), lever = await screen(page, g.x, g.y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await page.mouse.move(lever.x, lever.y, { steps: 4 });
  await expect.poll(async () => (await snapshot(page)).chainLinks.map((l: any) => l.kind)).toEqual(['enemy', 'enemy', 'object']);
  const odds = (await snapshot(page)).slot.shown.oddsText as string;
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).slot.shown.results, { timeout: 8_000 }).toBe(1);
  return odds;
}

test('the run-end block «Удача похода»: collapsed; the goblin\'s pull with the odds the lever showed, the die\'s roll; a reload keeps it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.teleport(8, 5));

  // The goblin: 2 links take one skull off reel 1 — the lever showed «дождь 2,2 % · залп 17,8 %».
  const odds = await pullLever(page);
  expect(odds).toBe('дождь 2,2 % · залп 17,8 %');
  await page.evaluate(() => (window as any).__realtime.clear(false));
  await fillCauldron(page);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  const won = await runState(page);
  const pullOutcome = { rain: won.luck['slot-rain'].hits as number, volley: won.luck['slot-volley'].hits as number };
  expect(won.luck['slot-rain'].tries).toBe(1);
  await page.getByTestId('result-map').click();
  // The die: «Бросить», a click skips the roll; the face is the one the run fixed.
  await expect(page.getByTestId('run-die')).toBeVisible();
  const face = (await runState(page)).pending.face as number;
  await page.getByTestId('die-roll').click();
  await page.getByTestId('run-die-roll').click();
  await expect(page.getByTestId('die-face')).toHaveAttribute('data-face', String(face));
  await page.getByTestId('die-close').click();

  // A reload, then the next fight is lost (a ring of enemies around the standing hero).
  await page.reload();
  await ready(page);
  await page.getByTestId('node-r6c1').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();

  // The block: collapsed by default; opened — the goblin (hand-counted: 1/45 → «0», 8/45 → «0,2») and the die (½ → «0,5»).
  const block = page.getByTestId('run-luck');
  await expect(block).toBeVisible();
  await expect(block).not.toHaveAttribute('open', /.*/);
  await expect(page.getByTestId('luck-slot')).toBeHidden();
  await page.screenshot({ path: 'artifacts/realtime-luck-collapsed.png' });
  await page.getByTestId('run-luck-toggle').click();
  await expect(block).toHaveAttribute('open', '');
  const goblin = `Гоблин: 1 рывок · на рычаге в среднем ${odds} · выпало: дождь ${pullOutcome.rain} (ожидание 0), залп ${pullOutcome.volley} (ожидание 0,2)`;
  const die = `Кость у двери: 1 бросок · 4–6 выпало ${face >= 4 ? 1 : 0} (ожидание 0,5)`;
  await expect(page.getByTestId('luck-slot')).toHaveText(goblin);
  await expect(page.getByTestId('luck-die')).toHaveText(die);
  await page.screenshot({ path: 'artifacts/realtime-luck-open.png' });

  // A reload: the end screen again, the block collapsed, the same contents.
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.getByTestId('run-luck')).not.toHaveAttribute('open', /.*/);
  await page.getByTestId('run-luck-toggle').click();
  await expect(page.getByTestId('luck-slot')).toHaveText(goblin);
  await expect(page.getByTestId('luck-die')).toHaveText(die);
  expect(errors).toEqual([]);
});

test('a run without chance: the block says so', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready(page);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 13);
  await page.getByTestId('gift-1').click();
  await page.locator('[data-status="available"][data-type="battle"]').first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.getByTestId('result-map').click();
  await page.getByTestId('run-luck-toggle').click();
  await expect(page.getByTestId('luck-none')).toHaveText('В этом походе случая не было.');
  expect(errors).toEqual([]);
});
