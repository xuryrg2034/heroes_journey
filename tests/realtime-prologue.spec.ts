import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gameWait, untilFrame } from './realtimeFrames';

/**
 * The prologue «Опушка» (src/realtime/view/prologueFlow.ts, prologueView.ts, run/prologue.ts; docs/realtime-onboarding.md, «Пролог:
 * вид и поток»): real input at 1280×720 — the mouse draws the chains, the keys walk. A new viewer (empty storage) plays six rooms;
 * the test hook `__realtime.prologue.route()` only tells WHERE to drag (the stage pixels of the hand's chain), it sends nothing.
 * Uses plain `@playwright/test`: the other specs start with the key «пролог пройден» set (tests/realtimeTest.ts).
 *
 * - a new viewer lands in room 1 with the name «1/6 · Тропа» for 1.5 s, the lean HUD (HP and goal), the skip button;
 * - each room is passed by a real chain (room 5 ends on the lever, room 6 is a fight: real chains, the rest by the debug command);
 * - rooms 2 and 4: a shorter chain lights the lamps while it runs, they go out, the door stays closed;
 * - room 3: the tough one first survives; weak ones one by one — the enemies come back (smoke);
 * - the hand comes after 4 s without a press and goes on a press; with no chain from the hero's place: the arrow and the circle,
 *   the hand at once when the circle is reached;
 * - «Пропустить» → the run, the second launch has no prologue; the gear's «Обучение» plays it again; a death in room 6 → room 6 again.
 * Waits are in game time (tests/realtimeFrames.ts). Snapshots: artifacts/realtime-prologue-1.png … -6.png, -hand.png, -arrow.png, -lamps.png.
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

test('a new viewer plays the prologue: room 1 «1/6 · Тропа» for 1.5 s, only HP and the goal, the skip button, three lamps, the label at the nearest enemy', async ({ page }) => {
  const errors: string[] = [];
  await newViewer(page, errors);
  await inRoom(page, 1);
  const p = await pro(page);
  expect(p.title).toBe('1/6 · Тропа');
  expect(p.skipVisible).toBe(true);
  expect(p.lamps).toEqual({ lit: 0, total: 3 });
  expect(p.hud).toEqual({ energy: false, actionBar: false, score: false, focus: false, info: false });
  await expect(page.getByTestId('goal')).toHaveText('Убей: 0 / 3');
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('run')).toBeHidden();
  // The label at the place, the name on the screen.
  const labels = (await snap(page)).onboarding.labels;
  expect(labels.map((l: any) => l.text)).toEqual(['Зажми и веди']);
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
  expect((await pro(page)).title).toBe('2/6 · Два цвета');
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

test('room 5: the goblin — the label at the lever until the first pull; the real chain of enemies ends on the lever; the pull opens the door', async ({ page }) => {
  await newViewer(page);
  await goToRoom(page, 5);
  await titleShot(page, '5');
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
  await walkIn(page, 5);
  await inRoom(page, 6);
});

test('room 6: energy and the action bar appear, Space and Q pulse until used once, 15 kills by real chains (jump by Space and a click, Q by its key) and the door end the prologue: the key is set, the run map follows', async ({ page }) => {
  test.setTimeout(540_000);
  const errors: string[] = [];
  await newViewer(page, errors);
  await goToRoom(page, 6);
  await titleShot(page, '6');
  let p = await pro(page);
  expect(p.hud.energy).toBe(true);
  expect(p.hud.focus).toBe(true);
  expect(p.hud.actionBar).toBe(true);
  expect(p.pulse).toEqual({ space: true, q: true });
  expect(p.lamps.total).toBe(15);
  await expect(page.getByTestId('ability-jump')).toBeVisible();
  await titleGone(page);
  // The start energy is one jump: Space, then a click on free ground — the jump; Space stops breathing, Q still does.
  const hero = (await snap(page)).hero;
  const landing = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [hero.x + 2.5, hero.y + 1] as const);
  await page.keyboard.press('Space');
  await page.mouse.move(landing.x, landing.y);
  await page.mouse.down(); await page.mouse.up();
  expect(await untilFrame(page, s => s.prologue.pulse.space === false ? true : undefined, 0, 4)).toBe(true);
  p = await pro(page);
  expect(p.pulse).toEqual({ space: false, q: true });
  // Real chains on what comes (the longest chain from the enemies in reach — 3 links and more bring the chain shield and the focus shield);
  // Q by its key when the chains have earned the energy and a crowd stands round the hero. A death plays the room again: the loop goes on
  // (up to 60 attempts; the waits end with the attempt, the world's clock starts anew).
  const settle = async (seconds: number): Promise<void> => {
    const attempt = (await pro(page)).attempt;
    await untilFrame(page, (sn, a: number) => sn.prologue.attempt !== a || sn.stage === 'greed' ? true : undefined, attempt, seconds);
  };
  let spun = false;
  while ((await pro(page)).room === 6 && (await pro(page)).attempt <= 60) {
    const s = await snap(page);
    if (s.status !== 'playing') { await page.waitForTimeout(100); continue; }
    if (s.stage === 'greed') { expect(s.kills, 'the 15 kills are the real chains\'').toBeGreaterThanOrEqual(15); await walkIn(page, 6); await page.waitForTimeout(300); continue; } // a hit on the way may end the attempt: the loop plays the room again; no game-time wait here — after the win the map is open and the world stands
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

test('a death in room 6 plays room 6 again at once with full HP and no defeat screen', async ({ page }) => {
  await newViewer(page);
  await goToRoom(page, 6);
  await titleGone(page);
  // Why a debug command: a real death needs the hero to stand through many hits (15 HP, a long wait, a different fight on each seed). The journalled `setParam` commands make the touch deadly in THIS room's world only; the death, the retry and the HUD after it are the real flow.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 15); rt.setParam('invulnerability', 0); rt.setParam('chainShield', 0); });
  const died = await untilFrame(page, s => s.prologue.log.some((e: any) => e.type === 'roomEnd' && e.outcome === 'death') ? true : undefined, 0, 90);
  expect(died).toBe(true);
  await expect(page.getByTestId('result')).toBeHidden();
  const again = await untilFrame(page, s => s.prologue.room === 6 && s.prologue.attempt === 2 && !s.prologue.transition && s.status === 'playing' ? true : undefined, 0, 6);
  expect(again).toBe(true);
  const s = await snap(page);
  expect(s.hero.hp).toBe(s.hero.maxHp);
  expect(s.prologue.title).toBe('6/6 · Толпа');
  await expect(page.getByTestId('result')).toBeHidden();
});

/** Plays the earlier rooms by the hand's chain (real mouse) to reach room `n`. */
async function goToRoom(page: Page, n: number): Promise<void> {
  for (let room = 1; room < n; room++) await passRoom(page, room);
  await inRoom(page, n);
}

/** Room `room` (1–5) passed by the hand's chain and a walk into the door; ends when the fade after it begins. */
async function passRoom(page: Page, room: number): Promise<void> {
  await inRoom(page, room);
  await titleGone(page);
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

test('rooms 1–5: Space, Q and the item keys 1–4 do nothing — no command, no jump aiming — and the hand still comes after 4 s of rest', async ({ page }) => {
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

test('a death in room 5 plays room 5 again (attempt 2) with full HP, the enemies asleep again, no defeat screen', async ({ page }) => {
  test.setTimeout(120_000);
  await newViewer(page);
  await goToRoom(page, 5);
  await titleGone(page);
  // Why a debug command: see the room 6 death test. The first press (an empty one) wakes the room.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 15); rt.setParam('invulnerability', 0); });
  await page.mouse.move(40, 600);
  await page.mouse.down(); await page.mouse.up();
  const died = await untilFrame(page, s => s.prologue.log.some((e: any) => e.type === 'roomEnd' && e.room === 5 && e.outcome === 'death') ? true : undefined, 0, 60);
  expect(died).toBe(true);
  await expect(page.getByTestId('result')).toBeHidden();
  const again = await untilFrame(page, s => s.prologue.room === 5 && s.prologue.attempt === 2 && !s.prologue.transition && s.status === 'playing' ? true : undefined, 0, 6);
  expect(again).toBe(true);
  const s = await snap(page);
  expect(s.hero.hp).toBe(s.hero.maxHp);
  expect(s.prologue.title).toBe('5/6 · Гоблин');
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

test('telemetry: «Пропустить» in the fade after a death in room 5 — room 5 skipped with no new attempt (attempts 1, deaths 1)', async ({ page }) => {
  test.setTimeout(120_000);
  await newViewer(page);
  await goToRoom(page, 5);
  await titleGone(page);
  // Why a debug command: see the room 6 death test. The first press (an empty one) wakes the room.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 15); rt.setParam('invulnerability', 0); });
  const skipped = await skipInFade(page, 'retry');
  await page.mouse.move(40, 600);
  await page.mouse.down(); await page.mouse.up();
  expect(await skipped()).toBe('retry');
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  const rec = (await page.evaluate(() => (window as any).__realtime.telemetry.records())).filter((r: any) => r.kind === 'prologue');
  expect(rec.length).toBe(1);
  const r5 = rec[0].rooms.find((r: any) => r.room === 5);
  expect([rec[0].outcome, rec[0].skipRoom, rec[0].rooms.length, r5.outcome, r5.attempts, r5.deaths]).toEqual(['skip', 5, 5, 'skip', 1, 1]);
});
