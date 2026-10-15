import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { createRtRun, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { SCHEDULE_PRACTICE, SCHEDULE_RUN_ARENAS } from '../src/realtime/run/schedule';
import { JAILER_RUN_ARENAS } from '../src/realtime/sim/arenasBoss';

/**
 * The run of the real-time game in the browser (stage 2, step 1; docs/realtime-slice.md). Runs through
 * playwright.realtime.config.ts only. The page (index.html) opens on the run; the arena is won through the test hook
 * `__realtime.run.winArena` (the goals done and the hero put on the open door by journalled commands — the door's own
 * rule lets him in) and lost by a ring of enemies placed around the hero.
 */
interface RunState {
  seed: number; hp: number; maxHp: number; visited: string[]; currentNodeId: string | null;
  pending: { kind: string; nodeId?: string; arena?: string; seed?: number } | null; result: { outcome: string } | null;
}
const runState = (page: Page): Promise<RunState> => page.evaluate(() => (window as any).__realtime.run.state());
const snapshot = (page: Page) => page.evaluate(() => (window as any).__realtime.snapshot() as { seed: number; arena: string; time: number; status: string; hero: { x: number; y: number; hp: number; maxHp: number } });

async function openRun(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run')).toBeVisible();
}

/** A new run from the start screen; the start gift takes «+3 к максимуму HP» (a first run: the mini gift, its second button). */
async function newRun(page: Page): Promise<RunState> {
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  return runState(page);
}

/** Clicks the first available node of the map and enters it; returns its id. */
async function enterFirstNode(page: Page): Promise<string> {
  const node = page.locator('[data-status="available"]').first();
  const id = await node.getAttribute('data-node');
  await node.click();
  await page.getByTestId('run-enter').click();
  return id!;
}

test('run: a saved sandbox panel does not reach the run — no anchor, no elites on row 1, the panel\'s elite chance neither (task 17: the run plays the defaults)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await openRun(page, errors);
  // The panel as a sandbox session saved it.
  await page.evaluate(() => localStorage.setItem('ashen-oath-realtime-params-v17', JSON.stringify({ heroAnchor: true, eliteSandbox: true, eliteChance: 0.5, sandboxTalismans: 'hero-anchor', shieldFollowsHero: true })));
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  const params = await page.evaluate(() => { const p = (window as any).__realtime.params; return { heroAnchor: p.heroAnchor, eliteSandbox: p.eliteSandbox, eliteChance: p.eliteChance, shieldFollowsHero: p.shieldFollowsHero }; });
  // Iteration 2.1: «Песочница: щит следит за героем» is a stand-in too — off in a run. Task 17 (design answer 1, 13.10.2026):
  // the run takes the defaults, not the saved panel — the panel's elite chance 0.5 stays in the sandbox (the run's is 0.03).
  expect(params).toEqual({ heroAnchor: false, eliteSandbox: false, eliteChance: 0.03, shieldFollowsHero: false });
  // Newcomers keep coming for a few seconds of game time: none is an elite; no second anchor is drawn in a chain.
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 0));
  // Game time, not wall time: the software renderer of the tests may run the crowd slowly.
  await expect.poll(async () => (await snapshot(page)).time, { timeout: 60_000 }).toBeGreaterThan(5);
  const s = await page.evaluate(() => (window as any).__realtime.snapshot()) as { enemies: { elite: boolean }[]; heroAnchorShown: boolean };
  expect(s.enemies.length).toBeGreaterThan(5);
  expect(s.enemies.some(e => e.elite)).toBe(false);
  // The saved panel itself is untouched (the sandbox keeps its toggles).
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-params-v17')))!).heroAnchor).toBe(true);
  expect(errors).toEqual([]);
});

test('run: a battle node starts its arena with the run HP, a reload starts it again, a victory returns to the map, a reload keeps the run', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  const start = await newRun(page);
  expect(start.visited).toEqual([]);
  // Iteration 2.1: the run HP 15 and the gift +3 to the maximum (1 × 3): 18 / 18 (12 + 3 before).
  expect(start.hp).toBe(18);
  expect(start.maxHp).toBe(18);
  await expect(page.locator('[data-status="available"]')).not.toHaveCount(0);
  // Row 5 holds battles only: the first node starts an arena.
  const nodeId = await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  const entered = await runState(page);
  expect(entered.pending?.kind).toBe('battle');
  expect(entered.pending?.nodeId).toBe(nodeId);
  let snap = await snapshot(page);
  expect(snap.seed).toBe(entered.pending!.seed);
  expect(snap.arena).toBe(entered.pending!.arena);
  expect(snap.hero.hp).toBe(18);
  expect(snap.hero.maxHp).toBe(18);
  await expect.poll(async () => (await snapshot(page)).time, { timeout: 10_000 }).toBeGreaterThan(1);

  // A reload in the middle of the arena: the open battle node waits, its arena starts again from the start.
  await page.reload();
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  snap = await snapshot(page);
  expect(snap.seed).toBe(entered.pending!.seed);
  expect(snap.time).toBeLessThan(1);

  // Victory: the test hook opens the door and puts the hero on it; the next tick walks him in.
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  const won = await snapshot(page);
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId(`node-${nodeId}`)).toHaveAttribute('data-status', 'current');
  const after = await runState(page);
  expect(after.visited).toEqual([nodeId]);
  expect(after.pending).toBeNull();
  expect(after.hp).toBe(won.hero.hp);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('ashen-oath-rt-run-v7');
  expect(keys).not.toContain('ashen-oath-forest-run-v1');
  expect(keys).not.toContain('ashen-oath-profile-v1');

  // A reload keeps the run on the map.
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId(`node-${nodeId}`)).toHaveAttribute('data-status', 'current');
  expect(await runState(page)).toEqual(after);
  await expect(page.locator('[data-status="available"]')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('run: a lost arena ends the run, and the end survives a reload', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  // A ring of tough enemies around the standing hero: contact damage takes the run's HP.
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  expect((await runState(page)).result?.outcome).toBe('defeat');
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.locator('[data-status="available"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('run: the arena counts when it ends — a reload on «Поражение» ends the run, a reload on «Победа» keeps the victory', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  // Victory: reload on the result screen, before «К карте».
  const won = await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  const hp = (await snapshot(page)).hero.hp;
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId('run-battle-modal')).toHaveCount(0);
  await expect(page.getByTestId(`node-${won}`)).toHaveAttribute('data-status', 'current');
  const after = await runState(page);
  expect(after.visited).toEqual([won]);
  expect(after.pending).toBeNull();
  expect(after.hp).toBe(hp);
  // Defeat: walk on to the next arena node and reload on «Поражение». A random map may put several trail nodes (a rest,
  // a find, an event, the merchant) before the next arena: each takes two steps (enter, leave), so allow a long walk.
  for (let step = 0; step < 24; step++) {
    const state = await runState(page);
    if (state.pending?.kind === 'battle') break;
    if (state.pending) {
      // A node screen of the trails: take its first button that is on (a rest, a find, an event, the merchant's «Уйти»).
      // A rest at full HP with nothing to craft has only «К карте» on (both choices are disabled).
      const leave = page.locator(['[data-action="find"]', '[data-action="gift-pick"]', '[data-action="talisman"]', '[data-action="hammer"]', '[data-testid="shop-leave"]', '[data-testid="rest-heal"]', '[data-action="rest-craft"]', '[data-testid="rest-finish"]', '[data-action="event-option"]'].map(s => `${s}:not([disabled])`).join(', ')).first();
      await leave.click();
      continue;
    }
    await enterFirstNode(page);
  }
  expect((await runState(page)).pending?.kind).toBe('battle');
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.getByTestId('run-battle-modal')).toHaveCount(0);
  expect((await runState(page)).result?.outcome).toBe('defeat');
  expect(errors).toEqual([]);
});

/** Run rows of the arena pools (docs/realtime-slice.md, section 5; step 4: «Брод» 6–9; stage 3a: «Рысье логово» 2–9, «Круг шамана» 5–9). Hard battles play «Застава», boss nodes «Последний рубеж». */
const POOL_ROWS: Record<string, [number, number]> = {
  glade: [1, 3], buttons: [1, 4], marked: [2, 5], shields: [3, 6], archers: [4, 7], powder: [4, 8], thorns: [5, 8], ford: [6, 9], 'lynx-den': [2, 9], 'shaman-circle': [5, 9],
};
/** The new kinds each arena brings (section 5); own arenas 4–7 bring one each. */
const ALL_FOUR = ['shield', 'archer', 'sapper', 'porcupine'];
const ARENA_KINDS: Record<string, string[]> = { shields: ['shield'], archers: ['archer'], powder: ['sapper'], thorns: ['porcupine'], ford: ['archer'], outpost: ALL_FOUR, 'last-stand': ALL_FOUR };
const OWN_ARENA: Record<string, string> = { shield: 'shields', archer: 'archers', sapper: 'powder', porcupine: 'thorns' };

/**
 * Two runs walked to the end (task 26, 15.10.2026: a new run of the page plays the forest schedule — its arenas come from the
 * viewer's history, not from the row pools). The first — a new run of the page (a new viewer: the schedule); the second — a saved
 * run without the schedule (a save before task 26; «Испытание» II and up plays the same pools): the pool rules are checked on it.
 */
test('run: two runs walk to the final arena — a new run by the schedule (its arenas, the Jailer on row 5, hard → «Застава» or a practice stand-in, boss → «Последний рубеж»), a saved run without the schedule and the Jailer from the pools or the own arena of a kind not met yet (hard → «Застава»); no «временно»; the final victory ends the run, a reload keeps the end', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await openRun(page, errors);
  const met: { run: number; row: number; arena: string; type: string; scheduled: boolean }[] = [];
  // Two runs (seeds spread apart) to the end: battles are won by the test hook, other nodes take their first button.
  for (const [n, seed] of [Math.imul(1, 2654435761) >>> 0, Math.imul(2, 2654435761) >>> 0].entries()) {
    // Task 38: both runs end at the forest final — saves without the garrison (a run with it goes on: the test «task 38» below).
    if (n === 0) {
      // A new viewer's run (the schedule of an empty history, the Jailer), saved without the garrison.
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(createRtRun(seed, { gift: 'full', seeded: true, schedule: [], garrison: false }))] as const);
      await page.reload();
      await expect(page.getByTestId('run')).toBeVisible();
    } else {
      // A save without the schedule and the Jailer (a save before tasks 26 and 28; the full gift, as `?seed=` makes it).
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(createRtRun(seed, { gift: 'full', seeded: true, jailer: false, garrison: false }))] as const);
      await page.reload();
      await expect(page.getByTestId('run')).toBeVisible();
    }
    const scheduled = (await page.evaluate(() => !!(window as any).__realtime.run.state().schedule)) as boolean;
    expect(scheduled, `run ${n + 1}: the schedule`).toBe(n === 0);
    let finalWon = false;
    for (let step = 0; step < 120; step++) {
      const state = await page.evaluate(() => (window as any).__realtime.run.state()) as RunState & { pending: { kind: string; nodeId?: string; arena?: string; battle?: string; standIn?: string } | null };
      if (state.result) break;
      const pending = state.pending;
      if (pending?.kind === 'battle') {
        // Node ids carry the map row (`r6c1`, `den-r11c0`); the run row is the map row less the trunk (4).
        const row = Number(/r(\d+)c/.exec(pending.nodeId!)![1]) - 4;
        expect(pending.standIn, `${pending.nodeId}: no temporary arena`).toBeUndefined();
        met.push({ run: seed, row, arena: pending.arena!, type: pending.battle!, scheduled });
        await expect(page.getByTestId('run')).toBeHidden();
        expect((await snapshot(page)).arena).toBe(pending.arena);
        // The map screen named the arena without «временно».
        await expect(page.getByText('временно')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
        await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
        if (pending.battle === 'final') {
          // The final victory ends the run: the result's button leads to the end of the run.
          await expect(page.getByTestId('result-map')).toHaveText('Итог похода (Enter)');
          expect((await runState(page)).result?.outcome).toBe('victory');
          finalWon = true;
        }
        await page.getByTestId('result-map').click();
        continue;
      }
      if (pending) {
        // A node screen: its first button that is on (the gift, a rest, a find, an event option, the merchant's «Уйти»).
        await page.locator('[data-action="gift"]:not([disabled]), [data-action="find"], [data-action="gift-pick"], [data-action="talisman"], [data-action="hammer"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click();
        continue;
      }
      await enterFirstNode(page);
    }
    expect(finalWon, `run ${seed} won its final arena`).toBe(true);
    // The end of the run: «Поход пройден»; a reload keeps it.
    await expect(page.getByTestId('run-result-victory')).toBeVisible();
    await expect(page.getByTestId('run-result-victory')).toContainText('Поход пройден');
    const ended = await runState(page);
    expect(ended.result?.outcome).toBe('victory');
    await page.reload();
    await expect(page.getByTestId('run-result-victory')).toBeVisible();
    expect(await runState(page)).toEqual(ended);
  }
  for (const [i, { run, row, arena, type, scheduled }] of met.entries()) {
    if (scheduled) {
      // The schedule (docs/realtime-slice.md, section 7): the final — «Последний рубеж»; the hard node — «Застава» once the cliff and the
      // elite are met, else a practice stand-in; the Jailer's node (row 5, task 28) — the Jailer's fight; every other fight — an arena
      // of the schedule.
      if (type === 'final') expect(arena, `row ${row}: final`).toBe('last-stand');
      else if (row === 5) expect(JAILER_RUN_ARENAS.includes(arena), `row ${row}: the Jailer ${arena}`).toBe(true);
      else if (type === 'hard') expect(arena === 'outpost' || SCHEDULE_PRACTICE.some(p => p.arena === arena), `row ${row}: hard ${arena}`).toBe(true);
      else expect(SCHEDULE_RUN_ARENAS.includes(arena), `row ${row}: ${arena}`).toBe(true);
      continue;
    }
    const seen = new Set(met.slice(0, i).filter(m => m.run === run).flatMap(m => ARENA_KINDS[m.arena] ?? []));
    if (type === 'hard') expect(arena, `row ${row}: hard`).toBe('outpost');
    else if (type === 'final') expect(arena, `row ${row}: final`).toBe('last-stand');
    else {
      // Design answer 1 to step 4: an ordinary node meets a new kind first on its own arena — even outside its rows.
      const inRows = row >= POOL_ROWS[arena][0] && row <= POOL_ROWS[arena][1], kinds = ARENA_KINDS[arena] ?? [];
      expect(inRows || (kinds.length === 1 && OWN_ARENA[kinds[0]] === arena && !seen.has(kinds[0])), `row ${row}: ${arena}`).toBe(true);
      for (const kind of kinds) if (!seen.has(kind)) expect(arena, `row ${row}: ${kind} first met`).toBe(OWN_ARENA[kind]);
    }
  }
  expect(met.filter(m => m.type === 'final').length).toBe(2);
  expect(Math.max(...met.filter(m => m.type !== 'final').map(m => m.row))).toBe(9);
  const fresh = new Set(met.map(m => m.arena).filter(arena => ['shields', 'archers', 'powder', 'thorns', 'ford'].includes(arena)));
  expect(fresh.size, `arenas met: ${met.map(m => `${m.row}:${m.arena}`).join(', ')}`).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('run: a consumable taken at a find goes to the next arena (HUD 2 ×1) and is used there with the key at the mouse', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await openRun(page, errors);
  // A spread seed; battles are won by the test hook, find nodes are preferred on the map.
  await page.evaluate(s => (window as any).__realtime.run.newRun(s), Math.imul(3, 2654435761) >>> 0);
  let found = false;
  for (let step = 0; step < 60 && !found; step++) {
    const state = await page.evaluate(() => (window as any).__realtime.run.state()) as RunState & { pending: { kind: string } | null; items: Record<string, number> };
    if (state.result) break;
    const pending = state.pending;
    if (pending?.kind === 'find') {
      await expect(page.getByTestId('run-find')).toBeVisible();
      await page.getByTestId('find-bomb').click();
      expect((await page.evaluate(() => (window as any).__realtime.run.state())).items.bomb).toBe(state.items.bomb + 1);
      found = true;
      break;
    }
    if (pending?.kind === 'battle') {
      await expect(page.getByTestId('run')).toBeHidden();
      expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
      await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
      await page.getByTestId('result-map').click();
      continue;
    }
    if (pending) {
      await page.locator('[data-action="gift"]:not([disabled]), [data-action="find"], [data-action="gift-pick"], [data-action="talisman"], [data-action="hammer"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click();
      continue;
    }
    const find = page.locator('[data-status="available"][data-type="find"]');
    const node = (await find.count()) ? find.first() : page.locator('[data-status="available"]').first();
    await node.click();
    await page.getByTestId('run-enter').click();
  }
  expect(found).toBe(true);
  const bombs = (await page.evaluate(() => (window as any).__realtime.run.state())).items.bomb as number;
  await expect(page.getByTestId('run-items')).toContainText(`Бомба ${bombs}`);
  // The next battle node: the arena starts with the bomb in the HUD.
  for (let step = 0; step < 10; step++) {
    const state = await runState(page);
    if (state.pending?.kind === 'battle') break;
    if (state.pending) { await page.locator('[data-action="find"], [data-action="talisman"], [data-action="hammer"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click(); continue; }
    const battle = page.locator('[data-status="available"][data-type="battle"]');
    const node = (await battle.count()) ? battle.first() : page.locator('[data-status="available"]').first();
    await node.click();
    await page.getByTestId('run-enter').click();
  }
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('item-bomb').locator('.rt-tile-count')).toHaveText(String(bombs));
  const target = await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    rt.setParam('contactDamage', 0);
    return { id: rt.place(hero.x + 2, hero.y, 0, 5, 'basic') as number, x: hero.x + 2, y: hero.y };
  });
  const at = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [target.x, target.y]);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press('2');
  await expect(page.getByTestId('item-bomb').locator('.rt-tile-count')).toHaveText(String(bombs - 1));
  expect((await page.evaluate(() => (window as any).__realtime.snapshot())).enemies.some((e: { id: number }) => e.id === target.id)).toBe(false);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await page.getByTestId('result-map').click();
  expect((await page.evaluate(() => (window as any).__realtime.run.state())).items.bomb).toBe(bombs - 1);
  expect(errors).toEqual([]);
});

test('the sandbox keeps the prototype: ?sandbox=1 opens the arena menu and the debug panel, without the run', async ({ page }) => {
  await page.goto('/?sandbox=1');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('open-panel')).toBeVisible();
  await expect(page.getByTestId('run')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__realtime.run)).toBeNull();
});

test('the sandbox opens by the anchor too: a changed #sandbox boots it (a published build keeps no query); the run screen shows no dev words — no seed, no sandbox link (the «Песочница» button of the map — user request 15.10.2026)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('run-new')).toBeVisible();
  // «Обучение v1» (12.10.2026): the start screen has no hint of the sandbox, a map has neither the seed nor the link.
  await expect(page.getByTestId('run')).not.toContainText('#sandbox');
  await expect(page.locator('a[href="#sandbox"]')).toHaveCount(0);
  await page.evaluate(() => (window as any).__realtime.run.newRun(10));
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.locator('.rt-run-head')).not.toContainText('seed');
  // User request 15.10.2026 (over «Обучение v1»): the map's header has the «Песочница» button; still no seed, no anchor link.
  await expect(page.getByTestId('open-sandbox')).toHaveText('Песочница');
  await expect(page.locator('a[href="#sandbox"]')).toHaveCount(0);
  // The anchor itself still boots the sandbox (testers type it).
  await page.evaluate(() => { location.hash = '#sandbox'; });
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('open-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.run)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.run)).toBeNull();
  expect(errors).toEqual([]);
});

test('run (iteration 2.1, task 6): consumables are noticed — the map says their key, the arena blinks their slots bright and the slots PULSE (no plate over the bar) until one is used; the next arena does not pulse', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await openRun(page, errors);
  // The first run: the mini gift, its first button «2 расходника».
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await page.getByTestId('gift-0').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  const items = (await page.evaluate(() => (window as any).__realtime.run.state())).items as Record<string, number>;
  const gained = Object.keys(items).filter(kind => items[kind] > 0);
  expect(gained.length).toBeGreaterThan(0);
  // The map's notice names the key each consumable is used with in a fight.
  await expect(page.getByTestId('run-notice')).toContainText(/\(клавиша [1-4] в бою\)/);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  // Arena 1: no plate «Предметы: клавиши 1–4…» (task 6, 12.10.2026); slots with a consumable are bright and pulse, the others dim; only gained ones blink at the start.
  await expect(page.getByTestId('item-hint')).toHaveCount(0);
  await expect(page.getByText('Предметы: клавиши')).toHaveCount(0);
  await expect.poll(async () => (((await page.evaluate(() => (window as any).__realtime.snapshot())) as { slotsPulsing: string[] }).slotsPulsing).sort()).toEqual([...gained].sort());
  const first = await page.evaluate(() => (window as any).__realtime.snapshot()) as { slotsBright: string[]; slotsBlinking: string[]; slotsPulsing: string[] };
  for (const kind of gained) await expect(page.getByTestId(`item-${kind}`)).toHaveClass(/rt-pulse/);
  // What shows (computed animation): the blink of a slot that has just gained a consumable wins over the pulse; once it ends, the pulse.
  const animationOf = (kind: string) => page.getByTestId(`item-${kind}`).evaluate(node => ({ blinking: node.classList.contains('rt-blink'), pulsing: node.classList.contains('rt-pulse'), name: getComputedStyle(node).animationName }));
  const seen = await animationOf(gained[0]);
  if (seen.blinking) expect(seen.name).toBe('rt-item-blink');
  await expect.poll(async () => { const a = await animationOf(gained[0]); return a.blinking ? a.name === 'rt-item-blink' : a.name === 'rt-pulse'; }).toBe(true);
  await expect.poll(async () => (await animationOf(gained[0])).name, { timeout: 10_000 }).toBe('rt-pulse');
  for (const kind of ['frost', 'bomb', 'healing', 'fire'].filter(k => !gained.includes(k))) await expect(page.getByTestId(`item-${kind}`)).not.toHaveClass(/rt-pulse/);
  expect([...first.slotsBright].sort()).toEqual([...gained].sort());
  expect([...first.slotsBlinking].sort()).toEqual([...gained].sort());
  for (const kind of ['frost', 'bomb', 'healing', 'fire']) await expect(page.getByTestId(`item-${kind}`)).toHaveClass(gained.includes(kind) ? /rt-has/ : /rt-empty/);
  await page.mouse.move(640, 200);
  await page.screenshot({ path: 'artifacts/realtime-item-pulse.png' });
  // Use one: a bomb, frost or fire on an enemy next to the hero (a bomb is given if the gift held only healing).
  const kind = await page.evaluate(() => {
    const rt = (window as any).__realtime, s = rt.snapshot();
    rt.setParam('contactDamage', 0);
    let k = (['bomb', 'frost', 'fire'] as const).find(x => (s.items[x] ?? 0) > 0) as string | undefined;
    if (!k) { rt.setItems('bomb', 1); k = 'bomb'; }
    rt.place(s.hero.x + 2, s.hero.y, 0, 5, 'basic');
    return k;
  });
  const hero = (await snapshot(page)).hero;
  const at = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [hero.x + 2, hero.y]);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press(String(['frost', 'bomb', 'healing', 'fire'].indexOf(kind) + 1));
  // The first item used stops the pulse for good (the viewer's memory).
  await expect.poll(async () => ((await page.evaluate(() => (window as any).__realtime.snapshot())) as { slotsPulsing: string[] }).slotsPulsing).toEqual([]);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-hints') ?? '{}')).shown.item).toBe(1);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await page.getByTestId('result-map').click();
  expect((await page.evaluate(() => (window as any).__realtime.run.state())).itemUsed).toBe(true);
  // The next arena: no hint (a consumable was used in this run).
  for (let step = 0; step < 10; step++) {
    const state = await runState(page);
    if (state.pending?.kind === 'battle') break;
    if (state.pending) { await page.locator('[data-action="find"], [data-action="talisman"], [data-action="hammer"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click(); continue; }
    const battle = page.locator('[data-status="available"][data-type="battle"]');
    const node = (await battle.count()) ? battle.first() : page.locator('[data-status="available"]').first();
    await node.click();
    await page.getByTestId('run-enter').click();
  }
  await expect(page.getByTestId('run')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(0.2);
  await expect(page.getByTestId('item-hint')).toHaveCount(0);
  expect(((await page.evaluate(() => (window as any).__realtime.snapshot())) as { slotsPulsing: string[] }).slotsPulsing).toEqual([]);
  expect(errors).toEqual([]);
});

test('run (phase A, Т2): the node preview names its roster in one line; the card\'s enemies line (task 8c) lists the kinds the roster brings; the arena plays it and its journal keeps it', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // A new run of the page plays the forest schedule (task 26): its first fight (r5c0) — «Поляна» alone (no roster), the second — the
  // wolf's arc, «Поляна» with «Волки» (seed 11, r6c0). A saved run without the schedule (a save before task 26; «Испытание» II and up
  // plays the same pools) keeps the pool rosters: task 17 (Е1) — row 1 «Поляна» alone, row 2 of seed 1 offers «Двор кнопок» with
  // «Натиск» (r6c0) (rtRun.ts, chooseRoster). The first battle is won by the run hook.
  const toRowTwo = async (seed: number, saved = false): Promise<void> => {
    await page.goto(`/?seed=${seed}`);
    await page.evaluate(() => localStorage.clear());
    if (saved) await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(createRtRun(seed, { gift: 'full', seeded: true }))] as const);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
    if (!saved) await page.getByTestId('run-new').click();
    await page.getByTestId('gift-0').click();
    const pick = page.locator('[data-action="gift-pick"]').first();
    if (await pick.count()) await pick.click();
    await expect(page.getByTestId('run-gift')).toBeHidden();
    await page.getByTestId('node-r5c0').click();
    await expect(page.getByTestId('run-roster')).toHaveCount(0);
    await page.getByTestId('run-enter').click();
    await expect(page.getByTestId('run')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
    await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
    await page.getByTestId('result-map').click();
    await expect(page.getByTestId('node-r6c0')).toHaveAttribute('data-status', 'available');
  };
  await toRowTwo(11);
  await page.getByTestId('node-r6c0').click();
  await expect(page.getByTestId('run-roster')).toHaveText('Состав: Волки');
  await expect(page.getByTestId('run-danger-enemies')).toContainText('Враги: обычные, волки');
  await toRowTwo(1, true);
  await page.getByTestId('node-r6c0').click();
  await expect(page.getByTestId('run-roster')).toHaveText('Состав: Натиск');
  // «Натиск» replaces the newcomers by boars: no wolves of the template's phases.
  await expect(page.getByTestId('run-danger-enemies')).toContainText('Враги: обычные, кабаны');
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const state = await page.evaluate(() => (window as any).__realtime.run.state() as { pending: { arena: string; roster?: string } });
  expect(state.pending).toMatchObject({ arena: 'buttons', roster: 'onslaught' });
  const journal = await page.evaluate(() => (window as any).__realtime.journal() as { arena: string; roster?: string });
  expect(journal).toMatchObject({ arena: 'buttons', roster: 'onslaught' });
  expect(errors).toEqual([]);
});

/** One step of a walk through the page: a battle won by the hook, a node screen's first button, or a node entered (`prefer` first). */
async function walkStep(page: Page, prefer: string): Promise<void> {
  const state = await runState(page);
  if (state.pending?.kind === 'battle') {
    expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
    await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
    await page.getByTestId('result-map').click();
    return;
  }
  if (state.pending) {
    await page.locator('[data-action="gift"]:not([disabled]), [data-action="find"], [data-action="gift-pick"], [data-action="talisman"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click();
    return;
  }
  const preferred = page.locator(`[data-status="available"][data-type="${prefer}"]`);
  await ((await preferred.count()) ? preferred.first() : page.locator('[data-status="available"]').first()).click();
  await page.getByTestId('run-enter').click();
}

test('run (phase B, Д4): the Jailer\'s row offers a hammer 3 of 4, then an oath or a relic with its price as plain as its plus; the map shows both, the hammer goes into the next arena', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await openRun(page, errors);
  // Task 30: a new run has forms on the Jailer's screen (the next test) — the hammer screen is a save without the flag `forms`.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(createRtRun(Math.imul(3, 2654435761) >>> 0, { gift: 'full', seeded: true, forms: false }))] as const);
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  for (let step = 0; step < 60 && (await runState(page)).pending?.kind !== 'hammer'; step++) await walkStep(page, 'checkpoint');
  // Screen 1: three hammers and a refusal; a reload keeps the screen.
  await expect(page.getByTestId('run-hammer')).toBeVisible();
  await expect(page.getByTestId('run-hammer')).toContainText('Молот на выбор');
  const hammers = page.locator('[data-action="hammer"]:not([data-option=""])');
  await expect(hammers).toHaveCount(3);
  await expect(page.getByTestId('hammer-refuse')).toBeVisible();
  const ids = await hammers.evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.option!));
  await page.reload();
  await expect(page.getByTestId('run-hammer')).toBeVisible();
  expect(await page.locator('[data-action="hammer"]:not([data-option=""])').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.option!))).toEqual(ids);
  await page.screenshot({ path: 'artifacts/realtime-run-hammer.png' });
  await page.getByTestId(`hammer-${ids[1]}`).click();
  // Screen 2: the oath or a relic; a relic card shows «Плюс: …» and «Цена: …», each on a line of its own.
  await expect(page.getByTestId('run-talisman')).toContainText('Клятва или реликвия на выбор');
  const relic = page.locator('[data-action="talisman"][data-option^="relic-"]').first();
  const relicId = (await relic.getAttribute('data-option'))!;
  await expect(relic).toContainText('Плюс:');
  await expect(page.getByTestId(`price-${relicId}`)).toContainText('Цена:');
  await page.screenshot({ path: 'artifacts/realtime-run-relic.png' });
  await relic.click();
  await page.screenshot({ path: 'artifacts/realtime-run-map-build.png' });
  // The map: the hammer and the relic in the header, the rule and the price in the tooltip.
  await expect(page.getByTestId('run-hammer-slot')).toContainText('⚒');
  await expect(page.getByTestId(`run-relic-${relicId}`)).toHaveAttribute('title', /цена: /);
  const state = await page.evaluate(() => (window as any).__realtime.run.state() as { hammer?: string; talismans: string[] });
  expect(state.hammer).toBe(ids[1]);
  expect(state.talismans).toContain(relicId);
  // The next arena starts with the hammer and the relic (its journal keeps the loadout).
  for (let step = 0; step < 20 && (await runState(page)).pending?.kind !== 'battle'; step++) await walkStep(page, 'battle');
  await expect(page.getByTestId('run')).toBeHidden();
  const journal = await page.evaluate(() => (window as any).__realtime.journal() as { loadout?: { hammer?: string; talismans?: string[] } });
  expect(journal.loadout?.hammer).toBe(ids[1]);
  expect(journal.loadout?.talismans).toContain(relicId);
  // Д5 (round 2): the arena's build column shows the hammer in its frame and the relic with its short price.
  await expect(page.getByTestId('build-column')).toBeVisible();
  await expect(page.getByTestId(`build-${ids[1]}`)).toHaveAttribute('data-kind', 'hammer');
  await expect(page.getByTestId(`build-${relicId}`)).toHaveAttribute('data-kind', 'relic');
  await expect(page.getByTestId(`build-${relicId}`).locator('.rt-build-price')).not.toBeEmpty();
  await page.screenshot({ path: 'artifacts/realtime-phaseB-run-column.png' });
  expect(errors).toEqual([]);
});

test('run (task 30 «Формы в походе»): a new run\'s Jailer offers 3 forms — a first run (a new viewer) only «Прямая», «Наледь», «Взрыв на конце»; a reload keeps the screen; the form clicked joins the run, the oath screen follows; the next arena starts with it and the build column shows it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await openRun(page, errors);
  await page.evaluate(s => (window as any).__realtime.run.newRun(s), Math.imul(3, 2654435761) >>> 0);
  const formScreen = async () => { const s = await page.evaluate(() => (window as any).__realtime.run.state()) as { pending: { kind: string; source?: string } | null }; return s.pending?.kind === 'talisman' && s.pending.source === 'form'; };
  for (let step = 0; step < 60 && !(await formScreen()); step++) await walkStep(page, 'checkpoint');
  // The form screen: three forms of a first run and a refusal; a reload keeps it.
  await expect(page.getByTestId('run-form')).toBeVisible();
  await expect(page.getByTestId('run-form')).toContainText('Форма на выбор');
  const cards = page.locator('[data-testid="run-form"] [data-action="talisman"]:not([data-option=""])');
  await expect(cards).toHaveCount(3);
  const ids = await cards.evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.option!));
  expect([...ids].sort()).toEqual(['end-blast', 'form-pierce', 'frost-pass']);
  await expect(page.getByTestId('talisman-refuse')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('run-form')).toBeVisible();
  expect(await page.locator('[data-testid="run-form"] [data-action="talisman"]:not([data-option=""])').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.option!))).toEqual(ids);
  await page.screenshot({ path: 'artifacts/realtime-run-forms.png' });
  const chosen = ids.find(id => id !== 'end-blast')!;
  await page.getByTestId(`talisman-${chosen}`).click();
  // The oath or relic screen follows; refused.
  await expect(page.getByTestId('run-talisman')).toContainText('Клятва или реликвия на выбор');
  await page.getByTestId('talisman-refuse').click();
  const state = await page.evaluate(() => (window as any).__realtime.run.state() as { forms?: boolean; talismans: string[]; hammer?: string });
  expect(state.forms).toBe(true);
  expect(state.talismans).toContain(chosen);
  expect(state.hammer).toBeUndefined();
  // The next arena starts with the form (its journal keeps the loadout) and plays the counters' chain window; the column shows it.
  for (let step = 0; step < 20 && (await runState(page)).pending?.kind !== 'battle'; step++) await walkStep(page, 'battle');
  await expect(page.getByTestId('run')).toBeHidden();
  const journal = await page.evaluate(() => (window as any).__realtime.journal() as { loadout?: { talismans?: string[] }; params: { counterWindow?: boolean; twinsAlternate?: boolean } });
  expect(journal.loadout?.talismans).toContain(chosen);
  expect(journal.params.counterWindow).toBe(true);
  expect(journal.params.twinsAlternate).toBe(true);
  await expect(page.getByTestId(`build-${chosen}`)).toBeVisible();
  await page.screenshot({ path: 'artifacts/realtime-run-forms-column.png' });
  expect(errors).toEqual([]);
});

test('run (playtest v34, design 12.10.2026): a mouse chain of 1 leaves no after-chain shield — a touch hurts at once; a chain of 3 kills shields the hero 0.5 s', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  // Only the test's enemies, standing still (journalled); the run's own numbers stay (`chainShieldMinKills` 3).
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['boarMax', 0], ['hitstop', false]] as const) rt.setParam(k, v);
    rt.clear(false);
  });
  expect(await page.evaluate(() => (window as any).__realtime.params.chainShieldMinKills)).toBe(3);
  /** A mouse chain through weak enemies placed at these offsets from the hero; waits for the dash to end; the hero's shield then. */
  const chain = async (offsets: readonly (readonly [number, number])[]): Promise<number> => {
    const at = await page.evaluate(offsets => {
      const rt = (window as any).__realtime, h = rt.snapshot().hero;
      return offsets.map(([dx, dy]) => { rt.place(h.x + dx, h.y + dy, 0, 0, 'basic'); return rt.toScreen(h.x + dx, h.y + dy) as { x: number; y: number }; });
    }, offsets);
    const before = await page.evaluate(() => (window as any).__realtime.snapshot().lastChain?.time ?? -1);
    await page.mouse.move(at[0].x, at[0].y);
    await page.mouse.down();
    for (const p of at.slice(1)) await page.mouse.move(p.x, p.y);
    await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().chain.length))).toBe(offsets.length);
    await page.mouse.up();
    await page.mouse.move(20, 20);
    // The frame the dash ended in: its shield.
    return untilFrame(page, (s, t0: number) => s.lastChain && s.lastChain.time > t0 && !s.moving ? s.hero.chainShield as number : undefined, before, 5);
  };
  /** A standing enemy of another colour put against the hero: game seconds until the first wound (−1 — none within 1.2 s). */
  const touch = async (): Promise<number> => {
    // The time and the HP in the same call as the placing: a touch may hurt before a second call reads them (seen under load
    // 12.10.2026: the HP read after the wound, the next wound came 0.53 s later, after its invulnerability).
    const a = await page.evaluate(() => { const rt = (window as any).__realtime, s = rt.snapshot(); rt.place(s.hero.x + 0.35, s.hero.y, 1, 0, 'basic'); return { t0: s.time as number, hp0: s.hero.hp as number }; });
    return untilFrame(page, (s, a: { t0: number; hp0: number }, late) => s.hero.hp < a.hp0 ? s.time - a.t0 : late ? -1 : undefined, a, 1.2);
  };
  const one = await chain([[1, 0]]);
  expect(one).toBe(0);
  const hurtOne = await touch();
  expect(hurtOne).toBeGreaterThanOrEqual(0);
  expect(hurtOne).toBeLessThan(0.2);
  // The wound's own invulnerability out, the blocker gone; then a chain of 3.
  await untilFrame(page, (s, _a: null, late) => s.hero.invulnerable <= 0 || late ? true : undefined, null, 3);
  await page.evaluate(() => (window as any).__realtime.clear(false));
  const three = await chain([[1, 0], [1.6, 0.8], [0.8, 1.4]]);
  expect(three).toBeGreaterThan(0.4);
  const hurtThree = await touch();
  expect(hurtThree).toBeGreaterThanOrEqual(0.4);
  expect(errors).toEqual([]);
});

test('run (design 12.10.2026, «Щит фокуса»): holding a mouse chain of 2 in a crowd — a touch hurts; of 3 — the rim is on and no wound while the focus lasts; the focus out — it hurts', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['boarMax', 0], ['hitstop', false]] as const) rt.setParam(k, v);
    rt.clear(false);
  });
  expect(await page.evaluate(() => (window as any).__realtime.params.focusGuardLinks)).toBe(3);
  const start = await page.evaluate(() => { const h = (window as any).__realtime.snapshot().hero; return { x: h.x as number, y: h.y as number }; });
  /** Holds a mouse chain through `n` weak enemies by the hero (not released), then puts a standing enemy of another colour against him. */
  const hold = async (n: number): Promise<{ hurtAt: number; emptyAt: number; rim: boolean }> => {
    // From the arena's start point each time (the first dash moved the hero), the links of the shield test above.
    const at = await page.evaluate(([n, start]) => {
      const rt = (window as any).__realtime, out: { x: number; y: number }[] = [];
      rt.teleport(start.x, start.y);
      for (const [dx, dy] of [[1, 0], [1.6, 0.8], [0.8, 1.4]].slice(0, n)) { rt.place(start.x + dx, start.y + dy, 0, 0, 'basic'); out.push(rt.toScreen(start.x + dx, start.y + dy)); }
      return out;
    }, [n, start] as const);
    await page.mouse.move(at[0].x, at[0].y);
    await page.mouse.down();
    for (const p of at.slice(1)) await page.mouse.move(p.x, p.y);
    await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().chain.length))).toBe(n);
    if (n === 3) await page.screenshot({ path: 'artifacts/realtime-focus-guard.png' });
    const t0 = await page.evaluate(() => { const rt = (window as any).__realtime, s = rt.snapshot(); rt.place(s.hero.x - 0.35, s.hero.y, 1, 0, 'basic'); return { time: s.time as number, hp: s.hero.hp as number }; });
    // Every frame: the rim while guarded, when the focus ran out, when the hero was first hurt (game seconds from the touch).
    const r = await untilFrame(page, (s, a: { time: number; hp: number; rim: boolean; emptyAt: number }, late) => {
      if (s.focusGuard.rim) a.rim = true;
      if (a.emptyAt < 0 && s.focus <= 0) a.emptyAt = s.time - a.time;
      if (s.hero.hp < a.hp) return { hurtAt: s.time - a.time, emptyAt: a.emptyAt, rim: a.rim };
      return late ? { hurtAt: -1, emptyAt: a.emptyAt, rim: a.rim } : undefined;
    }, { ...t0, rim: false, emptyAt: -1 }, 3);
    await page.mouse.up();
    return r;
  };
  const two = await hold(2);
  expect(two.rim).toBe(false);
  expect(two.hurtAt).toBeGreaterThanOrEqual(0);
  expect(two.hurtAt).toBeLessThan(0.1);
  // The wound's invulnerability and the dash over, the field cleared.
  await untilFrame(page, (s, _a: null, late) => (s.hero.invulnerable <= 0 && s.hero.chainShield <= 0 && !s.moving) || late ? true : undefined, null, 5);
  await page.evaluate(() => (window as any).__realtime.clear(false));
  const three = await hold(3);
  expect(three.rim).toBe(true);
  expect(three.emptyAt).toBeGreaterThan(0.4);
  expect(three.hurtAt).toBeGreaterThanOrEqual(three.emptyAt);
  expect(errors).toEqual([]);
});

test('run (design 12.10.2026, «Смена цвета»): a mouse chain of 6 enemies of one colour, «до смены 2» and «1» at the pointer, the 6th gets the rainbow ring and nothing is dimmed, the 7th of another colour joins', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['boarMax', 0], ['hitstop', false], ['contactDamage', 0]] as const) rt.setParam(k, v);
    rt.clear(false);
  });
  const rule = await page.evaluate(() => { const rt = (window as any).__realtime; return { crystals: rt.params.crystals, links: rt.params.colorShiftLinks, every: rt.snapshot().colorShift.every }; });
  expect(rule).toEqual({ crystals: false, links: 6, every: 6 });
  // The line of keys (task 6): only the keys, whole in 1280×720 — the colour rule is in the rings of the chain, not in the line.
  await expect(page.getByTestId('help-color')).toHaveCount(0);
  await expect(page.locator('.rt-help')).toHaveText('WASD идти · ЛКМ цепь · ПКМ/Esc отмена');
  expect(await page.locator('.rt-help').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  // Six weak enemies of colour 0 in a spiral round the hero (1 apart), the 7th of colour 1 after the 6th; one more of colour 2
  // off the path (it shows the dimming).
  const offsets = [[1, 0], [1.6, 0.8], [0.8, 1.4], [-0.2, 1.3], [-1, 0.6], [-1, -0.4], [-0.2, -1.1]];
  const { at, ids } = await page.evaluate((offsets) => {
    const rt = (window as any).__realtime, h = rt.snapshot().hero;
    const at = offsets.map(([dx, dy], i) => { rt.place(h.x + dx, h.y + dy, i < 6 ? 0 : 1, 0, 'basic'); return rt.toScreen(h.x + dx, h.y + dy) as { x: number; y: number }; });
    rt.place(h.x + 2.6, h.y - 1.2, 2, 0, 'basic');
    return { at, ids: rt.snapshot().enemies.map((e: { id: number }) => e.id) as number[] };
  }, offsets);
  type Reading = { links: number; text: string | null; rainbow: number; dimmed: number; left: number | null; every: number };
  /** The frame the drawn chain has `n` links and the pointer line caught up (from 4 links it shows; the 6th — the ring). */
  const reading = (n: number): Promise<Reading> => untilFrame(page, (s, n: number, late) =>
    (s.chain.length === n && (n < 4 || n > 6 || (n === 6 ? s.colorShift.rainbow !== 0 : s.colorShift.text !== null))) || late ? { links: s.chain.length, ...s.colorShift } : undefined, n, 3);
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  const seen: Record<number, Reading> = {};
  for (let i = 1; i < 6; i++) {
    await page.mouse.move(at[i].x, at[i].y);
    seen[i + 1] = await reading(i + 1);
  }
  expect(seen[3]).toMatchObject({ links: 3, text: null, rainbow: 0 });
  expect(seen[4]).toMatchObject({ links: 4, left: 2, text: 'до смены 2', rainbow: 0 });
  expect(seen[5]).toMatchObject({ links: 5, left: 1, text: 'до смены 1', rainbow: 0 });
  // Five of colour 0: the bodies of colours 1 and 2 are dimmed.
  expect(seen[5].dimmed).toBeGreaterThanOrEqual(2);
  // The 6th: the colour is free — the rainbow on it, no pointer line, nothing dimmed.
  const sixth = await page.evaluate(() => (window as any).__realtime.snapshot().chain[5] as number);
  expect(seen[6]).toMatchObject({ links: 6, left: 0, text: null, rainbow: sixth, dimmed: 0 });
  await page.screenshot({ path: 'artifacts/realtime-color-shift.png' });
  await page.mouse.move(at[6].x, at[6].y);
  // The 7th (colour 1) joins; it set the new colour and the count started again: 5 left, no ring.
  expect(await reading(7)).toMatchObject({ links: 7, left: 5, rainbow: 0 });
  await page.mouse.up();
  await page.mouse.move(20, 20);
  // The dash kills all seven.
  const alive = await untilFrame(page, (s, ids: number[], late) => {
    const left = ids.slice(0, 7).filter(id => s.enemies.some((e: { id: number }) => e.id === id)).length;
    return (!s.moving && left === 0) || late ? left : undefined;
  }, ids, 5);
  expect(alive).toBe(0);
  expect(errors).toEqual([]);
});

test('run: the map\'s «Песочница» opens the sandbox (`#sandbox`) and its «Поход» brings back the same map of the same run; no button while a fight is open (user request 15.10.2026)', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  // A fight is open: the arena hides the map — no «Песочница» to lose it by.
  const nodeId = await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('open-sandbox')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run')).toBeVisible();
  const before = await runState(page);
  expect(before.visited).toEqual([nodeId]);

  // The header: «Песочница» left of «Логи», in its style.
  const sandboxButton = page.getByTestId('open-sandbox'), logs = page.getByTestId('logs-open');
  await expect(sandboxButton).toHaveText('Песочница');
  const [a, b] = [await sandboxButton.boundingBox(), await logs.boundingBox()];
  expect(a && b && a.x + a.width <= b.x && Math.abs(a.y - b.y) < 2, `${JSON.stringify(a)} / ${JSON.stringify(b)}`).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-run-sandbox-button.png' });

  await sandboxButton.click();
  await expect(page.getByTestId('menu')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#sandbox');
  // The sandbox opens on its arena menu (it covers the top bar): «← Поход» in the menu's corner; «Поход» by «Арены (M)» too.
  await expect(page.getByTestId('menu-run')).toHaveText('← Поход');
  await expect(page.getByTestId('open-run')).toHaveText('Поход');
  await page.screenshot({ path: 'artifacts/realtime-sandbox-run-button.png' });
  await page.getByTestId('menu-run').click();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId(`node-${nodeId}`)).toHaveAttribute('data-status', 'current');
  expect(await runState(page)).toEqual(before);
  expect(new URL(page.url()).hash).toBe('');

  // In a sandbox fight (the menu closed) «Поход» stands by «Арены (M)», clear of the HUD; it brings back the same map too.
  await page.getByTestId('open-sandbox').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  // The sandbox has booted (its arena buttons answer once the page's hook is up).
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime && (window as any).__realtime.run === null)).toBe(true);
  await page.getByTestId('arena-1').click();
  await expect(page.getByTestId('menu')).toBeHidden();
  const [bar, arenas, hud] = [await page.getByTestId('open-run').boundingBox(), await page.getByTestId('open-menu').boundingBox(), await page.getByTestId('hud').boundingBox()];
  expect(bar && arenas && hud && bar.x + bar.width <= arenas.x && bar.x >= hud.x + hud.width, `${JSON.stringify(bar)} / ${JSON.stringify(arenas)} / ${JSON.stringify(hud)}`).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-sandbox-run-bar.png' });
  await page.getByTestId('open-run').click();
  await expect(page.getByTestId('run')).toBeVisible();
  expect(await runState(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('run: a sandbox opened by `?sandbox=1` has no «Поход» button (the anchor\'s button only)', async ({ page }) => {
  await page.goto('/?sandbox=1');
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('open-run')).toHaveCount(0);
  await expect(page.getByTestId('menu-run')).toHaveCount(0);
});

test('run: in an iframe (the published artifact) «Песочница» and «← Поход» switch by the anchor the same way, the run is kept', async ({ page }) => {
  const errors: string[] = [];
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  const origin = new URL(page.url()).origin;
  await page.setContent(`<iframe id="app" src="${origin}/" style="width:1280px;height:720px;border:0"></iframe>`);
  const frame = page.frameLocator('#app');
  page.on('pageerror', e => errors.push(e.message));
  // The app's frame (a reload by the anchor keeps the frame object; its document is new).
  const app = () => page.frames().find(f => f !== page.mainFrame())!;
  await expect.poll(() => app()?.evaluate(() => !!(window as any).__realtime?.run).catch(() => false)).toBe(true);
  await frame.getByTestId('run-new').click();
  await frame.getByTestId('gift-1').click();
  await expect(frame.getByTestId('run-map')).toBeVisible();
  const before = await app().evaluate(() => (window as any).__realtime.run.state());
  await frame.getByTestId('open-sandbox').click();
  await expect(frame.getByTestId('menu')).toBeVisible();
  expect(new URL(app().url()).hash).toBe('#sandbox');
  await frame.getByTestId('menu-run').click();
  await expect(frame.getByTestId('run-map')).toBeVisible();
  expect(await app().evaluate(() => (window as any).__realtime.run.state())).toEqual(before);
  expect(errors).toEqual([]);
});

test('task 38: a run walked in Node to «Предместье» (the forest final won, its relic taken): HP full, «В гарнизон» opens the garrison\'s map headed «Гарнизон»', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  // The run's own commands in Node: every fight won, every screen chosen (metaWalk.testkit.ts); stop at «Предместье».
  let outskirts: RtRunState | null = null;
  walkRun({ k: 3, create: { gift: 'full', seeded: true, garrison: true }, each: state => { if (!outskirts && state.pending?.kind === 'outskirts') outskirts = state; } });
  expect(outskirts, 'the walk reached «Предместье»').not.toBeNull();
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(outskirts!)] as const);
  await page.reload();
  await expect(page.getByTestId('run-outskirts')).toBeVisible();
  const state = await runState(page);
  expect(state.hp).toBe(state.maxHp);
  await expect(page.getByTestId('outskirts-hp')).toHaveText(`HP ${state.maxHp} / ${state.maxHp}`);
  await expect(page.getByTestId('run-title')).toHaveText('Поход');
  await page.screenshot({ path: 'artifacts/realtime-garrison-outskirts.png' });
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  await expect(page.getByTestId('run-title')).toHaveText('Гарнизон');
  const after = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(after.garrisonLevel).toBeDefined();
  await page.screenshot({ path: 'artifacts/realtime-garrison-map.png' });
  expect(errors).toEqual([]);
});
