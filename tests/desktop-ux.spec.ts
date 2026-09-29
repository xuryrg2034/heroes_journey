import { expect, test, type Page } from '@playwright/test';

type Rect = { top: number; bottom: number; left: number; right: number };

async function rect(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  test.describe(`desktop ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('shows all authored fights and trials together', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.tutorial-select [data-tutorial]')).toHaveCount(16);
      await expect(page.locator('#title-screen [data-scenario]')).toHaveCount(7);
      for (const selector of ['#tutorial-begin-button', '[data-tutorial="15"]', '#begin-button', '#campaign-button']) {
        const box = await rect(page, selector);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(viewport.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });

    for (const [name, selector, hasEnergy] of [
      ['first lesson', '#tutorial-begin-button', false],
      ['jump lesson', '[data-tutorial="7"]', true],
      ['castle gate', '#campaign-button', true],
    ] as const) {
      test(`${name} keeps board, goal, resources, and actions in view`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/');
        await page.locator(selector).click();
        await expect(page.locator('#board-host canvas')).toBeVisible();
        await expect(page.locator('.objective-card')).toBeVisible();
        await expect(page.locator('#health')).toBeVisible();
        await expect(page.locator('#wait-button')).toBeVisible();
        if (hasEnergy) await expect(page.locator('.energy-hud')).toBeVisible();
        else await expect(page.locator('.energy-hud')).toBeHidden();
        await expect(page.locator('.room-details')).not.toHaveAttribute('open');
        await expect(page.locator('.field-details')).not.toHaveAttribute('open');
        expect(await page.locator('.action-dock').evaluate(element => element.parentElement?.className)).toBe('guide-panel');
        for (const element of ['#board-host', '.objective-card', '.combat-hud', '#wait-button']) {
          const box = await rect(page, element);
          expect(box.top, `${element} starts inside the viewport`).toBeGreaterThanOrEqual(0);
          expect(box.bottom, `${element} fits inside the viewport`).toBeLessThanOrEqual(viewport.height);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        expect(errors).toEqual([]);
      });
    }
  });
}

test('chain forecast stays visible and drawing does not move the board', async ({ page }) => {
  await page.goto('/');
  await page.locator('#tutorial-begin-button').click();
  await expect(page.locator('#board-host canvas')).toBeVisible();
  const boardTop = (await rect(page, '#board-host')).top;
  const at = (index: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index);
  const first = await at(16);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const index of [17, 12]) {
    const point = await at(index);
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await expect.poll(() => page.evaluate(() => (window as any).__PUZZLE_GAME.state.chain)).toEqual([16, 17, 12]);
  await expect(page.locator('.chain-card')).toBeVisible();
  await expect(page.locator('#chain-reward')).toContainText('Запас:');
  await expect(page.locator('#risk-preview')).toContainText('безопасен');
  expect((await rect(page, '#board-host')).top).toBe(boardTop);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__PUZZLE_GAME.state.objective.kills)).toBe(3);
});

test('reference opens on demand and door focus explains the destination', async ({ page }) => {
  await page.goto('/');
  await page.locator('#campaign-button').click();
  await expect(page.locator('#board-host canvas')).toBeVisible();
  await page.locator('.room-details summary').click();
  await page.locator('.field-details summary').click();
  await expect(page.locator('#route-map')).toBeVisible();
  await expect(page.locator('.field-guide')).toBeVisible();
  const door = await page.evaluate(() => (window as any).__PUZZLE_GAME.state.board.findIndex((cell: any) => cell?.door));
  const point = await page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), door);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#status-message')).toContainText('Ворота');
});
