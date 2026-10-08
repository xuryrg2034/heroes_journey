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
  // The panel's phase table is this arena's: the note says what the arena forces over it.
  await expect(page.getByTestId('phase-arena-note')).toHaveText(/Стена щитов.*стай волков и кабанов нет/);
  await quiet(page);
  // Iteration 2.1: the shield faces a random direction and wanders; «Поворот щита» 0 keeps it where it faced at first,
  // so the test can stand in front of it and behind it (journalled param command).
  await page.evaluate(() => (window as any).__realtime.setParam('shieldTurn', 0));
  const id = await place(page, 9.2, 5, 'shield', 1, 1);
  await expect.poll(async () => (await snap(page)).signals.shields).toBe(1);
  const facing = (await snap(page)).enemies.find(e => e.id === id)!.vars.facing;
  // In front of the shield: the pointer on it says «щит», a press takes nothing.
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [9.2 + Math.cos(facing) * 1.2, 5 + Math.sin(facing) * 1.2]);
  const at = await screen(page, 9.2, 5);
  await page.mouse.move(at.x, at.y + 1);
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await snap(page)).hint).toBe('guarded');
  await expect(page.getByTestId('link-hint')).toHaveText('щит');
  await page.screenshot({ path: 'artifacts/realtime-shield.png' });
  await page.mouse.down();
  expect((await snap(page)).chain).toEqual([]);
  await page.mouse.up();
  // From behind it the link is taken.
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [9.2 - Math.cos(facing) * 1.2, 5 - Math.sin(facing) * 1.2]);
  await page.mouse.move(at.x, at.y + 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).kills).toBe(1);
  expect(errors).toEqual([]);
});

test('archer: arena 5 opens with three marked archers; its line is drawn for about 1 s, then the arrow hurts the hero on it', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 5);
  const start = await snap(page);
  expect(start.arena).toBe('archers');
  expect(start.enemies.filter(e => e.kind === 'archer')).toHaveLength(3);
  await expect(page.getByTestId('goal')).toHaveText('отмеченные 0 / 3');
  await quiet(page);
  // Stage 3a, step 2: below the hero between the ridges (x 6–10 is open) — at (3, 5) the left ridge hides him now.
  await place(page, 8, 9.2, 'archer', 2);
  // The line appears after the first delay (1 s) and fills up while it stands.
  await expect.poll(async () => (await snap(page)).signals.arrowLanes, { timeout: 5_000, intervals: [20] }).toBe(1);
  const announced = await snap(page);
  expect(announced.hero.hp).toBe(announced.hero.maxHp);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/realtime-archer-line.png' });
  await expect.poll(async () => (await snap(page)).hero.hp, { timeout: 5_000, intervals: [20] }).toBe(announced.hero.maxHp - 1);
  const shot = await snap(page);
  // The arrow flew about 1 s of game time after the line appeared; the line is gone until the next one.
  expect(shot.time - announced.time).toBeGreaterThan(0.85);
  expect(shot.time - announced.time).toBeLessThan(1.3);
  expect(shot.signals.arrowLanes).toBe(0);
  expect(errors).toEqual([]);
});

test('sapper: arena 6 opens; a sapper touching the hero lights its fuse — the ring and sparks are drawn, the blast hurts him for 2', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 6);
  expect((await snap(page)).arena).toBe('powder');
  await expect(page.getByTestId('goal')).toHaveText('убито 0 / 25');
  await quiet(page);
  await place(page, 8.45, 5, 'sapper', 1);
  // The touch lights the fuse at once: the ring of the blast radius grows while it burns (1.2 s).
  await expect.poll(async () => (await snap(page)).signals.fuses, { timeout: 3_000, intervals: [20] }).toBe(1);
  const lit = await snap(page);
  expect(lit.enemies[0].vars.lit).toBe(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/realtime-sapper-fuse.png' });
  await expect.poll(async () => (await snap(page)).hero.hp, { timeout: 5_000, intervals: [20] }).toBe(lit.hero.maxHp - 2);
  const after = await snap(page);
  expect(after.time - lit.time).toBeGreaterThan(1.0);
  expect(after.time - lit.time).toBeLessThan(1.5);
  expect(after.enemies).toHaveLength(0);
  expect(after.signals.fuses).toBe(0);
  // Its own blast is not the player's kill.
  expect(after.kills).toBe(0);
  expect(errors).toEqual([]);
});

test('porcupine: arena 7 opens; with the quills up a porcupine link shows «−1 HP» while the chain is drawn, and the dash through it costs the hero 1 HP', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 7);
  expect((await snap(page)).arena).toBe('thorns');
  await expect(page.getByTestId('goal')).toHaveText('кнопки 0 / 3');
  await quiet(page);
  // Iteration 2.1: the quills go up and down; a long «иглы подняты» keeps them up through the test once they rise.
  await page.evaluate(() => (window as any).__realtime.setParam('porcupineUpTime', 10));
  const id = await place(page, 9, 5, 'porcupine', 1, 1);
  await expect.poll(async () => (await snap(page)).signals.quillsRaised, { timeout: 10_000 }).toBe(1);
  const at = await screen(page, 9, 5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await expect.poll(async () => (await snap(page)).signals.quillBadges).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-porcupine-badge.png' });
  const before = await snap(page);
  expect(before.hero.hp).toBe(before.hero.maxHp);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).kills).toBe(1);
  const after = await snap(page);
  expect(after.hero.hp).toBe(after.hero.maxHp - 1);
  expect(after.signals.quillBadges).toBe(0);
  expect(errors).toEqual([]);
});

test('porcupine (iteration 2.1): with the quills down no «−1 HP» and no wound; before rising the quills tremble', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 7);
  await quiet(page);
  // «Иглы подняты» 0: the quills never rise — drawn lying flat, no badge, the dash costs nothing.
  await page.evaluate(() => (window as any).__realtime.setParam('porcupineUpTime', 0));
  const id = await place(page, 9, 5, 'porcupine', 1, 1);
  await expect.poll(async () => (await snap(page)).enemies.some(e => e.id === id)).toBe(true);
  const at = await screen(page, 9, 5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  const held = await snap(page);
  expect(held.signals.quillBadges).toBe(0);
  expect(held.signals.quillsRaised).toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-porcupine-down.png' });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).kills).toBe(1);
  const after = await snap(page);
  expect(after.hero.hp).toBe(after.hero.maxHp);
  // The cycle again with a long warning (3 s ≥ the 2 s down): every moment of the down part trembles.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('porcupineUpTime', 2.5); rt.setParam('porcupineWarn', 3); });
  await place(page, 10, 6, 'porcupine', 2, 1);
  await expect.poll(async () => (await snap(page)).signals.quillsTrembling, { timeout: 10_000 }).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-porcupine-trembling.png' });
  await expect.poll(async () => (await snap(page)).signals.quillsRaised, { timeout: 10_000 }).toBe(1);
  expect(errors).toEqual([]);
});
