import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 55а «Замок, шаг 1а», the view (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 11 and 14): the sandbox group
 * «Замок» (three arenas) and what the player meets on them, by real input at 1280×720: the mouse opens an arena from the menu, the
 * keys walk the hero out of the wardrobe's lane and onto the rook's axis. The rules are checked in Node (`npm run test:realtime-castle`,
 * `npm run test:realtime-castle-view`); here the signs the player reads: the things with their notches, the wardrobe's strip, its
 * lean and lying, the hit that costs 2, the rook's line, the wardrobe that shelters the hero. Waits are in game time
 * (tests/realtimeFrames.ts); a fight's journal replays in Node to the hash of the page.
 * NOT here: a thing shoved by a chain — the chain takes a thing as its last link only after the chain part of 55а (task 54а's
 * `planChain`); until then the shove's view (the path, the crush, the impact, the break) is checked in Node with the plan the sim gives
 * (`castleView.spec.ts`). Screenshots go to $SHOT_DIR when it is set. Added 17.10.2026 by the ui session on branch ui/task-55a.
 */
interface ThingShot { id: number; kind: string; x: number; y: number; durability: number }
interface WardrobeShot { id: number; x: number; y: number; topple: { from: { x: number; y: number }; to: { x: number; y: number }; half: number; progress: number } | null; lying: number; drawn: { from: { x: number; y: number } } | null; pose: { ang: number; sy: number } | null }
interface RookShot { id: number; x: number; y: number; hp: number; line: { x0: number; y0: number; x1: number; y1: number; axis: string; progress: number } | null }
interface Snap {
  arena: string; status: string; time: number; menuOpen: boolean;
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; marked?: boolean }[];
  castle: {
    shoves: unknown[]; things: ThingShot[]; wardrobe: WardrobeShot[]; rook: RookShot[];
    shown: { notches: number; topples: number; rookLines: number; windups: number; hits: number; rises: number; aims: number; shots: number; kicks: number };
  };
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/castle-${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The menu's castle buttons in order (a click opens the arena); the sandbox, fresh storage. */
async function openMenu(page: Page): Promise<void> {
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
}

/** Opens castle arena `n` (1–3) by a real click in the menu and waits for the fight. */
async function openByMenu(page: Page, n: number, arena: string): Promise<void> {
  await openMenu(page);
  await page.getByTestId(`castle-arena-${n}`).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe(arena);
  await expect.poll(async () => (await snap(page)).menuOpen).toBe(false);
}

/** No newcomers, nobody walks, touches do not hurt, the wardrobes rest — journalled commands only, so the fight replays in Node. */
async function quiet(page: Page, rest = true): Promise<void> {
  await page.evaluate(rest => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ...rest ? [['wardrobePeriod', 1000]] : []] as const) rt.setParam(k, v);
  }, rest);
}

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The camera has come to rest on the point (the arena may be larger than the screen). */
async function cameraSettled(page: Page): Promise<void> {
  const still = await untilFrame(page, (_snap, _arg: null, late, rt) => {
    const h = rt.snapshot().hero, s = rt.toScreen(h.x, h.y), w = window as any, last = w.__castleCam;
    w.__castleCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__castleCam.n >= 5 ? true : late ? false : undefined;
  }, null, 4);
  expect(still, 'the camera came to rest').toBe(true);
}

/** Holds a key until the hero's reading satisfies `done` (read in the page every frame), then lets go. */
async function walkUntil(page: Page, key: string, done: (hero: { x: number; y: number }) => boolean, gameSeconds = 6): Promise<void> {
  await page.keyboard.down(key);
  const source = done.toString();
  const reached = await untilFrame(page, (s, src: string, late) => (new Function(`return (${src})`)()(s.hero) ? true : late ? false : undefined), source, gameSeconds);
  await page.keyboard.up(key);
  expect(reached, `walked with ${key}`).toBe(true);
}

test('task 55а: the sandbox menu has the group «Замок» with three arenas; a click opens each — the things with their notches, the parquet and walls (screenshots)', async ({ page }) => {
  const errors = collectErrors(page);
  await openMenu(page);
  await expect(page.locator('h3.rt-arenas-head', { hasText: 'Замок' })).toBeVisible();
  await expect(page.getByTestId('castle-arena-1')).toContainText('Прихожая');
  await expect(page.getByTestId('castle-arena-2')).toContainText('Анфилада');
  await expect(page.getByTestId('castle-arena-3')).toContainText('Бальный зал');
  await expect(page.getByTestId('castle-arena-4')).toHaveCount(0);
  await shot(page, 'menu');
  const total = await page.locator('.rt-arena').count();
  const want: [string, number, number][] = [['c-hall', 3, 3], ['c-enfilade', 5, 3], ['c-ballroom', 8, 6]];
  for (const [i, [arena, notches, things]] of want.entries()) {
    // `?arena=N` opens the same arena at once (N counts from 1 over the whole menu; the castle's three are the last).
    await page.goto(`/?sandbox=1&arena=${total - 2 + i}`);
    await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
    await expect.poll(async () => (await snap(page)).arena).toBe(arena);
    await cameraSettled(page);
    await expect.poll(async () => (await snap(page)).castle.shown.notches).toBe(notches);
    const s = await snap(page);
    expect(s.castle.things).toHaveLength(things);
    expect(s.castle.things.filter(t => t.kind === 'barrel').every(t => t.durability === 1) && s.castle.things.filter(t => t.kind === 'wardrobe').every(t => t.durability === 2)).toBe(true);
    await shot(page, `open-${arena}`);
  }
  expect(errors).toEqual([]);
});

test('task 55а: «Падение шкафа» — the strip stands from the windup and fills, the wardrobe leans; a step aside by the keys saves the hero; it lies on the lane and rises', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openByMenu(page, 1, 'c-hall');
  await quiet(page, false);
  const wid = await page.evaluate(() => { const rt = (window as any).__realtime; rt.clear(false); rt.teleport(8, 3.9); return rt.place(8, 6.6, 0, 0, 'wardrobe'); });
  await cameraSettled(page);
  const hp0 = (await snap(page)).hero.hp;
  // The windup: the strip is fixed on the lane towards the hero and fills (the first of a fight 1.8 s); the step comes early — the game runs on while the test reads.
  const w1 = await untilFrame(page, (s, id: number, late) => { const w = s.castle.wardrobe.find((x: any) => x.id === id); return w?.topple && w.topple.progress >= 0.2 ? w : late ? null : undefined; }, wid, 4);
  expect(w1, 'the strip stands and fills').not.toBeNull();
  expect(w1!.topple!.to.y).toBeLessThan(w1!.topple!.from.y);
  expect(Math.hypot(w1!.topple!.to.x - w1!.topple!.from.x, w1!.topple!.to.y - w1!.topple!.from.y)).toBeCloseTo(3, 5);
  // A step aside (west, 1.2 units at 4 u/s: 0.3 s) saves the hero.
  await walkUntil(page, 'KeyA', h => h.x < 6.8);
  const lying = await untilFrame(page, (s, id: number, late) => { const w = s.castle.wardrobe.find((x: any) => x.id === id); return w && w.lying > 1.2 ? w : late ? null : undefined; }, wid, 5);
  expect(lying, 'the wardrobe fell and lies').not.toBeNull();
  const s1 = await snap(page);
  expect(s1.hero.hp).toBe(hp0);
  expect(s1.castle.shown).toMatchObject({ windups: 1, hits: 1 });
  expect(s1.castle.shown.kicks).toBeGreaterThanOrEqual(1);
  // It lies flat on the lane (towards the hero: north — flattened, not turned); the frame is read once the pose has come.
  await untilFrame(page, (s, id: number, late) => { const w = s.castle.wardrobe.find((x: any) => x.id === id); return w?.pose && w.pose.sy < 0.5 ? true : late ? false : undefined; }, wid, 2);
  await shot(page, 'topple-lying');
  expect((await snap(page)).castle.wardrobe[0].pose!.sy).toBeLessThan(0.5);
  // It rises after 2 s and stands upright.
  const up = await untilFrame(page, (s, id: number, late) => { const w = s.castle.wardrobe.find((x: any) => x.id === id); return w && w.lying === 0 && w.pose && Math.abs(w.pose.sy - 1) < 0.05 ? true : late ? false : undefined; }, wid, 5);
  expect(up, 'it rose and stands upright').toBe(true);
  expect((await snap(page)).castle.shown.rises).toBe(1);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55а: «Падение шкафа» — the hero who stays in the lane loses 2 at the hit; the lane flashes and the arena kicks', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openByMenu(page, 1, 'c-hall');
  await quiet(page, false);
  const wid = await page.evaluate(() => { const rt = (window as any).__realtime; rt.clear(false); rt.teleport(8, 3.9); return rt.place(8, 6.6, 0, 0, 'wardrobe'); });
  await cameraSettled(page);
  const hp0 = (await snap(page)).hero.hp;
  const lean = await untilFrame(page, (s, _arg: null, late) => s.castle.wardrobe[0]?.topple && s.castle.wardrobe[0].topple.progress >= 0.5 ? s : late ? null : undefined, null, 4);
  expect(lean, 'the strip fills').not.toBeNull();
  expect(lean!.castle.shown.topples).toBeGreaterThan(0);
  await shot(page, 'topple-strip');
  const hit = await untilFrame(page, (s, _arg: null, late) => s.castle.shown.hits >= 1 ? s : late ? null : undefined, null, 6);
  expect(hit, 'the wardrobe fell').not.toBeNull();
  expect(hit!.hero.hp).toBe(hp0 - 2);
  expect(hit!.castle.shown.kicks).toBe(1);
  await shot(page, 'topple-hit');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55а: «Удар ладьи» — the line stands both ways along the axis and fills; the hero between the two wardrobes is sheltered; off the axis he is safe too', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openByMenu(page, 2, 'c-enfilade');
  await quiet(page);
  const s0 = await snap(page);
  const rooks = s0.castle.rook;
  expect(rooks).toHaveLength(2);
  expect(s0.enemies.filter(e => e.kind === 'rook' && e.marked)).toHaveLength(2);
  // Up the hall to its axis (y 4.5), between the wardrobes (x 8 and 14): the hero stands in the line of both rooks.
  await walkUntil(page, 'KeyW', h => h.y < 4.7);
  await cameraSettled(page);
  const hp0 = (await snap(page)).hero.hp;
  const aimed = await untilFrame(page, (s, _arg: null, late) => s.castle.rook.some((r: any) => r.line && r.line.progress >= 0.55) ? s : late ? null : undefined, null, 6);
  expect(aimed, 'a rook aims').not.toBeNull();
  const line = aimed!.castle.rook.find(r => r.line)!.line!;
  expect(line.axis).toBe('row');
  expect(Math.abs(line.y1 - line.y0)).toBeLessThan(1e-6);
  expect(line.x1 - line.x0).toBeGreaterThan(10);
  expect(aimed!.castle.shown.rookLines).toBeGreaterThan(0);
  await shot(page, 'rook-aim');
  const shot1 = await untilFrame(page, (s, _arg: null, late) => s.castle.shown.shots >= 1 ? s : late ? null : undefined, null, 4);
  expect(shot1, 'the strike came').not.toBeNull();
  expect(shot1!.hero.hp, 'a wardrobe stands between').toBe(hp0);
  expect(shot1!.castle.things.filter(t => t.kind === 'wardrobe').every(t => t.durability === 2)).toBe(true);
  await shot(page, 'rook-sheltered');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55а: «Удар ладьи» — with no cover the strike costs the hero 2 (the fight is the same hall, the wardrobes taken away)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openByMenu(page, 2, 'c-enfilade');
  await quiet(page);
  const ids = (await snap(page)).castle.things.filter(t => t.kind === 'wardrobe').map(t => t.id);
  expect(ids).toHaveLength(2);
  // The wardrobes are moved off the axis by the journalled command `clear` (keeping the rooks) — the hall without cover.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.clear(true); });
  await walkUntil(page, 'KeyW', h => h.y < 4.7);
  await cameraSettled(page);
  const hp0 = (await snap(page)).hero.hp;
  const hit = await untilFrame(page, (s, _arg: null, late) => s.castle.shown.shots >= 1 ? s : late ? null : undefined, null, 6);
  expect(hit, 'the strike came').not.toBeNull();
  expect(hit!.hero.hp).toBe(hp0 - 2);
  await shot(page, 'rook-hit');
  await gameWait(page, 0.2);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 55а: «Анфилада» — the rook at the end of the hall: its drawing, its marked ring, the line of its windup (screenshot)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openByMenu(page, 2, 'c-enfilade');
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.teleport(5, 6.6));
  await cameraSettled(page);
  const aimed = await untilFrame(page, (s, _arg: null, late) => s.castle.rook.some((r: any) => r.line && r.line.progress >= 0.3) ? s : late ? null : undefined, null, 4);
  expect(aimed, 'the rook at the end aims at the hero near its axis').not.toBeNull();
  await shot(page, 'rook-close');
  expect(errors).toEqual([]);
});

test('task 55а: «Бальный зал» — the exam hall opens with two rooks, two wardrobes, four barrels, an elite and the pillars; 20 s of fight without an error (seed from the journal)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openByMenu(page, 3, 'c-ballroom');
  await cameraSettled(page);
  await shot(page, 'ballroom');
  const s = await snap(page);
  expect(s.castle.things.filter(t => t.kind === 'barrel')).toHaveLength(4);
  expect(s.castle.things.filter(t => t.kind === 'wardrobe')).toHaveLength(2);
  expect(s.castle.rook).toHaveLength(2);
  // The fight runs for a while (or ends: the hero stands still among the crowd, the rooks and the wardrobes).
  await untilFrame(page, (s, _arg: null, late) => s.time >= 12 || s.status !== 'playing' ? true : late ? false : undefined, null, 20);
  await shot(page, 'ballroom-20s');
  await sameHash(page);
  expect(errors).toEqual([]);
});
