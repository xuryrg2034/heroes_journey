import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { leaveResult } from './realtimeResult';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 57а «Лес: стрелки», the view (design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 12): the slinger «Пращник», the hive
 * «Улей» and the wisp «Светляк» in the sandbox (`?sandbox=1&arena=1`, the row y = 5.8 is open, the kinds placed by the test hook: the run plays them only with
 * the run flag `forestShooters`, which is off until the arenas come). Real input at 1280×720: the mouse draws the chain (the focus slows
 * the world, so the short windows can be seen and photographed). The rules are the core's (`npm run test:realtime-forest-shooters`); the
 * drawing code is run against a real world in Node (`npm run test:realtime-shooters-view`). Here what the player meets: the slinger's
 * three lines fill during the windup, the stones fly, a stone on the hero costs 1 HP, a dash through the stones puts them out (a spark);
 * the hive's eight dots fill, eight wasps hang, a dash through the ring puts some out; the wisp lights, flies, stands still in the
 * drawn chain, is killed by it, dims and goes out on its own; the first meeting's caption of each kind (П8). The journal of each fight
 * replays in Node to the page hash. Waits are in game time (tests/realtimeFrames.ts); screenshots go to $SHOT_DIR when it is set.
 */
const SLINGER_CAPTION = 'Пращник — три камня веером: шагни между линиями';
const HIVE_CAPTION = 'Улей — кольцо ос: встань в просвет или подойди вплотную';
const WISP_CAPTION = 'Светляк — летит за тобой: возьми в цепь его цвета';

interface Shown {
  lines: number; lineProgress: number; dots: number; swellProgress: number; shots: number; hanging: number; flying: number; stones: number; wasps: number;
  wispsLighting: number; wispsFlying: number; wispsFading: number; wispsHeld: number; wispLight: number; snuffs: number; fades: number; blocks: number; hits: number; ends: number; wispOuts: number; looses: number;
}
interface Snap {
  status: string; time: number; chain: number[]; moving: string | null; kills: number;
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; color: number; vars: Record<string, number> }[];
  shots: { id: number; kind: string; x: number; y: number; hang: number }[];
  shooters: Shown;
  captions: { texts: string[]; live: number };
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page): Promise<void> {
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

/**
 * Only what the test places acts: no newcomers, bodies stand, touches do not hurt, a wide focus and a hero far from the edges, at the
 * arena's centre — journalled commands, so the fight replays in Node.
 */
async function quiet(page: Page, extra: [string, unknown][] = [], at: { x: number; y: number } = { x: 9, y: 5.8 }): Promise<{ x: number; y: number }> {
  await page.evaluate(({ more, p }) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['focusMax', 12], ...more] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(p.x, p.y);
  }, { more: extra, p: at });
  return at;
}
const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The screen point of a body now. */
async function screenOf(page: Page, id: number): Promise<{ x: number; y: number }> {
  return page.evaluate(i => { const rt = (window as any).__realtime, e = rt.snapshot().enemies.find((b: any) => b.id === i); return rt.toScreen(e.x, e.y); }, id);
}
/** The chain with the real mouse over the bodies `ids` in turn; the button stays down (the focus slows the world). */
async function holdChain(page: Page, ids: number[]): Promise<void> {
  const p0 = await screenOf(page, ids[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const id of ids.slice(1)) { const p = await screenOf(page, id); await page.mouse.move(p.x, p.y, { steps: 6 }); }
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
}
const releaseChain = (page: Page): Promise<void> => page.mouse.up();

test('task 57а view: the slinger — three lines fill during the windup, three stones fly, the one that meets the hero costs 1 HP and leaves a spark; the journal replays', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['slingWindup', 1.5]]);
  const sling = await place(page, hero.x - 5, hero.y, 1, 0, 'slinger');
  expect(sling).toBeGreaterThan(0);
  // The first windup begins 1.5 s after it appears; the three lines are drawn, filling.
  const early = await untilFrame(page, (s, _a: number, late) => s.shooters.lines === 3 && s.shooters.lineProgress > 0.25 || late ? { lines: s.shooters.lines, p: s.shooters.lineProgress } : undefined, 0, 6);
  expect(early.lines).toBe(3);
  await shot(page, 'slinger-windup');
  const first = (await snap(page)).shooters.lineProgress;
  await expect.poll(async () => (await snap(page)).shooters.lineProgress).toBeGreaterThan(first);
  await untilFrame(page, (s, _a: number, late) => s.shooters.flying === 3 || late ? true : undefined, 0, 4);
  const air = await snap(page);
  expect(air.shooters.lines).toBe(0);
  expect(air.shooters.stones).toBe(3);
  expect(air.shots.filter(s => s.kind === 'stone' && s.hang === 0)).toHaveLength(3);
  await shot(page, 'slinger-stones-flight');
  // The hero stands on the middle line: a stone meets him (−1 HP), the spark is shown.
  await untilFrame(page, (s, _a: number, late) => s.shooters.hits > 0 || late ? true : undefined, 0, 4);
  const hit = await snap(page);
  expect(hit.shooters.hits).toBeGreaterThanOrEqual(1);
  expect(hit.hero.hp).toBeLessThan((await page.evaluate(() => (window as any).__realtime.params.heroHp)) as number);
  await shot(page, 'slinger-hit');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 57а view: a dash across the stones puts them out (`snuffShots`) — a spark each, no HP lost; the journal replays', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['slingWindup', 1.5], ['snuffShots', true], ['focusSlow', 0.1]]);
  const hp0 = (await snap(page)).hero.hp;
  // Two links of one colour on the middle line between the slinger and the hero.
  const a = await place(page, hero.x - 1.6, hero.y, 2, 0, 'basic'), b = await place(page, hero.x - 3.2, hero.y, 2, 0, 'basic');
  // The chain is drawn at once (the bodies drift apart if left alone) and held: the focus slows the world while the lines fill and the
  // stones leave; the dash goes along the stones' line.
  await holdChain(page, [a, b]);
  await place(page, hero.x - 5.6, hero.y, 1, 0, 'slinger');
  await untilFrame(page, (s, _a: number, late) => s.shooters.lines === 3 || late ? true : undefined, 0, 6);
  expect((await snap(page)).shooters.lines).toBe(3);
  // The dash must meet the stones: let them fly up to the far link, then release (the dash only puts out what it touches while it runs).
  await untilFrame(page, (s, nearX: number, late) => s.shots.length === 3 && s.shots.every((x: any) => x.hang === 0 && x.x > nearX) || late ? true : undefined, hero.x - 3.3, 6);
  expect((await snap(page)).shooters.stones).toBe(3);
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.shooters.snuffs > 0 || late ? true : undefined, 0, 4);
  const after = await snap(page);
  expect(after.shooters.snuffs).toBeGreaterThanOrEqual(1);
  await shot(page, 'snuff-spark');
  await untilFrame(page, (s, _a: number, late) => !s.moving || late ? true : undefined, 0, 6);
  expect((await snap(page)).hero.hp).toBe(hp0);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 57а view: the hive — eight dots fill during the swell, eight wasps hang, a dash through the ring puts some out; the journal replays', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['hiveSwell', 0.8], ['snuffShots', true]], { x: 4.5, y: 5.8 });
  // Two links of one colour on both sides of the hive, on the line from the hero (the link reach is about 2.3 from body to body).
  const a = await place(page, hero.x + 2.1, hero.y, 2, 0, 'basic'), b = await place(page, hero.x + 4.3, hero.y, 2, 0, 'basic');
  // The chain is drawn at once and held through the swell (the focus slows the world), so that the ring can be seen and photographed.
  await holdChain(page, [a, b]);
  const hive = await place(page, hero.x + 3.2, hero.y, 1, 2, 'hive');
  expect(hive).toBeGreaterThan(0);
  // The first swell begins 2 s after it appears: the dots fill.
  const swell = await untilFrame(page, (s, _a: number, late) => s.shooters.dots === 8 && s.shooters.swellProgress > 0.35 || late ? { dots: s.shooters.dots, p: s.shooters.swellProgress } : undefined, 0, 6);
  expect(swell.dots).toBe(8);
  await shot(page, 'hive-swell');
  await untilFrame(page, (s, _a: number, late) => s.shooters.hanging === 8 || late ? true : undefined, 0, 6);
  const hang = await snap(page);
  expect(hang.shooters.hanging).toBe(8);
  expect(hang.shooters.wasps).toBe(8);
  // The hang lasts 0.3 s of game time: the real key P holds the world still for the photograph, then the dash goes.
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().paused))).toBe(true);
  await shot(page, 'hive-wasps-hang');
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().paused))).toBe(false);
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.shooters.snuffs > 0 || late ? true : undefined, 0, 4);
  await shot(page, 'hive-snuff');
  await untilFrame(page, (s, _a: number, late) => !s.moving || late ? true : undefined, 0, 6);
  expect((await snap(page)).shooters.snuffs).toBeGreaterThanOrEqual(1);
  await untilFrame(page, (s, _a: number, late) => (!s.moving && s.shooters.flying > 0) || late ? true : undefined, 0, 6);
  await shot(page, 'hive-wasps-flight');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 57а view: a chain that kills the hive while its wasps hang — they fade with it (a quiet puff, no snuff star); the journal replays', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['hiveSwell', 0.8], ['focusSlow', 0.1]], { x: 4.5, y: 5.8 });
  // The hive is close (1.8, the nearest it still shoots from is 1.5): the dash is short and the wasps still hang when it lands.
  const a = await place(page, hero.x + 0.9, hero.y, 1, 0, 'basic');
  const hive = await place(page, hero.x + 1.8, hero.y, 1, 2, 'hive');
  const hp0 = (await snap(page)).hero.hp;
  await holdChain(page, [a, hive]);
  await untilFrame(page, (s, _a: number, late) => s.shooters.hanging === 8 || late ? true : undefined, 0, 8);
  expect((await snap(page)).shooters.hanging).toBe(8);
  // The cold keeps a hanging pattern hanging while its shooter is frozen (a journalled command): the dash lands on the hung wasps whatever the delays.
  await page.evaluate(id => (window as any).__realtime.chill(id, 8), hive);
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.shooters.fades > 0 || late ? true : undefined, 0, 4);
  await shot(page, 'hive-fade');
  const end = await snap(page);
  expect(end.enemies.some(e => e.id === hive)).toBe(false);
  expect(end.shooters.fades).toBeGreaterThanOrEqual(1);
  expect(end.shooters.snuffs).toBe(0);
  expect(end.hero.hp).toBe(hp0);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 57а view: the wisp — the light grows, it flies, stands still in the drawn chain, dies to the chain; another dims and goes out on its own; the journal replays', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['wispLife', 3], ['focusSlow', 0.1]], { x: 8, y: 5.8 });
  // A pair of the wisp's colour to hold the chain by (the focus slows the world, so the light can be seen grow).
  const a = await place(page, hero.x + 1.4, hero.y - 1.0, 1, 0, 'basic'), b = await place(page, hero.x + 2.7, hero.y - 1.5, 1, 0, 'basic');
  await holdChain(page, [a, b]);
  const wisp = await place(page, hero.x + 3.8, hero.y - 2.4, 1, 0, 'wisp');
  await untilFrame(page, (s, _a: number, late) => s.shooters.wispLight > 0.6 || late ? true : undefined, 0, 2);
  expect((await snap(page)).shooters.wispsLighting).toBe(1);
  await shot(page, 'wisp-lighting');
  await untilFrame(page, (s, _a: number, late) => s.shooters.wispsFlying === 1 || late ? true : undefined, 0, 4);
  expect((await snap(page)).shooters.wispsFlying).toBe(1);
  await shot(page, 'wisp-flying');
  // The pointer goes over the wisp: it joins the chain (a link of its colour) and stands still, the light level, a ring round it.
  const pw = await screenOf(page, wisp);
  await page.mouse.move(pw.x, pw.y, { steps: 6 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a, b, wisp]);
  await untilFrame(page, (s, _a: number, late) => s.shooters.wispsHeld === 1 || late ? true : undefined, 0, 3);
  const held = await snap(page);
  expect(held.shooters.wispsHeld).toBe(1);
  const at = held.enemies.find(e => e.id === wisp)!;
  await shot(page, 'wisp-held');
  await untilFrame(page, (s, until: number, late) => s.time >= until || late ? true : undefined, held.time + 0.5, 3);
  const later = (await snap(page)).enemies.find(e => e.id === wisp)!;
  expect(Math.hypot(later.x - at.x, later.y - at.y)).toBeLessThan(1e-6);
  await releaseChain(page);
  await expect.poll(async () => (await snap(page)).enemies.some(e => e.id === wisp)).toBe(false);
  expect((await snap(page)).kills).toBe(3);
  // Another one is left alone: it dims in its last second and goes out (no damage, no kill).
  await expect.poll(async () => (await snap(page)).moving).toBeNull();
  await page.evaluate(() => (window as any).__realtime.setParam('focusSlow', 0.25));
  const hp = (await snap(page)).hero.hp, kills = (await snap(page)).kills;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [hero.x - 4, hero.y] as const);
  const outs = (await snap(page)).shooters.wispOuts;
  await place(page, hero.x + 3, hero.y, 2, 0, 'wisp');
  await untilFrame(page, (s, _a: number, late) => s.shooters.wispsFading === 1 || late ? true : undefined, 0, 6);
  expect((await snap(page)).shooters.wispsFading).toBe(1);
  await shot(page, 'wisp-fading');
  await untilFrame(page, (s, n: number, late) => s.shooters.wispOuts > n || late ? true : undefined, outs, 4);
  const end = await snap(page);
  expect(end.shooters.wispOuts).toBeGreaterThan(outs);
  expect(end.hero.hp).toBe(hp);
  expect(end.kills).toBe(kills);
  await sameHash(page);
  expect(errors).toEqual([]);
});

/** A new run of seed 11 on the map of run row 2 (the first-meeting captions need a run fight; tests/realtime-new-seen.spec.ts). */
async function freshRun(page: Page): Promise<void> {
  await page.goto('/?seed=11');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await skipHabit(page);
  await page.getByTestId('gift-0').click();
  const pick = page.locator('[data-action="gift-pick"]').first();
  if (await pick.count()) await pick.click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await leaveResult(page);
  await expect(page.getByTestId('node-r6c0')).toHaveAttribute('data-status', 'available');
}

test('task 57а view: the first meeting of each kind in a run fight gets its caption (П8), once; the sandbox shows none', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await freshRun(page);
  const nodes = page.locator('[data-status="available"]');
  await nodes.first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const placeKind = (kind: string): Promise<void> => page.evaluate(k => { const rt = (window as any).__realtime, h = rt.snapshot().hero; rt.place(h.x + 2.5, h.y, 1, 0, k); }, kind);
  const captions = async (): Promise<string[]> => (await snap(page)).captions.texts;
  for (const [kind, text] of [['slinger', SLINGER_CAPTION], ['hive', HIVE_CAPTION], ['wisp', WISP_CAPTION]] as const) {
    await placeKind(kind);
    await expect.poll(captions).toContain(text);
    if (kind === 'slinger') await shot(page, 'caption-slinger');
    if (kind === 'hive') await shot(page, 'caption-hive');
    if (kind === 'wisp') await shot(page, 'caption-wisp');
    await expect.poll(async () => (await snap(page)).captions.live, { timeout: 6_000 }).toBe(0);
  }
  // A second slinger of the same fight: nothing new.
  await placeKind('slinger');
  await page.waitForTimeout(400);
  expect((await captions()).filter(t => t === SLINGER_CAPTION)).toHaveLength(1);
  expect(errors).toEqual([]);
  // The sandbox: none.
  await openSandbox(page);
  await quiet(page);
  await place(page, 8, 7, 1, 0, 'slinger');
  await page.waitForTimeout(600);
  expect((await snap(page)).captions.texts).toEqual([]);
});

test('task 57а view: the three shooters side by side — their art over the disc of the colour (a snapshot)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['focusSlow', 0.1]], { x: 8, y: 5.8 });
  // Three colours, three kinds, in a row above the hero.
  const ids = [await place(page, hero.x - 2.5, hero.y - 2.2, 1, 0, 'slinger'), await place(page, hero.x, hero.y - 2.2, 2, 2, 'hive'), await place(page, hero.x + 2.5, hero.y - 2.2, 3, 0, 'wisp')];
  expect(ids.every(id => id > 0)).toBe(true);
  await untilFrame(page, (s, _a: number, late) => s.shooters.wispsLighting === 0 && s.shooters.hanging === 0 && s.time > 0.3 || late ? true : undefined, 0, 3);
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().paused))).toBe(true);
  await shot(page, 'all-three');
  await page.keyboard.press('KeyP');
  expect(errors).toEqual([]);
});
