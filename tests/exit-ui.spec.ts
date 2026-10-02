import { test, expect, type Page } from '@playwright/test';

// The exit door of a map battle in the interface (stage 4, decision of 02.10.2026): the door reads closed/open, the
// message when the goals are met, the chest with its own look and forecast wording, the reinforcement counter and
// the announced cells. All numbers and wording conditions come from the engine's forecast and events.
test.use({ viewport: { width: 1280, height: 720 } });

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const ready = (page: Page) => expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
const shot = async (page: Page, name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: `artifacts/${name}.png` }); };
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
async function rest(page: Page) {
  await page.locator('#wait-button').click();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
  await ready(page);
}
const toasts = (page: Page) => page.evaluate(() => (window as any).__toasts as string[]);
const doorOf = (s: any) => s.board.find((cell: any) => cell?.kind === 'door');

/** The first chain prefix (found by the engine's own forecast) that satisfies the predicate over the preview. */
const findChain = (page: Page, wanted: 'unlocks' | 'chest' | 'kills') => page.evaluate(kind => {
  const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
  let best: { chain: number[]; kills: number } | null = null;
  for (const move of game.availableMoves()) for (let n = 2; n <= move.length; n++) {
    const chain = move.slice(0, n), key = chain.join(','); if (seen.has(key)) continue; seen.add(key);
    const p = game.preview(chain); if (!p.valid || p.completesRoom || p.opensDoor !== undefined) continue;
    if (kind === 'unlocks' && p.unlocksExit) return chain;
    if (kind === 'chest' && p.hits.some((hit: any) => hit.chest)) return chain;
    if (kind === 'kills' && (!best || p.kills > best.kills)) best = { chain, kills: p.kills };
  }
  return kind === 'kills' ? best?.chain ?? null : null;
}, wanted) as Promise<number[] | null>;

test('exit battle: goals met message, open door, chest, forecast wording, reinforcement counter and marks', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => (window as any).__PUZZLE_GAME.startNodeBattle('trunk-wake', { row: 6, seed: 4242, player: { hp: 40, maxHp: 40, energy: 0 } }));
  await ready(page);
  // Every toast of the battle is recorded: they live under two seconds.
  await page.evaluate(() => {
    (window as any).__toasts = [];
    new MutationObserver(records => { for (const r of records) r.addedNodes.forEach(n => (window as any).__toasts.push(n.textContent ?? '')); })
      .observe(document.getElementById('battle-toasts')!, { childList: true, subtree: true });
  });

  // Closed door, no counter yet, no chest.
  let s = await state(page);
  expect(doorOf(s).door.breached).toBe(false);
  await expect(page.locator('#reinforcement-chip')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.chestMarks)).toEqual([]);
  await shot(page, 'exit-ui-closed');

  // Meet the goals; the chain that does so is forecast as «ВЫХОД ОТКРОЕТСЯ» when the engine says so.
  let announced = false;
  for (let attempt = 0; attempt < 8 && (await state(page)).customLevel.goalCompletedTurn === null; attempt++) {
    const unlock = await findChain(page, 'unlocks');
    const path = unlock ?? await findChain(page, 'kills');
    expect(path).not.toBeNull();
    await holdChain(page, path!);
    if (unlock) {
      announced = true;
      await expect(page.locator('#chain-rank')).toHaveText(/^ВЫХОД ОТКРОЕТСЯ( · −\d+ HP)?$/);
      await expect(page.locator('#chain-reward')).toContainText('Цели будут выполнены');
      expect((await page.evaluate(() => (window as any).__PUZZLE_GAME.endpointLabel)).text).toMatch(/^ВЫХОД ОТКРОЕТСЯ( · −\d+ HP)?$/);
      await shot(page, 'exit-ui-unlocks-forecast');
    }
    await finishTurn(page);
  }
  s = await state(page);
  expect(s.customLevel.goalCompletedTurn).not.toBeNull();
  expect(announced).toBe(true);
  expect(doorOf(s).door.breached).toBe(true);
  expect(doorOf(s).intent.label).toBe('Выход открыт');

  // The message appears once; the door and the HUD read as open; the chest has fallen with its own look.
  expect((await toasts(page)).filter(text => text.startsWith('Цели выполнены — выход открыт'))).toHaveLength(1);
  await expect(page.locator('#objectives .key-status')).toContainText('Выход открыт');
  await expect.poll(() => page.evaluate(() => (window as any).__PUZZLE_GAME.chestMarks.length)).toBe(1);
  expect(s.board.filter((cell: any) => cell?.chest).length).toBe(1);
  await shot(page, 'exit-ui-open-chest');

  // The chest in the chain forecast: its own wording instead of «СМЕНА ЦВЕТА», the contents line.
  const viaChest = await findChain(page, 'chest');
  expect(viaChest).not.toBeNull();
  await holdChain(page, viaChest!);
  await expect(page.locator('#chain-reward')).toContainText('Откроет сундук');
  await expect(page.locator('#chain-reward')).not.toContainText('смена цвета');
  const marks = await page.evaluate(() => (window as any).__PUZZLE_GAME.forecastMarks.labels as string[]);
  expect(marks).toContain('ОТКРОЕТ СУНДУК');
  expect(marks.join('|')).not.toContain('СМЕНА ЦВЕТА');
  await shot(page, 'exit-ui-chest-forecast');
  const materialsBefore = Object.values((await state(page)).materials ?? {}).reduce((a: number, b: any) => a + b, 0);
  await finishTurn(page);
  const after = await state(page);
  expect(Object.values(after.materials ?? {}).reduce((a: number, b: any) => a + b, 0)).toBe(materialsBefore + 2);
  expect(after.board.filter((cell: any) => cell?.chest).length).toBe(0);
  expect((await toasts(page)).some(text => text.startsWith('Сундук открыт:'))).toBe(true);

  // Resting after the goals: the counter shows, then the announced cells are marked and explained on hover.
  await expect(page.locator('#reinforcement-chip')).toBeVisible();
  await expect(page.locator('#reinforcement-count')).toContainText(/Через|После/);
  let cells: number[] = [];
  for (let n = 0; n < 8 && !cells.length; n++) {
    await rest(page);
    cells = await page.evaluate(() => (window as any).__PUZZLE_GAME.reinforcementMarks as number[]);
  }
  expect(cells.length).toBeGreaterThan(0);
  await expect(page.locator('#reinforcement-count')).toHaveText('После этого действия');
  expect(cells).toEqual((await state(page)).customLevel.reinforcement.cells);
  expect((await toasts(page)).some(text => text.startsWith('Подкрепление: клетки отмечены'))).toBe(true);
  await shot(page, 'exit-ui-reinforcement-marks');
  const spot = await page.evaluate(index => (window as any).__PUZZLE_GAME.gridToScreen(index), cells[0]);
  await page.mouse.move(spot.x, spot.y);
  await expect.poll(() => page.locator('#board-host canvas').getAttribute('title')).toContain('Подкрепление');
  // One more action: the goblins arrive.
  await rest(page);
  await expect.poll(async () => (await toasts(page)).some(text => text.startsWith('Подкрепление:') && text.includes('гоблина') && !text.includes('клетки'))).toBe(true);
  await shot(page, 'exit-ui-reinforcement-arrived');
  expect(errors).toEqual([]);
});
