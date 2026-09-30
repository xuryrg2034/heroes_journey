import { test, expect, type Page } from '@playwright/test';

// Readability of the battle screen (playtest 1, docs/biomes/forest-map.md): the main hint is big above the field, and the
// jailer, shaman and boar telegraphs are spelled out on the field and in one line under it.
test.use({ viewport: { width: 1280, height: 720 } });

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const ready = (page: Page) => expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
const captions = (page: Page) => page.evaluate(() => (window as any).__PUZZLE_GAME.telegraphMarks as string[]);
async function openPreset(page: Page, preset: string) {
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-preset').selectOption(preset);
  await page.locator('[data-editor="preset"]').click();
  await page.locator('#editor-play').click();
  await ready(page);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
async function rest(page: Page) {
  await page.locator('#wait-button').click();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
  await ready(page);
}
const shot = async (page: Page, name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: `artifacts/${name}.png` }); };

test('the main hint: goal and one phrase above the field, gone after a click or the first turn, kept while a chain is held, back with «?»', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#tutorial-begin-button').click();
  await ready(page);
  const hint = page.locator('#battle-hint');
  await expect(hint).toBeVisible();
  await expect(page.locator('#hint-goal')).toContainText('Победи');
  const phrase = (await page.locator('#hint-rule').textContent()) ?? '';
  expect(phrase.length).toBeGreaterThan(10); expect(phrase.split(/[.!?]\s/).length).toBe(1);
  // Big text, and the whole battle still fits 1280×720.
  expect(await page.locator('#hint-goal').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);
  const status = await page.locator('#status-message').boundingBox();
  expect(status!.y + status!.height).toBeLessThanOrEqual(720);
  const board = await page.locator('#board-host').boundingBox();
  expect(board!.y + board!.height).toBeLessThanOrEqual(700);
  await shot(page, 'readability-hint');
  // A click hides it, «?» brings it back, a second «?» opens the full rules.
  await hint.click();
  await expect(hint).toBeHidden();
  await page.locator('.site-header [data-action="help"]').click();
  await expect(hint).toBeVisible(); await expect(page.locator('#modal-layer')).toBeHidden();
  await page.locator('.site-header [data-action="help"]').click();
  await expect(page.locator('#modal-layer')).toBeVisible();
  await page.locator('#modal [data-action="resume"]').click();
  // The first turn removes it.
  await page.locator('#wait-button').click();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
  await ready(page);
  await expect(hint).toBeHidden();
  // A restart shows it again.
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="retry"]').click();
  await ready(page);
  await expect(hint).toBeVisible();
  expect(errors).toEqual([]);
});

test('jailer: the closed entry, the strike cells with the damage and the counter, then «shield down — strike now»', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-tutorial="13"]').click();
  await ready(page);
  const before = await state(page);
  const jailer = before.board.find((cell: any) => cell?.variant === 'jailer');
  expect(jailer.shield).toBeTruthy(); expect(jailer.behavior.restTurns).toBe(0);
  await expect.poll(async () => (await captions(page)).includes('ВХОД ЗАКРЫТ')).toBe(true);
  const marks = await captions(page);
  expect(marks.filter(text => text === `УДАР ${jailer.intent.damage}`).length).toBe(jailer.intent.cells.length);
  expect(marks.some(text => text.startsWith('ЩИТ ') && text.includes('УДАР ПОСЛЕ ХОДА'))).toBe(true);
  await expect(page.locator('#status-message')).toContainText('Тюремщик: щит');
  await expect(page.locator('#status-message')).toContainText('вход цепи с этой стороны закрыт');
  await shot(page, 'readability-jailer-shield');
  // After the blow the jailer rests with the shield down.
  await rest(page);
  const resting = (await state(page)).board.find((cell: any) => cell?.variant === 'jailer');
  expect(resting.behavior.restTurns).toBe(1);
  await expect.poll(async () => (await captions(page)).some(text => text.startsWith('ЩИТ ОПУЩЕН'))).toBe(true);
  const after = await captions(page);
  expect(after.some(text => text.startsWith('ЩИТ ОПУЩЕН · БЕЙ СЕЙЧАС'))).toBe(true);
  expect(after).not.toContain('ВХОД ЗАКРЫТ');
  await expect(page.locator('#status-message')).toContainText('щит опущен');
  await shot(page, 'readability-jailer-rest');
  expect(errors).toEqual([]);
});

test('shaman: when, whom and what — on the field and under it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page, 'beasts');
  expect(await captions(page)).toContain('КАМЛАНИЕ ЧЕРЕЗ 2 ХОД.');
  await expect(page.locator('#status-message')).toContainText('Шаман: камлание через 2 ход');
  await expect(page.locator('#status-message')).toContainText('убей шамана или цель');
  await rest(page);
  const start = await state(page);
  const targets: number = start.board.find((cell: any) => cell?.variant === 'shaman').intent.empowerIds.length;
  expect(targets).toBeGreaterThan(0);
  const marks = await captions(page);
  expect(marks).toContain('КАМЛАНИЕ ПОСЛЕ ХОДА');
  expect(marks.filter(text => text.startsWith('↑ СТАНЕТ'))).toHaveLength(targets);
  await expect(page.locator('#status-message')).toContainText('после этого хода');
  await expect(page.locator('#status-message')).toContainText('камлание сорвётся');
  await shot(page, 'readability-shaman');
  expect(errors).toEqual([]);
});

test('boar: «УДАР 2» on the body the boar rams, «ТОЛЧОК» on the bodies it pushes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page, 'boar');
  const board = await state(page);
  const boar = board.board.find((cell: any) => cell?.variant === 'boar');
  const marks = await captions(page);
  expect(marks.filter(text => text === `УДАР ${boar.intent.damage}`)).toHaveLength(1);
  // «ТОЛЧОК» marks exactly the bodies the engine's forecast of doing nothing pushes (a weak victim dies and leaves a gap, so there may be none).
  const pushed = await page.evaluate(() => {
    const phase = (window as any).__PUZZLE_GAME.engine.previewRest().enemyPhase;
    return phase.moves.filter((move: any) => move.id !== 0 && !phase.rams.some((ram: any) => ram.id === move.id || ram.boarId === move.id)).length;
  });
  expect(marks.filter(text => text === 'ТОЛЧОК')).toHaveLength(pushed);
  await expect(page.locator('#status-message')).toContainText('«УДАР 2» — только первому в ряду');
  await expect(page.locator('#status-message')).toContainText('«ТОЛКАЕТ»');
  await shot(page, 'readability-boar');
  expect(errors).toEqual([]);
});
