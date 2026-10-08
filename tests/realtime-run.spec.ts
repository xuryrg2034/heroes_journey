import { test, expect, type Page } from '@playwright/test';

/**
 * The run of the real-time game in the browser (stage 2, step 1; docs/realtime-slice.md). Runs through
 * playwright.realtime.config.ts only. The page (realtime.html) opens on the run; the arena is won through the test hook
 * `__realtime.run.winArena` (the goals done and the hero put on the open door by journalled commands — the door's own
 * rule lets him in) and lost by a ring of enemies placed around the hero.
 */
interface RunState {
  seed: number; hp: number; maxHp: number; visited: string[]; currentNodeId: string | null;
  pending: { kind: string; nodeId?: string; arena?: string; seed?: number } | null; result: { outcome: string } | null;
}
const runState = (page: Page): Promise<RunState> => page.evaluate(() => (window as any).__realtime.run.state());
const snapshot = (page: Page) => page.evaluate(() => (window as any).__realtime.snapshot() as { seed: number; arena: string; time: number; status: string; hero: { x: number; y: number; hp: number; maxHp: number } });

async function openRun(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run')).toBeVisible();
}

/** A new run from the start screen; the start gift takes its first button that is on (a first run: the mini gift, +3 max HP). */
async function newRun(page: Page): Promise<RunState> {
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await page.locator('[data-action="gift"]:not([disabled])').first().click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  return runState(page);
}

/** Clicks the first available node of the map and enters it; returns its id. */
async function enterFirstNode(page: Page): Promise<string> {
  const node = page.locator('[data-status="available"]').first();
  const id = await node.getAttribute('data-node');
  await node.click();
  await page.getByTestId('run-enter').click();
  return id!;
}

test('run: a battle node starts its arena with the run HP, a reload starts it again, a victory returns to the map, a reload keeps the run', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  const start = await newRun(page);
  expect(start.visited).toEqual([]);
  expect(start.hp).toBe(15);
  expect(start.maxHp).toBe(15);
  await expect(page.locator('[data-status="available"]')).not.toHaveCount(0);
  // Row 5 holds battles only: the first node starts an arena.
  const nodeId = await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  const entered = await runState(page);
  expect(entered.pending?.kind).toBe('battle');
  expect(entered.pending?.nodeId).toBe(nodeId);
  let snap = await snapshot(page);
  expect(snap.seed).toBe(entered.pending!.seed);
  expect(snap.arena).toBe(entered.pending!.arena);
  expect(snap.hero.hp).toBe(15);
  expect(snap.hero.maxHp).toBe(15);
  await expect.poll(async () => (await snapshot(page)).time, { timeout: 10_000 }).toBeGreaterThan(1);

  // A reload in the middle of the arena: the open battle node waits, its arena starts again from the start.
  await page.reload();
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  snap = await snapshot(page);
  expect(snap.seed).toBe(entered.pending!.seed);
  expect(snap.time).toBeLessThan(1);

  // Victory: the test hook opens the door and puts the hero on it; the next tick walks him in.
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  const won = await snapshot(page);
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId(`node-${nodeId}`)).toHaveAttribute('data-status', 'current');
  const after = await runState(page);
  expect(after.visited).toEqual([nodeId]);
  expect(after.pending).toBeNull();
  expect(after.hp).toBe(won.hero.hp);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('ashen-oath-rt-run-v1');
  expect(keys).not.toContain('ashen-oath-forest-run-v1');
  expect(keys).not.toContain('ashen-oath-profile-v1');

  // A reload keeps the run on the map.
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId(`node-${nodeId}`)).toHaveAttribute('data-status', 'current');
  expect(await runState(page)).toEqual(after);
  await expect(page.locator('[data-status="available"]')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('run: a lost arena ends the run, and the end survives a reload', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  // A ring of tough enemies around the standing hero: contact damage takes the run's HP.
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  expect((await runState(page)).result?.outcome).toBe('defeat');
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.locator('[data-status="available"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('run: the arena counts when it ends — a reload on «Поражение» ends the run, a reload on «Победа» keeps the victory', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  // Victory: reload on the result screen, before «К карте».
  const won = await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  const hp = (await snapshot(page)).hero.hp;
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId('run-battle-modal')).toHaveCount(0);
  await expect(page.getByTestId(`node-${won}`)).toHaveAttribute('data-status', 'current');
  const after = await runState(page);
  expect(after.visited).toEqual([won]);
  expect(after.pending).toBeNull();
  expect(after.hp).toBe(hp);
  // Defeat: walk on to the next arena node and reload on «Поражение».
  for (let step = 0; step < 8; step++) {
    const state = await runState(page);
    if (state.pending?.kind === 'battle') break;
    if (state.pending) {
      // A node screen of the trails: take its first button that is on (a rest, a find, an event, the merchant's «Уйти»).
      const leave = page.locator('[data-testid="find-leave"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first();
      await leave.click();
      continue;
    }
    await enterFirstNode(page);
  }
  expect((await runState(page)).pending?.kind).toBe('battle');
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.getByTestId('run-battle-modal')).toHaveCount(0);
  expect((await runState(page)).result?.outcome).toBe('defeat');
  expect(errors).toEqual([]);
});

test('the sandbox keeps the prototype: ?sandbox=1 opens the arena menu and the debug panel, without the run', async ({ page }) => {
  await page.goto('/realtime.html?sandbox=1');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('open-panel')).toBeVisible();
  await expect(page.getByTestId('run')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__realtime.run)).toBeNull();
});

test('the sandbox opens by the anchor too: the run screen links to #sandbox, the link boots the sandbox (a published build keeps no query)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/realtime.html');
  await expect(page.getByTestId('run-new')).toBeVisible();
  await page.locator('a[href="#sandbox"]').first().click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('open-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.run)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.run)).toBeNull();
  expect(errors).toEqual([]);
});
