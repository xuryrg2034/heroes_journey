import { test, expect, type Page } from '@playwright/test';
import { CRYSTAL_KILLS } from '../src/game/mapBattleRules';
import { createForestRun, enterNode, resolveBattle, serializeForestRun, type ForestRunState, type ForestRunStep } from '../src/game/run/forestRun';

// A colour-change crystal falls in the middle of the player's chain (between two of its steps), its place is a surprise
// (the forecast gives only the number) and a chain may start on a crystal. Order and numbers come from the engine.
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
  let run = createForestRun(1);
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) {
    run = ok(enterNode(run, id));
    run = ok(resolveBattle(run, { nodeId: id, won: true, player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { ...run.resources.inventory } }));
  }
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } },
    ['ashen-oath-forest-run-v1', serializeForestRun(run)]);
  await page.goto('/'); await page.locator('#run-start-button').click();
  await page.locator('.map-node[data-node="beast-wolf"]').click(); await ready(page);
  await startTemplate(page, row, lessonIndex);
}
async function startTemplate(page: Page, row: number, lessonIndex: number | string) {
  await page.evaluate(([row, index]) => {
    const engine = (window as any).__PUZZLE_GAME.engine;
    if (!engine.startRunBattle({ nodeId: 'beast-wolf', label: 'Проба', row, seed: 4242, template: typeof index === 'string' ? { kind: 'battle', id: index } : { kind: 'lesson', index }, player: { hp: 40, maxHp: 40, energy: 0 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] })) throw new Error('startRunBattle failed');
  }, [row, lessonIndex] as const);
  await ready(page);
}

const FIELDS = ['den-watch', 'camp-cauldron-ring', 'goblin-archer-watch', 'goblin-shield-flank', 'goblin-shaman-rite', 'boar-garden', 'porcupine-thicket', 'wolf-ford', 3, 4, 5, 6, 7];

test('a crystal falls between two steps of a long chain; the forecast gives the number, never the place', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mapBattle(page, 5, FIELDS[0]);
  // A chain with at least one step after the 6th kill, found by the engine's own forecast.
  let path: number[] | null = null;
  for (const field of FIELDS) {
    await startTemplate(page, 5, field);
    path = await page.evaluate(() => {
      const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
      for (const move of game.availableMoves()) for (let n = 2; n <= move.length; n++) {
        const chain = move.slice(0, n), key = chain.join(','); if (seen.has(key)) continue; seen.add(key);
        const p = game.preview(chain); if (p.valid && p.crystals > 0 && p.kills > 6) return chain;
      }
      return null;
    });
    if (path) break;
  }
  expect(path).not.toBeNull();
  await holdChain(page, path!);
  const forecast = await preview(page);
  // Only the number: no cell, no crushed enemy in the forecast, nothing about a crystal drawn on the field.
  expect(forecast.crystals).toBeGreaterThan(0); expect(forecast.prismIndex).toBeUndefined();
  expect(JSON.stringify(forecast.enemyPhase.deaths)).not.toContain('crystal');
  expect((await page.evaluate(() => (window as any).__PUZZLE_GAME.telegraphMarks as string[])).join('|')).not.toContain('КРИСТАЛЛ');
  expect((await marks(page)).labels.join('|')).not.toContain('КРИСТАЛЛ');
  await expect(page.locator('#chain-reward')).toContainText('по ходу цепи');
  await expect(page.locator('#chain-reward')).not.toContainText('после хода');
  await shot(page, 'crystal-fall-forecast');
  // Slow the animation down to catch the fall, and record the order of events.
  await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME; game.animationScale = 10; (window as any).__order = [];
    game.engine.subscribe((_state: unknown, event: any) => { if (['move', 'kill', 'crystal', 'hit'].includes(event.type)) (window as any).__order.push(`${event.type}${event.text ? ':' + event.text : ''}`); });
  });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__order.includes('crystal')), { timeout: 15_000 }).toBe(true);
  await page.screenshot({ path: 'artifacts/crystal-fall-frame-1.png' });
  await page.waitForTimeout(1200); await page.screenshot({ path: 'artifacts/crystal-fall-frame-2.png' });
  await page.waitForTimeout(1500); await page.screenshot({ path: 'artifacts/crystal-fall-frame-3.png' });
  await expect.poll(async () => (await state(page)).phase, { timeout: 90_000 }).toBe('PLAYER_INPUT');
  await page.evaluate(() => { (window as any).__PUZZLE_GAME.animationScale = 1; });
  const order: string[] = await page.evaluate(() => (window as any).__order);
  const at = order.indexOf('crystal');
  // Six kills of the chain come first, and the cat keeps walking after the crystal has landed.
  expect(order.slice(0, at).filter(entry => entry === 'kill').length).toBeGreaterThanOrEqual(CRYSTAL_KILLS);
  expect(order.slice(at + 1)).toContain('move');
  expect(order.slice(at + 1)).toContain('kill');
  const board = (await state(page)).board;
  expect(board.filter((cell: any) => cell?.kind === 'prism' && cell.crystalChain).length).toBe(forecast.crystals);
  expect(errors).toEqual([]);
});

test('a chain can start on a crystal, drawn with the mouse', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mapBattle(page, 5, 0);
  // Put a crystal on a cell next to the cat (the fall itself is covered above).
  const index: number = await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME, at = game.validStarts()[0], cell = game.state.board[at];
    Object.assign(cell, { kind: 'prism', color: null, variant: undefined, hp: 1, maxHp: 1, crystalChain: 6 });
    return at;
  });
  const path: number[] | null = await page.evaluate(start => {
    const game = (window as any).__PUZZLE_GAME;
    for (const move of game.availableMoves()) {
      if (move[0] !== start) continue;
      for (let n = 3; n <= move.length; n++) { const p = game.preview(move.slice(0, n)); if (p.valid) return move.slice(0, n); }
    }
    return null;
  }, index);
  expect(path).not.toBeNull();
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.validStarts() as number[])).toContain(index);
  await holdChain(page, path!);
  const forecast = await preview(page);
  expect(forecast.valid).toBe(true); expect(forecast.crystalScore).toBe(120);
  const scoreBefore = (await state(page)).score;
  await finishTurn(page);
  const after = await state(page);
  expect(after.score - scoreBefore).toBeGreaterThanOrEqual(120);
  expect(after.board[index]?.crystalChain).toBeUndefined();
  expect(errors).toEqual([]);
});
