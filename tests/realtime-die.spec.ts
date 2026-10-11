import { test, expect, type Page } from '@playwright/test';

/**
 * Casino stage 1, item 4 — «Кость у двери» (src/realtime/run/rtRun.ts, src/realtime/view/runView.ts, docs/realtime-casino.md):
 * the run with real input. A row 1 arena of seed 10 (`r5c0`): a chain drawn with the mouse fills the cauldron (weak, ◆,
 * weak, ◆, weak, weak, tough 4 HP: 8 × 3 × ◆4 = 96), the hero walks into the door (the run hook `winArena`); the result
 * leads to the die; the die screen shows the cauldron, what «Забрать» pays and the odds «1–3 ×0,5 · 4–6 ×2»; a reload shows
 * the same screen and the same fixed face; «Бросить» rolls the die, a click skips the animation, the face is the fixed one
 * and the run's resources grow by what the screen said.
 */

const SEED = 10;

async function openRun(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}
const runState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const total = (materials: Record<string, number>): number => Object.values(materials).reduce((a, b) => a + b, 0);
const word = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'ресурс' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'ресурса' : 'ресурсов');

/** The cauldron by a chain drawn with the mouse along a free line from the hero (only the placed links, standing still). */
async function fillCauldron(page: Page): Promise<number> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false; rt.params.dashSpeed = 5;
    rt.clear(false);
  });
  const spec = ['weak', 'crystal', 'weak', 'crystal', 'weak', 'weak', 'tough'] as const;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const hero = (await snapshot(page)).hero as { x: number; y: number };
    const points = spec.map((_, i) => ({ x: hero.x + dx * 1.2 * (i + 1), y: hero.y + dy * 1.2 * (i + 1) }));
    for (const [i, kind] of spec.entries()) {
      const p = points[i];
      if (kind === 'crystal') await page.evaluate(([x, y]) => (window as any).__realtime.placeCrystal(x, y, 6), [p.x, p.y] as const);
      else await page.evaluate(([x, y, hp]) => (window as any).__realtime.place(x, y, 0, hp), [p.x, p.y, kind === 'tough' ? 4 : 0] as const);
    }
    const screens: { x: number; y: number }[] = [];
    for (const p of points) screens.push(await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [p.x, p.y] as const));
    await page.mouse.move(screens[0].x, screens[0].y);
    await page.mouse.down();
    for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
    const links = (await snapshot(page)).chain.length;
    await page.mouse.up();
    if (links === spec.length) {
      await expect.poll(async () => (await snapshot(page)).moving, { timeout: 8_000 }).toBeNull();
      await expect.poll(async () => (await snapshot(page)).purse.cauldron, { timeout: 8_000 }).toBeGreaterThan(0);
      return (await snapshot(page)).purse.cauldron as number;
    }
    // A blocked line (a tree, water): clear it and try another direction.
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__realtime.clear(false));
  }
  throw new Error('no free line for the chain');
}

test('the die at the door: the screen after a won arena with a cauldron, the odds, a reload keeps the face, «Бросить» — a click skips the roll, the resources come', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();

  const cauldron = await fillCauldron(page);
  expect(cauldron).toBe(96);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  // The result leads to the die (the cauldron row says what «Забрать» pays before the die).
  await expect(page.getByTestId('result')).toContainText(`${cauldron} → ресурсов 1 (до кости)`);
  await expect(page.getByTestId('result-map')).toHaveText('К кости у двери (Enter)');
  const before = await runState(page);
  expect(before.pending.kind).toBe('die');
  const face = before.pending.face as number;
  await page.getByTestId('result-map').click();

  // The die screen: the cauldron, what «Забрать» pays, the odds and what each half pays.
  await expect(page.getByTestId('run-die')).toBeVisible();
  await expect(page.getByTestId('die-cauldron')).toHaveText('Котёл 96 → 1 ресурс.');
  await expect(page.getByTestId('die-odds')).toHaveText('Бросить кость: 1–3 ×0,5 · 4–6 ×2');
  await expect(page.getByTestId('die-roll')).toContainText('1–3: 0 ресурсов · 4–6: 3 ресурса');
  await expect(page.getByTestId('die-take')).toContainText('Забрать');
  await page.screenshot({ path: 'artifacts/realtime-die-screen.png' });

  // A reload: the same screen, the same face (nothing re-rolled, nothing paid).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run-die')).toBeVisible();
  const reloaded = await runState(page);
  expect(reloaded.pending).toEqual(before.pending);
  expect(reloaded.materials).toEqual(before.materials);

  // «Бросить»: the die rolls; a click skips the animation; the face is the fixed one.
  await page.getByTestId('die-roll').click();
  await expect(page.getByTestId('run-die-roll')).toBeVisible();
  await expect(page.getByTestId('run-die-roll')).toHaveAttribute('data-landed', 'false');
  await page.screenshot({ path: 'artifacts/realtime-die-rolling.png' });
  await page.getByTestId('run-die-roll').click();
  await expect(page.getByTestId('run-die-roll')).toHaveAttribute('data-landed', 'true');
  await expect(page.getByTestId('die-face')).toHaveAttribute('data-face', String(face));
  const paid = face <= 3 ? 0 : 3;
  await expect(page.getByTestId('die-result')).toContainText(`Выпало ${face}: ${face <= 3 ? '×0,5' : '×2'} → ${paid} ${word(paid)}`);
  await page.screenshot({ path: 'artifacts/realtime-die-result.png' });
  const after = await runState(page);
  expect(after.pending).toBeNull();
  expect(total(after.materials) - total(before.materials)).toBe(paid);
  await page.getByTestId('die-close').click();
  await expect(page.getByTestId('run-die-roll')).toHaveCount(0);
  // The run's header shows the resources; the map goes on.
  for (const [kind, n] of Object.entries(after.materials as Record<string, number>)) expect(n).toBeGreaterThanOrEqual(before.materials[kind]);
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.locator('[data-status="available"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('the die at the door: «Забрать» pays the cauldron as it is, no roll; a cauldron of 0 shows no die', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  // A cauldron of 0: straight to the map.
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => (window as any).__realtime.clear(false));
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  expect((await snapshot(page)).purse.door.cauldron).toBe(0);
  await expect(page.getByTestId('result-map')).toHaveText('К карте (Enter)');
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-die')).toHaveCount(0);
  expect((await runState(page)).pending).toBeNull();
  // The next battle with a cauldron: «Забрать».
  await page.locator('[data-status="available"][data-type="battle"]').first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const cauldron = await fillCauldron(page);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  const before = await runState(page);
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-die')).toBeVisible();
  const take = Math.min(3, Math.floor(cauldron / 60));
  await expect(page.getByTestId('die-cauldron')).toHaveText(`Котёл ${cauldron} → ${take} ${word(take)}.`);
  await page.getByTestId('die-take').click();
  await expect(page.getByTestId('run-die')).toHaveCount(0);
  await expect(page.getByTestId('run-die-roll')).toHaveCount(0);
  const after = await runState(page);
  expect(total(after.materials) - total(before.materials)).toBe(take);
  expect(errors).toEqual([]);
});
