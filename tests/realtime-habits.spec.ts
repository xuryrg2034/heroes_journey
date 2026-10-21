import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import {
  createRtRun, resolveArena, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick, rtChooseHabit, rtChooseHammer, rtChooseKnack, rtChooseTalisman, rtDieChoose,
  rtEnterNode, rtEventView, rtGiftView, rtItemRefusal, rtNode, rtRestHeal, rtShopLeave, serializeRtRun, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';
import { RT_COUNTER_WINDOW, RT_HABITS, rtHabit, rtTalisman, type RtHabitId } from '../src/realtime/run/rtTalismans';

/**
 * Task 50 step 5 «Повадка» (design 16.10.2026, docs/design-notes/task-50-levels-archetype.md, 4.6): the archetype row over the gift `full`
 * (four cards and «Без повадки»; the gift's buttons wait for it), the sign in the map's header, the icon in the corner of an item card that
 * carries the chosen tag (`rtTalisman(id).tags` — read from the catalogue, no table here), the Jailer's tagged form in place 1.
 * Real mouse at 1280×720; the saves are walked by the run's own commands in Node. Screenshots go to $SHOT_DIR when it is set.
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
// The cards of a screen come in one by one (task 47 reveal): a shot waits for the last (finite animations only: a pulse never ends).
const shot = async (page: Page, name: string): Promise<void> => {
  if (!process.env.SHOT_DIR) return;
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished)));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
};
const shown = (page: Page): Promise<{ habit: string | null | undefined; row: boolean; chosen: boolean; signs: number; marks: number; marked: string[]; flashes: number; flashing: number; items: Record<string, string[]>; hint: string }> => page.evaluate(() => (window as any).__realtime.run.habitShown());

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
  if (p?.kind === 'knack') return ok(rtChooseKnack(run, null));
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
  // Design 17.10.2026 (§17): one word over the four cards.
  await expect(page.getByTestId('gift-habits-title')).toHaveText('Повадка');
  for (const def of RT_HABITS) {
    const card = page.getByTestId(`habit-${def.id}`);
    await expect(card).toContainText(def.name);
    await expect(card).toContainText(def.line);
  }
  await expect(page.getByTestId('habit-none')).toHaveText('Без повадки');
  // Design 20.10.2026 (§18): the line under the title says what the choice does; each card shows 2-3 opened items of its tag beside the words.
  await expect(page.getByTestId('gift-habits-hint')).toHaveText('Предметы с этим знаком будут попадаться чаще');
  const icons = (await shown(page)).items;
  for (const def of RT_HABITS) {
    expect(icons[def.id].length, `${def.id}: 2-3 item icons`).toBeGreaterThanOrEqual(2);
    expect(icons[def.id].length).toBeLessThanOrEqual(3);
    for (const id of icons[def.id]) expect(rtTalisman(id)?.tags, `${id} carries ${def.id}`).toContain(def.id);
    await expect(page.getByTestId(`habit-items-${def.id}`).locator('.rt-habit-item')).toHaveCount(icons[def.id].length);
  }
  // Design 20.10.2026: a real hover on an item's icon gives the same bubble as the habit's mark, with the item's name alone (no effect).
  for (const def of RT_HABITS) {
    const icon = page.getByTestId(`habit-items-${def.id}`).locator('.rt-habit-item').first();
    await icon.hover();
    const tip = (await icon.getAttribute('data-tip'))!, shownText = await icon.evaluate(el => getComputedStyle(el, '::after').content);
    expect(tip.length, `${def.id}: the name`).toBeGreaterThan(1);
    expect(tip).not.toContain('—');
    expect(shownText, `${def.id}: the bubble shows the name`).toBe(`"${tip}"`);
    expect(await icon.getAttribute('title')).toBeNull();
    if (def.id === 'cold') await shot(page, 'habit-item-tip');
  }
  await page.mouse.move(0, 0);
  const gifts = page.locator('[data-testid^="gift-"][data-action="gift"]');
  // Design 20.10.2026: the oath's button says the name once — «Клятва голода» — effect (not «Клятва: «Клятва голода» — …»).
  const texts = await gifts.allInnerTexts();
  expect(texts.some(text => /^«Клятва голода» — /.test(text)), `an oath button: ${texts.join(' | ')}`).toBe(true);
  expect(texts.every(text => !text.includes('Клятва: «')), 'the word is not said twice').toBe(true);
  expect(await gifts.count()).toBeGreaterThan(0);
  for (let i = 0; i < await gifts.count(); i++) await expect(gifts.nth(i)).toBeDisabled();
  expect(await shown(page)).toMatchObject({ row: true, chosen: false, signs: 0, habit: null });
  await shot(page, 'habit-gift-before');
  // A reload before the choice shows the same.
  await page.reload();
  await expect(page.getByTestId('gift-habits')).toHaveAttribute('data-chosen', 'false');
  await expect(page.getByTestId('gift-0')).toBeDisabled();
  // Design 21.10.2026 (§19): the row stays live until the gift button is pressed — a slip of the mouse is not final.
  await page.getByTestId('habit-none').click();
  expect(await shown(page)).toMatchObject({ row: true, chosen: true, habit: null });
  await expect(page.getByTestId('habit-none')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'habit-gift-none-chosen');
  await page.getByTestId('habit-cold').click();
  expect(await shown(page)).toMatchObject({ row: true, chosen: true, habit: 'cold' });
  await expect(page.getByTestId('gift-habits-hint'), 'the line stays until the gift button').toHaveText('Предметы с этим знаком будут попадаться чаще');
  await expect(page.getByTestId('habit-cold')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('habit-none')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('habit-cold')).toHaveClass(/rt-on/);
  await expect(page.getByTestId('habit-none')).not.toHaveClass(/rt-on/);
  await expect(page.getByTestId('habit-flame')).toBeEnabled();
  await expect(page.getByTestId('habit-none')).toBeEnabled();
  await shot(page, 'habit-gift-card-chosen');
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
  // The sign stands apart from the consumables' line (design §17): a gap of 10 px and more.
  const sign = (await page.getByTestId('run-habit').boundingBox())!, items = (await page.getByTestId('run-items').boundingBox())!;
  expect(items.x - (sign.x + sign.width), 'a gap between the sign and «Холод …»').toBeGreaterThanOrEqual(10);
  await shot(page, 'habit-header-sign');
  expect(errors).toEqual([]);
});

test('a run with forms names the counters by their chain window on the gift: the button and the screen of the pick say «Острие» / «Улов» and the window\'s rule, not the catalogue\'s', async ({ page }) => {
  // Defect of 17.10.2026 (design → core → ui): the gift wrote «Пятое звено» and «каждое 5-е звено» in a run with the counters' window.
  const errors = collectErrors(page);
  const windowed = Object.keys(RT_COUNTER_WINDOW).filter(id => RT_COUNTER_WINDOW[id].name);
  let found: { run: RtRunState; index: number; id: string } | null = null;
  for (let k = 1; k < 80 && !found; k++) {
    const run = createRtRun(seedOf(k), { gift: 'full', garrison: false });
    if (!run.forms) continue;
    for (const entry of rtGiftView(run)!.options) {
      const option = entry.option;
      if (!entry.available || option.kind !== 'deal' || option.reward.kind !== 'pick-talisman') continue;
      const id = option.reward.talismans.find(t => windowed.includes(t));
      if (id) { found = { run, index: entry.index, id }; break; }
    }
  }
  if (!found) throw new Error('no run of 80 offers a counter in the gift');
  const { run, index, id } = found, shown = RT_COUNTER_WINDOW[id], catalogue = rtTalisman(id)!;
  await openSave(page, run);
  await page.getByTestId('habit-none').click();
  const button = page.getByTestId(`gift-${index}`);
  await expect(button).toContainText(shown.name!);
  await expect(button).not.toContainText(catalogue.name);
  await button.click();
  const pick = page.getByTestId(`gift-pick-${id}`);
  await expect(pick).toContainText(shown.name!);
  await expect(pick).toContainText(shown.effect);
  await expect(pick).not.toContainText(catalogue.name);
  await expect(pick).not.toContainText(catalogue.effect);
  await shot(page, 'habit-gift-window-names');
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
    // The mark has no caption and sits in the card's corner (measured after the flash: its scale is an animation).
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => null))));
    const card = await page.getByTestId(`talisman-${want[0]}`).boundingBox(), mark = await page.getByTestId(`habit-mark-${want[0]}`).boundingBox();
    expect(mark!.x + mark!.width).toBeLessThanOrEqual(card!.x + card!.width);
    expect(mark!.y).toBeLessThan(card!.y + card!.height / 2);
    await expect(page.getByTestId(`habit-mark-${want[0]}`)).toHaveText('');
    // Design 20.10.2026 (§18): a hover on the mark gives a readable bubble, not a bare title; the first screen with marks flashes them once a run.
    const tip = `Повадка «${def.name}»: такие предметы попадаются чаще`;
    await expect(page.getByTestId(`habit-mark-${want[0]}`)).toHaveAttribute('data-tip', tip);
    expect(info.flashes, `${def.id}: the first screen with marks flashed once`).toBe(1);
    expect(info.flashing).toBe(info.marks);
    await page.getByTestId(`habit-mark-${want[0]}`).hover();
    expect(await page.getByTestId(`habit-mark-${want[0]}`).evaluate(el => getComputedStyle(el, '::after').content)).toBe(`"${tip}"`);
    if (def.id === 'cold') await shot(page, 'habit-mark-tip');
    await page.mouse.move(0, 0);
    if (def.id === 'cold') await shot(page, 'habit-mark-talisman');
    // A redraw of the same screen does not flash again.
    expect((await shown(page)).flashes).toBe(1);
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
