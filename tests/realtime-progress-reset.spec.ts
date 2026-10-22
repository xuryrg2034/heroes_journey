import { test, expect, type Page } from '@playwright/test';
import { takeStartGift } from './realtimeTest';
import { leaveResult } from './realtimeResult';

/**
 * «Сбросить прогресс» (user request 22.10.2026; view/progressReset.ts) with real input at 1280×720: a viewer who played a fight
 * opens the gear of the run map, «Сбросить прогресс» asks first («Отмена» keeps everything), «Сбросить» reloads the page as a
 * first-time player's — the prologue «Опушка» plays, no run, no profile — while the settings (the sound) and the telemetry stay.
 * Plain `@playwright/test`: the specs' fixture puts the prologue's key back on every load, and here its removal is the point.
 * The key lists against the stores are checked in Node (`npm run test:realtime-progress-reset`).
 */
const PROLOGUE = 'ashen-oath-realtime-prologue-done', PROFILE = 'ashen-oath-rt-profile-v1', RUN = 'ashen-oath-rt-run-v7';
const SOUND = 'ashen-oath-realtime-sound', TLM = 'ashen-oath-rt-tlm-v1:kept-by-reset';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const stored = (page: Page, key: string): Promise<string | null> => page.evaluate(k => localStorage.getItem(k), key);

test('the gear «Сбросить прогресс»: asks first, «Отмена» keeps the run; «Сбросить» — the prologue again, no run or profile; the sound setting and the logs stay', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(k => { localStorage.clear(); localStorage.setItem(k, '1'); }, PROLOGUE);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  // Progress: a run with its gift and a won fight.
  await page.evaluate(() => { (window as any).__realtime.run.newRun(11); });
  await takeStartGift(page);
  await expect(page.getByTestId('run-gift')).toBeHidden();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await leaveResult(page);
  await expect(page.getByTestId('run-map')).toBeVisible();
  expect(await stored(page, PROFILE)).not.toBeNull();
  expect(await stored(page, RUN)).not.toBeNull();
  await page.evaluate(k => localStorage.setItem(k, '{}'), TLM);

  // A setting changed by the gear: the sound off.
  await page.getByTestId('run-settings').click();
  await page.getByTestId('view-sound').uncheck();
  const sound = await stored(page, SOUND);
  expect(JSON.parse(sound ?? '{}').on).toBe(false);

  // «Сбросить прогресс» asks; «Отмена» keeps the run as it is.
  const runBefore = await page.evaluate(() => JSON.stringify((window as any).__realtime.run.state()));
  await expect(page.getByTestId('progress-reset')).toHaveText('Сбросить прогресс');
  await page.getByTestId('progress-reset').click();
  await expect(page.getByTestId('progress-reset-ask')).toContainText('Настройки останутся');
  await page.screenshot({ path: 'artifacts/realtime-progress-reset-ask.png' });
  await page.getByTestId('progress-reset-cancel').click();
  await expect(page.getByTestId('progress-reset-ask')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify((window as any).__realtime.run.state()))).toBe(runBefore);
  // Closing the box drops an open question.
  await page.getByTestId('progress-reset').click();
  await page.getByTestId('run-settings').click();
  await page.getByTestId('run-settings').click();
  await expect(page.getByTestId('progress-reset-ask')).toHaveCount(0);

  // «Сбросить»: the page loads again as a first-time player's.
  await page.getByTestId('progress-reset').click();
  await Promise.all([page.waitForEvent('load'), page.getByTestId('progress-reset-confirm').click()]);
  await expect(page.getByTestId('prologue-title')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await stored(page, PROLOGUE)).toBeNull();
  expect(await stored(page, PROFILE)).toBeNull();
  expect(await stored(page, RUN)).toBeNull();
  expect(await stored(page, SOUND)).toBe(sound);
  expect(await stored(page, TLM)).toBe('{}');
  // Past the prologue: a new run of the viewer's first, the new-run gift.
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  expect(JSON.parse(await stored(page, PROFILE) ?? '{}').runs ?? 1).toBe(1);
  expect(errors).toEqual([]);
});
