import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
async function ready(page: Page) {
  await expect(page.locator('#board-host canvas')).toBeVisible();
  await expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
}
async function draw(page: Page, path: number[]) {
  const at = (index: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index);
  const first = await at(path[0]);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const index of path.slice(1)) {
    const point = await at(index);
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  await page.mouse.up(); await ready(page);
}

test('a long chain in the first trunk battle refills with mixed palette colors and retries the exact seeded result', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // The authored two-color field of the first map node, with its own palette and a fixed refill seed.
  await page.evaluate(() => (window as any).__PUZZLE_GAME.startNodeBattle('trunk-wake', { seed: 7101 })); await ready(page);
  const opening = await state(page);
  const path = [8, 13, 17, 11, 5, 10];
  expect(path.map(index => opening.board[index].color)).toEqual(Array(path.length).fill(0));
  await draw(page, path);
  const after = await state(page);
  expect(after.turn).toBe(opening.turn + 1);
  expect(after.objective.kills).toBe(path.length);
  const initialIds = new Set(opening.board.filter(Boolean).map((cell: any) => cell.id));
  // Six kills also create one crystal on a seeded random cell (it may crush a survivor or take a freed square).
  const crystals = after.board.filter((cell: any) => cell?.kind === 'prism' && !initialIds.has(cell.id));
  expect(crystals).toHaveLength(1);
  const arrivals = after.board.filter((cell: any) => cell && cell.kind !== 'prism' && !initialIds.has(cell.id));
  expect(arrivals.length).toBeGreaterThanOrEqual(path.length - 1);
  expect(arrivals.length).toBeLessThanOrEqual(path.length);
  expect(new Set(arrivals.map((cell: any) => cell.color))).toEqual(new Set([0, 2]));
  for (const cell of after.board.filter(Boolean)) {
    const previous = opening.board.find((old: any) => old?.id === cell.id);
    if (previous) expect(cell.color).toBe(previous.color);
  }
  const replaced = path.slice(0, -1).map(index => after.board[index]);
  expect(replaced.every((cell: any) => cell && !initialIds.has(cell.id))).toBe(true);
  expect(replaced.some((cell: any) => cell.color !== 0)).toBe(true);
  await page.screenshot({ path: 'artifacts/trunk-mixed-refill.png' });
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="retry"]').click(); await ready(page);
  expect(await state(page)).toEqual(opening);
  await draw(page, path);
  expect(await state(page)).toEqual(after);
  expect(errors).toEqual([]);
});
