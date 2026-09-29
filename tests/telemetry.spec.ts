import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const KEY = 'ashen-oath-playtest-v1';
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const journal = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY);
const center = (page: Page, index: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index);
async function settled(page: Page) {
  await expect.poll(async () => (await state(page)).phase, { timeout: 15_000 }).not.toMatch(/TITLE|RESOLVE|UPDATE/);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
async function hold(page: Page, path: number[]) {
  await page.locator('#board-host').scrollIntoViewIfNeeded();
  const first = await center(page, path[0]);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const index of path.slice(1)) { const point = await center(page, index); await page.mouse.move(point.x, point.y, { steps: 4 }); }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
}
async function draw(page: Page, path: number[]) { await hold(page, path); await page.mouse.up(); await settled(page); }

test('playtest journal records attempts, exports valid JSON and keeps the screen in sync', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#tutorial-begin-button').click(); await settled(page);
  // Attempt 1: a hesitation (Escape drops the chain), one real chain, then a retry.
  await hold(page, [8, 13]); await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).chain).toEqual([]);
  await page.mouse.up();
  await draw(page, [8, 13, 17]);
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="retry"]').click(); await settled(page);
  // Attempt 2: finish the battle.
  await draw(page, [9, 14, 19]); await draw(page, [13, 17, 11, 5, 10]);
  expect((await state(page)).phase).toBe('WIN');
  await page.locator('#modal [data-action="title"]').click();
  await expect(page.locator('#title-screen')).toBeVisible();
  const stored = await journal(page);
  expect(stored.enabled).toBe(true);
  expect(stored.attempts).toHaveLength(2);
  const [first, second] = stored.attempts;
  expect(first).toMatchObject({ key: 'tutorial:0', mode: 'tutorial', id: 'chain', index: 0, outcome: 'restart', chains: 1, chainMax: 3, cancelledChains: 1, attemptInVisit: 1 });
  expect(first.turns).toBe(1); expect(first.firstMoveMs).toBeGreaterThan(0); expect(first.hpEnd).toBeGreaterThan(0);
  expect(second).toMatchObject({ key: 'tutorial:0', outcome: 'win', chains: 2, attemptInVisit: 2, cancelledChains: 0, visit: first.visit });
  expect(second.durationMs).toBeGreaterThan(0);

  // The screen reads the same journal; export downloads valid JSON with aggregates.
  await page.locator('.playtest-link').click();
  await expect(page.locator('.playtest-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.playtest-table')).toContainText('Бой 1');
  await page.screenshot({ path: 'artifacts/playtest-screen.png' });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="playtest-download"]').click()]);
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).toMatchObject({ format: 'ashen-oath-playtest', version: 1, enabled: true });
  expect(exported.attempts).toHaveLength(2);
  expect(exported.aggregates[0]).toMatchObject({ key: 'tutorial:0', attempts: 2, wins: 1, attemptsToWin: 2, abandonRate: 0 });

  // Clearing needs an in-page confirmation (no window.confirm).
  page.on('dialog', dialog => { throw new Error(`unexpected dialog ${dialog.message()}`); });
  await page.locator('[data-action="playtest-clear"]').click();
  expect((await journal(page)).attempts).toHaveLength(2);
  await page.locator('[data-action="playtest-clear-no"]').click();
  expect((await journal(page)).attempts).toHaveLength(2);
  await page.locator('[data-action="playtest-clear"]').click();
  await page.locator('[data-action="playtest-clear-yes"]').click();
  expect((await journal(page)).attempts).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-layer')).toBeHidden();
  expect(errors).toEqual([]);
});

test('leaving mid-battle records a quit and the pause block opens the journal', async ({ page }) => {
  await page.goto('/');
  await page.locator('#tutorial-begin-button').click(); await settled(page);
  await draw(page, [8, 13, 17]);
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal .playtest-details summary').click();
  await page.locator('#modal [data-action="playtest"]').click();
  await expect(page.locator('#modal h2')).toHaveText('Плейтест');
  await page.locator('[data-action="playtest-close"]').click();
  await expect(page.locator('#modal [data-action="resume"]')).toBeVisible();
  await page.locator('#modal [data-action="title"]').click();
  const stored = await journal(page);
  expect(stored.attempts).toHaveLength(1);
  expect(stored.attempts[0]).toMatchObject({ outcome: 'quit', left: true, chains: 1, cancelledChains: 0 });
});

test('?telemetry=0 disables recording and persists the setting', async ({ page }) => {
  await page.goto('/?telemetry=0');
  await page.locator('#tutorial-begin-button').click(); await settled(page);
  await draw(page, [8, 13, 17]);
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="title"]').click();
  const stored = await journal(page);
  expect(stored.enabled).toBe(false); expect(stored.attempts).toEqual([]);
  // The setting survives a reload without the query.
  await page.goto('/');
  await page.locator('#tutorial-begin-button').click(); await settled(page);
  await draw(page, [8, 13, 17]);
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="title"]').click();
  expect((await journal(page)).attempts).toEqual([]);
});

test('closing the tab after a defeat counts as abandonment; a single-cell click is not a cancel', async ({ page }) => {
  await page.goto('/');
  await page.locator('#tutorial-begin-button').click(); await settled(page);
  // Single click on a neighbour: the release is invalid but it is inspection, not hesitation.
  const first = await center(page, 8);
  await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.up(); await settled(page);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.damagePlayer(99));
  await expect.poll(async () => (await state(page)).phase).toBe('LOSE');
  let stored = await journal(page);
  expect(stored.attempts).toHaveLength(1);
  expect(stored.attempts[0]).toMatchObject({ outcome: 'lose', left: false, cancelledChains: 0 });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  stored = await journal(page);
  expect(stored.attempts[0].left).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect((await journal(page)).attempts).toHaveLength(1);
  // The playtest link is only offered on the title screen.
  await expect(page.locator('.playtest-link')).toBeHidden();
});
