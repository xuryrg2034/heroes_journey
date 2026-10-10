import { test, expect, type Page } from '@playwright/test';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Camera of the real-time arena (docs/realtime-stage3.md, section 11): it follows the hero on an arena larger than the
 * screen («Большая поляна» 24×15, sandbox key ⇧8 / `?arena=18`), stands on the 16×10 arenas, holds still while a chain is
 * drawn, keeps the edges, points at off-screen dangers and goals, and never reaches the journal. Runs only through
 * playwright.realtime.config.ts.
 */
interface CameraState { x: number; y: number; viewW: number; viewH: number; scale: number; frozen: boolean; edge: { threat: number; goal: number; spawn: number }; arrows: { x: number; y: number; kind: string }[]; pointer: { x: number; y: number } | null; hint: string | null }

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
  // Before the goals the door is shut and nothing else is off screen: no pointers (phase A: the spawn markers are cleared
  // too — the frame drawn before the clear may still show their arrows, hence the poll).
  await expect.poll(async () => (await camera(page)).edge).toEqual({ threat: 0, goal: 0, spawn: 0 });
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await expect.poll(async () => (await camera(page)).edge.goal).toBe(1);
  // The hero walks to the door: it comes into view and its pointer goes.
  await teleport(page, 20.5, 7.5);
  await settled(page);
  await expect.poll(async () => (await camera(page)).edge.goal).toBe(0);
  // Phase A, Т6 (the point, the default): an archer marks the hero at the left end of the arena; while the mark is on
  // screen there is no pointer. The hero is moved to the right end (the windup is lengthened so that the mark waits): the
  // circle is now wholly off screen — a danger pointer at its centre.
  await page.evaluate(() => (window as any).__realtime.setParam('archerWindup', 10));
  await teleport(page, 3, 7.5);
  await settled(page);
  await place(page, 6.5, 10.5, 1, 0, 'archer');
  await expect.poll(async () => (await snap(page)).archerMarks, { timeout: 8_000 }).toBe(1);
  expect((await camera(page)).edge.threat).toBe(0);
  await teleport(page, 21, 7.5);
  await settled(page);
  expect((await snap(page)).archerMarks).toBe(1);
  await expect.poll(async () => (await camera(page)).edge.threat, { timeout: 8_000 }).toBe(1);
  const arrow = (await camera(page)).arrows.find(a => a.kind === 'threat')!;
  expect(arrow.x).toBeLessThan(100);
  await page.screenshot({ path: 'artifacts/realtime-camera-pointers.png' });
  expect(errors).toEqual([]);
});

/**
 * Phase B, track Д5 (design answer 23): with the build column on the left, a danger pointer at the left border keeps clear
 * of it — the left inset of the pointers is the column's right edge + 8 (main.ts `measureEdgeInset`).
 */
test('off-screen pointers at the left border keep clear of the build column (phase B, Д5)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  // Four items: a talisman, a relic and a hammer, the column is about 150 px tall from y ≈ 72.
  await page.evaluate(() => (window as any).__realtime.useBuild({ talismans: ['fifth-link', 'frost-edge', 'relic-millstone'], hammer: 'end-blast' }, 77));
  await still(page);
  await expect(page.getByTestId('build-column')).toBeVisible();
  const column = (await page.getByTestId('build-column').boundingBox())!;
  expect(column.x + column.width).toBeLessThanOrEqual(70.5);
  // An archer marks the hero at the left end of the arena; the hero goes to the right end: the circle is wholly off screen
  // on the left — a danger pointer at the left border (the inset holds along the whole left side, the column's height too).
  await page.evaluate(() => (window as any).__realtime.setParam('archerWindup', 10));
  await teleport(page, 3, 7.5);
  await settled(page);
  await place(page, 6.5, 10.5, 1, 0, 'archer');
  await expect.poll(async () => (await snap(page)).archerMarks, { timeout: 8_000 }).toBe(1);
  await teleport(page, 21, 7.5);
  await settled(page);
  await expect.poll(async () => (await camera(page)).edge.threat, { timeout: 8_000 }).toBe(1);
  const arrow = (await camera(page)).arrows.find(a => a.kind === 'threat')!;
  const half = 15;
  expect(arrow.x - half, `arrow at (${Math.round(arrow.x)}, ${Math.round(arrow.y)}), column ${JSON.stringify(column)}`).toBeGreaterThanOrEqual(column.x + column.width + 8 - 0.5);
  expect(arrow.x).toBeLessThan(130);
  await page.screenshot({ path: 'artifacts/realtime-phaseB-column-arrows.png' });
  expect(errors).toEqual([]);
});

/**
 * Phase A (Т5, design answer 9 of docs/realtime-phase-a.md): pointers to spawn markers off screen — only on an arena larger
 * than the view. «Большая поляна» 24×15: its markers come at the arena edge, out of view — pale arrows at the border, never
 * on the HUD. A 16×10 arena: every marker is on screen, no spawn arrow while markers come and go.
 */
test('spawn markers off screen get a pale arrow on 24×15 and none on 16×10', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await expect.poll(async () => (await camera(page)).edge.spawn, { timeout: 10_000, intervals: [100] }).toBeGreaterThanOrEqual(1);
  const cam = await camera(page);
  const spawns = cam.arrows.filter(a => a.kind === 'spawn');
  expect(spawns.length).toBe(cam.edge.spawn);
  // Grouped by direction: at most one per 45° sector.
  expect(spawns.length).toBeLessThanOrEqual(8);
  await page.screenshot({ path: 'artifacts/realtime-camera-spawn-arrows.png' });
  await open(page, errors, 1);
  let sawMarkers = false;
  for (let i = 0; i < 30; i++) {
    const [s, c] = await Promise.all([snap(page), camera(page)]);
    if (s.markers > 0) sawMarkers = true;
    expect(c.edge.spawn).toBe(0);
    await page.waitForTimeout(100);
  }
  expect(sawMarkers).toBe(true);
  expect(errors).toEqual([]);
});

test('the sandbox menu lists the camera sample under its heading (⇧8); the button and the key open it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/realtime.html?sandbox=1');
  await expect(page.getByTestId('menu')).toBeVisible();
  const button = page.getByTestId('camera-arena-1');
  await button.scrollIntoViewIfNeeded();
  await expect(button).toContainText('Большая поляна');
  await expect(button.locator('kbd')).toHaveText('⇧8');
  await button.click();
  await expect.poll(async () => (await snap(page)).arena).toBe('big-clearing');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Shift+Digit8');
  await expect.poll(async () => (await snap(page)).arena).toBe('big-clearing');
  expect((await camera(page)).viewW).toBeLessThan(24);
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

/** The page rectangles the pointers must keep clear of (DOM over the canvas). */
const hudRects = (page: Page): Promise<{ name: string; left: number; top: number; right: number; bottom: number }[]> => page.evaluate(() => {
  const out: { name: string; left: number; top: number; right: number; bottom: number }[] = [];
  for (const [name, sel] of [['hud', '.rt-hud'], ['action bar', '.rt-actionbar'], ['jump button', '.rt-jump'], ['help line', '.rt-help'], ['arenas button', '.rt-menu-open'], ['panel button', '.rt-open']] as const) {
    const node = document.querySelector(sel) as HTMLElement | null;
    if (!node || node.hidden) continue;
    const r = node.getBoundingClientRect();
    out.push({ name, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
});

test('off-screen pointers keep clear of the HUD: no arrow overlaps the action bar, the jump button, the top HUD or the help line', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  // Phase A, Т6 (the point, the default): two archers mark the hero at the bottom of the arena (the windup is lengthened so
  // that the marks wait); the hero is moved to the top — both circles are below the view: their arrows belong at the
  // bottom, where the action bar is.
  await page.evaluate(() => (window as any).__realtime.setParam('archerWindup', 10));
  await teleport(page, 11, 13.5);
  await settled(page);
  await place(page, 9.5, 8.7, 1, 0, 'archer');
  await place(page, 12.5, 8.7, 2, 0, 'archer');
  await expect.poll(async () => (await snap(page)).archerMarks, { timeout: 8_000 }).toBe(2);
  await teleport(page, 11, 2);
  await settled(page);
  await expect.poll(async () => (await camera(page)).edge.threat, { timeout: 8_000 }).toBeGreaterThanOrEqual(2);
  const rects = await hudRects(page);
  expect(rects.map(r => r.name)).toEqual(expect.arrayContaining(['hud', 'action bar', 'jump button', 'help line']));
  const arrows = (await camera(page)).arrows;
  expect(arrows.length).toBeGreaterThanOrEqual(3);
  const half = 15;
  for (const a of arrows) {
    for (const r of rects) {
      const overlap = a.x + half > r.left && a.x - half < r.right && a.y + half > r.top && a.y - half < r.bottom;
      expect(overlap, `${a.kind} arrow at (${Math.round(a.x)}, ${Math.round(a.y)}) overlaps the ${r.name} ${JSON.stringify(r)}`).toBe(false);
    }
  }
  expect(arrows.some(a => a.y > 560)).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-camera-pointers-bottom.png' });
  expect(errors).toEqual([]);
});

test('the result screen: the camera stands (no lead towards the pointer after the fight is over)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await teleport(page, 12, 7.5);
  await settled(page);
  await teleport(page, 23.2, 7.5);
  await expect.poll(async () => (await snap(page)).status).toBe('victory');
  const done = await camera(page);
  // The pointer far to the left of the hero would lead the camera; the hero standing at the door would drag it too.
  await page.mouse.move(60, 360);
  await page.waitForTimeout(1500);
  const later = await camera(page);
  expect(later.x).toBeCloseTo(done.x, 4);
  expect(later.y).toBeCloseTo(done.y, 4);
  expect(done.x).toBeLessThan(14);
  expect(errors).toEqual([]);
});

test('a pointer over the debug panel does not lead the camera; over the scene it does', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  await page.getByTestId('open-panel').click();
  await teleport(page, 12, 7.5);
  const before = await settled(page);
  const panel = await page.evaluate(() => document.querySelector('.rt-panel')!.getBoundingClientRect().left);
  await page.mouse.move(panel + 150, 360);
  await page.waitForTimeout(1200);
  expect((await camera(page)).x).toBeCloseTo(before.x, 4);
  // The same distance over the scene: the lead moves the camera.
  await page.mouse.move(panel - 8, 360);
  await page.waitForTimeout(1200);
  expect((await camera(page)).x).toBeGreaterThan(before.x + 0.15);
  expect(errors).toEqual([]);
});

test('the mouse stands, the camera moves: the pointer takes the new point of the world and the hint follows it', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  await teleport(page, 5, 11);
  await settled(page);
  await page.mouse.move(900, 150);
  await page.waitForTimeout(400);
  const first = await camera(page);
  const p0 = first.pointer!;
  expect(p0).not.toBeNull();
  // An enemy out of reach under the pointer: the hint says why it is not taken.
  await place(page, p0.x, p0.y, 1);
  await expect.poll(async () => (await camera(page)).hint).not.toBeNull();
  // The hero walks right, the camera follows, the mouse does not move.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyD');
  const moved = await settled(page);
  expect(moved.x).toBeGreaterThan(first.x + 1);
  const p1 = moved.pointer!;
  expect(p1.x).toBeGreaterThan(p0.x + 1);
  const check = await page.evaluate(([sx, sy]) => (window as any).__realtime.toWorld(sx, sy), [900, 150] as const);
  expect(p1.x).toBeCloseTo(check.x, 3);
  expect(p1.y).toBeCloseTo(check.y, 3);
  // The old enemy is no longer under the pointer; one put under the new point is.
  await expect.poll(async () => (await camera(page)).hint).toBeNull();
  await place(page, p1.x, p1.y, 1);
  await expect.poll(async () => (await camera(page)).hint).not.toBeNull();
  await expect(page.getByTestId('link-hint')).toBeVisible();
  expect(errors).toEqual([]);
});
