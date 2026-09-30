import { test, expect, type Page } from '@playwright/test';

// The boar, spiked sides, thorns and the archer's line in the real UI: the forecast the renderer draws
// (push arrows, crosses, cat cell) must come from the engine's preview and match the executed turn.
test.use({ viewport: { width: 1280, height: 720 } });

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const ready = (page: Page) => expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
async function openLevel(page: Page, definition?: unknown) {
  await page.goto('/');
  await page.locator('#editor-button').click();
  if (definition) {
    await page.locator('#editor-json').fill(JSON.stringify(definition));
    await page.locator('[data-editor="import"]').click();
  } else {
    await page.locator('#editor-preset').selectOption('boar');
    await page.locator('[data-editor="preset"]').click();
  }
  await page.locator('#editor-play').click();
  await ready(page);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
/** Hold a chain without releasing it: the forecast is a chain-building aid. */
async function holdChain(page: Page, path: number[]) {
  await page.locator('#board-host').scrollIntoViewIfNeeded();
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

/** 5×5: the cat in the bottom-left corner, a boar at the right end of row 3 and a spiked left side. */
function spikeField() {
  const cols = 5, rows = 5, at = (x: number, y: number) => y * cols + x, enemies: unknown[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (x === 0 && y === 4) continue;
    if (x === 4 && y === 3) enemies.push({ index: at(x, y), kind: 'melee', variant: 'boar', color: 1, hp: 3 });
    else enemies.push({ index: at(x, y), kind: 'melee', color: y === 3 ? 0 : 1, hp: 0 });
  }
  return { version: 1, name: 'Шипы слева', seed: 7, cols, rows, terrain: Array(cols * rows).fill('floor'), heroIndex: at(0, 4), enemies, doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [], spikedEdges: ['left'], playerHp: 6 };
}

test('boar preset: the push forecast shows arrows, crosses and matches the executed turn', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openLevel(page);
  const before = await state(page);
  expect(before.board.some((cell: any) => cell?.variant === 'boar')).toBe(true);
  await expect(page.locator('#intent-summary')).toContainText('Готовы атаковать: 2');
  await holdChain(page, [38, 31]);
  const forecast = await preview(page);
  expect(forecast.valid).toBe(true);
  const phase = forecast.enemyPhase;
  expect(phase.moves.length).toBeGreaterThan(0);
  const drawn = await marks(page);
  expect(drawn.crosses).toBe(phase.deaths.length);
  expect(drawn.ghosts).toBe(phase.moves.filter((move: any) => move.id !== 0).length);
  expect(drawn.chevrons).toBeGreaterThanOrEqual(phase.moves.length);
  expect(drawn.heroGhost).toBe(phase.heroIndex !== forecast.endIndex);
  expect(drawn.labels).toEqual(expect.arrayContaining(['УДАР', 'СТРЕЛА']));
  await expect(page.locator('#chain-reward')).toContainText('После цепи погибнут');
  await page.screenshot({ path: 'artifacts/boar-forecast.png' });
  await finishTurn(page);
  await ready(page);
  const after = await state(page);
  expect(after.player.index).toBe(phase.heroIndex);
  expect(after.board[phase.charges[0].to]?.variant).toBe('boar');
  expect(after.player.hp).toBe(before.player.hp - forecast.damage);
  expect(await marks(page)).toMatchObject({ crosses: 0, chevrons: 0 });
  expect(errors).toEqual([]);
});

test('spiked side: the forecast crosses the victim and the cat, the risk line names the boar', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openLevel(page, spikeField());
  // The cat is pushed onto the spikes: 1 damage from the boar's charge, named in the risk line.
  await holdChain(page, [15, 16]);
  let forecast = await preview(page);
  expect(forecast.chargeDamage).toBe(1);
  await expect(page.locator('#risk-preview')).toContainText('кабан');
  await expect(page.locator('#risk-preview')).toContainText('−1 HP');
  const hpBefore = (await state(page)).player.hp;
  await finishTurn(page);
  await ready(page);
  expect((await state(page)).player.hp).toBe(hpBefore - forecast.damage);
  expect((await state(page)).player.index).toBe(forecast.enemyPhase.heroIndex);
  await openLevel(page, spikeField());
  // Enemies die on the spikes: crosses labelled ШИПЫ; execution removes them.
  await holdChain(page, [21, 22]);
  forecast = await preview(page);
  const spiked = forecast.enemyPhase.deaths.filter((death: any) => death.cause === 'spikes');
  expect(spiked.length).toBeGreaterThan(0);
  expect((await marks(page)).labels).toContain('ШИПЫ');
  await page.screenshot({ path: 'artifacts/boar-spikes.png' });
  const kills = (await state(page)).objective.kills;
  await finishTurn(page);
  await ready(page);
  const after = await state(page);
  // Deaths on the spikes are the boar's, not the player's (playtest 1 rule): only the two chain kills are credited.
  expect(after.objective.kills).toBe(kills + 2);
  expect(after.player.hp).toBe(6 - forecast.damage);
  expect(errors).toEqual([]);
});

test('editor: thorns and enemies coexist, spiked sides are outlined, the preset is valid', async ({ page }) => {
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-preset').selectOption('boar');
  await page.locator('[data-editor="preset"]').click();
  await expect(page.locator('#editor-grid')).toHaveAttribute('style', /inset 0 -6px 0/);
  const draft = async () => { await page.locator('[data-editor="export"]').click(); return JSON.parse(await page.locator('#editor-json').inputValue()); };
  const brush = async (value: string, index: number) => { await page.locator('#editor-brush').selectOption(value); await page.locator(`[data-cell="${index}"]`).click(); };
  const first = await draft();
  expect(first.enemies.some((enemy: any) => enemy.variant === 'boar')).toBe(true);
  expect(first.terrain.filter((kind: string) => kind === 'thorns').length).toBeGreaterThan(0);
  // Thorns painted under a goblin keep the goblin; a wall removes it whole.
  await brush('terrain:thorns', 8);
  let next = await draft();
  expect(next.terrain[8]).toBe('thorns');
  expect(next.enemies.some((enemy: any) => enemy.index === 8)).toBe(true);
  await expect(page.locator('[data-cell="8"] .editor-terrain-mark')).toHaveCount(1);
  await brush('terrain:puddle', 8);
  next = await draft();
  expect(next.terrain[8]).toBe('puddle');
  expect(next.enemies.some((enemy: any) => enemy.index === 8)).toBe(true);
  await brush('terrain:wall', 8);
  next = await draft();
  expect(next.terrain[8]).toBe('wall');
  expect(next.enemies.some((enemy: any) => enemy.index === 8)).toBe(false);
  // An enemy painted on thorns keeps the thorns; on a wall it turns the cell into floor.
  await brush('terrain:thorns', 9);
  await page.locator('#editor-brush').selectOption('enemy');
  await page.locator('#editor-enemy-kind').selectOption('boar');
  await page.locator('[data-cell="9"]').click();
  next = await draft();
  expect(next.terrain[9]).toBe('thorns');
  expect(next.enemies.find((enemy: any) => enemy.index === 9)).toMatchObject({ variant: 'boar', hp: 3 });
  await page.locator('#editor-brush').selectOption('enemy');
  await page.locator('[data-cell="8"]').click();
  next = await draft();
  expect(next.terrain[8]).toBe('floor');
  // Spiked-side flags round-trip through the draft.
  await page.locator('[data-spiked-edge="left"]').check();
  next = await draft();
  expect(next.spikedEdges).toEqual(expect.arrayContaining(['bottom', 'left']));
  await page.locator('#editor-play').click();
  await ready(page);
  const played = await state(page);
  expect(played.terrain[9]).toBe('thorns');
  expect(played.board[9]?.variant).toBe('boar');
  await page.locator('.field-guide').scrollIntoViewIfNeeded();
});

test('guide names the boar, the spiked sides and the thorns', async ({ page }) => {
  await openLevel(page);
  const guide = page.locator('.field-guide');
  await expect(guide).toContainText('Кабан');
  await expect(guide).toContainText('Шипы по краю');
  await expect(guide).toContainText('Колючки');
  await expect(page.locator('#intent-summary')).toContainText('Готовы атаковать');
  await page.screenshot({ path: 'artifacts/boar-initial.png' });
});

/** 5×5: a boar whose row is held by a boss cannot move and is stunned. */
function stunField() {
  const cols = 5, rows = 5, at = (x: number, y: number) => y * cols + x, enemies: unknown[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (x === 0 && y === 4) continue;
    if (x === 4 && y === 4) enemies.push({ index: at(x, y), kind: 'melee', variant: 'boar', color: 1, hp: 3 });
    else if (x === 3 && y === 4) enemies.push({ index: at(x, y), kind: 'boss', color: null, hp: 20 });
    else enemies.push({ index: at(x, y), kind: 'melee', color: (x + y) % 2, hp: 0 });
  }
  return { version: 1, name: 'Оглушение', seed: 11, cols, rows, terrain: Array(cols * rows).fill('floor'), heroIndex: at(0, 4), enemies, doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [], playerHp: 6 };
}

test('a boar that cannot move is forecast as stunned and shows the stun mark afterwards', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openLevel(page, stunField());
  await holdChain(page, [15, 21]);
  const forecast = await preview(page);
  expect(forecast.enemyPhase.charges[0].stunned).toBe(true);
  expect((await marks(page)).labels).toContain('ОГЛУШИТСЯ');
  await expect(page.locator('#chain-reward')).toContainText('оглушится');
  await finishTurn(page);
  await ready(page);
  const boar = (await state(page)).board.find((cell: any) => cell?.variant === 'boar');
  expect(boar).toMatchObject({ behavior: { restTurns: 1 }, status: { brittle: true } });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'artifacts/boar-stunned.png' });
  expect(errors).toEqual([]);
});
