import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
/** UI labels to board indices for a board of the given width. */
const indices = (cols: number, labels: string[]) => labels.map(label => (Number(label.slice(1)) - 1) * cols + label.charCodeAt(0) - 65);
async function settled(page: Page) {
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/TITLE|RESOLVE|UPDATE/);
}
async function draw(page: Page, cols: number, labels: string[], check?: () => Promise<void>) {
  const path = indices(cols, labels);
  const at = (index: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index);
  const first = await at(path[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const index of path.slice(1)) { const point = await at(index); await page.mouse.move(point.x, point.y, { steps: 4 }); }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  if (check) await check();
  await page.mouse.up(); await settled(page);
}
async function start(page: Page, index: number) {
  await page.goto('/'); await page.locator(`[data-tutorial="${index}"]`).click();
  await expect(page.locator('#board-host canvas')).toBeVisible(); await settled(page);
}

test('pit lesson warns about a lethal endpoint, retries, and crosses before the hatches open', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await start(page, 10); const initial = await state(page);
  await draw(page, 7, ['B3', 'C3', 'D3'], async () => {
    await expect(page.locator('#chain-reward')).toContainText('ПАДЕНИЕ — СМЕРТЬ');
    await expect(page.locator('#risk-preview')).toContainText('смертельно');
    await page.screenshot({ path: 'artifacts/pits-lethal-preview.png' });
  });
  expect((await state(page)).phase).toBe('LOSE');
  await page.locator('#modal [data-action="retry"]').click(); await settled(page);
  expect(await state(page)).toEqual(initial);
  await draw(page, 7, ['B3', 'C3', 'D3', 'E3', 'F3']);
  let s = await state(page);
  expect([...s.pits.map((pit: any) => pit.index)].sort((a: number, b: number) => a - b)).toEqual(indices(7, ['D2', 'D3', 'D4']));
  expect(s.player.hp).toBe(5); expect(s.objective.tutorialTargets).toBe(1);
  expect(s.pits.every((pit: any) => s.board[pit.index] === null)).toBe(true);
  await page.screenshot({ path: 'artifacts/pits-open-floor.png' });
  await draw(page, 7, ['G3', 'G4']);
  s = await state(page);
  expect(s.pits).toEqual([]); expect(indices(7, ['D2', 'D3', 'D4']).every(index => s.board[index])).toBe(true);
  await draw(page, 7, ['F4', 'E4', 'E3', 'D2', 'C2']);
  expect((await state(page)).phase).toBe('WIN');
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(11); expect(errors).toEqual([]);
});

test('lever on the near bank strands the cat for a turn, then the moat closes and refills', async ({ page }) => {
  test.setTimeout(60_000);
  await start(page, 11); const [guard] = indices(6, ['C4']); const guardId = (await state(page)).board[guard].id;
  await draw(page, 6, ['D1', 'D2', 'D3', 'C2', 'B3', 'A2']);
  let s = await state(page);
  expect(s.pits).toHaveLength(4); expect(s.objective.tutorialTargets).toBe(1);
  expect(await page.evaluate(i => (window as any).__PUZZLE_GAME.previewAbility('jump', i).valid, guard)).toBe(false);
  await draw(page, 6, ['A1', 'B1', 'B2']); s = await state(page);
  expect(s.pits).toEqual([]);
  expect(indices(6, ['B4', 'C4', 'D4', 'E4']).every(index => s.board[index])).toBe(true);
  expect(s.board[guard].id).not.toBe(guardId); expect(s.objective.tutorialTargets).toBe(1);
  await draw(page, 6, ['C3', 'D4', 'D5', 'D6']);
  expect((await state(page)).phase).toBe('WIN'); expect((await state(page)).player.hp).toBe(5);
});

test('lever, brazier and an earned jump combine before the Jailer', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await start(page, 12);
  await draw(page, 7, ['F2', 'F3', 'E3', 'D3', 'D2']);
  expect((await state(page)).player.energy).toBe(2);
  await draw(page, 7, ['C2', 'C3', 'B3', 'A3', 'A2', 'A1'], async () => {
    await expect(page.locator('#chain-reward')).toContainText('+1 горение');
    await expect(page.locator('#risk-preview')).toContainText('−1 HP');
    await page.screenshot({ path: 'artifacts/pits-fire-combination.png' });
  });
  expect((await state(page)).board[0].hp).toBe(4);
  await page.locator('#jump-ability').click();
  const point = await page.evaluate(() => (window as any).__PUZZLE_GAME.gridToScreen(0));
  await page.mouse.click(point.x, point.y); await settled(page);
  expect((await state(page)).phase).toBe('WIN'); expect((await state(page)).player.hp).toBe(4);
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(13);
  expect(errors).toEqual([]);
});
