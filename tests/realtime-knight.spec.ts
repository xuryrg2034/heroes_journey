import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';

/**
 * Task 43, part ui — the view of the knight «Рыцарь» (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 5): the plate
 * pips over a knight in armour (two, then one), the shed (the plates fall apart, a red ring), «Рывок» (the boar's strip while the
 * windup runs), «Размах» (the circle filling with the windup). Real input: the chain with the mouse in the sandbox arena 27
 * («Рыцарь (проба)»); the rules are core's (sim/knight.spec.ts). The windups are lengthened (params) so the screenshot catches them.
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

/** Only what the test places acts (no newcomers, bodies creep at the slider's minimum, nothing hurts the hero); the hero at `hero`. */
async function quiet(page: Page, hero: { x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(x, y);
  }, [hero.x, hero.y] as const);
}

const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

const knightOf = async (page: Page, id: number): Promise<any> => (await snap(page)).enemies.find((e: any) => e.id === id);

/** The chain with the real mouse over the bodies `ids` in turn, released: the dash. */
async function drawChain(page: Page, ids: number[]): Promise<void> {
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = await knightOf(page, id); return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  const p0 = await at(ids[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const id of ids.slice(1)) { const p = await at(id); await page.mouse.move(p.x, p.y, { steps: 6 }); }
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
  await page.mouse.up();
}

/** A knight at (8, 4.2) with a pair of its colour on each side of the hero's line; the chain bodies are placed anew for each pass. */
async function pass(page: Page, knight: number): Promise<void> {
  await page.evaluate(() => (window as any).__realtime.teleport(8, 6.6));
  const a = await place(page, 6.7, 5.5, 1, 1, 'basic'), b = await place(page, 9.3, 5.5, 1, 1, 'basic');
  await drawChain(page, [a, knight, b]);
}

test('task 43 view: «Рыцарь (проба)» — the knights stand in armour, two plate pips each, no elite plaque', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=27');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-knight-test');
  await gameWait(page, 0.5);
  const s = await snap(page);
  const knights = s.enemies.filter((e: any) => e.kind === 'knight');
  expect(knights.length).toBe(2);
  for (const k of knights) { expect(k.armor.plates).toBe(2); expect(k.elite).toBe(false); }
  await expect.poll(async () => (await snap(page)).knight.pips).toBe(4);
  expect((await snap(page)).knight.filled).toBe(4);
  await page.screenshot({ path: 'artifacts/realtime-knight-formation.png' });
  expect(errors).toEqual([]);
});

test('task 43 view: a chain through the knight takes a plate pip; the last one — the shed, then the charge lane and the swing circle fill with their windups', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=27');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-knight-test');
  await quiet(page, { x: 8, y: 6.6 });
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('knightChargeWindup', 3); rt.setParam('knightSwingWindup', 3); });
  const knight = await place(page, 8, 4.2, 1, 3, 'knight');
  await expect.poll(async () => (await snap(page)).knight.filled).toBe(2);

  // The first chain: one plate gone, the pip is empty, the body keeps its HP.
  await pass(page, knight);
  await expect.poll(async () => (await knightOf(page, knight))?.armor?.plates).toBe(1);
  await expect.poll(async () => { const k = (await snap(page)).knight; return [k.pips, k.filled]; }).toEqual([2, 1]);
  expect((await knightOf(page, knight)).hp).toBe(3);
  expect((await snap(page)).knight.sheds).toBe(0);

  // The second chain: the last plate — the shed (the event counted, the pips gone).
  await pass(page, knight);
  await expect.poll(async () => (await snap(page)).knight.sheds).toBe(1);
  // The first move waits `knightPause` (2 s, the default) after the shed: no lane in the shed's frame (design asked, 16.10.2026).
  expect((await snap(page)).knight.lanes).toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-knight-shed.png' });
  expect((await knightOf(page, knight)).armor).toBeNull();
  await expect.poll(async () => (await snap(page)).knight.pips).toBe(0);
  // On the offensive the red mark stays (design 16.10.2026): the visor's glow and the red ring, while the knight lives.
  await expect.poll(async () => (await snap(page)).knight.marks).toBe(1);
  await gameWait(page, 1);
  expect((await snap(page)).knight.marks).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-knight-offensive.png' });

  // «Рывок»: the boar's strip along the lane while the windup runs, filling (the sim's progress grows).
  await untilFrame(page, (sn, id: number, late) => sn.knight.lanes > 0 || late ? sn.knight.lanes : undefined, knight, 4);
  const progress = async (): Promise<number> => { const v = (await knightOf(page, knight)).vars; return 1 - Math.max(0, v.kt) / v.kw; };
  const p1 = await progress();
  expect((await snap(page)).knight.lanes).toBe(1);
  await page.evaluate(() => (window as any).__realtime.teleport(14, 8.5));
  await gameWait(page, 1);
  expect((await snap(page)).knight.lanes).toBe(1);
  expect(await progress()).toBeGreaterThan(p1 + 0.1);
  await page.screenshot({ path: 'artifacts/realtime-knight-charge.png' });

  // «Размах» after the run: the circle with the arc filling clockwise.
  const swings = await untilFrame(page, (sn, id: number, late) => sn.knight.swings > 0 || late ? sn.knight.swings : undefined, knight, 10);
  expect(swings).toBe(1);
  const q1 = await progress();
  await gameWait(page, 1);
  expect(await progress()).toBeGreaterThan(q1 + 0.1);
  expect((await snap(page)).knight.swings).toBe(1);
  expect((await snap(page)).knight.lanes).toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-knight-swing.png' });
  expect(errors).toEqual([]);
});
