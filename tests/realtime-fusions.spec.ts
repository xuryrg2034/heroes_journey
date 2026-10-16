import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { createRtRun, resolveArena, rtAvailableNodes, rtChooseTalisman, rtEnterNode, rtFusionRecipe, rtFusionsReady, rtRestHeal, rtShopBuy, rtShopLeave, rtShopView, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { FUSION_RECIPES, fusionOfHalf, fusionRecipe } from '../src/realtime/sim/buildIds';
import { closeNode, ok, seedOf, takeGift } from '../src/realtime/run/runFight.testkit';

/**
 * Task 44 «Сплавы» in the sandbox (docs/realtime-prototype.md, section 9ц): «Ледяная печать» chosen in the panel's menu «Песочница:
 * талисман на старте арены», the arena restarted by the key R; a ring of four links drawn and closed with the real mouse round an
 * enemy — the release strikes it and it stays frozen 3 s and brittle (the plain «Печать» holds 1.5 s without ×2). The rules are
 * checked in Node (`npm run test:realtime-fusions`); this test looks at the real input and at the console.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

test('task 44: «Ледяная печать» from the sandbox menu — the ring closed by the mouse freezes the enemy inside for 3 s, brittle', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.getByTestId('open-panel').click();
  const menu = page.locator('label.rt-row', { hasText: 'Песочница: талисман на старте арены' }).locator('select');
  await expect(menu.locator('option', { hasText: 'Сплав: Ледяная печать' })).toHaveCount(1);
  await menu.selectOption('fusion-ice-seal');
  await page.locator('.rt-close').first().click();
  // The next arena takes it (the key R restarts the sandbox arena): the fusion with its parts in the kit.
  await page.locator('#rt-app canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snap(page)).kit?.talismans ?? []).toEqual(expect.arrayContaining(['fusion-ice-seal', 'form-seal', 'frost-edge']));
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['loopEnabled', false]] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5.5);
  });
  const corners = [await place(page, 9.2, 4.7, 0, 1), await place(page, 10.8, 4.7, 0, 1), await place(page, 10.8, 6.3, 0, 1), await place(page, 9.2, 6.3, 0, 1)];
  const inner = await place(page, 10, 5.5, 1, 3);
  const at = await Promise.all([[9.2, 4.7], [10.8, 4.7], [10.8, 6.3], [9.2, 6.3]].map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const k of [1, 2, 3]) await page.mouse.move(at[k].x, at[k].y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chain).toEqual(corners);
  // The pointer back on the first link closes the ring («Печать» from the fusion; the panel's loop toggle is off).
  await page.mouse.move(at[0].x, at[0].y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('first');
  await page.screenshot({ path: 'artifacts/realtime-fusion-ice-seal-closed.png' });
  await page.mouse.up();
  // The strike: the inner enemy loses 1 HP and freezes — 3 s (more than the plain seal's 1.5 s), brittle.
  await expect.poll(async () => (await snap(page)).enemies.find((e: any) => e.id === inner)?.hp, { timeout: 8000 }).toBe(2);
  const frozen = (await snap(page)).enemies.find((e: any) => e.id === inner);
  expect(frozen.brittle).toBe(true);
  expect(frozen.chill).toBeGreaterThan(1.5);
  await page.screenshot({ path: 'artifacts/realtime-fusion-ice-seal-frozen.png' });
  expect(errors).toEqual([]);
});

// ---- Task 44, the view (ui; docs/design-notes/task-44-fusions.md, 4 and 8) ----

const HALVES = FUSION_RECIPES.flatMap(r => [r.form, r.counter]);
/** A held half's partner on offer, else a half the run lacks; null — none (the walk's policy). */
function pick(run: RtRunState, options: readonly string[]): string | null {
  const partner = options.find(id => { const of = fusionOfHalf(id); return !!of && run.talismans.includes(of.partner) && !run.talismans.includes(id); });
  return partner ?? options.find(id => HALVES.includes(id) && !run.talismans.includes(id) && !!rtFusionRecipe(run, id)) ?? null;
}
/**
 * A run with forms and fusions (seed k) walked by its own commands — every fight won, halves and partners taken where offered — until
 * `stop` says so. Null — the run ended first.
 */
function walk(k: number, stop: (run: RtRunState) => boolean): RtRunState | null {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini', forms: true, fusions: true, garrison: false }));
  for (let step = 0; step < 800 && !run.result; step++) {
    if (stop(run)) return run;
    const pending = run.pending;
    if (pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 30 }), 'win'); continue; }
    if (pending?.kind === 'talisman') { run = ok(rtChooseTalisman(run, pick(run, pending.options)), 'talisman'); continue; }
    if (pending?.kind === 'shop') {
      const good = rtShopView(run)!.goods.find(g => g.id === 'talisman');
      if (good?.available && good.talisman && pick(run, [good.talisman])) run = ok(rtShopBuy(run, 'talisman'), 'buy');
      run = ok(rtShopLeave(run), 'leave');
      continue;
    }
    if (pending?.kind === 'rest') { run = ok(rtRestHeal(run), 'heal'); continue; }
    if (pending) { run = closeNode(run); continue; }
    run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  }
  return null;
}
/** The page with the run `run` in its storage (no profile). */
async function openRun(page: Page, run: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RT_RUN_STORAGE_KEY, serializeRtRun(run)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}
const runState = (page: Page): Promise<RtRunState> => page.evaluate(() => (window as any).__realtime.run.state());

test('task 44 view: a run — the half\'s card says «Сплав: с „…“ → „…“»; both parts held — the header marks them; the rest offers «Сплав» with the parts\' icons; a click fuses (the icons merge), one item for two', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  // A talisman screen offering a half of a recipe (the walk's seeds vary; the recipe line is checked on the first found).
  let card: RtRunState | null = null;
  for (let k = 1; k <= 30 && !card; k++) card = walk(k, run => run.pending?.kind === 'talisman' && run.pending.options.some(id => !!rtFusionRecipe(run, id)));
  expect(card, 'a talisman screen with a half').not.toBeNull();
  const half = (card!.pending as { options: string[] }).options.find(id => !!rtFusionRecipe(card!, id))!, of = rtFusionRecipe(card!, half)!;
  await openRun(page, card!);
  const line = page.getByTestId(`recipe-${half}`);
  await expect(line).toBeVisible();
  await expect(line).toContainText(`Сплав: с «`);
  await expect(line).toContainText(`→ «${{ 'fusion-ice-seal': 'Ледяная печать', 'fusion-spear': 'Копьё', 'fusion-boomerang': 'Бумеранг' }[of.fusion]}»`);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-fusion-card.png' });

  // A rest with both parts of a recipe.
  let rest: RtRunState | null = null;
  for (let k = 1; k <= 40 && !rest; k++) rest = walk(k, run => run.pending?.kind === 'rest' && rtFusionsReady(run).length > 0);
  expect(rest, 'a rest with a pair').not.toBeNull();
  const fusion = rtFusionsReady(rest!)[0], recipe = fusionRecipe(fusion)!;
  await openRun(page, rest!);
  await expect(page.getByTestId('run-rest')).toBeVisible();
  // The header's build: both parts carry the pair's mark.
  for (const part of [recipe.form, recipe.counter]) {
    const mark = page.getByTestId(`run-pair-${part}`);
    if (await mark.count()) await expect(mark).toHaveAttribute('title', new RegExp('Сплав на привале'));
    else await expect(page.getByTestId('run-hammer-slot')).toHaveAttribute('title', new RegExp('Сплав на привале'));
  }
  const option = page.getByTestId(`rest-fuse-${fusion}`);
  await expect(option).toBeEnabled();
  await expect(option.locator('.rt-fuse-icon')).toHaveCount(3);
  await expect(option.locator('b')).toHaveText(new RegExp('^Сплав: «'));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-fusion-rest.png' });
  await option.click();
  // The moment: the two parts' icons merge into the fusion's (an overlay over the map that goes by itself).
  await expect(page.getByTestId('fusion-anim')).toHaveAttribute('data-fusion', fusion);
  await page.waitForTimeout(650);
  await page.screenshot({ path: 'artifacts/realtime-fusion-made.png' });
  await expect(page.getByTestId('fusion-anim')).toHaveCount(0, { timeout: 3000 });
  const after = await runState(page);
  expect(after.talismans).toContain(fusion);
  expect(after.talismans).not.toContain(recipe.form);
  expect(after.talismans).not.toContain(recipe.counter);
  expect(after.pending ?? null).toBeNull();
  await expect(page.getByTestId('run-map')).toBeVisible();
  expect(errors).toEqual([]);
});

/** The sandbox with `fusion` in the panel's menu «талисман на старте арены», the arena restarted (R); quiet bodies; the hero at `hero`. */
async function sandboxWith(page: Page, fusion: string, hero: { x: number; y: number }, extra: [string, unknown][] = []): Promise<void> {
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.getByTestId('open-panel').click();
  await page.locator('label.rt-row', { hasText: 'Песочница: талисман на старте арены' }).locator('select').selectOption(fusion);
  await page.locator('.rt-close').first().click();
  await page.locator('#rt-app canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snap(page)).kit?.talismans ?? []).toContain(fusion);
  await page.evaluate(([x, y, more]) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['loopEnabled', false], ['pierceEnabled', false], ...more] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(x, y);
  }, [hero.x, hero.y, extra] as const);
}
/** The build column shows the fusion, one row for its parts (no rows of the parts). */
async function expectFusedColumn(page: Page, fusion: string): Promise<void> {
  const r = fusionRecipe(fusion)!;
  await expect.poll(async () => (await snap(page)).buildItems.map((i: { id: string }) => i.id)).toContain(fusion);
  const ids = (await snap(page)).buildItems.map((i: { id: string }) => i.id);
  expect(ids).not.toContain(r.form);
  expect(ids).not.toContain(r.counter);
  await expect(page.getByTestId(`build-${fusion}`).locator('svg.rt-fusion-icon')).toHaveCount(1);
}
/** A chain over the bodies at arena points `pts` by the real mouse (held). */
async function drawOver(page: Page, pts: readonly [number, number][]): Promise<void> {
  const at = await Promise.all(pts.map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 5 });
}

test('task 44 view: the highlight of each fusion — «Копьё» writes «−2 пластины» over a corridor elite; «Ледяная печать» puts the frost sign on the survivors inside; «Бумеранг» shows the second pass\'s power, lit when the last link dies; the column shows the fusion, not its parts', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  // «Копьё»: three links on the hero's axis (the bodies walk along it), an armoured elite beyond the last one.
  await sandboxWith(page, 'fusion-spear', { x: 4.5, y: 5 }, [['eliteArmor', true]]);
  await expectFusedColumn(page, 'fusion-spear');
  // Links of 0 HP: the chain keeps its power for the pierce (with 1 HP each the three take it all — no pierce).
  for (const x of [6, 7.2, 8.4]) await place(page, x, 5, 0, 0);
  const elite = await page.evaluate(() => (window as any).__realtime.place(9.6, 5, 2, 3, 'basic', true)) as number;
  await drawOver(page, [[6, 5], [7.2, 5], [8.4, 5]]);
  await expect.poll(async () => (await snap(page)).fusionShown.spearPlates).toBe(2);
  const pierce = (await snap(page)).pierce.plan;
  expect(pierce.plates).toBe(2);
  expect(pierce.bodies.find((b: { id: number }) => b.id === elite).platesAfter).toBe((await snap(page)).enemies.find((e: { id: number }) => e.id === elite).armor.plates - 2);
  await page.screenshot({ path: 'artifacts/realtime-fusion-spear-plan.png' });
  await page.mouse.up();

  // «Ледяная печать»: a ring of four round a body of 3 HP (it survives the strike) — the frost sign on it before the release.
  await sandboxWith(page, 'fusion-ice-seal', { x: 8, y: 5.5 });
  await expectFusedColumn(page, 'fusion-ice-seal');
  for (const [x, y] of [[9.2, 4.7], [10.8, 4.7], [10.8, 6.3], [9.2, 6.3]]) await place(page, x, y, 0, 1);
  await place(page, 10, 5.5, 1, 3);
  await drawOver(page, [[9.2, 4.7], [10.8, 4.7], [10.8, 6.3], [9.2, 6.3], [9.2, 4.7]]);
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('first');
  await expect.poll(async () => (await snap(page)).fusionShown.ice).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-fusion-ice-plan.png' });
  await page.mouse.up();

  // «Бумеранг»: five links on the hero's axis, the last dies — the badge lit with the dash's power; the last survives — dim.
  for (const [lastHp, full] of [[0, 1], [20, 0]] as const) {
    await sandboxWith(page, 'fusion-boomerang', { x: 4, y: 6 }, [['returnFixed', true]]);
    await expectFusedColumn(page, 'fusion-boomerang');
    const xs = [5.2, 6.4, 7.6, 8.8, 10];
    for (const [i, x] of xs.entries()) await place(page, x, 6, 0, i === 4 ? lastHp : 0);
    await drawOver(page, xs.map(x => [x, 6] as [number, number]));
    await expect.poll(async () => (await snap(page)).fusionShown.backPower).toBeGreaterThan(0);
    expect((await snap(page)).fusionShown.backFull).toBe(full);
    if (full) await page.screenshot({ path: 'artifacts/realtime-fusion-boomerang-plan.png' });
    await page.mouse.up();
  }
  expect(errors).toEqual([]);
});
