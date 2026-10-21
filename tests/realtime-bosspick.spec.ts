import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { breakCharm } from './warlockRoute';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import { artDrawnAbove, artEllipseDepth, type ArtEllipse } from '../src/realtime/sim/bossArt';

/**
 * «Зона нажатия босса по рисунку» (`Params.bossPickArt`, design 21.10.2026, docs/design-notes/task-48-troll.md §24), by real input at 1280×720: a click
 * on a boss's drawing out of its press circle (the head, the chest, the club's picture) takes the boss or says why not. The Troll: in his window a click
 * in the head — the chain [core]; out of the window — the refusal «вне окна» at the cursor and nothing taken; a click on the club's picture takes the
 * club; with the key off (`setParam('bossPickArt', false)`, journalled) the same click in the head takes nothing and says nothing. The warlock: in his
 * window the chest and the head take the core. Before every click the test checks that the pointer is inside the drawing's ellipse (`artEllipseDepth` of the
 * sim, the zone read from the page by `__realtime.bossArt`) and out of the feet's circle (`pickRadius`). The arenas are opened by their menu buttons with the
 * name checked. The bodies are drawn in the order of `artDrawnAbove` (the snapshot's `drawnOrder`), whatever the order they came in. The rules are in Node
 * (`npm run test:realtime-boss-pick-art`, `test:realtime-draw-order`); here the player's click. The crowd is the default. Added 21.10.2026 by the ui
 * session on branch ui/boss-pick-art.
 */
interface Zone extends ArtEllipse { ring: number }
interface Shot {
  hint: string | null; loop: { hintText: string | null }; chain: number[]; moving: string | null; time: number; arena: string; menuOpen: boolean; drawnOrder: number[];
  hero: { x: number; y: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; color: number; partOf: number | null; vars: Record<string, number> }[];
  chief: { glow: number; sign: string; signProgress: number };
  castle: { things: { id: number; x: number; y: number; durability: number }[]; shoves: unknown[] };
  warlock: { state: { id: number; x: number; y: number; wardrobe: number | null; window: { open: boolean; hit: boolean } | null; phase: number } | null };
  troll: { glow: number };
  bossBar: { plates: number };
}
const snap = (page: Page): Promise<Shot> => page.evaluate(() => (window as any).__realtime.snapshot());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/bosspick-${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

async function cameraSettled(page: Page): Promise<void> {
  const still = await untilFrame(page, (_snap, _arg: null, late, rt) => {
    const h = rt.snapshot().hero, s = rt.toScreen(h.x, h.y), w = window as any, last = w.__bpCam;
    w.__bpCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__bpCam.n >= 5 ? true : late ? false : undefined;
  }, null, 4);
  expect(still, 'the camera came to rest').toBe(true);
}

const zoneOf = async (page: Page, id: number): Promise<Zone> => {
  const z = await page.evaluate(([id]) => (window as any).__realtime.bossArt(id), [id] as const) as Zone | null;
  expect(z, `the drawing of ${id} has a press zone`).not.toBeNull();
  return z!;
};

/**
 * The pointer's point on a boss's drawing: the ellipse's centre moved by (`u`, `v`) of its half-axes along the axes (u right, v up). Checked here, before
 * the click: inside the ellipse (`artEllipseDepth` <= 1) and out of the feet's circle of the body (`pickRadius`). The mouse goes there and the hint is read.
 */
async function aimOnDrawing(page: Page, id: number, u: number, v: number, steps = 4): Promise<{ x: number; y: number }> {
  const z = await zoneOf(page, id), body = (await snap(page)).enemies.find(e => e.id === id)!;
  const p = { x: z.x + (u * z.a) * z.cos - (-v * z.b) * z.sin, y: z.y + (u * z.a) * z.sin + (-v * z.b) * z.cos };
  expect(artEllipseDepth(z, p), 'the pointer is inside the drawing ellipse').toBeLessThanOrEqual(1);
  expect(Math.hypot(p.x - body.x, p.y - body.y), 'the pointer is out of the feet circle').toBeGreaterThan(z.ring);
  const t = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [p.x, p.y] as const);
  await page.mouse.move(t.x, t.y, { steps });
  return p;
}

/**
 * A point on a drawing above its feet circle and free of every other body's press circle: the first (from `vFrom` of the half-height above the ellipse's centre, in steps of 0.05,
 * and across the drawing by 0, ±0.25, ±0.5 of the half-width) that is inside the ellipse, out of the circle of the body's feet and out of the circle of every other body
 * (with a margin) — taken from the drawing's frame, not a number; a held pointer takes a body whose circle lies under it, so none does. The mouse goes there; returns the point.
 */
async function aimBeyondRing(page: Page, id: number, vFrom: number): Promise<{ x: number; y: number }> {
  const z = await zoneOf(page, id), s = await snap(page), body = s.enemies.find(e => e.id === id)!;
  const others = await page.evaluate(([id]) => { const rt = (window as any).__realtime; return rt.snapshot().enemies.filter((e: any) => e.id !== id).map((e: any) => ({ x: e.x, y: e.y, r: rt.pickRadius(e.id) })); }, [id] as const) as { x: number; y: number; r: number }[];
  for (let v = vFrom; v < 1; v += 0.05) {
    for (const u of [0, 0.25, -0.25, 0.5, -0.5]) {
      const p = { x: z.x + (u * z.a) * z.cos - (-v * z.b) * z.sin, y: z.y + (u * z.a) * z.sin + (-v * z.b) * z.cos };
      if (artEllipseDepth(z, p) <= 1 && Math.hypot(p.x - body.x, p.y - body.y) > z.ring + 0.05 && !others.some(e => Math.hypot(e.x - p.x, e.y - p.y) <= e.r + 0.05)) return aimOnDrawing(page, id, u, v);
    }
  }
  throw new Error(`no point of ${id}'s drawing above its feet circle and free of every other press circle from ${vFrom}`);
}

/** A body of `color` put (frozen) at (x, y); the mouse presses on it: the chain is [body] and goes on (the button stays down). */
async function startChainOn(page: Page, x: number, y: number, color: number): Promise<number> {
  const id = await page.evaluate(([x, y, color]) => { const rt = (window as any).__realtime, id = rt.place(x, y, color, 0, 'basic'); rt.chill(id, 600); return id; }, [x, y, color] as const) as number;
  const t = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
  await page.mouse.move(t.x, t.y, { steps: 2 });
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'the chain is started on the body' }).toEqual([id]);
  return id;
}

const settleDash = (page: Page): Promise<boolean> => untilFrame(page, (s, _arg: null, late) => s.moving === null && s.chain.length === 0 ? true : late ? false : undefined, null, 12);

/** The Troll's den by its menu button; no newcomers, nobody walks, no touch; the rock frozen. */
async function openDen(page: Page): Promise<{ core: number; club: number }> {
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('boss-arena-2')).toContainText('Берлога тролля');
  await page.getByTestId('boss-arena-2').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('troll');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(k, v);
  });
  const s = await snap(page), core = s.enemies.find(e => e.kind === 'troll')!, club = s.enemies.find(e => e.kind === 'troll-club')!;
  await page.evaluate(([rock]) => (window as any).__realtime.chill(rock, 600), [s.enemies.find(e => e.kind === 'troll-rock')!.id] as const);
  return { core: core.id, club: club.id };
}

test('«Зона по рисунку»: the Troll — the head in the window takes the core, shut it says «вне окна» and takes nothing, the club\'s picture takes the club, the key off takes nothing', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const { core, club } = await openDen(page);
  const c0 = (await snap(page)).enemies.find(e => e.id === core)!;
  // Shut: the club frozen in his paw, the hero below the core.
  await page.evaluate(([club]) => (window as any).__realtime.chill(club, 600), [club] as const);
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 0.3, y + 1.6), [c0.x, c0.y] as const);
  await cameraSettled(page);
  await aimOnDrawing(page, core, 0, 0.55);
  await expect.poll(async () => (await snap(page)).hint, { message: 'the core refusal at the cursor' }).toBe('outOfWindow');
  expect((await snap(page)).loop.hintText).toBe('вне окна');
  await shot(page, 'troll-shut-head');
  await page.mouse.down();
  await gameWait(page, 0.2);
  expect((await snap(page)).chain, 'the window is shut: nothing is taken').toEqual([]);
  await page.mouse.up();
  // The club's picture (the zone's centre, out of the club's circle): the press takes the club.
  await aimOnDrawing(page, club, 0, 0);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'the press on the club\'s picture takes the club' }).toEqual([club]);
  await shot(page, 'troll-club');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // Rule (d): with the button down (a chain going) the drawing works only for a core in its open window: the club's picture out of its circle takes nothing, its circle takes it.
  const clubAt = (await snap(page)).enemies.find(e => e.id === club)!;
  const b1 = await startChainOn(page, clubAt.x + 0.6, clubAt.y + 1.0, clubAt.color);
  expect(await page.evaluate(([id]) => (window as any).__realtime.refusalOf(id), [club] as const), 'the club is within the chain reach from the body').toBeNull();
  await aimOnDrawing(page, club, 0, 0, 1);
  await gameWait(page, 0.2);
  expect((await snap(page)).chain, 'a chain going: the club picture out of the circle is not taken').toEqual([b1]);
  const tc = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [clubAt.x, clubAt.y] as const);
  await page.mouse.move(tc.x, tc.y, { steps: 1 });
  await expect.poll(async () => (await snap(page)).chain, { message: 'the club circle takes it' }).toEqual([b1, club]);
  await shot(page, 'troll-drag-club');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // The window: the club strikes (the hero in its reach), the core is frozen the moment it lights.
  await page.evaluate(([club]) => (window as any).__realtime.chill(club, 0), [club] as const);
  await page.evaluate(() => (window as any).__realtime.teleport(12, 6.5));
  const lit = await untilFrame(page, (s, _arg: null, late, rt) => s.troll.glow === 1 ? (rt.chill(s.enemies.find((e: any) => e.kind === 'troll').id, 60), rt.chill(s.enemies.find((e: any) => e.kind === 'troll-club').id, 600), true) : late ? false : undefined, null, 25);
  expect(lit, 'the window is lit').toBe(true);
  const c1 = (await snap(page)).enemies.find(e => e.id === core)!;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 0.3, y + 1.6), [c1.x, c1.y] as const);
  await cameraSettled(page);
  // The window open: the head takes the core, no refusal at the cursor.
  await aimOnDrawing(page, core, 0, 0.55);
  await expect.poll(async () => (await snap(page)).hint, { message: 'no refusal on the head in the window' }).toBeNull();
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'the head takes the core' }).toEqual([core]);
  await shot(page, 'troll-window-head');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // Rule (d): a chain going, the core's window open — the pointer standing on the core's drawing out of its circle takes the core.
  const b2 = await startChainOn(page, c1.x + 1.6, c1.y + 1.6, c1.color);
  expect(await page.evaluate(([id]) => (window as any).__realtime.refusalOf(id), [core] as const), 'the core is within the chain reach in its window').toBeNull();
  await aimOnDrawing(page, core, 0, 0.55, 1);
  await expect.poll(async () => (await snap(page)).chain, { message: 'a chain going, the window open: the core drawing takes the core' }).toEqual([b2, core]);
  await shot(page, 'troll-drag-head');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // The key off (the sandbox's own `setParam`, journalled): the same click takes nothing and says nothing.
  await page.evaluate(() => (window as any).__realtime.setParam('bossPickArt', false));
  await aimOnDrawing(page, core, 0, 0.55);
  await page.mouse.down();
  await gameWait(page, 0.2);
  expect((await snap(page)).chain, 'key off: nothing taken').toEqual([]);
  expect((await snap(page)).hint, 'key off: no refusal').toBeNull();
  await page.mouse.up();
  await page.evaluate(() => (window as any).__realtime.setParam('bossPickArt', true));
  // Key on again: the head takes the core and the dash takes a plate.
  await aimOnDrawing(page, core, 0, 0.55);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([core]);
  await page.mouse.up();
  expect(await settleDash(page), 'the dash is over').toBe(true);
  expect((await snap(page)).bossBar.plates, 'a plate was taken').toBe(3);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('«Зона по рисунку»: the warlock — in his window the chest and the head take the core', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('castle-arena-4')).toContainText('Зал колдуна');
  await page.getByTestId('castle-arena-4').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('c-warlock');
  await expect.poll(async () => (await snap(page)).menuOpen).toBe(false);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['wardrobePeriod', 1000], ['shoveDistance', 6]] as const) rt.setParam(k, v);
  });
  await cameraSettled(page);
  // His wardrobe into the wall by the mouse until it breaks (tests/warlockRoute.ts, shared).
  await breakCharm(page);
  // The window of the next arrival: the core is frozen the moment it opens.
  const open = await untilFrame(page, (s, _arg: null, late, rt) => s.warlock.state?.window?.open ? (rt.chill(s.warlock.state.id, 60), s.warlock.state) : late ? null : undefined, null, 12);
  expect(open, 'the window opened').not.toBeNull();
  const id = (open as { id: number }).id, c = (await snap(page)).enemies.find(e => e.id === id)!;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 0.3, y + 1.6), [c.x, c.y] as const);
  await cameraSettled(page);
  for (const [name, from] of [['chest', 0.1], ['head', 0.6]] as const) {
    await aimBeyondRing(page, id, from);
    await expect.poll(async () => (await snap(page)).hint, { message: `${name}: no refusal in the window` }).toBeNull();
    await page.mouse.down();
    await expect.poll(async () => (await snap(page)).chain, { message: `the ${name} takes the core` }).toEqual([id]);
    await shot(page, `warlock-${name}`);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('the drawing order: bodies at exactly one height (a tie) are drawn by their ids — the later one over, as `artDrawnAbove` says, whatever order the views were made in', async ({ page }) => {
  const errors = collectErrors(page);
  await openDen(page);
  // Three bodies put at one y, frozen (they do not move: no newcomers, speed 0); the snapshot proves the tie before the order is read.
  const ids = await page.evaluate(() => {
    const rt = (window as any).__realtime, out = [rt.place(5, 9, 0, 0, 'basic'), rt.place(6.5, 9, 1, 0, 'basic'), rt.place(8, 9, 2, 0, 'basic')];
    for (const id of out) rt.chill(id, 600);
    return out;
  }) as number[];
  await gameWait(page, 0.5);
  const s = await snap(page), bodies = ids.map(id => s.enemies.find(e => e.id === id)!);
  expect(bodies.map(b => b.y), 'the three bodies stand at exactly one y (a tie)').toEqual([bodies[0].y, bodies[0].y, bodies[0].y]);
  const order = await untilFrame(page, (sn, ids: number[], late) => ids.every(id => sn.drawnOrder.includes(id)) ? sn.drawnOrder.filter((id: number) => ids.includes(id)) : late ? null : undefined, ids, 4);
  expect(order, 'the bodies are drawn').not.toBeNull();
  // The expectation is the sim's own comparison: sorted bottom to top by `artDrawnAbove` over the snapshot's (y, id); at a tie it is the ids ascending.
  const byRule = [...bodies].sort((p, q) => (artDrawnAbove(p, q) ? 1 : artDrawnAbove(q, p) ? -1 : 0)).map(b => b.id);
  expect(byRule, 'at a tie the later id is on top').toEqual([...ids].sort((p, q) => p - q));
  expect(order, 'the view draws the bodies in the order of artDrawnAbove').toEqual(byRule);
  await sameHash(page);
  expect(errors).toEqual([]);
});

/**
 * A point on the drawings of both bosses' bodies `lower` and `upper` (the two ellipses overlap), out of every press circle (`pickRadius` of every body, with a margin);
 * the one deepest in both. Found on a grid round `lower`'s zone — the geometry only; the rule is what the test then plays (core's `overlapOf`).
 */
async function overlapPoint(page: Page, lower: number, upper: number): Promise<{ x: number; y: number }> {
  const zl = await zoneOf(page, lower), zu = await zoneOf(page, upper);
  const rings = await page.evaluate(() => { const rt = (window as any).__realtime; return rt.snapshot().enemies.map((e: any) => ({ x: e.x, y: e.y, r: rt.pickRadius(e.id) })); }) as { x: number; y: number; r: number }[];
  let best: { x: number; y: number } | null = null, margin = 0;
  for (let i = -80; i <= 80; i++) for (let j = -80; j <= 40; j++) {
    const p = { x: zl.x + i * 0.02, y: zl.y + j * 0.02 };
    if (rings.some(e => Math.hypot(e.x - p.x, e.y - p.y) <= e.r + 0.02)) continue;
    const m = Math.min(1 - artEllipseDepth(zl, p), 1 - artEllipseDepth(zu, p));
    if (m > margin) { best = p; margin = m; }
  }
  expect(best, 'the two drawings overlap out of every press circle').not.toBeNull();
  return best!;
}

test('«Зона по рисунку»: the Chief — at the overlap of his and the ladle drawings the one drawn on top is taken: the ladle while the core is shut, the core when both are takeable (screenshots)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('boss-arena-3')).toContainText('Стан Главаря');
  await page.getByTestId('boss-arena-3').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('chief');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(k, v);
  });
  const s0 = await snap(page), core = s0.enemies.find(e => e.kind === 'chief')!, ladle = s0.enemies.find(e => e.kind === 'chief-ladle')!, sack = s0.enemies.find(e => e.kind === 'chief-sack')!;
  // The parts held (no move of theirs runs); the order «on top» is the sim's `artDrawnAbove`: the core (larger y) over the ladle.
  await page.evaluate(([a, b]) => { const rt = (window as any).__realtime; rt.chill(a, 600); rt.chill(b, 600); }, [ladle.id, sack.id] as const);
  expect(artDrawnAbove(core, ladle), 'the core is drawn over the ladle').toBe(true);
  // The hero where the ladle is within the chain's reach while the core is shut — asked of the world (`enemyRefusal`, reach included), not guessed.
  let placed = false;
  const tried: string[] = [];
  const l0 = (await snap(page)).enemies.find(e => e.id === ladle.id)!;
  for (const [dx, dy] of [[0, 1.2], [0.6, 1.5], [-0.6, 1.5], [0, 2.0], [1.0, 1.2], [-1.0, 1.2]] as const) {
    await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [l0.x + dx, l0.y + dy] as const);
    const why = await page.evaluate(([id]) => (window as any).__realtime.refusalOf(id), [ladle.id] as const);
    tried.push(`(${dx}, ${dy}): ${why}`);
    if (why === null) { placed = true; break; }
  }
  expect(placed, `the ladle is within reach from some place near it (${tried.join('; ')})`).toBe(true);
  expect(await page.evaluate(([id]) => (window as any).__realtime.refusalOf(id), [core.id] as const), 'the core is shut').not.toBeNull();
  await cameraSettled(page);
  const at = await overlapPoint(page, core.id, ladle.id);
  expect(artEllipseDepth(await zoneOf(page, core.id), at), 'the point is in the core ellipse').toBeLessThanOrEqual(1);
  expect(artEllipseDepth(await zoneOf(page, ladle.id), at), 'the point is in the ladle ellipse').toBeLessThanOrEqual(1);
  const screenAt = async (): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [at.x, at.y] as const);
  // The core shut (no feast yet), the ladle takeable as the first link: the press takes the ladle, no refusal.
  const t0 = await screenAt();
  await page.mouse.move(t0.x, t0.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).hint, { message: 'a part is takeable: no refusal' }).toBeNull();
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'the core is shut: the ladle is taken' }).toEqual([ladle.id]);
  await shot(page, 'chief-overlap-ladle');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // The feast: the window is lit, three eaters drawn, the pointer at the overlap — both takeable (the ladle of the brew colour) or the core alone: the core is the last link either way.
  await page.evaluate(() => (window as any).__realtime.teleport(12.9, 5.6));
  await cameraSettled(page);
  expect(await untilFrame(page, (s, _arg: null, late) => s.chief.sign === 'feast' && s.chief.signProgress >= 0.4 ? true : late ? false : undefined, null, 30), 'the feast windup').toBe(true);
  expect(await untilFrame(page, (s, _arg: null, late) => s.chief.glow === 1 ? true : late ? false : undefined, null, 30), 'the window is lit').toBe(true);
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 20), [core.id] as const);
  const eaters = (await snap(page)).enemies.filter(e => e.vars.eat).sort((a, b) => b.x - a.x);
  expect(eaters.length).toBeGreaterThanOrEqual(3);
  const first = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [eaters[0].x, eaters[0].y] as const);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const e of eaters.slice(1, 3)) {
    const t = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const);
    await page.mouse.move(t.x, t.y, { steps: 6 });
  }
  await expect.poll(async () => (await snap(page)).chain, { message: 'three eaters drawn' }).toHaveLength(3);
  const at2 = await overlapPoint(page, core.id, ladle.id);
  expect(artEllipseDepth(await zoneOf(page, core.id), at2)).toBeLessThanOrEqual(1);
  expect(artEllipseDepth(await zoneOf(page, ladle.id), at2)).toBeLessThanOrEqual(1);
  const t2 = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [at2.x, at2.y] as const);
  await page.mouse.move(t2.x, t2.y, { steps: 6 });
  await expect.poll(async () => { const c = (await snap(page)).chain; return c[c.length - 1]; }, { message: 'the core, drawn on top, is the last link' }).toBe(core.id);
  await shot(page, 'chief-overlap-core');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('«Зона по рисунку» (design 21.10.2026, rule d): the Jailer has no window — a press on his drawing out of the circle starts the chain with the core; with a chain going the core is taken only by its circle: a sweep through the drawing and a stop in it leave it out (screenshots)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('boss-arena-1')).toContainText('Тюремщик');
  await page.getByTestId('boss-arena-1').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('jailer');
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(k, v);
  });
  // The route of tests/realtime-boss.spec.ts (the chain through the weight): the core faces the hero, then is frozen; the link west of the weight, the hero west of it.
  const ids = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.clear(false);
    rt.teleport(6, 6);
    return { core: rt.place(10, 6, 1, 2, 'jailer'), weight: rt.place(10, 6, 0, 3, 'jailer-weight') };
  });
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === ids.weight)?.partOf).toBe(ids.core);
  await gameWait(page, 0.35);
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 60), [ids.core] as const);
  const w = (await snap(page)).enemies.find(e => e.id === ids.weight)!;
  const a1 = await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; rt.teleport(x - 2.8, y); return rt.place(x - 1.4, y, 0, 0, 'basic'); }, [w.x, w.y] as const) as number;
  await cameraSettled(page);
  const s1 = await snap(page), link = s1.enemies.find(e => e.id === a1)!, weight = s1.enemies.find(e => e.id === ids.weight)!;
  // Before any click: the straight path from the link to the weight crosses the core drawing (the ellipse) at points out of every press circle; the first such point is the stop.
  const zone = await zoneOf(page, ids.core);
  const rings = await page.evaluate(() => { const rt = (window as any).__realtime; return rt.snapshot().enemies.map((e: any) => ({ x: e.x, y: e.y, r: rt.pickRadius(e.id) })); }) as { x: number; y: number; r: number }[];
  let stop: { x: number; y: number } | null = null;
  for (let i = 1; i < 60; i++) {
    const t = i / 60, p = { x: link.x + (weight.x - link.x) * t, y: link.y + (weight.y - link.y) * t };
    if (artEllipseDepth(zone, p) <= 1 && !rings.some(e => Math.hypot(e.x - p.x, e.y - p.y) <= e.r + 0.02)) { stop = p; break; }
  }
  expect(stop, 'the path from the link to the weight crosses the core drawing out of every press circle').not.toBeNull();
  expect(artEllipseDepth(zone, stop!), 'the stop is in the core ellipse').toBeLessThanOrEqual(1);
  const at = (p: { x: number; y: number }) => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [p.x, p.y] as const);
  const refusalOf = (id: number) => page.evaluate(([id]) => (window as any).__realtime.refusalOf(id), [id] as const);
  // (3) The button up: a press on the core drawing out of its circle starts the chain with the core — if the core is allowed as a first link (asked of the world first).
  const hero0 = (await snap(page)).hero;
  const tried: string[] = [];
  let reach = false;
  for (const [dx, dy] of [[0, 0], [-1.0, 0.4], [-1.4, 0.8], [-1.0, 1.2], [0, 1.6]] as const) {
    if (dx !== 0 || dy !== 0) await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [stop!.x + dx, stop!.y + dy] as const);
    const why = await refusalOf(ids.core);
    tried.push(`(${dx}, ${dy}): ${why}`);
    if (why === null) { reach = true; break; }
  }
  expect(reach, `the core is allowed as the first link from some place (${tried.join('; ')})`).toBe(true);
  await cameraSettled(page);
  const onCore = await at(stop!);
  await page.mouse.move(onCore.x, onCore.y, { steps: 3 });
  await expect.poll(async () => (await snap(page)).hint, { message: 'the core is takeable: no refusal at the cursor' }).toBeNull();
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'a press on the drawing starts the chain with the core' }).toEqual([ids.core]);
  await shot(page, 'jailer-press');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // The hero back west of the link: the route of the sweep.
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [hero0.x, hero0.y] as const);
  await cameraSettled(page);
  const press = async (): Promise<void> => { const t = await at(link); await page.mouse.move(t.x, t.y, { steps: 2 }); await page.mouse.down(); await expect.poll(async () => (await snap(page)).chain).toEqual([link.id]); };
  // (1) One pointer event from the link to the weight: the path is a sweep, only the circles count — [link, weight], no core.
  await press();
  const tw = await at(weight);
  await page.mouse.move(tw.x, tw.y, { steps: 1 });
  await expect.poll(async () => (await snap(page)).chain, { message: 'the sweep through the drawing: the link and the weight' }).toEqual([link.id, ids.weight]);
  expect((await snap(page)).chain).not.toContain(ids.core);
  await shot(page, 'jailer-sweep');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // (2) A chain going and the pointer stopping in the core drawing out of its circle: the Jailer has no window — the core is not taken, the chain stays [link].
  await press();
  const ts = await at(stop!);
  await page.mouse.move(ts.x, ts.y, { steps: 1 });
  await gameWait(page, 0.2);
  expect((await snap(page)).chain, 'a stop in the drawing with a chain going: the core is not taken').toEqual([link.id]);
  await shot(page, 'jailer-stop');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await sameHash(page);
  expect(errors).toEqual([]);
});
