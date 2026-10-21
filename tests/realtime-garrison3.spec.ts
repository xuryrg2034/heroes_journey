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
  poolAt: { id: number; x: number; y: number; burning: boolean }[]; markAt: { x: number; y: number }[]; potT: number[];
  recruits: { numbers: number; current: number; dim: number; bans: number; currentNumber: number; refused: number; drills: number; unlinks: number };
  wardens: { keys: number; gold: number; warn: number; anger: number; swings: number; starts: number; ends: number; hits: number };
  sounds: { throws: number; lands: number; ignites: number; keys: number };
  worldParams: { pitch?: boolean; pitchHeroSlow?: number; pitchEnemySlow?: number; crowdSlow?: number; heroThroughEnemies?: boolean; pitchLife?: number }; heroFactor: number; crowdFactor: number; inputX: number; near1: number;
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

/**
 * A fresh fight that is quiet from its first frame: the restart and the params in ONE task of the page (no frame between), so the
 * enemies do not creep towards the hero while the test is looking for them (the columns and the line moved 0.5 unit in the first
 * second, 2026-10-21 run pw-59a-2). Journalled commands only, so the fight replays in Node.
 */
async function freshQuiet(page: Page, extra: [string, unknown][] = []): Promise<void> {
  await page.evaluate(extra => {
    const rt = (window as any).__realtime;
    rt.restart();
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ...extra] as const) rt.setParam(k, v);
  }, extra);
}

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The chain with the real mouse over the bodies `ids` in turn; `release` — let go (the dash). */
async function drawChain(page: Page, ids: number[], release = true, detour = false): Promise<void> {
  const at = async (id: number): Promise<{ x: number; y: number }> => {
    const e = (await snap(page)).enemies.find(q => q.id === id)!;
    return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const);
  };
  const p0 = await at(ids[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  let prev = p0;
  for (const id of ids.slice(1)) {
    const p = await at(id);
    // `detour`: below the bodies (towards the hero) and up to the target. A straight swipe that crosses the previous link steps the chain
    // back («навести на предпоследнее звено — шаг назад»): the recruits stand in a row and the numbers jump over each other.
    if (detour) { await page.mouse.move(prev.x, prev.y + 70, { steps: 4 }); await page.mouse.move(p.x, p.y + 70, { steps: 8 }); }
    await page.mouse.move(p.x, p.y, { steps: 4 });
    prev = p;
  }
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
  if (release) await page.mouse.up();
}

/**
 * The camera has come to rest on the hero (it glides after a teleport): the screen points of the bodies are read only then. A press placed
 * by a point read while the camera still moved landed on another body (pw v77, «Привратники»: the chain began on the pair's second).
 */
async function cameraSettled(page: Page): Promise<void> {
  const still = await untilFrame(page, (_snap, _arg: null, late, rt) => {
    const h = rt.snapshot().hero, s = rt.toScreen(h.x, h.y), w = window as any, last = w.__g3Cam;
    w.__g3Cam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__g3Cam.n >= 5 ? true : late ? false : undefined;
  }, null, 4);
  expect(still, 'the camera came to rest').toBe(true);
}

/** A hero's walk sampled in the page on every frame (`seconds` of game time with `key` down); the frames are what the test reasons from. */
interface WalkFrame { t: number; x: number; y: number; inPitch: number; pools: number; crowd: boolean; factor: number; cf: number; ix: number; near: number }
async function sampledWalk(page: Page, key: string, seconds: number): Promise<WalkFrame[]> {
  await page.evaluate(() => { (window as any).__g3walk = []; });
  await page.keyboard.down(key);
  const frames = await untilFrame(page, (sn, until: number, late) => {
    const w = window as any, log = w.__g3walk as WalkFrame[];
    if (!log.length || log[log.length - 1].t !== sn.time) log.push({ t: sn.time, x: sn.hero.x, y: sn.hero.y, inPitch: sn.garrison.heroInPitch, pools: sn.garrison.pools, crowd: !!sn.heroInCrowd, factor: sn.garrison.heroFactor, cf: sn.garrison.crowdFactor, ix: sn.garrison.inputX, near: sn.garrison.near1 });
    return log[0].t + until <= sn.time || late ? log : undefined;
  }, seconds, seconds + 5);
  await page.keyboard.up(key);
  return frames;
}
/**
 * The walk's speed over the frame pairs whose both ends are `inPitch` (a pool under the hero) or both outside (`false`): units per game second,
 * with the seconds and the pairs counted, and the pairs the crowd slowed (the sim's `crowdSlow` stacks with the pool).
 */
function walkSpeed(frames: readonly WalkFrame[], inPitch: boolean): { speed: number; seconds: number; pairs: number; crowd: number } {
  let dist = 0, seconds = 0, pairs = 0, crowd = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i], want = inPitch ? 1 : 0;
    if (a.inPitch !== want || b.inPitch !== want || b.t <= a.t) continue;
    // Only pairs with no crowd round the hero at either end: the crowd's ×crowdSlow stacks with the pool and is no part of the comparison.
    if (a.crowd || b.crowd) { crowd++; continue; }
    dist += Math.hypot(b.x - a.x, b.y - a.y); seconds += b.t - a.t; pairs++;
  }
  return { speed: seconds > 0 ? dist / seconds : 0, seconds, pairs, crowd };
}
/** The real length of a walk: the game seconds from the first to the last frame with the input on, and the enemies nearer than 1 at its start. */
function walkLength(frames: readonly WalkFrame[]): { seconds: number; near1AtStart: number } {
  const on = frames.filter(f => f.ix !== 0);
  return { seconds: on.length ? on[on.length - 1].t - on[0].t : 0, near1AtStart: on.length ? on[0].near : -1 };
}
const frameTable = (frames: readonly WalkFrame[]): string => frames.map(f => `t ${f.t.toFixed(3)} x ${f.x.toFixed(3)} y ${f.y.toFixed(3)} pitch ${f.inPitch} pools ${f.pools} crowd ${f.crowd ? 1 : 0} poolFactor ${f.factor} crowdFactor ${f.cf} inputX ${f.ix} near1 ${f.near}`).join('\n');

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
  // The pot in the frame at the middle of its flight (a share of 0.3–0.7), not at the moment the mark appears.
  await untilFrame(page, (sn, _a, late) => sn.garrison.potT.some((t: number) => t >= 0.3 && t <= 0.7) || late ? sn.garrison.potT.length : undefined, null, 3);
  expect((await snap(page)).garrison.potT.length).toBe(1);
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
  // In the pool he walks slower than out of it (×0.6). No more pots: the walk is measured on the frames of the page (the key goes down at
  // once, nothing is read around it), then, once the pool has dried, from the same point again — the same crowd, wall and camera, the pool
  // is the only difference. If the check fails, the frames are in its message: whether the hero stood in the pool and what slowed him.
  // No more pots, and no crowd: the pitcher has done its two throws, the field is cleared by the journalled `clear` (the pool stays).
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('pitchReload', 1000); rt.clear(false); });
  await gameWait(page, 0.5); // the hit's knock is over: the walk starts from a standing hero
  const spot = (await snap(page)).hero;
  const inFrames = await sampledWalk(page, 'KeyA', 0.3);
  const inPool = walkSpeed(inFrames, true);
  await untilFrame(page, (sn, _a, late) => sn.garrison.pools === 0 || late ? sn.garrison.pools : undefined, null, 6);
  expect((await snap(page)).garrison.pools, 'the pool dried').toBe(0);
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [spot.x, spot.y] as const);
  await gameWait(page, 0.2);
  const outFrames = await sampledWalk(page, 'KeyA', 0.3);
  const onGround = walkSpeed(outFrames, false);
  const wp = (await snap(page)).garrison.worldParams;
  const report = `walks: in the pool ${JSON.stringify(walkLength(inFrames))}, on the ground ${JSON.stringify(walkLength(outFrames))}
`+`opened by the menu button step3-arena-1, then setParam (no restart); world params ${JSON.stringify(wp)}
in the pool ${JSON.stringify(inPool)}, on the ground at the same spot ${JSON.stringify(onGround)}
-- in the pool, frames:
${frameTable(inFrames)}
-- on the ground, frames:
${frameTable(outFrames)}`;
  // The same lines go to the plain log of a passing run too (the numbers of the walk, the world's pitch numbers).
  console.log(`garrison3 pool walk: ${report.split('\n').slice(0, 3).join(' | ')}
in the pool ${JSON.stringify(inPool)}, on the ground ${JSON.stringify(onGround)}`);
  expect(inPool.pairs, `the hero walked in the pool on some frames
${report}`).toBeGreaterThan(2);
  expect(onGround.pairs, `the control walked out of the pool on some frames
${report}`).toBeGreaterThan(2);
  expect(inPool.speed, report).toBeLessThan(onGround.speed * 0.8);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 59а view: «Смолокур (проба)» — the mark of the fall is drawn in every frame of the flight, from the throw to the blow. The pitcher off the screen is proved in Node (garrison3View.spec.ts): the 18×12 arena of the probe is larger than the field, but the camera keeps the pitcher in view here', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openProbe(page, 1);
  await quiet(page);
  // Every throw of two (design 21.10.2026): from the frame the pot flies to the frame it lands, one mark at the hero's point of the throw, in the view.
  for (const lands0 of [0, 1]) {
    await page.evaluate(() => { (window as any).__g3bad = ''; });
    await untilFrame(page, (sn, lands0: number, late) => {
      const g = sn.garrison, w = window as any;
      if (g.pots > 0 && (g.marks !== 1 || g.markAt.length !== 1)) w.__g3bad = `pots ${g.pots}, marks ${g.marks}`;
      return g.lands > lands0 || late ? g.lands : undefined;
    }, lands0, 14);
    expect(await page.evaluate(() => (window as any).__g3bad), 'a mark in every frame of the flight').toBe('');
    expect((await snap(page)).garrison.lands).toBe(lands0 + 1);
  }
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
  await cameraSettled(page);
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
  await freshQuiet(page);
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
  await drawChain(page, line.map(e => e.id), false, true);
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
  await freshQuiet(page);
  await expect.poll(async () => (await snap(page)).garrison.wardens.keys).toBe(2);
  await shot(page, 'wardens-pair');
  // The probe (sim/arenasStep3.ts): the pair above four columns of five weak enemies, one colour each (x 7.6, 8.8, 10, 11.2; the tops at y 5.2).
  const COLUMNS = [7.6, 8.8, 10, 11.2];
  /** The weak enemies of A's column as they stand now (a column is found by its x, not by a fixed row): from the top down. */
  const columnOf = async (color: number): Promise<Snap['enemies']> => (await snap(page)).enemies.filter(e => e.kind === 'basic' && Math.abs(e.x - COLUMNS[color]) < 0.4).sort((x, y) => x.y - y.y);
  const pairOf = async (): Promise<Snap['enemies']> => (await snap(page)).enemies.filter(e => e.kind === 'warden').sort((x, y) => x.x - y.x);
  const [a] = await pairOf();
  // Kill one of the pair: the top of A's column, then A (the hero stands between the columns, at the top).
  const col = await columnOf(a.color);
  expect(col.length).toBe(5);
  const top = col[0];
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [COLUMNS[a.color] + 0.6, top.y + 0.5] as const);
  await cameraSettled(page);
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
  await freshQuiet(page, [['colorShiftLinks', 6]]); // the sandbox has 0; the run's 6
  await expect.poll(async () => (await snap(page)).garrison.wardens.keys).toBe(2);
  const pair = await pairOf();
  // Five links of A's column from the bottom up, A, then B (the colour is free from the sixth link on).
  const column = (await columnOf(pair[0].color)).reverse();
  expect(column.length).toBe(5);
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [COLUMNS[pair[0].color] + 0.6, column[0].y + 0.9] as const);
  await cameraSettled(page);
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
