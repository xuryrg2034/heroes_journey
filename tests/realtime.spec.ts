import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke test of the draft real-time prototype (realtime.html, docs/realtime-prototype.md).
 * Runs only through playwright.realtime.config.ts; the main game suite does not include it.
 */
interface Snapshot {
  status: 'playing' | 'defeat';
  time: number;
  hero: { x: number; y: number; hp: number; maxHp: number };
  enemies: { id: number; x: number; y: number; color: number; hp: number }[];
  markers: number;
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
  const tracked = first.enemies[0];
  const before = Math.hypot(tracked.x - first.hero.x, tracked.y - first.hero.y);
  expect(before).toBeGreaterThanOrEqual(1.9); // never appears right next to the hero
  await page.waitForTimeout(1000);
  const later = await snapshot(page);
  const moved = later.enemies.find(e => e.id === tracked.id)!;
  expect(Math.hypot(moved.x - tracked.x, moved.y - tracked.y)).toBeGreaterThan(0.3);
  expect(Math.hypot(moved.x - later.hero.x, moved.y - later.hero.y)).toBeLessThan(before);
  // Bodies do not pass through each other: a crowd keeps its circles apart.
  await page.evaluate(() => (window as any).__realtime.burst(30));
  await page.waitForTimeout(2500);
  const crowd = await snapshot(page);
  const radius = await page.evaluate(() => (window as any).__realtime.params.enemyRadius as number);
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
  await expect(page.getByTestId('debug-stats')).toContainText('Время жизни в куче');
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
