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

// ---- Stage 2: chain, focus, dash ----

interface ChainSnapshot extends Snapshot {
  chain: number[];
  moving: 'dash' | 'jump' | null;
  focus: number;
  focusing: boolean;
  energy: number;
  kills: number;
}

const chainSnapshot = (page: Page): Promise<ChainSnapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

/** A still arena: enemies stand where they are put, no newcomers walk in. */
async function stillArena(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.fastSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000;
    rt.clear();
  });
}

const place = (page: Page, x: number, y: number, color: number, hp = 0): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp), [x, y, color, hp] as const);

const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

test('a chain drawn with the mouse over two enemies of one color kills both and moves the hero', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await stillArena(page);
  const start = await chainSnapshot(page);
  const { x: hx, y: hy } = start.hero;
  const a = await place(page, hx + 1, hy, 0);
  const b = await place(page, hx + 2.2, hy, 0);
  // A different color next to the first link cannot join the chain.
  const other = await place(page, hx + 1.6, hy + 0.9, 1);
  const pa = await screen(page, hx + 1, hy), pb = await screen(page, hx + 2.2, hy), po = await screen(page, hx + 1.6, hy + 0.9);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.mouse.move(po.x, po.y, { steps: 4 });
  expect((await chainSnapshot(page)).chain).toEqual([a]);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a, b]);
  await page.screenshot({ path: 'artifacts/realtime-chain.png' });
  await page.mouse.up();
  await expect.poll(async () => (await chainSnapshot(page)).kills, { timeout: 5_000 }).toBe(2);
  const after = await chainSnapshot(page);
  expect(after.enemies.map(e => e.id)).not.toContain(a);
  expect(after.enemies.map(e => e.id)).not.toContain(b);
  expect(after.enemies.map(e => e.id)).toContain(other);
  // The hero stops on the last killed link; two attacked enemies give 2 × 0.5 energy.
  await expect.poll(async () => (await chainSnapshot(page)).moving).toBeNull();
  const end = await chainSnapshot(page);
  expect(Math.hypot(end.hero.x - (hx + 2.2), end.hero.y - hy)).toBeLessThan(0.05);
  expect(end.energy).toBeCloseTo(1, 5);
  expect(errors).toEqual([]);
});

test('a tough link spends the power; a survivor stays and the hero returns to the previous spot', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await stillArena(page);
  const { x: hx, y: hy } = (await chainSnapshot(page)).hero;
  const a = await place(page, hx + 1, hy, 2);
  const tough = await place(page, hx + 2.2, hy, 2, 2);
  const pa = await screen(page, hx + 1, hy), pt = await screen(page, hx + 2.2, hy);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(pt.x, pt.y, { steps: 6 });
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a, tough]);
  await page.mouse.up();
  // Power: 1 after the weak one (0 HP), +1 = 2 at the tough one with 2 HP — it dies.
  await expect.poll(async () => (await chainSnapshot(page)).kills, { timeout: 5_000 }).toBe(2);
  await expect.poll(async () => (await chainSnapshot(page)).moving).toBeNull();

  // A single tough enemy with 2 HP: power 1 wounds it to 1 HP; the hero comes back to where it stood.
  const here = (await chainSnapshot(page)).hero;
  const lone = await place(page, here.x - 1.2, here.y, 3, 2);
  const pl = await screen(page, here.x - 1.2, here.y);
  await page.mouse.move(pl.x, pl.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await chainSnapshot(page)).enemies.find(e => e.id === lone)?.hp, { timeout: 5_000 }).toBe(1);
  await expect.poll(async () => (await chainSnapshot(page)).moving).toBeNull();
  const end = await chainSnapshot(page);
  expect(end.kills).toBe(2);
  expect(Math.hypot(end.hero.x - here.x, end.hero.y - here.y)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test('Esc and the mouse back on the hero cancel the chain; focus slows the world while a chain is held', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await stillArena(page);
  const { x: hx, y: hy } = (await chainSnapshot(page)).hero;
  const a = await place(page, hx, hy + 1.1, 1);
  const pa = await screen(page, hx, hy + 1.1), ph = await screen(page, hx, hy);

  // Esc cancels: releasing afterwards strikes nobody.
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.keyboard.press('Escape');
  expect((await chainSnapshot(page)).chain).toEqual([]);
  await page.mouse.up();
  await page.waitForTimeout(300);
  let snap = await chainSnapshot(page);
  expect(snap.kills).toBe(0);
  expect(snap.enemies.map(e => e.id)).toContain(a);
  expect(Math.hypot(snap.hero.x - hx, snap.hero.y - hy)).toBeLessThan(0.01);

  // The mouse back on the hero cancels too.
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.mouse.move(ph.x, ph.y, { steps: 5 });
  expect((await chainSnapshot(page)).chain).toEqual([]);
  await page.mouse.up();

  // Focus: world time runs at about a quarter of real time while the chain is held.
  const rate = () => page.evaluate(async () => {
    const rt = (window as any).__realtime;
    const t0 = rt.snapshot().time, r0 = performance.now();
    await new Promise(resolve => setTimeout(resolve, 600));
    return (rt.snapshot().time - t0) / ((performance.now() - r0) / 1000);
  });
  const normal = await rate();
  expect(normal).toBeGreaterThan(0.6);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).focusing).toBe(true);
  const slowed = await rate();
  expect(slowed).toBeLessThan(normal * 0.5);
  snap = await chainSnapshot(page);
  expect(snap.focus).toBeLessThan(3);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(errors).toEqual([]);
});
