import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 60а «Гости замка», the view (spec docs/design-notes/task-60-castle-enemies.md, 13): the guests in the sandbox's probes
 * (`?sandbox=1&arena=48…52`, cleared and placed by the test hook) and «Столовая» (the menu's sixth button of «Замок · гости», a real click).
 * Real input at 1280×720: the mouse draws the chains. The rules are the core's (`npm run test:realtime-castle-guests`); the drawing code is
 * run against a real world in Node (`npm run test:realtime-castle-guests-view`). Here what the player meets: the candelabra's topple strip
 * before the release and the topple; the butler's chandelier, a chain that kills him — «упадёт», the fall and the crash; the jester's ball
 * reflected by a chain drawn through it, caught (a bell out); the queen's lines and stars, the poltergeist's thrown barrels, the dining room
 * (screenshots). The journal of each fight replays in Node to the page hash. Waits are in game time; screenshots go to $SHOT_DIR.
 */
interface Shown {
  crossLight: number; crossSpin: number; fires: number; moves: number; starLines: number; stars: number; starsHanging: number;
  chandelier: number; drop: number; fall: number; lifted: number; flying: number; bellsLit: number; balls: number; ballsBack: number;
  planTopple: number; planCrushed: number; planReflects: number; planFall: number; topples: number; crashes: number; catches: number;
}
interface Snap {
  arena: string; status: string; time: number; chain: number[]; moving: string | null; menuOpen: boolean;
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; color: number; hp: number }[];
  shots: { id: number; kind: string; x: number; y: number; back?: number }[];
  guests: Shown;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/guests-${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function openProbe(page: Page, arena: number): Promise<void> {
  await page.goto(`/?sandbox=1&arena=${arena}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}
/** Nobody walks, no newcomers, touches do not hurt; the probe cleared and the hero put — journalled commands. */
async function quiet(page: Page, at: { x: number; y: number }, extra: [string, unknown][] = []): Promise<void> {
  await page.evaluate(({ p, more }) => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['focusMax', 12], ['focusSlow', 0.1], ...more] as [string, unknown][]) rt.setParam(k, v);
    rt.clear(false);
    rt.teleport(p.x, p.y);
  }, { p: at, more: extra });
}
const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}
async function screenOf(page: Page, id: number): Promise<{ x: number; y: number }> {
  return page.evaluate(i => { const rt = (window as any).__realtime, e = rt.snapshot().enemies.find((b: any) => b.id === i); return rt.toScreen(e.x, e.y); }, id);
}
async function holdChain(page: Page, ids: number[]): Promise<void> {
  const p0 = await screenOf(page, ids[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const id of ids.slice(1)) { const p = await screenOf(page, id); await page.mouse.move(p.x, p.y, { steps: 6 }); }
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
}
async function releaseChain(page: Page): Promise<void> {
  await page.mouse.up();
  await untilFrame(page, (s, _a: number, late) => (s.chain.length === 0 && !s.moving) || late ? true : undefined, 0, 8);
}

test('task 60а view: the candelabra — its cross lights and spins; a chain drawn with the mouse into it shows the topple\'s strip and the crushed, the release topples it; the journal replays (screenshots)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openProbe(page, 48);
  await quiet(page, { x: 11, y: 5 });
  const candle = await place(page, 8, 5, 0, 0, 'candelabra');
  await untilFrame(page, (s, _a: number, late) => s.guests.crossLight === 1 && s.guests.fires >= 6 || late ? true : undefined, 0, 4);
  expect((await snap(page)).guests.crossLight).toBe(1);
  await shot(page, 'cross-light');
  await untilFrame(page, (s, _a: number, late) => s.guests.crossSpin === 1 || late ? true : undefined, 0, 3);
  expect((await snap(page)).guests.fires).toBe(16);
  await shot(page, 'cross-spin');
  // A weak link east of it, two weak west in its fall's lane: the chain [weak, candelabra] topples it west.
  await page.evaluate(() => (window as any).__realtime.teleport(11.2, 5));
  const a = await place(page, 9.6, 5, 0, 0, 'basic');
  await place(page, 7.1, 5, 1, 0, 'basic'); await place(page, 6.2, 4.8, 2, 0, 'basic');
  await holdChain(page, [a, candle]);
  const plan = await snap(page);
  expect(plan.guests.planTopple).toBe(1);
  expect(plan.guests.planCrushed).toBe(2);
  await shot(page, 'topple-plan');
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.guests.topples === 1 || late ? true : undefined, 0, 2);
  expect((await snap(page)).guests.topples).toBe(1);
  await shot(page, 'topple');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 60а view: the butler\'s chandelier hangs over the hero with a wax mark; a chain drawn with the mouse that kills him shows «упадёт», the fall\'s ring and the crash; the journal replays (screenshots)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openProbe(page, 50);
  await quiet(page, { x: 11, y: 7 }, [['maxEnemies', 0]]);
  const butler = await place(page, 6, 3, 2, 1, 'butler');
  await untilFrame(page, (s, _a: number, late) => s.guests.chandelier === 1 || late ? true : undefined, 0, 5);
  await untilFrame(page, (s, _a: number, late) => s.guests.drop === 1 || late ? true : undefined, 0, 5);
  expect((await snap(page)).guests.drop).toBe(1);
  await shot(page, 'chandelier-drop');
  await page.evaluate(() => (window as any).__realtime.teleport(8.8, 3.6));
  const weak = await place(page, 7.4, 3.3, 2, 0, 'basic');
  await holdChain(page, [weak, butler]);
  expect((await snap(page)).guests.planFall).toBe(1);
  await shot(page, 'chandelier-plan');
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.guests.fall === 1 || late ? true : undefined, 0, 2);
  await shot(page, 'chandelier-fall');
  await untilFrame(page, (s, _a: number, late) => s.guests.crashes === 1 || late ? true : undefined, 0, 2);
  expect((await snap(page)).guests.crashes).toBe(1);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 60а view: the jester\'s ball — a chain drawn with the mouse through it shows its way back, the ball flies back and is caught (a bell out); the journal replays (screenshots)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openProbe(page, 52);
  // A slow ball (the speed is a param: the route has time to put the link; the rule is the same).
  await quiet(page, { x: 12, y: 6 }, [['jesterBall', 0.8]]);
  await place(page, 6.5, 6, 2, 2, 'jester');
  // The ball on its way to the hero, 1.3 from him: a link put behind it (as the Node check), the chain of one drawn through the ball.
  const near = await untilFrame(page, (s, _a: number, late) => { const b = s.shots.find((x: any) => x.kind === 'ball' && !x.back); return b && Math.hypot(b.x - s.hero.x, b.y - s.hero.y) < 1.3 ? b : late ? null : undefined; }, 0, 12);
  expect(near, 'the ball near the hero').not.toBeNull();
  const link = await page.evaluate(() => {
    const rt = (window as any).__realtime, s = rt.snapshot(), b = s.shots.find((x: any) => x.kind === 'ball' && !x.back), d = Math.hypot(b.x - s.hero.x, b.y - s.hero.y);
    return rt.place(s.hero.x + (b.x - s.hero.x) / d * 1.75, s.hero.y + (b.y - s.hero.y) / d * 1.75, 0, 0, 'basic') as number;
  });
  await shot(page, 'ball');
  const at = await screenOf(page, link);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([link]);
  expect((await snap(page)).guests.planReflects).toBe(1);
  await shot(page, 'reflect-plan');
  await releaseChain(page);
  await untilFrame(page, (s, _a: number, late) => s.guests.ballsBack === 1 || s.guests.catches > 0 || late ? true : undefined, 0, 3);
  await shot(page, 'ball-back');
  await untilFrame(page, (s, _a: number, late) => s.guests.catches > 0 || late ? true : undefined, 0, 4);
  expect((await snap(page)).guests.catches).toBe(1);
  expect((await snap(page)).guests.bellsLit).toBe(2);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 60а view: the signs — the queen\'s move, her eight lines and stars; the poltergeist\'s lifted and thrown barrels; «Столовая» opened from the menu (screenshots)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openProbe(page, 49);
  await quiet(page, { x: 8, y: 8.4 });
  await place(page, 8, 4, 1, 2, 'queen');
  await untilFrame(page, (s, _a: number, late) => s.guests.moves === 1 || late ? true : undefined, 0, 4);
  await shot(page, 'queen-move');
  await untilFrame(page, (s, _a: number, late) => s.guests.starLines === 8 || late ? true : undefined, 0, 6);
  expect((await snap(page)).guests.starLines).toBe(8);
  await shot(page, 'queen-lines');
  await untilFrame(page, (s, _a: number, late) => s.guests.starsHanging > 0 || late ? true : undefined, 0, 3);
  await shot(page, 'queen-stars');
  await openProbe(page, 51);
  await quiet(page, { x: 13, y: 6 }, [['poltergeistPeriod', 1]]);
  await place(page, 8, 5, 3, 0, 'poltergeist'); await place(page, 8, 7.2, 0, 0, 'barrel'); await place(page, 6.2, 5.6, 0, 0, 'barrel');
  await untilFrame(page, (s, _a: number, late) => s.guests.lifted === 2 || late ? true : undefined, 0, 4);
  expect((await snap(page)).guests.lifted).toBe(2);
  await shot(page, 'poltergeist-lift');
  await untilFrame(page, (s, _a: number, late) => s.guests.flying >= 1 || late ? true : undefined, 0, 3);
  await shot(page, 'poltergeist-throw');
  // «Столовая»: the sixth button of the group «Замок · гости», a real click.
  await page.goto('/?sandbox=1');
  await page.getByTestId('guests-arena-6').click();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.snapshot().arena)).toBe('c-dining');
  await page.waitForTimeout(2500);
  await shot(page, 'dining');
  expect(errors).toEqual([]);
});
