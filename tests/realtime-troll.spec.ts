import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import {
  createRtRun, resolveArena, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick, rtChooseHabit, rtChooseHammer, rtChooseKnack, rtChooseTalisman, rtDieChoose,
  rtEnterNode, rtEventView, rtGiftView, rtRestHeal, rtShopLeave, serializeRtRun, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';

/**
 * Task 48 «Тролль», the view (design 16.10.2026, docs/design-notes/task-48-troll.md, 16 and 18): the forest's boss on its sandbox arena
 * («Босс — Тролль», ?arena=30) and in the run (the den branch's final). Real input at 1280×720: the player moves the mouse over the core
 * and draws chains with it. The rules are checked in Node (`npm run test:realtime-troll`, `npm run test:realtime-troll-view`); here what
 * the player meets: a click on the core outside the window is refused («вне окна»), after «Удар дубиной» a chain into the core takes a
 * plate (the glow and the whole-second count are there), a chain through the rock severs it, the signs of the moves are drawn, the boss bar,
 * the node card and the relic screen of three severed parts. Waits are in game time (tests/realtimeFrames.ts). Screenshots (spec 18) go
 * to $SHOT_DIR when it is set. Added 17.10.2026 by the ui session on branch ui/task-48.
 */
interface TrollShown {
  core: number; asleep: number; glow: number; count: string; edgeCount: string; sign: string; signProgress: number; strips: number; circles: number; rings: number; gateMarks: number; snoreArc: number;
  tail: number; weapons: number; flight: number; hits: number; sparks: number; severed: number; tailFalls: number; unlinks: number; crumbles: number; regrows: number; opens: number;
  chargeLanes: number; chargeStops: number; chargeStuck: number; chargeRun: number; stuckStars: number; dusts: number; impacts: number; pushes: number; farDrops: number;
}
interface EnemyShot { id: number; kind: string; x: number; y: number; color: number; hp: number; chill: number; armor: { plates: number; max: number } | null; partOf: number | null; vars: Record<string, number> }
interface Snap {
  arena: string; status: string; time: number; chain: number[]; moving: string | null; hint: string | null;
  hero: { x: number; y: number; hp: number };
  enemies: EnemyShot[];
  troll: TrollShown;
  bossBar: { visible: boolean; cells: number; filled: number; hp: number; plates: number; phaseAt: number; phase2: boolean; fading: boolean; grown: number };
  bossNames: string[];
  loop: { hintText: string | null };
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/troll-${name}.png` }); };
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const kindOf = (s: Snap, kind: string): EnemyShot | undefined => s.enemies.find(e => e.kind === kind);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The sandbox fight on the Troll's arena; the fight opens on the boss and holds its first tick for the camera's glide — the test's setup comes after it. */
async function openDen(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=30');
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('troll');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
}

/** A new fight on the same arena (journalled from its first tick); `plates` — the panel's `trollPlates` for it (2: phase 3 at once). */
async function restart(page: Page, plates?: number): Promise<void> {
  await page.evaluate(p => { const rt = (window as any).__realtime; if (p !== undefined) rt.params.trollPlates = p; rt.restart(); }, plates);
  await expect.poll(async () => (await snap(page)).status).toBe('playing');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
}

/** No newcomers, nobody walks, touches do not hurt — journalled commands only, so the fight replays in Node. */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(k, v);
  });
}

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The arena is larger than the screen: waits (frame by frame, in game time) until the screen point of an arena point holds still for 5 frames. */
async function cameraSettled(page: Page, at: { x: number; y: number }): Promise<void> {
  const still = await untilFrame(page, (_snap, p: { x: number; y: number }, late, rt) => {
    const s = rt.toScreen(p.x, p.y), w = window as any, last = w.__trollCam;
    w.__trollCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__trollCam.n >= 5 ? true : late ? false : undefined;
  }, at, 3);
  expect(still, 'the camera came to rest').toBe(true);
}

/** The hero goes to (x, y) (journalled) and the camera follows. */
async function heroTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [x, y] as const);
  await cameraSettled(page, { x, y });
}

/** Waits (game time) for the Troll's sign `move` to reach `progress`; the reading is the truth when the time is up. */
async function signAt(page: Page, move: string, progress: number, gameSeconds = 20): Promise<boolean> {
  return untilFrame(page, (s, arg: { move: string; progress: number }, late) => s.troll.sign === arg.move && s.troll.signProgress >= arg.progress ? true : late ? false : undefined, { move, progress }, gameSeconds);
}

/** Press at the first point and drag through the rest (each read just before the pointer goes there); the button stays held. */
async function drawChain(page: Page, points: (() => Promise<{ x: number; y: number }>)[]): Promise<void> {
  const first = await points[0]();
  await cameraSettled(page, first);
  const at0 = await screen(page, first.x, first.y);
  await page.mouse.move(at0.x, at0.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const p = await point(), at = await screen(page, p.x, p.y);
    await page.mouse.move(at.x, at.y, { steps: 6 });
  }
}

/** The hero stands again: the dash and its return run are over and the chain is gone. */
async function dashDone(page: Page): Promise<boolean> {
  return untilFrame(page, (s, _arg: null, late) => s.moving === null && s.chain.length === 0 ? true : late ? false : undefined, null, 12);
}

const enemyAt = (page: Page, id: number) => async (): Promise<{ x: number; y: number }> => (await snap(page)).enemies.find(e => e.id === id)!;

/**
 * A part severed by the player's own chains: weak links of the part's colour in a column below it, the chain drawn with the mouse into
 * the part; again with longer chains until it is gone (a plate takes the first blow). The core is frozen for `cold` s so no move runs.
 */
async function sever(page: Page, kind: string, cold = 8): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = await snap(page), part = kindOf(s, kind);
    if (!part) return;
    const core = kindOf(s, 'troll')!;
    await page.evaluate(([id, seconds]) => (window as any).__realtime.chill(id, seconds), [core.id, cold] as const);
    const n = Math.min(4, 2 + attempt), links = await page.evaluate(([part, n]) => {
      const rt = (window as any).__realtime;
      rt.teleport(part.x, part.y + n + 1.2);
      const ids: number[] = [];
      for (let i = n - 1; i >= 0; i--) ids.push(rt.place(part.x, part.y + 1 + i, part.color, 0, 'basic'));
      return ids;
    }, [part, n] as const);
    await drawChain(page, [...links.map(id => enemyAt(page, id)), enemyAt(page, part.id)]);
    await expect.poll(async () => (await snap(page)).chain.length).toBe(n + 1);
    await page.mouse.up();
    expect(await dashDone(page), 'the dash is over').toBe(true);
  }
}

test('task 48: the sandbox menu has «Тролль» (?arena=30); the fight opens on him — his drawing, the parts\' weapons, the tail, the boss bar', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('boss-arena-2')).toContainText('Берлога тролля');
  await page.goto('/?sandbox=1&arena=30');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('troll');
  // The glide's first moments: the camera stands on the Troll.
  await page.waitForFunction(() => (window as any).__realtime.camera().intro > 0.8, null, { polling: 'raf', timeout: 0 });
  await shot(page, 'open');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  const s = await snap(page);
  const core = kindOf(s, 'troll')!;
  expect(s.enemies.filter(e => e.partOf === core.id).map(e => e.kind).sort()).toEqual(['troll-club', 'troll-rock', 'troll-tail']);
  expect(core.armor).toMatchObject({ plates: 4, max: 4 });
  await expect.poll(async () => (await snap(page)).troll).toMatchObject({ core: 1, weapons: 3, tail: 1, glow: 0, asleep: 0 });
  // The boss bar: HP 2 and 4 plates — six cells; the line of phase 3 at 2 plates, not lit.
  await expect.poll(async () => (await snap(page)).bossBar).toMatchObject({ visible: true, cells: 6, hp: 2, plates: 4, phaseAt: 4, phase2: false });
  expect(errors).toEqual([]);
});

test('task 48: outside the window a click on the core is refused — «вне окна» at the cursor, no chain starts; the journal replays in Node to the page hash', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openDen(page, errors);
  await quiet(page);
  const s0 = await snap(page), core = kindOf(s0, 'troll')!;
  // The club and the rock held (no move, no window): the core stays closed.
  await page.evaluate(([club, rock]) => { const rt = (window as any).__realtime; rt.chill(club, 600); rt.chill(rock, 600); }, [kindOf(s0, 'troll-club')!.id, kindOf(s0, 'troll-rock')!.id] as const);
  await heroTo(page, 11.4, 4.2);
  const at = await screen(page, core.x, core.y);
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await snap(page)).hint).toBe('outOfWindow');
  await expect(page.getByTestId('link-hint')).toHaveText('вне окна');
  expect((await snap(page)).loop.hintText).toBe('вне окна');
  expect((await snap(page)).troll.glow).toBe(0);
  await shot(page, 'refusal');
  // «Подошёл и закликал»: five presses on the core — no chain, no plate lost.
  for (let n = 0; n < 5; n++) {
    await page.mouse.down();
    expect((await snap(page)).chain, `press ${n}`).toEqual([]);
    await page.mouse.up();
    await gameWait(page, 0.2);
  }
  const s1 = await snap(page);
  expect(kindOf(s1, 'troll')!.armor!.plates).toBe(4);
  expect(kindOf(s1, 'troll')!.hp).toBe(2);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 48: after «Удар дубиной» the window is lit and counts whole seconds; a chain drawn with the mouse into the core takes a plate; the glow goes out after the dash', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openDen(page, errors);
  // Task 48 §25: this route is the sitting Troll's («Удар дубиной» at his spot, the core clicked where it sat) — the values without
  // `trollMove` (as a journal before it; the arena turns the walk on only when the key is off), a new fight with them.
  await page.evaluate(() => { delete (window as any).__realtime.params.trollMove; });
  await restart(page);
  await quiet(page);
  const s0 = await snap(page), core = kindOf(s0, 'troll')!;
  await page.evaluate(([rock]) => (window as any).__realtime.chill(rock, 600), [kindOf(s0, 'troll-rock')!.id] as const);
  // The hero in the club's reach: «Удар дубиной» winds up — its strip is drawn and fills; then the strike, the window.
  await heroTo(page, 12, 6.5);
  expect(await signAt(page, 'club', 0.5), 'the club\'s strip').toBe(true);
  expect((await snap(page)).troll).toMatchObject({ strips: 1, sign: 'club', glow: 0, count: '' });
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 3), [core.id] as const);
  await shot(page, 'club');
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 0), [core.id] as const);
  // The strike lands; the window opens — glow and the count «2» (1.5 s: the whole seconds), the club lies at the strip's end.
  const lit = await untilFrame(page, (s, _arg: null, late) => s.troll.glow === 1 ? { count: s.troll.count, hits: s.troll.hits, lie: s.enemies.find((e: any) => e.kind === 'troll-club').vars.lie ?? null } : late ? 'late' : undefined, null, 12);
  expect(lit, 'the window is lit').toMatchObject({ count: expect.stringMatching(/^[12]$/), hits: 1 });
  expect((lit as { lie: number | null }).lie, 'the club lies where it struck').not.toBeNull();
  // Held for the player's chain (the cold keeps the window): beside the core, press on it and drag a little.
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 20), [core.id] as const);
  await heroTo(page, 11.4, 4.2);
  const at = await screen(page, core.x, core.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 2, at.y + 2, { steps: 3 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([core.id]);
  expect((await snap(page)).troll.glow).toBe(1);
  await shot(page, 'window');
  await page.mouse.up();
  expect(await dashDone(page), 'the dash is over').toBe(true);
  const after = await snap(page);
  expect(kindOf(after, 'troll')!.armor!.plates, 'the plate is taken').toBe(3);
  await expect.poll(async () => (await snap(page)).troll.glow, 'the window went out after the dash').toBe(0);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 48 §25: «Рывок» led into a tree by real input — the lane to the stop with its impact mark, the hero steps off it (A), the run throws a body aside and raises dust, sticks with stars; a chain drawn with the mouse in the window takes a plate; the journal replays', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openDen(page, errors);
  await quiet(page);
  // The den walks (the arena turns `trollMove` on); a lane long enough to reach the tree at (19.5, 11.5) past the hero; the club and the
  // rock frozen — «Рывок» is the only move that opens.
  await page.evaluate(() => (window as any).__realtime.setParam('trollChargeLen', 14));
  const s0 = await snap(page), core = kindOf(s0, 'troll')!, hp0 = s0.hero.hp, plates0 = core.armor!.plates;
  await page.evaluate(([club, rock]) => { const rt = (window as any).__realtime; rt.chill(club, 600); rt.chill(rock, 600); }, [kindOf(s0, 'troll-club')!.id, kindOf(s0, 'troll-rock')!.id] as const);
  // The hero on the line from the core to the tree, 8.7 from the core: the charge opens.
  await heroTo(page, 17.5, 9);
  expect(await signAt(page, 'charge', 0.15), 'the lane of «Рывок»').toBe(true);
  const lane = await snap(page);
  expect(lane.troll).toMatchObject({ chargeLanes: 1, chargeStops: 1, chargeStuck: 1, chargeRun: 0 });
  // A body on the lane, between the core and the hero: the run throws it aside.
  const body = await page.evaluate(() => { const rt = (window as any).__realtime; return rt.place(14.2, 5.0, 0, 1, 'basic'); });
  await shot(page, 'charge-lane');
  // The real key A: the hero steps off the lane during the windup.
  await page.keyboard.down('KeyA');
  await untilFrame(page, (s, _a: null, late) => s.hero.x < 16 || late ? true : undefined, null, 2);
  await page.keyboard.up('KeyA');
  expect(await untilFrame(page, (s, _a: null, late) => s.troll.chargeRun === 1 && s.troll.dusts > 2 ? true : late ? false : undefined, null, 4), 'the run with dust').toBe(true);
  await shot(page, 'charge-run');
  expect(await untilFrame(page, (s, _a: null, late) => s.troll.pushes >= 1 ? true : late ? false : undefined, null, 4), 'the body thrown aside').toBe(true);
  await shot(page, 'charge-push');
  // Stuck: the stars; the cold on the core in that very frame keeps the window for the player's chain (a journalled command).
  expect(await untilFrame(page, (s, id: number, late, rt) => { if (s.troll.stuckStars === 1) { rt.chill(id, 20); return true; } return late ? false : undefined; }, core.id, 4), 'stuck: the stars').toBe(true);
  const stuck = await snap(page);
  expect(stuck.troll.impacts).toBe(1);
  expect(stuck.troll.pushes).toBeGreaterThanOrEqual(1);
  expect(stuck.enemies.some(e => e.id === body), 'the body thrown aside lives').toBe(true);
  expect(stuck.hero.hp, 'the hero off the lane is not struck').toBe(hp0);
  await shot(page, 'charge-stuck');
  // Held for the player's chain (the cold keeps the window): beside the core, press on it and drag a little.
  const at0 = kindOf(stuck, 'troll')!;
  await heroTo(page, at0.x - 1.1, at0.y - 1.0);
  expect((await snap(page)).troll.glow, 'the window is still open').toBe(1);
  const at = await screen(page, at0.x, at0.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 2, at.y + 2, { steps: 3 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([at0.id]);
  await page.mouse.up();
  expect(await dashDone(page), 'the dash is over').toBe(true);
  expect(kindOf(await snap(page), 'troll')!.armor!.plates, 'the plate is taken in the window').toBe(plates0 - 1);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 48: a chain through the rock severs it (the drawing falls off), the core loses a plate; phase 2 — «Рык» shows its circles at the lairs, «Хвост метёт» its ring', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openDen(page, errors);
  await quiet(page);
  await sever(page, 'troll-rock', 6);
  const s = await snap(page), core = kindOf(s, 'troll')!;
  expect(kindOf(s, 'troll-rock'), 'the rock is severed').toBeUndefined();
  expect(core.armor!.plates, 'the core lost a plate after the dash').toBe(3);
  expect(s.troll).toMatchObject({ severed: 1, weapons: 2 });
  // The club and the tail left: «Рык» (phase 2 at once) after the cold, the circles at the three lairs, closing like a clock.
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 600), [kindOf(s, 'troll-club')!.id] as const);
  await heroTo(page, 12, 4.4);
  expect(await signAt(page, 'roar', 0.5, 25), 'the roar\'s circles').toBe(true);
  expect((await snap(page)).troll.gateMarks).toBe(3);
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 8), [core.id] as const);
  await shot(page, 'roar');
  await gameWait(page, 8.2);
  expect(await signAt(page, 'tail', 0.5, 40), 'the tail\'s ring').toBe(true);
  expect((await snap(page)).troll).toMatchObject({ rings: 1, sign: 'tail' });
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 8), [core.id] as const);
  await shot(page, 'tail');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 48: «Бросок камня» — the circle at the hero, the rock in the air for the last 0.4 s; the name of the move once at its sign', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openDen(page, errors);
  await quiet(page);
  const s0 = await snap(page);
  await page.evaluate(([club]) => (window as any).__realtime.chill(club, 600), [kindOf(s0, 'troll-club')!.id] as const);
  await heroTo(page, 12, 9);
  // The name is a label of one real second from the sign's start — read in the frame it shows (a later read under load misses it).
  const named = await untilFrame(page, (sn, _arg: null, late) => sn.troll.sign === 'rock' && sn.bossNames.includes('Бросок камня') ? true : late ? false : undefined, null, 20);
  expect(named, '«Бросок камня» is named at its sign').toBe(true);
  expect(await signAt(page, 'rock', 0.4, 20), 'the rock\'s circle').toBe(true);
  expect((await snap(page)).troll).toMatchObject({ circles: 1, sign: 'rock' });
  const air = await untilFrame(page, (s, _arg: null, late) => s.troll.flight === 1 ? true : late ? false : undefined, null, 12);
  expect(air, 'the rock flies').toBe(true);
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 8), [kindOf(s0, 'troll')!.id] as const);
  await shot(page, 'rock');
  expect(errors).toEqual([]);
});

test('task 48: two parts severed — phase 3: «Храп» (the sleeping drawing, the arc filling over the head); a chain into the sleeper crumbles the arc and no plate grows back', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await openDen(page, errors);
  await quiet(page);
  await sever(page, 'troll-rock', 7);
  await sever(page, 'troll-club', 9);
  const s = await snap(page), core = kindOf(s, 'troll')!;
  expect(kindOf(s, 'troll-club') || kindOf(s, 'troll-rock'), 'both are severed').toBeUndefined();
  expect(s.troll.severed).toBe(2);
  await shot(page, 'two-parts');
  // The bar: the line of phase 3 is lit.
  await expect.poll(async () => (await snap(page)).bossBar.phase2).toBe(true);
  // The sleep: the drawing «спит», its name on his belly at the start (a label of one real second, so read in the frame), the arc fills
  // (the cold holds it for the shot).
  await heroTo(page, 11.4, 4.2);
  const named = await untilFrame(page, (sn, _arg: null, late) => sn.troll.asleep === 1 && sn.bossNames.includes('Храп') ? true : late ? false : undefined, null, 30);
  expect(named, 'the core sleeps, «Храп» is named').toBe(true);
  const asleep = await untilFrame(page, (sn, _arg: null, late) => sn.troll.asleep === 1 && sn.troll.snoreArc > 0.3 ? true : late ? false : undefined, null, 3);
  expect(asleep, 'the arc fills').toBe(true);
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 15), [core.id] as const);
  await shot(page, 'snore');
  // Struck in his sleep (the window is open all along): the arc crumbles, nothing grows back.
  const plates = kindOf(await snap(page), 'troll')!.armor!.plates;
  const at = await screen(page, core.x, core.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 2, at.y + 2, { steps: 3 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([core.id]);
  await page.mouse.up();
  expect(await dashDone(page), 'the dash is over').toBe(true);
  await expect.poll(async () => (await snap(page)).troll.crumbles).toBe(1);
  expect((await snap(page)).troll.regrows).toBe(0);
  expect(kindOf(await snap(page), 'troll')!.armor!.plates).toBeLessThanOrEqual(plates);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 48: «Храп» left alone — the arc fills for 4 s and a plate grows back (the bar cell fills with a lemon flash); the boss bar shows the line of phase 3', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openDen(page, errors);
  // 3 plates (`trollPlates` is the regrowth's ceiling too): the rock severed takes one — 2 plates, phase 3; the hero far in the corner,
  // out of every move.
  await restart(page, 3);
  await quiet(page);
  await sever(page, 'troll-rock', 6);
  await heroTo(page, 1.5, 14);
  await expect.poll(async () => (await snap(page)).bossBar).toMatchObject({ visible: true, cells: 5, plates: 2, phase2: true });
  expect(await untilFrame(page, (sn, _arg: null, late) => sn.troll.asleep === 1 ? true : late ? false : undefined, null, 20), 'the core sleeps').toBe(true);
  await shot(page, 'bar-phase3');
  await expect.poll(async () => (await snap(page)).troll.regrows, { timeout: 30_000 }).toBe(1);
  await expect.poll(async () => (await snap(page)).bossBar).toMatchObject({ cells: 5, plates: 3, grown: 1 });
  expect(kindOf(await snap(page), 'troll')!.armor).toMatchObject({ plates: 3, max: 3 });
  await sameHash(page);
  expect(errors).toEqual([]);
});

// ---- The run: the den branch's final, the node card, the relic screen of three severed parts ----

const RUN_KEY = 'ashen-oath-rt-run-v7';
function ok(step: RtRunStep): RtRunState { if (!step.ok) throw new Error(step.reason); return step.run; }

/** A run walked by its own commands (the den branch where there is a choice) until `stop` holds; null — never. */
function walk(stop: (run: RtRunState) => boolean): RtRunState | null {
  for (let k = 1; k < 40; k++) {
    let run: RtRunState = createRtRun(seedOf(k), { gift: 'mini' });
    for (let n = 0; n < 300 && !run.result; n++) {
      const p = run.pending;
      if (stop(run)) return run;
      if (p?.kind === 'battle') run = ok(resolveArena(run, { nodeId: p.nodeId, won: true, hp: run.hp, kills: 5, damage: 0, time: 30, bestChain: 2 }));
      else if (p?.kind === 'gift') {
        const view = rtGiftView(run)!;
        // Task 50: the gift's habit row first («Без повадки»).
        if (view.habit && !view.habit.chosen) run = ok(rtChooseHabit(run, null));
        else run = view.chosen !== null ? ok(rtChooseGiftPick(run, view.picks[0])) : ok(rtChooseGift(run, view.options.find(entry => entry.available)?.index ?? null));
      } else if (p?.kind === 'talisman') run = ok(rtChooseTalisman(run, null));
      else if (p?.kind === 'knack') run = ok(rtChooseKnack(run, null));
      else if (p?.kind === 'hammer') run = ok(rtChooseHammer(run, null));
      else if (p?.kind === 'die') run = ok(rtDieChoose(run, false));
      else if (p?.kind === 'find') run = ok(rtChooseFind(run, p.options.find(item => !rtItemRefusal(run, item)) ?? p.options[0]));
      else if (p?.kind === 'rest') run = ok(rtRestHeal(run));
      else if (p?.kind === 'shop') run = ok(rtShopLeave(run));
      else if (p?.kind === 'event') run = ok(rtChooseEventOption(run, rtEventView(run)!.options.find(option => option.safe && option.available)!.id));
      else if (!p) { const open = rtAvailableNodes(run); run = ok(rtEnterNode(run, (open.find(node => node.id.startsWith('den-')) ?? open[0]).id)); }
      else break;
    }
  }
  return null;
}

async function openSave(page: Page, save: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RUN_KEY, save] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('task 48: the map — the den branch\'s boss card says what the fight asks and counts the enemies of its start', async ({ page }) => {
  const errors = collectErrors(page);
  const run = walk(r => !r.pending && rtAvailableNodes(r).some(node => node.type === 'boss' && node.id.startsWith('den-')));
  if (!run) throw new Error('no run reached the den branch\'s boss');
  await openSave(page, serializeRtRun(run));
  await page.locator('[data-node^="den-"][data-type="boss"]').click();
  await expect(page.getByTestId('run-detail')).toContainText('Тролль: бой с боссом. Отруби лапы и хвост; бей в окно после удара.');
  await expect(page.getByTestId('run-danger-enemies')).toContainText('Враги: Тролль, дубина, камень, хвост');
  await shot(page, 'node-card');
  expect(errors).toEqual([]);
});

test('task 48: the run — the den branch\'s fight is the Troll\'s: it opens on him (v65 D2) and glides to the hero in 1.2 s; the boss bar (HP 2, plates 4), the drawing and the weapons; his name is the goal', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const run = walk(r => r.pending?.kind === 'battle' && r.pending.arena === 'troll');
  if (!run) throw new Error('no run reached the Troll\'s fight');
  // The page's clock is Playwright's (as the garrison's glide test): the glide's first frame is held for the shot, then the clock runs.
  const t0 = Date.parse('2026-10-17T12:00:00Z');
  await page.clock.install({ time: t0 });
  await page.clock.pauseAt(t0 + 1000);
  await openSave(page, serializeRtRun(run));
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect.poll(async () => (await snap(page)).arena).toBe('troll');
  await page.clock.runFor(50);
  // The first frames: the camera on the Troll — his core in the view under the boss bar, the fight at 0:00.
  const opening = await page.evaluate(() => {
    const rt = (window as any).__realtime, sn = rt.snapshot(), cam = rt.camera(), core = sn.enemies.find((e: any) => e.kind === 'troll');
    return { intro: cam.intro, time: sn.time, core: rt.toScreen(core.x, core.y) };
  });
  expect(opening.intro, 'the glide is on').toBeGreaterThan(1.0);
  expect(opening.time).toBeLessThan(0.02);
  const bar = (await page.getByTestId('boss-bar').boundingBox())!;
  expect(opening.core.y, 'the core in the view, under the boss bar').toBeGreaterThan(bar.y + bar.height);
  expect(opening.core.y, 'the core in the view').toBeLessThan(720);
  await shot(page, 'run-open');
  await page.clock.runFor(1300);
  await page.clock.resume();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  await expect(page.getByTestId('boss-bar')).toBeVisible();
  await expect.poll(async () => (await snap(page)).bossBar).toMatchObject({ visible: true, cells: 6, hp: 2, plates: 4 });
  await expect.poll(async () => (await snap(page)).troll).toMatchObject({ core: 1, weapons: 3, tail: 1 });
  await expect(page.getByTestId('goal')).toContainText('Тролль');
  await shot(page, 'run-bar');
  expect(errors).toEqual([]);
});

test('task 48: three parts severed — the final\'s relic screen offers four and says why', async ({ page }) => {
  const errors = collectErrors(page);
  const run = walk(r => r.pending?.kind === 'battle' && r.pending.arena === 'troll');
  if (!run) throw new Error('no run reached the Troll\'s fight');
  const nodeId = (run.pending as { nodeId: string }).nodeId;
  const won = ok(resolveArena(run, { nodeId, won: true, hp: run.hp, kills: 5, damage: 0, time: 30, bestChain: 2, parts: 3 }));
  await openSave(page, serializeRtRun(won));
  await expect(page.getByTestId('run-talisman')).toBeVisible();
  await expect(page.getByTestId('run-talisman')).toContainText('Тролль без лап и хвоста — на выбор четыре.');
  await expect(page.locator('[data-testid="run-talisman"] .rt-run-choice')).toHaveCount(4);
  // The cards come in one by one (task 47 reveal): the shot waits for the last.
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
  await shot(page, 'relic-4');
  expect(errors).toEqual([]);
});
