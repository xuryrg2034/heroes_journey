import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gameWait, untilFrame } from './realtimeFrames';

/**
 * The prologue «Опушка» (src/realtime/view/prologueFlow.ts, prologueView.ts, run/prologue.ts; docs/realtime-onboarding.md, «Пролог:
 * вид и поток»): real input at 1280×720 — the mouse draws the chains, the keys walk. A new viewer (empty storage) plays ten rooms (task 9, task 13);
 * the test hook `__realtime.prologue.route()` only tells WHERE to drag (the stage pixels of the hand's chain), it sends nothing.
 * Uses plain `@playwright/test`: the other specs start with the key «пролог пройден» set (tests/realtimeTest.ts).
 *
 * - a new viewer lands in room 1 with the name «1/10 · Тропа» for 1.5 s, the lean HUD (HP and goal), the skip button;
 * - each room is passed by real input: chains (room 8 ends on the lever, room 9 «Щит» — chains of 3+ into the crowd, room 10 is a fight), room 5 «Пропасть» by Space and a click
 *   beyond the cliff, room 6 «Вихрь» by Q, room 7 «Зелье» by the potion's tile; each of 5–7 shows only its own tile, breathing;
 * - rooms 2 and 4: a shorter chain lights the lamps while it runs, they go out, the door stays closed;
 * - room 3: the tough one first survives; weak ones one by one — the enemies come back (smoke);
 * - the hand comes after 4 s without a press and goes on a press; with no chain from the hero's place: the arrow and the circle,
 *   the hand at once when the circle is reached;
 * - «Пропустить» → the run, the second launch has no prologue; the gear's «Обучение» plays it again; a death in room 10 → room 10 again.
 * Waits are in game time (tests/realtimeFrames.ts). Snapshots: artifacts/realtime-prologue-1.png … -10.png, -shield.png, -shield-hand.png, -hand.png, -arrow.png, -lamps.png, -jump-hand.png.
 */

const KEY = 'ashen-oath-realtime-prologue-done';
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const pro = async (page: Page): Promise<any> => (await snap(page)).prologue;
const frame = (page: Page): Promise<unknown> => page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

/** A new viewer: empty storage, the page loaded; the prologue starts by itself. */
async function newViewer(page: Page, errors: string[] = []): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.snapshot().prologue.active)).toBe(true);
}

/** Waits (game time) until the prologue plays room `n` with no fade going. */
async function inRoom(page: Page, n: number, seconds = 8): Promise<void> {
  const got = await untilFrame(page, (s, want: number) => s.prologue.active && s.prologue.room === want && !s.prologue.transition ? true : undefined, n, seconds + 4);
  expect(got).toBe(true);
}
const titleGone = async (page: Page): Promise<void> => {
  const got = await untilFrame(page, s => s.prologue.title === null ? true : undefined, 0, 4);
  expect(got).toBe(true);
};
interface Pt { x: number; y: number; kind: string; id: number }
const route = (page: Page): Promise<Pt[]> => page.evaluate(() => (window as any).__realtime.prologue.route());

/** Presses on the first link and drags over the next `count - 1` with the real mouse; releases unless told not to. */
async function drag(page: Page, pts: Pt[], count = pts.length, release = true): Promise<void> {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < count; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps: 8 });
  if (release) await page.mouse.up();
}

/** Walks the hero by the keys to `target` (arena units) until within `near`, or until `stop` says so. */
async function walkTo(page: Page, target: () => Promise<{ x: number; y: number }>, near = 0.25, stop: (s: any) => boolean = () => false, frames = 900): Promise<void> {
  const held = new Set<string>();
  const set = async (code: string, on: boolean) => { if (on && !held.has(code)) { held.add(code); await page.keyboard.down(code); } else if (!on && held.has(code)) { held.delete(code); await page.keyboard.up(code); } };
  try {
    for (let i = 0; i < frames; i++) {
      const s = await snap(page), t = await target();
      if (stop(s)) break;
      const dx = t.x - s.hero.x, dy = t.y - s.hero.y;
      if (Math.hypot(dx, dy) < near) break;
      await set('KeyD', dx > near * 0.6); await set('KeyA', dx < -near * 0.6); await set('KeyS', dy > near * 0.6); await set('KeyW', dy < -near * 0.6);
      await frame(page);
    }
  } finally { for (const code of [...held]) await set(code, false); }
}
const doorOf = async (page: Page): Promise<{ x: number; y: number }> => (await snap(page)).objects.find((o: any) => o.kind === 'door');

/** From an open door: walk in and wait for the next room (or the run). */
async function walkIn(page: Page, room: number): Promise<void> {
  await walkTo(page, () => doorOf(page), 0.2, s => !s.prologue.active || s.prologue.room !== room || !!s.prologue.transition);
}
/** The snapshot of the room's name moment: the fade is in, the name still on the screen. */
async function titleShot(page: Page, name: string): Promise<void> {
  expect(await untilFrame(page, sn => sn.prologue.fade < 0.02 && sn.prologue.title ? true : undefined, 0, 3)).toBe(true);
  await shot(page, name);
}
async function shot(page: Page, name: string): Promise<void> { await page.screenshot({ path: `artifacts/realtime-prologue-${name}.png` }); }

test('a new viewer plays the prologue: room 1 «1/10 · Тропа» for 1.5 s, only HP and the goal, the skip button, three lamps, the label at the nearest enemy', async ({ page }) => {
  const errors: string[] = [];
  await newViewer(page, errors);
  await inRoom(page, 1);
  const p = await pro(page);
  expect(p.title).toBe('1/10 · Тропа');
  expect(p.skipVisible).toBe(true);
  expect(p.lamps).toEqual({ lit: 0, total: 3 });
  expect(p.hud).toEqual({ energy: false, actionBar: false, score: false, focus: false, info: false });
  await expect(page.getByTestId('goal')).toHaveText('Убей: 0 / 3');
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('run')).toBeHidden();
  // The label at the place, the name on the screen.
  const labels = (await snap(page)).onboarding.labels;
  expect(labels.map((l: any) => l.text)).toEqual(['Зажми и веди']);
  // The calm room's enemies stand: a small «z» over each one in view (design 13.10.2026).
  expect((await snap(page)).sleepMarks).toBeGreaterThan(0);
  await expect(page.getByTestId('prologue-title')).toBeVisible();
  await shot(page, '1');
  // The name goes after 1.5 s of play; the label stays until the first link.
  await gameWait(page, 1.7);
  expect((await pro(page)).title).toBeNull();
  expect((await snap(page)).onboarding.labels.map((l: any) => l.text)).toEqual(['Зажми и веди']);
  expect(errors).toEqual([]);
});

test('room 1: one real chain of two links, then a second — three kills open the door, the label is gone with the first link, walking in leads to room 2 through the fade', async ({ page }) => {
  await newViewer(page);
  await inRoom(page, 1);
  await titleGone(page);
  const pts = await route(page);
  expect(pts.length).toBe(3);
  // A press on the first link takes the label away at once; the lamps follow the kills.
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  await page.mouse.move(pts[1].x, pts[1].y, { steps: 8 });
  expect((await snap(page)).onboarding.labels).toEqual([]);
  await page.mouse.up();
  await gameWait(page, 1.5);
  let p = await pro(page);
  expect(p.lamps).toEqual({ lit: 2, total: 3 });
  // The room has no return: the one left is killed by a second chain (the hand shows it, this is the real drag).
  const rest = await route(page);
  expect(rest.length).toBe(1);
  await drag(page, rest);
  await gameWait(page, 1.5);
  p = await pro(page);
  expect(p.lamps).toEqual({ lit: 3, total: 3 });
  await expect(page.getByTestId('goal')).toHaveText('Дверь открыта');
  await walkIn(page, 1);
  expect((await pro(page)).transition === 'next' || (await pro(page)).room === 2).toBe(true);
  await inRoom(page, 2);
  expect((await pro(page)).title).toBe('2/10 · Два цвета');
});

test('room 2: a chain of three blue lights the lamps while it runs, then they go out and the door stays closed; the enemies come back; the full chain of five opens it', async ({ page }) => {
  await newViewer(page);
  await goToRoom(page, 2);
  await titleShot(page, '2');
  await titleGone(page);
  const pts = await route(page);
  expect(pts.length).toBeGreaterThanOrEqual(5);
  await drag(page, pts, 3);
  const lit = await untilFrame(page, s => s.prologue.lamps.lit > 0 ? s.prologue.lamps.lit : undefined, 0, 3);
  expect(lit).toBeGreaterThan(0);
  expect(lit).toBeLessThan(5);
  await page.screenshot({ path: 'artifacts/realtime-prologue-lamps.png' });
  const out = await untilFrame(page, s => s.prologue.lamps.lit === 0 && s.prologue.guide.show === 'none' && !s.moving ? true : undefined, 0, 4);
  expect(out).toBe(true);
  const s = await snap(page);
  expect(s.stage).toBe('goals');
  expect(s.prologue.lamps).toEqual({ lit: 0, total: 5 });
  // About a second later the start enemies stand at their posts again, with smoke.
  const back = await untilFrame(page, (sn) => sn.enemies.length === 9 && sn.prologue.shown.smokesStarted > 0 ? true : undefined, 0, 4);
  expect(back).toBe(true);
  // The full chain.
  await gameWait(page, 0.3);
  const again = await route(page);
  await drag(page, again);
  await gameWait(page, 2);
  const done = await snap(page);
  expect(done.stage).toBe('greed');
  expect(done.prologue.lamps).toEqual({ lit: 5, total: 5 });
});

test('room 3: the tough one struck first survives (its HP drops), the enemies come back; the weak ones killed one by one come back too; the full chain with the tough one last kills it', async ({ page }) => {
  await newViewer(page);
  await goToRoom(page, 3);
  await titleShot(page, '3');
  await titleGone(page);
  // Weak ones one by one: a chain of one weak link.
  let pts = await route(page);
  expect(pts.length).toBe(4);
  await drag(page, pts, 1);
  const gone = await untilFrame(page, s => s.kills >= 1 ? true : undefined, 0, 3);
  expect(gone).toBe(true);
  const back = await untilFrame(page, s => s.enemies.length === 4 && s.prologue.shown.smokesStarted > 0 && s.enemies.find((e: any) => e.marked)?.hp === 4 ? true : undefined, 0, 5);
  expect(back).toBe(true);
  // The tough one first: the hero walks up to it (no chain can start on the far end) and strikes it alone.
  const tough = (s: any) => s.enemies.find((e: any) => e.marked);
  await walkTo(page, async () => tough(await snap(page)), 1.3);
  await gameWait(page, 0.3);
  const tp = (await page.evaluate(() => (window as any).__realtime.snapshot())).enemies.find((e: any) => e.marked);
  const at = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [tp.x, tp.y] as const);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  // The strike lands: the tough one is alive with less HP than the 4 it has (read in the frames of the dash).
  const hurt = await untilFrame(page, s => { const m = s.enemies.find((e: any) => e.marked); return m && m.hp > 0 && m.hp < 4 ? m.hp : undefined; }, 0, 4);
  expect(hurt).toBeGreaterThan(0);
  expect(hurt).toBeLessThan(4);
  const after = await snap(page);
  expect(after.stage).toBe('goals');
  // Back at the start: everyone with full HP; the full chain now.
  const fresh = await untilFrame(page, s => s.enemies.length === 4 && s.enemies.every((e: any) => !e.marked || e.hp === 4) && s.hero.x < 3 ? true : undefined, 0, 6);
  expect(fresh).toBe(true);
  pts = await route(page);
  if (!pts.length) { const spot = await page.evaluate(() => (window as any).__realtime.prologue.spotWorld()); expect(spot).toBeNull(); }
  expect(pts.length).toBe(4);
  await drag(page, pts);
  await gameWait(page, 2);
  const win = await snap(page);
  expect(win.stage).toBe('greed');
  expect(win.enemies.some((e: any) => e.marked), 'the tough one is dead').toBe(false);
  expect(win.prologue.lamps).toEqual({ lit: 1, total: 1 });
});

test('room 4: a chain of five lights five lamps and goes out; «Цвет свободен» stands at the 6th blue from the 5th link until the shift; nine through the colour shift open the door', async ({ page }) => {
  await newViewer(page);
  await goToRoom(page, 4);
  await titleGone(page);
  const pts = await route(page);
  expect(pts.length).toBe(10);
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < 4; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps: 6 });
  expect((await snap(page)).onboarding.labels).toEqual([]);
  await page.mouse.move(pts[4].x, pts[4].y, { steps: 6 });
  const labels = (await snap(page)).onboarding.labels;
  expect(labels.map((l: any) => l.text)).toEqual(['Цвет свободен']);
  await shot(page, '4');
  await page.mouse.up();
  await untilFrame(page, s => s.prologue.lamps.lit >= 1 ? true : undefined, 0, 3);
  const out = await untilFrame(page, s => s.prologue.lamps.lit === 0 && !s.moving ? true : undefined, 0, 5);
  expect(out).toBe(true);
  expect((await snap(page)).stage).toBe('goals');
  await untilFrame(page, s => s.enemies.length === 10 && s.prologue.shown.smokesStarted > 0 ? true : undefined, 0, 5);
  await gameWait(page, 0.3);
  const full = await route(page);
  expect(full.length).toBeGreaterThanOrEqual(9);
  await page.mouse.move(full[0].x, full[0].y);
  await page.mouse.down();
  for (let i = 1; i < full.length; i++) {
    await page.mouse.move(full[i].x, full[i].y, { steps: 6 });
    // The label is gone with the shift (the 6th link).
    if (i === 5) expect((await snap(page)).onboarding.labels).toEqual([]);
  }
  await page.mouse.up();
  await gameWait(page, 3);
  const done = await snap(page);
  expect(done.stage).toBe('greed');
  expect(done.prologue.lamps).toEqual({ lit: 9, total: 9 });
});

test('room 8: the goblin — the label at the lever until the first pull; the real chain of enemies ends on the lever; the pull opens the door', async ({ page }) => {
  test.setTimeout(180_000);
  await newViewer(page);
  await goToRoom(page, 8);
  await titleShot(page, '8');
  await titleGone(page);
  expect((await snap(page)).onboarding.labels.map((l: any) => l.text)).toEqual(['Закончи цепь здесь']);
  const pts = await route(page);
  expect(pts.length).toBeGreaterThanOrEqual(2);
  expect(pts[pts.length - 1].kind).toBe('object');
  await drag(page, pts);
  const pulled = await untilFrame(page, s => s.prologue.lamps.lit === 1 ? true : undefined, 0, 6);
  expect(pulled).toBe(true);
  expect((await snap(page)).onboarding.labels).toEqual([]);
  await gameWait(page, 0.5);
  await walkIn(page, 8);
  await inRoom(page, 9);
});

test('room 9 «Щит»: no action bar, the goal «Щит: 0 / 3»; the crowd sleeps until the first press — the hero keeps 15 HP; the hand after 1.5 s of rest draws a chain of 3+; a chain of two — the touch after it hurts, no lamp, no glow; a chain of 3+ — the hero glows, the touch is blocked (the «блок» spark), a spark flies to the lamp; three lamps open the door, the enemies sleep', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await newViewer(page, errors);
  await goToRoom(page, 9);
  await titleShot(page, '9');
  let p = await pro(page);
  expect(p.title).toBe('9/10 · Щит');
  expect(p.hud.actionBar).toBe(false);
  expect(p.lamps).toEqual({ lit: 0, total: 3 });
  await expect(page.getByTestId('goal')).toHaveText('Щит: 0 / 3');
  // The crowd sleeps until the first press (design 13.10.2026): the «z» marks, nobody walks, no touch hurts while the viewer waits.
  const start = await snap(page);
  expect(start.sleepMarks).toBeGreaterThan(0);
  // The hand: after 1.5 s without a press (not 4: room 9 only), a chain of 3+ through the crowd (no arrow, no text).
  const hand = await untilFrame(page, sn => sn.prologue.guide?.show === 'hand' ? sn : undefined, 0, 4);
  expect(hand.prologue.guide.links).toBeGreaterThanOrEqual(3);
  expect(hand.prologue.guide.arrow).toBe(false);
  expect(hand.prologue.guide.rest).toBeGreaterThanOrEqual(1.5);
  expect(hand.prologue.guide.rest, 'the hand at 1.5 s of rest, not 4').toBeLessThan(2.5);
  // Still asleep: full HP, the enemies where they stood.
  expect(hand.hero.hp).toBe(hand.hero.maxHp);
  expect(hand.hero.hp).toBe(15);
  const stood = (id: number) => start.enemies.find((e: any) => e.id === id);
  for (const e of hand.enemies) expect(Math.hypot(e.x - stood(e.id).x, e.y - stood(e.id).y), `enemy ${e.id} stands`).toBeLessThan(0.01);
  await titleGone(page);
  expect((await snap(page)).onboarding.labels).toEqual([]);
  // The shot when the hand has pressed and drags (it fades in at the press).
  await untilFrame(page, (_s, _a: null, late: boolean) => (late ? true : undefined), null, 0.9);
  await shot(page, 'shield-hand');
  // A chain of two (the first two links of the hand's chain): no shield — the touch after the dash hurts, no lamp lights.
  let pts = await route(page);
  expect(pts.length).toBeGreaterThanOrEqual(3);
  await drag(page, pts, 2);
  const after2 = await untilFrame(page, sn => !sn.moving && sn.kills >= 2 ? sn : undefined, 0, 3);
  expect(after2.hero.chainShield).toBe(0);
  const hurt = await untilFrame(page, (sn, hp: number) => sn.hero.hp < hp ? sn : (sn.prologue.lamps.lit > 0 || sn.chainShield.glow || sn.chainShield.blocks > 0 ? 'bad' : undefined), after2.hero.hp, 3);
  expect(hurt, 'a touch after a chain of two hurts').not.toBe('bad');
  expect(hurt.hero.hp).toBeLessThan(after2.hero.hp);
  expect(hurt.prologue.lamps.lit).toBe(0);
  await expect(page.getByTestId('goal')).toHaveText('Щит: 0 / 3');
  // The ring comes back (1 s after the dash); then a chain of 3+: the glow, the block, the lamp and the spark to it.
  await untilFrame(page, sn => sn.enemies.length === 9 && !sn.moving ? true : undefined, 0, 4);
  for (let tries = 0; tries < 6; tries++) {
    pts = await route(page);
    if (pts.length >= 3) break;
    await gameWait(page, 0.2);
  }
  expect(pts.length).toBeGreaterThanOrEqual(3);
  const hp = (await snap(page)).hero.hp;
  await drag(page, pts);
  const glow = await untilFrame(page, sn => sn.chainShield.glow ? sn : undefined, 0, 4);
  expect(glow.chainShield.left).toBeGreaterThan(0);
  const block = await untilFrame(page, sn => sn.chainShield.blocks > 0 ? sn : undefined, 0, 2);
  await shot(page, 'shield');
  expect(block.prologue.lamps.lit).toBe(1);
  expect(block.prologue.shown.lampSparks).toBe(1);
  expect(block.hero.hp, 'the blocked touch does not hurt').toBe(hp);
  await expect(page.getByTestId('goal')).toHaveText('Щит: 1 / 3');
  // The window ends: the glow goes, the ring and the hero come back.
  expect(await untilFrame(page, sn => !sn.chainShield.glow && sn.enemies.length === 9 ? true : undefined, 0, 3)).toBe(true);
  // Two more windows: the door opens, the enemies fall asleep — the «z» marks.
  await passShield(page);
  const open = await snap(page);
  expect(open.prologue.lamps).toEqual({ lit: 3, total: 3 });
  expect(open.prologue.shown.lampSparks).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('goal')).toHaveText('Дверь открыта');
  expect(await untilFrame(page, sn => sn.sleepMarks > 0 ? true : undefined, 0, 2)).toBe(true);
  await walkIn(page, 9);
  await inRoom(page, 10);
  expect(errors).toEqual([]);
});

test('room 10: energy and the action bar appear; Space and Q do not breathe (the player used them in rooms 5–6), 15 kills by real chains (jump by Space and a click, Q by its key) and the door end the prologue: the key is set, the run map follows', async ({ page }) => {
  test.setTimeout(540_000);
  const errors: string[] = [];
  await newViewer(page, errors);
  await goToRoom(page, 10);
  await titleShot(page, '10');
  let p = await pro(page);
  expect(p.hud.energy).toBe(true);
  expect(p.hud.focus).toBe(true);
  expect(p.hud.actionBar).toBe(true);
  // Design 13.10.2026: rooms 5 and 6 taught Space and Q (the prologue's memory of the use is not reset) — no pulse here.
  expect(p.pulse).toMatchObject({ space: false, q: false });
  expect(p.lamps.total).toBe(15);
  await expect(page.getByTestId('ability-jump')).toBeVisible();
  // The crowd is awake: no «z».
  expect((await snap(page)).sleepMarks).toBe(0);
  await titleGone(page);
  // The start energy is one jump: Space, then a click on free ground — the jump.
  const hero = (await snap(page)).hero;
  const landing = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [hero.x + 2.5, hero.y + 1] as const);
  await page.keyboard.press('Space');
  await page.mouse.move(landing.x, landing.y);
  await page.mouse.down(); await page.mouse.up();
  expect(await untilFrame(page, s => s.prologue.pulse.space === false ? true : undefined, 0, 4)).toBe(true);
  p = await pro(page);
  expect(p.pulse).toMatchObject({ space: false, q: false });
  // Real chains on what comes (the longest chain from the enemies in reach — 3 links and more bring the chain shield and the focus shield);
  // Q by its key when the chains have earned the energy and a crowd stands round the hero. A death plays the room again: the loop goes on
  // (up to 60 attempts; the waits end with the attempt, the world's clock starts anew).
  const settle = async (seconds: number): Promise<void> => {
    const attempt = (await pro(page)).attempt;
    await untilFrame(page, (sn, a: number) => sn.prologue.attempt !== a || sn.stage === 'greed' ? true : undefined, attempt, seconds);
  };
  let spun = false;
  while ((await pro(page)).room === 10 && (await pro(page)).attempt <= 60) {
    const s = await snap(page);
    if (s.status !== 'playing') { await page.waitForTimeout(100); continue; }
    if (s.stage === 'greed') { expect(s.kills, 'the 15 kills are the real chains\'').toBeGreaterThanOrEqual(15); await walkIn(page, 10); await page.waitForTimeout(300); continue; } // a hit on the way may end the attempt: the loop plays the room again; no game-time wait here — after the win the map is open and the world stands
    const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
    const reach = s.enemies.filter((e: any) => dist(e, s.hero) < 1.9);
    if (s.energy >= 3 && reach.length >= (spun ? 3 : 2)) {
      await page.keyboard.press('KeyQ');
      spun = true;
      await settle(0.6);
      expect((await pro(page)).pulse.q).toBe(false);
      continue;
    }
    if (!reach.length) { await settle(0.4); continue; }
    let best: any[] = [];
    for (const first of reach) {
      const chain = [first];
      for (let guard = 0; guard < 12; guard++) {
        const last = chain[chain.length - 1];
        const next = s.enemies.filter((e: any) => e.color === last.color && !chain.includes(e) && dist(e, last) < 1.8).sort((x: any, y: any) => dist(x, last) - dist(y, last))[0];
        if (!next) break;
        chain.push(next);
      }
      if (chain.length > best.length) best = chain;
    }
    const screens: { x: number; y: number }[] = [];
    for (const e of best) screens.push(await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const));
    await drag(page, screens.map((q, k) => ({ ...q, kind: 'enemy', id: best[k].id })));
    await settle(0.8);
  }
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(k => localStorage.getItem(k), KEY)).toBe('1');
  expect((await pro(page)).active).toBe(false);
  const log = (await pro(page)).log;
  expect(log.some((e: any) => e.type === 'end' && e.kind === 'done')).toBe(true);
});

test('the hand: after 4 s without a press it draws the chain over the enemies; a press takes it away; 4 s of rest bring it back', async ({ page }) => {
  await newViewer(page);
  await inRoom(page, 1);
  await titleGone(page);
  let p = await pro(page);
  expect(p.guide.show).toBe('none');
  await gameWait(page, 2);
  expect((await pro(page)).shown.hand).toBe(false);
  const shown = await untilFrame(page, s => s.prologue.shown.hand ? s.time : undefined, 0, 4);
  expect(typeof shown).toBe('number');
  // It came after the 4 s of rest (not before): the game clock at the start of the room was ≈ 0.
  expect(shown as number).toBeGreaterThanOrEqual(3.9);
  expect(shown as number).toBeLessThan(5.5);
  p = await pro(page);
  expect(p.guide.links).toBe(3);
  await gameWait(page, 1.5);
  await shot(page, 'hand');
  // A press on empty ground: the hand is gone at once.
  await page.mouse.move(60, 400);
  await page.mouse.down();
  await page.mouse.up();
  await frame(page); await frame(page);
  p = await pro(page);
  expect(p.guide.show).toBe('none');
  expect(p.shown.hand).toBe(false);
  await gameWait(page, 3);
  expect((await pro(page)).shown.hand).toBe(false);
  const back = await untilFrame(page, s => s.prologue.shown.hand ? true : undefined, 0, 3);
  expect(back).toBe(true);
  // The hand sent no command: the journal holds only the player's own presses.
  const journal = await page.evaluate(() => (window as any).__realtime.journal());
  expect(journal.commands.every((c: any) => ['begin', 'cancel', 'walk', 'sweep', 'drag', 'release'].includes(c.cmd.t))).toBe(true);
  expect(journal.commands.filter((c: any) => c.cmd.t === 'begin').length).toBe(1);
});

test('no chain from where the hero stands: after 4 s a pale arrow and a blinking circle (no text), the hand at once when the circle is reached', async ({ page }) => {
  await newViewer(page);
  await inRoom(page, 1);
  await titleGone(page);
  // Walk to the far corner, away from the arc.
  await walkTo(page, async () => ({ x: 0.8, y: 0.9 }), 0.3);
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
  const s0 = await snap(page);
  expect(await page.evaluate(() => (window as any).__realtime.prologue.route())).toEqual([]);
  expect(s0.prologue.guide.show).toBe('none');
  const arrow = await untilFrame(page, s => s.prologue.guide.show === 'arrow' ? s.prologue.guide.rest : undefined, 0, 6);
  expect(arrow).toBeGreaterThanOrEqual(3.9);
  let p = await pro(page);
  expect(p.guide.arrow).toBe(true);
  expect(p.guide.circle).not.toBeNull();
  expect(p.shown.hand).toBe(false);
  await frame(page); await frame(page);
  expect((await pro(page)).shown.arrow).toBe(true);
  await shot(page, 'arrow');
  // Walking hides the arrow (the circle stays); at the circle the hand comes at once.
  const spot = await page.evaluate(() => (window as any).__realtime.prologue.spotWorld());
  await walkTo(page, async () => spot, 0.2, s => s.prologue.guide.show === 'hand');
  await frame(page);
  p = await pro(page);
  expect(p.guide.show).toBe('hand');
  expect(p.guide.circle).toBeNull();
  expect(p.guide.rest).toBeLessThan(2);
});

test('«Пропустить обучение» leads to the run and sets the key; the second launch has no prologue; the gear «Обучение» plays it again', async ({ page }) => {
  await newViewer(page);
  await inRoom(page, 1);
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(k => localStorage.getItem(k), KEY)).toBe('1');
  expect((await pro(page)).active).toBe(false);
  expect((await pro(page)).log.some((e: any) => e.type === 'skip' && e.room === 1)).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('run')).toBeVisible();
  expect((await pro(page)).active).toBe(false);
  // The gear: «Обучение» clears the labels' memory and plays the prologue.
  await page.evaluate(() => { (window as any).__realtime.run.newRun(10); });
  await page.getByTestId('gift-1').click();
  await page.evaluate(() => localStorage.setItem('ashen-oath-realtime-hints', JSON.stringify({ version: 1, shown: { b6: 1 } })));
  const runBefore = await page.evaluate(() => JSON.stringify((window as any).__realtime.run.state()));
  await page.getByTestId('run-settings').click();
  await expect(page.getByTestId('prologue-start')).toHaveText('Обучение');
  await expect(page.getByTestId('hints-reset')).toHaveCount(0);
  await page.getByTestId('prologue-start').click();
  await inRoom(page, 1);
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ashen-oath-realtime-hints') || '{"shown":{}}').shown)).toEqual({});
  // Skipping again returns to the map of the same run.
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => JSON.stringify((window as any).__realtime.run.state()))).toBe(runBefore);
});

test('the sandbox has no prologue: no key needed, the arena menu opens', async ({ page }) => {
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  expect((await pro(page)).active).toBe(false);
  await expect(page.getByTestId('prologue-skip')).toBeHidden();
});

test('a death in room 10 plays room 10 again at once with full HP and no defeat screen', async ({ page }) => {
  test.setTimeout(240_000);
  await newViewer(page);
  await goToRoom(page, 10);
  await titleGone(page);
  // Why a debug command: a real death needs the hero to stand through many hits (15 HP, a long wait, a different fight on each seed). The journalled `setParam` commands make the touch deadly in THIS room's world only; the death, the retry and the HUD after it are the real flow.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 15); rt.setParam('invulnerability', 0); rt.setParam('chainShield', 0); });
  const died = await untilFrame(page, s => s.prologue.log.some((e: any) => e.type === 'roomEnd' && e.outcome === 'death') ? true : undefined, 0, 90);
  expect(died).toBe(true);
  await expect(page.getByTestId('result')).toBeHidden();
  const again = await untilFrame(page, s => s.prologue.room === 10 && s.prologue.attempt === 2 && !s.prologue.transition && s.status === 'playing' ? true : undefined, 0, 6);
  expect(again).toBe(true);
  const s = await snap(page);
  expect(s.hero.hp).toBe(s.hero.maxHp);
  expect(s.prologue.title).toBe('10/10 · Толпа');
  await expect(page.getByTestId('result')).toBeHidden();
});

/**
 * Room 9 «Щит» (task 13): the hand's chain of 3+ of one colour (`route()` — `prologueShieldLinks`, where to drag) by the real mouse,
 * then a wait for the shield's window to end (the ring comes back), until the three lamps are lit; a death plays the room again (the
 * loop goes on). Ends with the door open.
 */
async function passShield(page: Page): Promise<void> {
  for (let k = 0; k < 40 && (await snap(page)).stage !== 'greed'; k++) {
    const s = await snap(page);
    if (s.status !== 'playing' || s.moving || s.hero.chainShield > 0 || s.prologue.transition) { await gameWait(page, 0.1); continue; }
    const pts = await route(page);
    if (pts.length < 3) { await gameWait(page, 0.1); continue; }
    await drag(page, pts);
    // The dash, the shield's window, the ring back at its end.
    await untilFrame(page, sn => sn.stage === 'greed' || (!sn.moving && sn.hero.chainShield === 0 && sn.enemies.length === 9) ? true : undefined, 0, 4);
  }
  expect((await snap(page)).stage, 'the three lamps of «Щит»').toBe('greed');
  await gameWait(page, 0.3);
}

/** Plays the earlier rooms by the hand's chain (real mouse) to reach room `n`. */
async function goToRoom(page: Page, n: number): Promise<void> {
  for (let room = 1; room < n; room++) await passRoom(page, room);
  await inRoom(page, n);
}

/** Room 5 «Пропасть»: walk to the cliff's edge by the keys, Space, a click on the ground beyond — the jump; then walk into the door. */
async function jumpTheCliff(page: Page): Promise<void> {
  const aim = await page.evaluate(() => (window as any).__realtime.prologue.jumpAim());
  expect(aim, 'the jump room gives a spot and a target').not.toBeNull();
  await walkTo(page, async () => aim.spot, 0.12);
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.prologue.jumpAim()))?.ready).toBe(true);
  const target = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [aim.target.x, aim.target.y] as const);
  await page.keyboard.press('Space');
  await page.mouse.move(target.x, target.y);
  await page.mouse.down(); await page.mouse.up();
  // Over the cliff: the aim is gone (the hero on the far bank).
  expect(await untilFrame(page, (s, past: number) => !s.moving && s.hero.x > past ? true : undefined, aim.spot.x + 1, 4)).toBe(true);
}

/** Room `room` (1–9) passed by real input (the hand's chain; 5 the jump, 6 Q, 7 the potion's tile, 9 chains of 3+ into the crowd) and a walk into the door; ends when the fade after it begins. */
async function passRoom(page: Page, room: number): Promise<void> {
  await inRoom(page, room);
  await titleGone(page);
  if (room === 9) { await passShield(page); await walkIn(page, room); return; }
  if (room === 5) { await jumpTheCliff(page); await walkIn(page, room); return; }
  if (room === 6) { await page.keyboard.press('KeyQ'); await untilFrame(page, s => s.stage === 'greed' ? true : undefined, 0, 6); await gameWait(page, 0.3); await walkIn(page, room); return; }
  if (room === 7) { await page.getByTestId('item-healing').click(); await untilFrame(page, s => s.stage === 'greed' ? true : undefined, 0, 6); await gameWait(page, 0.3); await walkIn(page, room); return; }
  if (room === 3) {
    // The tough one is the chain's last link: the hand's chain from the start kills it.
  }
  const pts = await route(page);
  expect(pts.length, `the hand's chain in room ${room}`).toBeGreaterThan(0);
  await drag(page, pts);
  if (room === 1 && (await snap(page)).prologue.lamps.total === 3) {
    // Room 1 wants three kills: the chain may be shorter than the room (the hand draws all it can).
    await gameWait(page, 1.5);
    for (let k = 0; k < 3 && (await snap(page)).stage === 'goals'; k++) {
      const more = await route(page);
      if (!more.length) break;
      await drag(page, more);
      await gameWait(page, 1.5);
    }
  }
  await untilFrame(page, s => s.stage === 'greed' ? true : undefined, 0, 6);
  await gameWait(page, 0.3);
  await walkIn(page, room);
}

test('rooms without tiles (1–4, 8): Space, Q and the item keys 1–4 do nothing — no command, no jump aiming — and the hand still comes after 4 s of rest', async ({ page }) => {
  await newViewer(page);
  await inRoom(page, 1);
  await titleGone(page);
  for (const key of ['Space', 'KeyQ', 'Digit1', 'Digit2', 'Digit3', 'Digit4']) { await page.keyboard.press(key); await frame(page); }
  const hero = (await snap(page)).hero;
  const aim = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [hero.x - 1.5, hero.y + 1] as const);
  await page.keyboard.press('Space');
  await page.mouse.move(aim.x, aim.y);
  await frame(page);
  expect((await snap(page)).prologue.guide.show).toBe('none');
  const before = (await snap(page)).hero;
  const shown = await untilFrame(page, s => s.prologue.shown.hand ? s.time : undefined, 0, 6);
  expect(typeof shown).toBe('number');
  // The keys were no press: the hand came at the 4 s of rest from the start of the room.
  expect(shown as number).toBeLessThan(5.5);
  const journal = await page.evaluate(() => (window as any).__realtime.journal());
  expect(journal.commands.filter((c: any) => ['jump', 'spin', 'item'].includes(c.cmd.t))).toEqual([]);
  const after = (await snap(page)).hero;
  expect(Math.hypot(after.x - before.x, after.y - before.y), 'the hero did not jump').toBeLessThan(0.01);
});

test('a death in room 8 plays room 8 again (attempt 2) with full HP, the enemies asleep again, no defeat screen', async ({ page }) => {
  test.setTimeout(180_000);
  await newViewer(page);
  await goToRoom(page, 8);
  await titleGone(page);
  // Why a debug command: see the room 10 death test. The first press (an empty one) wakes the room.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 15); rt.setParam('invulnerability', 0); });
  await page.mouse.move(40, 600);
  await page.mouse.down(); await page.mouse.up();
  const died = await untilFrame(page, s => s.prologue.log.some((e: any) => e.type === 'roomEnd' && e.room === 8 && e.outcome === 'death') ? true : undefined, 0, 60);
  expect(died).toBe(true);
  await expect(page.getByTestId('result')).toBeHidden();
  const again = await untilFrame(page, s => s.prologue.room === 8 && s.prologue.attempt === 2 && !s.prologue.transition && s.status === 'playing' ? true : undefined, 0, 6);
  expect(again).toBe(true);
  const s = await snap(page);
  expect(s.hero.hp).toBe(s.hero.maxHp);
  expect(s.prologue.title).toBe('8/10 · Гоблин');
  expect(s.enemies.length).toBe(6);
});

test('an old run save and no key: the prologue plays, «Пропустить» leads to the SAME run (state and save unchanged)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const save = readFileSync(new URL('./fixtures/rt-run-save-hard-battle.json', import.meta.url), 'utf8').trim();
  await page.evaluate(([key, text]) => { localStorage.clear(); localStorage.setItem(key, text); }, ['ashen-oath-rt-run-v7', save] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.snapshot().prologue.active)).toBe(true);
  const state = await page.evaluate(() => JSON.stringify((window as any).__realtime.run.state()));
  expect(state).not.toBe('null');
  const stored = await page.evaluate(() => localStorage.getItem('ashen-oath-rt-run-v7'));
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => JSON.stringify((window as any).__realtime.run.state()))).toBe(state);
  expect(await page.evaluate(() => localStorage.getItem('ashen-oath-rt-run-v7'))).toBe(stored);
  expect(errors).toEqual([]);
});

/**
 * The prologue's telemetry (task 6, step 5; docs/realtime-telemetry.md, «Пролог»): the page's own records buffer. A new viewer waits
 * for the hand in room 1, passes it with real chains, walks in, skips in room 2; then the gear's «Обучение» plays it again and it is
 * skipped in room 1. One `prologue` record per playthrough; the prologue's rooms write no fight, journal or note record.
 */
test('telemetry: one prologue record per playthrough — room 1 passed with the hand shown, the skip in room 2; the gear replay skipped in room 1; no fight records', async ({ page }) => {
  const records = async (): Promise<any[]> => page.evaluate(() => (window as any).__realtime.telemetry.records());
  await newViewer(page);
  await inRoom(page, 1);
  await titleGone(page);
  expect(await untilFrame(page, s => s.prologue.shown.hand ? true : undefined, 0, 6)).toBe(true);
  await goToRoom(page, 2);
  // Room 2: a chain of three of five — the enemies come back once (the hero too: one return, not two).
  await titleGone(page);
  await drag(page, await route(page), 3);
  expect(await untilFrame(page, s => s.prologue.shown.smokesStarted > 0 && s.enemies.length === 9 ? true : undefined, 0, 6)).toBe(true);
  // The key N in the prologue marks nothing (no fight of a run to mark).
  await page.keyboard.press('KeyN');
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  let all = await records();
  expect(all.filter(r => r.kind === 'fight' || r.kind === 'journal' || r.kind === 'note')).toEqual([]);
  const first = all.filter(r => r.kind === 'prologue');
  expect(first.length).toBe(1);
  const rec = first[0];
  expect(rec.id).toBe(`${rec.session}/${rec.run}/prologue`);
  expect([rec.from, rec.outcome, rec.skipRoom, rec.rooms.length]).toEqual(['first', 'skip', 2, 2]);
  expect(typeof rec.endedAt).toBe('string');
  const [r1, r2] = rec.rooms;
  expect([r1.room, r1.outcome, r1.attempts, r1.deaths, r1.restores]).toEqual([1, 'win', 1, 0, 0]);
  expect(r1.hands).toBeGreaterThanOrEqual(1);
  expect(r1.gameSeconds).toBeGreaterThan(4);
  expect(r1.realSeconds).toBeGreaterThan(r1.gameSeconds * 0.5);
  expect([r2.room, r2.outcome, r2.attempts, r2.restores]).toEqual([2, 'skip', 1, 1]);
  // The gear's «Обучение» (a run on the map): a second record, from the gear, skipped in room 1.
  await page.evaluate(() => { (window as any).__realtime.run.newRun(10); });
  await page.getByTestId('gift-1').click();
  await page.getByTestId('run-settings').click();
  await page.getByTestId('prologue-start').click();
  await inRoom(page, 1);
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  all = await records();
  const gear = all.filter(r => r.kind === 'prologue' && r.from === 'gear');
  expect(gear.length).toBe(1);
  expect([gear[0].outcome, gear[0].skipRoom, gear[0].rooms.map((r: any) => r.outcome)]).toEqual(['skip', 1, ['skip']]);
  expect(all.filter(r => r.kind === 'prologue').length).toBe(2);
  expect(all.filter(r => r.kind === 'fight' || r.kind === 'journal' || r.kind === 'note')).toEqual([]);
});

/**
 * «Пропустить» pressed in the fade (the button stays on the screen in it): the first frame the fade darkens, if it is the fade
 * of `kind`. Install it when no fade-in runs. The page's own frame loop watches (an evaluate left pending would hold the test's
 * other page calls); it reads only the fade's opacity. Returns the fade's kind seen then (`null` — none yet).
 */
async function skipInFade(page: Page, kind: 'next' | 'retry'): Promise<() => Promise<string | null>> {
  await page.evaluate(k => {
    const w = window as any, fade = document.querySelector('[data-testid="prologue-fade"]') as HTMLElement;
    w.__skipInFade = null;
    const loop = (): void => {
      if (Number(fade.style.opacity || 0) > 0) {
        const now = w.__realtime.snapshot().prologue.transition;
        if (now === k) (document.querySelector('[data-testid="prologue-skip"]') as HTMLElement).click();
        w.__skipInFade = now ?? 'none';
      } else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, kind);
  return async () => { await expect.poll(() => page.evaluate(() => (window as any).__skipInFade), { timeout: 15_000 }).not.toBeNull(); return page.evaluate(() => (window as any).__skipInFade); };
}

test('telemetry: «Пропустить» in the fade after room 1 is won — the skip is in room 2, which was not reached; room 1 stays won', async ({ page }) => {
  const errors: string[] = [];
  await newViewer(page, errors);
  const skipped = await skipInFade(page, 'next');
  await passRoom(page, 1);
  expect(await skipped()).toBe('next');
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  const rec = (await page.evaluate(() => (window as any).__realtime.telemetry.records())).filter((r: any) => r.kind === 'prologue');
  expect(rec.length).toBe(1);
  expect([rec[0].outcome, rec[0].skipRoom, rec[0].rooms.map((r: any) => [r.room, r.outcome, r.attempts])]).toEqual(['skip', 2, [[1, 'win', 1]]]);
  expect(errors).toEqual([]);
});

test('telemetry: «Пропустить» in the fade after a death in room 8 — room 8 skipped with no new attempt (attempts 1, deaths 1)', async ({ page }) => {
  test.setTimeout(180_000);
  await newViewer(page);
  await goToRoom(page, 8);
  await titleGone(page);
  // Why a debug command: see the room 10 death test. The first press (an empty one) wakes the room.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 15); rt.setParam('invulnerability', 0); });
  const skipped = await skipInFade(page, 'retry');
  await page.mouse.move(40, 600);
  await page.mouse.down(); await page.mouse.up();
  expect(await skipped()).toBe('retry');
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  const rec = (await page.evaluate(() => (window as any).__realtime.telemetry.records())).filter((r: any) => r.kind === 'prologue');
  expect(rec.length).toBe(1);
  const r8 = rec[0].rooms.find((r: any) => r.room === 8);
  expect([rec[0].outcome, rec[0].skipRoom, rec[0].rooms.length, r8.outcome, r8.attempts, r8.deaths]).toEqual(['skip', 8, 8, 'skip', 1, 1]);
});

test('room 5 «Пропасть»: only the Space tile, breathing; after 4 s the arrow to the cliff edge, at the edge the hand clicks beyond it; Space and the click jump the cliff; the door', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await newViewer(page, errors);
  await goToRoom(page, 5);
  await titleShot(page, '5');
  let p = await pro(page);
  expect(p.hud).toMatchObject({ actionBar: true, energy: false, focus: false });
  expect(p.tiles).toEqual({ jump: true, spin: false, items: [] });
  expect(p.pulse).toEqual({ space: true, q: false, items: [] });
  await expect(page.getByTestId('goal')).toHaveText('Дверь: 0 / 1');
  // Q and the item keys do nothing here (their tiles are hidden).
  for (const key of ['KeyQ', 'Digit3']) { await page.keyboard.press(key); await frame(page); }
  expect((await page.evaluate(() => (window as any).__realtime.journal())).commands.filter((c: any) => ['spin', 'item'].includes(c.cmd.t))).toEqual([]);
  // Rest: the jump does not reach from the start — the arrow and the circle at the cliff's edge.
  await titleGone(page);
  expect(await untilFrame(page, s => s.prologue.guide.show === 'arrow' ? true : undefined, 0, 6)).toBe(true);
  const aim = await page.evaluate(() => (window as any).__realtime.prologue.jumpAim());
  expect((await pro(page)).guide.circle).toEqual(aim.spot);
  // At the edge: the hand at once, clicking beyond the cliff (its point is the jump's target).
  await walkTo(page, async () => aim.spot, 0.12);
  expect(await untilFrame(page, s => s.prologue.guide.show === 'hand' && s.prologue.shown.hand ? true : undefined, 0, 4)).toBe(true);
  p = await pro(page);
  expect(p.guide.target).toEqual(aim.target);
  expect(p.pulse.space).toBe(true);
  await shot(page, 'jump-hand');
  await jumpTheCliff(page);
  await walkIn(page, 5);
  await inRoom(page, 6);
  expect(errors).toEqual([]);
});

test('room 6 «Вихрь»: only the Q tile, breathing while one spin meets the goal; a chain of one brings the ring back; Q by its tile kills six at once', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await newViewer(page, errors);
  await goToRoom(page, 6);
  await titleShot(page, '6');
  let p = await pro(page);
  expect(p.tiles).toEqual({ jump: false, spin: true, items: [] });
  expect(p.pulse).toEqual({ space: false, q: true, items: [] });
  expect(p.lamps.total).toBe(6);
  await expect(page.getByTestId('goal')).toHaveText('Одним ударом: 0 / 6');
  // Asleep until the first press: the «z» over the ring.
  expect((await snap(page)).sleepMarks).toBeGreaterThan(0);
  await titleGone(page);
  // One by one does not do: a chain of one enemy — the ring comes back (smoke, a return).
  const s0 = await snap(page), near = s0.enemies[0];
  const at = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [near.x, near.y] as const);
  await drag(page, [{ ...at, kind: 'enemy', id: near.id }]);
  expect(await untilFrame(page, s => s.prologue.log.some((e: any) => e.type === 'restore' && e.room === 6) ? true : undefined, 0, 8)).toBe(true);
  expect(await untilFrame(page, s => s.enemies.length === 6 && !s.moving && s.prologue.pulse.q ? true : undefined, 0, 8)).toBe(true);
  // Q by a click on its tile: six at once, the door opens.
  await page.getByTestId('ability-spin').click();
  expect(await untilFrame(page, s => s.stage === 'greed' ? true : undefined, 0, 4)).toBe(true);
  p = await pro(page);
  expect(p.lamps).toEqual({ lit: 6, total: 6 });
  // The goal met: Q stops breathing (the next frames of the view).
  expect(await untilFrame(page, sn => sn.prologue.pulse.q === false ? true : undefined, 0, 1)).toBe(true);
  await gameWait(page, 0.3);
  await walkIn(page, 6);
  await inRoom(page, 7);
  expect(errors).toEqual([]);
});

test('room 7 «Зелье»: the hero at 5/15, only the potion tile, breathing; a click on the tile drinks it — the HP up, the lamp lit, the door', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await newViewer(page, errors);
  await goToRoom(page, 7);
  await titleShot(page, '7');
  let s = await snap(page);
  expect([s.hero.hp, s.hero.maxHp]).toEqual([5, 15]);
  expect(s.prologue.tiles).toEqual({ jump: false, spin: false, items: ['healing'] });
  expect(s.prologue.pulse).toEqual({ space: false, q: false, items: ['healing'] });
  await expect(page.getByTestId('goal')).toHaveText('Зелье: 0 / 1');
  await expect(page.getByTestId('item-healing').locator('.rt-tile-count')).toHaveText('1');
  // One group only: no empty ability group, no separator — the bar stands in the middle (design 13.10.2026).
  await expect(page.locator('.rt-abilities')).toBeHidden();
  const bar = (await page.getByTestId('action-bar').boundingBox())!, tile = (await page.getByTestId('item-healing').boundingBox())!;
  expect(Math.abs(tile.x + tile.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(2);
  expect(await page.locator('.rt-items').evaluate(el => getComputedStyle(el).borderLeftWidth)).toBe('0px');
  await titleGone(page);
  await page.getByTestId('item-healing').click();
  expect(await untilFrame(page, sn => sn.stage === 'greed' ? true : undefined, 0, 4)).toBe(true);
  s = await snap(page);
  expect(s.hero.hp).toBeGreaterThan(5);
  expect(s.prologue.lamps).toEqual({ lit: 1, total: 1 });
  expect(await untilFrame(page, sn => sn.prologue.pulse.items.length === 0 ? true : undefined, 0, 1)).toBe(true);
  await expect(page.getByTestId('item-healing')).toBeHidden();
  await gameWait(page, 0.3);
  await walkIn(page, 7);
  await inRoom(page, 8);
  expect(errors).toEqual([]);
});
