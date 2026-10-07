import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke test of the draft real-time prototype (realtime.html, docs/realtime-prototype.md).
 * Runs only through playwright.realtime.config.ts; the main game suite does not include it.
 */
interface Snapshot {
  status: 'playing' | 'defeat';
  time: number;
  hero: { x: number; y: number; hp: number; maxHp: number };
  enemies: { id: number; kind: string; x: number; y: number; color: number; hp: number; fast: boolean }[];
  markers: number;
  queue: number;
  stage: 'goals' | 'greed';
  phaseIndex: number;
  panelOpen: boolean;
}

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

async function open(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

test('realtime page opens, the horde arrives from the edges and walks to the hero', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  // A warning marker comes first, then the enemy steps out of it.
  await expect.poll(async () => (await snapshot(page)).enemies.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const first = await snapshot(page);
  const forbidden = await page.evaluate(() => (window as any).__realtime.params.spawnMinDistance as number);
  const distances = (snap: Snapshot, ids: number[]) => ids.map(id => snap.enemies.find(e => e.id === id)!).map(e => Math.hypot(e.x - snap.hero.x, e.y - snap.hero.y));
  const ids = first.enemies.map(e => e.id);
  const before = distances(first, ids);
  // Never appears inside the forbidden radius around the hero (small slack for the first step).
  for (const d of before) expect(d).toBeGreaterThanOrEqual(forbidden - 0.2);
  await page.waitForTimeout(1500);
  const after = distances(await snapshot(page), ids);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // Straight at the hero: obstacles may block single enemies, the group as a whole closes in.
  expect(mean(after)).toBeLessThan(mean(before) - 0.5);
  // Bodies do not pass through each other: a crowd keeps its circles apart.
  await page.evaluate(() => (window as any).__realtime.burst(30));
  await page.waitForTimeout(2500);
  const crowd = await snapshot(page);
  const radius = await page.evaluate(() => (window as any).__realtime.params.bodyRadius as number);
  let closest = Infinity;
  for (let i = 0; i < crowd.enemies.length; i++) for (let j = i + 1; j < crowd.enemies.length; j++) {
    const a = crowd.enemies[i], b = crowd.enemies[j];
    closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
  }
  expect(closest).toBeGreaterThan(radius * 2 * 0.7);
  // Touching enemies hurt the standing hero.
  await expect.poll(async () => (await snapshot(page)).hero.hp, { timeout: 15_000 }).toBeLessThan(crowd.hero.maxHp);
  expect(errors).toEqual([]);
});

test('debug panel toggles by key and button, stores values and the defeat screen restarts', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const panel = page.getByTestId('debug-panel');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('debug-stats')).toContainText('FPS');
  await expect(page.getByTestId('debug-stats')).toContainText('В куче до смерти: по доле HP');
  await page.keyboard.press('F1');
  await expect(panel).toBeHidden();
  await page.getByTestId('open-panel').click();
  await expect(panel).toBeVisible();

  // A slider changes the live value and survives a reload.
  await page.locator('[data-param="heroHp"] input').fill('2');
  await expect(page.locator('[data-param="heroHp"] output')).toHaveText('2');
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.params.heroHp)).toBe(2);
  await expect(panel).toBeVisible();

  // With 2 HP the crowd kills the standing hero: defeat screen, then restart.
  await page.getByTestId('restart').click();
  await page.getByTestId('burst').click();
  await expect(page.getByTestId('defeat')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('defeat')).toContainText('Поражение');
  await page.getByTestId('defeat-restart').click();
  await expect(page.getByTestId('defeat')).toBeHidden();
  const fresh = await snapshot(page);
  expect(fresh.status).toBe('playing');
  expect(fresh.hero.hp).toBe(2);

  await page.getByTestId('reset-params').click();
  await expect(page.locator('[data-param="heroHp"] output')).toHaveText('12');
  expect((await snapshot(page)).hero.hp).toBe(12);
  expect(errors).toEqual([]);
});

test('before the goals the pace stays base; the goals button starts the greed table, the limit queues newcomers', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.keyboard.press('Backquote');
  // A low arena limit: the first greed phase wants a density floor above it.
  await page.locator('[data-param="maxEnemies"] input').fill('4');
  await page.getByTestId('restart').click();
  await page.waitForTimeout(1500);
  let snap = await snapshot(page);
  expect(snap.stage).toBe('goals');
  expect(snap.phaseIndex).toBe(-1);
  await expect(page.getByTestId('debug-stats')).toContainText('до целей');

  await page.getByTestId('complete-goals').click();
  await expect(page.getByTestId('complete-goals')).toBeDisabled();
  await expect.poll(async () => (await snapshot(page)).stage).toBe('greed');
  await expect(page.getByTestId('debug-stats')).toContainText('фаза 1/');
  await expect(page.locator('[data-testid="phase-table"] tr.rt-current')).toHaveCount(1);
  // Floor of phase 1 (6) is above the limit (4): the arena never exceeds the limit, the rest waits in the queue.
  await expect.poll(async () => (await snapshot(page)).queue, { timeout: 5_000 }).toBeGreaterThan(0);
  snap = await snapshot(page);
  expect(snap.enemies.length + snap.markers).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});
