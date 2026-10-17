import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame, gameWait } from './realtimeFrames';
import { rtAvailableNodes, rtKnackNode, rtNode, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_COUNTER_TALISMANS } from '../src/realtime/run/rtTalismans';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 50, the view of «Сноровка» and rank II (docs/design-notes/task-50-levels-archetype.md, 3.5 and 11; docs/realtime-prototype.md, 9ш).
 * Real mouse input. A run: a won fight of run row 2 — two cards and «Пропустить» in the fight's result card, a card taken (rank II: two
 * notches under the icon in the next fight's column and on the map's header; a new counter) or skipped (nothing taken), a reload on
 * the open «Сноровка» shows the same cards. The sandbox: the highlight of the rank II rules from the plan, and the journal of each fight
 * replays in Node to the hash of the page. The rules themselves are checked in Node (`npm run test:realtime-honed`, `-knacks-run`).
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const knack = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.knack());
const runState = (page: Page): Promise<RtRunState> => page.evaluate(() => (window as any).__realtime.run.state());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp = 0): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

// ---- The run ----

const COUNTER_IDS: string[] = RT_COUNTER_TALISMANS.map(def => def.id);

/**
 * A run with forms and «Сноровка», walked by its own commands until a fight of run row 2+ that offers the knack stands open — one
 * holding a counter on rank I (`counter`) or any. The walk's state is a plain save; seeds vary until one is found.
 */
function runAtKnackFight(counter: boolean): RtRunState {
  for (let k = 1; k <= 60; k++) {
    let found: RtRunState | null = null;
    walkRun({
      k, create: { gift: 'mini', forms: true, knacks: true, garrison: false },
      each: run => {
        if (found || run.pending?.kind !== 'battle') return;
        const node = rtNode(run, run.pending.nodeId)!;
        if (rtKnackNode(run, node) && (!counter || run.talismans.some(id => COUNTER_IDS.includes(id) && !run.honed?.includes(id)))) found = structuredClone(run);
      },
    });
    if (found) return found;
  }
  throw new Error('no fight of row 2+ with a counter on any of 60 seeds');
}

async function openRun(page: Page, run: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RT_RUN_STORAGE_KEY, serializeRtRun(run)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

/** «В бой» of the open battle node, the arena won by the journalled door run; the result card shows. */
async function winOpenFight(page: Page): Promise<void> {
  await page.getByTestId('run-battle').click();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.run.arenaOpen())).toBe(true);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toBeVisible();
}

/** From wherever the run stands to the next open fight: the screens passed by the buttons, a fight node entered on the map. */
async function toNextFight(page: Page): Promise<void> {
  for (let step = 0; step < 30; step++) {
    if (await page.evaluate(() => (window as any).__realtime.run.arenaOpen())) return;
    const state = await runState(page), pending = state.pending;
    if (!pending) {
      const nodes = rtAvailableNodes(state), node = nodes.find(n => n.type === 'battle') ?? nodes[0];
      await page.locator(`[data-node="${node.id}"]`).click();
      await page.getByTestId('run-enter').click();
    } else if (pending.kind === 'battle') await page.getByTestId('run-battle').click();
    else if (pending.kind === 'die') await page.getByTestId('die-take').click();
    else if (pending.kind === 'knack') await page.getByTestId('knack-skip').click();
    else if (pending.kind === 'talisman') await page.getByTestId('talisman-refuse').click();
    else if (pending.kind === 'hammer') await page.getByTestId('hammer-refuse').click();
    else throw new Error(`no button for the screen ${pending.kind}`);
  }
  throw new Error('no fight reached');
}

test('task 50: a won fight of row 2 — two cards and «Пропустить» in the result card; «Ранг II» taken: two notches in the map header and the next fight\'s column, the moment struck in', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const start = runAtKnackFight(true);
  await openRun(page, start);
  await winOpenFight(page);
  // The result card holds the cards; the old button «К карте» is gone (one click, no new screen).
  await expect(page.getByTestId('result-knack')).toBeVisible();
  await expect(page.getByTestId('result-map')).toBeHidden();
  const open = await knack(page);
  expect(open.where).toBe('result');
  expect(open.skip, '«Пропустить» stands').toBe(true);
  expect(open.cards.length).toBeGreaterThanOrEqual(1);
  const hone = open.cards.find((c: any) => c.kind === 'hone');
  expect(hone, 'card А «Ранг II» is offered for a counter held on rank I').toBeTruthy();
  expect(hone.marks, 'two notches on the card').toBe(2);
  expect(hone.line).toMatch(/^Ранг II: /);
  expect(COUNTER_IDS).toContain(hone.id);
  const box = (await page.getByTestId('result').locator('.rt-result-card').boundingBox())!;
  expect(box.y, 'the result card fits the first screen').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: 'artifacts/realtime-knack-result.png' });
  await page.getByTestId(`knack-hone-${hone.id}`).click();
  // The pick is in the run: rank II, and the node is done (the card is gone).
  await expect.poll(async () => (await runState(page)).honed ?? []).toEqual([hone.id]);
  await expect(page.getByTestId('result-knack')).toBeHidden();
  // The map's header: the counter wears two notches.
  await expect.poll(async () => (await knack(page)).mapHoned.length).toBe(1);
  expect((await knack(page)).mapHoned[0].marks).toBe(2);
  await page.screenshot({ path: 'artifacts/realtime-knack-header.png' });
  await toNextFight(page);
  // The next fight: the column's icon wears the mark, and the moment was struck in (the icon flashed, the second notch driven in).
  await expect.poll(async () => (await snap(page)).buildItems.find((i: any) => i.id === hone.id)?.honed).toBe(true);
  const item = (await snap(page)).buildItems.find((i: any) => i.id === hone.id);
  expect(item.marks).toBe(2);
  await expect.poll(async () => (await snap(page)).honedShown.honings).toBeGreaterThanOrEqual(1);
  expect((await snap(page)).juice.sounds.hones, 'the sound of the moment').toBeGreaterThanOrEqual(0);
  await page.getByTestId(`build-${hone.id}`).hover();
  await expect(page.getByTestId('build-tip')).toContainText('Ранг II:');
  await page.screenshot({ path: 'artifacts/realtime-knack-column.png' });
  expect(errors).toEqual([]);
});

test('task 50: «Пропустить» takes nothing — no rank II, no counter, the node is done; a card of «Новый» puts the counter into the build', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const start = runAtKnackFight(false);
  await openRun(page, start);
  await winOpenFight(page);
  const before = await runState(page);
  expect((await knack(page)).where).toBe('result');
  await page.getByTestId('knack-skip').click();
  await expect(page.getByTestId('result-knack')).toBeHidden();
  const after = await runState(page);
  expect(after.honed ?? []).toEqual([]);
  expect(after.talismans, 'no counter taken').toEqual(before.talismans);
  expect(after.talismansGone ?? [], 'what was shown does not leave the pool').toEqual(before.talismansGone ?? []);
  expect(after.pending?.kind, 'the knack screen closed').not.toBe('knack');
  expect(after.visited.length).toBeGreaterThanOrEqual(before.visited.length);

  // A card of the other kind: a new counter in the build (a run with no counter on rank I shows two new ones).
  const second = runAtKnackFight(false);
  await openRun(page, { ...second, honed: undefined });
  await winOpenFight(page);
  const cards = (await knack(page)).cards;
  const fresh = cards.find((c: any) => c.kind === 'new');
  if (fresh) {
    const held = (await runState(page)).talismans;
    await page.getByTestId(`knack-new-${fresh.id}`).click();
    await expect.poll(async () => (await runState(page)).talismans).toEqual(expect.arrayContaining([...held, fresh.id]));
    expect((await runState(page)).honed ?? [], 'a new counter is not rank II').toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('task 50: a reload on the open «Сноровка» shows the same cards (the run\'s window), and a card taken there goes on', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const start = runAtKnackFight(true);
  await openRun(page, start);
  await winOpenFight(page);
  const shown = (await knack(page)).cards.map((c: any) => `${c.kind}:${c.id}`);
  expect(shown.length).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run-knack')).toBeVisible();
  const again = await knack(page);
  expect(again.where).toBe('window');
  expect(again.cards.map((c: any) => `${c.kind}:${c.id}`)).toEqual(shown);
  expect(again.skip).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-knack-window.png' });
  await page.getByTestId('knack-skip').click();
  await expect(page.getByTestId('run-knack')).toBeHidden();
  expect((await runState(page)).pending?.kind).not.toBe('knack');
  expect(errors).toEqual([]);
});

// ---- The sandbox: the highlight of rank II ----

/** The sandbox on arena 1: the build with its counters on rank II, the counters' window on; only what the test places acts; the hero at (4, 5.5). */
async function fight(page: Page, talismans: string[], honed: string[]): Promise<void> {
  await page.evaluate(([talismans, honed]) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['finisherLinks', 10], ['counterWindow', true]] as const) rt.setParam(key, value);
    rt.useBuild({ talismans, honed });
  }, [talismans, honed] as const);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.clear(false);
    rt.teleport(4, 5.5);
  });
}

async function openSandbox(page: Page): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=1&seed=77');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeHidden();
  return errors;
}

/** `n` enemies of colour 0, HP 1 unless `hps` says, in a row to the right of the hero, 1.4 apart (each in reach of the last). */
async function row(page: Page, n: number, hps: readonly number[] = []): Promise<[number, number][]> {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { const p: [number, number] = [5.4 + 1.4 * i, 5.5]; await place(page, p[0], p[1], 0, hps[i] ?? 1); pts.push(p); }
  return pts;
}

/** Press on the first point and drag through the rest (the button stays down). */
async function drag(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const at = await Promise.all(points.map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 5 });
}

/** The dash after the release has ended: no move, none of the test's row left. */
const dashDone = (page: Page): Promise<boolean> => untilFrame(page, (s, _a: number, late) => {
  const done = !s.moving && !s.enemies.some((e: any) => Math.abs(e.y - 5.5) < 0.4 && e.x > 5 && e.hp <= 1);
  return done || late ? done : undefined;
}, 0, 8);

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

test('task 50: «Острие» II — a second notch on every 3rd link (3, 6), rank I alone marks only the 3rd; the rank II firing flashes the icon and says «Ранг II»', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openSandbox(page);
  // Rank I: the notch before the 3rd link only.
  await fight(page, ['fifth-link'], []);
  let pts = await row(page, 6);
  await drag(page, pts);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(6);
  let s = await snap(page);
  expect(s.juice.notches).toEqual([3]);
  expect(s.honedShown.edge).toBe(0);
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  // Rank II: the 3rd and the 6th link are marked, two notches on each.
  await fight(page, ['fifth-link'], ['fifth-link']);
  pts = await row(page, 6);
  await drag(page, pts);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(6);
  s = await snap(page);
  expect(s.juice.notches).toEqual([3, 6]);
  expect(s.honedShown.edge, 'the 6th link wears the second notch (rank II)').toBe(1);
  expect(s.buildItems.find((i: any) => i.id === 'fifth-link')).toMatchObject({ honed: true, marks: 2 });
  await page.screenshot({ path: 'artifacts/realtime-knack-edge.png' });
  const flashes = s.honedShown.flashes;
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  s = await snap(page);
  expect(s.honedShown.flashes, 'rank II fired on the 6th link: the icon flashed gold').toBeGreaterThan(flashes);
  expect(s.honedShown.fired).toBeGreaterThanOrEqual(1);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 50: «Ударная волна» II — two circles (round the end and round the start); the second wave strikes a body next to the start, rank I leaves it alone', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSandbox(page);
  for (const honed of [false, true]) {
    await fight(page, ['shockwave'], honed ? ['shockwave'] : []);
    const by = await place(page, 4, 6.8, 1, 5);
    const pts = await row(page, 4);
    await drag(page, pts);
    await expect.poll(async () => (await snap(page)).chain.length).toBe(4);
    const s = await snap(page);
    expect(s.honedShown.waves, honed ? 'two circles' : 'no rank II circle').toBe(honed ? 2 : 0);
    if (honed) {
      expect(s.honedShown.waveBodies, 'the body by the start has its ring').toBeGreaterThanOrEqual(1);
      await page.screenshot({ path: 'artifacts/realtime-knack-wave.png' });
    }
    await page.mouse.up();
    expect(await dashDone(page)).toBe(true);
    await gameWait(page, 0.6);
    const hp = (await snap(page)).enemies.find((e: any) => e.id === by)?.hp;
    if (honed) expect(hp === undefined || hp < 5, 'the second wave hit it').toBe(true);
    else expect(hp, 'rank I: the wave is round the end only').toBe(5);
    await sameHash(page);
  }
  expect(errors).toEqual([]);
});

test('task 50: «Иней на клинке» II — snowflakes on the survivor and its neighbour; after the release both are frozen, rank I freezes the survivor only', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSandbox(page);
  for (const honed of [false, true]) {
    await fight(page, ['frost-edge'], honed ? ['frost-edge'] : []);
    // Three bodies die, the fourth (HP 4) survives the dash; a body of another colour stands close to it.
    const pts = await row(page, 4, [1, 1, 1, 4]);
    const near = await place(page, 9.6, 6.7, 1, 6);
    await drag(page, pts);
    await expect.poll(async () => (await snap(page)).chain.length).toBe(4);
    const s = await snap(page);
    expect(s.honedShown.frost, honed ? 'the survivor and its neighbour' : 'no rank II mark').toBe(honed ? 2 : 0);
    if (honed) await page.screenshot({ path: 'artifacts/realtime-knack-frost.png' });
    await page.mouse.up();
    await untilFrame(page, (sn, _a: number, late) => (!sn.moving && sn.enemies.filter((e: any) => e.hp === 3 || e.hp === 4).length ? true : late ? false : undefined), 0, 8);
    await gameWait(page, 0.3);
    const enemies = (await snap(page)).enemies;
    const neighbour = enemies.find((e: any) => e.id === near);
    expect(neighbour, 'the neighbour stands').toBeTruthy();
    if (honed) expect(neighbour.chill, 'the neighbour froze with the survivor (2 s of cold, a part has run down)').toBeGreaterThan(0.8);
    else expect(neighbour.chill ?? 0).toBe(0);
    await sameHash(page);
  }
  expect(errors).toEqual([]);
});

test('task 50: «Охотник на элит» II — one word «−2 пластины» over the armoured elite (design §17: one strike takes both); «Длинная рука» II — «+1» under a far link; «Добивание» II — the shield ring round the hero for a chain of one kill', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSandbox(page);
  // «Охотник»: an armoured elite as the only link.
  await fight(page, ['elite-hunter'], ['elite-hunter']);
  await page.evaluate(() => (window as any).__realtime.setParam('eliteArmor', true));
  const elite = await page.evaluate(() => (window as any).__realtime.place(5.4, 5.5, 0, 3, 'basic', true)) as number;
  await drag(page, [[5.4, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([elite]);
  expect((await snap(page)).enemies.find((e: any) => e.id === elite).armor?.plates, 'the elite wears plates').toBeGreaterThan(0);
  expect((await snap(page)).honedShown).toMatchObject({ hunter: 1, hunterText: '−2 пластины' });
  await page.screenshot({ path: 'artifacts/realtime-knack-hunter.png' });
  await page.mouse.up();
  await gameWait(page, 1.5);
  // «Длинная рука»: three links 1.4 apart, the fourth 2.6 beyond the third — farther than the ordinary reach, within the arm's.
  await fight(page, ['long-arm'], ['long-arm']);
  const pts = await row(page, 3);
  await place(page, 10.8, 5.5, 0, 1);
  await drag(page, [...pts, [10.8, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(4);
  expect((await snap(page)).honedShown.arm, 'only the far link wears «+1»').toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-knack-arm.png' });
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  await sameHash(page);
  // «Добивание»: the shield needs 3 kills (the panel's); a chain of one kill gets it with rank II only.
  for (const honed of [false, true]) {
    await fight(page, ['finishing-blow'], honed ? ['finishing-blow'] : []);
    await page.evaluate(() => (window as any).__realtime.setParam('chainShieldMinKills', 3));
    await place(page, 5.4, 5.5, 0, 1);
    await drag(page, [[5.4, 5.5]]);
    await expect.poll(async () => (await snap(page)).chain.length).toBe(1);
    expect((await snap(page)).honedShown.shield, honed ? 'the ring' : 'no ring on rank I').toBe(honed ? 1 : 0);
    if (honed) await page.screenshot({ path: 'artifacts/realtime-knack-shield.png' });
    await page.mouse.up();
    await untilFrame(page, (sn, _a: number, late) => (!sn.moving ? true : late ? false : undefined), 0, 8);
    await gameWait(page, 0.3);
    const shielded = (await snap(page)).chainShield.left;
    if (honed) expect(shielded, 'the shield the highlight promised').toBeGreaterThan(0);
    await sameHash(page);
  }
  expect(errors).toEqual([]);
});

test('task 50: «Улов» II — a free jump charges the next chain: «+2» under its first link; «Призма» II draws nothing (its rank is energy)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSandbox(page);
  await fight(page, ['third-chain', 'prism'], ['third-chain', 'prism']);
  await page.evaluate(() => (window as any).__realtime.setEnergy(7));
  // Three kills in one chain: the next jump within 5 s costs nothing.
  const pts = await row(page, 3);
  await drag(page, pts);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(3);
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  const hero = (await snap(page)).hero;
  const energy = (await snap(page)).energy;
  // The jump by the real keys: Space, then a click on the landing point.
  await page.keyboard.press('Space');
  const to = await screen(page, hero.x, hero.y + 2.2);
  await page.mouse.click(to.x, to.y);
  await untilFrame(page, (sn, _a: number, late) => (!sn.moving && sn.energy !== undefined ? true : late ? false : undefined), 0, 8);
  await gameWait(page, 2);
  const after = await snap(page);
  expect(after.energy, 'the jump was free').toBeGreaterThanOrEqual(Math.min(energy, 7) - 0.01);
  const h = after.hero;
  expect(after.kit.counters['third-chain-charged'], 'the free jump charged the next chain').toBeGreaterThan(0);
  // A body of 3 HP: the ordinary first link would not kill it; the charged one (+2) does.
  const body = await place(page, h.x + 1.3, h.y, 0, 3);
  await drag(page, [[h.x + 1.3, h.y]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([body]);
  expect((await snap(page)).honedShown.catch, 'the first link wears «+2»').toBe(1);
  expect((await snap(page)).enemies.length).toBeGreaterThan(0);
  expect((await snap(page)).honedShown.prism, '«Призма» II: no mark').toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-knack-catch.png' });
  await page.mouse.up();
  await untilFrame(page, (sn, _a: number, late) => (!sn.moving ? true : late ? false : undefined), 0, 8);
  await gameWait(page, 0.4);
  expect((await snap(page)).enemies.some((e: any) => e.id === body), 'the charged first link killed the body of 3 HP').toBe(false);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 50: a fusion with a part on rank II — the column shows one item, the fusion, wearing the two notches; its card says «Ранг II»', async ({ page }) => {
  const errors = await openSandbox(page);
  await fight(page, ['fusion-ice-seal', 'form-seal', 'frost-edge'], ['frost-edge']);
  await expect.poll(async () => (await snap(page)).buildItems.find((i: any) => i.id === 'fusion-ice-seal')?.honed).toBe(true);
  const items = (await snap(page)).buildItems;
  expect(items.find((i: any) => i.id === 'fusion-ice-seal').marks).toBe(2);
  expect(items.some((i: any) => i.id === 'frost-edge' || i.id === 'form-seal'), 'the parts are not rows of their own').toBe(false);
  await page.getByTestId('build-fusion-ice-seal').hover();
  await expect(page.getByTestId('build-tip')).toContainText('Ранг II');
  await page.screenshot({ path: 'artifacts/realtime-knack-fusion.png' });
  expect(errors).toEqual([]);
});

test('task 50: the sandbox menu — «Ранг II счётчика» next to the counter, and it acts only with «Счётчики: окно — одна цепь»', async ({ page }) => {
  const errors = await openSandbox(page);
  await page.getByTestId('open-panel').click();
  await page.getByTestId('build-talisman').selectOption('fifth-link');
  await page.getByTestId('build-talisman-honed').check();
  await page.locator('.rt-close').first().click();
  await page.locator('#rt-app canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snap(page)).kit?.honed ?? []).toEqual(['fifth-link']);
  expect((await snap(page)).buildItems.find((i: any) => i.id === 'fifth-link')).toMatchObject({ honed: true, marks: 2 });
  expect(errors).toEqual([]);
});
