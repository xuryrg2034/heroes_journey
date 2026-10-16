import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import { gameWait } from './realtimeFrames';

/**
 * Task 43 «Гарнизон, шаг 2», part Б (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 4 and 10): the sandbox «Двор
 * кастеляна (полный)» (`?arena=26`) with real mouse input — the pointer over the core behind the grate says «за решёткой» and a
 * press on it takes nothing; a chain to a lever raises the grate; a chain to the core in the window takes a plate; the browser
 * fight replays in Node to the same hash. The rules: `npm run test:realtime-castellan-full`. The look of the grate, the levers and
 * the moat is the ui session's.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page, query: string): Promise<void> {
  await page.goto(`/?sandbox=1${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

test('task 43: «Двор кастеляна (полный)» — «за решёткой» at the pointer, a press takes nothing; a chain to a lever raises the grate; a chain to the core in the window takes a plate; the fight replays in Node', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=26');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-castellan-full');
  // No newcomers, bodies stand, nothing hurts by touch, the crossbow on the stand does not shoot (its windup 100 s).
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['crossbowWindup', 100]] as const) rt.setParam(key, value);
    rt.params.maxEnemies = 0;
  });
  type Snap = { enemies: { id: number; kind: string; x: number; y: number; armor: { plates: number } | null }[]; objects: { id: number; kind: string; x: number; y: number; gate?: boolean; ready?: number }[]; chain: number[]; time: number; loop: { hintText: string | null } };
  const read = async (): Promise<Snap> => snap(page);
  const screen = (x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
  /** The screen point of (x, y) once the camera stopped gliding after a teleport (two reads 0.1 game s apart agree). */
  const settled = async (x: number, y: number): Promise<{ x: number; y: number }> => {
    let last = await screen(x, y);
    for (let i = 0; i < 40; i++) {
      await gameWait(page, 0.1);
      const now = await screen(x, y);
      if (Math.abs(now.x - last.x) < 0.5 && Math.abs(now.y - last.y) < 0.5) return now;
      last = now;
    }
    return last;
  };
  const core = (await read()).enemies.find(e => e.kind === 'castellan')!;
  expect(core.armor?.plates).toBe(5);
  // The hero at the moat's yard edge below the core: the pointer over the core — «за решёткой»; a press takes nothing.
  await page.evaluate(() => (window as any).__realtime.teleport(10, 5.6));
  const pc = await settled(core.x, core.y);
  await page.mouse.move(pc.x, pc.y);
  await expect.poll(async () => (await read()).loop.hintText).toBe('за решёткой');
  await page.mouse.down();
  await page.mouse.up();
  expect((await read()).chain).toEqual([]);
  await page.screenshot({ path: 'artifacts/realtime-castellan-full-grate.png' });
  // A chain of one link — the lever in the yard's south: after the dash the lever waits its cooldown and the grate is up.
  const lever = (await read()).objects.find(o => o.kind === 'lever' && o.gate && o.y > 12)!;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [lever.x, lever.y - 1.3] as const);
  // The camera follows the hero: the screen points are read once it settled.
  const pl = await settled(lever.x, lever.y);
  await page.mouse.move(pl.x, pl.y);
  await page.mouse.down();
  await expect.poll(async () => (await read()).chain).toEqual([lever.id]);
  await page.mouse.up();
  await expect.poll(async () => { const s = await read(); return (s.objects.find(o => o.id === lever.id)?.ready ?? 0) > s.time; }, { timeout: 5_000 }).toBe(true);
  // The window: back at the moat's edge, the pointer over the core says nothing; the chain to it takes a plate.
  await page.evaluate(() => (window as any).__realtime.teleport(10, 5.6));
  const pw = await settled(core.x, core.y);
  await page.mouse.move(pw.x + 2, pw.y + 2);
  await page.mouse.move(pw.x, pw.y);
  await expect.poll(async () => (await read()).loop.hintText).toBe(null);
  await page.mouse.down();
  await expect.poll(async () => (await read()).chain).toEqual([core.id]);
  await page.screenshot({ path: 'artifacts/realtime-castellan-full-window.png' });
  await page.mouse.up();
  await expect.poll(async () => (await read()).enemies.find(e => e.id === core.id)?.armor?.plates, { timeout: 5_000 }).toBe(4);
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});

/**
 * Task 43, the view of step 2а (ui; design 16.10.2026, spec 4 and 10): the court of the full Castellan at 1280×720 — the whole
 * gallery (the core, its hounds, the crossbow on its stand) in view with the hero at the moat (no zoom-out: the fights' scale); three
 * levers drawn, lit; the grate down over the core; a chain to a lever by the real mouse raises it — the countdown «5…1» over the
 * grate, and by the core's goal arrow while the hero is by the far lever; the lever waits its cooldown (dark). The crossbowman's
 * bolt: the dashed line fixed at the windup's start, then the bolt flies. From the gallery the jump costs 0.
 */
test('task 43 view: the court — the gallery in view, levers, the grate and its countdown (also at the edge arrow); the bolt\'s dashed line and its flight; the jump from the gallery costs 0', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=26');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-castellan-full');
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['crossbowWindup', 100]] as const) rt.setParam(key, value);
    rt.params.maxEnemies = 0;
  });
  const screen = (x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
  const settled = async (x: number, y: number): Promise<{ x: number; y: number }> => {
    let last = await screen(x, y);
    for (let i = 0; i < 40; i++) {
      await gameWait(page, 0.1);
      const now = await screen(x, y);
      if (Math.abs(now.x - last.x) < 0.5 && Math.abs(now.y - last.y) < 0.5) return now;
      last = now;
    }
    return last;
  };
  // The hero at the moat: the gallery's bodies stand below the boss bar, inside the window.
  await page.evaluate(() => (window as any).__realtime.teleport(10, 5.8));
  await settled(10, 5.8);
  const bar = await page.getByTestId('boss-bar').boundingBox();
  const gallery = (await snap(page)).enemies.filter((e: { y: number }) => e.y < 4.8);
  expect(gallery.map((e: { kind: string }) => e.kind).sort()).toEqual(['castellan', 'castellan-crossbow', 'hound', 'hound']);
  for (const e of gallery) {
    const at = await screen(e.x, e.y);
    expect(at.y, `${e.kind} below the boss bar`).toBeGreaterThan((bar?.y ?? 0) + (bar?.height ?? 0) + 20);
    expect(at.x).toBeGreaterThan(0); expect(at.x).toBeLessThan(1280);
  }
  const court = (await snap(page)).court;
  expect(court).toMatchObject({ levers: 3, leversReady: 3, grate: 1, grateOpen: 0, count: '' });
  await page.screenshot({ path: 'artifacts/realtime-court-yard.png' });

  // A chain of one link — the south lever: the grate rises, the countdown over it; by the lever the core is off screen — the count
  // stands by the goal arrow.
  const lever = (await snap(page)).objects.find((o: { kind: string; gate?: boolean; y: number }) => o.kind === 'lever' && o.gate && o.y > 12);
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [lever.x, lever.y - 1.3] as const);
  const pl = await settled(lever.x, lever.y);
  await page.mouse.move(pl.x, pl.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([lever.id]);
  await page.screenshot({ path: 'artifacts/realtime-court-lever-chain.png' });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).court.grateOpen, { timeout: 5_000 }).toBe(1);
  await expect.poll(async () => (await snap(page)).court.edgeCount).toMatch(/^[1-5]$/);
  expect((await snap(page)).court.leversReady).toBe(2);
  await page.screenshot({ path: 'artifacts/realtime-court-lever.png' });
  // Back at the moat: the countdown over the grate, whole seconds falling.
  await page.evaluate(() => (window as any).__realtime.teleport(10, 5.8));
  await settled(10, 5.8);
  const first = Number((await snap(page)).court.count);
  expect(first).toBeGreaterThanOrEqual(1);
  expect((await snap(page)).court.edgeCount).toBe('');
  await page.screenshot({ path: 'artifacts/realtime-court-window.png' });
  await expect.poll(async () => Number((await snap(page)).court.count || 0), { timeout: 6_000 }).toBeLessThan(first);
  await expect.poll(async () => (await snap(page)).court.grateOpen, { timeout: 8_000 }).toBe(0);

  // The crossbowman in the yard (the stand's windup stays long): its dashed line during the windup, then the bolt flies.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('crossbowWindup', 1); rt.teleport(6, 9); rt.place(12, 9.5, 3, 0, 'crossbow'); });
  await expect.poll(async () => (await snap(page)).court.bolts, { timeout: 8_000 }).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/realtime-court-bolt.png' });
  await expect.poll(async () => (await snap(page)).court.shots, { timeout: 8_000 }).toBeGreaterThanOrEqual(1);

  // On the gallery the jump down costs 0: the action bar's jump shows 0.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setEnergy(0); rt.teleport(6, 3); });
  await expect(page.getByTestId('ability-jump').locator('.rt-tile-cost')).toContainText('0');
  expect(errors).toEqual([]);
});
