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

interface KitSnap extends Snap {
  items: Record<string, number> | null;
  itemsShown: Record<string, number>;
  signals: Record<string, number>;
  enemies: (Snap['enemies'][number] & { brittle: boolean; burn: number })[];
}
const kitSnap = (page: Page): Promise<KitSnap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);
/** Moves the mouse to an arena point (the consumables aim at the pointer). */
async function pointAt(page: Page, x: number, y: number): Promise<void> {
  const at = await screen(page, x, y);
  await page.mouse.move(at.x, at.y);
}

test('consumables 1–4 from the keyboard at the mouse: cold freezes (×2 ring), bomb kills, healing heals, fire burns; the HUD counts them', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await quiet(page);
  // The sandbox gives the panel's number of each (3).
  await expect(page.getByTestId('item-frost')).toHaveText(/1.*Холод.*×3/);
  await expect(page.getByTestId('item-fire')).toHaveText(/4.*Огонь.*×3/);
  const frozen = await place(page, 10, 5, 'basic', 0, 2), bombed = await place(page, 6, 6.5, 'basic', 1, 6), burnt = await place(page, 8, 2.5, 'basic', 2, 1);
  // 1 — cold at the pointer.
  await pointAt(page, 10, 5);
  await page.keyboard.press('1');
  await expect.poll(async () => (await kitSnap(page)).enemies.find(e => e.id === frozen)?.chill ?? 0).toBeGreaterThan(2);
  expect((await kitSnap(page)).enemies.find(e => e.id === frozen)!.brittle).toBe(true);
  await expect.poll(async () => (await kitSnap(page)).signals.frozen).toBe(1);
  await expect(page.getByTestId('item-frost')).toHaveText(/×2/);
  // 2 — the bomb on the enemy under the pointer.
  await pointAt(page, 6, 6.5);
  await page.keyboard.press('2');
  await expect.poll(async () => (await kitSnap(page)).enemies.some(e => e.id === bombed)).toBe(false);
  await expect(page.getByTestId('item-bomb')).toHaveText(/×2/);
  // 4 — fire: the enemy under the pointer burns (flames on screen) and dies at the first tick (1.5 s).
  await pointAt(page, 8, 2.5);
  await page.keyboard.press('4');
  await expect.poll(async () => (await kitSnap(page)).signals.burning).toBe(1);
  await expect.poll(async () => (await kitSnap(page)).enemies.some(e => e.id === burnt), { timeout: 5_000 }).toBe(false);
  // 3 — healing: refused at full HP (nothing spent), +8 after damage.
  await page.keyboard.press('3');
  await expect(page.getByTestId('item-healing')).toHaveText(/×3/);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 2); rt.place(rt.snapshot().hero.x + 0.5, rt.snapshot().hero.y, 3, 9, 'basic'); });
  await expect.poll(async () => (await kitSnap(page)).hero.hp, { timeout: 5_000 }).toBeLessThan(11);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 0); });
  const hurt = (await kitSnap(page)).hero.hp;
  await page.keyboard.press('3');
  await expect.poll(async () => (await kitSnap(page)).hero.hp).toBe(Math.min(12, hurt + 8));
  await expect(page.getByTestId('item-healing')).toHaveText(/×2/);
  const s = await kitSnap(page);
  expect(s.itemsShown).toEqual({ frost: 1, bomb: 1, healing: 1, fire: 1 });
  expect(s.items).toEqual({ frost: 2, bomb: 2, healing: 2, fire: 2 });
  expect(s.kills).toBe(2);
  await page.screenshot({ path: 'artifacts/realtime-items.png' });
  expect(errors).toEqual([]);
});
