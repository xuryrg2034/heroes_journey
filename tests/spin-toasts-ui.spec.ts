import { test, expect, type Page } from '@playwright/test';
import { createForestRun, enterNode, resolveBattle, serializeForestRun, type ForestRunState, type ForestRunStep } from '../src/game/run/forestRun';

// Council item 21: the spin is chosen in two steps with a forecast (like the jump), and short notes by the field say what
// an enemy effect just did. Numbers and events come from the engine.
test.use({ viewport: { width: 1280, height: 720 } });

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const ready = (page: Page) => expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
const preview = (page: Page) => page.evaluate(() => (window as any).__PUZZLE_GAME.preview((window as any).__PUZZLE_GAME.state.chain));
const marks = (page: Page) => page.evaluate(() => (window as any).__PUZZLE_GAME.forecastMarks);
const shot = async (page: Page, name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: `artifacts/${name}.png` }); };
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
function ok(step: ForestRunStep): ForestRunState { if (!step.ok) throw new Error(step.reason); return step.run; }
/** A run at the fork with a healthy cat, then a map battle of the given lesson started on the engine at the given map row. */
async function mapBattle(page: Page, row: number, lessonIndex: number) {
  await openMapRun(page);
  await startSpinBattle(page, row, lessonIndex);
}
async function openMapRun(page: Page) {
  let run = createForestRun(1);
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) {
    run = ok(enterNode(run, id));
    run = ok(resolveBattle(run, { nodeId: id, won: true, player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { ...run.resources.inventory } }));
  }
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } },
    ['ashen-oath-forest-run-v1', serializeForestRun(run)]);
  await page.goto('/'); await page.locator('#run-start-button').click();
  await page.locator('.map-node[data-node="beast-wolf"]').click(); await ready(page);
}
async function startSpinBattle(page: Page, row: number, lessonIndex: number) {
  await page.evaluate(([row, index]) => {
    const engine = (window as any).__PUZZLE_GAME.engine;
    if (!engine.startRunBattle({ nodeId: 'beast-wolf', label: 'Проба', row, seed: 4242, template: { kind: 'lesson', index }, player: { hp: 40, maxHp: 40, energy: 7 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: ['spin'] })) throw new Error('startRunBattle failed');
  }, [row, lessonIndex] as const);
  await ready(page);
}
async function openPreset(page: Page, preset: string) {
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-preset').selectOption(preset);
  await page.locator('[data-editor="preset"]').click();
  await page.locator('#editor-play').click();
  await ready(page);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
const settle = async (page: Page) => { await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/); await ready(page); };

test('spin: the first press shows zone, damage, deaths and the answer; nothing is spent until it is confirmed; Esc cancels', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mapBattle(page, 5, 0);
  const before = await state(page);
  await page.locator('#spin-ability').click();
  await expect.poll(async () => (await state(page)).chosenAbility).toBe('spin');
  const forecast = await page.evaluate(() => (window as any).__PUZZLE_GAME.previewAbility('spin'));
  expect(forecast.valid).toBe(true); expect(forecast.hits.length).toBeGreaterThan(0);
  const killed = forecast.hits.filter((hit: any) => hit.killed).length;
  await expect(page.locator('#status-message')).toContainText(`Круговой удар: целей ${forecast.hits.length}, погибнет ${killed}`);
  await expect(page.locator('#status-message')).toContainText('Ещё раз');
  await expect(page.locator('#risk-preview')).toContainText('Круговой');
  // One plate per target with its damage, as the engine forecasts it.
  await expect.poll(async () => (await page.evaluate(() => (window as any).__PUZZLE_GAME.telegraphMarks as string[])).filter(text => text.startsWith('−') ).length).toBe(forecast.hits.length);
  await shot(page, 'spin-preview');
  // Nothing happened yet.
  const pending = await state(page);
  expect(pending.turn).toBe(before.turn); expect(pending.player.energy).toBe(before.player.energy); expect(pending.board).toEqual(before.board);
  // The panel keeps its height, so the button stays under the pointer for the second press.
  const box = await page.locator('#spin-ability').boundingBox(); await page.waitForTimeout(300);
  expect((await page.locator('#spin-ability').boundingBox())!.y).toBe(box!.y);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).chosenAbility).toBeNull();
  expect((await state(page)).turn).toBe(before.turn); expect((await state(page)).player.energy).toBe(before.player.energy);
  expect(errors).toEqual([]);
});

for (const way of ['the button again', 'a click on the cat', 'Enter'] as const) {
  test(`spin is confirmed by ${way}, and the result equals the forecast`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await mapBattle(page, 5, 0);
    const before = await state(page);
    await page.locator('#spin-ability').click();
    await expect.poll(async () => (await state(page)).chosenAbility).toBe('spin');
    const forecast = await page.evaluate(() => (window as any).__PUZZLE_GAME.previewAbility('spin'));
    if (way === 'the button again') await page.locator('#spin-ability').click();
    else if (way === 'a click on the cat') {
      const at = await page.evaluate(index => (window as any).__PUZZLE_GAME.gridToScreen(index), before.player.index);
      await page.mouse.click(at.x, at.y);
    } else { await page.locator('#board-host').focus().catch(() => {}); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press('Enter'); }
    await expect.poll(async () => (await state(page)).turn).toBe(before.turn + 1);
    await settle(page);
    const after = await state(page);
    expect(after.chosenAbility).toBeNull();
    expect(after.player.index).toBe(before.player.index);
    expect(after.objective.kills - before.objective.kills).toBe(forecast.hits.filter((hit: any) => hit.killed).length);
    expect(after.player.hp).toBe(before.player.hp - forecast.damage);
    expect(after.player.energy).toBeCloseTo(before.player.energy - forecast.energyCost + forecast.energyGain, 5);
    expect(errors).toEqual([]);
  });
}

/** Record every note the page shows (and the most that were on screen at once). */
async function watchToasts(page: Page) {
  await page.evaluate(() => {
    const host = document.getElementById('battle-toasts')!, seen: string[] = []; let most = 0;
    (window as any).__toasts = { seen, most: () => most };
    new MutationObserver(() => { most = Math.max(most, host.children.length); for (const child of host.children) if (!seen.includes(child.textContent ?? '')) seen.push(child.textContent ?? ''); }).observe(host, { childList: true, characterData: true, subtree: true });
  });
}
const seenToasts = (page: Page) => page.evaluate(() => (window as any).__toasts.seen as string[]);

test('notes by the field: shaman rite, then they vanish by themselves; nothing modal, at most three', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page, 'beasts');
  await watchToasts(page);
  await page.locator('#wait-button').click(); await settle(page); // the rite is announced
  await page.mouse.move(5, 5);
  await page.locator('#wait-button').click(); await settle(page); // and performed
  await expect.poll(async () => (await seenToasts(page)).some(text => text.startsWith('Шаман усилил гоблина'))).toBe(true);
  await expect(page.locator('#modal-layer')).toBeHidden();
  await shot(page, 'toasts-shaman');
  expect(await page.evaluate(() => (window as any).__toasts.most())).toBeLessThanOrEqual(3);
  await expect(page.locator('#battle-toasts .battle-toast')).toHaveCount(0, { timeout: 8000 });
  expect(errors).toEqual([]);
});

test('notes by the field: the boar and the archer', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page, 'boar');
  await watchToasts(page);
  await page.locator('#wait-button').click(); await settle(page);
  const texts = await seenToasts(page);
  expect(texts.some(text => text.startsWith('Кабан'))).toBe(true);
  expect(texts.some(text => text.startsWith('Стрела лучника убила врага'))).toBe(true);
  await shot(page, 'toasts-boar');
  expect(await page.evaluate(() => (window as any).__toasts.most())).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('notes by the field: the troll club', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page, 'troll');
  await watchToasts(page);
  await page.locator('#wait-button').click(); await settle(page); // the club goes up
  await page.mouse.move(5, 5);
  await page.locator('#wait-button').click(); await settle(page); // and falls
  await expect.poll(async () => (await seenToasts(page)).some(text => text.startsWith('Дубина убила врага'))).toBe(true);
  expect(errors).toEqual([]);
});
