import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { leaveResult } from './realtimeResult';

/**
 * П8 «Новое на карте» (docs/realtime-slice.md, «Новое на карте»; docs/realtime-engagement-research.md): with real input at
 * 1280×720 — a fresh viewer's available arena card carries «✦ новое»; in the fight the first enemy of a kind that comes into
 * view gets its caption (the exact text, once, 1.5 s); a second fight with the same kind shows none (the memory is the
 * viewer's `localStorage`); an elite with an affix gets the kind's caption and the affix's; the gear toggle «Новое на карте»
 * hides sign and captions (the memory is still written); the sandbox shows none and writes nothing. The memory and the sign
 * logic against real run maps are checked in Node (`npm run test:realtime-new-seen`). Runs through playwright.realtime.config.ts.
 */
const KEY = 'ashen-oath-realtime-new-seen';
const WOLF = 'Волк — окружает; в стае бьёт сильнее';
const ARCHER = 'Лучник — метит точку: уйдите с неё';
const FAT = 'Толстый — медленный, на пластину больше';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
/**
 * A new run of seed 11 (`?seed=`) on the map of run row 2. Task 17 (Е1): a gentle run's row 1 is «Поляна» alone — ordinary
 * enemies only, no sign can stand there — so its first battle (r5c0) is won by the run hook; row 2 then offers «Двор кнопок»
 * with the wolf roster (r6c0), whose card carries the sign. The kinds of the hooked fight are seen in view only for its frames.
 */
async function freshRun(page: Page): Promise<void> {
  await page.goto('/?seed=11');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await page.getByTestId('gift-0').click();
  const pick = page.locator('[data-action="gift-pick"]').first();
  if (await pick.count()) await pick.click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await leaveResult(page);
  await expect(page.getByTestId('node-r6c0')).toHaveAttribute('data-status', 'available');
}
/** Selects the first available node whose card carries the sign (an arena with an unmet kind); the card stays open. */
const selectArena = async (page: Page): Promise<void> => {
  const nodes = page.locator('[data-status="available"]');
  const n = await nodes.count();
  for (let i = 0; i < n; i++) {
    await nodes.nth(i).click();
    await expect(page.getByTestId('run-detail')).toBeVisible();
    if (await page.getByTestId('run-new-sign').count()) return;
  }
  throw new Error(`no available node with the sign among ${n}`);
};
/** Enters the selected node and waits for the fight. */
const enter = async (page: Page): Promise<void> => {
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
};
/** An enemy of `kind` placed in view, 3 units from the hero (a test command; the view reacts to what is in view). */
const placeKind = (page: Page, kind: string, elite = false, affixes?: string[]): Promise<void> => page.evaluate(([k, e, a]) => {
  const rt = (window as any).__realtime, hero = rt.snapshot().hero;
  rt.place(hero.x + 2.5, hero.y, 1, 0, k, e, a);
}, [kind, elite, affixes ?? null] as const);
const captions = (page: Page): Promise<{ texts: string[]; live: number }> => page.evaluate(() => (window as any).__realtime.snapshot().captions);
/** The `mapSigns` of the run record the telemetry holds now (null — no run record). */
const mapSigns = async (page: Page): Promise<{ nodeId: string; signed: string[]; chosenSigned: boolean }[] | null> => {
  await page.evaluate(() => (window as any).__realtime.telemetry.settle());
  const records = await page.evaluate(() => (window as any).__realtime.telemetry.records()) as { kind: string; mapSigns?: { nodeId: string; signed: string[]; chosenSigned: boolean }[] }[];
  const run = records.filter(r => r.kind === 'run').pop();
  return run ? run.mapSigns ?? [] : null;
};
const memory = (page: Page): Promise<{ kinds: string[]; affixes: string[] } | null> => page.evaluate(k => { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; }, KEY);

test('a fresh viewer: the card of an available arena carries the sign; the first wolf in view gets its caption once; the second fight shows none', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await freshRun(page);
  expect(await memory(page)).toBeNull();
  await selectArena(page);
  const sign = page.getByTestId('run-new-sign');
  await expect(sign).toHaveText('✦ новое');
  await expect(page.getByTestId('run-detail')).toContainText('Арена «');
  await page.screenshot({ path: 'artifacts/realtime-new-seen-card.png' });
  const chosen = await page.locator('[data-status="available"][data-selected], .rt-selected').first().getAttribute('data-node');
  await enter(page);
  // Telemetry: the choice was made with a sign shown — recorded (which nodes wore it, which was chosen).
  const signs = await mapSigns(page);
  expect(signs).toHaveLength(1);
  expect(signs![0].chosenSigned).toBe(true);
  expect(signs![0].signed).toContain(signs![0].nodeId);
  expect(signs![0].nodeId).toBe(chosen);
  expect((await captions(page)).texts).toEqual([]);
  await placeKind(page, 'wolf');
  await expect.poll(async () => (await captions(page)).texts).toEqual([WOLF]);
  expect((await captions(page)).live).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-new-seen-caption.png' });
  // 1.5 s at the enemy, then gone; the game did not pause.
  await expect.poll(async () => (await captions(page)).live, { timeout: 5_000 }).toBe(0);
  expect((await memory(page))?.kinds).toContain('wolf');
  // A second wolf of the same fight: nothing new.
  await placeKind(page, 'wolf');
  await page.waitForTimeout(400);
  expect((await captions(page)).texts).toEqual([WOLF]);
  // A reload: the open arena starts again as a second fight; the wolf is known, an archer is new.
  await page.reload();
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect((await captions(page)).texts).toEqual([]);
  await placeKind(page, 'wolf');
  await page.waitForTimeout(500);
  expect((await captions(page)).texts).toEqual([]);
  await placeKind(page, 'archer');
  await expect.poll(async () => (await captions(page)).texts).toEqual([ARCHER]);
  expect(errors).toEqual([]);
});

test('the first enemy of a kind that is an elite: the kind caption stands above the elite plaque, then the affix caption; once', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await freshRun(page);
  await selectArena(page);
  await enter(page);
  await placeKind(page, 'archer', true, ['fat']);
  // The fight's own wolves may add their caption; the order of the elite's pair is what counts.
  await expect.poll(async () => (await captions(page)).texts).toEqual(expect.arrayContaining([ARCHER, FAT]));
  const texts = (await captions(page)).texts;
  expect(texts.indexOf(ARCHER)).toBeLessThan(texts.indexOf(FAT));
  expect(texts.filter(t => t === ARCHER || t === FAT)).toHaveLength(2);
  const view = await page.evaluate(() => (window as any).__realtime.snapshot().eliteView);
  expect(view.plaquesSeen).toBeGreaterThan(0);
  expect(view.plaqueText).toContain('Элита');
  await page.screenshot({ path: 'artifacts/realtime-new-seen-elite.png' });
  const mem = await memory(page);
  expect(mem?.kinds).toContain('archer');
  expect(mem?.affixes).toEqual(['fat']);
  expect(errors).toEqual([]);
});

test('the gear toggle «Новое на карте» hides the sign and the captions; the memory is still written', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await freshRun(page);
  await selectArena(page);
  await expect(page.getByTestId('run-new-sign')).toHaveText('✦ новое');
  await page.getByTestId('run-settings').click();
  const toggle = page.getByTestId('view-new-on-map');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-new-on-map'))).toBe('0');
  await expect(page.getByTestId('run-new-sign')).toHaveCount(0);
  await toggle.check();
  await expect(page.getByTestId('run-new-sign')).toHaveText('✦ новое');
  await toggle.uncheck();
  await page.getByTestId('run-settings').click();
  await enter(page);
  // The toggle was off at the choice: no sign was shown, nothing is recorded.
  expect(await mapSigns(page)).toEqual([]);
  await placeKind(page, 'archer');
  await expect.poll(async () => (await memory(page))?.kinds).toEqual(['archer']);
  await page.waitForTimeout(500);
  expect((await captions(page)).texts).toEqual([]);
  expect(errors).toEqual([]);
});

test('the sandbox shows no caption and writes no memory', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await placeKind(page, 'wolf');
  await placeKind(page, 'archer');
  await placeKind(page, 'archer', true, ['fat']);
  await page.waitForTimeout(800);
  expect((await captions(page)).texts).toEqual([]);
  expect(await memory(page)).toBeNull();
  expect(errors).toEqual([]);
});
