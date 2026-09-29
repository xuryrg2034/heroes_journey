import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
/** Board widths: Jailer 7, gate 5, bell 6. */
let cols = 7;
const index = (label: string) => (Number(label.slice(1)) - 1) * cols + label.charCodeAt(0) - 65;
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
  cols = 7;
  await page.goto('/'); await page.locator('[data-tutorial="13"]').click(); await settled(page);
}
test('jailer: flank, rest window and the other flank; the fork leads to a real escape', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await page.screenshot({ path: 'artifacts/finale-jailer.png' });
  await draw(page, ['F3','F2','E1','D1']);
  expect((await state(page)).player.hp).toBe(5);
  expect((await state(page)).board[index('D1')].hp).toBe(10);
  await expect(page.locator('#shield-summary')).toContainText('щит снят');
  await draw(page, ['E2','E3','D2','C3','B3','C2','D1']);
  expect((await state(page)).board[index('D1')].hp).toBe(3);
  await draw(page, ['B1','C1','D1']);
  expect((await state(page)).phase).toBe('WIN'); expect((await state(page)).player.hp).toBe(5);
  await expect(page.locator('#modal [data-action="tutorial-choice"]')).toHaveCount(2);
  await expect(page.locator('#modal [data-action="next-tutorial"]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/finale-fork.png' });
  await page.locator('[data-next-lesson="14"]').click(); cols = 5; await settled(page);
  expect((await state(page)).tutorial.index).toBe(14);
  await expect(page.locator('#wave-label')).toContainText('ВЫХОДА');
  await draw(page, ['D6','C5','D5','C4']);
  expect((await state(page)).phase).toBe('PLAYER_INPUT');
  await expect(page.locator('#objectives')).toContainText('Выход открыт');
  // The archer's opening line B4–B6 kills those goblins and their refill colors depend on the seed, so the exit route avoids them.
  await draw(page, ['C3','D3','D2','D1','C1']);
  expect((await state(page)).phase).toBe('WIN');
  expect((await state(page)).board[index('C2')]?.hp).toBe(3);
  await page.locator('#modal [data-action="tutorial-forest"]').click(); await settled(page);
  expect((await state(page)).room.kind).toBe('forest');
  expect((await state(page)).tutorial).toBeUndefined(); expect(errors).toEqual([]);
});

test('jump alternative opens the bell branch; announced reinforcements arm next to the gate', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await draw(page, ['F3','G2','F2','E1','D1']);
  await draw(page, ['E2','E3','D2','C3','B3','C2','D1']);
  await jump(page, 'D1'); expect((await state(page)).player.hp).toBe(5);
  await page.locator('[data-next-lesson="15"]').click(); cols = 6; await settled(page);
  await expect(page.locator('#objectives')).toContainText('Колокол');
  await draw(page, ['E7','E6','E5','E4','E3']);
  await expect(page.locator('#intent-summary')).toContainText('Подкрепления: 2');
  await page.screenshot({ path: 'artifacts/finale-beacon-intent.png' });
  const targets = (await state(page)).board[index('A1')].intent.summonCells;
  expect(targets).toEqual([index('B1'), index('C1')]);
  await draw(page, ['D3','C3','B2','A1']);
  const s = await state(page);
  expect(targets.every((i: number) => s.board[i].behavior.aggressive && !s.board[i].behavior.passive)).toBe(true);
  expect(s.board[index('B1')].intent.cells).toContain(s.player.index);
  await page.screenshot({ path: 'artifacts/finale-beacon-armed.png' });
  await jump(page, 'A1'); expect((await state(page)).phase).toBe('WIN');
  await expect(page.locator('#modal [data-action="tutorial-forest"]')).toBeVisible();
  await expect(page.locator('#modal [data-action="next-tutorial"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
