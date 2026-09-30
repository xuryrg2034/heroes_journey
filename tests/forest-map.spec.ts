import { test, expect, type Page } from '@playwright/test';
import { FOREST_MAP } from '../src/game/run/forestMap';
import { chooseFindItem, createForestRun, enterNode, resolveBattle, serializeForestRun, type ForestRunState, type ForestRunStep } from '../src/game/run/forestRun';

// Forest map screen (docs/biomes/forest-map.md). The run model is tested in src/game/forestRun.spec.ts;
// here the real page is driven: title entry, map, node battles, rest, find, reload, defeat and both bosses.
// Saved runs are built with the pure model and injected through localStorage, so long routes stay fast.
test.use({ viewport: { width: 1280, height: 720 } });

const RUN_KEY = 'ashen-oath-forest-run-v1';
const JOURNAL_KEY = 'ashen-oath-playtest-v1';
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const savedRun = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), RUN_KEY);
const center = (page: Page, index: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index);
async function settled(page: Page) {
  await expect.poll(async () => (await state(page)).phase, { timeout: 15_000 }).not.toMatch(/TITLE|RESOLVE|UPDATE/);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
async function draw(page: Page, path: number[]) {
  const first = await center(page, path[0]);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const index of path.slice(1)) { const point = await center(page, index); await page.mouse.move(point.x, point.y, { steps: 4 }); }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  await page.mouse.up(); await settled(page);
}
const node = (page: Page, id: string) => page.locator(`.map-node[data-node="${id}"]`);
const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1);

function ok(step: ForestRunStep): ForestRunState { if (!step.ok) throw new Error(step.reason); return step.run; }
/** Finish the pending battle as a won one with the given HP. */
function won(run: ForestRunState, hp = 5): ForestRunState {
  const pending = run.pending; if (pending?.kind !== 'battle') throw new Error('no battle');
  return ok(resolveBattle(run, { nodeId: pending.nodeId, won: true, player: { hp, maxHp: 5, energy: run.resources.player.energy }, inventory: { ...run.resources.inventory } }));
}
/** Walk the given node ids: battles are won, finds take the first option. */
function walk(ids: string[], hp = 5, seed = 4242): ForestRunState {
  let run = createForestRun(seed);
  for (const id of ids) {
    run = ok(enterNode(run, id));
    if (run.pending?.kind === 'battle') run = won(run, hp);
    // A find follows a find node and, in the model, an elite victory.
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]));
  }
  return run;
}
const TRUNK = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4'];
const TO_JAILER = [...TRUNK, 'beast-wolf', 'beast-boar', 'trail-find', 'trail-banners', 'jailer'];
/** Seed a saved run once per tab: a reload keeps whatever the page saved afterwards. */
async function seedRun(page: Page, run: ForestRunState) {
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); }
  }, [RUN_KEY, serializeForestRun(run)]);
}
const failOnDialog = (page: Page) => page.on('dialog', dialog => { throw new Error(`window.${dialog.type()} is not allowed: ${dialog.message()}`); });

test('title starts a run, the map shows graph, statuses, hover details and resources in 1280x720', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  await page.goto('/');
  await expect(page.locator('#run-start-button')).toContainText('ПОХОД ПО ЛЕСУ');
  await page.screenshot({ path: 'artifacts/forest-map-title.png' });
  await page.locator('#run-start-button').click();
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(page.locator('.map-node')).toHaveCount(FOREST_MAP.length);
  // Only the first trunk battle is open; everything else is closed.
  await expect(page.locator('.map-node[data-status="available"]')).toHaveCount(1);
  await expect(node(page, 'trunk-1')).toHaveAttribute('data-status', 'available');
  await expect(node(page, 'trunk-2')).toHaveAttribute('data-status', 'locked');
  // Resources: 5 HP, 0/7 energy, no tools, 0 battles.
  await expect(page.locator('#map-hp .heart.full')).toHaveCount(5);
  await expect(page.locator('#map-energy')).toContainText('0 / 7');
  await expect(page.locator('#map-tools')).toContainText('пока закрыты');
  await expect(page.locator('#map-battles')).toContainText('0');
  // Both branches are visible: beast trail and goblin barricade, den to the Troll and camp to the Chief.
  await expect(page.locator('.map-lane-tag')).toHaveText(['Звериная тропа', 'Гоблинская засека', 'Логово зверей → Тролль', 'Лагерь гоблинов → Главарь']);
  await expect(node(page, 'den-troll')).not.toContainText('в разработке');
  expect(await noScroll(page)).toBe(true);
  // Every node fits the first screen, the last row included.
  const box = await page.locator('#map-board').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(720); expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  await node(page, 'beast-wolf').hover();
  await expect(page.locator('#map-detail')).toContainText('Особенность поля: Стая волков');
  await expect(page.locator('#map-detail')).not.toContainText('временно');
  await expect(page.locator('#map-detail')).toContainText('Открывает: Холод');
  await expect(page.locator('#map-detail')).toContainText('Цветов в пополнении');
  // A node whose battle is still a stand-in carries the «временно» mark.
  await node(page, 'den-elite').hover();
  await expect(page.locator('#map-detail')).toContainText('временно');
  await node(page, 'den-troll').hover();
  await expect(page.locator('#map-detail')).toContainText('Тролль, стая и жаровня');
  await expect(page.locator('#map-detail')).not.toContainText('в разработке');
  await expect(page.locator('#map-detail')).toContainText('Босс');
  await node(page, 'trail-rest').hover();
  await expect(page.locator('#map-detail')).toContainText('Привал');
  await node(page, 'trunk-4').hover();
  await expect(page.locator('#map-detail')).toContainText('Рычаг стрел');
  await expect(page.locator('#map-detail')).not.toContainText('временно');
  // A closed node cannot be entered.
  await node(page, 'trunk-2').click({ force: true });
  await expect(page.locator('#map-screen')).toBeVisible(); expect((await savedRun(page)).pending).toBeNull();
  await node(page, 'trunk-1').hover();
  await page.screenshot({ path: 'artifacts/forest-map-start.png' });
  expect(errors).toEqual([]);
});

test('a node battle is played by mouse and returns to the map with the result saved', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#run-start-button').click();
  await node(page, 'trunk-1').click(); await settled(page);
  expect(await savedRun(page)).toMatchObject({ pending: { kind: 'battle', nodeId: 'trunk-1', defeats: 0 } });
  const entry = await state(page);
  expect(entry.runNode.nodeId).toBe('trunk-1'); expect(entry.player.hp).toBe(5);
  await expect(page.locator('#chapter-number')).toContainText('ПОХОД');
  await expect(page.locator('#chapter-number')).not.toContainText('/ 16');
  await expect(page.locator('.chapter-select')).toHaveText('← К КАРТЕ');
  await page.screenshot({ path: 'artifacts/forest-map-battle.png' });
  // The first trunk route, as in trunk.spec.ts: E2-E3-E4 (blue), then D3-C4-B3-A2-A3 (red).
  await draw(page, [9, 14, 19]);
  await draw(page, [13, 17, 11, 5, 10]);
  expect((await state(page)).phase).toBe('WIN');
  await expect(page.locator('#modal [data-action="run-map"]')).toContainText('К КАРТЕ');
  // The model got the result right away: a reload here would land on the map, not in a replayed battle.
  expect(await savedRun(page)).toMatchObject({ visited: ['trunk-1'], currentNodeId: 'trunk-1', pending: null });
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(node(page, 'trunk-1')).toHaveAttribute('data-status', 'current');
  await expect(node(page, 'trunk-2')).toHaveAttribute('data-status', 'available');
  await expect(page.locator('#map-battles')).toContainText('1');
  await expect(page.locator('#map-notice')).toContainText('пройден');
  expect(await noScroll(page)).toBe(true);
  // Telemetry records the attempt under the node key.
  const attempts = (await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), JOURNAL_KEY)).attempts;
  expect(attempts.map((attempt: any) => [attempt.key, attempt.mode, attempt.outcome])).toContainEqual(['run:trunk-1', 'run', 'win']);
  expect(errors).toEqual([]);
});

test('HP and items carry between nodes; rest heals and reports the amount; find offers one of three', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seedRun(page, walk(TRUNK));
  await page.goto('/');
  await expect(page.locator('#run-start-button')).toContainText('ПРОДОЛЖИТЬ ПОХОД');
  await page.locator('#run-start-button').click();
  await expect(node(page, 'beast-wolf')).toHaveAttribute('data-status', 'available');
  await expect(node(page, 'goblin-archer')).toHaveAttribute('data-status', 'available');
  await expect(node(page, 'trunk-4')).toHaveAttribute('data-status', 'current');
  // Beast wolf: lose 3 HP in the real engine, win, and the map shows 2 HP and the opened frost.
  await node(page, 'beast-wolf').click(); await settled(page);
  expect((await state(page)).runNode.allowedItems).toEqual(['frost']);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.damagePlayer(3));
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(page.locator('#map-hp .heart.full')).toHaveCount(2);
  await expect(page.locator('#map-hp .heart.empty')).toHaveCount(3);
  await expect(page.locator('#map-tools')).toContainText('Холод');
  expect((await savedRun(page)).resources.player.hp).toBe(2);
  await expect(page.locator('#map-notice')).toContainText('Открыто: Холод');
  // Rest: +2 HP, the modal says how much was healed.
  await node(page, 'trail-rest').click();
  await expect(page.locator('#rest-copy')).toContainText('Вылечено: 2 HP');
  await expect(page.locator('#rest-copy')).toContainText('4 / 5');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/forest-map-rest.png' });
  await page.locator('#modal [data-action="resume"]').click();
  await expect(page.locator('#map-hp .heart.full')).toHaveCount(4);
  await expect(node(page, 'trail-rest')).toHaveAttribute('data-status', 'current');
  expect((await savedRun(page)).visited).toContain('trail-rest');
  expect(errors).toEqual([]);
});

test('find node: choice of one of three items, saved, opened for later battles', async ({ page }) => {
  await seedRun(page, walk([...TRUNK, 'beast-wolf', 'beast-boar']));
  await page.goto('/'); await page.locator('#run-start-button').click();
  await node(page, 'trail-find').click();
  await expect(page.locator('#modal [data-find]')).toHaveCount(3);
  expect((await savedRun(page)).pending.kind).toBe('find');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/forest-map-find.png' });
  // A reload with an open find returns to the same choice.
  await page.reload(); await page.locator('#run-start-button').click();
  await expect(page.locator('#modal [data-find]')).toHaveCount(3);
  const options: string[] = (await savedRun(page)).pending.options;
  await page.locator(`#modal [data-find="${options[1]}"]`).click();
  await expect(page.locator('#modal-layer')).toBeHidden();
  const run = await savedRun(page);
  expect(run.pending).toBeNull(); expect(run.currentNodeId).toBe('trail-find');
  expect(run.resources.inventory[options[1]]).toBeGreaterThanOrEqual(1);
  expect(run.tools.items).toContain(options[1]); expect(run.tools.abilities).toContain('jump');
  await expect(page.locator('#map-notice')).toContainText('Взято');
  await expect(page.locator('#map-tools')).toContainText('Прыжок');
  await expect(node(page, 'trail-banners')).toHaveAttribute('data-status', 'available');
});

test('reload keeps the run: map position and the start of an unfinished node battle', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#run-start-button').click();
  await node(page, 'trunk-1').click(); await settled(page);
  const entry = await state(page);
  await draw(page, [9, 14, 19]);
  expect((await state(page)).objective.kills).toBe(3);
  // The model does not save a battle in progress: Continue starts the node again from the entry snapshot.
  await page.reload();
  await expect(page.locator('#run-start-button')).toContainText('ПРОДОЛЖИТЬ ПОХОД');
  await page.locator('#run-start-button').click(); await settled(page);
  const restored = await state(page);
  expect(restored.runNode.nodeId).toBe('trunk-1'); expect(restored.objective.kills).toBe(0); expect(restored.turn).toBe(0);
  expect(restored.board).toEqual(entry.board);
  // A finished node comes back as a map position.
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await page.locator('#modal [data-action="run-map"]').click();
  await page.reload();
  await page.locator('#run-start-button').click();
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(node(page, 'trunk-1')).toHaveAttribute('data-status', 'current');
  await expect(node(page, 'trunk-2')).toHaveAttribute('data-status', 'available');
  expect(errors).toEqual([]);
});

test('defeat keeps the node current: retry restores the entry, map offers to return to the battle, telemetry stays intact', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seedRun(page, walk(['trunk-1', 'trunk-2', 'trunk-3']));
  await page.goto('/'); await page.locator('#run-start-button').click();
  await node(page, 'trunk-4').click(); await settled(page);
  const entry = await state(page);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.damagePlayer(9));
  await expect(page.locator('#modal')).toContainText('Кот отступил');
  await expect(page.locator('#modal [data-action="retry"]')).toContainText('ПОВТОРИТЬ УЗЕЛ');
  await expect(page.locator('#modal [data-action="run-map"]')).toContainText('К КАРТЕ');
  await expect(page.locator('#modal [data-action="title"]')).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/forest-map-defeat.png' });
  expect(await savedRun(page)).toMatchObject({ currentNodeId: 'trunk-3', pending: { kind: 'battle', nodeId: 'trunk-4', defeats: 1 } });
  await page.locator('#modal [data-action="retry"]').click(); await settled(page);
  const retried = await state(page);
  expect(retried.board).toEqual(entry.board); expect(retried.player.hp).toBe(5); expect(retried.runNode.nodeId).toBe('trunk-4');
  await page.evaluate(() => (window as any).__PUZZLE_GAME.damagePlayer(9));
  expect(await savedRun(page)).toMatchObject({ pending: { defeats: 2 } });
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(node(page, 'trunk-4')).toHaveAttribute('data-status', 'in-progress');
  await expect(page.locator('.map-node[data-status="available"]')).toHaveCount(0);
  await expect(page.locator('.map-banner')).toContainText('поражений: 2');
  await page.screenshot({ path: 'artifacts/forest-map-pending.png' });
  await page.locator('.map-banner [data-action="run-battle"]').click(); await settled(page);
  expect((await state(page)).board).toEqual(entry.board);
  // Pause dialog of a node battle: retry and the map.
  await page.locator('[data-action="pause"]').click();
  await expect(page.locator('#modal [data-action="retry"]')).toContainText('ПОВТОРИТЬ УЗЕЛ');
  await expect(page.locator('#modal [data-action="run-map"]')).toBeVisible();
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(page.locator('#map-screen')).toBeVisible();
  // Telemetry: the journal has the node key, the map screen opens the playtest table without errors.
  const attempts = (await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), JOURNAL_KEY)).attempts;
  const mine = attempts.filter((attempt: any) => attempt.key === 'run:trunk-4');
  expect(mine.map((attempt: any) => attempt.outcome)).toEqual(['lose', 'lose', 'quit']);
  expect(mine.every((attempt: any) => attempt.mode === 'run' && attempt.id === 'trunk-4')).toBe(true);
  await page.locator('.playtest-link').click();
  await expect(page.locator('.playtest-table')).toContainText('Карта леса · Чужие стрелы');
  await page.locator('[data-action="playtest-close"]').click();
  expect(errors).toEqual([]);
});

test('the Troll is a real battle node; beating him wins the run; reset asks for confirmation on the page', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  await seedRun(page, walk([...TO_JAILER, 'den-battle', 'den-rest', 'den-elite', 'den-breakthrough'], 4));
  await page.goto('/'); await page.locator('#run-start-button').click();
  await expect(node(page, 'den-troll')).toHaveAttribute('data-status', 'available');
  await expect(node(page, 'den-troll')).not.toContainText('в разработке');
  await expect(node(page, 'camp-chief')).toHaveAttribute('data-status', 'locked');
  await node(page, 'den-troll').click(); await settled(page);
  const battle = await state(page);
  expect(battle.runNode.nodeId).toBe('den-troll');
  expect(battle.board.some((cell: any) => cell?.variant === 'troll')).toBe(true);
  expect(battle.player.hp).toBe(4);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await expect(page.locator('#modal')).toContainText('ПОХОД ЗАВЕРШЁН');
  await expect(page.locator('#modal .outcome-symbol')).toHaveText('✦');
  await expect(page.locator('#modal')).not.toContainText('в разработке');
  await expect(page.locator('#modal [data-action="run-new"]')).toContainText('НОВЫЙ ПОХОД');
  await expect(page.locator('#modal [data-action="title"]')).toContainText('В МЕНЮ');
  expect((await savedRun(page)).result).toMatchObject({ outcome: 'victory', nodeId: 'den-troll' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/forest-map-troll.png' });
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(node(page, 'den-troll')).toHaveAttribute('data-status', 'current');
  await expect(page.locator('.map-node[data-status="available"]')).toHaveCount(0);
  // The finished run stays saved and is shown again after a reload.
  await page.reload();
  await expect(page.locator('#run-start-button')).toContainText('ИТОГ ПОХОДА');
  // Reset: cancel keeps the save, confirm starts a new run.
  await page.locator('#run-reset-button').click();
  await expect(page.locator('.run-confirm')).toContainText('Стереть сохранённый поход?');
  await page.locator('.run-confirm [data-action="run-reset-no"]').click();
  await expect(page.locator('.run-confirm')).toHaveCount(0);
  expect((await savedRun(page)).result).not.toBeNull();
  await page.locator('#run-reset-button').click();
  await page.locator('.run-confirm [data-action="run-reset-yes"]').click();
  await expect(page.locator('#map-screen')).toBeVisible();
  const fresh = await savedRun(page);
  expect(fresh.visited).toEqual([]); expect(fresh.result).toBeNull(); expect(fresh.resources.player.hp).toBe(5);
  await expect(node(page, 'trunk-1')).toHaveAttribute('data-status', 'available');
  // The same confirmation on the map.
  await page.locator('.map-actions [data-action="run-reset"]').click();
  await expect(page.locator('.map-confirm')).toContainText('Сбросить поход');
  await page.locator('.map-confirm [data-action="run-reset-no"]').click();
  await expect(page.locator('.map-confirm')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Chief is a real battle node; beating him ends the run with a victory', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seedRun(page, walk([...TO_JAILER, 'camp-battle', 'camp-rest', 'camp-elite', 'camp-breakthrough']));
  await page.goto('/'); await page.locator('#run-start-button').click();
  await node(page, 'camp-chief').click(); await settled(page);
  const battle = await state(page);
  expect(battle.runNode.nodeId).toBe('camp-chief');
  // An ordinary authored battle: the Chief stands on the field from the start, no waves.
  expect(battle.board.some((cell: any) => cell?.kind === 'boss' && !cell.variant)).toBe(true);
  await expect(page.locator('#chapter-number')).toContainText('ПОХОД');
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await expect(page.locator('#modal')).toContainText('Главарь повержен');
  await expect(page.locator('#modal [data-action="run-new"]')).toBeVisible();
  expect((await savedRun(page)).result).toMatchObject({ outcome: 'victory', nodeId: 'camp-chief' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/forest-map-victory.png' });
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(node(page, 'camp-chief')).toHaveAttribute('data-status', 'current');
  await page.screenshot({ path: 'artifacts/forest-map-late.png' });
  expect(errors).toEqual([]);
});

test('Jailer victory reports the opened spin; an elite victory leads to a find of one of three', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seedRun(page, walk([...TRUNK, 'beast-wolf', 'beast-boar', 'trail-find', 'trail-banners']));
  await page.goto('/'); await page.locator('#run-start-button').click();
  await node(page, 'jailer').hover();
  await expect(page.locator('#map-detail')).toContainText('После победы открывает: Круговой удар');
  await node(page, 'jailer').click(); await settled(page);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await expect(page.locator('#modal')).toContainText('Открыто: Круговой удар');
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(page.locator('#map-notice')).toContainText('Круговой удар');
  await expect(page.locator('#map-tools')).toContainText('Круговой удар');
  await node(page, 'den-battle').click(); await settled(page);
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await page.locator('#modal [data-action="run-map"]').click();
  // A rest always comes right before an elite.
  await expect(node(page, 'den-elite')).toHaveAttribute('data-status', 'locked');
  await node(page, 'den-rest').click();
  await page.locator('#modal [data-action="resume"]').click();
  await node(page, 'den-elite').hover();
  await expect(page.locator('#map-detail')).toContainText('находка');
  await node(page, 'den-elite').click(); await settled(page);
  // A wounded cat gets +1 HP for the elite (FOREST_ELITE_HEAL): shown in the result and kept by the run.
  await page.evaluate(() => (window as any).__PUZZLE_GAME.damagePlayer(2));
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await expect(page.locator('#elite-heal')).toContainText('+1 HP за элиту');
  await expect(page.locator('#modal .result-stats')).toContainText('4/5');
  expect((await savedRun(page)).resources.player.hp).toBe(4);
  await expect(page.locator('#modal [data-action="run-find"]')).toContainText('ВЫБРАТЬ НАХОДКУ');
  expect((await savedRun(page)).pending).toMatchObject({ kind: 'find', nodeId: 'den-elite' });
  await page.locator('#modal [data-action="run-find"]').click();
  await expect(page.locator('#modal [data-find]')).toHaveCount(3);
  await page.locator('#modal [data-find]').first().click();
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(node(page, 'den-elite')).toHaveAttribute('data-status', 'current');
  await expect(node(page, 'den-breakthrough')).toHaveAttribute('data-status', 'available');
  expect((await savedRun(page)).pending).toBeNull();
  expect(errors).toEqual([]);
});

test('rest clears effects on the cat and says so', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let run = ok(enterNode(walk(TRUNK), 'beast-wolf'));
  run = ok(resolveBattle(run, { nodeId: 'beast-wolf', won: true, player: { hp: 3, maxHp: 5, energy: 1, damageEffects: { burning: 2 } }, inventory: { ...run.resources.inventory } }));
  await seedRun(page, run);
  await page.goto('/'); await page.locator('#run-start-button').click();
  await expect(page.locator('#map-hp .map-effects')).toContainText('Горение ×2');
  await node(page, 'trail-rest').click();
  await expect(page.locator('#rest-copy')).toContainText('Вылечено: 2 HP');
  await expect(page.locator('#rest-copy')).toContainText('Эффекты на коте сняты');
  await page.locator('#modal [data-action="resume"]').click();
  await expect(page.locator('#map-hp .map-effects')).toHaveCount(0);
  expect((await savedRun(page)).resources.player.damageEffects).toBeUndefined();
  expect(errors).toEqual([]);
});

/** Start a node battle straight on the engine (src/game stays untouched): the run's opened tools are given by the setup. */
async function startNodeBattle(page: Page, template: object, allowedAbilities: string[], allowedItems: string[]) {
  await page.evaluate(([template, allowedAbilities, allowedItems]) => {
    const engine = (window as any).__PUZZLE_GAME.engine;
    const ok = engine.startRunBattle({ nodeId: 'trunk-1', label: 'Проба', seed: 4242, template, player: { hp: 5, maxHp: 5, energy: 2 },
      inventory: { frost: 1, bomb: 0, healing: 0, fire: 0 }, allowedItems, allowedAbilities });
    if (!ok) throw new Error('startRunBattle failed');
  }, [template, allowedAbilities, allowedItems] as const);
  await settled(page);
}

test('a registry battle: help opens, marked targets are counted, an opened jump is visible', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  await page.goto('/');
  await page.locator('#run-start-button').click();
  await node(page, 'trunk-1').click(); await settled(page);
  // A registry battle is started on the engine with the tools of a run that opened the jump.
  await startNodeBattle(page, { kind: 'battle', id: 'wolf-ford' }, ['jump'], ['frost']);
  await expect(page.locator('#game-screen')).toHaveClass(/tutorial-abilities/);
  await expect(page.locator('.energy-hud')).toBeVisible();
  await expect(page.locator('.ability-button[data-ability="jump"]')).toBeVisible();
  await expect(page.locator('.ability-button[data-ability="jump"]')).toBeEnabled();
  await expect(page.locator('.item-button[data-item="frost"]')).toBeVisible();
  await expect(page.locator('#objectives')).toContainText('Отмеченные охранники');
  await expect(page.locator('#objectives')).toContainText('0 / 4');
  await expect(page.locator('#tutorial-message')).toContainText('Волк рядом с живым волком');
  await expect(page.locator('.field-guide')).toContainText('Прыжок');
  await expect(page.locator('.field-guide')).toContainText('Холод');
  await page.screenshot({ path: 'artifacts/forest-map-registry-battle.png' });
  await page.locator('[data-action="help"]').first().click();
  await expect(page.locator('#modal')).toContainText('Вожак у брода');
  await expect(page.locator('#modal')).toContainText('ПОХОД');
  await page.locator('#modal [data-action="resume"]').click();
  // Without opened tools the abilities panel and energy stay hidden.
  await startNodeBattle(page, { kind: 'battle', id: 'wolf-ford' }, [], []);
  await expect(page.locator('#game-screen')).not.toHaveClass(/tutorial-abilities/);
  await expect(page.locator('.energy-hud')).toBeHidden();
  await expect(page.locator('.field-guide')).not.toContainText('Прыжок');
  expect(errors).toEqual([]);
});

test('a trunk node uses the run tools: an opened jump is available in the first trunk battle', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  await page.goto('/');
  await page.locator('#run-start-button').click();
  await node(page, 'trunk-1').click(); await settled(page);
  expect((await state(page)).tutorial.allowedAbilities).toEqual([]);
  await expect(page.locator('#game-screen')).not.toHaveClass(/tutorial-abilities/);
  await expect(page.locator('.energy-hud')).toBeHidden();
  await startNodeBattle(page, { kind: 'battle', id: 'trunk-wake' }, ['jump'], ['frost']);
  await expect(page.locator('#game-screen')).toHaveClass(/tutorial-abilities/);
  await expect(page.locator('.energy-hud')).toBeVisible();
  await expect(page.locator('.ability-button[data-ability="jump"]')).toBeVisible();
  await expect(page.locator('.ability-button[data-ability="jump"]')).toBeEnabled();
  await expect(page.locator('.field-guide')).toContainText('Прыжок');
  await page.locator('[data-action="help"]').first().click();
  await expect(page.locator('#modal')).toContainText('ПОХОД');
  await page.locator('#modal [data-action="resume"]').click();
  expect(errors).toEqual([]);
});

test('registry battle end to end: the beast trail node from the map, a real mouse route, the result on the map', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  // Run seed 1: the authored route of wolf-ford is checked for it in src/game/beastBattles.spec.ts.
  await seedRun(page, walk(TRUNK, 5, 1));
  await page.goto('/'); await page.locator('#run-start-button').click();
  await node(page, 'beast-wolf').hover();
  await expect(page.locator('#map-detail')).toContainText('Вожак у брода');
  await expect(page.locator('#map-detail')).not.toContainText('временно');
  await node(page, 'beast-wolf').click(); await settled(page);
  const entry = await state(page);
  expect(entry.runNode.nodeId).toBe('beast-wolf'); expect(entry.board.filter((cell: any) => cell?.variant === 'wolf').length).toBeGreaterThan(1);
  await expect(page.locator('#chapter-number')).toContainText('ПОХОД');
  await expect(page.locator('#objectives')).toContainText('0 / 4');
  const cell = (label: string) => (Number(label.slice(1)) - 1) * entry.cols + label.charCodeAt(0) - 65;
  await draw(page, ['B5', 'C5', 'C4', 'D3', 'D2'].map(cell));
  expect((await state(page)).phase).toBe('PLAYER_INPUT');
  await draw(page, ['C2', 'D1', 'E2', 'E3', 'D4'].map(cell));
  expect((await state(page)).phase).toBe('WIN');
  await expect(page.locator('#modal [data-action="run-map"]')).toBeVisible();
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(node(page, 'beast-wolf')).toHaveAttribute('data-status', 'current');
  await expect(node(page, 'beast-boar')).toHaveAttribute('data-status', 'available');
  await expect(node(page, 'trail-rest')).toHaveAttribute('data-status', 'available');
  const run = await savedRun(page);
  expect(run.visited).toEqual([...TRUNK, 'beast-wolf']); expect(run.pending).toBeNull();
  expect(run.tools.items).toContain('frost');
  await expect(page.locator('#map-battles')).toContainText('5');
  expect(errors).toEqual([]);
});
