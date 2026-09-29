import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
async function ready(page: Page) { await expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT'); }
async function draft(page: Page) { await page.locator('[data-editor="export"]').click(); return JSON.parse(await page.locator('#editor-json').inputValue()); }
async function brush(page: Page, value: string, index: number) { await page.locator('#editor-brush').selectOption(value); await page.locator(`[data-cell="${index}"]`).click(); }
async function drag(page: Page, path: number[]) {
  await page.locator('#board-host').scrollIntoViewIfNeeded();
  for (let n = 0; n < path.length; n++) {
    const point = await page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), path[n]);
    await page.mouse.move(point.x, point.y, { steps: n ? 5 : 1 });
    if (n === 0) await page.mouse.down();
  }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  await page.mouse.up();
  await ready(page);
}

test('editor authors independent trapdoors, retains them through history and JSON, then plays the real trap', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#editor-button').click();
  const definition = {
    version: 1, name: 'Люки на пути', seed: 701, cols: 4, rows: 4,
    terrain: Array(16).fill('floor'), heroIndex: 13,
    enemies: Array.from({ length: 16 }, (_, index) => index).filter(index => index !== 13)
      .map(index => ({ index, kind: 'melee', color: [12, 6].includes(index) ? 0 : 2, hp: 0 })),
    doors: [], goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [100, 0, 100, 0, 0], extraColors: [], playerHp: 20,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 },
  };
  await page.locator('#editor-json').fill(JSON.stringify(definition));
  await page.locator('[data-editor="import"]').click();
  await brush(page, 'device:pits', 9);
  await page.locator('#editor-device-charges').fill('3');
  await page.locator('#editor-device-charges').dispatchEvent('change');
  await page.locator('#editor-brush').selectOption('pit-targets');
  for (const index of [0, 2, 13]) await page.locator(`[data-cell="${index}"]`).click();
  await expect(page.locator('[data-cell="13"]')).toHaveClass(/editor-pit-target/);
  await expect(page.locator('[data-cell="13"]')).toContainText('▤');
  expect((await draft(page)).devices).toEqual([{ index: 9, kind: 'pits', charges: 3, targets: [0, 2, 13] }]);
  await page.locator('[data-cell="2"]').click();
  expect((await draft(page)).devices[0].targets).toEqual([0, 13]);
  await page.locator('[data-editor="undo"]').click();
  expect((await draft(page)).devices[0].targets).toEqual([0, 2, 13]);
  await page.locator('#editor-cols').fill('5');
  await page.locator('#editor-cols').dispatchEvent('change');
  expect((await draft(page)).devices[0]).toMatchObject({ index: 11, targets: [0, 2, 16] });
  await page.locator('[data-editor="undo"]').click();
  const authored = await draft(page);
  expect(authored.terrain[13]).toBe('floor');
  await page.locator('[data-editor="save"]').click();
  await page.reload();
  await page.locator('#editor-button').click();
  expect(await draft(page)).toEqual(authored);
  await page.locator('#editor-preset').selectOption('rare');
  await page.locator('[data-editor="preset"]').click();
  await page.locator('#editor-json').fill(JSON.stringify(authored));
  await page.locator('[data-editor="import"]').click();
  expect(await draft(page)).toEqual(authored);
  await page.locator('#editor-play').click();
  await ready(page);
  const initial = await state(page);
  expect(initial.customLevel.definition.devices).toEqual(authored.devices);
  expect(initial.pits).toEqual([]);
  await drag(page, [12, 9, 6]);
  const played = await state(page);
  expect(played.devices.find((device: any) => device.index === 9).charges).toBe(2);
  expect(played.pits.map((pit: any) => pit.index).sort((a: number, b: number) => a - b)).toEqual([0, 2, 13]);
  expect(played.board[0]).toBeNull();
  expect(played.board[2]).toBeNull();
  expect(played.player.index).toBe(6);
  await page.locator('#wait-button').click();
  await ready(page);
  expect((await state(page)).pits).toEqual([]);
  await page.locator('#return-editor').click();
  expect(await draft(page)).toEqual(authored);
  expect(errors).toEqual([]);
});
