import { test, expect, type Page } from '@playwright/test';

// Elite enemy and its loot in the interface: a gold mark on the elite, the +1 hit in the rest forecast, the chain forecast
// naming the item it will pick up, a toast when the chain does. All numbers come from the engine.
test.use({ viewport: { width: 1280, height: 720 } });

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const ready = (page: Page) => expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
const shot = async (page: Page, name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: `artifacts/${name}.png` }); };
const enemies = (elite: boolean) => [
  { index: 22, kind: 'melee', color: 0, hp: 0 }, { index: 21, kind: 'melee', color: 0, hp: 1, ...(elite ? { elite: true } : {}) }, { index: 20, kind: 'melee', color: 0, hp: 0 },
  { index: 30, kind: 'melee', color: 1, hp: 0 }, { index: 31, kind: 'melee', color: 1, hp: 0 },
];
/** Hero on F4; weak goblin, elite (1 HP authored) and weak goblin in a row on the way west. Seed picked so that the loot drops. */
const level = (seed: number, elite: boolean, extra: unknown[] = []) => ({
  version: 1, name: 'elite-ui', seed, cols: 6, rows: 6, terrain: Array(36).fill('floor'), heroIndex: 23, enemies: [...enemies(elite), ...extra], doors: [],
  goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [], playerHp: 9,
  inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 },
});
/** Well-spread battle seed #23 (first LCG draws of neighbouring small seeds are nearly equal). */
const DROP_SEED = Math.imul(23, 2654435761) >>> 0;
const startLevel = async (page: Page, definition: unknown) => { await page.evaluate(d => (window as any).__PUZZLE_GAME.startCustomLevel(d), definition); await ready(page); };
async function holdChain(page: Page, path: number[]) {
  for (let n = 0; n < path.length; n++) {
    const point = await page.evaluate(index => (window as any).__PUZZLE_GAME.gridToScreen(index), path[n]);
    await page.mouse.move(point.x, point.y, { steps: n ? 5 : 1 });
    if (n === 0) await page.mouse.down();
  }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
}
async function finishTurn(page: Page) {
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
  await ready(page);
}

test('the elite wears a mark, hits the cat one harder and leaves an item the next chain picks up', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');

  // Mark and the +1 in the forecast of resting: an armed elite goblin beside the cat versus the same plain goblin.
  const armed = [{ index: 28, kind: 'melee', color: 1, hp: 1, aggressive: true }];
  const restDamage = async (elite: boolean) => {
    await startLevel(page, { ...level(5, false), enemies: [{ ...armed[0], index: 22, ...(elite ? { elite: true } : {}) }, { index: 30, kind: 'melee', color: 1, hp: 0 }, { index: 31, kind: 'melee', color: 1, hp: 0 }] });
    return page.evaluate(() => (window as any).__PUZZLE_GAME.engine.previewRest().damage);
  };
  const plain = await restDamage(false);
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.eliteMarks)).toEqual([]);
  const elite = await restDamage(true);
  expect(elite).toBe(plain + 1);
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.eliteMarks)).toEqual([22]);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  await page.locator('#board-host').screenshot({ path: 'artifacts/elite-mark-board.png' });
  await page.locator('#wait-button').hover();
  await expect(page.locator('#risk-preview')).toContainText(`Отдых: −${elite} HP`);
  await expect(page.locator('.field-guide')).toContainText('Элита');
  await shot(page, 'elite-mark-rest-forecast');

  // The chain through the elite: it drops an item (picked seed), a toast announces it, the board shows its badge.
  await startLevel(page, level(DROP_SEED, true));
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.eliteMarks)).toEqual([21]);
  await holdChain(page, [22, 21, 20]);
  await finishTurn(page);
  const after = await state(page);
  const lootIndex = after.board.findIndex((cell: any) => cell?.kind === 'prism' && cell.loot);
  expect(lootIndex).toBeGreaterThanOrEqual(0);
  const item = after.board[lootIndex].loot as string;
  expect(after.inventory[item]).toBe(0);
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.lootMarks)).toContain(lootIndex);
  await expect(page.locator('.battle-toast', { hasText: 'Элита оставила' })).toBeVisible();
  await shot(page, 'elite-loot-on-field');

  // The forecast of a chain that passes through the item names it; releasing it adds the item to the stock and shows a toast.
  const route = await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME, near = (a: number, b: number) => Math.abs(a % 6 - b % 6) <= 1 && Math.abs(Math.floor(a / 6) - Math.floor(b / 6)) <= 1;
    const found: number[][] = [];
    const walk = (path: number[]) => {
      if (found.length) return;
      const preview = game.preview(path);
      if (path.length >= 2 && preview.valid && preview.hits.some((hit: any) => hit.loot)) { found.push([...path]); return; }
      if (path.length >= 4) return;
      for (let n = 0; n < 36; n++) if (!path.includes(n) && near(n, path[path.length - 1])) walk([...path, n]);
    };
    for (let s = 0; s < 36; s++) if (s !== game.state.player.index && near(s, game.state.player.index)) walk([s]);
    return found[0];
  });
  expect(route, 'a chain through the loot exists').toBeTruthy();
  await holdChain(page, route);
  await expect(page.locator('#chain-reward')).toContainText('Подберёт');
  await shot(page, 'elite-loot-forecast');
  await finishTurn(page);
  expect((await state(page)).inventory[item]).toBe(1);
  await expect(page.locator('.battle-toast', { hasText: '+ ' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('editor: the elite switch writes elite:true, marks the cell and refuses bosses', async ({ page }) => {
  await page.goto('/');
  await page.locator('#editor-button').click();await expect(page.locator('#editor-screen')).toBeVisible();
  await expect(page.locator('#editor-elite')).toBeVisible();
  await page.locator('#editor-enemy-hp').fill('2');
  await page.locator('#editor-elite').check();
  await page.locator('[data-cell="8"]').click();
  await expect(page.locator('[data-cell="8"]')).toHaveClass(/elite/);
  await expect(page.locator('[data-cell="8"]')).toHaveAttribute('title', /элита/);
  await page.locator('[data-editor="export"]').click();
  const exported = JSON.parse(await page.locator('#editor-json').inputValue());
  expect(exported.enemies.find((enemy: any) => enemy.index === 8)).toMatchObject({ kind: 'melee', hp: 2, elite: true });
  await page.locator('#editor-enemy-kind').selectOption('boss');
  await expect(page.locator('#editor-elite')).toBeDisabled();
  await page.locator('#editor-enemy-kind').selectOption('melee');
  await page.locator('#editor-elite').check();
  await page.locator('#editor-enemy-hp').fill('0');
  await expect(page.locator('#editor-elite-note')).toContainText('HP ≥ 1');
  await shot(page, 'elite-editor');
});
