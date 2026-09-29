import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const index = (label: string) => (Number(label.slice(1)) - 1) * 7 + label.charCodeAt(0) - 65;
async function settled(page: Page) {
  await expect(page.locator('#board-host canvas')).toBeVisible();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/TITLE|RESOLVE|UPDATE/);
}
async function draw(page: Page, labels: string[]) {
  const path = labels.map(index);
  const at = (i: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), i);
  const first = await at(path[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const i of path.slice(1)) { const p = await at(i); await page.mouse.move(p.x, p.y, { steps: 4 }); }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  await page.mouse.up(); await settled(page);
}
async function jump(page: Page, label: string) {
  await page.locator('#jump-ability').click();
  const p = await page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index(label));
  await page.mouse.click(p.x, p.y); await settled(page);
}
async function start(page: Page) {
  await page.goto('/'); await page.locator('[data-tutorial="13"]').click(); await settled(page);
  await expect(page.locator('#objectives')).toContainText('14');
}
const quick = ['B5','B4','C4','B3','A2','B2','C3','C2','D1','C1','D2','E3'];

test('jailer has a recovery window and branches into a real escape', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await page.screenshot({ path: 'artifacts/finale-jailer.png' });
  await draw(page, quick);
  expect((await state(page)).player.hp).toBe(3);
  await expect(page.locator('#shield-summary')).toContainText('щит снят');
  await draw(page, ['D3','E3']);
  await expect(page.locator('#modal [data-action="tutorial-choice"]')).toHaveCount(2);
  await expect(page.locator('#modal [data-action="next-tutorial"]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/finale-fork.png' });
  await page.locator('[data-next-lesson="14"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(14);
  await expect(page.locator('#wave-label')).toContainText('ВЫХОДА');
  await draw(page, ['B5','B4','C4','C3','D3','D2']);
  expect((await state(page)).phase).toBe('PLAYER_INPUT');
  await expect(page.locator('#objectives')).toContainText('Выход открыт');
  await draw(page, ['E2','F1','G1']);
  expect((await state(page)).phase).toBe('WIN');
  expect((await state(page)).board.some((cell: any) => cell?.kind === 'ranged')).toBe(true);
  await page.locator('#modal [data-action="tutorial-forest"]').click(); await settled(page);
  expect((await state(page)).room.kind).toBe('forest');
  expect((await state(page)).tutorial).toBeUndefined(); expect(errors).toEqual([]);
});

test('optional pit and fire route opens the source branch, reinforcements are announced', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await draw(page, ['B5','C5','C4','B4','B3','C3','C2']);
  expect((await state(page)).pits).toHaveLength(4);
  await jump(page, 'E2');
  await draw(page, ['F1','G1','G2','F2','G3','G4','F4','E4','F3','E3']);
  expect((await state(page)).board[index('E3')].hp).toBe(4);
  await jump(page, 'E3'); expect((await state(page)).player.hp).toBe(5);
  await page.locator('[data-next-lesson="15"]').click(); await settled(page);
  await expect(page.locator('#objectives')).toContainText('Колокол');
  await draw(page, ['B5','B4','C4','C3']);
  await expect(page.locator('#intent-summary')).toContainText('Подкрепления: 2');
  await page.screenshot({ path: 'artifacts/finale-beacon-intent.png' });
  const targets = (await state(page)).board[index('E2')].intent.summonCells;
  await draw(page, ['B3','B2','C2','D2','E2']);
  const s = await state(page);
  expect(targets.every((i: number) => s.board[i].behavior.aggressive && !s.board[i].behavior.passive)).toBe(true);
  await jump(page, 'E2'); expect((await state(page)).phase).toBe('WIN');
  await expect(page.locator('#modal [data-action="tutorial-forest"]')).toBeVisible();
  await expect(page.locator('#modal [data-action="next-tutorial"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
