import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';

/**
 * UI-02 of the PC interface plan (20.10.2026; docs/design-notes/codex-idea-pc-ui-tasks.md): the fight's Esc and pause, the
 * keys that do not reach a focused button, and the held key. Real keyboard and mouse input. Runs through playwright.realtime.config.ts only.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const cancels = (page: Page): Promise<number> => page.evaluate(() => (JSON.stringify((window as any).__realtime.journal()).match(/"cancel"/g) ?? []).length);
const runState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const shots = process.env.SHOT_DIR ?? 'artifacts';

async function openRun(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run')).toBeVisible();
}
async function newRunToMap(page: Page): Promise<void> {
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
}
async function enterFirstNode(page: Page): Promise<void> {
  await page.locator('[data-status="available"]').first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
}

test('pc input: Esc cancels the aim, with nothing to cancel it pauses, Esc or P go on; a focused button keeps Space; a held Enter presses once', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await openRun(page, errors);
  await newRunToMap(page);
  await enterFirstNode(page);
  const app = page.locator('#rt-app');
  await expect.poll(async () => (await snap(page)).status).toBe('playing');

  await page.evaluate(() => { (window as any).__realtime.setParam('contactDamage', 0); (window as any).__realtime.setEnergy(7); });
  // The jump aim: Space turns it on, Esc turns it off and does not pause.
  await page.keyboard.press('Space');
  await expect(app).toHaveClass(/rt-aiming/);
  await page.keyboard.press('Escape');
  await expect(app).not.toHaveClass(/rt-aiming/);
  expect((await snap(page)).paused).toBe(false);

  // Nothing to cancel: Esc pauses (no command in the journal); the fight stands.
  const before = await cancels(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).paused).toBe(true);
  await expect(page.locator('.rt-paused')).toBeVisible();
  const frozen = await snap(page);
  await page.waitForTimeout(700);
  const later = await snap(page);
  expect(later.time).toBe(frozen.time);
  expect(later.hero.hp).toBe(frozen.hero.hp);
  expect(await cancels(page)).toBe(before);
  await page.screenshot({ path: `${shots}/pc-pause-by-esc.png` });
  // Esc goes on, P pauses again, P goes on.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).paused).toBe(false);
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(frozen.time);
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await snap(page)).paused).toBe(true);
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await snap(page)).paused).toBe(false);
  // A held Esc pauses once and does not flicker.
  await page.keyboard.down('Escape');
  await page.keyboard.down('Escape');
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  expect((await snap(page)).paused).toBe(true);
  await page.keyboard.press('Escape');

  // A button in focus keeps Space: no jump aim; a held Enter presses it once.
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'probe-button'; button.style.cssText = 'position:fixed;left:8px;top:200px;z-index:99999'; button.textContent = 'probe'; (button as any).clicks = 0;
    button.addEventListener('click', () => { (button as any).clicks++; });
    document.body.append(button);
    button.focus();
  });
  const clicks = (): Promise<number> => page.evaluate(() => (document.getElementById('probe-button') as any).clicks);
  await page.keyboard.press('Space');
  await expect(app).not.toHaveClass(/rt-aiming/);
  expect(await clicks()).toBe(1);
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  expect(await clicks()).toBe(2);
  // A button pressed with the mouse gives the keys back: Space aims again.
  await page.locator('#probe-button').click();
  await page.keyboard.press('Space');
  await expect(app).toHaveClass(/rt-aiming/);
  expect(errors).toEqual([]);
});

test('pc input: the key that ends a fight does not choose or enter anything on the screens after it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await openRun(page, errors);
  await newRunToMap(page);
  await enterFirstNode(page);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result-map')).toBeVisible();
  const visited = (await runState(page)).visited.length;
  // Enter goes on from the result and is then held: the screens after it take nothing.
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId('run')).toBeVisible();
  const state = await runState(page);
  expect(state.visited.length).toBe(visited);
  expect(errors).toEqual([]);
});
