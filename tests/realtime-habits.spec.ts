import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import {
  createRtRun, resolveArena, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick, rtChooseHabit, rtChooseHammer, rtChooseTalisman, rtDieChoose,
  rtEnterNode, rtEventView, rtGiftView, rtItemRefusal, rtNode, rtRestHeal, rtShopLeave, serializeRtRun, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';
import { RT_HABITS, rtHabit, rtTalisman, type RtHabitId } from '../src/realtime/run/rtTalismans';

/**
 * Task 50 step 5 «Повадка» (design 16.10.2026, docs/design-notes/task-50-levels-archetype.md, 4.6): the archetype row over the gift `full`
 * (four cards and «Без повадки»; the gift's buttons wait for it), the sign in the map's header, the icon in the corner of an item card that
 * carries the chosen tag (`rtTalisman(id).tags` — read from the catalogue, no table here), the Jailer's tagged form in place 1.
 * Real mouse at 1280×720; the saves are walked by the run's own commands in Node. Screenshots go to $SHOT_DIR when it is set.
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }); };
const shown = (page: Page): Promise<{ habit: string | null | undefined; row: boolean; chosen: boolean; signs: number; marks: number; marked: string[] }> => page.evaluate(() => (window as any).__realtime.run.habitShown());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

function ok(step: RtRunStep): RtRunState { if (!step.ok) throw new Error(step.reason); return step.run; }

/** One command of the walk for the open screen (the first node of the row, the first available gift button, refuse every talisman). */
function advance(run: RtRunState, n: number, take: (run: RtRunState) => string | null = () => null): RtRunState {
  const p = run.pending;
  if (p?.kind === 'battle') return ok(resolveArena(run, { nodeId: p.nodeId, won: true, hp: run.hp, kills: 5, damage: 0, time: 30, bestChain: n === 3 ? 7 : 2 }));
  if (p?.kind === 'gift') {
    const view = rtGiftView(run)!;
    if (view.habit && !view.habit.chosen) return ok(rtChooseHabit(run, null));
    return view.chosen !== null ? ok(rtChooseGiftPick(run, view.picks[0])) : ok(rtChooseGift(run, view.options.find(entry => entry.available)?.index ?? null));
  }
  if (p?.kind === 'talisman') return ok(rtChooseTalisman(run, take(run)));
  if (p?.kind === 'hammer') return ok(rtChooseHammer(run, null));
  if (p?.kind === 'die') return ok(rtDieChoose(run, false));
  if (p?.kind === 'find') return ok(rtChooseFind(run, p.options.find(item => !rtItemRefusal(run, item)) ?? p.options[0]));
  if (p?.kind === 'rest') return ok(rtRestHeal(run));
  if (p?.kind === 'shop') return ok(rtShopLeave(run));
  if (p?.kind === 'event') return ok(rtChooseEventOption(run, rtEventView(run)!.options.find(option => option.safe && option.available)!.id));
  if (!p) return ok(rtEnterNode(run, rtAvailableNodes(run)[0].id));
  throw new Error(`stuck on ${p.kind}`);
}

const tagged = (id: string, habit: RtHabitId | null | undefined): boolean => !!habit && !!rtTalisman(id)?.tags?.includes(habit);

/** A run with the archetype `habit` (`null` — «Без повадки»; `undefined` — no choice made, the gift stays open) walked until `stop` holds; null — never. */
function walk(habit: RtHabitId | null | undefined, stop: (run: RtRunState) => boolean, options: Parameters<typeof createRtRun>[1] = {}): RtRunState | null {
  for (let k = 1; k < 60; k++) {
    let run: RtRunState = createRtRun(seedOf(k), { gift: 'full', garrison: false, ...options });
    if (habit !== undefined) run = ok(rtChooseHabit(run, habit));
    for (let n = 0; n < 200 && !run.result; n++) {
      if (run.pending && stop(run)) return run;
      run = advance(run, n);
    }
  }
  return null;
}

async function openSave(page: Page, run: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RUN_KEY, serializeRtRun(run)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

/** A talisman screen of the «Застава» type with a tagged and an untagged card of the habit. */
const mixedScreen = (habit: RtHabitId) => (run: RtRunState): boolean => run.pending?.kind === 'talisman' && run.pending.source !== 'form'
  && run.pending.options.some(id => tagged(id, habit)) && run.pending.options.some(id => !tagged(id, habit));

test('the gift full: the row «Повадка» first, the gift buttons wait for the choice, one click decides, the sign stands in the header', async ({ page }) => {
  const errors = collectErrors(page);
  const run = createRtRun(seedOf(3), { gift: 'full', garrison: false });
  expect(run.pending?.kind).toBe('gift');
  await openSave(page, run);
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await expect(page.getByTestId('gift-habits')).toBeVisible();
  for (const def of RT_HABITS) {
    const card = page.getByTestId(`habit-${def.id}`);
    await expect(card).toContainText(def.name);
    await expect(card).toContainText(def.line);
  }
  await expect(page.getByTestId('habit-none')).toHaveText('Без повадки');
  const gifts = page.locator('[data-testid^="gift-"][data-action="gift"]');
  expect(await gifts.count()).toBeGreaterThan(0);
  for (let i = 0; i < await gifts.count(); i++) await expect(gifts.nth(i)).toBeDisabled();
  expect(await shown(page)).toMatchObject({ row: true, chosen: false, signs: 0, habit: null });
  await shot(page, 'habit-gift-before');
  // A reload before the choice shows the same.
  await page.reload();
  await expect(page.getByTestId('gift-habits')).toHaveAttribute('data-chosen', 'false');
  await expect(page.getByTestId('gift-0')).toBeDisabled();
  await page.getByTestId('habit-cold').click();
  expect(await shown(page)).toMatchObject({ row: true, chosen: true, habit: 'cold' });
  await expect(page.getByTestId('habit-cold')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('habit-flame')).toBeDisabled();
  const available = rtGiftView(run)!.options.filter(entry => entry.available).map(entry => entry.index);
  for (const index of available) await expect(page.getByTestId(`gift-${index}`)).toBeEnabled();
  await shot(page, 'habit-gift-after');
  // A reload on the open gift after the choice shows the choice.
  await page.reload();
  await expect(page.getByTestId('habit-cold')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`gift-${available[0]}`)).toBeEnabled();
  await page.getByTestId(`gift-${available[0]}`).click();
  await expect(page.getByTestId('run-gift')).toHaveCount(0);
  await expect(page.getByTestId('run-habit')).toHaveAttribute('data-habit', 'cold');
  expect(await shown(page)).toMatchObject({ habit: 'cold', signs: 1 });
  await shot(page, 'habit-header-sign');
  expect(errors).toEqual([]);
});

test('a talisman screen: the icon stands in the corner of exactly the cards that carry the chosen tag', async ({ page }) => {
  const errors = collectErrors(page);
  for (const def of RT_HABITS) {
    const run = walk(def.id, mixedScreen(def.id));
    expect(run, def.id).toBeTruthy();
    await openSave(page, run!);
    const options = run!.pending!.kind === 'talisman' ? run!.pending!.options : [];
    const want = options.filter(id => tagged(id, def.id));
    await expect(page.locator('.rt-run-modal .rt-run-choice').first()).toBeVisible();
    const info = await shown(page);
    expect(info.marked.sort()).toEqual([...want].sort());
    expect(info.marks).toBeGreaterThan(0);
    expect(info.marks).toBeLessThan(options.length);
    for (const id of options) await expect(page.getByTestId(`habit-mark-${id}`)).toHaveCount(want.includes(id) ? 1 : 0);
    // The mark has no caption and sits in the card's corner.
    const card = await page.getByTestId(`talisman-${want[0]}`).boundingBox(), mark = await page.getByTestId(`habit-mark-${want[0]}`).boundingBox();
    expect(mark!.x + mark!.width).toBeLessThanOrEqual(card!.x + card!.width);
    expect(mark!.y).toBeLessThan(card!.y + card!.height / 2);
    await expect(page.getByTestId(`habit-mark-${want[0]}`)).toHaveText('');
    if (def.id === 'cold') await shot(page, 'habit-mark-talisman');
  }
  expect(errors).toEqual([]);
});

test('«Без повадки»: no sign, no marks, the offers as in a run without the flag', async ({ page }) => {
  const errors = collectErrors(page);
  const on = createRtRun(seedOf(5), { gift: 'full', garrison: false });
  await openSave(page, on);
  await page.getByTestId('habit-none').click();
  await expect(page.getByTestId('habit-none')).toHaveAttribute('aria-pressed', 'true');
  expect(await shown(page)).toMatchObject({ chosen: true, habit: null });
  await page.getByTestId(`gift-${rtGiftView(on)!.options.find(entry => entry.available)!.index}`).click();
  await expect(page.getByTestId('run-gift')).toHaveCount(0);
  expect(await shown(page)).toMatchObject({ habit: undefined, signs: 0 });
  const state = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(state.habit).toBeUndefined();
  // The same walk with no flag at all offers the same talismans, screen by screen (the weights are all 1).
  const offers = (flag: boolean): string[][] => {
    let run: RtRunState = createRtRun(seedOf(5), { gift: 'full', garrison: false, habits: flag });
    const seen: string[][] = [];
    for (let n = 0; n < 200 && !run.result; n++) {
      if (run.pending?.kind === 'talisman') seen.push([...run.pending.options]);
      run = advance(run, n);
    }
    return seen;
  };
  const a = offers(true), b = offers(false);
  expect(a.length).toBeGreaterThan(0);
  expect(a).toEqual(b);
  // On a talisman screen of such a run there is no mark.
  const run = walk(null, r => r.pending?.kind === 'talisman');
  await openSave(page, run!);
  await expect(page.locator('.rt-run-modal .rt-run-choice').first()).toBeVisible();
  expect(await shown(page)).toMatchObject({ marks: 0, signs: 0 });
  expect(errors).toEqual([]);
});

test('the shop and the Jailer: a tagged card carries the icon; the Jailer\'s place 1 holds the form of the tag', async ({ page }) => {
  const errors = collectErrors(page);
  let checkedShop = false, checkedForm = 0;
  for (const habit of ['cold', 'flame', 'shift', 'daring'] as RtHabitId[]) {
    const form = walk(habit, run => run.pending?.kind === 'talisman' && run.pending.source === 'form');
    expect(form, habit).toBeTruthy();
    const options = form!.pending!.kind === 'talisman' ? form!.pending!.options : [];
    // Place 1 is the archetype's form whenever the pool holds one (a closed set may leave none: then the screen is as before).
    if (tagged(options[0], habit)) {
      await openSave(page, form!);
      await expect(page.getByTestId('run-form')).toBeVisible();
      await expect(page.getByTestId(`habit-mark-${options[0]}`)).toHaveCount(1);
      await expect(page.locator('.rt-run-choice').first()).toHaveAttribute('data-testid', `talisman-${options[0]}`);
      for (const id of options) await expect(page.getByTestId(`habit-mark-${id}`)).toHaveCount(tagged(id, habit) ? 1 : 0);
      expect(rtHabit(habit).name.length).toBeGreaterThan(0);
      if (checkedForm++ === 0) await shot(page, 'habit-jailer-form');
    }
    const shop = walk(habit, run => run.pending?.kind === 'shop' && tagged(run.pending.stock.talisman ?? '', habit));
    if (shop) {
      await openSave(page, shop);
      await expect(page.getByTestId('run-shop')).toBeVisible();
      await expect(page.getByTestId(`habit-mark-${(shop.pending as any).stock.talisman}`)).toHaveCount(1);
      checkedShop = true;
    }
  }
  expect(checkedForm).toBeGreaterThan(0);
  expect(checkedShop).toBe(true);
  expect(errors).toEqual([]);
});
