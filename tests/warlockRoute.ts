import { type Page } from '@playwright/test';
import { expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';

/**
 * The warlock hall's shared route (tests/realtime-warlock.spec.ts, realtime-corepick.spec.ts, realtime-bosspick.spec.ts; one copy): the wardrobe of his charm
 * shoved north into the wall by the real mouse until it breaks, and the charm falls. Not a spec file (the realtime config's `testMatch` does not pick it up).
 *
 * A shove may stop short of the wall at a body of the crowd on its lane (the hall's crowd is the default 0.9; a body stops the thing, is struck and dies, the thing's
 * durability stays: sim/shove.ts). Then the same shove is made again from its new place, at most `ATTEMPTS` shoves a call. Only that stop is let go, and the test proves it:
 * before the shove a body stood on the lane north of the wardrobe, after it the wardrobe stands one contact distance short of that body's place (the body is gone) and
 * its durability is the same. Any other stop (no body, another distance, the wardrobe not moved) fails the test with the numbers. The wall's own stop is the one
 * that wears it: «the wall wore the wardrobe» is asserted on the shove that reached the wall.
 */
interface Thing { id: number; kind: string; x: number; y: number; durability: number }
interface Body { id: number; x: number; y: number }
interface RouteSnap { chain: number[]; moving: string | null; castle: { things: Thing[]; shoves: unknown[] }; enemies: (Body & { kind: string })[]; warlock: { state: { wardrobe: number | null; phase: number } | null } }

const snap = (page: Page): Promise<RouteSnap> => page.evaluate(() => (window as any).__realtime.snapshot());
/** At most this many shoves a call. */
export const ATTEMPTS = 3;
/** The lane's half-width and the contact distance of a thing stopped at a body (measured 0.67, with room). */
const LANE_HALF = 0.8, CONTACT_MIN = 0.4, CONTACT_MAX = 1.1;

async function cameraSettled(page: Page): Promise<void> {
  const still = await untilFrame(page, (_snap, _arg: null, late, rt) => {
    const h = rt.snapshot().hero, s = rt.toScreen(h.x, h.y), w = window as any, last = w.__routeCam;
    w.__routeCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__routeCam.n >= 5 ? true : late ? false : undefined;
  }, null, 4);
  expect(still, 'the camera came to rest').toBe(true);
}

/** One shove of the thing north from right below it: the mouse presses on it and lets go; waits for the run to end. Returns the thing and the lane's bodies before it. */
async function shoveOnce(page: Page, id: number): Promise<{ before: Thing; lane: Body[] }> {
  const s0 = await snap(page), first = s0.castle.things.find(t => t.id === id)!;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y + 1), [first.x, first.y] as const);
  await cameraSettled(page);
  const s1 = await snap(page), before = s1.castle.things.find(t => t.id === id)!;
  const lane = s1.enemies
    .filter(e => e.kind !== 'wardrobe' && e.kind !== 'barrel' && e.kind !== 'warlock' && Math.abs(e.x - before.x) < LANE_HALF && e.y < before.y - 0.3)
    .map(e => ({ id: e.id, x: e.x, y: e.y }));
  const t = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [before.x, before.y] as const);
  await page.mouse.move(t.x, t.y, { steps: 3 });
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await page.mouse.up();
  const done = await untilFrame(page, (sn, _arg: null, late) => sn.castle.shoves.length === 0 && sn.moving === null ? { ok: true } : late ? { ok: false } : undefined, null, 10);
  expect(done.ok, 'the shove is over').toBe(true);
  return { before, lane };
}

/**
 * The wardrobe shoved north until the wall has worn it (`'wall'`: its durability fell) or broken it (`'broke'`: it is gone), at most `ATTEMPTS` shoves; a stop at a body of the
 * crowd is let go once it is proved (see the file's note), any other stop fails.
 */
export async function wardrobeToWall(page: Page, id: number): Promise<'wall' | 'broke'> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { before, lane } = await shoveOnce(page, id);
    const now = await snap(page), after = now.castle.things.find(t => t.id === id);
    if (!after) return 'broke';
    if (after.durability < before.durability) return 'wall';
    const stoppedAt = lane.find(b => b.y < before.y && after.y > b.y && after.y - b.y >= CONTACT_MIN && after.y - b.y <= CONTACT_MAX);
    const gone = stoppedAt ? !now.enemies.some(e => e.id === stoppedAt.id) : false;
    if (!stoppedAt || !gone || after.y >= before.y - 0.2) {
      throw new Error(`the wardrobe ${id} stopped neither at the wall nor at a body: from (${before.x.toFixed(2)}, ${before.y.toFixed(2)}) durability ${before.durability} to (${after.x.toFixed(2)}, ${after.y.toFixed(2)}) durability ${after.durability}; lane bodies before: ${JSON.stringify(lane)}; the stopping body: ${stoppedAt ? `${stoppedAt.id} ${gone ? 'is gone' : 'still stands'}` : 'none at a contact distance'}`);
    }
  }
  throw new Error(`the wardrobe ${id} did not reach the wall in ${ATTEMPTS} shoves (bodies stopped it every time)`);
}

/** Breaks his wardrobe at the north wall (the wall wears it, then breaks it) and waits for the charm to fall. */
export async function breakCharm(page: Page): Promise<void> {
  const id = (await snap(page)).warlock.state!.wardrobe!;
  expect(await wardrobeToWall(page, id), 'the first stop at the wall wears the wardrobe').toBe('wall');
  expect((await snap(page)).castle.things.find(t => t.id === id)?.durability, 'the wall wore the wardrobe to 1').toBe(1);
  expect(await wardrobeToWall(page, id), 'the second stop at the wall breaks it').toBe('broke');
  const fell = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.state?.phase === 2 ? true : late ? false : undefined, null, 4);
  expect(fell, 'the charm fell').toBe(true);
}
