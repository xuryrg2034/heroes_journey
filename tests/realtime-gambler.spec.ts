import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { serializeRtRun, rtShopReroll, rtShopRerollView, rtShopSwapView, rtNode, type RtHearthFlags, type RtRunState } from '../src/realtime/run/rtRun';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';

/**
 * Task 51 «Лагерь, этап 3», step 51в, the view of Шиш (docs/design-notes/task-51-camp-l3.md, 3.2, 11.1, 11.2; docs/design-notes/npc-lines-v2.md):
 * he comes to the camp (the fallback path: three quiet runs), sits on the left stump, his bubble sells «Шишова лавка», «Размен», «Лавка в
 * гарнизоне» (the lock before the gate), his lines; at the merchant the free reroll with his portrait and «Размен» (3 of a kind → 2 of
 * another, once a run). Real mouse; a merchant's screen is reached by a run walked in Node. The rules: core's (run/hearthGambler.spec.ts).
 */
const shot = (name: string): string => `${process.env.SHOT_DIR ?? 'artifacts'}/${name}.png`;
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const shopShown = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.shopShown());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

const hearth = (levels: object, stock: number, extra: object = {}) => ({ stock, levels, met: { herb: true, smith: true, ...extra }, lines: { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2 }, quiet: 0 });
const profile = (gate: boolean, h: object) => ({ heroes: { cat: { xp: 40, packs: [], record: gate ? { row: 9, won: true, xp: 40 } : { row: 6, won: false, xp: 40 } } }, hearth: h });

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

test('task 51в view: after three quiet runs Шиш comes by himself — the right stump, «✦» until the first click (gone after it and after a reload), his meeting line, «Шишова лавка» and «Размен» bought, the lock of level 3 before the gate', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await open(page, profile(false, { ...hearth({ owl: 0, herb: 0, smith: 0 }, 30), quiet: 3 }));
  // A run started and abandoned: its end counts the quiet run, the fallback brings Шиш.
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  await page.getByTestId('run-to-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
  await expect(page.getByTestId('hearth-npc-gambler')).toBeVisible();
  await expect(page.locator('.rt-hearth-npc')).toHaveCount(4);
  await page.waitForTimeout(800);
  // «✦» over the guest who came, until the first click (not «!», that is the quest's); the old guests (their meeting said) have none.
  await expect(page.getByTestId('hearth-new-gambler')).toHaveText('✦');
  await expect(page.locator('[data-testid^="hearth-new-"]')).toHaveCount(1);
  await page.screenshot({ path: shot('shish-camp-new') });
  await page.getByTestId('hearth-npc-gambler').click();
  await expect(page.getByTestId('hearth-new-gambler')).toHaveCount(0);
  await expect(page.getByTestId('hearth-line')).toHaveText('Не звал, а я пришёл. Из круга меня выгнали, а костёр у тебя тёплый.');
  await expect(page.getByTestId('hearth-bubble')).toContainText('Шиш');
  // The quest of a camp that has him in the draw is Шиш's only when drawn; his levels are sold in order.
  await expect(page.getByTestId('up-gambler-2')).toBeDisabled();
  await page.getByTestId('up-gambler-1').click();
  await expect(page.getByTestId('up-gambler-1-bought')).toBeVisible();
  await expect(page.getByTestId('hearth-line')).toHaveText('«Шишова лавка» открыта! Не глянулся товар у торговца — перетасую разок.');
  await page.getByTestId('up-gambler-2').click();
  await expect(page.getByTestId('up-gambler-2-bought')).toBeVisible();
  await expect(page.getByTestId('hearth-line')).toHaveText('«Размен», партнёр: три смолы — две росы. Это не грабёж, а комиссия.');
  // Level 3 before the gate: «Закрыто · Дойди до гарнизона».
  await expect(page.getByTestId('up-gambler-3-lock')).toBeVisible();
  await expect(page.getByTestId('up-gambler-3-row')).toContainText('Закрыто');
  await expect(page.getByTestId('up-gambler-3-row')).toContainText('Дойди до гарнизона');
  await page.screenshot({ path: shot('shish-bubble') });
  await page.reload();
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth-npc-gambler')).toBeVisible();
  await expect(page.getByTestId('hearth-new-gambler')).toHaveCount(0);
  await page.getByTestId('hearth-npc-gambler').click();
  await expect(page.getByTestId('up-gambler-2-bought')).toBeVisible();
  expect(errors).toEqual([]);
});

test('task 51в view: with the gate open level 3 «Лавка в гарнизоне» is bought for 16 and he says buy_3; a camp without him shows no stump figure', async ({ page }) => {
  await open(page, profile(true, hearth({ owl: 0, herb: 0, smith: 0, gambler: 2 }, 20, { gambler: true })));
  await page.getByTestId('run-hearth').click();
  await page.getByTestId('hearth-npc-gambler').click();
  await expect(page.getByTestId('up-gambler-3-row')).toContainText('Лавка в гарнизоне');
  await page.getByTestId('up-gambler-3').click();
  await expect(page.getByTestId('up-gambler-3-bought')).toBeVisible();
  await expect(page.getByTestId('hearth-line')).toHaveText('У торговцев гарнизона тоже перетасую. Свой человек везде найдётся.');
  await expect(page.getByTestId('hearth-stock').locator('b')).toHaveText('4');
  await open(page, profile(true, hearth({ owl: 0, herb: 0, smith: 0 }, 20)));
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth-npc-gambler')).toHaveCount(0);
});

class Found extends Error { constructor(readonly run: RtRunState) { super('found'); } }
/** The first merchant's screen of a walk (the forest's, or the garrison's with `garrison`) with resources in hand. */
function firstShop(k: number, flags: RtHearthFlags | undefined, garrison = false): RtRunState | null {
  try {
    walkRun({ k, loot: 4, create: { gift: 'full', garrison, locked: [], ...flags ? { hearth: flags } : {} }, pickNode: (run, ids) => ids.find(id => rtNode(run, id)?.type === 'shop') ?? null,
      each: run => { if (run.pending?.kind === 'shop' && (!garrison || run.pending.nodeId.startsWith('g:'))) throw new Found(run); } });
  } catch (e) { if (e instanceof Found) return e.run; throw e; }
  return null;
}
const stockOf = (run: RtRunState): string => JSON.stringify((run.pending as { stock: unknown }).stock);
const PROFILE = profile(true, hearth({ owl: 0, herb: 0, smith: 0, gambler: 3 }, 5, { gambler: true }));

test('task 51в view: the merchant — the free reroll with his portrait changes the goods by a real click, once; «Размен» gives 3 of one kind for 2 of another, once a run', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  // A seed whose reroll really draws other goods and whose hand holds 3 of a kind.
  let shop: RtRunState | null = null;
  for (let k = 1; k <= 40 && !shop; k++) {
    const at = firstShop(k, { shopRerolls: 1, swap: true });
    if (!at || !rtShopSwapView(at)?.available) continue;
    const step = rtShopReroll(at);
    if (step.ok && stockOf(step.run) !== stockOf(at)) shop = at;
  }
  expect(shop, 'a merchant with resources whose reroll changes the goods').not.toBeNull();
  await open(page, PROFILE, shop!);
  await expect(page.getByTestId('shop-reroll')).toBeEnabled();
  await expect(page.getByTestId('shop-reroll')).toContainText('бесплатно');
  await expect(page.getByTestId('shop-swap')).toBeVisible();
  await expect(page.getByTestId('swap-do')).toBeDisabled();
  await page.screenshot({ path: shot('shish-shop') });
  // The reroll: the goods change, the button goes off with its reason, the save keeps it.
  const before = JSON.stringify((await snap(page)).pending.stock);
  await page.getByTestId('shop-reroll').click();
  await expect(page.getByTestId('shop-reroll')).toBeDisabled();
  await expect(page.getByTestId('shop-reroll-note')).toContainText('Перебросов не осталось');
  const after = await snap(page);
  expect(JSON.stringify(after.pending.stock)).not.toBe(before);
  expect(after.shopRerolled).toBe(true);
  // «Размен»: the kind given (3 held), the kind taken, «Обменять».
  const view = (await shopShown(page)).swap as { give: string[] };
  const from = view.give[0], to = ['dew', 'powder', 'resin', 'herbs'].find(kind => kind !== from)!;
  const held = after.materials as Record<string, number>;
  await page.getByTestId(`swap-from-${from}`).click();
  await expect(page.getByTestId(`swap-from-${from}`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId(`swap-to-${to}`).click();
  await expect(page.getByTestId('swap-do')).toBeEnabled();
  await page.screenshot({ path: shot('shish-swap') });
  await page.getByTestId('swap-do').click();
  const swapped = await snap(page);
  expect(swapped.materials[from]).toBe(held[from] - 3);
  expect(swapped.materials[to]).toBe(held[to] + 2);
  expect(swapped.swapped).toBe(true);
  await expect(page.getByTestId('swap-do')).toBeDisabled();
  await expect(page.getByTestId('shop-swap-note')).toContainText('Размен уже был');
  // Leaving still works.
  await page.getByTestId('shop-leave').click();
  await expect(page.getByTestId('shop-leave')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('task 51в view: a merchant of a run without his levels has no reroll and no «Размен»; the garrison merchant has the reroll only with level 3', async ({ page }) => {
  test.setTimeout(120_000);
  const plain = firstShop(3, undefined)!;
  expect(plain && rtShopRerollView(plain)).toBeNull();
  await open(page, PROFILE, plain);
  await expect(page.getByTestId('shop-leave')).toBeVisible();
  await expect(page.getByTestId('shop-reroll')).toHaveCount(0);
  await expect(page.getByTestId('shop-swap')).toHaveCount(0);
  // Level 1 only: the forest has the reroll, no swap.
  const one = firstShop(3, { shopRerolls: 1 })!;
  await open(page, PROFILE, one);
  await expect(page.getByTestId('shop-reroll')).toBeVisible();
  await expect(page.getByTestId('shop-swap')).toHaveCount(0);
  // The garrison's merchant: «Лавка в гарнизоне» (shopRerolls 2) — free there, once, its own counter.
  let garrison: RtRunState | null = null;
  for (let k = 1; k <= 30 && !garrison; k++) garrison = firstShop(k, { shopRerolls: 2 }, true);
  expect(garrison, 'a garrison merchant').not.toBeNull();
  await open(page, PROFILE, garrison!);
  await expect(page.getByTestId('shop-reroll')).toContainText('бесплатно');
  await expect(page.getByTestId('shop-reroll')).toHaveAttribute('title', /Лавка в гарнизоне/);
  await page.getByTestId('shop-reroll').click();
  await expect.poll(async () => (await snap(page)).garrisonShopRerolled).toBe(true);
  await expect(page.getByTestId('shop-reroll')).toBeDisabled();
});
