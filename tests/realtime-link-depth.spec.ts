import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { linkDepths } from '../src/realtime/sim/linkDepth';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * П1 «Глубина звена» (docs/realtime-prototype.md, «Глубина звена»): with real mouse input at 1280×720 — a held chain shows
 * a small number next to each next-link candidate whose path goes on (N ≥ 2), none at a candidate that would end the chain;
 * the numbers are those of the simulation (the page's journal replayed in Node); the toggle hides them and stays out of the
 * journal — the sandbox panel «Вид», and the gear of the run map. Runs through playwright.realtime.config.ts only; the
 * search itself is checked in Node (`npm run test:realtime-link-depth`).
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** Only what the test places acts: no newcomers, enemies stand, nothing hurts the hero (journalled param commands). */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5);
  });
}
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

/**
 * The scene: the first link A next to the hero; from it two candidates — B, which leads on through C and D (N 3), and F,
 * a tough red one the chain only wounds (N 1: no number). Blue bodies around, not candidates.
 */
async function scene(page: Page): Promise<{ a: number; b: number; f: number }> {
  const a = await place(page, 9.2, 5, 0, 0), b = await place(page, 10.4, 5, 0, 0);
  await place(page, 11.6, 5, 0, 0); await place(page, 12.8, 5, 0, 0);
  const f = await place(page, 9.2, 3.3, 0, 5);
  await place(page, 9.8, 6.4, 1, 0); await place(page, 7, 6.6, 1, 0);
  return { a, b, f };
}

/** Holds a chain on A with the mouse (down on it, a small move to show the pointer). */
async function holdOn(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 3, at.y + 2, { steps: 2 });
}

test('a held chain shows the depth next to the candidates (N ≥ 2 only, as the simulation counts); the panel toggle hides them, not the journal', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await quiet(page);
  const { a, b, f } = await scene(page);
  const atA = await screen(page, 9.2, 5);
  await holdOn(page, atA);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a]);
  await expect.poll(async () => (await snap(page)).linkDepth.labels).toEqual([{ id: b, depth: 3 }]);
  // F is a candidate (its ring is drawn) but it ends the chain: no number at it.
  const s = await snap(page);
  expect(s.linkDepth.on).toBe(true);
  expect(s.linkDepth.labels.some((l: any) => l.id === f)).toBe(false);
  // The numbers are the simulation's: the page's journal replayed in Node gives the same depths for this drawn chain.
  const journal = await page.evaluate(() => (window as any).__realtime.journal()) as Journal;
  const sim = replay(journal);
  expect(sim.world.chain.map(l => l.id)).toEqual([a]);
  expect(linkDepths(sim.world).map(d => ({ id: d.id, depth: d.depth })).sort((x, y) => x.id - y.id)).toEqual([{ id: b, depth: 3 }, { id: f, depth: 1 }].sort((x, y) => x.id - y.id));
  await page.screenshot({ path: 'artifacts/realtime-link-depth.png' });
  // Esc cancels the chain: the numbers go with it.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).linkDepth.labels).toEqual([]);
  // The panel toggle «Глубина звена» (view section) hides the numbers; no command reaches the journal.
  const commands = (): Promise<number> => page.evaluate(() => (window as any).__realtime.journal().commands.length);
  const before = await commands();
  await page.keyboard.press('F1');
  const toggle = page.getByTestId('link-depth');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(await commands()).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-link-depth'))).toBe('0');
  await page.keyboard.press('F1');
  await holdOn(page, atA);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a]);
  await page.waitForTimeout(300);
  expect((await snap(page)).linkDepth).toMatchObject({ on: false, labels: [] });
  await page.screenshot({ path: 'artifacts/realtime-link-depth-off.png' });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('run: the gear of the map holds «Глубина звена» (on by default); switched off there, the fight shows no numbers; the fight HUD has no gear', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  // The gear sits in the map header; its box lists the view settings.
  const gear = page.getByTestId('run-settings');
  await expect(gear).toBeVisible();
  await gear.click();
  const box = page.getByTestId('run-settings-panel');
  await expect(box).toBeVisible();
  const toggle = page.getByTestId('view-link-depth');
  await expect(toggle).toBeChecked();
  const at = await box.boundingBox();
  expect(at && at.x >= 0 && at.x + at.width <= 1280 && at.y >= 0 && at.y + at.height <= 720, `settings box ${JSON.stringify(at)}`).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-link-depth-gear.png' });
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-link-depth'))).toBe('0');
  // Into the first battle: no gear over the fight; a held chain draws no numbers.
  const node = page.locator('[data-status="available"]').first();
  await node.click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('run-settings')).toBeHidden();
  await quiet(page);
  const { a } = await scene(page);
  await holdOn(page, await screen(page, 9.2, 5));
  await expect.poll(async () => (await snap(page)).chain).toEqual([a]);
  await page.waitForTimeout(300);
  expect((await snap(page)).linkDepth).toMatchObject({ on: false, labels: [] });
  await page.mouse.up();
  expect(errors).toEqual([]);
});
