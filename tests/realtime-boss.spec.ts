import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 27 «Каркас босса и Тюремщик в песочнице» (design 15.10.2026, docs/design-notes/tasks-26-28.md): the view of the flail
 * Jailer on its sandbox arena (⇧9, `?arena=19`) — the illustration, the weight on its chain, the move signs, the plate pips,
 * the «отрубит» pip, the chain falling when the weight is severed, «−1 пластина» over the core after the dash. Real input: the
 * player draws the chain with the mouse. Runs through playwright.realtime.config.ts only; the rules are checked in Node
 * (`npm run test:realtime-jailer`).
 */
interface BossView { flail: number; throw: number; whistle: number; chains: number; severPips: number; severLit: number; hits: number; breaks: number; plates: number; colorless: number; coreRing: number }
interface Snap {
  arena: string;
  status: string;
  chain: number[];
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; partOf: number | null; armor: { plates: number; max: number } | null }[];
  boss: BossView;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

async function openJailer(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=19');
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('jailer');
}

/** No newcomers, nobody walks, touches do not hurt — journalled commands only, so the fight replays in Node. */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(k, v);
  });
}

/**
 * «Застава» is larger than the screen: after a teleport the camera glides to the hero. Waits (frame by frame, in game time) until
 * the screen point of arena point (x, y) holds still for 5 frames, so a press lands where the test reads it.
 */
async function cameraSettled(page: Page, at: { x: number; y: number }): Promise<void> {
  const still = await untilFrame(page, (_snap, p: { x: number; y: number }, late, rt) => {
    const s = rt.toScreen(p.x, p.y), w = window as any, last = w.__bossCam;
    w.__bossCam = { x: s.x, y: s.y, n: last && Math.abs(last.x - s.x) < 0.5 && Math.abs(last.y - s.y) < 0.5 ? last.n + 1 : 0 };
    return w.__bossCam.n >= 5 ? true : late ? false : undefined;
  }, at, 3);
  expect(still, 'the camera came to rest').toBe(true);
}

/** Press at the first point (once the camera rests) and drag through the rest (each read just before the pointer goes there). */
async function drawChain(page: Page, points: (() => Promise<{ x: number; y: number }>)[]): Promise<void> {
  const first = await points[0]();
  await cameraSettled(page, first);
  const at0 = await screen(page, first.x, first.y);
  await page.mouse.move(at0.x, at0.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const p = await point(), at = await screen(page, p.x, p.y);
    await page.mouse.move(at.x, at.y, { steps: 6 });
  }
}

test('task 27: the sandbox menu has «Тюремщик» under the boss heading (⇧9); the arena shows the core, its weight on a chain and their plate pips', async ({ page }) => {
  const errors: string[] = [];
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('boss-arena-1')).toContainText('Тюремщик');
  await expect(page.getByTestId('boss-arena-1').locator('kbd')).toHaveText('⇧9');
  await openJailer(page, errors);
  const s = await snap(page);
  const core = s.enemies.find(e => e.kind === 'jailer')!, weight = s.enemies.find(e => e.kind === 'jailer-weight')!;
  expect(weight.partOf).toBe(core.id);
  expect(core.armor).toMatchObject({ plates: 3, max: 3 });
  expect(weight.armor).toMatchObject({ plates: 1, max: 1 });
  await expect.poll(async () => (await snap(page)).boss.chains).toBe(1);
  expect(errors).toEqual([]);
});

test('task 27: a chain through the weight severs it — the plate first, then «отрубит» blinks on the core, the chain falls, the core loses a plate after the dash; the browser fight replays in Node to the same hash', async ({ page }) => {
  const errors: string[] = [];
  await openJailer(page, errors);
  await quiet(page);
  const ids = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.clear(false);
    rt.teleport(6, 6);
    return { core: rt.place(10, 6, 1, 2, 'jailer'), weight: rt.place(10, 6, 0, 3, 'jailer-weight') };
  });
  const enemy = async (id: number): Promise<{ x: number; y: number }> => (await snap(page)).enemies.find(e => e.id === id)!;
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === ids.weight)?.partOf).toBe(ids.core);
  await expect.poll(async () => (await snap(page)).boss.chains).toBe(1);
  // Once the core faces the hero (west), it is frozen: no moves and no turning while the test draws (the weight stays in its
  // hand where it is; the hero stays west of it). It thaws for the snapshot of the plan only.
  await gameWait(page, 0.35);
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 60), [ids.core] as const);

  // Chain 1: [a1, weight] takes the weight's plate (the plate badge, no «отрубит»).
  let w = await enemy(ids.weight);
  const a1 = await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; rt.teleport(x - 2.8, y); return rt.place(x - 1.4, y, 0, 0, 'basic'); }, [w.x, w.y] as const);
  await drawChain(page, [() => enemy(a1), () => enemy(ids.weight)]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, ids.weight]);
  expect((await snap(page)).boss.severPips).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === ids.weight)?.armor?.plates, { timeout: 5_000 }).toBe(0);

  // Chain 2: three links before the weight and one after — enough to cut through its 3 HP: «отрубит» blinks on the core.
  await expect.poll(async () => (await snap(page)).chain.length).toBe(0);
  w = await enemy(ids.weight);
  const helpers = await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    rt.teleport(x - 4.4, y);
    return [rt.place(x - 3.3, y, 0, 0, 'basic'), rt.place(x - 2.2, y, 0, 0, 'basic'), rt.place(x - 1.1, y, 0, 0, 'basic')];
  }, [w.x, w.y] as const);
  await drawChain(page, [...helpers.map(id => () => enemy(id)), () => enemy(ids.weight)]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([...helpers, ids.weight]);
  await expect.poll(async () => (await snap(page)).boss.severPips).toBe(1);
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 0), [ids.core] as const);
  await gameWait(page, 0.05);
  // The snapshot in the ring's lit phase (it blinks 4 times a second).
  expect(await untilFrame(page, snap => snap.boss.severLit > 0 ? true : undefined, null, 2)).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-boss-sever-plan.png' });
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 60), [ids.core] as const);
  const coreBefore = (await snap(page)).enemies.find(e => e.id === ids.core)!;
  expect(coreBefore.armor?.plates).toBe(3);
  await page.mouse.up();

  // The weight is gone, its chain fell apart, the core lost one plate after the dash and «−1 пластина» stood over it.
  await expect.poll(async () => (await snap(page)).enemies.some(e => e.id === ids.weight), { timeout: 5_000 }).toBe(false);
  await expect.poll(async () => (await snap(page)).boss.breaks).toBe(1);
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === ids.core)?.armor?.plates, { timeout: 5_000 }).toBe(2);
  await expect.poll(async () => (await snap(page)).boss.plates).toBe(1);
  expect((await snap(page)).boss.chains).toBe(0);

  // The fight after the weight is severed: the core thaws and runs at the hero shield first (×1.3); the weight's moves never
  // come again — no flail half disc, no throw circle for 4 s (the whistle needs phase 2: 1 plate or 30 s).
  const c0 = await enemy(ids.core);
  await page.evaluate(([core, x, y]) => {
    const rt = (window as any).__realtime;
    rt.teleport(x - 5, y);
    rt.setParam('heroHp', 40);
    rt.setParam('enemySpeed', 0.8);
    rt.chill(core, 0);
  }, [ids.core, c0.x, c0.y] as const);
  const from = await enemy(ids.core);
  await expect.poll(async () => { const c = await enemy(ids.core); return Math.hypot(c.x - from.x, c.y - from.y) > 0.6; }, { timeout: 6_000 }).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-boss-after-sever.png' });
  let signs = 0;
  for (const until = Date.now() + 4_000; Date.now() < until;) { const v = (await snap(page)).boss; signs += v.flail + v.throw; }
  expect(signs).toBe(0);
  // The fight recorded in the browser replays in Node to the same world hash.
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});

test('task 27 snapshots at 1280×720: the flail windup and the weight throw (the fight after the sever — the test above)', async ({ page }) => {
  const errors: string[] = [];
  await openJailer(page, errors);
  await quiet(page);
  // The Jailer alone in the yard, the hero close to it: the flail may come (its reach is 3), the throw too.
  const core0 = { x: 9, y: 6.5 };
  await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    rt.setParam('heroHp', 40);
    rt.clear(false);
    rt.teleport(x + 2.2, y);
    rt.place(x, y, 1, 2, 'jailer');
    rt.place(x, y, 0, 3, 'jailer-weight');
  }, [core0.x, core0.y] as const);
  await expect.poll(async () => { const b = (await snap(page)).boss; return b.flail > 0 || b.throw > 0; }, { timeout: 15_000, intervals: [30] }).toBe(true);
  let b = (await snap(page)).boss;
  await page.screenshot({ path: b.flail > 0 ? 'artifacts/realtime-boss-flail.png' : 'artifacts/realtime-boss-throw.png' });
  const other = b.flail > 0 ? 'throw' : 'flail';
  if (other === 'throw') await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 5, y), [core0.x, core0.y] as const);
  else await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 2.2, y), [core0.x, core0.y] as const);
  await expect.poll(async () => (await snap(page)).boss[other], { timeout: 20_000, intervals: [30] }).toBeGreaterThan(0);
  await page.screenshot({ path: `artifacts/realtime-boss-${other}.png` });
  expect(errors).toEqual([]);
});

test('task 28: the boss bar — only in a boss fight, 480 × 14 px at the top centre under the HUD plate, a cell per HP and plate, the phase line; the first flail or throw of the fight names itself at its sign for a second', async ({ page }) => {
  const errors: string[] = [];
  await openJailer(page, errors);
  const bar = page.getByTestId('boss-bar');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!, hud = (await page.getByTestId('hud').boundingBox())!, goal = (await page.getByTestId('goal').boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([480, 14]);
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
  // Under the HUD plate: the goal and the rest of the plate stay clear.
  expect(box.y).toBeGreaterThanOrEqual(hud.y + hud.height);
  expect(box.y).toBeGreaterThanOrEqual(goal.y + goal.height);
  // The goal is the boss itself (design 15.10.2026: «отмеченные» is the ataman's and the horde's word).
  await expect(page.getByTestId('goal')).toHaveText('Тюремщик 0 / 1');
  let s: any = await snap(page);
  const core = s.enemies.find((e: any) => e.kind === 'jailer');
  // Task 32: the arena's core has 5 HP (`Params.jailerHp`) — five HP cells.
  expect(core.hp).toBe(5);
  expect(s.bossBar).toMatchObject({ visible: true, cells: 5 + core.armor.max, filled: core.hp + core.armor.plates, phaseAt: 5 + 1, phase2: false });
  await page.screenshot({ path: 'artifacts/realtime-boss-bar.png' });

  // The first move of the fight: its name at its sign; it goes after a second.
  await quiet(page);
  await page.evaluate(() => { const rt = (window as any).__realtime; const c = rt.snapshot().enemies.find((e: any) => e.kind === 'jailer'); rt.teleport(c.x + 2.2, c.y); });
  await expect.poll(async () => ((await snap(page)) as any).bossNames.length, { timeout: 15_000, intervals: [30] }).toBe(1);
  const name = ((await snap(page)) as any).bossNames[0];
  expect(['Кистень', 'Бросок гири']).toContain(name);
  await expect(page.getByTestId('world-label').filter({ hasText: name })).toBeVisible();
  await page.screenshot({ path: 'artifacts/realtime-boss-name.png' });
  await expect(page.getByTestId('world-label').filter({ hasText: name })).toBeHidden({ timeout: 3_000 });
  expect(((await snap(page)) as any).bossNames).toEqual([]);

  // Another arena: no bar.
  await page.goto('/?sandbox=1&arena=1');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(bar).toBeHidden();
  expect(((await snap(page)) as any).bossBar.visible).toBe(false);
  expect(errors).toEqual([]);
});

/**
 * Task 32 «Бесцветный Тюремщик» (design 15.10.2026, docs/design-notes/task-32-jailer.md): the core is drawn without a team colour
 * (grey, no sigil). A chain of any colour gets the candidate ring at the core, and the core is never muted with the other colours.
 * Two chains of two colours, real input (the mouse); the chain through the core itself is core's test.
 */
test('task 32: the colourless core — grey, no sigil; chains of two colours ring it as a candidate and never mute it', async ({ page }) => {
  const errors: string[] = [];
  await openJailer(page, errors);
  await quiet(page);
  const ids = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.clear(false);
    rt.teleport(6.6, 6);
    return { core: rt.place(10, 6, 1, 5, 'jailer'), weight: rt.place(10, 6, 0, 3, 'jailer-weight') };
  });
  await expect.poll(async () => (await snap(page)).boss.chains).toBe(1);
  // The core faces the hero (west), then it is frozen: no moves while the test draws.
  await gameWait(page, 0.35);
  await page.evaluate(([core]) => (window as any).__realtime.chill(core, 60), [ids.core] as const);
  expect((await snap(page)).boss.colorless).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-boss-colorless.png' });

  const enemy = async (id: number): Promise<{ x: number; y: number }> => (await snap(page)).enemies.find(e => e.id === id)!;
  for (const [color, other] of [[0, 2], [2, 0]] as const) {
    // A link of `color` in reach of the core; a bystander of `other` — muted while the chain is drawn (the core is not).
    const c = await enemy(ids.core);
    const placed = await page.evaluate(([x, y, color, other]) => {
      const rt = (window as any).__realtime;
      rt.teleport(x - 3, y);
      return { link: rt.place(x - 1.5, y, color, 0, 'basic'), bystander: rt.place(x - 3, y + 1.6, other, 2, 'basic') };
    }, [c.x, c.y, color, other] as const);
    await drawChain(page, [() => enemy(placed.link)]);
    await expect.poll(async () => (await snap(page)).chain).toEqual([placed.link]);
    await expect.poll(async () => (await snap(page)).boss.coreRing).toBe(1);
    const s: any = await snap(page);
    // Muted: the bystander, and the weight when its colour (0) is not the chain's. Never the core.
    expect(s.colorShift.dimmed).toBe(color === 0 ? 1 : 2);
    expect(s.boss.colorless).toBe(1);
    await page.screenshot({ path: `artifacts/realtime-boss-colorless-chain-${color}.png` });
    // Release: the link dies. The bystander stays (the next round's chain is its colour: it is not muted then).
    await page.mouse.up();
    await expect.poll(async () => (await snap(page)).enemies.some(e => e.id === placed.link), { timeout: 5_000 }).toBe(false);
    await expect.poll(async () => { const s = await snap(page); return !(s as any).moving && s.chain.length === 0; }, { timeout: 5_000 }).toBe(true);
  }
  expect(errors).toEqual([]);
});

/**
 * Task 32 «Бесцветный Тюремщик» (core): a chain of one colour goes through the colourless core and on by its colour — the mouse
 * draws [a, core, b] (a and b of colour 2, the core of colour 1 in the data); a bystander of colour 3 on the way is not taken. The
 * dash strikes all three (a, b die, the core loses a plate); the fight replays in Node to the page's hash.
 */
test('task 32: a chain of one colour through the colourless core — drawn with the mouse, struck by the dash, replayed in Node', async ({ page }) => {
  const errors: string[] = [];
  await openJailer(page, errors);
  await quiet(page);
  const ids = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.clear(false);
    rt.teleport(7, 6);
    return { core: rt.place(10, 6, 1, 5, 'jailer'), weight: rt.place(10, 6, 0, 3, 'jailer-weight') };
  });
  await expect.poll(async () => (await snap(page)).boss.chains).toBe(1);
  // The cold takes the shield down (the core faces the hero): the colour rule alone.
  await gameWait(page, 0.35);
  const links = await page.evaluate(([core]) => {
    const rt = (window as any).__realtime;
    rt.chill(core, 60);
    return { a: rt.place(8.5, 6, 2, 0, 'basic'), b: rt.place(11.5, 6.4, 2, 0, 'basic'), other: rt.place(11, 7.4, 3, 0, 'basic') };
  }, [ids.core] as const);
  const enemy = async (id: number): Promise<{ x: number; y: number }> => (await snap(page)).enemies.find(e => e.id === id)!;
  await drawChain(page, [() => enemy(links.a), () => enemy(ids.core), () => enemy(links.other), () => enemy(links.b)]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([links.a, ids.core, links.b]);
  await page.mouse.up();
  await expect.poll(async () => { const s = await snap(page); return !(s as any).moving && s.chain.length === 0; }, { timeout: 5_000 }).toBe(true);
  const s = await snap(page);
  const core = s.enemies.find(e => e.id === ids.core)!;
  expect(s.enemies.some(e => e.id === links.a || e.id === links.b)).toBe(false);
  expect(s.enemies.some(e => e.id === links.other)).toBe(true);
  expect(core.armor?.plates).toBe(2);
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});

/**
 * Task 28 «Тюремщик в походе»: a new run walks to row 5 (battles won by the hook `winArena`, the first button of every node
 * screen); the boss bar shows only in the Jailer's fight. There the player severs the weight and kills the core with bombs (the
 * key 2 at the mouse, as a player does): the crowd dies with the boss in a wave from the core, the bar empties and fades, the
 * Jailer's screen offers 4 cards.
 */
test('task 28: the Jailer in a run — the bar only in its fight; bombs sever the weight and kill the core, the crowd dies in a wave from the core, the bar fades, the Jailer\'s screen offers 4', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await page.getByTestId('gift-1').click();
  const state = (): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
  const bar = page.getByTestId('boss-bar');
  let jailer = false, plainFights = 0;
  for (let step = 0; step < 80 && !jailer; step++) {
    const run = await state();
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      await expect(page.getByTestId('run')).toBeHidden();
      if (/r9c/.test(pending.nodeId)) { jailer = true; break; }
      // Every other fight: no boss bar.
      expect(((await snap(page)) as any).bossBar.visible).toBe(false);
      await expect(bar).toBeHidden();
      plainFights++;
      expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
      await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
      await page.getByTestId('result-map').click();
      continue;
    }
    if (pending) {
      await page.locator('[data-action="gift"]:not([disabled]), [data-action="find"], [data-action="gift-pick"], [data-action="talisman"], [data-action="hammer"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click();
      continue;
    }
    const node = page.locator('[data-status="available"]').first();
    await node.click();
    if (/r9c/.test((await node.getAttribute('data-node'))!)) {
      // The card of the Jailer's node: the arena's name, not its id.
      await expect(page.getByText('Арена «Тюремщик»')).toBeVisible();
      await page.screenshot({ path: 'artifacts/realtime-boss-run-card.png' });
    }
    await page.getByTestId('run-enter').click();
  }
  expect(jailer).toBe(true);
  expect(plainFights).toBeGreaterThan(0);
  let s: any = await snap(page);
  expect(['jailer', 'jailer-yard']).toContain(s.arena);
  await expect(bar).toBeVisible();
  // Let the fight run: the first move comes at 2 s, the crowd walks in.
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId('goal')).toHaveText('Тюремщик 0 / 1');
  await page.screenshot({ path: 'artifacts/realtime-boss-run.png' });

  // Bombs at the mouse (key 2). The hero stands off the core, with HP to spare (test setup through the journal).
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setItems('bomb', 9); rt.setParam('contactDamage', 0); });
  const bombAt = async (kind: string, shoot = false): Promise<boolean> => {
    const t = (await snap(page) as any).enemies.find((e: any) => e.kind === kind);
    if (!t) return false;
    await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x + 4, y), [t.x, t.y] as const);
    await page.waitForTimeout(150);
    const t2 = (await snap(page) as any).enemies.find((e: any) => e.kind === kind);
    if (!t2) return false;
    const at = await screen(page, t2.x, t2.y);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('2');
    if (shoot) {
      // The core's death: a frame in the middle of the wave.
      for (let f = 0; f < 60; f++) {
        if ((await snap(page) as any).boss.waves > 0) { await page.waitForTimeout(180); await page.screenshot({ path: 'artifacts/realtime-boss-run-wave.png' }); break; }
        await page.waitForTimeout(16);
      }
    }
    await page.waitForTimeout(450);
    return true;
  };
  for (let i = 0; i < 4 && (await snap(page) as any).enemies.some((e: any) => e.kind === 'jailer-weight'); i++) await bombAt('jailer-weight');
  s = await snap(page);
  expect(s.enemies.some((e: any) => e.kind === 'jailer-weight'), 'the weight severed').toBe(false);
  expect(s.boss.breaks).toBeGreaterThan(0);
  // The severed weight drops the loot of an armoured elite (`bossPartLoot`, the run).
  await expect.poll(async () => (await snap(page) as any).objects.filter((o: any) => o.kind === 'loot').length).toBeGreaterThan(0);
  const loot = (await snap(page) as any).objects.filter((o: any) => o.kind === 'loot').map((o: any) => o.id);
  // The core: bombs until it dies; the crowd stands.
  let dead = false;
  for (let i = 0; i < 6 && !dead; i++) {
    expect((await snap(page) as any).enemies.filter((e: any) => e.partOf == null && e.kind !== 'jailer').length, 'a crowd to die with the boss').toBeGreaterThan(0);
    await bombAt('jailer', !!i);
    dead = !(await snap(page) as any).enemies.some((e: any) => e.kind === 'jailer');
  }
  expect(dead).toBe(true);
  // The wave runs from the core (at most 0.6 s), then the loot of the weight lies on the arena: the boss's death does not take it.
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/realtime-boss-run-after.png' });
  s = await snap(page);
  const left = s.objects.filter((o: any) => o.kind === 'loot').map((o: any) => o.id);
  expect(loot.some((id: number) => left.includes(id)), "the weight's loot still lies after the wave").toBe(true);
  expect(s.boss.clears).toBeGreaterThan(0);
  expect(s.boss.waves).toBe(1);
  expect(s.enemies.length).toBe(0);
  expect(s.bossBar.visible ? s.bossBar.fading : true).toBe(true);
  await expect(bar).toBeHidden({ timeout: 2_000 });
  expect(s.status).toBe('playing');

  // The door is open: in, then the Jailer's screen — 4 cards after a severed weight.
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  // The result names the fight once: «Тюремщик» (the node and its arena have one name).
  await expect(page.getByTestId('result')).toContainText('Тюремщик');
  await expect(page.getByTestId('result')).not.toContainText('Тюремщик · Тюремщик');
  await expect(page.getByTestId('result')).not.toContainText('jailer');
  // The goal row names the boss; no greed row in a fight the boss's death ends.
  await expect(page.getByTestId('result')).toContainText('Тюремщик 1 / 1');
  await expect(page.getByTestId('result')).not.toContainText('отмеченные');
  await expect(page.getByTestId('result')).not.toContainText('В стадии жадности');
  await page.screenshot({ path: 'artifacts/realtime-boss-run-result.png' });
  await page.getByTestId('result-map').click();
  for (let i = 0; i < 4 && (await state()).pending?.source !== 'oath'; i++) {
    if ((await state()).pending?.kind === 'hammer') await page.getByTestId('hammer-refuse').click();
    else break;
  }
  const run = await state();
  expect(run.pending?.source).toBe('oath');
  expect(run.pending.options.length).toBe(4);
  await expect(page.getByTestId('run-talisman')).toContainText('Гиря отрублена — на выбор четыре.');
  await page.screenshot({ path: 'artifacts/realtime-boss-run-oath.png' });
  expect(errors).toEqual([]);
});
