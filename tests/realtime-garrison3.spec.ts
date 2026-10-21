import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 59а «Гарнизон, шаг 3», part ui — the view of the pitcher «Смолокур», the recruits «Новобранцы» and the wardens «Привратники»
 * (design 17.10.2026, docs/design-notes/task-59-garrison-step3.md, 8 and 14 «Playwright»), by real input at 1280×720: the mouse opens
 * a probe arena from the sandbox menu and draws the chains, the keys walk the hero off the pitcher's mark. The rules are core's
 * (`npm run test:realtime-pitcher`, `-recruits`, `-wardens`); the signs the player reads are `npm run test:realtime-garrison3-view`;
 * here: that they stand on the screen at the right time. Waits are in game time (tests/realtimeFrames.ts); a fight's journal replays
 * in Node to the hash of the page. Screenshots go to $SHOT_DIR when it is set (design 14: the shots at 1280×720).
 * Written 21.10.2026 by the ui session on branch ui/task-59a and NOT RUN there (the probe arenas «Смолокур (проба)», «Новобранцы
 * (проба)», «Привратники (проба)» were not in the tree yet: the menu buttons are found by the test ids step3-arena-1..3). Run it once after design's smoke.
 */
interface G3 {
  windups: number; pots: number; marks: number; marksLit: number; pools: number; burning: number; poolFire: number; heroInPitch: number; drops: number; trail: number;
  throws: number; lands: number; heroHits: number; pooled: number; ignites: number;
  poolAt: { id: number; x: number; y: number; burning: boolean }[]; markAt: { x: number; y: number }[];
  recruits: { numbers: number; current: number; dim: number; bans: number; currentNumber: number; refused: number; drills: number; unlinks: number };
  wardens: { keys: number; gold: number; warn: number; anger: number; swings: number; starts: number; ends: number; hits: number };
  sounds: { throws: number; lands: number; ignites: number; keys: number };
}
interface Snap {
  hint: string | null; chain: number[]; arena: string; status: string; time: number; menuOpen: boolean; energy: number;
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; color: number; vars: Record<string, number> }[];
  garrison: G3;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/garrison3-${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The sandbox with fresh storage; the probe arena `name` opened by a real click in the menu (the menu is reopened by M). */
async function openProbe(page: Page, n: 1 | 2 | 3): Promise<void> {
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  const button = page.getByTestId(`step3-arena-${n}`);
  await expect(button, `the sandbox menu has step3-arena-${n}`).toBeVisible();
  await button.click();
  await expect(page.getByTestId('menu')).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

/** No newcomers, nobody walks, touches do not hurt — journalled commands only, so the fight replays in Node. */
async function quiet(page: Page, extra: [string, unknown][] = []): Promise<void> {
  await page.evaluate(extra => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ...extra] as const) rt.setParam(k, v);
  }, extra);
}

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The chain with the real mouse over the bodies `ids` in turn; `release` — let go (the dash). */
async function drawChain(page: Page, ids: number[], release = true): Promise<void> {
  const at = async (id: number): Promise<{ x: number; y: number }> => {
    const e = (await snap(page)).enemies.find(q => q.id === id)!;
    return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const);
  };
  const p0 = await at(ids[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const id of ids.slice(1)) { const p = await at(id); await page.mouse.move(p.x, p.y, { steps: 6 }); }
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
  if (release) await page.mouse.up();
}

const place = (page: Page, x: number, y: number, color: number, hp: number, kind = 'basic'): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

/** Waits (game time) for the next landing of a pot after `lands0` landings; the mark must stand in every frame of the flight. */
async function flight(page: Page, lands0: number): Promise<void> {
  await page.evaluate(() => { (window as any).__g3bad = false; });
  await untilFrame(page, (sn, lands0: number, late) => {
    const g = sn.garrison;
    if (g.pots > 0 && g.marks !== 1) (window as any).__g3bad = true;
    return g.lands > lands0 || late ? g.lands : undefined;
  }, lands0, 12);
  expect(await page.evaluate(() => (window as any).__g3bad), 'the mark stood in every frame of the flight').toBe(false);
}

test('task 59а view: «Смолокур (проба)» — the mark stands the whole flight; the hero who walks off by the keys keeps his HP, the one who stands loses 1; the pool slows him', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openProbe(page, 1);
  await quiet(page);
  // The first throw: the pot over the pitcher in the windup, then the pot in the air with its mark.
  await untilFrame(page, (sn, _a, late) => sn.garrison.windups > 0 || late ? sn.garrison.windups : undefined, null, 12);
  expect((await snap(page)).garrison.windups).toBeGreaterThan(0);
  await shot(page, 'windup');
  const air = await untilFrame(page, (sn, _a, late) => sn.garrison.pots > 0 || late ? sn.garrison.pots : undefined, null, 6);
  expect(air).toBe(1);
  expect((await snap(page)).garrison.marks).toBe(1);
  await shot(page, 'flight');
  // Off the mark by the keys: the mark was fixed at the throw.
  const hp0 = (await snap(page)).hero.hp;
  await page.keyboard.down('KeyD');
  await flight(page, 0);
  await page.keyboard.up('KeyD');
  const missed = await snap(page);
  expect(missed.hero.hp).toBe(hp0);
  expect(missed.garrison.heroHits).toBe(0);
  expect(missed.garrison.pools).toBe(1);
  expect(missed.garrison.sounds.throws).toBe(1);
  expect(missed.garrison.sounds.lands).toBe(1);
  await shot(page, 'pool');
  // The second throw: standing still, the hero takes the pot.
  await flight(page, 1);
  const hit = await snap(page);
  expect(hit.hero.hp).toBe(hp0 - 1);
  expect(hit.garrison.heroHits).toBe(1);
  await expect.poll(async () => (await snap(page)).garrison.heroInPitch).toBe(1);
  expect((await snap(page)).garrison.drops).toBeGreaterThan(0);
  await shot(page, 'hero-in-pitch');
  // In the pool he walks slower than out of it (×0.6).
  const walk = async (): Promise<number> => {
    const x0 = (await snap(page)).hero.x;
    await page.keyboard.down('KeyA');
    await gameWait(page, 0.3);
    await page.keyboard.up('KeyA');
    return Math.abs((await snap(page)).hero.x - x0);
  };
  const inPool = await walk();
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [3, 3] as const);
  await gameWait(page, 0.2);
  const onGround = await walk();
  expect(inPool).toBeLessThan(onGround * 0.8);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 59а view: «Смолокур (проба)» — a chain with «Огненный проход» across a pool: its fiery rim in the highlight, the flame after the pass', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openProbe(page, 1);
  await quiet(page, [['pitchReload', 1000]]);
  await page.evaluate(() => (window as any).__realtime.useBuild({ hammer: 'fire-pass' }, 5));
  await quiet(page, [['pitchReload', 1000]]);
  await flight(page, 0);
  await expect.poll(async () => (await snap(page)).garrison.pools).toBe(1);
  const pool = (await snap(page)).garrison.poolAt[0];
  // Three weak links across the pool (the hero 3 west of its centre, as the Node check lays them).
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [pool.x - 3, pool.y] as const);
  const ids = [await place(page, pool.x - 1.6, pool.y, 0, 0), await place(page, pool.x - 0.2, pool.y, 0, 0), await place(page, pool.x + 1.2, pool.y, 0, 0)];
  await drawChain(page, ids, false);
  await expect.poll(async () => (await snap(page)).garrison.poolFire).toBe(1);
  await shot(page, 'plan-fire-rim');
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).garrison.ignites).toBe(1);
  await expect.poll(async () => (await snap(page)).garrison.burning).toBe(1);
  expect((await snap(page)).garrison.sounds.ignites).toBe(1);
  await shot(page, 'pool-burning');
  await untilFrame(page, (sn, _a, late) => sn.garrison.burning === 0 || late ? sn.garrison.burning : undefined, null, 5);
  expect((await snap(page)).garrison.pools).toBe(0);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 59а view: «Новобранцы (проба)» — a press on №2 is «не по порядку» and starts nothing; a chain 1 → 4 by the mouse: the line falls, +2 energy', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openProbe(page, 2);
  await quiet(page);
  await expect.poll(async () => (await snap(page)).garrison.recruits.numbers).toBe(4);
  const s0 = await snap(page);
  expect(s0.garrison.recruits.current).toBe(1);
  expect(s0.garrison.recruits.currentNumber).toBe(1);
  const line = s0.enemies.filter(e => e.kind === 'recruit').sort((a, b) => a.vars.rn - b.vars.rn);
  expect(line.map(e => e.vars.rn)).toEqual([1, 2, 3, 4]);
  await shot(page, 'recruits-line');
  // The cursor on №2: the refusal's words at it; a press starts no chain.
  const two = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [line[1].x, line[1].y] as const);
  await page.mouse.move(two.x, two.y);
  await expect.poll(async () => (await snap(page)).hint).toBe('order');
  await expect(page.locator('.rt-hint')).toHaveText('не по порядку');
  await shot(page, 'recruits-refused');
  await page.mouse.down();
  expect((await snap(page)).chain).toEqual([]);
  await page.mouse.up();
  // 1 → 4: the number follows the chain, the line falls, the energy gains the bonus.
  const energy0 = (await snap(page)).energy;
  await drawChain(page, line.map(e => e.id), false);
  await expect.poll(async () => (await snap(page)).garrison.recruits.currentNumber).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).enemies.filter(e => e.kind === 'recruit').length).toBe(0);
  await expect.poll(async () => (await snap(page)).garrison.recruits.drills).toBe(1);
  expect((await snap(page)).energy).toBeGreaterThanOrEqual(Math.min(7, energy0 + 2));
  await shot(page, 'recruits-drill');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 59а view: «Привратники (проба)» — a chain into one: the red ring «гнев будет», then the anger and «Размах»; a new fight, a chain through 6 of colour A to the pair: both fall, the keys burn gold, no ring', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openProbe(page, 3);
  await quiet(page);
  await expect.poll(async () => (await snap(page)).garrison.wardens.keys).toBe(2);
  await shot(page, 'wardens-pair');
  // The probe (sim/arenasStep3.ts): the pair above four columns of five weak enemies, one colour each (x 7.6, 8.8, 10, 11.2; the tops at y 5.2).
  const COLUMNS = [7.6, 8.8, 10, 11.2];
  const pairOf = async (): Promise<Snap['enemies']> => (await snap(page)).enemies.filter(e => e.kind === 'warden').sort((x, y) => x.x - y.x);
  const [a] = await pairOf();
  // Kill one of the pair: the top of A's column, then A (the hero stands between the columns, at the top).
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [COLUMNS[a.color] + 0.6, 5.7] as const);
  const top = (await snap(page)).enemies.find(e => e.kind === 'basic' && Math.abs(e.x - COLUMNS[a.color]) < 0.2 && Math.abs(e.y - 5.2) < 0.3)!;
  await drawChain(page, [top.id, a.id], false);
  await expect.poll(async () => (await snap(page)).garrison.wardens.warn).toBe(1);
  await shot(page, 'wardens-warn');
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).garrison.wardens.anger).toBe(1);
  expect((await snap(page)).garrison.wardens.starts).toBe(1);
  expect((await snap(page)).garrison.sounds.keys).toBe(1);
  await shot(page, 'wardens-anger');
  await untilFrame(page, (sn, _a, late) => sn.garrison.wardens.swings > 0 || late ? sn.garrison.wardens.swings : undefined, null, 4);
  expect((await snap(page)).garrison.wardens.swings).toBe(1);
  await shot(page, 'wardens-swing');
  await sameHash(page);
  // A new fight: both in one chain through the colour freed by «Смена цвета».
  await page.evaluate(() => (window as any).__realtime.restart());
  await quiet(page, [['colorShiftLinks', 6]]); // the sandbox has 0; the run's 6
  await expect.poll(async () => (await snap(page)).garrison.wardens.keys).toBe(2);
  const pair = await pairOf();
  // Five links of A's column from the bottom up, A, then B (the colour is free from the sixth link on).
  const column = (await snap(page)).enemies.filter(e => e.kind === 'basic' && Math.abs(e.x - COLUMNS[pair[0].color]) < 0.2).sort((x, y) => y.y - x.y);
  expect(column.length).toBe(5);
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [COLUMNS[pair[0].color] + 0.6, 10.2] as const);
  await drawChain(page, [...column.map(e => e.id), pair[0].id, pair[1].id], false);
  await expect.poll(async () => (await snap(page)).garrison.wardens.gold).toBe(2);
  expect((await snap(page)).garrison.wardens.warn).toBe(0);
  await shot(page, 'wardens-gold');
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).enemies.filter(e => e.kind === 'warden').length).toBe(0);
  expect((await snap(page)).garrison.wardens.starts).toBe(0);
  await sameHash(page);
  expect(errors).toEqual([]);
});
