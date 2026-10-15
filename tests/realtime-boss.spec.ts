import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 27 «Каркас босса и Тюремщик в песочнице» (design 15.10.2026, docs/design-notes/tasks-26-28.md): the view of the flail
 * Jailer on its sandbox arena (⇧9, `?arena=19`) — the illustration, the weight on its chain, the move signs, the plate pips,
 * the «отрубит» pip, the chain falling when the weight is severed, «−1 пластина» over the core after the dash. Real input: the
 * player draws the chain with the mouse. Runs through playwright.realtime.config.ts only; the rules are checked in Node
 * (`npm run test:realtime-jailer`).
 */
interface BossView { flail: number; throw: number; whistle: number; chains: number; severPips: number; hits: number; breaks: number; plates: number }
interface Snap {
  arena: string;
  status: string;
  chain: number[];
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; partOf: number | null; armor: { plates: number; max: number } | null }[];
  boss: BossView;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

async function openJailer(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=19');
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('jailer');
}

/** No newcomers, nobody walks, touches do not hurt — journalled commands only, so the fight replays in Node. */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(k, v);
  });
}

/** Press at the first point and drag through the rest (each read just before the pointer goes there). */
async function drawChain(page: Page, points: (() => Promise<{ x: number; y: number }>)[]): Promise<void> {
  const first = await points[0]();
  const at0 = await screen(page, first.x, first.y);
  await page.mouse.move(at0.x, at0.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const p = await point(), at = await screen(page, p.x, p.y);
    await page.mouse.move(at.x, at.y, { steps: 6 });
  }
}

test('task 27: the sandbox menu has «Тюремщик» under the boss heading (⇧9); the arena shows the core, its weight on a chain and their plate pips', async ({ page }) => {
  const errors: string[] = [];
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('boss-arena-1')).toContainText('Тюремщик');
  await expect(page.getByTestId('boss-arena-1').locator('kbd')).toHaveText('⇧9');
  await openJailer(page, errors);
  const s = await snap(page);
  const core = s.enemies.find(e => e.kind === 'jailer')!, weight = s.enemies.find(e => e.kind === 'jailer-weight')!;
  expect(weight.partOf).toBe(core.id);
  expect(core.armor).toMatchObject({ plates: 3, max: 3 });
  expect(weight.armor).toMatchObject({ plates: 1, max: 1 });
  await expect.poll(async () => (await snap(page)).boss.chains).toBe(1);
  expect(errors).toEqual([]);
});

test('task 27: a chain through the weight severs it — the plate first, then «отрубит» blinks on the core, the chain falls, the core loses a plate after the dash; the browser fight replays in Node to the same hash', async ({ page }) => {
  const errors: string[] = [];
  await openJailer(page, errors);
  await quiet(page);
  const ids = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.clear(false);
    rt.teleport(6, 6);
    return { core: rt.place(10, 6, 1, 2, 'jailer'), weight: rt.place(10, 6, 0, 3, 'jailer-weight') };
  });
  const enemy = async (id: number): Promise<{ x: number; y: number }> => (await snap(page)).enemies.find(e => e.id === id)!;
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === ids.weight)?.partOf).toBe(ids.core);
  await expect.poll(async () => (await snap(page)).boss.chains).toBe(1);
  // Once the core faces the hero (west), it is frozen: no moves and no turning while the test draws (the weight stays in its
  // hand where it is; the hero stays west of it). It thaws for the snapshot of the plan only.
  await gameWait(page, 0.35);
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 60), [ids.core] as const);

  // Chain 1: [a1, weight] takes the weight's plate (the plate badge, no «отрубит»).
  let w = await enemy(ids.weight);
  const a1 = await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; rt.teleport(x - 2.8, y); return rt.place(x - 1.4, y, 0, 0, 'basic'); }, [w.x, w.y] as const);
  await drawChain(page, [() => enemy(a1), () => enemy(ids.weight)]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, ids.weight]);
  expect((await snap(page)).boss.severPips).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === ids.weight)?.armor?.plates, { timeout: 5_000 }).toBe(0);

  // Chain 2: three links before the weight and one after — enough to cut through its 3 HP: «отрубит» blinks on the core.
  await expect.poll(async () => (await snap(page)).chain.length).toBe(0);
  w = await enemy(ids.weight);
  const helpers = await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    rt.teleport(x - 4.4, y);
    return [rt.place(x - 3.3, y, 0, 0, 'basic'), rt.place(x - 2.2, y, 0, 0, 'basic'), rt.place(x - 1.1, y, 0, 0, 'basic')];
  }, [w.x, w.y] as const);
  await drawChain(page, [...helpers.map(id => () => enemy(id)), () => enemy(ids.weight)]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([...helpers, ids.weight]);
  await expect.poll(async () => (await snap(page)).boss.severPips).toBe(1);
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 0), [ids.core] as const);
  await gameWait(page, 0.05);
  await page.screenshot({ path: 'artifacts/realtime-boss-sever-plan.png' });
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 60), [ids.core] as const);
  const coreBefore = (await snap(page)).enemies.find(e => e.id === ids.core)!;
  expect(coreBefore.armor?.plates).toBe(3);
  await page.mouse.up();

  // The weight is gone, its chain fell apart, the core lost one plate after the dash and «−1 пластина» stood over it.
  await expect.poll(async () => (await snap(page)).enemies.some(e => e.id === ids.weight), { timeout: 5_000 }).toBe(false);
  await expect.poll(async () => (await snap(page)).boss.breaks).toBe(1);
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === ids.core)?.armor?.plates, { timeout: 5_000 }).toBe(2);
  await expect.poll(async () => (await snap(page)).boss.plates).toBe(1);
  expect((await snap(page)).boss.chains).toBe(0);

  // The fight after the weight is severed: the core thaws and runs at the hero shield first (×1.3); the weight's moves never
  // come again — no flail half disc, no throw circle for 4 s (the whistle needs phase 2: 1 plate or 30 s).
  const c0 = await enemy(ids.core);
  await page.evaluate(([core, x, y]) => {
    const rt = (window as any).__realtime;
    rt.teleport(x - 5, y);
    rt.setParam('heroHp', 40);
    rt.setParam('enemySpeed', 0.8);
    rt.chill(core, 0);
  }, [ids.core, c0.x, c0.y] as const);
  const from = await enemy(ids.core);
  await expect.poll(async () => { const c = await enemy(ids.core); return Math.hypot(c.x - from.x, c.y - from.y) > 0.6; }, { timeout: 6_000 }).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-boss-after-sever.png' });
  let signs = 0;
  for (const until = Date.now() + 4_000; Date.now() < until;) { const v = (await snap(page)).boss; signs += v.flail + v.throw; }
  expect(signs).toBe(0);
  // The fight recorded in the browser replays in Node to the same world hash.
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});

test('task 27 snapshots at 1280×720: the flail windup and the weight throw (the fight after the sever — the test above)', async ({ page }) => {
  const errors: string[] = [];
  await openJailer(page, errors);
  await quiet(page);
  // The Jailer alone in the yard, the hero close to it: the flail may come (its reach is 3), the throw too.
  const core0 = { x: 9, y: 6.5 };
  await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    rt.setParam('heroHp', 40);
    rt.clear(false);
    rt.teleport(x + 2.2, y);
    rt.place(x, y, 1, 2, 'jailer');
    rt.place(x, y, 0, 3, 'jailer-weight');
  }, [core0.x, core0.y] as const);
  await expect.poll(async () => { const b = (await snap(page)).boss; return b.flail > 0 || b.throw > 0; }, { timeout: 15_000, intervals: [30] }).toBe(true);
  let b = (await snap(page)).boss;
  await page.screenshot({ path: b.flail > 0 ? 'artifacts/realtime-boss-flail.png' : 'artifacts/realtime-boss-throw.png' });
  const other = b.flail > 0 ? 'throw' : 'flail';
  if (other === 'throw') await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 5, y), [core0.x, core0.y] as const);
  else await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 2.2, y), [core0.x, core0.y] as const);
  await expect.poll(async () => (await snap(page)).boss[other], { timeout: 20_000, intervals: [30] }).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/realtime-boss-${other}.png` });
  expect(errors).toEqual([]);
});
