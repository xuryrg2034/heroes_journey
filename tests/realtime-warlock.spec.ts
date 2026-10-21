import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { breakCharm } from './warlockRoute';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 55 stage Д «Колдун v0», the view (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 6 and 11): «Зал колдуна» in the
 * sandbox group «Замок» (the fourth button, opened by a real click) and what the player reads on it, by real input at 1280×720: the mouse
 * draws the chains and shoves the wardrobe, the hero is stood by the journal's own `teleport`. The rules are checked in Node
 * (`npm run test:realtime-warlock`, `npm run test:realtime-warlock-view`); here the signs: the charm's beam to his wardrobe and «под чарами»
 * at the cursor, the candle that blooms before «Перенос» and its name, the beam that snaps when the wardrobe breaks at the wall, the window
 * (the dazed drawing, the glow, the count), the hit that lands once and «вне окна» after it, the window that runs out with him in the drawn
 * chain. Waits are in game time (tests/realtimeFrames.ts); a fight's journal replays in Node to the hash of the page. Screenshots go to
 * $SHOT_DIR when it is set. Added 21.10.2026 by the ui session on branch ui/task-55d.
 */
interface WarlockState {
  id: number; x: number; y: number; phase: number; rule: boolean; spellbound: boolean; wardrobe: number | null; candles: { x: number; y: number }[]; candle: number;
  shift: { candle: number; progress: number } | null; window: { open: boolean; left: number; hit: boolean } | null;
}
interface WarlockShown {
  core: number; hud: number; countAt: { x: number; y: number } | null; dazed: number; glow: number; count: string; edgeCount: string; beam: number; beamTo: number; candles: number; target: number; flame: number; signProgress: number; haze: number; dropping: number;
  sparks: number; hits: number; opens: number; unlinks: number; snaps: number; marks: number; arrivals: number; smokes: number;
}
interface Snap {
  hint: string | null; chain: number[]; moving: string | null; loop: { hintText: string | null };
  arena: string; status: string; time: number; menuOpen: boolean;
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; marked?: boolean }[];
  castle: { things: { id: number; kind: string; x: number; y: number; durability: number }[]; shoves: unknown[] };
  bossBar: { visible: boolean; cells: number; filled: number; hp: number; plates: number; phaseAt: number };
  bossNames: string[];
  warlock: { state: WarlockState | null; shown: WarlockShown; sounds: number };
  markedView: { reticles: number; charmed: number };
  eliteView: { edgeArrows: number };
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/warlock-${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The sandbox menu, fresh storage; then a real click on the hall's button (the fourth of the castle group). */
async function openHall(page: Page): Promise<void> {
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('castle-arena-4').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('c-warlock');
  await expect.poll(async () => (await snap(page)).menuOpen).toBe(false);
}

/** Nobody walks or hurts, no newcomers; the wardrobe of the hall does not topple; his wardrobe slides 6 (it reaches the wall in two shoves). The hall's crowd is the default (0.9). */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['wardrobePeriod', 1000], ['shoveDistance', 6]] as const) rt.setParam(k, v);
  });
}

async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The camera has come to rest on the hero (the arena is larger than the screen). */
async function cameraSettled(page: Page): Promise<void> {
  const still = await untilFrame(page, (_snap, _arg: null, late, rt) => {
    const h = rt.snapshot().hero, s = rt.toScreen(h.x, h.y), w = window as any, last = w.__warlockCam;
    w.__warlockCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__warlockCam.n >= 5 ? true : late ? false : undefined;
  }, null, 4);
  expect(still, 'the camera came to rest').toBe(true);
}

/** The mouse goes to an arena point (read when it moves). */
async function mouseTo(page: Page, at: () => Promise<{ x: number; y: number }>, steps = 6): Promise<void> {
  const p = await at(), t = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [p.x, p.y] as const);
  await page.mouse.move(t.x, t.y, { steps });
}
const coreAt = (page: Page) => async (): Promise<{ x: number; y: number }> => { const s = (await snap(page)).warlock.state!; return { x: s.x, y: s.y }; };
const thingAt = (page: Page, id: number) => async (): Promise<{ x: number; y: number }> => (await snap(page)).castle.things.find(t => t.id === id)!;

/**
 * Past the charm's end: waits for the sign of the shift, stands the hero a unit below the lit candle (the journal's teleport), puts the mouse on
 * the candle and waits for the arrival — the window is open. Returns the candle.
 */
async function toWindow(page: Page): Promise<{ x: number; y: number }> {
  const marked = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.state?.shift ? sn.warlock.state.candles[sn.warlock.state.shift.candle] : late ? null : undefined, null, 4);
  expect(marked, 'the next shift is signed').not.toBeNull();
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y + 1.1), [marked!.x, marked!.y] as const);
  await mouseTo(page, async () => marked!, 2);
  const open = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.state?.window?.open ? true : late ? false : undefined, null, 3);
  expect(open, 'the window opened').toBe(true);
  await mouseTo(page, coreAt(page), 1);
  return marked!;
}

test('task 55 Д: the fourth button of the castle group opens «Зал колдуна»; the charm — the beam to his wardrobe, four candles, the bar of 2 + 4 cells with no phase line; «под чарами» at the cursor (screenshots)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('castle-arena-4')).toContainText('Зал колдуна');
  await expect(page.getByTestId('castle-arena-5')).toHaveCount(0);
  await shot(page, 'menu');
  await openHall(page);
  await quiet(page);
  // The hero stands in the middle of the hall: the warlock, his wardrobe and the beam are in the frame.
  await page.evaluate(() => (window as any).__realtime.teleport(12, 7.2));
  await cameraSettled(page);
  const s = await snap(page), st = s.warlock.state!;
  expect(st.spellbound && st.phase === 1).toBe(true);
  expect(st.candles).toHaveLength(4);
  expect(s.warlock.shown.core).toBe(1);
  expect(s.warlock.shown.candles).toBe(4);
  expect(s.warlock.shown.beam, 'the charm\'s beam is drawn').toBe(1);
  expect(s.warlock.shown.beamTo, 'to the sim\'s wardrobe').toBe(st.wardrobe);
  expect(s.castle.things.filter(t => t.kind === 'wardrobe').map(t => t.id)).toContain(st.wardrobe);
  expect(s.bossBar).toMatchObject({ visible: true, cells: 6, hp: 2, plates: 4, phaseAt: 0 });
  // Design 21.10.2026: under the charm his reticle is the charm's violet (the lemon is for the window).
  expect(s.markedView.reticles).toBeGreaterThan(0);
  expect(s.markedView.charmed, 'violet reticle under the charm').toBe(1);
  await shot(page, 'charm');
  // The cursor on him: the sim's refusal, in its words.
  await mouseTo(page, coreAt(page), 4);
  await expect.poll(async () => (await snap(page)).hint).toBe('spellbound');
  expect((await snap(page)).loop.hintText).toBe('под чарами');
  await shot(page, 'charm-hint');
  // A bomb at the mouse (key 2) rings off him: a spark, no text, no hurt.
  const sparks0 = (await snap(page)).warlock.shown.sparks;
  await page.evaluate(() => (window as any).__realtime.setItems('bomb', 1));
  await page.keyboard.press('2');
  const rang = await untilFrame(page, (sn, n: number, late) => sn.warlock.shown.sparks > n ? true : late ? false : undefined, sparks0, 5);
  expect(rang, 'the bomb rang off him («звон»)').toBe(true);
  expect((await snap(page)).warlock.shown.count).toBe('');
  expect((await snap(page)).bossBar.plates).toBe(4);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55 Д: «Перенос» — the sign blooms the target candle (the flame grows), «Перенос» is named over it once, he arrives there with smoke left at the old candle (screenshots)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openHall(page);
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.teleport(12, 8));
  await cameraSettled(page);
  const early = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.shown.target >= 0 && sn.warlock.shown.signProgress >= 0.25 ? sn : late ? null : undefined, null, 7);
  expect(early, 'the sign came').not.toBeNull();
  expect(early!.bossNames, 'the move is named').toContain('Перенос');
  const marked = early!.warlock.state!.shift!.candle;
  await shot(page, 'shift-early');
  const late = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.shown.signProgress >= 0.85 ? sn : late ? null : undefined, null, 2);
  expect(late, 'the sign fills').not.toBeNull();
  expect(late!.warlock.shown.target).toBe(marked);
  expect(late!.warlock.shown.flame, 'the flame grows with the sign').toBeGreaterThan(early!.warlock.shown.flame * 1.4);
  expect(late!.warlock.shown.haze, 'the haze round him').toBe(1);
  await shot(page, 'shift');
  const arrived = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.shown.arrivals >= 1 ? sn : late ? null : undefined, null, 3);
  expect(arrived, 'he arrived').not.toBeNull();
  expect(arrived!.warlock.state!.candle).toBe(marked);
  expect(arrived!.warlock.shown.smokes).toBe(1);
  expect(arrived!.warlock.shown.target).toBe(-1);
  await shot(page, 'arrival');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55 Д: the wardrobe shoved into the wall twice — the beam snaps, the window opens: the dazed drawing, the glow, the count; the chain takes him once (a plate), then «вне окна» (screenshots)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openHall(page);
  await quiet(page);
  await cameraSettled(page);
  await breakCharm(page);
  const broken = await snap(page);
  expect(broken.warlock.shown.snaps, 'the beam snapped once').toBe(1);
  expect(broken.bossBar.plates, 'the plates stay').toBe(4);
  await gameWait(page, 0.1);
  expect((await snap(page)).warlock.shown.beam).toBe(0);
  await toWindow(page);
  const open = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.shown.glow === 1 && sn.warlock.shown.count !== '' ? sn : late ? null : undefined, null, 2);
  expect(open, 'the glow and the count').not.toBeNull();
  expect(open!.warlock.shown.dazed).toBe(1);
  expect(['1', '2']).toContain(open!.warlock.shown.count);
  expect(open!.warlock.shown.opens).toBe(1);
  // (the screenshot of a window is taken in the next one, below: a screenshot here would eat the window)
  // The chain takes him: the mouse presses on him and lets go.
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toHaveLength(1);
  await page.mouse.up();
  const hit = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.shown.hits >= 1 && sn.moving === null ? sn : late ? null : undefined, null, 6);
  expect(hit, 'the hit landed').not.toBeNull();
  expect(hit!.bossBar.plates, 'one plate').toBe(3);
  expect(hit!.warlock.shown.hits).toBe(1);
  await gameWait(page, 0.1);
  const after = await snap(page);
  expect(after.warlock.shown.glow).toBe(0);
  expect(after.warlock.shown.count).toBe('');
  // The second try in the same window: refused at the cursor.
  await mouseTo(page, coreAt(page), 2);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).hint).toBe('outOfWindow');
  expect((await snap(page)).loop.hintText).toBe('вне окна');
  await shot(page, 'out-of-window');
  await page.mouse.up();
  // The next «Перенос» brings the next window (5 s after the arrival): the picture of the window.
  await mouseTo(page, coreAt(page), 1);
  const again = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.state?.window?.open && sn.warlock.shown.glow === 1 ? true : late ? false : undefined, null, 8);
  expect(again, 'the next window opened').toBe(true);
  await shot(page, 'window');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55 Д: a window that runs out with him in the drawn chain — the links blink in its last second, then they drop out (white rings), the plates stay', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openHall(page);
  await quiet(page);
  await cameraSettled(page);
  await breakCharm(page);
  await toWindow(page);
  // Pressed on him and held: the chain is [core]; the window's time runs out under the finger.
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toHaveLength(1);
  await page.evaluate(() => { (window as any).__warlockBlink = 0; });
  const dropped = await untilFrame(page, (sn, _arg: null, late) => {
    const w = window as any;
    if (sn.warlock.shown.dropping) w.__warlockBlink++;
    return sn.warlock.shown.unlinks >= 1 ? { blinks: w.__warlockBlink, chain: sn.chain.length } : late ? null : undefined;
  }, null, 3);
  expect(dropped, 'the window ran out').not.toBeNull();
  expect((await snap(page)).chain, 'the chain lost him').not.toContain((await snap(page)).warlock.state!.id);
  expect(dropped!.blinks, 'the blink came before the drop').toBeGreaterThan(0);
  await page.mouse.up();
  expect((await snap(page)).bossBar.plates, 'no plate was lost').toBe(4);
  await shot(page, 'unlink');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55 Д (design rule): the window opens with one bell; the ring of the core at the top candle is above the visible area (the camera, held by the hero at the south wall, cannot bring it under the HUD): the goal pointer stands and the window count is by it; the lemon returns to the reticle (screenshot)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openHall(page);
  await quiet(page);
  await cameraSettled(page);
  await breakCharm(page);
  // The hero at the far south: the core's windows come at the candles in turn; at the top candle (C1) his ring is out of the visible area.
  await page.evaluate(() => (window as any).__realtime.teleport(12, 14.4));
  const edge = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.state?.window?.open && sn.warlock.state.candle === 0 && sn.warlock.shown.edgeCount !== '' ? sn : late ? null : undefined, null, 60);
  expect(edge, 'a window at the top candle, the count by the pointer').not.toBeNull();
  const ring = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [edge!.warlock.state!.x, edge!.warlock.state!.y] as const);
  expect(ring.y, 'the ring is above the HUD edge').toBeLessThan(84);
  expect(edge!.eliteView.edgeArrows, 'a goal pointer').toBeGreaterThanOrEqual(1);
  expect(edge!.warlock.sounds, 'one bell for each window opened').toBe(edge!.warlock.shown.opens);
  expect(edge!.markedView.charmed, 'no violet reticle in phase 2').toBe(0);
  await shot(page, 'window-pointer');
  expect(errors).toEqual([]);
});

test('task 55 Д (design rule): the ring in view with the head cut off by the HUD — no pointer; the window count is pushed under the HUD edge, beside the ring (screenshot)', async ({ page }) => {
  test.setTimeout(330_000);
  const errors = collectErrors(page);
  await openHall(page);
  await quiet(page);
  await cameraSettled(page);
  await breakCharm(page);
  await page.evaluate(() => (window as any).__realtime.teleport(12, 11));
  // The ring's centre a hand below the top band (the head above it): only the side candles C2 and C3 (index 1, 2; y = 7) can stand there — the camera
  // cannot bring the lower candle C4 (y 9.6) or the upper C1 (y 3.2) to the band (pw-core-m59a trace, 21.10.2026: the window came at C4, the body stayed at ~216 px).
  // The camera's centre is clamped to `arenaH + under - viewH / 2` (camera.ts:33 `clampAxis`, render.ts:892 `bounds`, a boss view adds the action bar's inset `under` =
  // edgeInset.bottom / (UNIT * scale)): the body of C2/C3 stands at 360 + 72 * (7 - c) px, 100…150 px for c = 10.6…10.1, the clamp is about 10.8 — room of 0.2 units
  // (14 px) above and 0.3 (20 px) below, so the hero steps (the teleport, 0.05 a frame) to put the camera there. The route waits for such a window (40 s of
  // game time, the windows come every 5 s): windows at C1 and C4 are let go by, no step is made for them.
  // The budget is a count of windows, not seconds (design, task 55: the candle stays random, the seed is not fixed): up to 10 windows are let to open; the
  // time (150 s of game time) is only a safety. A window falls at C2/C3 in about half the cases (from C1 or C4: 2 of 3 others; from C2 or C3: 1 of 3), so ten
  // windows miss every fitting one in about (1/2)^10 = 0.1 % of fights (the windows are not independent; the number is a guide).
  const seen = await untilFrame(page, (sn, _arg: null, late, rt) => {
    const st = sn.warlock.state, w = window as any;
    if (!st) return late ? null : undefined;
    w.__w299 ??= sn.warlock.shown.opens;
    const target = st.window ? st.candle : st.shift ? st.shift.candle : st.candle, side = target === 1 || target === 2;
    const at = st.candles[target], body = rt.toScreen(at.x, at.y).y, head = rt.toScreen(at.x, at.y - 1.36).y;
    if (st.window?.open && side && sn.warlock.shown.count !== '' && body > 100 && head < 84) return { sn, body, head, candle: st.candle };
    if (late || (sn.warlock.shown.opens - w.__w299 >= 10 && !st.window?.open)) return null;
    if (!side) return undefined;
    if (body > 150) rt.teleport(12, Math.min(14.4, sn.hero.y + 0.05));
    else if (body < 120) rt.teleport(12, Math.max(1, sn.hero.y - 0.05));
    return undefined;
  }, null, 150);
  expect(seen, 'a window at a side candle (index 1 or 2) with the ring in view and the head under the band within 10 windows').not.toBeNull();
  expect([1, 2], `the window's candle ${seen?.candle}`).toContain(seen!.candle);
  const s = seen!.sn as Snap;
  expect(s.warlock.shown.hud, 'the ring can be clicked: no pointer').toBe(0);
  expect(s.warlock.shown.edgeCount, 'no count by a pointer').toBe('');
  const at = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [s.warlock.shown.countAt!.x, s.warlock.shown.countAt!.y] as const);
  expect(at.y, 'the count is under the HUD edge').toBeGreaterThanOrEqual(84);
  const ring = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [s.warlock.state!.x, s.warlock.state!.y] as const);
  expect(Math.hypot(at.x - ring.x, at.y - ring.y), 'the count is off the ring').toBeGreaterThan(30);
  await shot(page, 'window-ring-in-view');
  expect(errors).toEqual([]);
});
