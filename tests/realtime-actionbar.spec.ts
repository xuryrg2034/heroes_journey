import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';

/**
 * Task 8 «Интерфейс боя» (design 13.10.2026), real input at 1280×720:
 * - 8a: the action bar of tiles — «Пробел», «Q», the consumables 1–4; a ready tile is bright, an ability short of energy fills to
 *   its price; an empty consumable is hidden; a click on a tile acts as its key (the jump and an aimed consumable wait for a click
 *   on the field, the spin and the healing act at once); the bar fades when the hero comes near it; the old jump button is gone.
 * - 8b is tests/realtime-camera.spec.ts («the power number stands over the hero»).
 * - 8c: the node card of the map in the middle of the screen — the goal, the enemies (and elites, terrain where there are), «В бой»;
 *   Esc or a click beside it closes it; the fight's HUD of the run keeps the goal only.
 */

interface Snap { hero: { x: number; y: number; hp: number; maxHp: number }; enemies: { id: number }[]; energy: number; items: Record<string, number> | null }
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color = 0, hp = 0): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);

async function openSandbox(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=1&seed=77');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['maxEnemies', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5);
  });
}

test('8a: tiles of 56 px — dim and filling to the price without energy, bright when ready; no separate jump button', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors);
  await page.evaluate(() => (window as any).__realtime.setEnergy(0));
  const jump = page.getByTestId('ability-jump'), spin = page.getByTestId('ability-spin');
  for (const t of [jump, spin, page.getByTestId('item-bomb')]) {
    const b = (await t.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(52);
    expect(b.height).toBeGreaterThanOrEqual(52);
  }
  await expect(jump.locator('kbd')).toHaveText('Пробел');
  await expect(jump.locator('.rt-tile-cost')).toHaveText('2 ⚡');
  expect(await page.locator('.rt-jump, [data-testid="jump"]').count()).toBe(0);
  await expect(jump).not.toHaveClass(/rt-ready/);
  await expect.poll(() => jump.evaluate(el => (el as HTMLElement).style.getPropertyValue('--fill'))).toBe('0.000');
  // One of two: the jump tile half full; one of three for Q.
  await page.evaluate(() => (window as any).__realtime.setEnergy(1));
  await expect.poll(() => jump.evaluate(el => (el as HTMLElement).style.getPropertyValue('--fill'))).toBe('0.500');
  await expect.poll(() => spin.evaluate(el => (el as HTMLElement).style.getPropertyValue('--fill'))).toBe('0.333');
  await page.evaluate(() => (window as any).__realtime.setEnergy(3));
  await expect(jump).toHaveClass(/rt-ready/);
  await expect(spin).toHaveClass(/rt-ready/);
  await page.screenshot({ path: 'artifacts/realtime-action-bar.png' });
  // The bar sits in the first screen, under the arena's middle.
  const bar = (await page.getByTestId('action-bar').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(720);
  expect(Math.abs(bar.x + bar.width / 2 - 640)).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test('8a: a click on the jump tile aims the jump (Esc cancels it), a click on the field jumps; a click on the Q tile spins', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors);
  await page.evaluate(() => (window as any).__realtime.setEnergy(7));
  const jump = page.getByTestId('ability-jump');
  await jump.click();
  await expect(jump).toHaveClass(/rt-on/);
  await page.keyboard.press('Escape');
  await expect(jump).not.toHaveClass(/rt-on/);
  await jump.click();
  await expect(jump).toHaveClass(/rt-on/);
  const to = await screen(page, 10, 5);
  await page.mouse.click(to.x, to.y);
  await expect.poll(async () => (await snap(page)).hero.x, { timeout: 5_000 }).toBeGreaterThan(9.5);
  await expect(jump).not.toHaveClass(/rt-on/);
  // Q by its tile: the enemies around the hero die.
  const hero = (await snap(page)).hero;
  const near = await place(page, hero.x + 0.9, hero.y), far = await place(page, hero.x - 4, hero.y);
  await page.evaluate(() => (window as any).__realtime.setEnergy(3));
  await page.getByTestId('ability-spin').click();
  await expect.poll(async () => (await snap(page)).enemies.map(e => e.id)).toEqual([far]);
  expect((await snap(page)).enemies.some(e => e.id === near)).toBe(false);
  expect(errors).toEqual([]);
});

test('8a: a consumable tile — the bomb aims and the next click on an enemy uses it; the healing acts at once; an empty slot is hidden', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors);
  const bomb = page.getByTestId('item-bomb');
  await expect(bomb.locator('.rt-tile-count')).toHaveText('3');
  const target = await place(page, 6, 6.5, 1, 6);
  await bomb.click();
  await expect(bomb).toHaveClass(/rt-on/);
  // Esc drops the aim; a second click on the tile aims again.
  await page.keyboard.press('Escape');
  await expect(bomb).not.toHaveClass(/rt-on/);
  await bomb.click();
  const at = await screen(page, 6, 6.5);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await snap(page)).enemies.some(e => e.id === target)).toBe(false);
  await expect(bomb.locator('.rt-tile-count')).toHaveText('2');
  await expect(bomb).not.toHaveClass(/rt-on/);
  // The click used the bomb and did not start a chain.
  expect(await page.evaluate(() => (window as any).__realtime.snapshot().chain.length)).toBe(0);
  // Healing: a hurt hero, one click on the tile heals (no aim).
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 2); const h = rt.snapshot().hero; rt.place(h.x + 0.5, h.y, 3, 9, 'basic'); });
  await expect.poll(async () => (await snap(page)).hero.hp, { timeout: 10_000 }).toBeLessThan(15);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 0); rt.clear(false); });
  const hurt = (await snap(page)).hero.hp;
  await page.getByTestId('item-healing').click();
  await expect.poll(async () => (await snap(page)).hero.hp).toBeGreaterThan(hurt);
  await expect(page.getByTestId('item-healing').locator('.rt-tile-count')).toHaveText('2');
  // An empty slot is hidden; the others stay.
  await page.evaluate(() => (window as any).__realtime.setItems('fire', 0));
  await expect(page.getByTestId('item-fire')).toBeHidden();
  await expect(page.getByTestId('item-frost')).toBeVisible();
  for (const kind of ['frost', 'bomb', 'healing']) await page.evaluate(k => (window as any).__realtime.setItems(k, 0), kind);
  await expect(page.getByTestId('items')).toBeHidden();
  await expect(page.getByTestId('ability-jump')).toBeVisible();
  expect(errors).toEqual([]);
});

test('8a: the bar fades out of the way when the hero comes near it, and comes back when he leaves', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors);
  const bar = page.getByTestId('action-bar');
  await expect(bar).not.toHaveClass(/rt-actionbar-under/);
  await page.evaluate(() => (window as any).__realtime.teleport(8, 9.4));
  await expect(bar).toHaveClass(/rt-actionbar-under/);
  await page.screenshot({ path: 'artifacts/realtime-action-bar-under.png' });
  // A faint bar takes no clicks: a press at a tile falls to the field.
  expect(await page.getByTestId('ability-jump').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await page.evaluate(() => (window as any).__realtime.teleport(8, 5));
  await expect(bar).not.toHaveClass(/rt-actionbar-under/);
  expect(errors).toEqual([]);
});

test('8c: the node card stands in the middle of the map — goal and enemies, «В бой»; Esc and a click beside it close it; the fight HUD keeps the goal only', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  // No right column: the map takes the width; nothing chosen — the quiet line says what to do.
  await expect(page.getByTestId('run-detail')).toHaveCount(0);
  await expect(page.getByTestId('run-pick-line')).toBeVisible();
  const map = (await page.getByTestId('run-map').boundingBox())!;
  expect(map.width).toBeGreaterThan(1200);
  const node = page.locator('[data-status="available"]').first();
  // The node's centre (the chosen ring is drawn thicker, so the box grows; the place must not move).
  const centre = async (): Promise<{ x: number; y: number }> => { const b = (await node.boundingBox())!; return { x: Math.round((b.x + b.width / 2) * 10) / 10, y: Math.round((b.y + b.height / 2) * 10) / 10 }; };
  const before = await centre();
  await node.click();
  const card = page.getByTestId('run-detail');
  await expect(card).toBeVisible();
  // The map stands still under the card (the quiet line keeps its place, unseen; review 13.10.2026).
  await expect(page.getByTestId('run-pick-line')).toBeHidden();
  expect(await centre()).toEqual(before);
  const box = (await card.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(4);
  expect(Math.abs(box.y + box.height / 2 - 360)).toBeLessThan(60);
  await expect(page.getByTestId('run-danger-goal')).toContainText('Цель:');
  await expect(page.getByTestId('run-danger-enemies')).toContainText('Враги: обычные');
  await expect(page.getByTestId('run-enter')).toHaveText('В бой');
  // No line repeating the head («Бой · ряд похода 1»): design 13.10.2026.
  await expect(card).not.toContainText('Обычный бой');
  await page.screenshot({ path: 'artifacts/realtime-node-card.png' });
  // A click inside the card keeps it; Esc closes it.
  await card.locator('h2').click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  expect(await centre()).toEqual(before);
  // A click beside the card (on the dimmed map) closes it too.
  await node.click();
  await expect(card).toBeVisible();
  await page.mouse.click(box.x + box.width + 60, box.y + box.height / 2);
  await expect(card).toHaveCount(0);
  // A click on another node through the backdrop opens that node's card; the header stays usable under an open card.
  const nodes = page.locator('[data-node]');
  await node.click();
  const other = nodes.nth(3), otherId = await other.getAttribute('data-node');
  await other.click();
  await expect(card).toHaveAttribute('data-card', otherId!);
  await page.getByTestId('run-settings').click();
  await expect(page.getByTestId('run-settings-panel')).toBeVisible();
  await page.getByTestId('run-settings').click();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await node.click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('goal')).toBeVisible();
  await expect(page.locator('.rt-info')).toBeHidden();
  expect(errors).toEqual([]);
});
