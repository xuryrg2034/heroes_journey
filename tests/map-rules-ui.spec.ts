import { test, expect, type Page } from '@playwright/test';
import { CRYSTAL_KILLS, CRYSTAL_SCORE_PER_KILL, runPressureInfo } from '../src/game/mapBattleRules';
import { createForestRun, enterNode, resolveBattle, serializeForestRun, type ForestRunState, type ForestRunStep } from '../src/game/run/forestRun';

// Rules decided after playtest 1 in the real UI: pressure chip (layers since 03.10.2026), colour-change crystals (forecast → appearance →
// breaking → score), «не засчитано» for enemy-caused deaths and the forecast of resting. Numbers come from the engine.
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
/** A run at the fork with a healthy cat, then a registered map battle started on the engine at the given map row. */
async function mapBattle(page: Page, row: number, battleId: string) {
  let run = createForestRun(1);
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) {
    run = ok(enterNode(run, id));
    run = ok(resolveBattle(run, { nodeId: id, won: true, player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { ...run.resources.inventory } }));
  }
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } },
    ['ashen-oath-forest-run-v1', serializeForestRun(run)]);
  await page.goto('/'); await page.locator('#run-start-button').click();
  await page.locator('.map-node[data-node="beast-wolf"]').click(); await ready(page);
  await startTemplate(page, row, battleId);
}
async function startTemplate(page: Page, row: number, battleId: string) {
  await page.evaluate(([row, id]) => {
    const engine = (window as any).__PUZZLE_GAME.engine;
    if (!engine.startRunBattle({ nodeId: 'beast-wolf', label: 'Проба', row, seed: 4242, template: { kind: 'battle', id }, player: { hp: 40, maxHp: 40, energy: 0 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] })) throw new Error('startRunBattle failed');
  }, [row, battleId] as const);
  await ready(page);
}
async function openTroll(page: Page) {
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-preset').selectOption('troll');
  await page.locator('[data-editor="preset"]').click();
  await page.locator('#editor-play').click();
  await ready(page);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}

test('pressure layers: the HUD chip shows the soft clock before the goals and the calm after them, as the engine reports', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mapBattle(page, 5, 'trunk-wake');
  const chip = page.locator('#pressure-chip');
  await expect(chip).toBeVisible();
  const expected = async () => { const info = runPressureInfo(await state(page)); return info; };
  let info = await expected();
  expect(info.active).toBe(true);
  // Before the goals: one angry enemy per turn, weak refills, no next step to announce (difficulty layers, 03.10.2026).
  await expect(page.locator('#pressure-anger')).toHaveText(`Злость: ${info.angerPerTurn} за ход`);
  await expect(page.locator('#pressure-refill')).toHaveText('Пополнение: слабые');
  await shot(page, 'rules-pressure-chip');
  for (let turn = 0; turn < 4; turn++) await rest(page);
  info = await expected();
  expect([info.angerPerTurn, info.refillTier, info.nextStepTurn]).toEqual([1, 'weak', undefined]);
  await expect(page.locator('#pressure-anger')).toHaveText('Злость: 1 за ход');
  // Meet the goals (engine commands): the chip counts the calm from the goal turn.
  for (let attempt = 0; attempt < 8 && (await state(page)).customLevel.goalCompletedTurn === null; attempt++) {
    await page.evaluate(async () => {
      const g = (window as any).__PUZZLE_GAME.engine, moves: number[][] = g.availableMoves(8);
      const safe = moves.filter(path => { const p = g.preview(path); return p.valid && p.opensDoor === undefined && !p.playerDies; });
      const path = safe.find(candidate => g.preview(candidate).unlocksExit) ?? safe[0];
      if (path) { g.beginChain(path[0]); for (const index of path.slice(1)) g.extendChain(index); await g.releaseChain(); } else await g.waitTurn();
    });
    await ready(page);
  }
  info = await expected();
  expect(info.afterGoals).toBe(true);
  expect(info.calmLeft).toBeGreaterThan(0);
  await expect(page.locator('#pressure-anger')).toContainText('Затишье');
  await expect(page.locator('#pressure-refill')).toHaveText(`Затем злость ${info.nextAngerPerTurn} за ход, пополнение: вооружённые`);
  await shot(page, 'rules-pressure-calm');
  // A trunk battle (row 1–4) has no pressure layers and no chip.
  await page.evaluate(() => {
    (window as any).__PUZZLE_GAME.engine.startRunBattle({ nodeId: 'trunk-1', label: 'Ствол', row: 1, seed: 1, template: { kind: 'battle', id: 'trunk-wake' }, player: { hp: 5, maxHp: 5, energy: 0 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] });
  });
  await ready(page);
  await expect(chip).toBeHidden();
  expect(errors).toEqual([]);
});

test('crystals: the forecast counts them, one appears after the turn with its value, breaking it scores', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mapBattle(page, 5, 'trunk-wake');
  // The engine's own forecast picks a chain that kills at least CRYSTAL_KILLS enemies without ending the battle
  // (a battle-ending chain makes no crystal): try a few battle fields until one has such a chain.
  let path: number[] | null = null;
  for (const lesson of ['den-watch', 'camp-cauldron-ring', 'goblin-archer-watch', 'goblin-shield-flank', 'goblin-shaman-rite', 'boar-garden', 'porcupine-thicket', 'wolf-ford', 'trunk-arrows', 'three-banners', 'den-nest', 'camp-shield-wall', 'den-breakout']) {
    await startTemplate(page, 5, lesson);
    path = await page.evaluate(() => {
      const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
      for (const move of game.availableMoves()) for (let n = 2; n <= move.length; n++) {
        const chain = move.slice(0, n), key = chain.join(','); if (seen.has(key)) continue; seen.add(key);
        const p = game.preview(chain); if (p.valid && p.crystals > 0) return chain;
      }
      return null;
    });
    if (path) break;
  }
  expect(path).not.toBeNull();
  await holdChain(page, path!);
  const forecast = await preview(page);
  expect(forecast.crystals).toBe(Math.floor(forecast.kills / CRYSTAL_KILLS));
  await expect(page.locator('#chain-reward')).toContainText(`+${forecast.crystals} кристалл`);
  await expect(page.locator('#chain-reward')).toContainText('по ходу цепи');
  await expect(page.locator('#chain-reward')).toContainText(`До кристалла: ${forecast.kills % CRYSTAL_KILLS} / ${CRYSTAL_KILLS}`);
  await shot(page, 'rules-crystal-forecast');
  await page.evaluate(() => {
    (window as any).__crystals = [];
    (window as any).__PUZZLE_GAME.engine.subscribe((_state: unknown, event: any) => { if (event.type === 'crystal') (window as any).__crystals.push({ index: event.index, amount: event.amount, crushed: event.oldId !== undefined }); });
  });
  await finishTurn(page);
  const events: { index: number; amount: number }[] = await page.evaluate(() => (window as any).__crystals);
  expect(events).toHaveLength(forecast.crystals);
  const board = (await state(page)).board;
  for (const event of events) {
    expect(board[event.index].kind).toBe('prism'); expect(board[event.index].crystalChain).toBe(forecast.kills);
    expect(event.amount).toBe(CRYSTAL_SCORE_PER_KILL * forecast.kills);
  }
  await shot(page, 'rules-crystal-board');
  // Breaking it: the forecast of a chain through the crystal names the score; the executed turn adds at least that.
  const crystalIndex = events[0].index;
  const breaker: number[] | null = await page.evaluate(index => {
    const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
    for (const move of game.availableMoves(8)) { const at = move.indexOf(index); if (at < 1) continue; const chain = move.slice(0, at + 1), key = chain.join(','); if (seen.has(key)) continue; seen.add(key);
      const p = game.preview(chain); if (p.valid && p.crystalScore > 0) return chain; }
    return null;
  }, crystalIndex);
  expect(breaker).not.toBeNull();
  await holdChain(page, breaker!);
  const breaking = await preview(page);
  expect(breaking.crystalScore).toBe(events[0].amount);
  await expect(page.locator('#chain-reward')).toContainText(`+${events[0].amount} очков`);
  const scoreBefore = (await state(page)).score;
  await finishTurn(page);
  expect((await state(page)).score - scoreBefore).toBeGreaterThanOrEqual(events[0].amount);
  expect(errors).toEqual([]);
});

test('enemy-caused deaths are labelled «НЕ ЗАСЧИТАНО» and really are not counted', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTroll(page);
  await rest(page);
  const path: number[] | null = await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
    for (const move of game.availableMoves(5)) for (let n = 2; n <= move.length; n++) {
      const chain = move.slice(0, n), key = chain.join(','); if (seen.has(key)) continue; seen.add(key);
      const p = game.preview(chain); if (p.valid && p.enemyPhase?.deaths.some((death: any) => death.cause === 'club')) return chain;
    }
    return null;
  });
  expect(path).not.toBeNull();
  const before = (await state(page)).objective.kills;
  await holdChain(page, path!);
  const forecast = await preview(page);
  const deaths = forecast.enemyPhase.deaths.length;
  expect((await marks(page)).labels.filter((label: string) => label === 'НЕ ЗАСЧИТАНО')).toHaveLength(deaths);
  await expect(page.locator('#chain-reward')).toContainText(`не засчитано игроку: ${deaths}`);
  await shot(page, 'rules-not-counted');
  await finishTurn(page);
  // Only the chain's own kills count; the club's do not.
  expect((await state(page)).objective.kills).toBe(before + forecast.kills);
  expect(errors).toEqual([]);
});

test('hovering «Отдых» shows the forecast of resting on the field and in the panel', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTroll(page);
  await rest(page); // the club is raised: resting lets it fall
  const rested = await page.evaluate(() => (window as any).__PUZZLE_GAME.engine.previewRest());
  const clubDeaths = rested.enemyPhase.deaths.filter((death: any) => death.cause === 'club').length;
  expect(clubDeaths).toBeGreaterThan(0);
  await page.mouse.move(5, 5);
  await expect(page.locator('#risk-preview')).toContainText('Выбери безопасный');
  await page.locator('#wait-button').hover();
  await expect(page.locator('#risk-preview')).toContainText('Отдых');
  await expect(page.locator('#status-message')).toContainText('погибнут');
  await expect(page.locator('#status-message')).toContainText('не засчитано игроку');
  // The panel keeps its size, so the button stays under the pointer.
  const box = await page.locator('#wait-button').boundingBox(); await page.waitForTimeout(300);
  expect((await page.locator('#wait-button').boundingBox())!.y).toBe(box!.y);
  await expect.poll(async () => (await marks(page)).labels.filter((label: string) => label === 'ДУБИНА').length).toBe(clubDeaths);
  await shot(page, 'rules-rest-preview');
  // Moving away clears it; resting then does what was shown.
  await page.mouse.move(5, 5);
  await expect(page.locator('#risk-preview')).toContainText('Выбери безопасный');
  await expect.poll(async () => (await marks(page)).labels.length).toBe(0);
  const hp = (await state(page)).player.hp;
  await page.locator('#wait-button').click();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
  await ready(page);
  expect((await state(page)).player.hp).toBe(hp - rested.damage);
  expect(errors).toEqual([]);
});
