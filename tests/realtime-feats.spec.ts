import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { rtFeatKinds, rtNode, rtNodeFeat, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_PROFILE_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { seedOf } from '../src/realtime/run/runFight.testkit';
import { featCardLine, featResultRow } from '../src/realtime/view/featView';
import { FIRST_MEET_KEY } from '../src/realtime/view/firstMeet';
import { RESOURCES } from '../src/realtime/forest/resources';

/**
 * Task 16 «Подвиги», the view (design 13–14.10.2026; src/realtime/view/featView.ts, docs/realtime-slice.md «Подвиги») at
 * 1280×720 by real clicks:
 * - a first run (a fresh profile) has no feat line on the card nor in the fight; a run after the Jailer (the profile's `jailer`)
 *   has «Подвиг: продержись 20 с после целей → 3 ресурса» on the card — the run's own `rtNodeFeat`;
 * - in the fight the HUD line waits before the goals («Подвиг 0/20 с», dim), grows after them; the open door carries the same
 *   small line while the feat is not done; done — «Подвиг ✓» and a chime, the door line gone;
 * - the result has its own row «Подвиг»: «+3 — …» with the kinds the run pays (names of forest/resources.ts); a door before the
 *   feat — grey «не выполнен — 0/20 с»; a talisman reward — «талисман на выбор», then the screen «Подвиг: талисман на выбор».
 * Seeds (`Math.imul(k, 2654435761)`): k = 3 — node r5c0 «продержись 20 с после целей → 3 ресурса»; k = 22 — r5c0 the same goal
 * → a talisman choice. The goals are done and the field kept quiet by the test hooks (the feat's seconds are the sim's).
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

/** A fresh viewer; `jailer` — the profile says the Jailer was fought in an earlier run (feats from the next run). */
async function viewer(page: Page, jailer: boolean): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, on]) => {
    localStorage.clear();
    if (on) localStorage.setItem(key, JSON.stringify({ version: 1, giftFull: false, jailer: true }));
  }, [RT_PROFILE_STORAGE_KEY, jailer] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

/** A new run of seed k (the run hook, as `?seed=`), its gift taken by clicks; the card of `nodeId` opened by a click. */
async function runCard(page: Page, k: number, nodeId: string): Promise<void> {
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), seedOf(k));
  await page.getByTestId('gift-0').click();
  const pick = page.locator('[data-action="gift-pick"]').first();
  if (await pick.count()) await pick.click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  await page.getByTestId(`node-${nodeId}`).click();
  await expect(page.getByTestId('run-detail')).toHaveAttribute('data-card', nodeId);
}

/** No spawns, no touch damage, enemies still: the hero lives through the feat's seconds (the run fight's own params object). */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.contactDamage = 0; rt.params.maxEnemies = 0; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0;
    rt.clear();
  });
}

test('task 16: no feat in a first run; after the Jailer the card says «Подвиг: … → 3 ресурса» — the run\'s own feat of the node', async ({ page }) => {
  const errors = collectErrors(page);
  await viewer(page, false);
  await runCard(page, 3, 'r5c0');
  await expect(page.getByTestId('run-dangers')).toBeVisible();
  await expect(page.getByTestId('run-feat')).toHaveCount(0);
  expect((await runState(page)).feats).toBeUndefined();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await gameWait(page, 0.3);
  await expect(page.getByTestId('hud-feat')).toBeHidden();
  expect((await snap(page)).feat.progress).toBeNull();

  await viewer(page, true);
  await runCard(page, 3, 'r5c0');
  const run = await runState(page);
  expect(run.feats).toBe(true);
  const feat = rtNodeFeat(run, rtNode(run, 'r5c0')!)!;
  const line = featCardLine(feat, false);
  await expect(page.getByTestId('run-feat')).toHaveText(`${line.label}: ${line.text}`);
  await expect(page.getByTestId('run-feat')).toHaveText('Подвиг: продержись 20 с после целей → 3 ресурса');
  await page.screenshot({ path: 'artifacts/realtime-feat-card.png' });
  // Only the card of an available node; the reward by number (no kind).
  await expect(page.getByTestId('run-feat')).not.toContainText('Роса');
  expect(errors).toEqual([]);
});

test('task 16: the HUD line waits before the goals, grows after them, the door carries it; done — «Подвиг ✓» and a chime; the result row pays its kinds', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await viewer(page, true);
  await runCard(page, 3, 'r5c0');
  const before = await runState(page);
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await quiet(page);
  const hud = page.getByTestId('hud-feat');
  await expect(hud).toHaveText('Подвиг 0/20 с');
  await expect(hud).toHaveClass(/rt-feat-waiting/);
  await gameWait(page, 1);
  await expect(hud).toHaveText('Подвиг 0/20 с');
  expect((await snap(page)).feat.door.visible).toBe(false);

  await page.evaluate(() => (window as any).__realtime.completeGoals());
  const grown = await untilFrame(page, (s: any) => (s.feat.progress && !s.feat.progress.waiting && s.feat.progress.value >= 2 ? s : undefined), null, 6);
  expect(grown.feat.hud).toMatch(/^Подвиг [2-9]\/20 с$/);
  await expect(hud).not.toHaveClass(/rt-feat-waiting/);
  // The open door: the same small line by it while the feat is not done.
  expect(grown.feat.door.visible).toBe(true);
  expect(grown.feat.door.text).toBe(grown.feat.hud);
  await page.screenshot({ path: 'artifacts/realtime-feat-hud.png' });

  const sounds = grown.feat.sounds;
  const done = await untilFrame(page, (s: any) => (s.feat.progress?.done ? s : undefined), null, 24);
  expect(done.feat.progress.value).toBe(20);
  await expect(hud).toHaveText('Подвиг ✓');
  await expect(hud).toHaveClass(/rt-feat-done/);
  await gameWait(page, 0.2);
  const after = await snap(page);
  expect(after.feat.door.visible).toBe(false);
  expect(after.feat.sounds).toBe(sounds + 1);

  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  const kinds = rtFeatKinds(before.seed, 'r5c0', 3);
  const row = featResultRow({ kind: 'afterGoals', n: 20, reward: { resources: 3 } }, { done: true, value: 20 }, true, kinds)!;
  const cell = page.getByTestId('result-feat');
  await expect(cell).toHaveText(row.text);
  await expect(cell).not.toHaveClass(/rt-result-grey/);
  const names = Object.values(RESOURCES).map(r => r.label);
  for (const part of row.text.replace(/^\+3 — /, '').split(', ')) expect(names).toContain(part.replace(/^\d+ /, ''));
  await expect(page.getByTestId('result').locator('dt', { hasText: 'Подвиг' })).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/realtime-feat-result.png' });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  const state = await runState(page);
  expect(total(state.materials)).toBe(total(before.materials) + 3);
  expect(state.battles[state.battles.length - 1].feat?.done).toBe(true);
  await expect(page.getByTestId('run-notice')).toContainText('Подвиг: +3 ресурса');
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key), FIRST_MEET_KEY) ?? '{}').met).toContain('feat');
  expect(errors).toEqual([]);
});

test('task 16: a door before the feat — a grey row «не выполнен — 0/20 с», nothing paid', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await viewer(page, true);
  await runCard(page, 3, 'r5c0');
  const before = await runState(page);
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await quiet(page);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  const cell = page.getByTestId('result-feat');
  await expect(cell).toHaveText(/^не выполнен — [01]\/20 с$/);
  await expect(cell).toHaveClass(/rt-result-grey/);
  await page.getByTestId('result-map').click();
  const state = await runState(page);
  expect(total(state.materials)).toBe(total(before.materials));
  expect(state.battles[state.battles.length - 1].feat?.done).toBe(false);
  expect(errors).toEqual([]);
});

test('task 16: a talisman reward — the row «талисман на выбор», then the screen «Подвиг: талисман на выбор» (reroll there), a talisman taken', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await viewer(page, true);
  await runCard(page, 22, 'r5c0');
  await expect(page.getByTestId('run-feat')).toHaveText('Подвиг: продержись 20 с после целей → талисман на выбор');
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await untilFrame(page, (s: any) => (s.feat.progress?.done ? s : undefined), null, 24);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await expect(page.getByTestId('result-feat')).toHaveText('талисман на выбор');
  await page.getByTestId('result-map').click();
  const card = page.getByTestId('run-feat-talisman');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText('Подвиг: талисман на выбор');
  await expect(card.getByTestId('talisman-reroll')).toBeVisible();
  const option = card.locator('[data-action="talisman"][data-option]:not([data-option=""])').first();
  const id = await option.getAttribute('data-option');
  await option.click();
  await expect(card).toBeHidden();
  expect((await runState(page)).talismans).toContain(id);
  expect(errors).toEqual([]);
});
