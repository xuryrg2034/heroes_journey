import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { leaveResult } from './realtimeResult';
import { untilFrame } from './realtimeFrames';
import {
  createRtRun, healOffer, resolveArena, rtAvailableNodes, rtChooseGift, rtChooseGiftPick, rtCrossroadsHidden, rtEnterNode, rtFightOmens, rtGiftView, rtLevelOmen, rtMapNodes, rtNode, rtNodeOmen, serializeRtRun,
  type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';
import { rtOmen, type RtOmenId } from '../src/realtime/run/omens';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';

/**
 * Task 56 «Приметы», the view (task 56в; spec docs/design-notes/task-56-omens.md, 6 and 11.3; docs/realtime-slice.md, «Приметы») at 1280×720 by
 * real input. The saves are walked in Node by the run's own commands (`createRtRun(seed, { omens: pool })` is the pool a profile past the
 * gates gives); the view reads the run (`rtNodeOmen`, `rtLevelOmen`, `rtFightOmens`, `rtCrossroadsHidden`) and the world — no table of the
 * rules here. Screenshots go to $SHOT_DIR when it is set.
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const shot = async (page: Page, name: string): Promise<void> => {
  if (!process.env.SHOT_DIR) return;
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished)));
  await page.mouse.move(640, 710);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
};
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
function ok(step: RtRunStep): RtRunState { if (!step.ok) throw new Error(step.reason); return step.run; }

/** A run with the pool `pool` whose gift is taken: the map's first row open. */
function mapRun(k: number, pool: readonly string[], options: Parameters<typeof createRtRun>[1] = {}): RtRunState {
  let run = createRtRun(seedOf(k), { gift: 'mini', garrison: false, omens: pool, ...options });
  if (run.pending?.kind === 'gift') {
    const view = rtGiftView(run)!;
    run = view.chosen !== null ? ok(rtChooseGiftPick(run, view.picks[0])) : ok(rtChooseGift(run, view.options.find(entry => entry.available)?.index ?? null));
  }
  return run;
}
/** The first seed (1…) whose run of `pool` has the level's omen `id` and at least `nodes` map nodes with an omen of their own. */
function seedWith(id: RtOmenId, pool: readonly string[], nodes = 0, options: Parameters<typeof createRtRun>[1] = {}): number {
  for (let k = 1; k < 400; k++) {
    const run = createRtRun(seedOf(k), { gift: 'mini', garrison: false, omens: pool, ...options });
    if (rtLevelOmen(run) !== id) continue;
    if (rtMapNodes(run).filter(node => rtNodeOmen(run, node)).length >= nodes) return k;
  }
  throw new Error(`no seed for ${id}`);
}
async function openSave(page: Page, run: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RUN_KEY, serializeRtRun(run)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

const POOL = ['moon', 'magpie', 'tailwind', 'harvest', 'storm', 'drowse', 'pale', 'flood'];

test('the map: a badge on each node the core gives an omen, none on row 1 and the checkpoint; the header names the level\'s omen; the card names the node\'s', async ({ page }) => {
  const errors = collectErrors(page);
  const k = seedWith('drowse', POOL, 2);
  const run = mapRun(k, POOL);
  const withOmen = rtMapNodes(run).filter(node => rtNodeOmen(run, node));
  expect(withOmen.length).toBeGreaterThanOrEqual(2);
  await openSave(page, run);
  // The header: the sign of the level's omen right after the level's word; the hover says the rule.
  const level = rtOmen('drowse')!;
  await expect(page.getByTestId('run-omen')).toHaveAttribute('data-omen', 'drowse');
  expect(await page.getByTestId('run-omen').getAttribute('title')).toContain(level.title);
  expect(await page.getByTestId('run-omen').getAttribute('title')).toContain(level.plus);
  const order = await page.evaluate(() => { const head = document.querySelector('.rt-run-head')!; return [...head.children].slice(0, 2).map(el => el.getAttribute('data-testid')); });
  expect(order).toEqual(['run-title', 'run-omen']);
  // The map: a badge exactly at the nodes `rtNodeOmen` names, with the omen's id.
  const badges = await page.locator('[data-testid="map-omen"]').evaluateAll(els => els.map(el => ({ node: el.closest('[data-node]')!.getAttribute('data-node'), omen: el.getAttribute('data-omen') })));
  expect(badges.map(b => b.node).sort()).toEqual(withOmen.map(node => node.id).sort());
  for (const b of badges) expect(b.omen).toBe(rtNodeOmen(run, rtNode(run, b.node!)!));
  for (const node of rtMapNodes(run)) {
    if (node.row === 1 || node.type === 'checkpoint' || node.type === 'boss' || node.type === 'breakthrough') await expect(page.locator(`[data-node="${node.id}"] [data-testid="map-omen"]`)).toHaveCount(0);
  }
  await shot(page, 't56-map');
  // The card: a node of the map that has an omen, reached by the links (its card opens from any node of the map; "В бой" only when open).
  const target = withOmen[0], own = rtNodeOmen(run, target)!, def = rtOmen(own)!;
  await page.locator(`[data-node="${target.id}"]`).click();
  const line = page.getByTestId('run-danger-omen');
  await expect(line).toBeVisible();
  await expect(line).toContainText(`Примета: «${def.title}»`);
  await expect(line).toContainText(def.plus);
  await expect(line).toContainText(def.cost);
  // The level's omen stands beside as an icon, with no second line of text.
  await expect(page.getByTestId('run-danger-omen-level')).toHaveAttribute('data-omen', 'drowse');
  expect(await page.getByTestId('run-danger-omen-level').innerText()).toBe('');
  await shot(page, 't56-card');
  expect(errors).toEqual([]);
});

test('«Перепутье»: the nodes beyond the next row are a grey «?» with no type and no omen; the next row keeps its type', async ({ page }) => {
  const errors = collectErrors(page);
  const pool = [...POOL, 'crossroads'], k = seedWith('crossroads', pool);
  const run = mapRun(k, pool);
  const hidden = rtMapNodes(run).filter(node => rtCrossroadsHidden(run, node)), shownNodes = rtMapNodes(run).filter(node => !rtCrossroadsHidden(run, node));
  expect(hidden.length).toBeGreaterThan(0);
  await openSave(page, run);
  await expect(page.getByTestId('run-omen')).toHaveAttribute('data-omen', 'crossroads');
  for (const node of hidden) {
    const el = page.locator(`[data-node="${node.id}"]`);
    await expect(el).toHaveAttribute('data-type', 'hidden');
    await expect(el).toHaveClass(/rt-hidden/);
    await expect(el.locator('text').first()).toHaveText('?');
    await expect(el.locator('[data-testid="map-omen"]')).toHaveCount(0);
  }
  for (const node of shownNodes) await expect(page.locator(`[data-node="${node.id}"]`)).toHaveAttribute('data-type', node.type);
  // Every node of the next row is open (the links do not hold it).
  const open = rtAvailableNodes(run);
  for (const node of open) await expect(page.locator(`[data-node="${node.id}"]`)).toHaveAttribute('data-status', 'available');
  await shot(page, 't56-crossroads');
  // The card of a hidden node says only that.
  await page.locator(`[data-node="${hidden[0].id}"]`).click();
  await expect(page.getByTestId('run-detail')).toHaveAttribute('data-hidden', '1');
  expect(await page.getByTestId('run-detail').innerText()).not.toMatch(/Бой|Привал|Торговец|Событие|Находка/);
  expect(errors).toEqual([]);
});

const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);
/** The fight of the run's first open node, entered by two real clicks (the node, «В бой»). */
async function enterFight(page: Page, run: RtRunState): Promise<void> {
  await openSave(page, run);
  await page.locator(`[data-node="${rtAvailableNodes(run)[0].id}"]`).click();
  await page.getByTestId('run-enter').click();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.snapshot().status)).toBe('playing');
}
/** A quiet field: nobody walks or touches, no newcomers; only the commands of the test move the world (they are journalled, the fight replays in Node). */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of Object.entries({ enemySpeed: 0, wolfSpeed: 0, speedSpread: 0, contactDamage: 0, baseIntervalMin: 1000, baseIntervalMax: 1000, baseFloor: 0, reaperEnabled: false })) rt.setParam(k, v);
    rt.clear(false);
  });
}

test('«Гроза»: the mark stands at the crowd and blinks, the label «Заведи толпу» hangs at it; the strike kills the crowd in the circle (counted), the label goes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const run = mapRun(seedWith('storm', ['storm']), ['storm']);
  expect(rtFightOmens(run, rtAvailableNodes(run)[0])).toEqual({ level: 'storm' });
  await enterFight(page, run);
  // The fight's omens come up over the hero for a moment (a world flash, not a HUD line).
  let s = await snap(page);
  expect(s.omens.ids).toEqual(['storm']);
  expect(s.omens.shown.flash).toEqual(['storm']);
  await shot(page, 't56-storm-start');
  await quiet(page);
  s = await snap(page);
  const hero = s.hero, at = { x: s.hero.x > 8 ? s.hero.x - 5 : s.hero.x + 5, y: s.hero.y };
  // Four enemies close together, away from the hero (the circle must not reach him).
  await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; for (const [dx, dy] of [[0, 0], [0.5, 0], [-0.4, 0.3], [0.1, -0.5]]) rt.place(x + dx, y + dy, 0, 0, 'basic'); }, [at.x, at.y] as const);
  // The first mark: from the 6th second.
  const mark = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.omens.storm?.mark ? q.omens : late ? q.omens : undefined), null, 14);
  expect(mark.storm.mark, 'the mark stands').toBeTruthy();
  s = await snap(page);
  expect(Math.hypot(s.omens.storm.mark.x - at.x, s.omens.storm.mark.y - at.y)).toBeLessThan(1);
  expect(s.omens.shown).toMatchObject({ stormMark: 1, stormRing: 1 });
  // The circle blinks: both phases show over a short stretch of frames.
  const blink = await untilFrame(page, (q: any, seen: number[], late: boolean) => { const on = q.omens.shown.stormBlinkOn; if (!seen.includes(on)) seen.push(on); return seen.length === 2 || late ? seen : undefined; }, [] as number[], 0.8);
  expect(blink.sort()).toEqual([0, 1]);
  // The label «Заведи толпу» at the mark (until a strike kills).
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).toContain('omen-storm');
  expect((await snap(page)).onboarding.labels.find((l: any) => l.id === 'omen-storm').text).toBe('Заведи толпу');
  await shot(page, 't56-storm-mark');
  // The strike: the crowd in the circle dies, the kills count; the label is gone and the viewer's memory has it.
  const killsBefore = (await snap(page)).kills;
  const after = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.omens.shown.strikes > 0 || late ? q : undefined), null, 3);
  expect(after.omens.shown.strikes).toBeGreaterThan(0);
  s = await snap(page);
  expect(s.kills - killsBefore).toBeGreaterThanOrEqual(3);
  expect(s.hero.hp).toBe(hero.hp);
  await shot(page, 't56-storm-strike');
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).not.toContain('omen-storm');
  expect((await snap(page)).onboarding.shown).toContain('omen-storm');
  // The journal of the fight replays in Node to the page's hash.
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});

/** A real chain by the mouse through the points (arena units), held; `release` lets go and waits for the dash to end. */
async function drawThrough(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const first = await screen(page, points[0].x, points[0].y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) { const q = await screen(page, p.x, p.y); await page.mouse.move(q.x, q.y, { steps: 4 }); }
}
/** Two animation frames: what the view draws of the state the last input made. */
const frames = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
async function release(page: Page): Promise<void> {
  await page.mouse.up();
  expect(await untilFrame(page, (s: any, _a: null, late: boolean) => (s.moving === null && s.time > 0 ? true : late ? s.moving : undefined), null, 10)).toBe(true);
}
test('«Половодье»: three pools stand; a link taken in water carries a drop and +1 (highlight = pass: the 2-HP enemy in the pool dies from one link, the dry one does not); the label «Мокрым +1» goes with the first wet link', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const run = mapRun(seedWith('flood', ['flood']), ['flood']);
  await enterFight(page, run);
  let s = await snap(page);
  expect(s.omens.ids).toEqual(['flood']);
  expect(s.omens.pools).toHaveLength(3);
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.teleport(8, 5));
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.3);
  s = await snap(page);
  const pool = s.omens.pools[0];
  await shot(page, 't56-flood');
  // The label at the nearest pool in view.
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).toContain('omen-flood');
  expect((await snap(page)).onboarding.labels.find((l: any) => l.id === 'omen-flood').text).toBe('Мокрым +1');
  // A dry enemy of 2 HP: its link is not wet; the highlight says it survives; the pass leaves it hurt (hp 1).
  const dry = { x: pool.x + (pool.x > 8 ? -3.6 : 3.6), y: pool.y };
  await page.evaluate(([x, y, px, py]) => { const rt = (window as any).__realtime; rt.teleport(x, y); rt.place(px, py, 0, 2, 'basic'); }, [dry.x + (dry.x > pool.x ? 1.7 : -1.7), dry.y, dry.x, dry.y] as const);
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.2);
  await drawThrough(page, [dry]);
  await frames(page);
  s = await snap(page);
  expect(s.omens.chain.map((l: any) => l.wet)).toEqual([false]);
  expect(s.omens.shown.wet).toBe(0);
  expect(s.omens.plan.kills).toBe(0);
  expect(s.omens.plan.links[0]).toMatchObject({ damage: 1, killed: false, hpAfter: 1 });
  const killsBefore = s.kills;
  await release(page);
  s = await snap(page);
  expect(s.kills).toBe(killsBefore);
  expect(s.enemies.find((e: any) => Math.hypot(e.x - dry.x, e.y - dry.y) < 1)?.hp).toBe(1);
  // The same enemy placed in the pool: the link is wet, a drop stands at it, the highlight shows the kill, the pass kills it.
  await page.evaluate(() => (window as any).__realtime.clear(false));
  await page.evaluate(([x, y, px, py]) => { const rt = (window as any).__realtime; rt.teleport(x, y); rt.place(px, py, 0, 2, 'basic'); }, [pool.x + (pool.x > 8 ? -1.8 : 1.8), pool.y, pool.x, pool.y] as const);
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.2);
  await drawThrough(page, [{ x: pool.x, y: pool.y }]);
  await frames(page);
  s = await snap(page);
  expect(s.omens.chain.map((l: any) => l.wet)).toEqual([true]);
  expect(s.omens.shown.wet).toBe(1);
  expect(s.omens.plan.kills).toBe(1);
  expect(s.omens.plan.links[0]).toMatchObject({ wet: true, damage: 2, killed: true });
  await shot(page, 't56-flood-wet');
  const before = s.kills;
  await release(page);
  s = await snap(page);
  expect(s.kills - before).toBe(1);
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).not.toContain('omen-flood');
  expect((await snap(page)).onboarding.shown).toContain('omen-flood');
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});

test('«Сонный час»: the sleepers carry «z» and the label «Спят до цепи»; the first pass wakes them (a jolt, the rage rings); the time wakes them too', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const run = mapRun(seedWith('drowse', ['drowse']), ['drowse']);
  await enterFight(page, run);
  let s = await snap(page);
  expect(s.omens.ids).toEqual(['drowse']);
  await quiet(page);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.teleport(8, 5); for (const [x, y] of [[10, 4], [10.5, 5.2], [11, 6.2]]) rt.place(x, y, 0, 0, 'basic'); });
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.4);
  s = await snap(page);
  expect(s.omens.sleepers).toBe(3);
  expect(s.sleepMarks).toBe(3);
  expect(s.omens.woke).toBeNull();
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).toContain('omen-drowse');
  expect((await snap(page)).onboarding.labels.find((l: any) => l.id === 'omen-drowse').text).toBe('Спят до цепи');
  await shot(page, 't56-drowse');
  // The first pass: a chain through one sleeper (a sleeper in the chain is struck as any), the others wake.
  await page.evaluate(() => (window as any).__realtime.teleport(8.8, 5));
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.2);
  await drawThrough(page, [{ x: 10, y: 4 }]);
  await page.mouse.up();
  const woke = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.omens.woke !== null || late ? q.omens : undefined), null, 3);
  expect(woke.woke).not.toBeNull();
  s = await snap(page);
  expect(s.omens.sleepers).toBe(0);
  // Every enemy alive woke (the one struck in the pass may be gone already): all of them rage.
  expect(s.omens.raging).toBe(s.enemies.length);
  expect(s.omens.raging).toBeGreaterThanOrEqual(2);
  // The view draws the frame after the sim's: wait for the jolt it makes of the event.
  expect((await untilFrame(page, (q: any, _a: null, late: boolean) => (q.omens.shown.wakes > 0 || late ? q : undefined), null, 1)).omens.shown.wakes).toBe(1);
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).not.toContain('omen-drowse');
  expect((await snap(page)).onboarding.shown).toContain('omen-drowse');
  await shot(page, 't56-drowse-woke');
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  // Without a chain the time wakes them: a new fight, the same enemies, nobody draws.
  await enterFight(page, run);
  await quiet(page);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.teleport(8, 5); rt.place(10, 4, 0, 0, 'basic'); });
  expect((await untilFrame(page, (q: any, _a: null, late: boolean) => (q.omens.sleepers > 0 || late ? q : undefined), null, 1)).omens.sleepers).toBe(1);
  const late = await untilFrame(page, (q: any, _a: null, l: boolean) => (q.omens.woke !== null || l ? q : undefined), null, 6);
  expect(late.omens.woke).not.toBeNull();
  expect(late.omens.woke).toBeGreaterThanOrEqual(3.9);
  expect(late.omens.woke).toBeLessThan(4.5);
  expect(late.omens.sleepers).toBe(0);
  expect(errors).toEqual([]);
});

/** The garrison's map open (the forest walked by the run's own commands): a run of the pool `pool`, its first garrison node available. */
function garrisonRun(pool: readonly string[]): RtRunState {
  for (let k = 1; k < 40; k++) {
    let found: RtRunState | null = null;
    walkRun({ k, create: { gift: 'mini', garrison: true, omens: pool }, each: run => { if (!found && run.garrisonLevel && !run.pending && !run.result && rtAvailableNodes(run).length) found = structuredClone(run); } });
    if (found) return found;
  }
  throw new Error('no run reached the garrison');
}

test('«Перекличка» (the garrison): horns over the enemies of the called colour, the label «Цвет зовут»; a link of that colour carries a horn and gives +1 energy (+0.5 otherwise)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const run = garrisonRun(['rollcall']);
  expect(rtLevelOmen(run)).toBe('rollcall');
  await enterFight(page, run);
  let s = await snap(page);
  expect(s.omens.ids).toEqual(['rollcall']);
  await quiet(page);
  // Three colours standing apart; the first call comes at the 3rd second.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.teleport(8, 5); rt.place(10.5, 4, 0, 0, 'basic'); rt.place(10.5, 5.5, 1, 0, 'basic'); rt.place(5.5, 5.5, 2, 0, 'basic'); rt.place(5.5, 4, 0, 0, 'basic'); });
  const called = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.omens.rollcall?.color !== undefined || late ? q : undefined), null, 8);
  const color = called.omens.rollcall.color as number;
  expect([0, 1, 2]).toContain(color);
  s = await snap(page);
  const of = s.enemies.filter((e: any) => e.color === color);
  expect(s.omens.shown.horns).toBe(of.length);
  expect(s.omens.shown.calls).toBe(1);
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).toContain('omen-rollcall');
  expect((await snap(page)).onboarding.labels.find((l: any) => l.id === 'omen-rollcall').text).toBe('Цвет зовут');
  await shot(page, 't56-rollcall');
  // A link of the called colour: its horn on the chain; the pass pays +1 energy. A link of another colour: +0.5.
  const target = of[0], other = s.enemies.find((e: any) => e.color !== color && e.color !== 2) ?? s.enemies.find((e: any) => e.color !== color);
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [target.x + (target.x > 8 ? -1.6 : 1.6), target.y] as const);
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.2);
  const e0 = (await snap(page)).energy;
  await drawThrough(page, [{ x: target.x, y: target.y }]);
  await frames(page);
  s = await snap(page);
  expect(s.omens.chain.map((l: any) => l.call)).toEqual([true]);
  expect(s.omens.shown.call).toBe(1);
  await shot(page, 't56-rollcall-link');
  await release(page);
  const gain = (await snap(page)).energy - e0;
  expect(gain).toBeCloseTo(1, 5);
  expect((await snap(page)).onboarding.shown).toContain('omen-rollcall');
  // Another colour: the link is not marked, the pass pays 0.5.
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [other.x + (other.x > 8 ? -1.6 : 1.6), other.y] as const);
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.2);
  const e1 = (await snap(page)).energy, now = (await snap(page)).enemies.find((e: any) => e.id === other.id);
  if (now && now.color !== (await snap(page)).omens.rollcall.color) {
    await drawThrough(page, [{ x: now.x, y: now.y }]);
    expect((await snap(page)).omens.chain.map((l: any) => l.call)).toEqual([false]);
    await release(page);
    expect((await snap(page)).energy - e1).toBeCloseTo(0.5, 5);
  }
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});

/** A map state of a walk of the pool `pool` where `pick` names an open node: the first such state over seeds 1…; the node's id with it. */
function mapWhere(pool: readonly string[], pick: (run: RtRunState, node: ReturnType<typeof rtNode> & object) => boolean, create: Parameters<typeof createRtRun>[1] = {}): { run: RtRunState; nodeId: string } {
  for (let k = 1; k < 80; k++) {
    let found: { run: RtRunState; nodeId: string } | null = null;
    walkRun({ k, create: { gift: 'mini', garrison: false, omens: pool, ...create }, each: run => {
      if (found || run.pending || run.result) return;
      const node = rtAvailableNodes(run).find(n => pick(run, n));
      if (node) found = { run: structuredClone(run), nodeId: node.id };
    } });
    if (found) return found;
  }
  throw new Error('no map state');
}

test('the card is the fight: the open node\'s card names its omen and its level\'s; «В бой» plays exactly those; after a reload the window «Бой» says the same', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const { run, nodeId } = mapWhere(POOL, (r, n) => (n.type === 'battle' || n.type === 'hard') && !!rtNodeOmen(r, n) && !!rtLevelOmen(r) && rtOmen(rtLevelOmen(r)!)?.where === 'fight' && rtFightOmens(r, n).level !== undefined);
  const node = rtNode(run, nodeId)!, omens = rtFightOmens(run, node), own = rtOmen(omens.node!)!;
  expect(omens.node).toBeTruthy();
  await openSave(page, run);
  await page.locator(`[data-node="${nodeId}"]`).click();
  await expect(page.getByTestId('run-danger-omen')).toContainText(`Примета: «${own.title}»`);
  await expect(page.getByTestId('run-danger-omen')).toHaveAttribute('data-omen', omens.node!);
  await expect(page.getByTestId('run-danger-omen-level')).toHaveAttribute('data-omen', omens.level!);
  await shot(page, 't56-card-open');
  await page.getByTestId('run-enter').click();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.snapshot().status)).toBe('playing');
  // The fight plays the card's omens: the level's first, then the node's (the order they act in).
  expect((await snap(page)).omens.ids).toEqual([omens.level, omens.node]);
  expect((await snap(page)).omens.shown.flash).toEqual([omens.level, omens.node]);
  await shot(page, 't56-fight-two');
  // The fight is not saved: after a reload the window «Бой» stands over the map with the same omens.
  await page.reload();
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await expect(page.getByTestId('run-battle-modal').getByTestId('run-danger-omen')).toHaveAttribute('data-omen', omens.node!);
  await expect(page.getByTestId('run-battle-modal').getByTestId('run-danger-omen-level')).toHaveAttribute('data-omen', omens.level!);
  await shot(page, 't56-battle-window');
  expect(errors).toEqual([]);
});

test('«Ярмарочный день»: the merchant\'s «Перебросить — бесплатно» says «от приметы» with the fair\'s icon; the goods are drawn again; the heal on the map costs 1 more', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const { run, nodeId } = mapWhere(['fair'], (_r, n) => n.type === 'shop');
  expect(rtLevelOmen(run)).toBe('fair');
  await openSave(page, run);
  // The header's sign is the fair's; the heal's price is core's (with the omen's +1).
  await expect(page.getByTestId('run-omen')).toHaveAttribute('data-omen', 'fair');
  const heal = page.getByTestId('run-heal');
  if (await heal.count()) expect(Number(await heal.getAttribute('data-price'))).toBe(healOffer(run).price);
  await page.locator(`[data-node="${nodeId}"]`).click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run-shop')).toBeVisible();
  const reroll = page.getByTestId('shop-reroll');
  await expect(reroll).toBeEnabled();
  await expect(reroll).toHaveText('Перебросить — бесплатно');
  await expect(reroll).toHaveAttribute('data-fair', '1');
  await expect(page.getByTestId('shop-reroll-fair')).toContainText('от приметы «Ярмарочный день»');
  await expect(page.getByTestId('shop-reroll-fair').locator('.rt-omen-icon')).toHaveAttribute('data-omen', 'fair');
  const goods = (): Promise<string[]> => page.locator('[data-testid^="shop-"][data-action="shop-buy"]').evaluateAll(els => els.map(el => el.getAttribute('data-testid')!));
  const before = await goods();
  await shot(page, 't56-shop');
  await reroll.click();
  // Once at each merchant: the omen's reroll is spent; the stock is the draw again (the same ids may come back by chance).
  await expect(page.getByTestId('shop-reroll')).toBeDisabled();
  expect((await goods()).length).toBe(before.length);
  expect(errors).toEqual([]);
});

const PROFILE = 'ashen-oath-rt-profile-v1';
const BATTLE = ['battle', 'hard', 'checkpoint', 'breakthrough', 'boss'];
/** The run of the meta (no given seed) with its first fight won and the second lost — the end screen of the profile `profile`'s hero. */
async function playToEnd(page: Page, profile: object): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, p]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem(key as string, JSON.stringify(p)); }, [PROFILE, profile] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  const none = page.getByTestId('habit-none');
  if (await none.count() && await none.isEnabled()) await none.click();
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  const toBattle = async (): Promise<void> => {
    for (let step = 0; step < 8; step++) {
      const nodes = page.locator('[data-status="available"]');
      await expect(nodes.first()).toBeVisible();
      const types = await nodes.evaluateAll(els => els.map(e => e.getAttribute('data-type')));
      const pick = types.findIndex(t => BATTLE.includes(t ?? ''));
      await nodes.nth(pick >= 0 ? pick : 0).click();
      await page.getByTestId('run-enter').click();
      if (pick >= 0) { await expect(page.getByTestId('run')).toBeHidden(); return; }
      for (let k = 0; k < 8 && await page.getByTestId('run').isVisible() && !(await page.locator('[data-status="available"]').first().isVisible().catch(() => false)); k++) {
        const choice = page.locator('.rt-run-modal button.rt-run-choice:not([disabled]), .rt-run-modal .rt-again, .rt-run-modal .rt-other:not([disabled])').first();
        if (await choice.isVisible().catch(() => false)) await choice.click(); else await page.waitForTimeout(300);
      }
    }
    throw new Error('no battle reached');
  };
  await toBattle();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await leaveResult(page);
  await expect(page.getByTestId('run')).toBeVisible();
  await toBattle();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await leaveResult(page);
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
}

test('the meta: a run past the gates ends with «Приметы: +1» and the pack «Охотник» opens «Гроза» — a card of its own after the three', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  // 58 experience: the first win and the death after it carry the hero over 60 — the pack «Охотник» opens «Гроза» (core's `RT_OMEN_PACKS`).
  await playToEnd(page, { version: 1, giftFull: false, runs: 3, omensOpen: true, meta: { heroes: { cat: { xp: 58, packs: [], record: { row: 6, won: false, xp: 40 } } }, hearth: { stock: 9, levels: { owl: 0, herb: 0, smith: 0 }, met: { herb: true, smith: true }, lines: { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2 }, quiet: 0 } } });
  await expect(page.getByTestId('meta-pack')).toHaveAttribute('data-pack', 'hunter');
  await expect(page.getByTestId('meta-omens')).toHaveText('Приметы: +1');
  const card = page.getByTestId('pack-card-3');
  await expect(card).toHaveAttribute('data-item', 'storm');
  await expect(card).toContainText('Гроза');
  await expect(card).toContainText('примета');
  await expect(card.locator('.rt-omen-icon').first()).toHaveAttribute('data-omen', 'storm');
  await expect(page.getByTestId('pack-card-3')).toHaveClass(/rt-flipped/, { timeout: 8_000 });
  await page.waitForTimeout(1800);
  await shot(page, 't56-meta-end');
  expect(errors).toEqual([]);
});

test('the meta: a run before the gates says nothing of omens (no line, no card)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await playToEnd(page, { version: 1, giftFull: false, runs: 3, meta: { heroes: { cat: { xp: 58, packs: [], record: { row: 6, won: false, xp: 40 } } }, hearth: { stock: 9, levels: { owl: 0, herb: 0, smith: 0 }, met: { herb: true, smith: true }, lines: { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2 }, quiet: 0 } } });
  await expect(page.getByTestId('meta-pack')).toHaveAttribute('data-pack', 'hunter');
  await expect(page.getByTestId('meta-omens')).toHaveCount(0);
  await expect(page.getByTestId('pack-card-3')).toHaveCount(0);
  await expect(page.getByTestId('run-omen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** `n` weak enemies of one colour in a row from the hero away from the door, drawn through with the mouse and released (as tests/realtime-bag.spec.ts). */
async function chainRow(page: Page, hero: { x: number; y: number }, dir: number, n: number): Promise<void> {
  await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; rt.clear(false); rt.teleport(x, y); }, [hero.x, hero.y] as const);
  const points = Array.from({ length: n }, (_, i) => ({ x: hero.x + dir * 1.3 * (i + 1), y: hero.y }));
  await page.evaluate(ps => { for (const p of ps) (window as any).__realtime.place(p.x, p.y, 0, 0, 'basic'); }, points);
  await untilFrame(page, (_s: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.2);
  await drawThrough(page, points);
  expect((await snap(page)).chain.length, 'the drawn chain').toBe(n);
  await release(page);
}

test('«Урожай»: the sack stands at the open door with «Удар — всё сначала» beside it until the first step fills (10 kills fill step 1, the next one pays 4)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const { run, nodeId } = mapWhere(['harvest'], (r, n) => (n.type === 'battle' || n.type === 'hard') && rtFightOmens(r, n).level === 'harvest' && !!rtNode(r, n.id) && n.row >= 7);
  await openSave(page, run);
  await page.locator(`[data-node="${nodeId}"]`).click();
  await page.getByTestId('run-enter').click();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.snapshot().status)).toBe('playing');
  expect((await snap(page)).omens.ids).toEqual(['harvest']);
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  const open = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.bagView.visible || late ? q : undefined), null, 3);
  expect(open.bagView.visible).toBe(true);
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).toContain('omen-harvest');
  expect((await snap(page)).onboarding.labels.find((l: any) => l.id === 'omen-harvest').text).toBe('Удар — всё сначала');
  await shot(page, 't56-harvest');
  // Ten kills fill step 1: the pay is doubled (2, not 1), the label goes.
  let s = await snap(page);
  const door = s.objects.find((o: any) => o.kind === 'door'), dir = Math.sign(s.bagView.x - door.x), hero = { x: s.bagView.x + dir * 1.5, y: door.y };
  await chainRow(page, hero, dir, 4);
  await chainRow(page, hero, dir, 3);
  await chainRow(page, hero, dir, 3);
  s = await snap(page);
  expect(s.bag).toMatchObject({ step: 1, kills: 10 });
  expect(s.bag.reward).toBe(4);
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).not.toContain('omen-harvest');
  expect((await snap(page)).onboarding.shown).toContain('omen-harvest');
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});
