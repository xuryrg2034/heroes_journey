import { readFileSync } from 'node:fs';
import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';

/**
 * Casino stage 1, item 4 — «Кость у двери» (src/realtime/run/rtRun.ts, src/realtime/view/runView.ts, docs/realtime-casino.md).
 *
 * Task 5 (12.10.2026, «Срез казино-слоя в походе»): the run plays no cauldron and no die. A won run fight shows no «Котёл»
 * row and leads straight to the map — no die screen (seed 10, `r5c0`).
 *
 * The die screen itself is reached only from a save that stands at it (written before task 5). The fixture
 * `tests/fixtures/rt-run-save-open-die.json` holds two such saves (cauldron 90, the run's rate 120): the screen shows the
 * outcomes in resources (design 11.10.2026) — «Забрать: 0 ресурсов» and «Бросить: 1–3 → 0 · 4–6 → 1»; a reload shows the
 * same screen and the same fixed face; «Бросить» rolls the die, a click skips the animation, the face is the fixed one and
 * the run's resources grow by what the screen said; «Забрать» closes it. A low face (seed 10, face 1) shows no win flash; a
 * high one that pays more than «Забрать» (seed 8, face 5) does.
 */

const SEED = 10;
const RUN_KEY = 'ashen-oath-rt-run-v7';
const saves = JSON.parse(readFileSync(new URL('./fixtures/rt-run-save-open-die.json', import.meta.url), 'utf8')) as { low: string; high: string };

async function openRun(page: Page, errors: string[], save?: string): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(([key, text]) => { localStorage.clear(); if (text) localStorage.setItem(key, text); }, [RUN_KEY, save ?? ''] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}
const runState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const total = (materials: Record<string, number>): number => Object.values(materials).reduce((a, b) => a + b, 0);
const word = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'ресурс' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'ресурса' : 'ресурсов');

test('task 5: a won run fight shows no «Котёл» row and no die — the result leads straight to the map', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect((await snapshot(page)).purse.on).toBe(false);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('result')).not.toContainText('Котёл');
  await expect(page.getByTestId('result')).toContainText('Очки');
  await expect(page.getByTestId('result-map')).toHaveText('К карте (Enter)');
  expect((await snapshot(page)).purse.door).toBeNull();
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.getByTestId('run-die')).toHaveCount(0);
  const state = await runState(page);
  expect(state.pending).toBeNull();
  expect(state.dieDraws).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a save at the die screen (before task 5): the odds, a reload keeps the face, «Бросить» — a click skips the roll, the resources come; a low face does not flash', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors, saves.low);
  const before = await runState(page);
  expect(before.pending.kind).toBe('die');
  const face = before.pending.face as number;

  // The die screen: the cauldron and the outcomes in resources (not multipliers).
  await expect(page.getByTestId('run-die')).toBeVisible();
  await expect(page.getByTestId('die-cauldron')).toHaveText('Котёл 90.');
  await expect(page.getByTestId('die-take')).toHaveText('Забрать: 0 ресурсов');
  await expect(page.getByTestId('die-odds')).toHaveText('Бросить: 1–3 → 0 · 4–6 → 1');
  await expect(page.getByTestId('run-die')).not.toContainText('×');
  await page.screenshot({ path: 'artifacts/realtime-die-screen.png' });

  // A reload: the same screen, the same face (nothing re-rolled, nothing paid).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run-die')).toBeVisible();
  const reloaded = await runState(page);
  expect(reloaded.pending).toEqual(before.pending);
  expect(reloaded.materials).toEqual(before.materials);

  // «Бросить»: the die rolls; a click skips the animation; the face is the fixed one.
  await page.getByTestId('die-roll').click();
  await expect(page.getByTestId('run-die-roll')).toBeVisible();
  await expect(page.getByTestId('run-die-roll')).toHaveAttribute('data-landed', 'false');
  await page.screenshot({ path: 'artifacts/realtime-die-rolling.png' });
  await page.getByTestId('run-die-roll').click();
  await expect(page.getByTestId('run-die-roll')).toHaveAttribute('data-landed', 'true');
  await expect(page.getByTestId('die-face')).toHaveAttribute('data-face', String(face));
  const paid = face <= 3 ? 0 : 1;
  await expect(page.getByTestId('die-result')).toContainText(`Выпало ${face} → ${paid} ${word(paid)}`);
  // Seed 10's first face is low: no win flash (LDW guard).
  expect(face).toBeLessThanOrEqual(3);
  await expect(page.getByTestId('die-result')).toHaveAttribute('data-win', 'false');
  await expect(page.getByTestId('die-result')).not.toHaveClass(/rt-die-win/);
  await page.screenshot({ path: 'artifacts/realtime-die-result.png' });
  const after = await runState(page);
  expect(after.pending).toBeNull();
  expect(total(after.materials) - total(before.materials)).toBe(paid);
  await page.getByTestId('die-close').click();
  await expect(page.getByTestId('run-die-roll')).toHaveCount(0);
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.locator('[data-status="available"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a save at the die screen: «Забрать» pays the cauldron as it is (0 at 90), no roll; the map goes on', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors, saves.low);
  const before = await runState(page);
  await expect(page.getByTestId('run-die')).toBeVisible();
  await page.getByTestId('die-take').click();
  await expect(page.getByTestId('run-die')).toHaveCount(0);
  await expect(page.getByTestId('run-die-roll')).toHaveCount(0);
  const after = await runState(page);
  expect(after.pending).toBeNull();
  expect(total(after.materials) - total(before.materials)).toBe(0);
  await expect(page.getByTestId('run-map')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a save at the die screen: a high face that pays more than «Забрать» flashes as a win', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors, saves.high);
  const before = await runState(page);
  expect(before.pending.kind).toBe('die');
  expect(before.pending.face).toBeGreaterThan(3);
  await expect(page.getByTestId('die-odds')).toHaveText('Бросить: 1–3 → 0 · 4–6 → 1');
  await page.getByTestId('die-roll').click();
  await page.getByTestId('run-die-roll').click();
  await expect(page.getByTestId('die-result')).toHaveAttribute('data-win', 'true');
  await expect(page.getByTestId('die-result')).toHaveClass(/rt-die-win/);
  await expect(page.getByTestId('die-result')).toContainText(`Выпало ${before.pending.face} → 1 ресурс`);
  expect(total((await runState(page)).materials) - total(before.materials)).toBe(1);
  expect(errors).toEqual([]);
});
