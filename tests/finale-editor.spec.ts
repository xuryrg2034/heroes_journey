import { expect, test, type Page } from '@playwright/test';

async function exported(page: Page) {
  await page.locator('[data-editor="export"]').click();
  return JSON.parse(await page.locator('#editor-json').inputValue());
}

test('editor authors, imports and opens a fight with jailer and beacon', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#editor-button').click();

  await page.locator('#editor-enemy-kind').selectOption('jailer');
  await expect(page.locator('#editor-enemy-hp')).toHaveValue('12');
  await expect(page.locator('#editor-color')).toHaveValue('neutral');
  await page.locator('[data-cell="17"]').click();
  await expect(page.locator('[data-cell="17"]')).toContainText('⛨');

  await page.locator('#editor-enemy-kind').selectOption('beacon');
  await expect(page.locator('#editor-enemy-hp')).toHaveValue('8');
  await expect(page.locator('#editor-color')).toHaveValue('neutral');
  await page.locator('[data-cell="18"]').click();
  await expect(page.locator('[data-cell="18"]')).toContainText('✧');
  await page.locator('#editor-goal').selectOption('bossKills');
  await page.locator('#editor-goal-target').fill('2');
  await page.locator('#editor-goal-target').dispatchEvent('change');

  const authored = await exported(page);
  expect(authored.enemies.find((enemy: any) => enemy.variant === 'jailer')).toMatchObject({
    index: 17, kind: 'boss', color: null, hp: 12,
  });
  expect(authored.enemies.find((enemy: any) => enemy.variant === 'beacon')).toMatchObject({
    index: 18, kind: 'boss', color: null, hp: 8,
  });
  await expect(page.locator('#editor-play')).toBeEnabled();

  await page.locator('#editor-preset').selectOption('rare');
  await page.locator('[data-editor="preset"]').click();
  await page.locator('#editor-json').fill(JSON.stringify(authored));
  await page.locator('[data-editor="import"]').click();
  expect(await exported(page)).toEqual(authored);
  await page.locator('#editor-play').click();
  await expect.poll(async () => page.evaluate(() => (window as any).__PUZZLE_GAME.state.phase)).toBe('PLAYER_INPUT');
  await expect(page.locator('#board-host canvas')).toBeVisible();
  const runtime = await page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
  expect(runtime.customLevel.definition.enemies).toEqual(authored.enemies);
  expect(runtime.board[17]).toMatchObject({ variant: 'jailer', kind: 'boss', color: null, hp: 12, shield: { dx: 0, dy: 1 } });
  expect(runtime.board[18]).toMatchObject({ variant: 'beacon', kind: 'boss', color: null, hp: 8 });
  expect(errors).toEqual([]);
});

test('missing finale illustrations use procedural enemies without a page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/art\/characters\/(jailer|beacon)\.png$/, route => route.abort());
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-enemy-kind').selectOption('jailer');
  await page.locator('[data-cell="17"]').click();
  await page.locator('#editor-enemy-kind').selectOption('beacon');
  await page.locator('[data-cell="18"]').click();
  await page.locator('#editor-play').click();
  await expect.poll(async () => page.evaluate(() => (window as any).__PUZZLE_GAME.state.phase)).toBe('PLAYER_INPUT');
  await expect(page.locator('#board-host canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
