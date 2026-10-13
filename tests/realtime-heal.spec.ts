import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { createRtRun, isArenaNode, resolveArena, rtAvailableNodes, rtEnterNode, rtNode, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
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
  await expect(page.getByTestId('run-notice')).toHaveText('Лечение +2 HP — 2 ресурса');
  await heal.click();
  await expect(page.getByTestId('run-hp')).toHaveText(`HP ${max - 2} / ${max}`);
  await expect(res).toHaveText('1');
  await expect(heal).toHaveText('Лечение +2 HP — 4 ресурса');
  await expect(heal).toBeDisabled();
  await expect(reason).toHaveText('Нужно 4, есть 1');
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
