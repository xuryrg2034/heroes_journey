import { type Page } from '@playwright/test';
import { expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';

/**
 * The warlock hall's shared route (tests/realtime-warlock.spec.ts, realtime-corepick.spec.ts, realtime-bosspick.spec.ts; one copy): the wardrobe of his charm
 * shoved north into the wall by the real mouse until it breaks, and the charm falls. Not a spec file (the realtime config's `testMatch` does not pick it up).
 *
 * A shove may stop short of the wall at a body of the crowd on its lane (the hall's crowd is the default 0.9; a body stops the thing, is struck, the thing's durability stays:
 * sim/shove.ts). The test reads the stop from the plan the highlight shows before the release (`snapshot().castle.preview`, `ChainPlan.shove`): `stop` 'wall' — the wall is
 * waited for and wears the thing; `stop` 'body' with its `target` — the shove is made, the same one is repeated from the new place (at most `ATTEMPTS` shoves a call) and the
 * target must be dead (the plan's impact says it is killed); any other stop fails with the plan. After every shove the thing stands where the plan said and its durability is
 * the plan's `wear` — the highlight is the execution.
 */
interface Thing { id: number; kind: string; x: number; y: number; durability: number }
export interface Plan { thing: number; to: { x: number; y: number }; stop: string; target: number | null; impact: { killed: boolean } | null; wear: { id: number; left: number }[]; breaks: number[] }
interface RouteSnap { chain: number[]; moving: string | null; castle: { things: Thing[]; shoves: unknown[]; preview: Plan | null }; enemies: { id: number; kind: string; hp: number }[]; warlock: { state: { wardrobe: number | null; phase: number } | null } }

const snap = (page: Page): Promise<RouteSnap> => page.evaluate(() => (window as any).__realtime.snapshot());
/** At most this many shoves a call. */
export const ATTEMPTS = 3;
/** The thing stands where the plan said, within this (units). */
const PLACE_TOL = 0.15;

async function cameraSettled(page: Page): Promise<void> {
  const still = await untilFrame(page, (_snap, _arg: null, late, rt) => {
    const h = rt.snapshot().hero, s = rt.toScreen(h.x, h.y), w = window as any, last = w.__routeCam;
    w.__routeCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__routeCam.n >= 5 ? true : late ? false : undefined;
  }, null, 4);
  expect(still, 'the camera came to rest').toBe(true);
}

/** One shove of the thing north from right below it: the mouse presses on it, the plan is read, the mouse lets go; waits for the run to end. */
async function shoveOnce(page: Page, id: number): Promise<{ before: Thing; plan: Plan }> {
  const s0 = await snap(page), first = s0.castle.things.find(t => t.id === id)!;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y + 1), [first.x, first.y] as const);
  await cameraSettled(page);
  const before = (await snap(page)).castle.things.find(t => t.id === id)!;
  const t = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [before.x, before.y] as const);
  await page.mouse.move(t.x, t.y, { steps: 3 });
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await expect.poll(async () => (await snap(page)).castle.preview?.thing, { message: 'the shove plan of the drawn chain is shown' }).toBe(id);
  const plan = JSON.parse(JSON.stringify((await snap(page)).castle.preview)) as Plan;
  await page.mouse.up();
  const done = await untilFrame(page, (sn, _arg: null, late) => sn.castle.shoves.length === 0 && sn.moving === null ? { ok: true } : late ? { ok: false } : undefined, null, 10);
  expect(done.ok, 'the shove is over').toBe(true);
  return { before, plan };
}

/**
 * The wardrobe shoved north until the wall has worn it (`result` 'wall': its durability fell) or broken it ('broke': it is gone), at most `ATTEMPTS` shoves; a stop at a body is let go
 * as the file's note says, any other stop fails. `plans` — the plan of every shove made, in order (a test that puts a body on the lane reads the body stop there).
 */
export async function wardrobeRoute(page: Page, id: number): Promise<{ result: 'wall' | 'broke'; plans: Plan[] }> {
  const plans: Plan[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { before, plan } = await shoveOnce(page, id);
    plans.push(plan);
    const now = await snap(page), after = now.castle.things.find(t => t.id === id), said = `the plan ${JSON.stringify(plan)}`;
    if (plan.stop !== 'wall' && !(plan.stop === 'body' && plan.target !== null)) throw new Error(`the wardrobe ${id} was to stop neither at the wall nor at a body: ${said}`);
    // The highlight is the execution: the thing is where the plan said, its durability is the plan's.
    const left = plan.wear.find(w => w.id === id)?.left;
    if (plan.breaks.includes(id)) {
      expect(after, `the plan broke the wardrobe, it is gone (${said})`).toBeUndefined();
      return { result: 'broke', plans };
    }
    expect(after, `the wardrobe stands (${said})`).toBeDefined();
    expect(Math.hypot(after!.x - plan.to.x, after!.y - plan.to.y), `the wardrobe stands where the plan said (${said})`).toBeLessThan(PLACE_TOL);
    expect(after!.durability, `its durability is the plan's (${said})`).toBe(left);
    if (plan.stop === 'wall') { expect(after!.durability, `the wall wore it (${said})`).toBeLessThan(before.durability); return { result: 'wall', plans }; }
    // A stop at a body: the durability stays, the target is dead, the same shove is made again.
    expect(after!.durability, `the body did not wear it (${said})`).toBe(before.durability);
    expect(plan.impact?.killed, `the plan says the body is killed (${said})`).toBe(true);
    const target = now.enemies.find(e => e.id === plan.target);
    expect(target === undefined || target.hp <= 0, `the stopping body ${plan.target} died (${said})`).toBe(true);
  }
  throw new Error(`the wardrobe ${id} did not reach the wall in ${ATTEMPTS} shoves (bodies stopped it every time)`);
}

/** `wardrobeRoute`'s result only. */
export const wardrobeToWall = async (page: Page, id: number): Promise<'wall' | 'broke'> => (await wardrobeRoute(page, id)).result;

/** Breaks his wardrobe at the north wall (the wall wears it, then breaks it) and waits for the charm to fall. */
export async function breakCharm(page: Page): Promise<void> {
  const id = (await snap(page)).warlock.state!.wardrobe!;
  expect(await wardrobeToWall(page, id), 'the first stop at the wall wears the wardrobe').toBe('wall');
  expect((await snap(page)).castle.things.find(t => t.id === id)?.durability, 'the wall wore the wardrobe to 1').toBe(1);
  expect(await wardrobeToWall(page, id), 'the second stop at the wall breaks it').toBe('broke');
  const fell = await untilFrame(page, (sn, _arg: null, late) => sn.warlock.state?.phase === 2 ? true : late ? false : undefined, null, 4);
  expect(fell, 'the charm fell').toBe(true);
}
