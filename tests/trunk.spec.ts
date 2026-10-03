import { test, expect, type Page } from '@playwright/test';

// Trunk battles of the forest map (rows 1–4, src/game/run/battles/trunk.ts): authored mixed-color fields played
// through the real pointer path. They open with their authored refill seed outside the saved run (startNodeBattle);
// the map flow itself is covered in forest-map.spec.ts.
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const center = async (page: Page, index: number) => {
  await page.locator('#board-host').scrollIntoViewIfNeeded();
  return page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index);
};
async function settled(page: Page) {
  await expect.poll(async () => (await state(page)).phase, { timeout: 15_000 }).not.toMatch(/TITLE|RESOLVE|UPDATE/);
  // Engine input can be ready before the first asynchronous texture load mounts the canvas.
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
async function open(page: Page, battle: string, seed: number) {
  await page.evaluate(([id, seed]) => (window as any).__PUZZLE_GAME.startNodeBattle(id, { seed }), [battle, seed] as const);
  await settled(page);
}
async function draw(page: Page, path: number[]) {
  const first = await center(page, path[0]);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const index of path.slice(1)) {
    const point = await center(page, index);
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  // No tools are open in these nodes: the chain panel does not advertise energy.
  await expect(page.locator('#chain-reward')).not.toContainText('Энергия');
  await page.mouse.up(); await settled(page);
}

test('trunk battles 1–3 are played by mouse, keep marked targets and retry exactly', async ({ page }) => {
  test.setTimeout(75_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await open(page, 'trunk-wake', 7101);
  let entry = await state(page);
  expect(entry.player.hp).toBe(5);
  expect(new Set(entry.board.filter((cell: any) => cell && cell.kind !== 'door').map((cell: any) => cell.color))).toEqual(new Set([0, 2]));
  await page.screenshot({ path: 'artifacts/trunk-wake-desktop.png' });
  await expect(page.locator('#chapter-number')).toContainText('ПОХОД');
  await expect(page.locator('.tutorial-room .energy-hud')).toBeHidden();
  await expect(page.locator('.tutorial-room .ability-toolbar')).toBeHidden();
  await expect(page.locator('#frost-button')).toBeHidden();
  await expect(page.locator('#return-editor')).toBeHidden();
  // Tools the run has not opened are refused by the engine too.
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.engine.setAbility('jump'))).toBe(false);
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.engine.useItem('healing'))).toBe(false);
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="retry"]').click(); await settled(page);
  expect((await state(page)).board).toEqual(entry.board);
  // Trunk 1: E2-E3-E4 (blue), then D3-C4-B3-A2-A3-B4-C5 (red with diagonal steps) reaches 8 defeats and opens the
  // door; D5 and the door E5 end the same chain in the victory (02.10.2026: a battle is won only through the exit).
  await draw(page, [9, 14, 19]);
  expect((await state(page)).objective.kills).toBe(3);
  await draw(page, [13, 17, 11, 5, 10, 16, 22, 23, 24]);
  expect((await state(page)).phase).toBe('WIN');
  await expect(page.locator('#modal [data-action="run-map"]')).toBeVisible();
  await open(page, 'trunk-axe', 7102);
  entry = await state(page);
  expect(entry.tutorial.targetIds).toHaveLength(2);
  await expect(page.locator('#objectives')).toContainText('0 / 2');
  // Trunk 2: B3-B2-C2 gives exactly 3 power to the red guard; C3-D4-E3-E2 brings 4 to the blue one and F1 is the door.
  await draw(page, [13, 7, 8]);
  expect((await state(page)).objective.tutorialTargets).toBe(1);
  await expect(page.locator('#objectives')).toContainText('1 / 2');
  await draw(page, [14, 21, 16, 10, 5]);
  expect((await state(page)).phase).toBe('WIN');
  await open(page, 'trunk-last-step', 7103);
  entry = await state(page);
  expect(entry.tutorial.targetIds).toHaveLength(2);
  await page.screenshot({ path: 'artifacts/trunk-last-step-desktop.png' });
  expect(entry.board.filter((cell: any) => cell?.behavior.aggressive)).toHaveLength(4);
  // Trunk 3: C5-B5-A4-A3-B2 kills the red guard with exact power, B1-C2-D3-E2-F1 the blue one, then the door E1.
  await draw(page, [26, 25, 18, 12, 7]);
  expect((await state(page)).objective.tutorialTargets).toBe(1);
  expect((await state(page)).player.hp).toBe(5);
  await draw(page, [1, 8, 15, 10, 5, 4]);
  expect((await state(page)).phase).toBe('WIN');
  expect(errors).toEqual([]);
});

test('the first trunk battle accepts a touch chain on mobile', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await open(page, 'trunk-wake', 7101);
  await page.screenshot({ path: 'artifacts/trunk-wake-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const points = await Promise.all([9, 14, 19].map(index => center(page, index)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
  for (const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
  await expect.poll(async () => (await state(page)).chain).toEqual([9, 14, 19]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settled(page);
  expect((await state(page)).objective.kills).toBe(3);
  expect(errors).toEqual([]);
  await context.close();
});

test('the arrow lever keeps the chain color and its volley finishes the guard', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await open(page, 'trunk-arrows', 7104);
  await expect(page.locator('#device-summary')).toContainText('рычаг');
  await expect(page.locator('#device-summary')).toContainText('зарядов 2');
  await page.screenshot({ path: 'artifacts/trunk-arrows.png' });
  // B2-C3-lever C4-D5-D6 leaves the guard at 3 HP; the volley on row 6 finishes it, the cat stands on D5.
  await draw(page, [6, 12, 17, 23, 28]);
  // The volley kills the guard after the chain: the goal opens the door E4, but the battle goes on (02.10.2026).
  let after = await state(page);
  expect(after.phase).toBe('PLAYER_INPUT');
  expect(after.player.hp).toBe(5);
  expect(after.devices[0].charges).toBe(1);
  expect(after.board[19]?.intent.label).toBe('Выход открыт');
  // The next turn: a one-cell chain from the cat on D5 into the open door E4 wins.
  await draw(page, [19]);
  after = await state(page);
  expect(after.phase).toBe('WIN'); expect(after.player.hp).toBe(5);
  expect(errors).toEqual([]);
});

test('mobile touch crosses a lever and shows its charges and danger line', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await open(page, 'trunk-arrows', 7104);
  await expect(page.locator('#device-summary')).toContainText('зарядов 2');
  const route = [6, 12, 17, 23, 28];
  const points = await Promise.all(route.map(index => center(page, index)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
  for (const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
  await expect.poll(async () => (await state(page)).chain).toEqual(route);
  await page.screenshot({ path: 'artifacts/trunk-arrows-mobile-preview.png', fullPage: true });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settled(page);
  expect((await state(page)).devices[0].charges).toBe(1);
  // The volley opens the exit door E4; entering it is the next turn.
  expect((await state(page)).phase).toBe('PLAYER_INPUT');
  expect((await state(page)).board[19]?.intent.label).toBe('Выход открыт');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); await context.close();
});

test('entering the next node from a result does not replay the previous outcome', async ({ page }) => {
  // Record the first frequency of every synthesized tone: 280 click, 590 reward, 72 damage, 520 win, 95 lose.
  await page.addInitScript(() => {
    (window as any).__tones = [];
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const oscillator = original.call(this), set = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      let first = true;
      oscillator.frequency.setValueAtTime = (value: number, time: number) => { if (first) { (window as any).__tones.push(Math.round(value)); first = false; } return set(value, time); };
      return oscillator;
    };
  });
  const tones = () => page.evaluate(() => (window as any).__tones as number[]);
  const clear = () => page.evaluate(() => { (window as any).__tones = []; });
  await page.goto('/');
  await page.locator('#run-start-button').click();
  await page.locator('.map-node[data-node="trunk-1"]').click(); await settled(page);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await expect(page.locator('#modal-title')).toHaveText('Узел пройден');
  await expect.poll(tones).toContain(520);
  await clear();
  await page.locator('#modal [data-action="run-map"]').click();
  await page.locator('.map-node[data-node="trunk-2"]').click(); await settled(page);
  expect((await state(page)).runNode.nodeId).toBe('trunk-2');
  await expect(page.locator('#modal-layer')).toBeHidden();
  expect(await tones()).not.toContain(520);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.damagePlayer(10));
  // A defeat ends the run (04.10.2026); the next run's first battle must not replay that outcome.
  await expect(page.locator('#modal-title')).toHaveText('Кот пал');
  await expect.poll(tones).toContain(95);
  await clear();
  await page.locator('#modal [data-action="run-new"]').click();
  await page.locator('.map-node[data-node="trunk-1"]').click(); await settled(page);
  expect((await state(page)).runNode.nodeId).toBe('trunk-1');
  await expect(page.locator('#modal-layer')).toBeHidden();
  expect(await tones()).not.toContain(95);
});
