import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { leaveResult } from './realtimeResult';

/**
 * Task 58б «Летопись» (design 17.10.2026, docs/design-notes/task-58-discovery.md), the view on the STUB of the chronicle (view/chronicleStub.ts;
 * core's 58а replaces it): the owl's book in the camp — «✦» at Неясыть, the button «Летопись ✦ N», the window with six tabs, the cards
 * and the strip of the chosen one, Esc / the background / «Закрыть»; the end screen's line from a real fight of a meta run; a `?seed=` run
 * writes nothing. Real mouse and keys at 1280×720. The fixtures (`__realtime.run.chronicleFixture`) stand for the contract, not for rules.
 * Screenshots go to $SHOT_DIR when it is set.
 */
const PROFILE = 'ashen-oath-rt-profile-v1';
const HEARTH = { stock: 3, levels: { owl: 0, herb: 0, smith: 0 }, met: {}, lines: { 'owl:first': 2 }, quiet: 0 };
const META = { heroes: { cat: { xp: 20, packs: [], record: { row: 3, won: false, xp: 20 } } }, hearth: HEARTH };

const shot = async (page: Page, name: string): Promise<void> => {
  if (!process.env.SHOT_DIR) return;
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openRun(page: Page, url = '/'): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, meta]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem(key as string, JSON.stringify({ version: 1, giftFull: false, runs: 3, meta })); }, [PROFILE, META] as const);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

const shown = (page: Page) => page.evaluate(() => (window as any).__realtime.run.chronicleShown());
const fixture = (page: Page, name: string) => page.evaluate(n => (window as any).__realtime.run.chronicleFixture(n), name);

/** The camp from the run screen's «Лагерь», then Неясыть's bubble. */
async function toCamp(page: Page): Promise<void> {
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
}

test('task 58: «✦» at Неясыть, the button «Летопись ✦ N»; the window opens with six tabs and the counts of the contract; a card gives its line; Esc closes; the «✦» is gone', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openRun(page);
  expect(await fixture(page, 'unread')).toBe(true);
  await toCamp(page);
  await fixture(page, 'unread');
  // The new is marked at the owl's name before anything is opened.
  await expect(page.getByTestId('hearth-chron-mark')).toBeVisible();
  await shot(page, 'camp-owl-mark');
  await page.getByTestId('hearth-npc-owl').click();
  await expect(page.getByTestId('hearth-chronicle')).toContainText('Летопись');
  await expect(page.getByTestId('hearth-chronicle-new')).toContainText('✦ 2');
  await page.getByTestId('hearth-chronicle').click();
  await expect(page.getByTestId('chronicle')).toBeVisible();
  const first = await shown(page);
  expect(first.open).toBe(true);
  expect(first.page).toBe('bestiary');
  expect(first.tabs.map((t: { id: string }) => t.id)).toEqual(['bestiary', 'bosses', 'events', 'items', 'heroes', 'hearth']);
  // The header and the tabs are the contract's numbers.
  await expect(page.getByTestId('chron-total')).toHaveText(`Записано ${first.total[0]} / ${first.total[1]}`);
  for (const tab of first.tabs as { id: string; have: number; known: number }[]) await expect(page.getByTestId(`chron-tab-${tab.id}`)).toContainText(`${tab.have} / ${tab.known}`);
  // Opening read the unread: the camp behind lost its «✦»; the tab with the new keeps its own until opened.
  await expect(page.getByTestId('hearth-chron-mark')).toHaveCount(0);
  await expect(page.getByTestId('chron-new')).toHaveCount(1);
  await expect(page.getByTestId('chron-tab-items')).toContainText('✦');
  // The bestiary: a met kind has its name, a kind not met is a «?» with none; the next level is one unnamed blank tab.
  await expect(page.getByTestId('chron-card-wolf')).toContainText('Волк');
  await expect(page.getByTestId('chron-card-shaman')).toHaveAttribute('data-state', 'unknown');
  await expect(page.getByTestId('chron-card-shaman')).not.toContainText('Шаман');
  await expect(page.getByTestId('chron-blank')).toHaveCount(1);
  await expect(page.getByTestId('chron-card-guard')).toHaveCount(0);
  // A click on a card fills the strip with its line; a «?» gives nothing away.
  await page.getByTestId('chron-card-wolf').click();
  await expect(page.getByTestId('chron-line')).toContainText('окружает');
  await page.getByTestId('chron-card-shaman').click();
  await expect(page.getByTestId('chron-line')).toHaveText('');
  // The pointer over a card shows its line too.
  await page.getByTestId('chron-card-boar').hover();
  await expect(page.getByTestId('chron-line')).toContainText('после «!»');
  // Another page; its ✦ goes with the visit.
  await page.getByTestId('chron-tab-items').click();
  await expect(page.getByTestId('chron-page')).toHaveAttribute('data-page', 'items');
  await expect(page.getByTestId('chron-new')).toHaveCount(0);
  await expect(page.getByTestId('chron-card-prism')).toHaveAttribute('data-state', 'taken');
  await expect(page.getByTestId('chron-card-long-arm')).toHaveAttribute('data-state', 'locked');
  await shot(page, 'chronicle-items-novice');
  // The window sits in the screen and the page needs no scroll.
  const fit = await page.evaluate(() => { const w = document.querySelector('.rt-chron')!.getBoundingClientRect(), p = document.querySelector('.rt-chron-page')!; return { top: w.top, bottom: w.bottom, left: w.left, right: w.right, scroll: p.scrollHeight - p.clientHeight }; });
  expect(fit.top).toBeGreaterThanOrEqual(0); expect(fit.bottom).toBeLessThanOrEqual(720); expect(fit.left).toBeGreaterThanOrEqual(0); expect(fit.right).toBeLessThanOrEqual(1280);
  expect(fit.scroll).toBeLessThanOrEqual(0);
  // Esc closes the book (and not the camp).
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chronicle')).toHaveCount(0);
  await expect(page.getByTestId('hearth')).toBeVisible();
  expect((await shown(page)).open).toBe(false);
  await page.getByTestId('hearth-npc-owl').click();
  await expect(page.getByTestId('hearth-chronicle-new')).toHaveCount(0);
  await expect(page.getByTestId('hearth-chron-mark')).toHaveCount(0);
  // The background and «Закрыть» close it too.
  await page.getByTestId('hearth-chronicle').click();
  await expect(page.getByTestId('chronicle')).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(page.getByTestId('chronicle')).toHaveCount(0);
  await page.getByTestId('hearth-chronicle').click();
  await page.getByTestId('chron-close').click();
  await expect(page.getByTestId('chronicle')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('task 58: the book after the garrison — its chapters open, the next level is an unnamed «…», the longest page fits 1280×720 without scrolling; a half recipe shows «Иней на клинке + ?»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openRun(page);
  await toCamp(page);
  // The first camp of a newcomer: every page once (shots for the design).
  await fixture(page, 'novice');
  await page.getByTestId('hearth-npc-owl').click();
  await page.getByTestId('hearth-chronicle').click();
  for (const id of ['bestiary', 'bosses', 'events', 'items', 'heroes', 'hearth']) {
    await page.getByTestId(`chron-tab-${id}`).click();
    await expect(page.getByTestId('chron-page')).toHaveAttribute('data-page', id);
    const fit = await page.evaluate(() => { const p = document.querySelector('.rt-chron-page')!; return p.scrollHeight - p.clientHeight; });
    expect(fit, `${id} needs no scroll`).toBeLessThanOrEqual(0);
    await shot(page, `chronicle-novice-${id}`);
  }
  await page.keyboard.press('Escape');
  // After the garrison.
  await fixture(page, 'garrison');
  await page.getByTestId('hearth-npc-owl').click();
  await page.getByTestId('hearth-chronicle').click();
  await expect(page.getByTestId('chron-chapter-garrison')).toBeVisible();
  await expect(page.getByTestId('chron-card-guard')).toContainText('Стражник');
  await expect(page.getByTestId('chron-blank')).toHaveCount(1);
  await expect(page.getByTestId('chron-chapter-forest')).toContainText('8 / 8');
  await expect(page.getByTestId('chron-full')).toHaveCount(1);
  await shot(page, 'chronicle-garrison-bestiary');
  await page.getByTestId('chron-tab-bosses').click();
  await expect(page.getByTestId('chron-card-castellan')).toContainText('побеждён, поход 14');
  await shot(page, 'chronicle-garrison-bosses');
  await page.getByTestId('chron-tab-items').click();
  const state = await shown(page);
  expect(state.cards).toBe(36);
  const fit = await page.evaluate(() => { const p = document.querySelector('.rt-chron-page')!, w = document.querySelector('.rt-chron')!.getBoundingClientRect(); return { scroll: p.scrollHeight - p.clientHeight, bottom: w.bottom }; });
  expect(fit.scroll).toBeLessThanOrEqual(0);
  expect(fit.bottom).toBeLessThanOrEqual(720);
  await shot(page, 'chronicle-garrison-items');
  await page.getByTestId('chron-tab-heroes').click();
  await expect(page.getByTestId('chron-card-ash:cat:5')).toHaveAttribute('data-state', 'seen');
  await expect(page.getByTestId('chron-card-ash:cat:6')).toHaveAttribute('data-state', 'unknown');
  await shot(page, 'chronicle-garrison-heroes');
  await page.keyboard.press('Escape');
  // The half recipe.
  await fixture(page, 'fusionHalf');
  await page.getByTestId('hearth-npc-owl').click();
  await page.getByTestId('hearth-chronicle').click();
  await page.getByTestId('chron-tab-items').click();
  await expect(page.getByTestId('chron-card-fusion-ice-seal')).toContainText('+ ?');
  await expect(page.getByTestId('chron-card-fusion-ice-seal')).not.toContainText('Ледяная печать');
  await page.getByTestId('chron-card-fusion-ice-seal').click();
  await expect(page.getByTestId('chron-line')).toHaveText('Иней на клинке + ?');
  await page.getByTestId('chron-card-fusion-ice-seal').scrollIntoViewIfNeeded();
  await shot(page, 'chronicle-fusion-half');
  expect(errors).toEqual([]);
});

/** The first battle of the run: new run, the first battle node, entered. */
async function toBattle(page: Page): Promise<void> {
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await skipHabit(page);
  await page.locator('[data-action="gift"]:not([disabled])').last().click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  const nodes = page.locator('[data-status="available"]');
  await expect(nodes.first()).toBeVisible();
  const types = await nodes.evaluateAll(els => els.map(e => e.getAttribute('data-type')));
  const pick = types.findIndex(t => ['battle', 'hard', 'checkpoint', 'breakthrough'].includes(t ?? ''));
  await nodes.nth(pick >= 0 ? pick : 0).click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
}

/** A lynx comes into view in the open fight, then the hero is lost to a ring of enemies. */
async function lynxThenLose(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    rt.place(hero.x + 2.5, hero.y, 0, 3, 'lynx');
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await leaveResult(page);
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
}

test('task 58: a kind that comes into view in a fight of a meta run reaches the chronicle; the run-end block says «В летописи: +1 · Рысь»; the camp marks it with «✦»; the book shows the lynx', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openRun(page);
  // The retro went in when the page's camp state was read; start from a clean stub.
  await fixture(page, 'novice');
  expect((await shown(page)).calls.meet).toBe(0);
  await toBattle(page);
  await lynxThenLose(page);
  const calls = (await shown(page)).calls;
  expect(calls.meet).toBeGreaterThan(0);
  expect(calls.lastMeet.kinds).toContain('lynx');
  await expect(page.getByTestId('meta-end')).toBeVisible();
  await expect(page.getByTestId('meta-chronicle')).toContainText('В летописи: +');
  await expect(page.getByTestId('meta-chronicle')).toContainText('Рысь');
  await expect(page.getByTestId('meta-chronicle')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, 'end-chronicle-line');
  await page.getByTestId('run-to-hearth').click();
  await expect(page.getByTestId('hearth-chron-mark')).toBeVisible();
  await page.getByTestId('hearth-npc-owl').click();
  await page.getByTestId('hearth-chronicle').click();
  await expect(page.getByTestId('chron-card-lynx')).toHaveAttribute('data-state', 'seen');
  await expect(page.getByTestId('chron-card-lynx')).toContainText('Рысь');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hearth-chron-mark')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('task 58: a given seed (`?seed=`) writes nothing to the chronicle', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openRun(page, '/?seed=7');
  await toBattle(page);
  expect(await page.evaluate(() => (window as any).__realtime.run.state()?.seeded)).toBe(true);
  await page.evaluate(() => { const rt = (window as any).__realtime, hero = rt.snapshot().hero; rt.place(hero.x + 2.5, hero.y, 0, 3, 'lynx'); });
  await page.waitForTimeout(1200);
  expect((await shown(page)).calls.meet).toBe(0);
  expect(errors).toEqual([]);
});
