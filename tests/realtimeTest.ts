import { test as base, expect } from '@playwright/test';

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
export { expect };
