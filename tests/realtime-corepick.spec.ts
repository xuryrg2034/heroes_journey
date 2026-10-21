import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * «Ядро в окне — первым» (`Params.corePickFirst`, design 21.10.2026; the user's complaint «не могу взять Тролля»), by real input at 1280×720: the
 * pointer in the ring of a boss core whose window is open takes the core even when a body of another colour stands nearer to the pointer — a
 * press there starts the chain [core] and the cursor shows no refusal; with the window shut the same press takes the body. The bodies are
 * put by the journal's own `place` (and frozen by `chill`, so they stay where they were put), the hero by `teleport`; the core is frozen by
 * `chill` once its window is open, so the window waits for the mouse. The warlock's window comes after his wardrobe is shoved into the wall
 * twice by the mouse (the route of tests/realtime-warlock.spec.ts); the Troll's after «Удар дубиной» (tests/realtime-troll.spec.ts). The Chief
 * is left out: his window takes a feast and a queue of the brew's colour, a route too long for a check of the pick. The rules are in Node
 * (`npm run test:realtime-warlock-view`, `test:realtime-troll-view`); here the player's press. The crowd is the default. Added 21.10.2026 by the ui
 * session on branch ui/core-pick.
 */
interface Shot {
  hint: string | null; chain: number[]; moving: string | null; time: number; arena: string; menuOpen: boolean;
  hero: { x: number; y: number };
  enemies: { id: number; kind: string; x: number; y: number; armor: { plates: number } | null }[];
  castle: { things: { id: number; x: number; y: number; durability: number }[]; shoves: unknown[] };
  warlock: { state: { id: number; x: number; y: number; wardrobe: number | null; shift: { candle: number } | null; window: { open: boolean; hit: boolean } | null; candles: { x: number; y: number }[]; candle: number; phase: number } | null };
  troll: { glow: number };
  bossBar: { plates: number };
}
const snap = (page: Page): Promise<Shot> => page.evaluate(() => (window as any).__realtime.snapshot());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/corepick-${name}.png` }); };

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

/** The screen point of the first point of `at` read when the mouse moves (the camera glides). */
async function mouseTo(page: Page, at: () => Promise<{ x: number; y: number }>, steps = 4): Promise<void> {
  const p = await at(), t = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [p.x, p.y] as const);
  await page.mouse.move(t.x, t.y, { steps });
}
const enemyAt = (page: Page, id: number) => async (): Promise<{ x: number; y: number }> => (await snap(page)).enemies.find(e => e.id === id)!;

async function cameraSettled(page: Page): Promise<void> {
  const still = await untilFrame(page, (_snap, _arg: null, late, rt) => {
    const h = rt.snapshot().hero, s = rt.toScreen(h.x, h.y), w = window as any, last = w.__pickCam;
    w.__pickCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__pickCam.n >= 5 ? true : late ? false : undefined;
  }, null, 4);
  expect(still, 'the camera came to rest').toBe(true);
}

/**
 * A body of another colour (1) put at the core and frozen; it is let go for a few frames, the solid bodies push it to their contact distance.
 * Returns the body and the pointer point: inside the core's press ring (`pickRadius`, the sim's number) and nearer to the body than to the
 * core, on the line from the core to the body — the pointer for which the rule and the nearest pick differ. Both are checked here, before the click.
 */
async function bodyAndPointer(page: Page, core: { id: number; x: number; y: number }): Promise<{ body: number; at: { x: number; y: number } }> {
  const body = await page.evaluate(([x, y]) => { const rt = (window as any).__realtime, id = rt.place(x, y + 0.5, 1, 0, 'basic'); rt.chill(id, 60); return id; }, [core.x, core.y] as const);
  await gameWait(page, 0.4);
  const b = await enemyAt(page, body)(), ring = await page.evaluate(([id]) => (window as any).__realtime.pickRadius(id), [core.id] as const) as number;
  const d = Math.hypot(b.x - core.x, b.y - core.y);
  expect(d / 2, 'the contact distance leaves room inside the ring').toBeLessThan(ring);
  const t = Math.min((d / 2 + ring) / 2, d), at = { x: core.x + (b.x - core.x) / d * t, y: core.y + (b.y - core.y) / d * t };
  expect(Math.hypot(at.x - core.x, at.y - core.y), 'the pointer is inside the core ring').toBeLessThan(ring);
  expect(Math.hypot(at.x - b.x, at.y - b.y), 'the pointer is nearer to the body than to the core').toBeLessThan(Math.hypot(at.x - core.x, at.y - core.y));
  return { body, at };
}

/**
 * The scene: the core stands with its window open (frozen), the hero a unit away with the body on the core. The press on the body takes the
 * core: the chain is [core] and the cursor shows no refusal; the dash takes a plate; then, with the window shut, a new body on the core is
 * the one a press takes.
 */
async function pressOnBody(page: Page, core: { id: number; x: number; y: number }, plates: number): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x - 0.6, y + 1.1), [core.x, core.y] as const);
  await cameraSettled(page);
  const { at } = await bodyAndPointer(page, core);
  await mouseTo(page, async () => at);
  // The cursor on the body in the core's ring: no refusal.
  await expect.poll(async () => (await snap(page)).hint, { message: 'no refusal at the cursor' }).toBeNull();
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'the press took the core, not the nearer body' }).toEqual([core.id]);
  await shot(page, 'window-press');
  await page.mouse.up();
  const done = await untilFrame(page, (s, _arg: null, late) => s.moving === null && s.chain.length === 0 ? true : late ? false : undefined, null, 12);
  expect(done, 'the dash is over').toBe(true);
  expect((await snap(page)).bossBar.plates, 'a plate was taken').toBe(plates - 1);
}

/**
 * The negative check: the same press with the key off (`corePickFirst` false by the sandbox's own `setParam`, journalled) takes the body — the
 * nearest — so the test tells the rule from the nearest pick. A body of another colour is a fine first link of an empty chain. The key is on again after.
 */
async function pressWithKeyOff(page: Page, core: { id: number; x: number; y: number }): Promise<void> {
  await page.evaluate(() => (window as any).__realtime.setParam('corePickFirst', false));
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x - 0.6, y + 1.1), [core.x, core.y] as const);
  await cameraSettled(page);
  const { body, at } = await bodyAndPointer(page, core);
  await mouseTo(page, async () => at);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'key off: the press takes the nearest — the body' }).toEqual([body]);
  await page.mouse.up();
  const done = await untilFrame(page, (s, _arg: null, late) => s.moving === null && s.chain.length === 0 ? true : late ? false : undefined, null, 12);
  expect(done, 'the dash is over').toBe(true);
  await page.evaluate(() => (window as any).__realtime.setParam('corePickFirst', true));
}

async function shutPress(page: Page, core: { id: number; x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x - 0.6, y + 1.1), [core.x, core.y] as const);
  await cameraSettled(page);
  const { body, at } = await bodyAndPointer(page, core);
  await mouseTo(page, async () => at);
  await expect.poll(async () => (await snap(page)).hint, { message: 'a body is taken: no refusal' }).toBeNull();
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain, { message: 'the window is shut: the press takes the body' }).toEqual([body]);
  await shot(page, 'shut-press');
  await page.mouse.up();
  const done = await untilFrame(page, (s, _arg: null, late) => s.moving === null && s.chain.length === 0 ? true : late ? false : undefined, null, 12);
  expect(done, 'the dash is over').toBe(true);
}

// ---- The Troll ----

test('«Ядро в окне — первым»: the Troll — in the window a press on the body that stands on his core takes the core; shut, the same press takes the body', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=30');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('troll');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(k, v);
  });
  const s0 = await snap(page), core = s0.enemies.find(e => e.kind === 'troll')!;
  // Shut first: before the club's blow the window is closed; a body on the core is the pick.
  await page.evaluate(([rock]) => (window as any).__realtime.chill(rock, 600), [s0.enemies.find(e => e.kind === 'troll-rock')!.id] as const);
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 3), [core.id] as const);
  await shutPress(page, core);
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 0), [core.id] as const);
  // The club's blow opens his window; then he is frozen so it stays.
  await page.evaluate(() => (window as any).__realtime.teleport(12, 6.5));
  const lit = await untilFrame(page, (s, _arg: null, late, rt) => s.troll.glow === 1 ? (rt.chill(s.enemies.find((e: any) => e.kind === 'troll').id, 30), true) : late ? false : undefined, null, 25);
  expect(lit, 'the window is lit').toBe(true);
  await pressWithKeyOff(page, core);
  await pressOnBody(page, core, 4);
  await sameHash(page);
  expect(errors).toEqual([]);
});

// ---- The warlock ----

test('«Ядро в окне — первым»: the warlock — in his window a press on the body that stands on his core takes the core; shut, the same press takes the body', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('castle-arena-4').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('c-warlock');
  await expect.poll(async () => (await snap(page)).menuOpen).toBe(false);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['wardrobePeriod', 1000], ['shoveDistance', 6]] as const) rt.setParam(k, v);
  });
  await cameraSettled(page);
  // His wardrobe into the wall twice (the mouse presses on it; the hero stands right below).
  const wardrobe = (await snap(page)).warlock.state!.wardrobe!;
  for (let i = 0; i < 2; i++) {
    const w = (await snap(page)).castle.things.find(t => t.id === wardrobe)!;
    await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y + 1), [w.x, w.y] as const);
    await cameraSettled(page);
    await mouseTo(page, async () => (await snap(page)).castle.things.find(t => t.id === wardrobe)!, 3);
    await page.mouse.down();
    await expect.poll(async () => (await snap(page)).chain).toEqual([wardrobe]);
    await page.mouse.up();
    const done = await untilFrame(page, (s, _arg: null, late) => s.castle.shoves.length === 0 && s.moving === null ? true : late ? false : undefined, null, 10);
    expect(done, 'the shove is over').toBe(true);
  }
  const fell = await untilFrame(page, (s, _arg: null, late) => s.warlock.state?.phase === 2 ? true : late ? false : undefined, null, 4);
  expect(fell, 'the charm fell').toBe(true);
  // The window of the next arrival: the moment it opens the core is frozen (the window waits for the mouse). First, shut: the window of an arrival
  // that has not come yet is closed — a body on the core is the pick (the core is frozen at once so no arrival comes meanwhile).
  const st = (await snap(page)).warlock.state!;
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 3), [st.id] as const);
  await shutPress(page, { id: st.id, x: st.x, y: st.y });
  await page.evaluate(([id]) => (window as any).__realtime.chill(id, 0), [st.id] as const);
  const open = await untilFrame(page, (s, _arg: null, late, rt) => s.warlock.state?.window?.open ? (rt.chill(s.warlock.state.id, 30), s.warlock.state) : late ? null : undefined, null, 12);
  expect(open, 'the window opened').not.toBeNull();
  await pressWithKeyOff(page, open as { id: number; x: number; y: number });
  await pressOnBody(page, open as { id: number; x: number; y: number }, 4);
  await gameWait(page, 0.2);
  await sameHash(page);
  expect(errors).toEqual([]);
});
