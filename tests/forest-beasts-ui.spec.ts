import { test, expect, type Page } from '@playwright/test';

// Wolf, porcupine and shaman in the real UI. What the board, the chain panel and the risk line show must come from
// the engine's forecast (`damageBySource`, `spikeDamage`, `enemyPhase.packBroken` / `empowered`) and match the executed turn.
// Field: docs/examples/forest-beasts-demo.json (editor preset «Лесные звери»), seed 6100:
// a pack of wolves at 15, 16, 23, a lone wolf at 12, a porcupine at 31, a shaman at 26 among weak goblins, the cat at 45.
test.use({ viewport: { width: 1280, height: 720 } });

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const ready = (page: Page) => expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
async function openPreset(page: Page) {
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-preset').selectOption('beasts');
  await page.locator('[data-editor="preset"]').click();
  await page.locator('#editor-play').click();
  await ready(page);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
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
}
const preview = (page: Page) => page.evaluate(() => (window as any).__PUZZLE_GAME.preview((window as any).__PUZZLE_GAME.state.chain));
const marks = (page: Page) => page.evaluate(() => (window as any).__PUZZLE_GAME.forecastMarks);
const shot = async (page: Page, name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: `artifacts/${name}.png` }); };

test('figures, pack links, summaries and the rules panel read the engine state', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page);
  const before = await state(page);
  const variants = (name: string) => before.board.map((cell: any, index: number) => cell?.variant === name ? index : -1).filter((index: number) => index >= 0);
  expect(variants('wolf')).toEqual([12, 15, 16, 23]); expect(variants('porcupine')).toEqual([31]); expect(variants('shaman')).toEqual([26]);
  // Pack wolves are armed, the lone wolf is passive; the summary counts what the engine calls ready and names the lone one.
  const armed = variants('wolf').filter((index: number) => before.board[index].intent.cells.length > 0);
  expect(armed).toEqual([15, 16, 23]); expect(before.board[12].intent.label).toBe('Одинок');
  await expect(page.locator('#intent-summary')).toContainText(`Готовы атаковать: ${armed.length}`);
  await expect(page.locator('#intent-summary')).toContainText('Одиноких волков: 1');
  await expect(page.locator('#intent-summary')).not.toContainText('Камлание');
  await page.locator('.field-details summary').click();
  for (const title of ['Волк · стая', 'Дикобраз · иглы', 'Шаман · камлание']) await expect(page.locator('.field-guide')).toContainText(title);
  await shot(page, 'beasts-board');
  expect(errors).toEqual([]);
});

test('quills: −1 ИГЛЫ on the porcupine, in the chain panel and the risk line, equal to the engine and to the executed turn', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page);
  const hp = (await state(page)).player.hp;
  await holdChain(page, [38, 31]);
  const forecast = await preview(page);
  expect(forecast.valid).toBe(true);
  expect(forecast.hits[1].spikeDamage).toBe(1); expect(forecast.spikeDamage).toBe(1); expect(forecast.damageBySource.quills).toBe(1);
  expect(Object.values(forecast.damageBySource).reduce((sum: number, value) => sum + (value as number), 0)).toBe(forecast.damage);
  expect((await marks(page)).labels).toContain('−1 ИГЛЫ');
  await expect(page.locator('#chain-reward')).toContainText('Иглы дикобраза');
  await expect(page.locator('#chain-reward')).toContainText('−1 HP');
  await expect(page.locator('#risk-preview')).toContainText(`−${forecast.damage} HP`);
  await expect(page.locator('#risk-preview')).toContainText('иглы 1');
  await shot(page, 'beasts-quills');
  await finishTurn(page);
  expect((await state(page)).player.hp).toBe(hp - forecast.damage);
  expect(errors).toEqual([]);
});

test('a frozen porcupine is shown without quills', async ({ page }) => {
  await openPreset(page);
  // Frost needs a wet target in play; the engine's own frozen-porcupine rule is tested in src/game. Here only the display is checked.
  await page.evaluate(() => { (window as any).__PUZZLE_GAME.state.board[31].status.frozen = 2; });
  await holdChain(page, [38, 31]);
  const forecast = await preview(page);
  expect(forecast.spikeDamage).toBeUndefined(); expect(forecast.damageBySource.quills).toBe(0);
  expect((await marks(page)).labels).toContain('БЕЗ ИГЛ');
  await expect(page.locator('#chain-reward')).toContainText('без игл');
  await page.mouse.up();
});

test('pack broken: the chain that leaves a wolf without a packmate marks it and cancels its strike', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page);
  const hp = (await state(page)).player.hp;
  // Wolves 16 and 23 die; wolf 15 stays alone and its announced strike is cancelled.
  await holdChain(page, [38, 31, 23, 16]);
  const forecast = await preview(page);
  const wolf15 = (await state(page)).board[15].id;
  expect(forecast.valid).toBe(true); expect(forecast.enemyPhase.packBroken).toEqual([wolf15]);
  expect((await marks(page)).labels.filter((label: string) => label === 'СТАЯ РАЗБИТА')).toHaveLength(forecast.enemyPhase.packBroken.length);
  await expect(page.locator('#chain-reward')).toContainText('Стая разбита');
  await shot(page, 'beasts-pack-broken');
  await finishTurn(page);
  const after = await state(page);
  expect(after.player.hp).toBe(hp - forecast.damage);
  expect(after.board[15]?.variant).toBe('wolf'); expect(after.board[15].intent.label).toBe('Одинок');
  // A chain that does not touch the pack marks nobody.
  await holdChain(page, (await page.evaluate(() => (window as any).__PUZZLE_GAME.availableMoves(2)[0])));
  expect((await marks(page)).labels).not.toContain('СТАЯ РАЗБИТА');
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('shaman: announced targets are marked, the forecast shows raised or cancelled rites, and both match the executed turn', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page);
  // The rite is announced on every second active phase: rest until the shaman has targets.
  for (let turn = 0; turn < 4; turn++) {
    const announced = (await state(page)).board.find((cell: any) => cell?.variant === 'shaman')?.intent.empowerIds?.length ?? 0;
    if (announced) break;
    await page.locator('#wait-button').click();
    await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
    await ready(page);
  }
  const start = await state(page);
  const shaman = start.board.find((cell: any) => cell?.variant === 'shaman');
  const ids: number[] = shaman.intent.empowerIds;
  expect(ids.length).toBeGreaterThan(0); expect(shaman.intent.empowerCells).toHaveLength(ids.length);
  await expect(page.locator('#intent-summary')).toContainText(`Камлание: ${ids.length}`);
  await shot(page, 'beasts-shaman-rite');
  // Search the engine's own forecast for one chain that cancels the rite and one that leaves it standing.
  const found = await page.evaluate((announced: number[]) => {
    const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
    let cancel: number[] | null = null, keep: number[] | null = null;
    for (const move of game.availableMoves(5)) for (let n = 2; n <= move.length; n++) {
      const path = move.slice(0, n), key = path.join(',');
      if (seen.has(key)) continue; seen.add(key);
      const p = game.preview(path); if (!p.valid || !p.enemyPhase) continue;
      const done = p.enemyPhase.empowered.length;
      if (!cancel && done < announced.length && p.damage === 0) cancel = path;
      if (!keep && done === announced.length && p.damage === 0) keep = path;
      if (cancel && keep) return { cancel, keep };
    }
    return { cancel, keep };
  }, ids);
  expect(found.keep).not.toBeNull(); expect(found.cancel).not.toBeNull();
  // Cancelled rite.
  await holdChain(page, found.cancel!);
  const cancelled = await preview(page), cancelMarks = (await marks(page)).labels;
  expect(cancelled.enemyPhase.empowered.length).toBeLessThan(ids.length);
  expect(cancelMarks).toContain('КАМЛАНИЕ ОТМЕНЕНО');
  await expect(page.locator('#chain-reward')).toContainText('Камлание отменено');
  await shot(page, 'beasts-shaman-cancelled');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).chain).toEqual([]);
  await page.mouse.up();
  // Standing rite: the forecast lists the raised targets; the executed turn raises exactly those.
  await holdChain(page, found.keep!);
  const kept = await preview(page), keptLabels = (await marks(page)).labels;
  expect(kept.enemyPhase.empowered).toHaveLength(ids.length);
  expect(keptLabels.filter((label: string) => label.startsWith('↑'))).toHaveLength(kept.enemyPhase.empowered.length);
  expect(keptLabels).not.toContain('КАМЛАНИЕ ОТМЕНЕНО');
  await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME; (window as any).__empower = [];
    game.engine.subscribe((_state: unknown, event: any) => { if (event.type === 'empower') (window as any).__empower.push({ index: event.index, tier: event.text, hp: event.amount }); });
  });
  const expected = kept.enemyPhase.empowered.map((rite: any) => ({ index: rite.index, tier: rite.tier }));
  await finishTurn(page);
  const events: { index: number; tier: string }[] = await page.evaluate(() => (window as any).__empower);
  expect(events.map(event => ({ index: event.index, tier: event.tier }))).toEqual(expected);
  await shot(page, 'beasts-shaman-after');
  expect(errors).toEqual([]);
});
