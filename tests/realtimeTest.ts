import { test as base, expect, type Page } from '@playwright/test';

/**
 * The `test` of every realtime spec except the prologue's own (tests/realtime-prologue.spec.ts uses plain `@playwright/test`).
 *
 * A first launch of the page plays the prologue «Опушка» (task 6, step 4, 12.10.2026) instead of the run's start. The specs
 * that test the run, the sandbox or the view start from the run, so they open every page as a viewer who has passed the prologue:
 * the key «пролог пройден» is put in `localStorage` by an init script, on every document load — so it is there again after the
 * specs' own `localStorage.clear()` and reload. Nothing else is changed; the prologue's behaviour is tested in its own spec.
 */
export const PROLOGUE_KEY = 'ashen-oath-realtime-prologue-done';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(key => { try { localStorage.setItem(key, '1'); } catch { /* no storage */ } }, PROLOGUE_KEY);
    await use(page);
  },
});
/**
 * Task 50 «Повадка»: a gift `full` of a run waits for the archetype row. The routes of the specs that are not about it take «Без повадки»
 * (a real click) before the gift's button; with no row on the screen (a mini gift) nothing is clicked.
 */
export async function skipHabit(page: { getByTestId: Page['getByTestId'] }): Promise<void> {
  const none = page.getByTestId('habit-none');
  if (await none.count() && await none.isEnabled()) await none.click();
}
/**
 * Task 49: routes of other mechanics pass the cage scene (a meta run past its first Jailer win frees Ведунья: «Открыть клетку», then
 * «Дальше»). Nothing when the scene is not open. The scene itself is tested by tests/realtime-toad-meta.spec.ts.
 */
export async function passCage(page: { getByTestId: Page['getByTestId'] }): Promise<void> {
  const open = page.getByTestId('cage-open');
  if (await open.count() && await open.isVisible()) await open.click();
  const done = page.getByTestId('cage-done');
  if (await done.count()) await done.click();
}
export { expect };
