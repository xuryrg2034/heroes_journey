import { test, expect, type Page } from '@playwright/test';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Camera of the real-time arena (docs/realtime-stage3.md, section 11): it follows the hero on an arena larger than the
 * screen («Большая поляна» 24×15, sandbox key ⇧8 / `?arena=18`), stands on the 16×10 arenas, holds still while a chain is
 * drawn, keeps the edges, points at off-screen dangers and goals, and never reaches the journal. Runs only through
 * playwright.realtime.config.ts.
 */
interface CameraState { x: number; y: number; viewW: number; viewH: number; scale: number; frozen: boolean; edge: { threat: number; goal: number } }

const camera = (page: Page): Promise<CameraState> => page.evaluate(() => (window as any).__realtime.camera());
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

/** Opens the sandbox on arena `n` (1–18) with a fixed seed. */
async function open(page: Page, errors: string[], n: number): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/realtime.html?sandbox=1&arena=${n}&seed=77`);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeHidden();
}

/** No newcomers and nobody walking: only what the test places. */
async function still(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = (window as any).__realtime;
    r.params.enemySpeed = 0; r.params.wolfSpeed = 0; r.params.speedSpread = 0;
    r.params.baseIntervalMin = 1000; r.params.baseIntervalMax = 1000; r.params.baseFloor = 0;
    r.clear();
  });
}

/** Waits until the camera stops (two samples 250 ms apart agree); the first 600 ms let a command just sent take effect. */
async function settled(page: Page): Promise<CameraState> {
  await page.waitForTimeout(600);
  let last = await camera(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const now = await camera(page);
    if (Math.abs(now.x - last.x) < 1e-3 && Math.abs(now.y - last.y) < 1e-3) return now;
    last = now;
  }
  throw new Error('the camera never settled');
}

const teleport = (page: Page, x: number, y: number): Promise<unknown> => page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp = 0, kind = 'basic'): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

test('a 16×10 arena: the camera stands in its centre while the hero walks (same picture as before the camera)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await still(page);
  const first = await camera(page);
  expect(first.x).toBeCloseTo(8, 5);
  expect(first.y).toBeCloseTo(5, 5);
  // The scale is the one that fitted the whole arena: 16 units in (1280 − 24) px, 10 in (720 − 24).
  expect(first.scale).toBeCloseTo(Math.min((1280 - 24) / (16 * 72), (720 - 24) / (10 * 72)), 5);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyD');
  expect((await snap(page)).hero.x).toBeGreaterThan(8.5);
  const after = await camera(page);
  expect(after.x).toBeCloseTo(8, 5);
  expect(after.y).toBeCloseTo(5, 5);
  // The arena fills the window as before: the map origin sits at the same pixel.
  const origin = await screen(page, 0, 0);
  expect(origin.x).toBe(Math.round(1280 / 2 - 8 * 72 * first.scale));
  expect(errors).toEqual([]);
});

test('a larger arena: the camera follows the hero with a lag, outside the dead zone, and keeps the edges', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  const start = await camera(page);
  expect(start.x).toBeCloseTo(12, 3);
  expect(start.y).toBeCloseTo(7.5, 3);
  expect(start.viewW).toBeGreaterThan(18);
  // A step inside the dead zone (±1 unit across): the camera does not move.
  await teleport(page, 12.8, 7.5);
  await page.waitForTimeout(700);
  expect((await camera(page)).x).toBeCloseTo(12, 3);
  // Walking right: the camera moves, but stays behind the hero while he runs.
  await teleport(page, 12, 7.5);
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  const running = await camera(page), hero = (await snap(page)).hero;
  await page.keyboard.up('KeyD');
  expect(running.x).toBeGreaterThan(12.4);
  expect(running.x).toBeLessThan(hero.x);
  // At the far corner: the camera rests on the edge, the view ends at the arena border (nothing but arena on screen).
  await teleport(page, 23.4, 14.4);
  const corner = await settled(page);
  expect(corner.x).toBeCloseTo(24 - corner.viewW / 2, 3);
  expect(corner.y).toBeCloseTo(15 - corner.viewH / 2, 3);
  const topLeft = await page.evaluate(() => (window as any).__realtime.toWorld(0, 0));
  expect(topLeft.x).toBeGreaterThanOrEqual(24 - corner.viewW - 0.01);
  expect(topLeft.x + corner.viewW).toBeLessThanOrEqual(24 + 0.01);
  expect(topLeft.y + corner.viewH).toBeLessThanOrEqual(15 + 0.01);
  await teleport(page, 0.6, 0.6);
  const origin = await settled(page);
  expect(origin.x).toBeCloseTo(origin.viewW / 2, 3);
  expect(origin.y).toBeCloseTo(origin.viewH / 2, 3);
  expect((await page.evaluate(() => (window as any).__realtime.toWorld(0, 0))).x).toBeCloseTo(0, 2);
  expect(errors).toEqual([]);
});

test('a click on the screen takes the enemy under it, whatever the camera offset (arena point = screen point through the camera)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  await teleport(page, 18.5, 6);
  const cam = await settled(page);
  expect(cam.x).toBeGreaterThan(14);
  // The mapping is its own inverse at several points.
  for (const [x, y] of [[18.5, 6], [21, 8], [14, 3]]) {
    const s = await screen(page, x, y);
    const w = await page.evaluate(([sx, sy]) => (window as any).__realtime.toWorld(sx, sy), [s.x, s.y] as const);
    expect(w.x).toBeCloseTo(x, 4);
    expect(w.y).toBeCloseTo(y, 4);
  }
  const a = await place(page, 19.6, 6, 0), b = await place(page, 20.8, 6, 0);
  const pa = await screen(page, 19.6, 6), pb = await screen(page, 20.8, 6);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([a]);
  await page.mouse.move(pb.x, pb.y, { steps: 5 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a, b]);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).kills, { timeout: 5_000 }).toBe(2);
  expect(errors).toEqual([]);
});

test('while a chain is drawn the camera stands, even when the hero walks; after the release it follows again', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  await teleport(page, 12, 7.5);
  const before = await settled(page);
  const a = await place(page, 13.2, 7.5, 0);
  const pa = await screen(page, 13.2, 7.5);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([a]);
  expect((await camera(page)).frozen).toBe(true);
  // The hero walks left while the button is held: the world must not slide under the pointer.
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyA');
  const held = await camera(page);
  expect((await snap(page)).hero.x).toBeLessThan(11);
  expect(held.x).toBeCloseTo(before.x, 4);
  expect(held.y).toBeCloseTo(before.y, 4);
  await page.mouse.up();
  await page.mouse.move(640, 360);
  expect((await camera(page)).frozen).toBe(false);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyA');
  expect((await camera(page)).x).toBeLessThan(before.x - 0.5);
  expect(errors).toEqual([]);
});

test('off-screen pointers: the open door and a danger aimed at the hero; none for what is in view', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  // Before the goals the door is shut and nothing else is off screen: no pointers.
  expect((await camera(page)).edge).toEqual({ threat: 0, goal: 0 });
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await expect.poll(async () => (await camera(page)).edge.goal).toBe(1);
  // The hero walks to the door: it comes into view and its pointer goes.
  await teleport(page, 20.5, 7.5);
  await settled(page);
  await expect.poll(async () => (await camera(page)).edge.goal).toBe(0);
  // An archer straight above the hero keeps about 6.3 units: the view is only 5.2 up from its centre, the archer is off
  // screen — and when it aims, a danger pointer shows.
  await teleport(page, 12, 9.5);
  await settled(page);
  const hero = (await snap(page)).hero;
  await place(page, hero.x, hero.y - 6.3, 1, 0, 'archer');
  await expect.poll(async () => (await camera(page)).edge.threat, { timeout: 8_000 }).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/realtime-camera-pointers.png' });
  expect(errors).toEqual([]);
});

test('the debug panel does not cover the hero: the camera centres him in the free part of the window', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  await page.getByTestId('open-panel').click();
  const panelLeft = await page.evaluate(() => document.querySelector('.rt-panel')!.getBoundingClientRect().left);
  await teleport(page, 22, 7.5);
  const cam = await settled(page);
  const hero = (await snap(page)).hero, at = await screen(page, hero.x, hero.y);
  expect(at.x).toBeLessThan(panelLeft);
  expect(at.x).toBeGreaterThan(0);
  // The view is as wide as the free part: nothing of the arena is hidden under the panel by the camera.
  expect(cam.viewW * 72 * cam.scale).toBeCloseTo(panelLeft, 0);
  expect(errors).toEqual([]);
});

test('a fight played with a moving camera replays in Node to the same hash: commands are in arena coordinates', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await page.evaluate(() => (window as any).__realtime.selectArena(18, 4242));
  await page.waitForTimeout(500);
  // Walk to the right (the camera follows), then draw chains at the screen points of enemies.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyD');
  for (let i = 0; i < 3; i++) {
    const s = await snap(page);
    const id = await place(page, Math.min(23, s.hero.x + 1.1), s.hero.y, 0);
    await page.waitForTimeout(100);
    const target = (await snap(page)).enemies.find((e: any) => e.id === id);
    if (!target) continue;
    const at = await screen(page, target.x, target.y);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyS');
  const recorded = await page.evaluate(() => { const r = (window as any).__realtime; return { journal: r.journal(), hash: r.hash(), cam: r.camera() }; }) as { journal: Journal; hash: string; cam: CameraState };
  expect(recorded.journal.arena).toBe('big-clearing');
  expect(recorded.journal.ticks).toBeGreaterThan(200);
  expect(recorded.cam.x).not.toBeCloseTo(12, 1);
  expect(recorded.journal.commands.some(c => c.cmd.t === 'begin')).toBe(true);
  // Every pointer command carries arena coordinates inside the arena, none carries screen pixels.
  for (const c of recorded.journal.commands) {
    const cmd = c.cmd as { t: string; x?: number; y?: number };
    if (cmd.t === 'begin' || cmd.t === 'drag' || cmd.t === 'sweep') { expect(cmd.x!).toBeGreaterThan(-1); expect(cmd.x!).toBeLessThan(25); expect(cmd.y!).toBeGreaterThan(-1); expect(cmd.y!).toBeLessThan(16); }
  }
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});
