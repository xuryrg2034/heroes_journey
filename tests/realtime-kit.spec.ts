import { test, expect, type Page } from '@playwright/test';

/**
 * Step 3 of the slice in the browser (stage 2 of the transition; docs/realtime-slice.md, sections 6–9): the spin (Q) and
 * the consumables 1–4 from the keyboard and the mouse in the sandbox, the item panel of the HUD, an elite on screen.
 * Runs through playwright.realtime.config.ts only. The rules themselves are checked in Node (`npm run test:realtime-kit`).
 */
interface Snap {
  arena: string;
  status: string;
  hero: { x: number; y: number; hp: number; maxHp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; chill: number }[];
  energy: number;
  kills: number;
  spinsShown: number;
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

test('spin: Q with 3 energy kills the enemies around the hero (a ring flashes); the HUD shows Q with its price and readiness', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await quiet(page);
  const near = await place(page, 8.9, 5, 'basic', 0, 0), tough = await place(page, 7.2, 5.3, 'basic', 2, 2), far = await place(page, 11, 5, 'basic', 1, 0);
  await expect(page.getByTestId('ability-spin')).toHaveText(/Q круговой · 3/);
  await expect(page.getByTestId('ability-spin')).not.toHaveClass(/rt-ready/);
  // Without energy Q does nothing.
  await page.keyboard.press('q');
  expect((await snap(page)).enemies.map(e => e.id).sort()).toEqual([near, tough, far].sort());
  await page.evaluate(() => (window as any).__realtime.setEnergy(3));
  await expect(page.getByTestId('ability-spin')).toHaveClass(/rt-ready/);
  await page.keyboard.press('q');
  await expect.poll(async () => (await snap(page)).enemies.map(e => e.id)).toEqual([far]);
  const s = await snap(page);
  expect(s.kills).toBe(2);
  expect(s.energy).toBe(0);
  // The ring is drawn in the next frame (the renderer reads the world's events).
  await expect.poll(async () => (await snap(page)).spinsShown).toBeGreaterThan(0);
  await expect(page.getByTestId('ability-spin')).not.toHaveClass(/rt-ready/);
  expect(errors).toEqual([]);
});
