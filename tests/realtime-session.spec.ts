import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';

/**
 * П7 «Часы сессии» (docs/realtime-slice.md, «Часы сессии»; docs/realtime-engagement-research.md): with real input at 1280×720
 * — the end screen of a run says «В игре N мин · походов M»; after 90 minutes of one session the map shows one quiet line
 * (never in a fight, once, not again for 90 minutes); the gear's «Часы сессии» switches both off. Nothing blocks. The
 * session clock is the viewer's `localStorage`, never the journal; the hook `__realtime.run.session.play(ms)` moves its
 * clock in 5-minute steps so nothing waits 90 minutes. Runs through playwright.realtime.config.ts only; the definition of
 * a session (breaks, reloads) is checked in Node (`npm run test:realtime-session`).
 */
const NUDGE = 'Хорошее место остановиться — поход сохранён';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const play = (page: Page, minutes: number): Promise<void> => page.evaluate(m => (window as any).__realtime.run.session.play(m * 60_000), minutes);

/** A fresh page with a new run past the first gift, on its map. */
async function freshRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
}
/** A click on a map node redraws the map (where a due line appears). */
const touchMap = (page: Page): Promise<void> => page.locator('[data-status="available"]').first().click();

test('the end screen says the time in the game and the runs of the session; a reload keeps it; a defeat is the usual one', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await freshRun(page);
  await play(page, 47);
  // Abandon this run for a new one: the session now has two runs.
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  await touchMap(page);
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  // The fight shows nothing of the session.
  await expect(page.getByTestId('run-session-line')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await expect(page.getByTestId('run-session-line')).toBeHidden();
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  const line = page.getByTestId('run-session-line');
  await expect(line).toHaveText('В игре 47 мин · походов 2');
  await page.screenshot({ path: 'artifacts/realtime-session-end.png' });
  // A reload within the break keeps the session.
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.getByTestId('run-session-line')).toHaveText(/^В игре (47|48) мин · походов 2$/);
  expect(errors).toEqual([]);
});

test('after 90 minutes the map shows one quiet line, never in a fight, once; the gear switches it off; nothing blocks', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await freshRun(page);
  const nudge = page.getByTestId('run-session-nudge');
  await play(page, 85);
  await touchMap(page);
  await expect(nudge).toHaveCount(0);
  await play(page, 10);
  await touchMap(page);
  await expect(nudge).toHaveText(NUDGE);
  // Quiet: a line, not a window; the run goes on (the node can still be entered).
  await expect(page.locator('.rt-run-modal')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/realtime-session-nudge.png' });
  // The gear: «Часы сессии» is on by default; off, the line goes at once and a due one stays away.
  await page.getByTestId('run-settings').click();
  const toggle = page.getByTestId('view-session-clock');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-session-clock'))).toBe('0');
  await expect(nudge).toHaveCount(0);
  await play(page, 100);
  await touchMap(page);
  await expect(nudge).toHaveCount(0);
  await toggle.check();
  await expect(nudge).toHaveText(NUDGE);
  await page.getByTestId('run-settings').click();
  // Into a fight: the line is not there, and nothing of the session is in it.
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await play(page, 100);
  await page.waitForTimeout(300);
  await expect(nudge).toBeHidden();
  await expect(page.getByText(NUDGE)).toBeHidden();
  // The map again (a reload): 100 more minutes passed since the last line, so one line is due — once.
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId('run-session-nudge')).toHaveText(NUDGE);
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId('run-session-nudge')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the toggle off hides the end-screen line too', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await freshRun(page);
  await page.evaluate(() => localStorage.setItem('ashen-oath-realtime-session-clock', '0'));
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await page.getByTestId('run-settings').click();
  await expect(page.getByTestId('view-session-clock')).not.toBeChecked();
  await touchMap(page);
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.getByTestId('run-session-line')).toHaveCount(0);
  expect(errors).toEqual([]);
});
