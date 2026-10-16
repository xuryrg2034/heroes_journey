import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { leaveResult } from './realtimeResult';

/**
 * П10 «Личный рекорд» (src/realtime/view/chainRecord.ts, docs/realtime-slice.md, section 9): with real input at 1280×720 —
 * the fight result screen of a run says «Лучшая цепь боя N · похода M · рекорд R»; a new all-time or run record flashes
 * the line there (never in the fight); a reload keeps the run's best (the save) and the record (the viewer's storage); the
 * sandbox shows its old row and writes no record. Chains are drawn with the mouse over weak enemies laid in a free line
 * from the hero; the arena is won by the run hook `winArena`. Seeds 13 and 15 open with battle nodes only.
 */

const RECORD_KEY = 'ashen-oath-realtime-chain-record';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const runState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const stored = (page: Page): Promise<number | null> => page.evaluate(key => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw).best : null; }, RECORD_KEY);

/** A quiet arena: nobody walks or comes, the arena's own enemies gone. */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false; rt.params.dashSpeed = 5;
    rt.clear(false);
  });
}

/** A chain of `n` weak enemies drawn with the mouse along a free line from the hero; returns when the dash is over. */
async function drawChain(page: Page, n: number): Promise<void> {
  const start = (await snapshot(page)).hero as { x: number; y: number };
  for (const [ox, oy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0]]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (ox || oy) await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [start.x + ox, start.y + oy] as const);
    const hero = (await snapshot(page)).hero as { x: number; y: number };
    const points = Array.from({ length: n }, (_, i) => ({ x: hero.x + dx * 1.2 * (i + 1), y: hero.y + dy * 1.2 * (i + 1) }));
    for (const p of points) await page.evaluate(([x, y]) => (window as any).__realtime.place(x, y, 0, 0), [p.x, p.y] as const);
    const screens: { x: number; y: number }[] = [];
    for (const p of points) screens.push(await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [p.x, p.y] as const));
    await page.mouse.move(screens[0].x, screens[0].y);
    await page.mouse.down();
    for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
    if ((await snapshot(page)).chain.length === n) {
      await page.mouse.up();
      await expect.poll(async () => (await snapshot(page)).moving, { timeout: 8_000 }).toBeNull();
      return;
    }
    // A blocked line: cancel the short chain before the button goes up, clear and try another.
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).moving, { timeout: 8_000 }).toBeNull();
    await page.evaluate(() => (window as any).__realtime.clear(false));
  }
  throw new Error('no free line for the chain');
}

/** The first available battle node of the map is entered (no oath), its arena played: chains `chains`, then the door. */
async function fight(page: Page, chains: number[]): Promise<void> {
  const node = page.locator('[data-status="available"][data-type="battle"]').first();
  await node.click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await quiet(page);
  for (const n of chains) await drawChain(page, n);
  // The fight shows no record line (only the result screen does).
  await expect(page.getByTestId('result-chain')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  await expect(page.getByTestId('result')).toBeVisible();
}
/** From the result to the map (the die at the door — «Забрать»). */
async function toMap(page: Page): Promise<void> {
  await leaveResult(page);
  if (await page.getByTestId('run-die').isVisible()) await page.getByTestId('die-take').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
}
async function expectLine(page: Page, text: string, flash: 'record' | 'run' | null): Promise<void> {
  const line = page.getByTestId('result-chain');
  await expect(line).toHaveText(text);
  if (flash) {
    await expect(line).toHaveAttribute('data-flash', flash);
    await expect(line).toHaveClass(/rt-record-flash/);
  } else {
    await expect(line).not.toHaveAttribute('data-flash', /.*/);
    await expect(line).not.toHaveClass(/rt-record-flash/);
  }
  // The table has no second «Лучшая цепь» row in a run.
  await expect(page.locator('.rt-result-stats dt', { hasText: 'Лучшая цепь' })).toHaveCount(0);
}

test('the result line «Лучшая цепь боя · похода · рекорд» over two runs; the flash on a new record; a reload keeps them', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);

  // Run 1 (seed 13). Fight 1: the viewer's first fight — nothing to beat, no flash.
  await page.evaluate(() => (window as any).__realtime.run.newRun(13));
  await page.getByTestId('gift-1').click();
  await fight(page, [3]);
  await expectLine(page, 'Лучшая цепь боя 3 · похода 3 · рекорд 3', null);
  await toMap(page);
  // Fight 2: 5 beats the record 3 — the line flashes on the result screen.
  await fight(page, [2, 5]);
  await expectLine(page, 'Лучшая цепь боя 5 · похода 5 · рекорд 5', 'record');
  await page.screenshot({ path: 'artifacts/realtime-record-flash.png' });
  expect((await runState(page)).battles.map((b: any) => b.bestChain)).toEqual([3, 5]);
  expect(await stored(page)).toBe(5);
  // A reload: the run's best is in the save, the record in the viewer's storage.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  if (await page.getByTestId('run-die').isVisible()) await page.getByTestId('die-take').click();
  // Task 50: a row-2 fight left «Сноровка» open — after the reload it stands in the run's window; «Пропустить» goes on to the map.
  if (await page.getByTestId('knack-skip').isVisible()) await page.getByTestId('knack-skip').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  expect((await runState(page)).battles.map((b: any) => b.bestChain)).toEqual([3, 5]);
  expect(await stored(page)).toBe(5);
  // Fight 3: 4 — no flash; the run's best and the record stay 5.
  await fight(page, [4]);
  await expectLine(page, 'Лучшая цепь боя 4 · похода 5 · рекорд 5', null);
  await toMap(page);

  // Run 2 (seed 15). Fight 1: the first of the run, below the record — no flash.
  await page.evaluate(() => (window as any).__realtime.run.newRun(15));
  await page.getByTestId('gift-1').click();
  await fight(page, [2]);
  await expectLine(page, 'Лучшая цепь боя 2 · похода 2 · рекорд 5', null);
  await toMap(page);
  // Fight 2: 4 beats the run's 2, not the record — the run record flashes.
  await fight(page, [4]);
  await expectLine(page, 'Лучшая цепь боя 4 · похода 4 · рекорд 5', 'run');
  await page.screenshot({ path: 'artifacts/realtime-record-run.png' });
  expect(await stored(page)).toBe(5);
  expect(errors).toEqual([]);
});

test('the sandbox keeps its «Лучшая цепь» row and writes no record', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(key => { localStorage.clear(); localStorage.setItem(key, JSON.stringify({ version: 1, best: 2 })); }, RECORD_KEY);
  await page.goto('/?sandbox=1&arena=1');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.snapshot().menuOpen === false)).toBe(true);
  await quiet(page);
  await drawChain(page, 4);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await page.evaluate(() => { const rt = (window as any).__realtime, door = rt.snapshot().objects.find((o: any) => o.kind === 'door'); rt.teleport(door.x, door.y); });
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('result-chain')).toBeHidden();
  await expect(page.locator('.rt-result-stats')).toContainText('Лучшая цепь4 убийств');
  expect(await stored(page)).toBe(2);
  expect(errors).toEqual([]);
});
