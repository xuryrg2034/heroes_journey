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
