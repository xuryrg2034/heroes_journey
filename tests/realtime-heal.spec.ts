import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { createRtRun, isArenaNode, resolveArena, rtAvailableNodes, rtEnterNode, rtGiftView, rtNode, rtShopView, RT_POTION_CAP, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { closeNode, ok, seedOf, takeGift } from '../src/realtime/run/runFight.testkit';
import { FIRST_MEET_KEY } from '../src/realtime/view/firstMeet';

/**
 * Task 15 «Лечение на карте», the view (design 14.10.2026; src/realtime/view/runView.ts, docs/realtime-slice.md) at 1280×720 by
 * real clicks. Runs are made in Node by the run's own commands (the resources and HP set by hand: the run does not give them at
 * the needed moment) and put into the page's storage:
 * - the map header: ONE resource number with one icon (the kinds in its tooltip), no line «Ресурсы — крафт на привале…» (Э2);
 * - the heal button by the HP: a click heals +2 HP and spends 2, then 3 resources (the price grows), off with «Нужно 4, есть 1»;
 *   full HP — off with «HP полное»; one HP short — «+1 HP (до максимума)», the price full; no resources — no button;
 * - on a battle node's card the header's button heals and the card stays; the fight starts with the new HP; the window «Бой»
 *   (a reload in the fight) covers the header — the button stands in it, over «В бой»;
 * - the rest and the merchant have no button; the merchant names the kinds.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const runState = (page: Page): Promise<RtRunState> => page.evaluate(() => (window as any).__realtime.run.state());
const total = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** A new run of seed k on its first map (the gift taken), its HP and resources set. */
function mapRun(k: number, hpShort: number, materials: Record<'dew' | 'powder' | 'resin' | 'herbs', number>): RtRunState {
  const run = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  expect(run.healMap).toBe(true);
  run.hp = run.maxHp - hpShort;
  run.materials = { ...materials };
  return run;
}

/** A run of seed k walked by its own commands until a node of `type` (rest, shop) is open on its screen. */
function screenRun(k: number, type: 'rest' | 'shop'): RtRunState {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  for (let step = 0; step < 400 && !run.result; step++) {
    if (run.pending?.kind === type) return run;
    if (run.pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic'] }), 'win'); continue; }
    if (run.pending) { run = closeNode(run); continue; }
    const nodes = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, (nodes.find(n => n.type === type) ?? nodes[0]).id), 'enter');
  }
  throw new Error(`seed ${k}: no ${type}`);
}

async function openRun(page: Page, run: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RT_RUN_STORAGE_KEY, serializeRtRun(run)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('task 15: one resource number in the header, no Э2 line; the heal button heals +2 HP for 2, then 3 resources, then is off: «Нужно 4, есть 1»', async ({ page }) => {
  const errors = collectErrors(page);
  const run = mapRun(3, 6, { dew: 3, powder: 1, resin: 1, herbs: 1 }), max = run.maxHp;
  await openRun(page, run);
  await expect(page.getByTestId('run-map')).toBeVisible();
  const res = page.getByTestId('run-resources'), heal = page.getByTestId('run-heal'), reason = page.getByTestId('run-heal-reason');
  await expect(res).toHaveText('6');
  await expect(res).toHaveAttribute('title', 'Ресурсы крафта: Роса 3, Порох 1, Смола 1, Травы 1');
  await expect(page.locator('.rt-run-head')).not.toContainText('Роса');
  await expect(page.getByTestId('line-resources')).toHaveCount(0);
  await expect(page.locator('.rt-run-line', { hasText: 'Ресурсы' })).toHaveCount(0);
  await expect(heal).toHaveText('Лечение +2 HP — 2 ресурса');
  await expect(heal).toBeEnabled();
  await expect(reason).toHaveCount(0);
  // Beside the HP, in the header's first line, inside 1280×720.
  const hp = (await page.getByTestId('run-hp').boundingBox())!, at = (await heal.boundingBox())!;
  expect(at.x).toBeGreaterThan(hp.x + hp.width - 8);
  expect(Math.abs(at.y + at.height / 2 - (hp.y + hp.height / 2))).toBeLessThan(12);
  expect(at.x + at.width).toBeLessThan(1280);
  await page.screenshot({ path: 'artifacts/realtime-heal-on.png' });

  await heal.click();
  await expect(page.getByTestId('run-hp')).toHaveText(`HP ${max - 4} / ${max}`);
  await expect(res).toHaveText('4');
  await expect(heal).toHaveText('Лечение +2 HP — 3 ресурса');
  // The notice says what happened (design 14.10.2026), not a second button-like price.
  await expect(page.getByTestId('run-notice')).toHaveText('+2 HP за 2 ресурса');
  await heal.click();
  await expect(page.getByTestId('run-hp')).toHaveText(`HP ${max - 2} / ${max}`);
  await expect(res).toHaveText('1');
  await expect(heal).toHaveText('Лечение +2 HP — 4 ресурса');
  await expect(heal).toBeDisabled();
  await expect(reason).toHaveText('Нужно 4, есть 1');
  await expect(reason).toHaveClass(/rt-poor/);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-heal-off-poor.png' });
  let state = await runState(page);
  expect(state.hp).toBe(max - 2);
  expect(state.healBought).toBe(2);
  expect(total(state.materials)).toBe(1);
  // A click on the off button does nothing.
  await heal.click({ force: true });
  state = await runState(page);
  expect(state.hp).toBe(max - 2);
  // A reload keeps the price's step.
  await page.reload();
  await expect(page.getByTestId('run-heal')).toHaveText('Лечение +2 HP — 4 ресурса');
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key), FIRST_MEET_KEY) ?? '{}').met).toContain('heal-button');
  expect(errors).toEqual([]);
});

test('task 15: full HP — the button off with «HP полное»; one HP short — «+1 HP (до максимума)» at the full price; no resources — no button', async ({ page }) => {
  const errors = collectErrors(page);
  await openRun(page, mapRun(3, 0, { dew: 0, powder: 0, resin: 3, herbs: 0 }));
  const heal = page.getByTestId('run-heal');
  await expect(heal).toHaveText('Лечение +2 HP — 2 ресурса');
  await expect(heal).toBeDisabled();
  await expect(page.getByTestId('run-heal-reason')).toHaveText('HP полное');
  // Grey, not red: full HP is not the player's mistake (design 14.10.2026).
  await expect(page.getByTestId('run-heal-reason')).not.toHaveClass(/rt-poor/);
  expect(await page.getByTestId('run-heal-reason').evaluate(el => getComputedStyle(el).color)).not.toBe('rgb(224, 165, 150)');
  await page.screenshot({ path: 'artifacts/realtime-heal-off-full.png' });

  const short = mapRun(3, 1, { dew: 0, powder: 0, resin: 3, herbs: 0 });
  await openRun(page, short);
  await expect(heal).toHaveText('Лечение +1 HP (до максимума) — 2 ресурса');
  await heal.click();
  await expect(page.getByTestId('run-hp')).toHaveText(`HP ${short.maxHp} / ${short.maxHp}`);
  await expect(page.getByTestId('run-resources')).toHaveText('1');
  await expect(heal).toBeDisabled();
  await expect(page.getByTestId('run-heal-reason')).toHaveText('HP полное');

  await openRun(page, mapRun(3, 4, { dew: 0, powder: 0, resin: 0, herbs: 0 }));
  await expect(page.getByTestId('run-resources')).toHaveText('0');
  await expect(heal).toHaveCount(0);
  await openRun(page, mapRun(3, 4, { dew: 0, powder: 0, resin: 0, herbs: 1 }));
  await expect(heal).toBeVisible();
  await expect(heal).toBeDisabled();
  await expect(page.getByTestId('run-heal-reason')).toHaveText('Нужно 2, есть 1');
  expect(errors).toEqual([]);
});

test('task 15: on a battle card before «В бой» the heal keeps the card and the fight starts with the new HP; the window «Бой» holds the button over «В бой»', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  // 7 resources: 2 + 3 for the two heals, 2 left — the button stays (off at full HP).
  const run = mapRun(3, 4, { dew: 3, powder: 2, resin: 2, herbs: 0 }), max = run.maxHp;
  const node = rtAvailableNodes(run).find(isArenaNode)!;
  await openRun(page, run);
  await page.getByTestId(`node-${node.id}`).click();
  await expect(page.getByTestId('run-detail')).toHaveAttribute('data-card', node.id);
  await page.getByTestId('run-heal').click();
  await expect(page.getByTestId('run-hp')).toHaveText(`HP ${max - 2} / ${max}`);
  await expect(page.getByTestId('run-detail')).toHaveAttribute('data-card', node.id);
  await expect(page.getByTestId('run-heal')).toHaveText('Лечение +2 HP — 3 ресурса');
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect.poll(async () => (await snap(page)).hero.hp).toBe(max - 2);
  await expect(page.getByTestId('run-heal')).toBeHidden();

  // A reload in the fight: the window «Бой» covers the header — the one button stands in it, over «В бой».
  await page.reload();
  const modal = page.getByTestId('run-battle-modal');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('run-heal')).toHaveCount(1);
  const heal = modal.getByTestId('run-heal');
  await expect(heal).toHaveText('Лечение +2 HP — 3 ресурса');
  const button = (await heal.boundingBox())!, enter = (await page.getByTestId('run-battle').boundingBox())!;
  expect(button.y + button.height).toBeLessThanOrEqual(enter.y + 1);
  await heal.click();
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(`HP ${max} / ${max}`);
  await expect(heal).toBeDisabled();
  await expect(modal.getByTestId('run-heal-reason')).toHaveText('HP полное');
  const state = await runState(page);
  expect(state.hp).toBe(max);
  expect(state.healBought).toBe(2);
  expect(state.pending?.kind).toBe('battle');
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect.poll(async () => (await snap(page)).hero.hp).toBe(max);
  expect(rtNode(state, node.id)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('task 15: the rest and the merchant have no heal button; the merchant names the resource kinds', async ({ page }) => {
  const errors = collectErrors(page);
  for (const type of ['rest', 'shop'] as const) {
    const run = screenRun(4, type);
    run.hp = run.maxHp - 4;
    run.materials = { dew: 2, powder: 0, resin: 2, herbs: 0 };
    await openRun(page, run);
    await expect(page.getByTestId(type === 'rest' ? 'run-rest' : 'run-shop')).toBeVisible();
    await expect(page.getByTestId('run-heal')).toHaveCount(0);
    if (type === 'shop') await expect(page.getByTestId('shop-resources')).toHaveText('Ресурсов: 4 (Роса 2, Смола 2).');
    else await expect(page.getByTestId('run-rest')).toContainText('«Роса» (есть 2)');
  }
  expect(errors).toEqual([]);
});

/**
 * Task 41 «Три зелья» — the view (design 16.10.2026, docs/design-notes/task-41-prisoner-potions.md, 3): with the cap of healing potions
 * in hand the healing choice of a find, the merchant, a rest's craft and the gift's pick stays shown, off, with «Рука полна» at it
 * (always — not a hint); a mixed gift button says the healing will not join; the map header marks the count «(полна)»; in the fight
 * the healing tile has the frame «полна». Runs are walked in Node by their own commands, the hand set to the cap by hand.
 */
const HAND_FULL = 'Рука полна';
/** A run of seed k walked by its own commands until a node of `type` is open on its screen (`want` — the screen it needs). */
function capRun(k: number, type: 'find' | 'rest' | 'shop', want: (run: RtRunState) => boolean = () => true): RtRunState | null {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  for (let step = 0; step < 400 && !run.result; step++) {
    if (run.pending?.kind === type && want(run)) return run;
    if (run.pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic'] }), 'win'); continue; }
    if (run.pending) { run = closeNode(run); continue; }
    const nodes = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, (nodes.find(n => n.type === type) ?? nodes[0]).id), 'enter');
  }
  return null;
}
const fill = (run: RtRunState): RtRunState => { const out = structuredClone(run); out.items.healing = RT_POTION_CAP; if (!out.openItems.includes('healing')) out.openItems.push('healing'); return out; };

test('task 41: three potions — the find shows the healing off with «Рука полна» (a click takes nothing), the bomb is taken; the header says «(полна)»', async ({ page }) => {
  const errors = collectErrors(page);
  let found: RtRunState | null = null;
  for (let k = 1; k <= 12 && !found; k++) found = capRun(k, 'find', r => r.pending?.kind === 'find' && r.pending.options.includes('healing') && r.pending.options.includes('bomb'));
  expect(found, 'a walk reached a find with the healing and the bomb').not.toBeNull();
  const run = fill(found!);
  expect(run.potionCap).toBe(RT_POTION_CAP);
  await openRun(page, run);
  await expect(page.getByTestId('run-find')).toBeVisible();
  const heal = page.getByTestId('find-healing');
  await expect(heal).toBeDisabled();
  await expect(page.getByTestId('hand-full-find-healing')).toHaveText(HAND_FULL);
  await expect(page.getByTestId('find-bomb')).toBeEnabled();
  await expect(page.getByTestId('hand-full-find-bomb')).toHaveCount(0);
  await expect(page.getByTestId('run-items-full')).toContainText(`${RT_POTION_CAP} (полна)`);
  await page.screenshot({ path: 'artifacts/realtime-potion-find-full.png' });
  // The real mouse on the healing: nothing taken, the find stays open.
  const box = (await heal.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
  let state = await runState(page);
  expect(state.items.healing).toBe(RT_POTION_CAP);
  expect(state.pending?.kind).toBe('find');
  await page.getByTestId('find-bomb').click();
  await expect(page.getByTestId('run-find')).toBeHidden();
  state = await runState(page);
  expect({ healing: state.items.healing, bomb: state.items.bomb }).toEqual({ healing: RT_POTION_CAP, bomb: run.items.bomb + 1 });
  expect(errors).toEqual([]);
});

test('task 41: three potions — the rest\'s herbs recipe and the merchant\'s potion are off with «Рука полна»; another recipe stays on', async ({ page }) => {
  const errors = collectErrors(page);
  let rest: RtRunState | null = null;
  for (let k = 1; k <= 12 && !rest; k++) rest = capRun(k, 'rest');
  expect(rest, 'a walk reached a rest').not.toBeNull();
  const atRest = fill(rest!);
  atRest.materials = { dew: 3, powder: 3, resin: 3, herbs: 3 };
  await openRun(page, atRest);
  await expect(page.getByTestId('run-rest')).toBeVisible();
  await expect(page.getByTestId('craft-herbs')).toBeDisabled();
  await expect(page.getByTestId('hand-full-craft-herbs')).toHaveText(HAND_FULL);
  await expect(page.getByTestId('craft-powder')).toBeEnabled();
  await expect(page.getByTestId('hand-full-craft-powder')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/realtime-potion-rest-full.png' });
  let shop: RtRunState | null = null;
  for (let k = 1; k <= 20 && !shop; k++) shop = capRun(k, 'shop', r => r.pending?.kind === 'shop' && r.pending.stock.items.includes('healing'));
  expect(shop, 'a walk reached a merchant selling a potion').not.toBeNull();
  const atShop = fill(shop!);
  atShop.materials = { dew: 9, powder: 9, resin: 9, herbs: 9 };
  const good = rtShopView(atShop)!.goods.find(g => g.item === 'healing')!;
  await openRun(page, atShop);
  await expect(page.getByTestId('run-shop')).toBeVisible();
  await expect(page.getByTestId(`shop-${good.id}`)).toBeDisabled();
  await expect(page.getByTestId(`shop-${good.id}`)).toContainText(HAND_FULL);
  expect(errors).toEqual([]);
});

test('task 41: three potions at the start gift — a mixed «расходники» button says the healing will not join; the pick of three keeps the healing off with «Рука полна»', async ({ page }) => {
  const errors = collectErrors(page);
  // The gift's buttons are drawn by seed (forest/runGift.ts): a mini gift whose «расходники» mix the healing with another kind, and a
  // full gift whose pick of three has the healing.
  const seedWith = (gift: 'mini' | 'full', fits: (option: ReturnType<typeof rtGiftView> & {}) => boolean): RtRunState => {
    for (let k = 1; k <= 60; k++) { const r = fill(createRtRun(seedOf(k), { gift })); if (fits(rtGiftView(r)!)) return r; }
    throw new Error(`no ${gift} gift fits`);
  };
  const mixed = seedWith('mini', v => v.options.some(e => e.option.kind === 'items' && e.option.items.includes('healing') && e.option.items.some(i => i !== 'healing')));
  const mix = rtGiftView(mixed)!.options.find(e => e.option.kind === 'items')!;
  await openRun(page, mixed);
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await expect(page.getByTestId(`gift-${mix.index}`)).toBeEnabled();
  await expect(page.getByTestId(`hand-full-gift-${mix.index}`)).toHaveText(`${HAND_FULL}: лечение не войдёт`);
  await page.screenshot({ path: 'artifacts/realtime-potion-gift-mixed.png' });
  const run = seedWith('full', v => v.options.some(e => e.available && e.option.kind === 'pick-item' && e.option.items.includes('healing')));
  const pick = rtGiftView(run)!.options.find(e => e.option.kind === 'pick-item')!;
  await openRun(page, run);
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await expect(page.getByTestId(`hand-full-gift-${pick.index}`)).toHaveCount(0);
  await page.getByTestId(`gift-${pick.index}`).click();
  await expect(page.getByTestId('gift-pick-healing')).toBeDisabled();
  await expect(page.getByTestId('hand-full-gift-pick-healing')).toHaveText(HAND_FULL);
  const other = pick.option.kind === 'pick-item' ? pick.option.items.find(i => i !== 'healing')! : 'bomb';
  await expect(page.getByTestId(`gift-pick-${other}`)).toBeEnabled();
  await page.getByTestId(`gift-pick-${other}`).click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  const state = await runState(page);
  expect(state.items.healing).toBe(RT_POTION_CAP);
  expect(errors).toEqual([]);
});

test('task 41: three potions in the fight — the healing tile has the frame «полна»; one drunk (key 3), the frame goes', async ({ page }) => {
  const errors = collectErrors(page);
  let run = fill(mapRun(1, 0, { dew: 0, powder: 0, resin: 0, herbs: 0 }));
  const battle = rtAvailableNodes(run).find(n => isArenaNode(rtNode(run, n.id)!))!;
  run = ok(rtEnterNode(run, battle.id), 'enter');
  run.hp = run.maxHp - 6;
  await openRun(page, run);
  await page.getByTestId('run-battle').click();
  await expect.poll(async () => (await snap(page)).status).toBe('playing');
  const tile = page.getByTestId('item-healing');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveClass(/\brt-full\b/);
  await expect(tile).toHaveAttribute('title', /рука полна/);
  await page.screenshot({ path: 'artifacts/realtime-potion-tile-full.png' });
  await page.keyboard.press('Digit3');
  await expect(tile.locator('.rt-tile-count')).toHaveText(String(RT_POTION_CAP - 1));
  await expect(tile).not.toHaveClass(/\brt-full\b/);
  expect(errors).toEqual([]);
});
