import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';

/**
 * П9 «Второе дыхание» (src/realtime/sim/world.ts `hurtHero`, docs/realtime-prototype.md, «Второе дыхание»): the sandbox
 * only. The debug panel's checkbox turns it on; an enemy placed on the hero (a journalled `place`) hits him to death; the
 * hero stands up with 3 HP, the view flashes and writes «второе дыхание: 3 HP» at him; the next lethal hit ends the fight.
 */

async function open(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
}

/** Only the placed enemies, standing still (as `freeze` of realtime.spec.ts); a touch takes all the hero's HP. */
async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false;
    rt.params.contactDamage = 40;
    rt.clear(false);
  });
}

type Wind = { used: number | null; shown: number; text: string };
const state = (page: Page): Promise<{ status: string; hp: number; invulnerable: number; wind: Wind }> =>
  page.evaluate(() => { const s = (window as any).__realtime.snapshot(); return { status: s.status, hp: s.hero.hp, invulnerable: s.hero.invulnerable, wind: s.secondWind }; });
/** An enemy on the hero (journalled `place`): it touches him at once. */
const touch = (page: Page): Promise<void> =>
  page.evaluate(() => { const rt = (window as any).__realtime, h = rt.snapshot().hero; rt.place(h.x, h.y, 1, 0); });

test('П9 «Второе дыхание» (sandbox): the panel toggle; a lethal touch leaves 3 HP with a flash and the text at the hero; the next one ends the fight', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await freeze(page);
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  const box = page.locator('[data-param="secondWind"] input');
  await expect(box).not.toBeChecked();
  await box.check();
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.params.secondWind)).toBe(true);
  expect((await state(page)).wind).toEqual({ used: null, shown: 0, text: '' });

  await touch(page);
  await expect.poll(async () => (await state(page)).wind.shown, { timeout: 8_000 }).toBe(1);
  const after = await state(page);
  expect(after.status).toBe('playing');
  expect(after.hp).toBe(3);
  expect(after.wind.used).not.toBeNull();
  // The text says the HP he stands with (design 13.10.2026: not like the ward's «1 HP»).
  expect(after.wind.text).toBe('второе дыхание: 3 HP');
  expect(after.invulnerable).toBeGreaterThan(1);
  await page.screenshot({ path: 'artifacts/realtime-second-wind.png' });

  // The enemy still stands on him: when the 2 s are over the next lethal touch ends the fight; no second flash.
  await expect.poll(async () => (await state(page)).status, { timeout: 10_000 }).toBe('defeat');
  expect((await state(page)).wind.shown).toBe(1);
  expect(errors).toEqual([]);
});
