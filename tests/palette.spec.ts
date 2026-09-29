import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const colors = (s: any): number[] => [...new Set<number>(s.board.flatMap((cell: any) => cell?.color == null ? [] : [cell.color]))].sort();
async function ready(page: Page) {
  await expect(page.locator('#board-host canvas')).toBeVisible();
  await expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
}

test('authored palette grows from two to five without resetting in later lessons', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const [index, count] of [[0,2],[7,2],[8,3],[9,3],[10,3],[11,4],[12,4],[13,5],[14,5],[15,5]]) {
    await page.locator(`[data-tutorial="${index}"]`).click(); await ready(page);
    const s = await state(page);
    expect(colors(s)).toHaveLength(count);
    expect(s.customLevel.paletteWeights.filter((weight: number) => weight > 0)).toHaveLength(count);
    if (count >= 4) {
      await expect(page.locator('#palette-summary')).toContainText('Охра');
      if (count === 5) await expect(page.locator('#palette-summary')).toContainText('Аметист');
    }
    if (index === 13) await page.screenshot({ path: 'artifacts/palette-five-jailer.png' });
    if (index === 11) await page.screenshot({ path: 'artifacts/palette-four-pits.png' });
    await page.locator('.brand[data-action="title"]').click();
  }
  expect(errors).toEqual([]);
});

test('all ordinary scenes render five colors and an actual chain refills without repainting survivors', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const theme of ['forest','gate','banquet','barracks','chess','library','wizard']) {
    await page.locator(`[data-scenario="${theme}"]`).click(); await ready(page);
    expect(colors(await state(page))).toEqual([0,1,2,3,4]);
    if (theme === 'forest') {
      const path = await page.evaluate(() => {
        const g = (window as any).__PUZZLE_GAME;
        return g.availableMoves().filter((path: number[]) => { const p=g.preview(path); return p.valid && !p.completesRoom && p.damage===0; }).sort((a: number[],b: number[]) => a.length-b.length)[0];
      });
      expect(path).toBeTruthy();
      const before = await state(page);
      const point = (i: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), i);
      const first=await point(path[0]); await page.mouse.move(first.x,first.y); await page.mouse.down();
      for (const i of path.slice(1)) { const p=await point(i); await page.mouse.move(p.x,p.y,{steps:4}); }
      await expect.poll(async () => (await state(page)).chain).toEqual(path);
      await page.mouse.up(); await ready(page);
      const after=await state(page); expect(after.turn).toBe(before.turn+1);
      for (const cell of after.board.filter(Boolean)) {
        const previous=before.board.find((old: any) => old?.id===cell.id);
        if (previous) expect(cell.color).toBe(previous.color);
      }
      await page.screenshot({ path:'artifacts/palette-five-forest.png' });
    }
    await page.locator('.brand[data-action="title"]').click();
  }
  expect(errors).toEqual([]);
});
