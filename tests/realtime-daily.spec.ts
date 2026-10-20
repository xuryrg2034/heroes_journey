import { readFileSync, writeFileSync } from 'node:fs';
import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { leaveResult } from './realtimeResult';
import { untilFrame } from './realtimeFrames';
import { createRtDailyRun, rtStep, type RtStepCall } from '../src/realtime/run/rtDaily';
import { rtAvailableNodes } from '../src/realtime/run/rtRun';

/**
 * Task 51з «Поход дня» (docs/design-notes/task-51-camp-l3.md, section 6; docs/realtime-slice.md, «Поход дня») — the view: the button at
 * the fire under «В поход» (closed before the first win in the forest, the reason in view), the panel, «Начать», the run of the date
 * (every step through the core's `rtStep`), the end screen (no experience block; «Сохранить», «Проверить», «Проверить файл») and the
 * proof the check replays. Real clicks and real input; the date is set by the address `?daily=ГГГГ-ММ-ДД`. The fight is lost by standing
 * still (a real fight with no debug command: the proof holds only a player's commands).
 */
const PROFILE = 'ashen-oath-rt-profile-v1';
const PROOFS = 'ashen-oath-rt-daily-v1';
const DATE = '2026-10-20';
/** The date as the player reads it (the file and the seed keep the ISO form). */
const DATE_TEXT = '20.10.2026';
const SHOTS = process.env.SHOT_DIR ?? 'artifacts';
const META = { heroes: { cat: { xp: 5, packs: [], record: { row: 3, won: false, xp: 5 } } }, hearth: { stock: 2, levels: { owl: 0, herb: 0, smith: 0 }, met: {}, lines: { 'owl:first': 2 }, quiet: 0 } };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The page of a viewer with the camp open (a finished run before) and `won` - the first win in the forest. */
async function openCamp(page: Page, won: boolean): Promise<void> {
  await page.goto(`/?daily=${DATE}`);
  await page.evaluate(([key, profile]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem(key as string, JSON.stringify(profile)); },
    [PROFILE, { version: 1, giftFull: true, jailer: true, runs: 3, ...won ? { won: true } : {}, meta: META }] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
}

const dailyLog = (page: Page): Promise<any> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').daily ?? null, PROFILE);
const proofs = (page: Page): Promise<any> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), PROOFS);

/** The gift of the run: the first offer that stands; a pick of consumables / talismans after it, the first. */
async function takeGift(page: Page): Promise<void> {
  await page.locator('[data-action="gift"]:not([disabled])').first().click();
  const pick = page.locator('[data-action="gift-pick"]:not([disabled])').first();
  if (await pick.isVisible().catch(() => false)) await pick.click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
}

/** «Начать» -> the gift screen -> the map -> the first battle node -> the fight, lost by standing still -> the run's end screen. */
async function playAttempt(page: Page): Promise<void> {
  if (!await page.getByTestId('daily-panel').isVisible()) await page.getByTestId('hearth-daily').click();
  await page.getByTestId('daily-start').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await skipHabit(page);
  await takeGift(page);
  const nodes = page.locator('[data-status="available"]');
  await expect(nodes.first()).toBeVisible();
  const types = await nodes.evaluateAll(els => els.map(e => e.getAttribute('data-type')));
  const pick = types.findIndex(t => ['battle', 'hard', 'checkpoint'].includes(t ?? ''));
  await nodes.nth(pick >= 0 ? pick : 0).click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  // Standing still: the hero is worn down by the arena (real game time, read frame by frame).
  const status = await untilFrame(page, (snap: any) => (snap.status !== 'playing' ? snap.status as string : undefined), null, 240);
  expect(status).toBe('defeat');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat');
  await leaveResult(page);
  await expect(page.getByTestId('daily-end')).toBeVisible();
}

test('the button at the fire is closed before the first win, with the reason in view', async ({ page }) => {
  const errors = collectErrors(page);
  await openCamp(page, false);
  const button = page.getByTestId('hearth-daily');
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(page.getByTestId('hearth-daily-reason')).toHaveText('Откроется после первой победы в лесу');
  // Beside «В поход» in the fire's panel: the pair and the reason stand inside the first screen.
  const go = (await page.getByTestId('hearth-go').boundingBox())!, box = (await button.boundingBox())!, reason = (await page.getByTestId('hearth-daily-reason').boundingBox())!;
  expect(Math.abs(box.y - go.y)).toBeLessThan(2);
  expect(box.x).toBeGreaterThan(go.x + go.width - 1);
  expect(reason.y + reason.height).toBeLessThanOrEqual(720);
  expect(errors).toEqual([]);
});

test('the run of the day: start, a fight, the end screen without experience, the proof kept, saved, checked; a second attempt; an ordinary run after', async ({ page }, info) => {
  test.setTimeout(420_000);
  const errors = collectErrors(page);
  await openCamp(page, true);
  await expect(page.getByTestId('hearth-daily')).toBeEnabled();
  await expect(page.getByTestId('hearth-daily-reason')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/daily-hearth-open.png` });
  const box = (await page.getByTestId('hearth-daily').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  const panel = (await page.locator('.rt-hearth-center').boundingBox())!;
  expect(panel.y + panel.height).toBeLessThanOrEqual(720);

  const runsBefore = await page.evaluate(() => (window as any).__realtime.run.session.info().runs);
  await page.getByTestId('hearth-daily').click();
  await expect(page.getByTestId('daily-panel')).toBeVisible();
  await expect(page.getByTestId('daily-date')).toContainText(DATE_TEXT);
  await expect(page.getByTestId('daily-date')).not.toContainText(DATE);
  // Before the first attempt there is no proof: «Сохранить» and «Проверить» are off with the tip, «Проверить файл» is on.
  for (const id of ['daily-save', 'daily-verify']) {
    await expect(page.getByTestId(id)).toBeDisabled();
    await expect(page.getByTestId(id)).toHaveAttribute('title', 'Сначала пройди поход дня');
  }
  await expect(page.getByTestId('daily-file-pick')).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/daily-panel.png` });

  // The attempt 1: the run of the date (flagged, seeded), its steps in the session.
  await playAttempt(page);
  const run = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(run.daily).toBe(DATE);
  expect(run.seeded).toBe(true);
  expect(run.result.outcome).toBe('defeat');
  // No experience block on the end screen; the claim and the buttons are there.
  await expect(page.locator('[data-testid^="meta-"]')).toHaveCount(0);
  await expect(page.getByTestId('daily-claim')).toContainText(DATE_TEXT);
  await expect(page.getByTestId('daily-claim')).not.toContainText(DATE);
  // The run of the day is no run of the viewer's: the profile's count and the session's «походов» are as before, and its end has no
  // session line «В игре … · походов N» (design 21.10.2026; an ordinary run's end keeps it — realtime-session.spec.ts).
  expect(await page.evaluate(() => (window as any).__realtime.run.session.info().runs)).toBe(runsBefore);
  await expect(page.getByTestId('run-session-line')).toHaveCount(0);
  await expect(page.getByTestId('daily-save')).toBeEnabled({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/daily-end.png` });
  // The log (tries 1, first = best) and the proof under its own key.
  const log = await dailyLog(page);
  expect(log[DATE].tries).toBe(1);
  expect(log[DATE].first).toBeTruthy();
  expect(log[DATE].best).toEqual(log[DATE].first);
  const kept = await proofs(page);
  expect(Object.keys(kept)).toEqual([DATE]);
  expect(kept[DATE].steps.length).toBeGreaterThan(3);
  expect(kept[DATE].steps.some((call: any) => call.fn === 'resolveArena')).toBe(true);
  expect(kept[DATE].fights).toHaveLength(kept[DATE].steps.filter((call: any) => call.fn === 'resolveArena').length);
  // The meta is untouched by the run of the day: no experience, no record, no hearth change.
  const profile = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PROFILE);
  expect(profile.meta.heroes.cat.xp).toBe(5);
  expect(profile.runs).toBe(3);

  // «Проверить»: the replay passes.
  await page.getByTestId('daily-verify').click();
  await expect(page.getByTestId('daily-status')).toContainText(`Проверено: ${DATE_TEXT}`, { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/daily-verified.png` });

  // «Сохранить»: the file daily-ГГГГ-ММ-ДД.json.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('daily-save').click()]);
  expect(download.suggestedFilename()).toBe(`daily-${DATE}.json`);
  const path = info.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  expect(saved.kind).toBe('ashen-oath-daily');
  expect(saved.date).toBe(DATE);

  // «Проверить файл»: the saved file passes; a spoiled one is refused (a step changed; the claim raised).
  await page.getByTestId('daily-file').setInputFiles(path);
  await expect(page.getByTestId('daily-status')).toContainText('Проверено', { timeout: 30_000 });
  const spoiled = info.outputPath('daily-spoiled.json');
  writeFileSync(spoiled, JSON.stringify({ ...saved, claim: { ...saved.claim, row: saved.claim.row + 3, wonLevel: 1 } }));
  await page.getByTestId('daily-file').setInputFiles(spoiled);
  await expect(page.getByTestId('daily-status')).toContainText('Не прошло', { timeout: 30_000 });
  const broken = info.outputPath('daily-broken.json');
  writeFileSync(broken, '{ not json');
  await page.getByTestId('daily-file').setInputFiles(broken);
  await expect(page.getByTestId('daily-status')).toContainText('Не удалось прочитать файл');

  // The attempt 2 the same day: the log counts it, the first stays, the best is kept.
  await page.getByTestId('run-to-hearth').click();
  await page.getByTestId('hearth-daily').click();
  await expect(page.getByTestId('daily-tries')).toContainText('1');
  await expect(page.getByTestId('daily-first')).toBeVisible();
  await expect(page.getByTestId('daily-start')).toHaveText('Ещё попытка');
  await playAttempt(page);
  const log2 = await dailyLog(page);
  expect(log2[DATE].tries).toBe(2);
  expect(log2[DATE].first).toEqual(log[DATE].first);
  expect(log2[DATE].best).toBeTruthy();
  await expect(page.locator('[data-testid^="meta-"]')).toHaveCount(0);

  // An ordinary run after it is not a run of the day: the camp's «В поход» starts a meta run.
  await page.getByTestId('run-to-hearth').click();
  await page.getByTestId('hearth-go').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  const ordinary = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(ordinary.daily).toBeUndefined();
  expect(ordinary.seeded).toBeFalsy();
  expect(errors).toEqual([]);
});

test('a run of the day open: the button says why it cannot start, and a reload continues the attempt with its proof', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = collectErrors(page);
  await openCamp(page, true);
  await page.getByTestId('hearth-daily').click();
  await page.getByTestId('daily-start').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await skipHabit(page);
  await takeGift(page);
  // A reload on the map: the run and its session are back (a lost session would make no proof).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run?.state()?.daily)).toBe(true);
  // With the run open the panel offers no start: «Сначала закончи поход».
  await page.getByTestId('run-hearth').click();
  await page.getByTestId('hearth-daily').click();
  await expect(page.getByTestId('daily-reason')).toHaveText('Сначала закончи поход');
  await expect(page.getByTestId('daily-start')).toBeDisabled();
  await page.getByTestId('daily-close').click();
  await page.getByTestId('hearth-back').click();
  // Play on to the end: the proof is made from the session (the steps before the reload too) and passes.
  const nodes = page.locator('[data-status="available"]');
  await expect(nodes.first()).toBeVisible();
  const types = await nodes.evaluateAll(els => els.map(e => e.getAttribute('data-type')));
  const pick = types.findIndex(t => ['battle', 'hard', 'checkpoint'].includes(t ?? ''));
  await nodes.nth(pick >= 0 ? pick : 0).click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const status = await untilFrame(page, (snap: any) => (snap.status !== 'playing' ? snap.status as string : undefined), null, 240);
  expect(status).toBe('defeat');
  await leaveResult(page);
  await expect(page.getByTestId('daily-save')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('daily-verify').click();
  await expect(page.getByTestId('daily-status')).toContainText('Проверено', { timeout: 30_000 });
  expect(errors).toEqual([]);
});

// ---------- The journal of steps is whole: a long run of the day replayed by `rtStep` equals the live state ----------

const SESSION = 'ashen-oath-rt-daily-session-v1';
const liveState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const arenaOpen = (page: Page): Promise<boolean> => page.evaluate(() => (window as any).__realtime.run.arenaOpen());
/** Clicks the first visible match of `selector` (a real click); false - none. */
async function clickFirst(page: Page, selector: string): Promise<boolean> {
  const target = page.locator(selector).first();
  if (!await target.count() || !await target.isVisible()) return false;
  await target.click();
  return true;
}

/**
 * Walks a run of the day by real clicks, as far as it goes without the boss: a different choice on every screen (the habit, the gift,
 * the map's nodes by type - the calm ones first, the fights won by the journalled door run, the knack card, the rest's heal / craft / fuse,
 * the merchant's buy and leave, the event's option, the die, the circle, the talisman and the hammer with a reroll). Returns the node types entered.
 */
async function walkDaily(page: Page, maxFights: number): Promise<string[]> {
  const types: string[] = [];
  let fights = 0, rests = 0, dice = 0;
  for (let turn = 0; turn < 160; turn++) {
    // The animated overlays of the die and the circle: closed or skipped.
    if (await clickFirst(page, '[data-action="die-close"], [data-action="roll-close"]')) continue;
    if (await clickFirst(page, '[data-testid="run-die-roll"][data-action], [data-testid="run-roll"][data-action]')) continue;
    if (await arenaOpen(page)) {
      expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
      await expect(page.getByTestId('result')).toBeVisible();
      fights++;
      // A knack card is taken when the card offers it (rtChooseKnack with an option), else the way on.
      if (!await clickFirst(page, '[data-testid="result"] [data-action="knack"][data-option]:not([data-option=""])')) await leaveResult(page);
      continue;
    }
    const state = await liveState(page), pending = state.pending;
    if (state.result) throw new Error('the walk ended the run');
    if (!pending) {
      if (fights >= maxFights) break;
      const nodes = rtAvailableNodes(state).filter(node => node.type !== 'boss');
      if (!nodes.length) break;
      const calm = ['rest', 'shop', 'event', 'find'], order = (t: string): number => (calm.includes(t) ? (types.includes(t) ? 1 : 0) : 2);
      const node = [...nodes].sort((a, b) => order(a.type) - order(b.type))[0];
      types.push(node.type);
      await page.locator(`[data-node="${node.id}"]`).click();
      await page.getByTestId('run-enter').click();
      continue;
    }
    switch (pending.kind) {
      case 'gift':
        if (await clickFirst(page, '[data-action="habit"]:not([data-habit="none"]):not([disabled])')) continue;
        await takeGift(page);
        break;
      case 'battle': await page.getByTestId('run-battle').click(); await expect.poll(() => arenaOpen(page)).toBe(true); break;
      case 'rest':
        rests++;
        if (await clickFirst(page, '[data-action="rest-fuse"]:not([disabled])')) break;
        if (await clickFirst(page, '[data-action="rest-craft"]:not([disabled])')) break;
        if (await clickFirst(page, '[data-action="rest-heal"]:not([disabled])')) break;
        await page.getByTestId('rest-finish').click();
        break;
      case 'shop':
        if (await clickFirst(page, '[data-action="shop-buy"]:not([disabled])')) break;
        await page.getByTestId('shop-leave').click();
        break;
      case 'event': if (!await clickFirst(page, '[data-action="event-option"]:not([disabled])')) throw new Error('an event with no option'); break;
      case 'find': await page.locator('[data-action="find"]:not([disabled])').first().click(); break;
      case 'die': if (dice++ % 2 === 0) await page.getByTestId('die-roll').click(); else await page.getByTestId('die-take').click(); break;
      case 'casino':
        if (!await clickFirst(page, '[data-action="casino-play"]:not([disabled])')) await page.getByTestId('casino-leave').click();
        break;
      case 'talisman':
        if (await clickFirst(page, '[data-action="talisman-reroll"]:not([disabled])')) break;
        if (!await clickFirst(page, '[data-action="talisman"][data-option]:not([data-option=""]):not([disabled])')) await page.getByTestId('talisman-refuse').click();
        break;
      case 'hammer':
        if (await clickFirst(page, '[data-action="hammer-reroll"]:not([disabled])')) break;
        if (!await clickFirst(page, '[data-action="hammer"][data-option]:not([data-option=""]):not([disabled])')) await page.getByTestId('hammer-refuse').click();
        break;
      case 'knack': if (!await clickFirst(page, '[data-action="knack"][data-option]:not([data-option=""])')) await page.getByTestId('knack-skip').click(); break;
      default: throw new Error(`no button for the screen ${pending.kind}`);
    }
  }
  return types;
}

const REACHED = new Set<string>();
for (const date of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']) {
  test(`${date}: a long run of the day by real clicks - its journal of steps replays through rtStep to the state the page holds`, async ({ page }) => {
    test.setTimeout(420_000);
    const errors = collectErrors(page);
    await page.goto(`/?daily=${date}`);
    await page.evaluate(([key, profile]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem(key as string, JSON.stringify(profile)); },
      [PROFILE, { version: 1, giftFull: true, jailer: true, runs: 3, won: true, meta: META }] as const);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
    await page.getByTestId('run-hearth').click();
    await page.getByTestId('hearth-daily').click();
    await page.getByTestId('daily-start').click();
    await expect(page.getByTestId('run-gift')).toBeVisible();
    const types = await walkDaily(page, 7);
    // The page's run and the session of steps it kept.
    const live = await liveState(page);
    expect(live.daily).toBe(date);
    const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), SESSION);
    expect(session.date).toBe(date);
    const steps: RtStepCall[] = session.steps;
    const fns = [...new Set(steps.map(call => call.fn))].sort();
    console.log(`${date}: ${steps.length} steps, nodes ${types.join(',')}, fns ${fns.join(' ')}`);
    // The walk reached different nodes and screens: the steps are many and varied.
    expect(steps.length).toBeGreaterThan(20);
    for (const fn of ['rtEnterNode', 'resolveArena', 'rtChooseGift']) expect(fns, fn).toContain(fn);
    for (const fn of fns) REACHED.add(fn);
    // The journal alone rebuilds the run: every step is made, and the state is the page's (the whole serialized state).
    let run = createRtDailyRun(date);
    for (const [n, call] of steps.entries()) {
      const step = rtStep(run, call);
      if (!step.ok) throw new Error(`step ${n + 1} ${call.fn} refused: ${step.reason}`);
      run = step.run;
    }
    expect(JSON.parse(JSON.stringify(run))).toEqual(live);
    expect(errors).toEqual([]);
  });
}

test('the long runs together made the steps of the rest, the merchant, the event, the find, the habit, the knack, the talisman', () => {
  console.log(`steps reached in the browser: ${[...REACHED].sort().join(' ')}`);
  for (const fn of ['rtRestHeal', 'rtShopLeave', 'rtChooseEventOption', 'rtChooseFind', 'rtChooseHabit', 'rtChooseKnack', 'rtChooseTalisman']) expect([...REACHED], fn).toContain(fn);
});
