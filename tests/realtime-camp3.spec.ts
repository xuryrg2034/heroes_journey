import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { serializeRtRun, rtGateView, rtGarrisonMaps, type RtRunState } from '../src/realtime/run/rtRun';
import { seedOf, walkRun } from '../src/realtime/run/metaWalk.testkit';
import { rtHearthGateItems } from '../src/realtime/run/rtMeta';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { generateForestMap } from '../src/realtime/forest/mapGenerator';

/**
 * Task 51 «Лагерь, этап 3», the view of 51а and 51б (docs/design-notes/task-51-camp-l3.md, 2.1, 2.2, 11.1, 11.2): the camp's bubble
 * with level 3 (the lock «Под замком · Дойди до гарнизона» before the gate, the purchase after it), «Предместье» with the two
 * garrison maps and the two consumables (the choice goes into the garrison), the free reroll of the garrison's screens. Real mouse;
 * the runs are walked in Node by the run's own commands to the screen under test. The rules: core's (run/hearthL3.spec.ts).
 */
const shot = (name: string): string => `${process.env.SHOT_DIR ?? 'artifacts'}/${name}.png`;
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const shown = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.gateShown());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

const hearth = (levels: object, stock: number) => ({ stock, levels, met: { herb: true, smith: true }, lines: { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2 }, quiet: 0 });
/** A profile whose cat passed the forest (the gate of level 3 open) or only reached row 6 (closed). */
const profile = (gate: boolean, levels: object, stock: number) => ({ heroes: { cat: { xp: 40, packs: [], record: gate ? { row: 9, won: true, xp: 40 } : { row: 6, won: false, xp: 40 } } }, hearth: hearth(levels, stock) });

async function open(page: Page, meta: object, run?: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([m, key, value]) => {
    localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1');
    localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 3, won: true, meta: m }));
    if (value) localStorage.setItem(key as string, value as string);
  }, [meta, RT_RUN_STORAGE_KEY, run ? serializeRtRun(run) : null] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('task 51а view: the bubble - level 3 under the lock «Под замком · Дойди до гарнизона» before the gate; after the gate it is bought for 16 (Неясыть, Марфа, Ерофей)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await open(page, profile(false, { owl: 2, herb: 2, smith: 2 }, 40));
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
  for (const npc of ['owl', 'herb', 'smith']) {
    await page.getByTestId(`hearth-npc-${npc}`).click();
    await expect(page.getByTestId(`up-${npc}-3-lock`)).toBeVisible();
    await expect(page.getByTestId(`up-${npc}-3-row`)).toContainText('Под замком');
    await expect(page.getByTestId(`up-${npc}-3-row`)).toContainText('Дойди до гарнизона');
    await expect(page.getByTestId(`up-${npc}-3`)).toHaveCount(0);
  }
  await page.screenshot({ path: shot('camp3-locked') });
  // The same camp after a hero passed the forest: the gate is open.
  await open(page, profile(true, { owl: 2, herb: 2, smith: 2 }, 60));
  await page.getByTestId('run-hearth').click();
  const rows = { owl: ['Путь в гарнизон', 'В Предместье — выбор из 2 карт гарнизона'], herb: ['Склянка в гарнизон', 'расходник из 2'], smith: ['Правка в гарнизоне', '+1 бесплатный переброс в гарнизоне'] } as const;
  let stock = 60;
  for (const npc of ['owl', 'herb', 'smith'] as const) {
    await page.getByTestId(`hearth-npc-${npc}`).click();
    await expect(page.getByTestId(`up-${npc}-3-lock`)).toHaveCount(0);
    await expect(page.getByTestId(`up-${npc}-3-row`)).toContainText(rows[npc][0]);
    await expect(page.getByTestId(`up-${npc}-3-row`)).toContainText(rows[npc][1]);
    if (npc === 'owl') await page.screenshot({ path: shot('camp3-open') });
    await page.getByTestId(`up-${npc}-3`).click();
    stock -= 16;
    await expect(page.getByTestId(`up-${npc}-3-bought`)).toBeVisible();
    await expect(page.getByTestId('hearth-stock').locator('b')).toHaveText(String(stock));
  }
  await page.screenshot({ path: shot('camp3-bought') });
  // The purchase stays: a reload shows level 3 bought.
  await page.reload();
  await page.getByTestId('run-hearth').click();
  await page.getByTestId('hearth-npc-smith').click();
  await expect(page.getByTestId('up-smith-3-bought')).toBeVisible();
  expect(errors).toEqual([]);
});

test('task 51а view: a level 3 with level 2 not bought is a grey price, not a purchase (the gate open)', async ({ page }) => {
  await open(page, profile(true, { owl: 1, herb: 0, smith: 0 }, 40));
  await page.getByTestId('run-hearth').click();
  await page.getByTestId('hearth-npc-owl').click();
  await expect(page.getByTestId('up-owl-3')).toBeDisabled();
  await expect(page.getByTestId('up-owl-3')).toHaveAttribute('data-later', 'true');
});

/** The camp's flags of a meta run with level 3 of both (`rtHearthFlags`): the maps, the consumables, the rerolls. */
const camp3 = (k: number, extra: object = {}) => ({ gift: 'full' as const, garrison: true, moat: true, locked: [] as string[], hearth: { jailerRerolls: 1, garrisonMaps: 2 as const, gateItems: rtHearthGateItems(seedOf(k)), garrisonRerolls: 1 }, ...extra });
const GATE_PROFILE = profile(true, { owl: 3, herb: 3, smith: 3 }, 5);

function walkToGate(k: number, create: object): RtRunState | null {
  let at: RtRunState | null = null;
  walkRun({ k, create: create as never, each: r => { if (!at && r.pending?.kind === 'outskirts') at = structuredClone(r); } });
  return at;
}

test('task 51б view: «Предместье» shows two garrison maps and two consumables beside the cart; the map chosen is the garrison the run enters', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const at = walkToGate(3, camp3(3));
  expect(at && rtGateView(at)?.maps, 'the walk reached «Предместье» with level 3').toBeTruthy();
  const view = rtGateView(at!)!, seeds = rtGarrisonMaps(at!.seed);
  expect(view.maps).toEqual(seeds);
  await open(page, GATE_PROFILE, at!);
  await expect(page.getByTestId('run-gate')).toBeVisible();
  await expect(page.getByTestId('run-cart')).toBeVisible();
  const info = await shown(page);
  expect(info.maps).toEqual(seeds);
  expect(info.map, 'the base garrison is chosen by default').toBe(0);
  expect(info.items.map((entry: { item: string }) => entry.item)).toEqual(view.items!.map(entry => entry.item));
  // Two different maps: their counts (or their nodes) differ.
  expect(JSON.stringify(info.counts[0]) !== JSON.stringify(info.counts[1]) || JSON.stringify(generateForestMap(seeds[0])) !== JSON.stringify(generateForestMap(seeds[1]))).toBe(true);
  expect(await page.locator('[data-testid^="gate-map-"]').count()).toBe(2);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: shot('gate-offers') });
  // Map 2 by the mouse, then «В гарнизон».
  await page.getByTestId('gate-map-1').click();
  await expect(page.getByTestId('gate-map-1')).toHaveAttribute('aria-pressed', 'true');
  expect((await shown(page)).map).toBe(1);
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  const after = await snap(page);
  expect(after.garrisonMap).toBe(1);
  const expected = generateForestMap(seeds[1]);
  expect(JSON.stringify(after.garrisonLevel.map)).toBe(JSON.stringify(expected));
  // The map on the screen is the chosen garrison's: its nodes by kind (an event is the garrison's find).
  const types = await page.locator('.rt-node[data-type]').evaluateAll(els => els.map(e => e.getAttribute('data-type')).sort());
  const want = expected.nodes.map((n: { type: string }) => (n.type === 'event' ? 'find' : n.type)).sort();
  expect(types).toEqual(want);
  await page.screenshot({ path: shot('gate-garrison-map-2') });
  expect(errors).toEqual([]);
});

test('task 51б view: map 1 (the default) enters the base garrison of the seed', async ({ page }) => {
  test.setTimeout(90_000);
  const at = walkToGate(5, camp3(5))!;
  expect(at && rtGateView(at)?.maps).toBeTruthy();
  await open(page, GATE_PROFILE, at);
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  const after = await snap(page);
  expect(after.garrisonMap).toBe(0);
  expect(JSON.stringify(after.garrisonLevel.map)).toBe(JSON.stringify(generateForestMap(rtGarrisonMaps(at.seed)[0])));
});

test('task 51б view: the consumable chosen joins the hand; a healing one with a full hand is grey with «Рука полна» and is not taken', async ({ page }) => {
  test.setTimeout(120_000);
  // A run with the cap of one potion: find a seed whose hand is full at the gate while «лечение» is offered.
  let full: RtRunState | null = null, free: RtRunState | null = null;
  for (let k = 1; k <= 12 && (!full || !free); k++) {
    const at = walkToGate(k, camp3(k, { potionCap: 1 }));
    const view = at && rtGateView(at);
    if (!at || !view?.items) continue;
    if (!full && view.items.some(entry => !entry.available)) full = at;
    if (!free && view.items.every(entry => entry.available)) free = at;
  }
  expect(full, 'a gate with a full hand and a healing offer').not.toBeNull();
  expect(free, 'a gate where both can be taken').not.toBeNull();
  // Both available: choosing the second one puts it in the hand.
  await open(page, GATE_PROFILE, free!);
  const first = await shown(page);
  expect(first.items).toHaveLength(2);
  expect(first.item, 'the first one that can be taken is chosen').toBe(first.items[0].item);
  const second = first.items[1].item as string, before = (await snap(page)).items[second];
  await page.getByTestId(`gate-item-${second}`).click();
  await expect(page.getByTestId(`gate-item-${second}`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  const after = await snap(page);
  expect(after.items[second]).toBe(before + 1);
  expect(after.gateItem).toBe(second);
  // A full hand: the healing one is disabled with the reason; the click does nothing; the other is taken.
  await open(page, GATE_PROFILE, full!);
  const offers = (await shown(page)).items as { item: string; available: boolean }[];
  const refused = offers.find(entry => !entry.available)!, other = offers.find(entry => entry.available)!;
  expect(refused.item).toBe('healing');
  await expect(page.getByTestId(`gate-item-${refused.item}`)).toBeDisabled();
  await expect(page.getByTestId(`hand-full-gate-${refused.item}`)).toBeVisible();
  await page.getByTestId(`gate-item-${refused.item}`).click({ force: true });
  expect((await shown(page)).item, 'the refused one is not chosen').toBe(other.item);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: shot('gate-hand-full') });
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  const taken = await snap(page);
  expect(taken.gateItem).toBe(other.item);
  expect(taken.items.healing).toBe(full!.items.healing + (other.item === 'healing' ? 1 : 0));
});

test('task 51б view: a run without level 3 shows «Предместье» as before (no offers, the base garrison)', async ({ page }) => {
  test.setTimeout(90_000);
  const at = walkToGate(5, { gift: 'full', garrison: true, moat: true, locked: [], hearth: { jailerRerolls: 1 } })!;
  expect(at && rtGateView(at)).toBeNull();
  await open(page, GATE_PROFILE, at);
  await expect(page.getByTestId('run-outskirts')).toBeVisible();
  await expect(page.getByTestId('run-gate')).toHaveCount(0);
  expect(await shown(page)).toBeNull();
  await expect(page.getByTestId('run-cart')).toBeVisible();
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  const after = await snap(page);
  expect(after.garrisonMap).toBeUndefined();
  expect(JSON.stringify(after.garrisonLevel.map)).toBe(JSON.stringify(generateForestMap(rtGarrisonMaps(at.seed)[0])));
});

test('task 51б view: in the garrison the reward screen reroll is «бесплатно» (Правка Ерофея в гарнизоне), once; in the forest it costs resources', async ({ page }) => {
  test.setTimeout(120_000);
  let garrison: RtRunState | null = null, forest: RtRunState | null = null;
  for (let k = 1; k <= 20 && !garrison; k++) {
    walkRun({ k, create: camp3(k) as never, each: r => {
      const p = r.pending;
      if (p?.kind === 'talisman' && p.source === 'hard') { if (p.nodeId.startsWith('g:')) garrison ??= structuredClone(r); else forest ??= structuredClone(r); }
    } });
  }
  expect(garrison, 'a garrison «Застава» screen').not.toBeNull();
  await open(page, GATE_PROFILE, garrison!);
  const button = page.getByTestId('talisman-reroll');
  await expect(button).toHaveText('Перебросить — бесплатно');
  await expect(page.getByTestId('talisman-reroll-note')).toContainText('Правка Ерофея в гарнизоне');
  await page.screenshot({ path: shot('garrison-reroll-free') });
  const offered = (await snap(page)).pending.options as string[];
  await button.click();
  await expect.poll(async () => (await snap(page)).garrisonRerolled).toBe(1);
  expect((await snap(page)).pending.options).not.toEqual(offered);
  // Used: the next reroll costs resources again.
  await expect(page.getByTestId('talisman-reroll')).not.toHaveText('Перебросить — бесплатно');
  if (forest) {
    await open(page, GATE_PROFILE, forest);
    await expect(page.getByTestId('talisman-reroll')).not.toHaveText('Перебросить — бесплатно');
  }
});
