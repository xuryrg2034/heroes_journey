import { test, expect, type Page } from '@playwright/test';

/**
 * The new enemies of the slice in the sandbox (stage 2 of the transition, step 2; docs/realtime-slice.md, sections 4–5).
 * Runs through playwright.realtime.config.ts only. Each test opens the enemy's arena from the sandbox menu (keys 4–7),
 * places the enemy by the test hooks (journalled commands) and checks that its signal is on screen and acts as the player
 * sees it. The rules themselves are checked in Node (`npm run test:realtime-enemies`).
 */
interface Snap {
  arena: string;
  status: string;
  time: number;
  hero: { x: number; y: number; hp: number; maxHp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; vars: Record<string, number>; chill: number }[];
  chain: number[];
  hint: string | null;
  kills: number;
  signals: Record<string, number>;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());

/** Opens the sandbox with clean storage and starts arena `n` by its menu key. */
async function openArena(page: Page, errors: string[], n: number): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press(String(n));
  await expect(page.getByTestId('menu')).toBeHidden();
}

/** No newcomers, enemies stand, touches do not hurt: only what the test places acts (journalled param commands). */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 20], ['baseIntervalMax', 20], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5);
  });
}

const place = (page: Page, x: number, y: number, kind: string, color = 0, hp = 0): Promise<number> =>
  page.evaluate(([x, y, kind, color, hp]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, kind, color, hp] as const);
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

test('shieldbearer: arena 4 opens; its shield arc is drawn, the hint says «щит» in front and the link is taken from behind', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 4);
  expect((await snap(page)).arena).toBe('shields');
  await expect(page.getByTestId('goal')).toHaveText('убито 0 / 25');
  await quiet(page);
  const id = await place(page, 9.2, 5, 'shield', 1, 1);
  await expect.poll(async () => (await snap(page)).signals.shields).toBe(1);
  // In front of the shield: the pointer on it says «щит», a press takes nothing.
  const at = await screen(page, 9.2, 5);
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await snap(page)).hint).toBe('guarded');
  await expect(page.getByTestId('link-hint')).toHaveText('щит');
  await page.screenshot({ path: 'artifacts/realtime-shield.png' });
  await page.mouse.down();
  expect((await snap(page)).chain).toEqual([]);
  await page.mouse.up();
  // From behind (the shield turns at 90°/s: right after the hero gets there it still faces away) the link is taken.
  await page.evaluate(() => (window as any).__realtime.teleport(10.5, 5));
  await page.mouse.move(at.x, at.y + 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).kills).toBe(1);
  expect(errors).toEqual([]);
});
