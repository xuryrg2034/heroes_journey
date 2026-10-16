import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { rtRunDepth } from '../src/realtime/run/rtMeta';
import { rtCartView, rtLevel } from '../src/realtime/run/rtRun';

/**
 * Task 38 «Гарнизон, шаг 1а» — the view (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md): the leash on the field
 * (red with the cut mark while the drawn chain's dash would cut it, a snap after the dash), the hound's frenzy, the Castellan's
 * lane and boss bar; the way from the forest's final relic to «Предместье» (the HP bar fills to full) and the garrison's map (cold
 * stone, «Караульня» and «Кастелян» named), the level's word in the header. Real input: the chain with the mouse, the run's own
 * buttons; the run is walked in Node to the forest's final (its own commands). The rules: core's suites and tests (task 38).
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page, query: string): Promise<void> {
  await page.goto(`/?sandbox=1${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

/** Only what the test places acts (no newcomers, bodies stand, nothing hurts the hero); the hero at `hero`. */
async function quiet(page: Page, hero: { x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(x, y);
  }, [hero.x, hero.y] as const);
}

const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

test('task 38 view: «Псарня» — the leash drawn, red with the cut mark while a chain across it is held; after the dash it snaps and the hound shows its frenzy', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=21');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-kennel');
  await quiet(page, { x: 4, y: 5 });
  const handler = await place(page, 8.5, 5, 1, 1, 'handler');
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 1.5));
  await gameWait(page, 2.5);
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 0));
  await gameWait(page, 0.1);
  let s = await snap(page);
  expect(s.tethers.lines).toBe(2);
  expect(s.tethers.cut).toBe(0);
  const h = s.enemies.find((e: any) => e.id === handler)!, hound = s.enemies.find((e: any) => e.id === s.tethers.list[0].held)!;
  const mx = (h.x + hound.x) / 2, my = (h.y + hound.y) / 2, d = Math.hypot(hound.x - h.x, hound.y - h.y), px = -(hound.y - h.y) / d, py = (hound.x - h.x) / d;
  const a = await place(page, mx + px * 0.9, my + py * 0.9, 0, 0, 'basic'), b = await place(page, mx - px * 0.9, my - py * 0.9, 0, 0, 'basic');
  // Bodies of colour 2 round the hound: its frenzy will have prey (held by the cold, they stand).
  const crowd = await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; const ids = [rt.place(x + 1.1, y, 2, 0, 'basic'), rt.place(x + 1.1, y + 0.8, 2, 0, 'basic')]; for (const id of ids) rt.chill(id, 30); return ids; }, [hound.x, hound.y] as const);
  void crowd;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [mx + px * 1.9, my + py * 1.9] as const);
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = (await snap(page)).enemies.find((x: any) => x.id === id)!; return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  const pa = await at(a);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  const pb = await at(b);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a, b]);
  // The leash the dash will cut: red, with the cut mark on the dash's path.
  await expect.poll(async () => (await snap(page)).tethers.marks).toBeGreaterThanOrEqual(1);
  { const t = (await snap(page)).tethers; expect(t.marks).toBe(t.cut); }
  await page.screenshot({ path: 'artifacts/realtime-garrison-leash-held.png' });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).tethers.snaps, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  // The frenzy: the red ring round the hound (its 6 s), the crowd of colour 2 its prey.
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 1.5));
  const frenzy = await untilFrame(page, (sn, _a: number, late) => sn.garrison.frenzy > 0 || late ? sn.garrison.frenzy : undefined, 0, 4);
  expect(frenzy).toBeGreaterThanOrEqual(1);
  await gameWait(page, 0.4);
  await page.screenshot({ path: 'artifacts/realtime-garrison-frenzy.png' });
  expect(errors).toEqual([]);
});

test('task 38 view: «Двор кастеляна» — the boss bar and the goal name the Castellan, «Спустить пса» shows its lane', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=24');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-castellan');
  await expect.poll(async () => (await snap(page)).bossBar?.visible ?? false).toBe(true);
  await expect(page.getByTestId('boss-bar')).toBeVisible();
  await expect(page.locator('[data-testid="hud"]')).toContainText('Кастелян');
  // A hound winds up its lunge when the hero is within its reach: the hero by the first hound (touches do not hurt).
  await page.evaluate(() => {
    const rt = (window as any).__realtime, h = rt.snapshot().enemies.find((e: any) => e.kind === 'hound');
    rt.setParam('contactDamage', 0);
    rt.teleport(h.x + (h.x < 8 ? 2 : -2), h.y + 0.5);
  });
  const lane = await untilFrame(page, (sn, _a: number, late) => sn.garrison.lunges > 0 || late ? sn.garrison.lunges : undefined, 0, 8);
  expect(lane).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-garrison-castellan.png' });
  expect(errors).toEqual([]);
});

test('task 38 view: a run walked in Node to the forest final\'s relic — the relic taken, «Предместье» fills the HP bar, «В гарнизон» opens the cold garrison map with «Караульня» and «Кастелян»; the header says «Лес», then «Гарнизон»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); });
  // The run's own commands in Node (metaWalk.testkit.ts): every fight won, every screen chosen; stop at the final's relic screen.
  let relic: RtRunState | null = null;
  walkRun({ k: 3, create: { gift: 'full', seeded: true, garrison: true }, each: state => { if (!relic && state.pending?.kind === 'talisman' && state.pending.source === 'level') relic = structuredClone(state); } });
  expect(relic, 'the walk reached the final\'s relic').not.toBeNull();
  // A hurt hero (the walk wins every fight unhurt): «Предместье» has something to heal.
  const hurt = { ...relic!, hp: 4 };
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(hurt)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run-title')).toHaveText('Лес');
  await expect(page.getByTestId('run-talisman')).toContainText('Реликвия на выбор');
  await page.screenshot({ path: 'artifacts/realtime-garrison-relic.png' });
  await page.locator('[data-testid="run-talisman"] button[data-action="talisman"][data-option]:not([data-option=""])').first().click();
  // «Предместье»: HP to full, the bar fills from 4.
  await expect(page.getByTestId('run-outskirts')).toBeVisible();
  const state = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(state.hp).toBe(state.maxHp);
  await expect(page.getByTestId('outskirts-hp')).toHaveText(`HP ${state.maxHp} / ${state.maxHp}`);
  await expect(page.locator('[data-testid="outskirts-bar"] i')).toHaveAttribute('style', /width: ?100(\.0)?%/, { timeout: 3_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'artifacts/realtime-garrison-outskirts.png' });
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  await expect(page.getByTestId('run-title')).toHaveText('Гарнизон');
  await expect(page.getByTestId('run-map')).toHaveAttribute('data-level', '2');
  await expect(page.getByTestId('map-cap-checkpoint')).toHaveText('Караульня');
  await expect(page.getByTestId('map-cap-boss').first()).toHaveText('Кастелян');
  await page.screenshot({ path: 'artifacts/realtime-garrison-map.png' });
  expect(errors).toEqual([]);
});

test('task 38 view: the depth record names the garrison — a meta run walked to the garrison\'s row 2+ and abandoned shows «Гарнизон, ряд N — новый рекорд» over «прежний: лес пройден»; the camp says «Рекорд: Гарнизон, ряд N»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
  // The profile of a viewer who passed the forest before (record: the forest won, row 9) and has the camp.
  const meta = { heroes: { cat: { xp: 40, packs: [], record: { row: 9, won: true, xp: 40 } } }, hearth: { stock: 3, levels: { owl: 0, herb: 0, smith: 0 }, met: { herb: false, smith: false }, lines: { 'owl:first': 2 }, quiet: 0 } };
  await page.evaluate(m => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 3, won: true, meta: m })); }, meta);
  // A meta run (no given seed) walked in Node by its own commands: on the garrison's map past its row 2.
  let open: RtRunState | null = null;
  walkRun({ k: 3, create: { gift: 'full', garrison: true }, each: state => { if (!open && !state.result && !state.pending && rtLevel(state) === 2 && rtRunDepth(state) >= 2) open = structuredClone(state); } });
  expect(open, 'the walk reached the garrison\'s row 2').not.toBeNull();
  const row = rtRunDepth(open!);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(open!)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run-title')).toHaveText('Гарнизон');
  // «Новый поход» → «Да, новый»: the run is settled by core, its end screen shows the record.
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  const record = page.getByTestId('meta-record');
  await expect(record).toHaveAttribute('data-beaten', 'true');
  await expect(record).toContainText(`Гарнизон, ряд ${row} — новый рекорд`);
  await expect(record).toContainText('прежний: лес пройден');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'artifacts/realtime-garrison-record.png' });
  await page.getByTestId('run-to-hearth').click();
  await expect(page.getByTestId('hearth-record')).toHaveText(`Рекорд: Гарнизон, ряд ${row}`);
  await page.screenshot({ path: 'artifacts/realtime-garrison-record-camp.png' });
  expect(errors).toEqual([]);
});

/**
 * Design smoke v65 (D2, design 16.10.2026): a boss fight opens on the boss — his drawing whole under the HUD plate and the boss bar —
 * and the camera glides to the hero in 1.2 s; the fight holds its first tick meanwhile (time 0, input ignored); the scale is the
 * fights' own. The page's clock is Playwright's (`page.clock`): the glide's start frame is held for the shot, then the clock runs.
 */
const T0 = Date.parse('2026-10-16T12:00:00Z');
// The fights' scale of an arena larger than 16×10 at 1280×720 (render.ts `fitScale`: the reference 16×10 in the window, margin 12).
const FIGHT_SCALE = Math.min((1280 - 24) / (16 * 72), (720 - 24) / (10 * 72));
const sees = (page: Page, kind: string, up: number) => page.evaluate(([k, up]) => {
  const rt = (window as any).__realtime, sn = rt.snapshot(), cam = rt.camera(), boss = sn.enemies.find((e: any) => e.kind === k && e.partOf === null);
  // The drawing: the art box over the disc (render.ts: the Castellan 4.2 radii, feet at the disc's bottom — 3.2 up; the Jailer 5.4, feet 1.0 — 4.4 up).
  const r = 0.4 * 72 * cam.scale, at = rt.toScreen(boss.x, boss.y), hero = rt.toScreen(sn.hero.x, sn.hero.y);
  return { top: at.y - r * up, bottom: at.y + r, left: at.x - r * 2.2, right: at.x + r * 2.2, hero, heroFeet: hero.y + 0.5 * 72 * cam.scale, scale: cam.scale, intro: cam.intro, time: sn.time, commands: rt.journal().commands.length };
}, [kind, up] as const);

for (const [arena, kind, title, up] of [[24, 'castellan', 'Двор кастеляна', 3.2], [19, 'jailer', 'Тюремщик', 4.4]] as const) {
  test(`smoke v65 (D2): «${title}» opens on the boss (whole under the boss bar), glides to the hero in 1.2 s holding the first tick (input ignored), then the fights' scale; the journal replays in Node to the page's hash`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0 + 1000);
    await page.goto(`/?sandbox=1&arena=${arena}`);
    await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
    await page.clock.runFor(50);
    // The glide's start: the boss's drawing whole between the boss bar and the action bar, the fight at 0:00.
    const start = await sees(page, kind, up);
    expect(start.intro, 'the glide is on').toBeGreaterThan(1.0);
    // The fight holds its first tick (the arena's setup — the Castellan's plates and leashes — is in it): the clock shows 0:00.
    expect(start.time).toBeLessThan(0.02);
    await expect(page.getByTestId('boss-bar')).toBeVisible();
    const bar = (await page.getByTestId('boss-bar').boundingBox())!, plate = (await page.locator('.rt-hud').boundingBox())!, actions = (await page.getByTestId('action-bar').boundingBox())!;
    expect(start.top, 'the boss\'s head below the boss bar').toBeGreaterThan(bar.y + bar.height);
    expect(start.top, 'the boss\'s head below the HUD plate').toBeGreaterThan(plate.y + plate.height);
    expect(start.bottom, 'the boss above the action bar').toBeLessThan(actions.y);
    expect(start.scale).toBeCloseTo(FIGHT_SCALE, 4);
    await page.screenshot({ path: `artifacts/realtime-boss-intro-${kind}-start.png` });
    // Input in the glide is ignored: a click on the arena, a walk key held and released, the spin and an item key — no command.
    await page.mouse.click(640, 400);
    await page.keyboard.down('KeyD');
    await page.clock.runFor(100);
    await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyQ');
    await page.keyboard.press('Digit2');
    await page.clock.runFor(450);
    const mid = await sees(page, kind, up);
    expect(mid.intro, 'still gliding').toBeGreaterThan(0);
    expect(mid.time, 'the fight holds its first tick').toBe(start.time);
    expect(mid.commands, 'no command in the glide').toBe(start.commands);
    // The glide ends at the hero: the fights' scale, the hero above the action bar; the fight's clock starts.
    await page.clock.runFor(800);
    const end = await sees(page, kind, up);
    expect(end.intro).toBe(0);
    expect(end.scale).toBeCloseTo(FIGHT_SCALE, 4);
    expect(end.heroFeet, 'the hero above the action bar').toBeLessThan(actions.y);
    expect(end.hero.y).toBeGreaterThan(bar.y + bar.height);
    await page.clock.resume();
    await page.screenshot({ path: `artifacts/realtime-boss-intro-${kind}-hero.png` });
    // A short fight after the glide (a walk), then the browser's journal replays in Node — no glide there — to the same hash.
    await page.keyboard.down('KeyD');
    await gameWait(page, 0.4);
    await page.keyboard.up('KeyD');
    await gameWait(page, 0.2);
    const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
    expect(recorded.journal.commands.some(c => c.cmd.t === 'walk'), 'the walk after the glide is journalled').toBe(true);
    expect(replay(recorded.journal).hash()).toBe(recorded.hash);
    expect(errors).toEqual([]);
  });
}

/**
 * Task 40 «Гарнизон, шаг 1б» — the view (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md): the keymaster's shackle
 * (an iron chain, red with the cut mark while the drawn chain cuts it), the prisoner's padlock, the label «В кандалах — сначала
 * разруби» from the first shackle until the player's dash cuts one; «Повозка» on «Предместье» («−», «+», «В гарнизон»); the run's
 * end — «(Повозка +M)» in the carry line, «Гарнизон пройден — новый рекорд», the camp's «Рекорд: гарнизон пройден». Real input:
 * the mouse and the run's buttons; the runs are walked in Node by their own commands (metaWalk.testkit.ts).
 */
const SHACKLE_TEXT = 'В кандалах — сначала разруби';
const labelsOf = async (page: Page): Promise<{ id: string; text: string; top: number }[]> => (await snap(page)).onboarding.labels;

test('task 40 view: «Ров» — the shackle is an iron chain with a padlock over the prisoner and the label under it; a chain across turns it red with the cut mark; the dash cuts it (a grey snap) and the label goes for the fight, a new shackle brings no label', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=25');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-moat');
  await quiet(page, { x: 5, y: 7.6 });
  const place = (x: number, y: number, color: number, kind: string): Promise<number> =>
    page.evaluate(([x, y, color, kind]) => (window as any).__realtime.place(x, y, color, 0, kind), [x, y, color, kind] as const);
  const keymaster = await place(8, 2.4, 1, 'keymaster'), prisoner = await place(10.5, 2.4, 0, 'basic');
  // No shackle yet (the first comes 3 s after the keymaster appears): no chain, no padlock, no label.
  let sn = await snap(page);
  expect(sn.tethers.shackles).toBe(0);
  expect(sn.onboarding.labels.some((l: { id: string }) => l.id === 'shackle')).toBe(false);
  await gameWait(page, 3.3);
  sn = await snap(page);
  expect(sn.tethers.list).toEqual([{ holder: keymaster, held: prisoner, kind: 'shackle' }]);
  expect({ lines: sn.tethers.lines, shackles: sn.tethers.shackles, locks: sn.tethers.locks, cut: sn.tethers.cut }).toEqual({ lines: 1, shackles: 1, locks: 1, cut: 0 });
  // The label under the prisoner (one, no plate).
  await expect.poll(async () => (await labelsOf(page)).filter(l => l.id === 'shackle').map(l => l.text)).toEqual([SHACKLE_TEXT]);
  const pe = sn.enemies.find((e: { id: number }) => e.id === prisoner);
  const ps = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [pe.x, pe.y] as const);
  const label = (await labelsOf(page)).find(l => l.id === 'shackle')!;
  expect(label.top, 'the label under the prisoner (its padlock is over it)').toBeGreaterThan(ps.y);
  await page.evaluate(() => (window as any).__realtime.teleport(9.25, 0.6));
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/realtime-keymaster-shackle.png' });
  // A chain across the shackle's middle: the chain red with the cut mark while it is held.
  const a = await place(9.25, 1.5, 2, 'basic'), b = await place(9.25, 3.3, 2, 'basic');
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = (await snap(page)).enemies.find((x: { id: number }) => x.id === id); return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  const pa = await at(a), pb = await at(b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a, b]);
  await expect.poll(async () => { const t = (await snap(page)).tethers; return { cut: t.cut, marks: t.marks, shackles: t.shackles }; }).toEqual({ cut: 1, marks: 1, shackles: 1 });
  await page.screenshot({ path: 'artifacts/realtime-keymaster-cut.png' });
  await page.mouse.up();
  // The dash cuts it: the snap, no padlock, the label gone.
  await expect.poll(async () => (await snap(page)).tethers.list.length, { timeout: 5_000 }).toBe(0);
  sn = await snap(page);
  expect(sn.tethers.snaps).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await snap(page)).tethers.locks).toBe(0);
  await expect.poll(async () => (await labelsOf(page)).some(l => l.id === 'shackle')).toBe(false);
  // The keymaster shackles the freed body again `shacklePeriod` (6 s) later: the padlock is back, the label is not (cut once in the fight).
  await page.evaluate(() => (window as any).__realtime.teleport(5, 0.6));
  await expect.poll(async () => (await snap(page)).tethers.locks, { timeout: 20_000 }).toBe(1);
  expect((await labelsOf(page)).some(l => l.id === 'shackle')).toBe(false);
  expect(errors).toEqual([]);
});

test('task 40 view: «Ров» as it plays — the keymasters across the moat shackle their neighbours; the shot shows the chains and the padlocks', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=25');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-moat');
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 0));
  await expect.poll(async () => (await snap(page)).tethers.locks, { timeout: 20_000 }).toBeGreaterThan(0);
  await gameWait(page, 0.5);
  await page.screenshot({ path: 'artifacts/realtime-keymaster-moat.png' });
  const sn = await snap(page);
  expect(sn.tethers.shackles).toBe(sn.tethers.list.filter((t: { kind: string }) => t.kind === 'shackle').length);
  expect(errors).toEqual([]);
});

/** The camp's flags of a meta run (`hearth` is kept only with `locked`) and the profile of a viewer who passed the forest before. */
const CAMP = { gift: 'full' as const, garrison: true, moat: true, locked: [] as string[], hearth: { jailerRerolls: 1 } };
const FOREST_WON = { heroes: { cat: { xp: 40, packs: [], record: { row: 9, won: true, xp: 40 } } }, hearth: { stock: 3, levels: { owl: 0, herb: 0, smith: 0 }, met: { herb: false, smith: false }, lines: { 'owl:first': 2 }, quiet: 0 } };
async function loadRun(page: Page, run: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([m, key, value]) => {
    localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1');
    localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 3, won: true, meta: m }));
    localStorage.setItem(key, value);
  }, [FOREST_WON, RT_RUN_STORAGE_KEY, serializeRtRun(run)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('task 40 view: «Повозка» on «Предместье» of a camp run — the default «оставить 6», «−» and «+» step by 1 within 0 … max, «В гарнизон» takes the number shown; the run\'s end says «(Повозка +M)» in the carry line', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  let at: RtRunState | null = null;
  walkRun({ k: 5, loot: 4, create: CAMP, each: state => { if (!at && state.pending?.kind === 'outskirts') at = structuredClone(state); } });
  expect(at, 'the walk reached «Предместье»').not.toBeNull();
  const view = rtCartView(at!)!;
  expect(view, 'a camp run has the cart').not.toBeNull();
  expect(view.max, 'the stock lets «−» and «+» move').toBeGreaterThan(view.deposit);
  expect(view.deposit).toBeGreaterThan(0);
  await loadRun(page, at!);
  await expect(page.getByTestId('run-outskirts')).toBeVisible();
  await expect(page.getByTestId('run-cart')).toBeVisible();
  const value = page.getByTestId('run-cart-value'), keep = page.getByTestId('run-cart-keep');
  await expect(value).toHaveText(String(view.deposit));
  await expect(keep).toContainText(`с собой ${view.stock - view.deposit}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'artifacts/realtime-garrison-cart.png' });
  await page.getByTestId('run-cart-minus').click();
  await expect(value).toHaveText(String(view.deposit - 1));
  await page.getByTestId('run-cart-plus').click();
  await page.getByTestId('run-cart-plus').click();
  await expect(value).toHaveText(String(view.deposit + 1));
  await expect(keep).toContainText(`с собой ${view.stock - view.deposit - 1}`);
  // «+» stops at the most the cart takes (disabled there); «−» at 0.
  for (let n = view.deposit + 1; n < view.max; n++) await page.getByTestId('run-cart-plus').click();
  await expect(value).toHaveText(String(view.max));
  await expect(page.getByTestId('run-cart-plus')).toBeDisabled();
  for (let n = view.max; n > view.deposit + 1; n--) await page.getByTestId('run-cart-minus').click();
  await expect(value).toHaveText(String(view.deposit + 1));
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  await expect(page.getByTestId('run-title')).toHaveText('Гарнизон');
  const after = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(after.cart).toEqual({ n: view.deposit + 1, before: view.stock });
  // «Новый поход» → «Да, новый»: the run settled — the carry line names the cart.
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  await expect(page.getByTestId('meta-carry-cart')).toHaveText(`(Повозка +${view.deposit + 1})`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'artifacts/realtime-garrison-cart-end.png' });
  expect(errors).toEqual([]);
});

test('task 40 view: the garrison won — «Гарнизон пройден — новый рекорд» over «прежний: лес пройден», the carry with «(Повозка +M)»; the camp says «Рекорд: гарнизон пройден»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const won = walkRun({ k: 5, loot: 4, create: CAMP }).run;
  expect(won.result?.outcome, 'the walk won the Castellan').toBe('victory');
  expect(rtLevel(won)).toBe(2);
  expect(won.cart, 'the walk sent the cart').toBeDefined();
  await loadRun(page, won);
  const record = page.getByTestId('meta-record');
  await expect(record).toHaveAttribute('data-beaten', 'true');
  await expect(record).toContainText('Гарнизон пройден — новый рекорд');
  await expect(record).toContainText('прежний: лес пройден');
  await expect(page.getByTestId('meta-carry-cart')).toHaveText(`(Повозка +${won.cart!.n})`);
  await page.screenshot({ path: 'artifacts/realtime-garrison-won.png' });
  await page.getByTestId('run-to-hearth').click();
  await expect(page.getByTestId('hearth-record')).toHaveText('Рекорд: гарнизон пройден');
  await page.screenshot({ path: 'artifacts/realtime-garrison-won-camp.png' });
  expect(errors).toEqual([]);
});

test('task 40 view: in a run, «Ров» (the run\'s first keymaster) — the label «В кандалах — сначала разруби» comes with the first shackle', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  // A camp run walked in Node to its first «Ров» (garrison rows 6–9), the battle's screen open.
  let moat: RtRunState | null = null;
  for (let k = 1; k <= 12 && !moat; k++) walkRun({ k, create: CAMP, each: state => { if (!moat && state.pending?.kind === 'battle' && state.pending.arena === 'g-moat') moat = structuredClone(state); } });
  expect(moat, 'a walk reached «Ров»').not.toBeNull();
  await loadRun(page, moat!);
  await page.getByTestId('run-battle').click();
  await expect.poll(async () => (await snap(page)).arena).toBe('g-moat');
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 0));
  await expect.poll(async () => (await snap(page)).tethers.locks, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await labelsOf(page)).filter(l => l.id === 'shackle').map(l => l.text)).toEqual([SHACKLE_TEXT]);
  await page.screenshot({ path: 'artifacts/realtime-keymaster-run.png' });
  expect(errors).toEqual([]);
});

/**
 * Task 41 «Узник на воле» — the view (design 16.10.2026, docs/design-notes/task-41-prisoner-potions.md, 2): the dash cuts the shackle,
 * the broken shackle falls off the prisoner, «На волю!» flashes over it (once a fight in the sandbox), the riot is drawn as the
 * hound's frenzy and the prisoner runs at an enemy. Real input: the chain with the mouse. The rules: core's keymaster.spec.ts.
 */
test('task 41 view: «Ров» — a chain across the shackle; after the dash the shackle falls off, «На волю!» flashes over the prisoner, it riots (the frenzy\'s sign) and runs at an enemy', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=25');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-moat');
  await quiet(page, { x: 9.25, y: 0.6 });
  const put = (x: number, y: number, color: number, kind: string): Promise<number> =>
    page.evaluate(([x, y, color, kind]) => (window as any).__realtime.place(x, y, color, 0, kind), [x, y, color, kind] as const);
  const keymaster = await put(8, 2.4, 1, 'keymaster'), prisoner = await put(10.5, 2.4, 0, 'basic');
  // The prey: two bodies held by the cold right of the prisoner (nearer to it than the hero after the dash, who ends at the chain's end).
  const prey = await page.evaluate(() => { const rt = (window as any).__realtime; const ids = [rt.place(11.3, 2.4, 3, 0, 'basic'), rt.place(11.4, 1.6, 3, 0, 'basic')]; for (const id of ids) rt.chill(id, 30); return ids as number[]; });
  await expect.poll(async () => (await snap(page)).tethers.list, { timeout: 10_000 }).toEqual([{ holder: keymaster, held: prisoner, kind: 'shackle' }]);
  const a = await put(9.25, 1.5, 2, 'basic'), b = await put(9.25, 3.3, 2, 'basic');
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = (await snap(page)).enemies.find((x: { id: number }) => x.id === id); return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  const pa = await at(a), pb = await at(b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a, b]);
  await expect.poll(async () => (await snap(page)).tethers.cut).toBe(1);
  // No riot before the cut: no flash, no frenzy.
  expect((await snap(page)).garrison.riots).toBe(0);
  await page.mouse.up();
  // The dash cuts the shackle: the snap and the falling shackle; «На волю!» over the prisoner.
  await expect.poll(async () => (await snap(page)).tethers.drops, { timeout: 5_000 }).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-prisoner-freed.png' });
  await expect.poll(async () => (await labelsOf(page)).filter(l => l.id === 'riot').map(l => l.text), { timeout: 5_000 }).toEqual(['На волю!']);
  const pr = (await snap(page)).enemies.find((e: { id: number }) => e.id === prisoner);
  const ps = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [pr.x, pr.y] as const);
  expect((await labelsOf(page)).find(l => l.id === 'riot')!.top, 'the flash over the prisoner').toBeLessThan(ps.y);
  // The riot: the frenzy's sign round the prisoner; it runs at the prey and bites it to death.
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 1.5));
  const riots = await untilFrame(page, (sn, _a: number, late) => sn.garrison.riots > 0 || late ? sn.garrison.riots : undefined, 0, 4);
  expect(riots).toBe(1);
  expect((await snap(page)).garrison.frenzy, 'the riot is the frenzy\'s sign').toBeGreaterThanOrEqual(1);
  await gameWait(page, 0.3);
  await page.screenshot({ path: 'artifacts/realtime-prisoner-riot.png' });
  await expect.poll(async () => (await snap(page)).enemies.filter((e: { id: number }) => prey.includes(e.id)).length, { timeout: 5_000 }).toBeLessThan(prey.length);
  // The flash is short: gone within its 1.2 s.
  await expect.poll(async () => (await labelsOf(page)).some(l => l.id === 'riot'), { timeout: 5_000 }).toBe(false);
  expect(errors).toEqual([]);
});
