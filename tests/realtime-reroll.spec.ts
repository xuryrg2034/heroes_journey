import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { readFileSync } from 'node:fs';

/**
 * B5 К10 «Переброс» (src/realtime/run/rtRun.ts `rtRerollTalismans`, src/realtime/view/runView.ts, docs/realtime-casino.md):
 * real clicks on the talisman offer of «Застава» at 1280×720. The run is a save written by the code of 7ae55fc (fixture
 * `tests/fixtures/rt-run-save-before-reroll.json`, `hard`: the offer open, 6 resources) put into the page's storage — it
 * loads as it is. «Перебросить — 1 ресурс» gives three new talismans; the price grows to 2 and 3; a reload keeps the offer
 * and the price; after 1 + 2 + 3 the button is off and says why; the choice takes the talisman. No animation (П11).
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/rt-run-save-before-reroll.json', import.meta.url), 'utf8')) as { hard: string };

const runState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const options = (page: Page): Promise<string[]> => page.locator('[data-testid="run-talisman"] [data-action="talisman"][data-option]:not([data-option=""])').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.option!));
const total = (materials: Record<string, number>): number => Object.values(materials).reduce((a, b) => a + b, 0);

async function openSave(page: Page, errors: string[], save: string): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RUN_KEY, save] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('«Застава»: the reroll button by real clicks — new talismans, price 1 → 2 → 3, a reload keeps it, then off with the reason', async ({ page }) => {
  const errors: string[] = [];
  await openSave(page, errors, fixture.hard);
  const card = page.getByTestId('run-talisman'), reroll = page.getByTestId('talisman-reroll'), note = page.getByTestId('talisman-reroll-note');
  await expect(card).toBeVisible();
  await expect(reroll).toBeEnabled();
  await expect(reroll).toHaveText('Перебросить — 1 ресурс');
  await expect(note).toContainText('Ресурсов: 6.');
  const shown = await options(page);
  expect(shown).toHaveLength(3);
  const draws = (await runState(page)).streams.talismans;

  // 1 ресурс: three new talismans.
  await reroll.click();
  await expect(reroll).toHaveText('Перебросить — 2 ресурса');
  await expect(note).toContainText('Ресурсов: 5.');
  const first = await options(page);
  expect(first).toHaveLength(3);
  expect(first.some(id => shown.includes(id))).toBe(false);
  let state = await runState(page);
  expect(total(state.materials)).toBe(5);
  expect(state.streams.talismans).toBe(draws + 1);
  await page.screenshot({ path: 'artifacts/realtime-reroll.png' });

  // A reload in the middle of the screen: the same offer at the same price.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(reroll).toHaveText('Перебросить — 2 ресурса');
  expect(await options(page)).toEqual(first);

  // 2, then 3: nothing shown on this screen comes back; then the button is off and says why.
  await reroll.click();
  await expect(reroll).toHaveText('Перебросить — 3 ресурса');
  const second = await options(page);
  expect(second.some(id => shown.includes(id) || first.includes(id))).toBe(false);
  await reroll.click();
  await expect(reroll).toHaveText('Перебросить — 4 ресурса');
  await expect(reroll).toBeDisabled();
  await expect(note).toHaveText('Нужно ресурсов: 4, есть 0');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-reroll-off.png' });
  const third = await options(page);
  expect(third.some(id => shown.includes(id) || first.includes(id) || second.includes(id))).toBe(false);
  state = await runState(page);
  expect(total(state.materials)).toBe(0);
  expect(state.pending.rerolls).toBe(3);

  // The choice takes the talisman and closes the screen; the rerolled ones are not gone from the pool.
  await page.locator(`[data-action="talisman"][data-option="${third[0]}"]`).click();
  await expect(card).toBeHidden();
  state = await runState(page);
  expect(state.talismans).toContain(third[0]);
  expect(state.talismansGone.some((id: string) => [...shown, ...first, ...second].includes(id))).toBe(false);
  expect(errors).toEqual([]);
});
