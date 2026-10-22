import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { leaveResult } from './realtimeResult';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 57б «Лес: механики», the view (design 22.10.2026, docs/design-notes/task-57-forest-enemies.md, 12): the rootling «Корневик», the
 * slime «Слизень» and the firebrand «Головешка» in the sandbox (`?sandbox=1&arena=1`, the row y = 5.8 is open; `&arena=14` «Жаровни» for
 * the brazier), the kinds placed by the test hook (the run plays them once the arenas come). Real input at 1280×720: the mouse draws the
 * chain (the focus slows the world), the key 1 throws the cold at the pointer. The rules are the core's (`npm run
 * test:realtime-forest-tricks`); the drawing code is run against a real world in Node (`npm run test:realtime-forest-mech-view`). Here what
 * the player meets: rootlings cut lie as stumps with a countdown arc, the cold on a stump marks it, the chain through the rest of the group
 * shows «рассыплются» on its stumps and links and the dash crumbles them; two slimes of one colour touching show their pair and merge into
 * a big one; a lethal link on a burning firebrand shows «погаснет», the dash puts it out, it runs to the brazier and lights again; the
 * first meeting's caption of each kind (П8). The journal of each fight replays in Node to the page hash. Waits are in game time
 * (tests/realtimeFrames.ts); screenshots go to $SHOT_DIR when it is set.
 */
const ROOTLING_CAPTION = 'Корневик — встаёт из пня: руби всю группу разом';
const SLIME_CAPTION = 'Слизень — двое сливаются в большого: руби, пока малы';
const FIREBRAND_CAPTION = 'Головешка — звено её гасит; у жаровни разгорится снова';
const CENTIPEDE_CAPTION = 'Сороконожка — руби с конца: середина делит её надвое';

interface Shown {
  stumps: number; stumpArcs: number; stumpCold: number; stumpHero: number; stumpMove: number; stumpFill: number; stumpArt: number;
  leaves: number; groups: number; patterns: number; pairs: number; pairFill: number; bigSlimes: number;
  brandsBurning: number; brandsOut: number; brandsRelighting: number; relightFill: number;
  planCrumbleStumps: number; planCrumbleLinks: number; planDouses: number;
  lies: number; rises: number; crumbled: number; burns: number; merges: number; outs: number; lits: number; dropped: number;
  centiBodies: number; centiJoints: number; centiLanes: number; centiLaneFill: number; centiStunned: number; planCracks: number; planNewHeads: number;
  splits: number; heads: number; joins: number; lunges: number;
}
interface Snap {
  status: string; time: number; chain: number[]; moving: string | null; kills: number;
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; color: number; hp: number; vars: Record<string, number> }[];
  stumps: { id: number; x: number; y: number; group: number; left: number; full: number; waiting: string | null }[];
  forest: Shown;
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

async function openSandbox(page: Page, arena = 1): Promise<void> {
  await page.goto(`/?sandbox=1&arena=${arena}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

/**
 * Only what the test places acts: no newcomers, bodies stand, touches do not hurt, a wide focus — journalled commands, so the fight
 * replays in Node.
 */
async function quiet(page: Page, extra: [string, unknown][] = [], at: { x: number; y: number } = { x: 4.5, y: 5.8 }): Promise<{ x: number; y: number }> {
  await page.evaluate(({ more, p }) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['focusMax', 12], ...more] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(p.x, p.y);
  }, { more: extra, p: at });
  return at;
}
const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string, formation?: number): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind, formation]) => (window as any).__realtime.place(x, y, color, hp, kind, false, undefined, formation ?? undefined), [x, y, color, hp, kind, formation ?? null] as const);

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The screen point of an arena point now. */
const screenAt = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([a, b]) => (window as any).__realtime.toScreen(a, b), [x, y] as const);
async function screenOf(page: Page, id: number): Promise<{ x: number; y: number }> {
  const e = (await snap(page)).enemies.find(b => b.id === id)!;
  return screenAt(page, e.x, e.y);
}
/** The chain with the real mouse over the bodies `ids` in turn; the button stays down (the focus slows the world). */
async function holdChain(page: Page, ids: number[]): Promise<void> {
  const p0 = await screenOf(page, ids[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const id of ids.slice(1)) { const p = await screenOf(page, id); await page.mouse.move(p.x, p.y, { steps: 6 }); }
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
}
/** Releases the chain and waits (game time) for the dash's end. */
async function releaseChain(page: Page): Promise<void> {
  await page.mouse.up();
  await untilFrame(page, (s, _a: number, late) => (s.chain.length === 0 && !s.moving) || late ? true : undefined, 0, 8);
}

test('task 57б view: rootlings cut lie as stumps with an arc, the cold on a stump marks it, the chain through the rest of the group shows «рассыплются», the dash crumbles them; the journal replays', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['focusSlow', 0.1]]);
  const row: number[] = [];
  for (const dx of [1.4, 2.8, 4.2, 5.6]) row.push(await place(page, hero.x + dx, hero.y, 1, 0, 'rootling', 1));
  await untilFrame(page, (s, _a: number, late) => s.forest.leaves === 4 || late ? true : undefined, 0, 2);
  expect((await snap(page)).forest.groups).toBe(1);
  // Two of the four cut: two stumps, each with its countdown arc; the leaves stay on the bodies and the stumps.
  await holdChain(page, [row[0], row[1]]);
  await releaseChain(page);
  const lying = await snap(page);
  expect(lying.stumps).toHaveLength(2);
  expect(lying.forest.stumps).toBe(2);
  expect(lying.forest.stumpArcs).toBe(2);
  expect(lying.forest.leaves).toBe(4);
  await untilFrame(page, (s, _a: number, late) => s.forest.stumpFill > 0.3 || late ? true : undefined, 0, 4);
  await shot(page, 'rootling-stumps');
  // The cold at the first stump (the key 1 at the pointer): the cold's mark, its countdown waits.
  await page.evaluate(() => (window as any).__realtime.setItems('frost', 1));
  const st = lying.stumps.find(s => s.id === row[0])!, at = await screenAt(page, st.x, st.y);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press('Digit1');
  await untilFrame(page, (s, _a: number, late) => s.forest.stumpCold === 1 || late ? true : undefined, 0, 2);
  expect((await snap(page)).stumps.find(s => s.id === row[0])?.waiting).toBe('cold');
  await shot(page, 'rootling-stump-cold');
  // The chain through the other two: both stumps and both links show «рассыплются».
  await holdChain(page, [row[2], row[3]]);
  const plan = await snap(page);
  expect(plan.forest.planCrumbleStumps).toBe(2);
  expect(plan.forest.planCrumbleLinks).toBe(2);
  await shot(page, 'rootling-crumble-plan');
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.forest.crumbled === 4 || late ? true : undefined, 0, 2);
  const after = await snap(page);
  expect(after.forest.crumbled).toBe(4);
  expect(after.stumps).toHaveLength(0);
  expect(after.enemies.filter(e => e.kind === 'rootling')).toHaveLength(0);
  expect(after.forest.planCrumbleStumps).toBe(0);
  await shot(page, 'rootling-crumbled');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 57б view: two slimes of one colour touching — their pair is drawn while the clock runs, they merge into a big one; the journal replays', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page);
  await place(page, hero.x + 3, hero.y, 2, 0, 'slime');
  await place(page, hero.x + 3.5, hero.y, 2, 0, 'slime');
  await untilFrame(page, (s, _a: number, late) => (s.forest.pairs === 1 && s.forest.pairFill > 0.5) || late ? true : undefined, 0, 2);
  expect((await snap(page)).forest.pairs).toBe(1);
  await shot(page, 'slime-pair');
  await untilFrame(page, (s, _a: number, late) => s.forest.merges === 1 || late ? true : undefined, 0, 2);
  const big = await snap(page);
  expect(big.forest.merges).toBe(1);
  expect(big.enemies.filter(e => e.kind === 'slime')).toHaveLength(1);
  expect(big.enemies.find(e => e.kind === 'slime')!.hp).toBe(2);
  await untilFrame(page, (s, _a: number, late) => s.forest.bigSlimes === 1 || late ? true : undefined, 0, 1);
  expect((await snap(page)).forest.pairs).toBe(0);
  // A small one beside the big one, for the picture of the two sizes.
  await place(page, hero.x + 1.6, hero.y + 1.2, 2, 0, 'slime');
  await untilFrame(page, (s, _a: number, late) => s.enemies.filter((e: any) => e.kind === 'slime').length === 2 || late ? true : undefined, 0, 1);
  await shot(page, 'slime-big');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 57б view: a burning firebrand — «погаснет» on the lethal link, the dash puts it out, it runs to the brazier and lights again; the journal replays', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  // «Жаровни»: the middle brazier at (8, 4.6), the hero below it.
  await openSandbox(page, 14);
  const hero = await quiet(page, [['enemySpeed', 1.2], ['focusSlow', 0.1]], { x: 8, y: 7.5 });
  const brand = await place(page, hero.x - 1.2, hero.y - 0.6, 1, 0, 'firebrand');
  await untilFrame(page, (s, _a: number, late) => s.forest.brandsBurning === 1 || late ? true : undefined, 0, 1);
  await holdChain(page, [brand]);
  expect((await snap(page)).forest.planDouses).toBe(1);
  await shot(page, 'firebrand-douse-plan');
  await releaseChain(page);
  const out = await snap(page);
  expect(out.forest.outs).toBe(1);
  expect(out.enemies.find(e => e.id === brand)?.vars.fb).toBe(0);
  // Put out, it runs to the brazier (half way up: the dash's sparks have faded) — smoke over it.
  await untilFrame(page, (s, _a: number, late) => (s.forest.brandsOut === 1 && s.enemies.find((e: any) => e.kind === 'firebrand').y < 5.9) || late ? true : undefined, 0, 3);
  expect((await snap(page)).forest.brandsOut).toBe(1);
  await shot(page, 'firebrand-running');
  await untilFrame(page, (s, _a: number, late) => (s.forest.brandsRelighting === 1 && s.forest.relightFill > 0.4) || late ? true : undefined, 0, 6);
  expect((await snap(page)).forest.brandsRelighting).toBe(1);
  await shot(page, 'firebrand-relight');
  await untilFrame(page, (s, _a: number, late) => s.forest.lits === 1 || late ? true : undefined, 0, 2);
  const lit = await snap(page);
  expect(lit.forest.lits).toBe(1);
  expect(lit.enemies.find(e => e.id === brand)?.vars.fb).toBe(1);
  await shot(page, 'firebrand-lit');
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

test('task 57б-2 view: the centipede — its body with joints, «Рывок» strip through the windup; a chain drawn with the mouse into its middle shows the crack and «новая голова», the release divides it, the new head\'s stun stars; the journal replays', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['focusSlow', 0.1]]);
  const head = await place(page, hero.x + 3.6, hero.y, 2, 1, 'centipede');
  await untilFrame(page, (s, _a: number, late) => s.forest.centiJoints === 4 || late ? true : undefined, 0, 1);
  expect((await snap(page)).forest.centiBodies).toBe(1);
  // The first lunge 2 s after it came: the strip fills.
  await untilFrame(page, (s, _a: number, late) => (s.forest.centiLanes === 1 && s.forest.centiLaneFill > 0.5) || late ? true : undefined, 0, 4);
  expect((await snap(page)).forest.centiLanes).toBe(1);
  await shot(page, 'centipede-lane');
  await untilFrame(page, (s, _a: number, late) => (s.forest.lunges === 1 && s.forest.centiLanes === 0) || late ? true : undefined, 0, 3);
  // The hero beside the middle part; the chain of one into it with the real mouse (held: the focus slows the world).
  expect((await snap(page)).enemies.filter(e => e.kind === 'centipede')).toHaveLength(5);
  const order: { id: number; x: number; y: number; ca: number | null }[] = await page.evaluate(() => { const s = (window as any).__realtime.snapshot(); return s.enemies.filter((e: any) => e.kind === 'centipede').map((e: any) => ({ id: e.id, x: e.x, y: e.y, ca: e.vars.ca ?? null })); });
  // The parts in body order from the head (each knows the one ahead).
  const chainOrder: number[] = [head];
  while (chainOrder.length < order.length) { const next = order.find(p => p.ca === chainOrder[chainOrder.length - 1]); if (!next) break; chainOrder.push(next.id); }
  const middle = order.find(p => p.id === chainOrder[2])!;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [middle.x, middle.y + 1.2] as const);
  await holdChain(page, [middle.id]);
  const plan = await snap(page);
  expect(plan.forest.planCracks).toBe(1);
  expect(plan.forest.planNewHeads).toBe(1);
  await shot(page, 'centipede-split-plan');
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => (s.forest.splits === 1 && s.forest.centiStunned === 1) || late ? true : undefined, 0, 1);
  const split = await snap(page);
  expect(split.forest.splits).toBe(1);
  expect(split.forest.centiStunned).toBe(1);
  expect(split.forest.centiBodies).toBe(2);
  await shot(page, 'centipede-split-stun');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 57б view: the first meeting of each kind in a run fight gets its caption (П8), once', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await freshRun(page);
  await page.locator('[data-status="available"]').first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const placeKind = (kind: string): Promise<void> => page.evaluate(k => { const rt = (window as any).__realtime, h = rt.snapshot().hero; rt.place(h.x + 2.5, h.y, 1, 0, k); }, kind);
  const captions = async (): Promise<string[]> => (await snap(page)).captions.texts;
  for (const [kind, text] of [['rootling', ROOTLING_CAPTION], ['slime', SLIME_CAPTION], ['firebrand', FIREBRAND_CAPTION], ['centipede', CENTIPEDE_CAPTION]] as const) {
    await placeKind(kind);
    await expect.poll(captions).toContain(text);
    await shot(page, `caption-${kind}`);
    await expect.poll(async () => (await snap(page)).captions.live, { timeout: 6_000 }).toBe(0);
  }
  await placeKind('rootling');
  await page.waitForTimeout(400);
  expect((await captions()).filter(t => t === ROOTLING_CAPTION)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('task 57б view: the three kinds side by side and a stump — their art over the disc of the colour, two groups\' leaves (a snapshot)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  const hero = await quiet(page, [['focusSlow', 0.1]], { x: 8, y: 5.8 });
  await place(page, hero.x - 3, hero.y - 2.2, 1, 0, 'rootling', 1);
  await place(page, hero.x - 1, hero.y - 2.2, 3, 0, 'rootling', 2);
  await place(page, hero.x + 1, hero.y - 2.2, 2, 0, 'slime');
  await place(page, hero.x + 3, hero.y - 2.2, 4, 0, 'firebrand');
  // A second member of the first group, in reach of the hero: it is cut to lie as a stump.
  const a = await place(page, hero.x - 1.4, hero.y - 0.6, 1, 0, 'rootling', 1);
  await untilFrame(page, (s, _a: number, late) => s.forest.leaves === 3 || late ? true : undefined, 0, 1);
  const two = await snap(page);
  expect(two.forest.groups).toBe(2);
  expect(two.forest.patterns).toBe(2);
  // One of the first group cut: its stump beside the others.
  const pa = await screenOf(page, a);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([a]);
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.forest.stumps === 1 || late ? true : undefined, 0, 1);
  // The dash ended on the stump: the hero steps back for the picture.
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [hero.x, hero.y + 1.2] as const);
  await page.mouse.move(40, 40);
  // The cut body's death animation (real time) has played over the stump.
  await page.waitForTimeout(800);
  await shot(page, 'forest-mech-lineup');
  expect(errors).toEqual([]);
});
