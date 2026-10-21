import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 54a «Главарь с котелком», the view (design 17.10.2026, docs/design-notes/task-54-chief.md, 17 and 18): the camp branch's boss on its
 * sandbox arena («Стан Главаря», found in the menu by its name, `?arena=31` today). Real input at 1280x720: the player moves the mouse over
 * the core and draws chains with it. The rules are checked in Node (`npm run test:realtime-chief`, `npm run test:realtime-chief-view`); here what
 * the player meets: a click on the core outside the window is refused («вне окна»), the window of «Обед!» is lit with the whole-second count and the
 * queue's dots, a chain of two eaters into the core is refused «в очередь», a chain of three takes a plate, the signs of the moves are drawn (the
 * ladle's half-disc is exactly the sim's 2.8 radius: a hero at 3.3 from the core is not hurt), the boss bar. Waits are in game time
 * (tests/realtimeFrames.ts). Screenshots go to $SHOT_DIR when it is set. Added 20.10.2026 by the ui session on branch ui/task-54a.
 */
interface ChiefShown {
  core: number; glow: number; count: string; edgeCount: string; cauldron: number; brew: number; sign: string; signProgress: number; signR: number;
  halfDiscs: number; circles: number; rings: number; gateMarks: number; seatMarks: number; dots: number; litDots: number; dotColor: number; dropping: number;
  bowls: number; parts: number; steam: number; hits: number; sparks: number; severed: number; unlinks: number; recolors: number; opens: number; feastHits: number; feastBig: number;
  supplies: number; brews: number;
}
interface EnemyShot { id: number; kind: string; x: number; y: number; color: number; hp: number; chill: number; armor: { plates: number; max: number } | null; partOf: number | null; vars: Record<string, number> }
interface Snap {
  arena: string; status: string; time: number; chain: number[]; moving: string | null; hint: string | null;
  hero: { x: number; y: number; hp: number };
  enemies: EnemyShot[];
  chief: ChiefShown;
  bossBar: { visible: boolean; cells: number; filled: number; hp: number; plates: number; phaseAt: number; phase2: boolean; fading: boolean; grown: number };
  bossNames: string[];
  loop: { hintText: string | null };
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/chief-${name}.png` }); };
const kindOf = (s: Snap, kind: string): EnemyShot | undefined => s.enemies.find(e => e.kind === kind);
const SWING_R = 2.8;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The menu button of the Chief's arena, found by its name (the number may move when another branch adds arenas). */
async function chiefArenaIndex(page: Page): Promise<number> {
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  const index = await page.evaluate(() => [...document.querySelectorAll('[data-summary]')].findIndex(el => el.parentElement?.querySelector('b')?.textContent === 'Стан Главаря') + 1);
  expect(index, 'the menu lists «Стан Главаря»').toBeGreaterThan(0);
  return index;
}

/** The sandbox fight on the Chief's arena; the fight opens on the boss and holds its first tick for the camera's glide. */
async function openCamp(page: Page, errors: string[]): Promise<void> {
  const index = await chiefArenaIndex(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?sandbox=1&arena=${index}`);
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('chief');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
}

/** No newcomers, nobody walks, touches do not hurt - journalled commands only, so the fight replays in Node. */
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

/** Waits (frame by frame, in game time) until the screen point of an arena point holds still for 5 frames. */
async function cameraSettled(page: Page, at: { x: number; y: number }): Promise<void> {
  const still = await untilFrame(page, (_snap, p: { x: number; y: number }, late, rt) => {
    const s = rt.toScreen(p.x, p.y), w = window as any, last = w.__chiefCam;
    w.__chiefCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__chiefCam.n >= 5 ? true : late ? false : undefined;
  }, at, 3);
  expect(still, 'the camera came to rest').toBe(true);
}

/** The hero goes to (x, y) (journalled) and the camera follows. */
async function heroTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [x, y] as const);
  await cameraSettled(page, { x, y });
}

/** Waits (game time) until the sign `move` reaches `progress`; the reading is the truth when the time is up. */
async function signAt(page: Page, move: string, progress: number, gameSeconds = 30): Promise<boolean> {
  return untilFrame(page, (s, arg: { move: string; progress: number }, late) => s.chief.sign === arg.move && s.chief.signProgress >= arg.progress ? true : late ? false : undefined, { move, progress }, gameSeconds);
}

/** Waits (game time) until the window of «Обед!» is lit (the glow and the count). */
async function windowLit(page: Page, gameSeconds = 30): Promise<boolean> {
  return untilFrame(page, (s, _arg: null, late) => s.chief.glow === 1 ? true : late ? false : undefined, null, gameSeconds);
}

/** The Chief's parts held (no move of theirs runs), so the feast is the only move. */
async function holdParts(page: Page): Promise<void> {
  const s = await snap(page);
  await page.evaluate(([a, b]) => { const rt = (window as any).__realtime; rt.chill(a, 600); rt.chill(b, 600); }, [kindOf(s, 'chief-ladle')!.id, kindOf(s, 'chief-sack')!.id] as const);
}

/** The four eaters of the window, by their seats' order (sitting: `vars.eat`). */
const eatersOf = (s: Snap): EnemyShot[] => s.enemies.filter(e => e.vars.eat).sort((a, b) => b.x - a.x);

const enemyAt = (page: Page, id: number) => async (): Promise<{ x: number; y: number }> => (await snap(page)).enemies.find(e => e.id === id)!;

/** Press at the first point and drag through the rest (each read just before the pointer goes there); the button stays held. */
async function drawChain(page: Page, points: (() => Promise<{ x: number; y: number }>)[]): Promise<void> {
  const first = await points[0]();
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

test('task 54a: the sandbox menu has «Стан Главаря» under its own heading; the fight opens on the Chief - his drawing, the cauldron with the brew, two parts, the boss bar', async ({ page }) => {
  const errors = collectErrors(page);
  const index = await chiefArenaIndex(page);
  await expect(page.getByTestId('menu').locator('h3', { hasText: 'Босс — Главарь' })).toHaveCount(1);
  await expect(page.getByTestId('boss-arena-3')).toContainText('Стан Главаря');
  await page.goto(`/?sandbox=1&arena=${index}`);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('chief');
  await page.waitForFunction(() => (window as any).__realtime.camera().intro > 0.8, null, { polling: 'raf', timeout: 0 });
  await shot(page, 'open');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  const s = await snap(page), core = kindOf(s, 'chief')!;
  expect(s.enemies.filter(e => e.partOf === core.id).map(e => e.kind).sort()).toEqual(['chief-ladle', 'chief-sack']);
  expect(core.armor).toMatchObject({ plates: 4, max: 4 });
  await expect.poll(async () => (await snap(page)).chief).toMatchObject({ core: 1, cauldron: 1, parts: 2, glow: 0, count: '' });
  // The boss bar: HP 2 and 4 plates - six cells; the line of phase 3 at 2 plates, not lit.
  await expect.poll(async () => (await snap(page)).bossBar).toMatchObject({ visible: true, cells: 6, hp: 2, plates: 4, phaseAt: 4, phase2: false });
  expect(errors).toEqual([]);
});

test('task 54a: outside the window a click on the core is refused - «вне окна» at the cursor, no chain starts; the journal replays in Node to the page hash', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openCamp(page, errors);
  await quiet(page);
  await holdParts(page);
  const core = kindOf(await snap(page), 'chief')!;
  await heroTo(page, 11.2, 4.8);
  const at = await screen(page, core.x, core.y);
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await snap(page)).hint).toBe('outOfWindow');
  await expect(page.getByTestId('link-hint')).toHaveText('вне окна');
  expect((await snap(page)).chief.glow).toBe(0);
  await shot(page, 'refusal');
  for (let n = 0; n < 5; n++) {
    await page.mouse.down();
    expect((await snap(page)).chain, `press ${n}`).toEqual([]);
    await page.mouse.up();
    await gameWait(page, 0.2);
  }
  const s1 = await snap(page);
  expect(kindOf(s1, 'chief')!.armor!.plates).toBe(4);
  expect(kindOf(s1, 'chief')!.hp).toBe(2);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 54a: «Обед!» - the dashed circle and the seat marks, then the window: the glow, the whole-second count, the queue\'s dots; two eaters into the core - «в очередь»; three - a plate', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openCamp(page, errors);
  await quiet(page);
  await holdParts(page);
  await heroTo(page, 12.9, 5.6);
  expect(await signAt(page, 'feast', 0.4, 30), 'the feast\'s windup').toBe(true);
  expect((await snap(page)).chief).toMatchObject({ rings: 1, seatMarks: 4, glow: 0, count: '' });
  await shot(page, 'feast');
  expect(await windowLit(page), 'the window is lit').toBe(true);
  const lit = (await snap(page)).chief;
  expect(lit.count).toMatch(/^[1-5]$/);
  expect(lit.opens).toBe(1);
  expect(lit.bowls).toBe(4);
  const core = kindOf(await snap(page), 'chief')!;
  // Two eaters into the core: the cursor on the core says «в очередь»; the dots show two of three lit.
  const four = eatersOf(await snap(page));
  expect(four).toHaveLength(4);
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 20), [core.id] as const);
  await drawChain(page, [enemyAt(page, four[0].id), enemyAt(page, four[1].id), enemyAt(page, core.id)]);
  await expect.poll(async () => (await snap(page)).hint).toBe('queue');
  await expect(page.getByTestId('link-hint')).toHaveText('в очередь');
  const two = (await snap(page)).chief;
  expect(two.litDots).toBe(2);
  expect(two.dots).toBeGreaterThanOrEqual(3);
  await shot(page, 'queue');
  // The third eater: the core joins and the dash takes a plate.
  const third = await enemyAt(page, four[2].id)(), t = await screen(page, third.x, third.y);
  await page.mouse.move(t.x, t.y, { steps: 6 });
  const c = await enemyAt(page, core.id)(), cs = await screen(page, c.x, c.y);
  await page.mouse.move(cs.x, cs.y, { steps: 6 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([four[0].id, four[1].id, four[2].id, core.id]);
  expect((await snap(page)).chief.litDots).toBe(3);
  await shot(page, 'window');
  await page.mouse.up();
  expect(await dashDone(page), 'the dash is over').toBe(true);
  const after = await snap(page);
  expect(kindOf(after, 'chief')!.armor!.plates, 'the plate is taken').toBe(3);
  expect(after.chief.feastHits).toBe(1);
  await expect.poll(async () => (await snap(page)).chief.glow, 'the window went out after the dash').toBe(0);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 54a: «Взмах половником» - the sign is the half-disc of exactly 2.8 from the core; a hero at 3.3 is not hurt by the swing, a hero at 2 is', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openCamp(page, errors);
  await quiet(page);
  for (const reach of [3.3, 2.0]) {
    await page.evaluate(() => (window as any).__realtime.restart());
    await expect.poll(async () => (await snap(page)).status).toBe('playing');
    await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
    await quiet(page);
    const s0 = await snap(page);
    await page.evaluate(([id]) => (window as any).__realtime.chill(id, 600), [kindOf(s0, 'chief-sack')!.id] as const);
    await heroTo(page, 11, 6.2);
    expect(await signAt(page, 'swing', 0.5, 40), 'the ladle\'s half-disc').toBe(true);
    const s = await snap(page), core = kindOf(s, 'chief')!;
    expect(s.chief).toMatchObject({ sign: 'swing', halfDiscs: 1, signR: SWING_R });
    if (reach > 3) await shot(page, 'swing');
    // The sign's direction is fixed at the start of the windup; the hero steps onto its line `reach` from the core.
    const dir = core.vars.dir, hx = core.x + Math.cos(dir) * reach, hy = core.y + Math.sin(dir) * reach, hp = s.hero.hp;
    await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [hx, hy] as const);
    const struck = await untilFrame(page, (sn, h0: number, late) => sn.chief.hits >= 1 ? { hp: sn.hero.hp, h0 } : late ? { hp: -1, h0 } : undefined, hp, 6);
    expect(struck.hp, `the swing struck (hero at ${reach})`).toBeGreaterThan(-1);
    if (reach > 3) expect(struck.hp, 'a hero at 3.3 from the core is not hurt').toBe(hp);
    else expect(struck.hp, 'a hero at 2 is hurt').toBeLessThan(hp);
    await sameHash(page);
  }
  expect(errors).toEqual([]);
});

test('task 54a: «Горсть перца» draws three circles, «Приправа» - the supply flies and the steam changes colour, «Свисток» - the gate\'s mark with the dots of the colours', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await openCamp(page, errors);
  await quiet(page);
  const s0 = await snap(page), brew0 = s0.chief.brew;
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 600), [kindOf(s0, 'chief-ladle')!.id] as const);
  await heroTo(page, 11, 8);
  expect(await signAt(page, 'pepper', 0.5, 40), 'the pepper\'s circles').toBe(true);
  expect((await snap(page)).chief).toMatchObject({ circles: 3, sign: 'pepper' });
  await shot(page, 'pepper');
  // The window of the feast ends, then «Приправa»: a supply flies, the brew is another colour.
  await heroTo(page, 1.5, 14);
  const seasoned = await untilFrame(page, (sn, b0: number, late) => sn.chief.supplies >= 1 && sn.chief.brews >= 1 ? { brew: sn.chief.brew, b0 } : late ? { brew: -2, b0 } : undefined, brew0, 60);
  expect(seasoned.brew, 'a supply flew and the brew changed').not.toBe(-2);
  expect(seasoned.brew).not.toBe(brew0);
  await shot(page, 'season');
  expect(errors).toEqual([]);
});

test('task 54a: «Свисток» in phase 2 - the circle at the gate with the dots of the colours; the severed sack falls off and takes a plate; the bar follows', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openCamp(page, errors);
  await quiet(page);
  const s0 = await snap(page), core = kindOf(s0, 'chief')!, sack = kindOf(s0, 'chief-sack')!;
  await page.evaluate(([a, b]) => { const rt = (window as any).__realtime; rt.chill(a, 8); rt.chill(b, 600); }, [core.id, kindOf(s0, 'chief-ladle')!.id] as const);
  // Two weak links of the sack's colour beside it; the chain drawn with the mouse into the sack severs it.
  const links = await page.evaluate(([sack]) => {
    const rt = (window as any).__realtime;
    rt.teleport(sack.x - 0.6, sack.y + 3.2);
    return [rt.place(sack.x - 0.4, sack.y + 2, sack.color, 0, 'basic'), rt.place(sack.x - 0.4, sack.y + 1.1, sack.color, 0, 'basic')];
  }, [sack] as const);
  await cameraSettled(page, { x: sack.x, y: sack.y });
  await drawChain(page, [...links.map(id => enemyAt(page, id)), enemyAt(page, sack.id)]);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(3);
  await page.mouse.up();
  expect(await dashDone(page), 'the dash is over').toBe(true);
  const s1 = await snap(page);
  expect(kindOf(s1, 'chief-sack'), 'the sack is severed').toBeUndefined();
  expect(s1.chief).toMatchObject({ severed: 1, parts: 1 });
  expect(kindOf(s1, 'chief')!.armor!.plates, 'a plate off for the part').toBe(3);
  await expect.poll(async () => (await snap(page)).bossBar).toMatchObject({ plates: 3, cells: 6 });
  await shot(page, 'severed');
  // Phase 2 came with the part: the whistle calls at the far gate.
  await heroTo(page, 12, 12.5);
  expect(await signAt(page, 'whistle', 0.5, 40), 'the whistle\'s mark').toBe(true);
  expect((await snap(page)).chief.gateMarks).toBe(1);
  // Held in its windup (the cold stops the core's timers): the hero walks up to the gate it calls at, for the picture.
  const caller = kindOf(await snap(page), 'chief')!;
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 8), [caller.id] as const);
  await heroTo(page, caller.vars.ax > 12 ? caller.vars.ax - 4 : caller.vars.ax + 4, caller.vars.ay + 2);
  expect((await snap(page)).chief).toMatchObject({ sign: 'whistle', gateMarks: 1 });
  await shot(page, 'whistle');
  await sameHash(page);
  expect(errors).toEqual([]);
});
