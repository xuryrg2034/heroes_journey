import { type Page } from '@playwright/test';
import { test, expect, takeStartGift } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { arenaPreview, createRtRun, isArenaNode, resolveArena, rtAvailableNodes, rtEnterNode, rtNode, rtScheduleMet, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_PROFILE_STORAGE_KEY, RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { SCHEDULE_ELEMENTS } from '../src/realtime/run/schedule';
import { closeNode, ok, seedOf, takeGift } from '../src/realtime/run/runFight.testkit';
import { cardRules, nodeDangers } from '../src/realtime/view/nodeCard';
import { newKindsOfArena } from '../src/realtime/view/newSeen';

/**
 * Task 26 «Расписание леса» (design 15.10.2026; docs/realtime-slice.md, «Расписание леса») at 1280×720 by real input: a viewer
 * who has met the whole forest (the profile's history) presses «Обучение» on the gear, skips the prologue back to the same run,
 * starts a new run (the gear's «Новый поход») — the new run goes the newcomer's path: its snapshot is empty and its first fight
 * is «Поляна» with only basic enemies (no wolf, no boar) for 20 s of game time. The order of the arcs, the loadout rules and the
 * saves: Node (`npm run test:realtime-schedule`).
 * The cards of the schedule's seven arenas on the map (a saved scheduled run whose available node plays the arena): the lines equal
 * `nodeDangers` with the fight's rules (`cardRules`); snapshots `artifacts/realtime-schedule-card-<arena>.png`.
 */
const PROLOGUE_KEY = 'ashen-oath-realtime-prologue-done';
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

test('task 26: «Обучение» empties the viewer\'s history — the next new run\'s first fight is «Поляна» with only basic enemies', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(([key, profileKey, seen]) => {
    localStorage.clear();
    localStorage.setItem(key, '1');
    localStorage.setItem(profileKey, JSON.stringify({ version: 1, giftFull: false, seen }));
  }, [PROLOGUE_KEY, RT_PROFILE_STORAGE_KEY, [...SCHEDULE_ELEMENTS].sort()] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 31);
  await takeStartGift(page);
  const before = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(before.schedule?.seen.length).toBe(SCHEDULE_ELEMENTS.length);
  // The gear: «Обучение» plays the prologue; «Пропустить» returns to the same run.
  await page.getByTestId('run-settings').click();
  await page.getByTestId('prologue-start').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime.snapshot().prologue.active)).toBe(true);
  await page.getByTestId('prologue-skip').click();
  await expect(page.getByTestId('run')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).seen, RT_PROFILE_STORAGE_KEY)).toEqual([]);
  // A new run: the header's «Новый поход», confirmed.
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await takeStartGift(page);
  const run = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(run.schedule?.seen).toEqual([]);
  const first = rtAvailableNodes(run)[0];
  await page.getByTestId(`node-${first.id}`).click();
  await page.screenshot({ path: 'artifacts/realtime-schedule-first-card.png' });
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  // Every kind on the arena, read in the page every frame for 20 s of game time.
  const kinds = await untilFrame(page, (s: any, _arg: null, late: boolean) => {
    const w = window as any, seen: string[] = w.__scheduleKinds ??= [];
    for (const e of s.enemies) if (!seen.includes(e.kind)) seen.push(e.kind);
    return late ? seen : undefined;
  }, null, 20);
  expect((await snap(page)).arena).toBe('glade');
  expect(kinds.length).toBeGreaterThan(0);
  expect(kinds.filter(kind => kind !== 'basic')).toEqual([]);
  await page.screenshot({ path: 'artifacts/realtime-schedule-first-fight.png' });
  expect(errors).toEqual([]);
});

/** The history that makes the next arc's arena, or a veteran's practice (p-yard, p-gorge). */
const ARC_HISTORY: Readonly<Record<string, readonly string[]>> = {
  'p-braziers': ['bust', 'wolf', 'elite'], 'p-cliff': ['bust', 'wolf', 'elite', 'brazier'], 'p-river': ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar'],
  'p-archer-yard': ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons'],
  'p-thicket': ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer', 'sapper', 'leader', 'lynx', 'affix'],
  'p-yard': [...SCHEDULE_ELEMENTS], 'p-gorge': [...SCHEDULE_ELEMENTS],
};
/** A scheduled run (gift taken) walked to a map whose available arena node plays `arena`; its node. */
function runOffering(arena: string): { run: RtRunState; nodeId: string } {
  for (let k = 1; k <= 60; k++) {
    let run = takeGift(createRtRun(seedOf(k + 900), { gift: 'mini', schedule: [...ARC_HISTORY[arena]] }));
    for (let step = 0; step < 300 && !run.result; step++) {
      if (run.pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: [] }), 'win'); continue; }
      if (run.pending) { run = closeNode(run); continue; }
      const nodes = rtAvailableNodes(run), hit = nodes.find(node => isArenaNode(node) && arenaPreview(run, node)?.arena === arena);
      if (hit) return { run, nodeId: hit.id };
      run = ok(rtEnterNode(run, nodes[(k + step) % nodes.length].id), 'enter');
    }
  }
  throw new Error(`no map offers ${arena}`);
}

test('task 26: the cards of the seven schedule arenas on the map say what their fights play (1280×720 snapshots)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const arena of Object.keys(ARC_HISTORY)) {
    const { run, nodeId } = runOffering(arena);
    await page.goto('/');
    await page.evaluate(([prologue, key, value]) => { localStorage.clear(); localStorage.setItem(prologue, '1'); localStorage.setItem(key, value); }, [PROLOGUE_KEY, RT_RUN_STORAGE_KEY, serializeRtRun(run)] as const);
    await page.reload();
    await expect(page.getByTestId('run-map')).toBeVisible();
    await page.getByTestId(`node-${nodeId}`).click();
    await expect(page.getByTestId('run-dangers')).toBeVisible();
    const node = rtNode(run, nodeId)!, pick = arenaPreview(run, node)!;
    const want = nodeDangers({ arena: pick.arena, roster: pick.roster, ...cardRules(run, node) }).map(line => `${line.label}: ${line.text}`);
    const shown = await page.getByTestId('run-dangers').locator('li').allTextContents();
    expect(shown.length, arena).toBe(want.length);
    want.forEach((line, i) => expect(shown[i].startsWith(line), `${arena}: «${shown[i]}» / «${line}»`).toBe(true));
    // Design 15.10.2026 (after task 26): the terrain line carries «✦ новое» while the viewer's history has not met that terrain —
    // the arcs of the cliff, the water and the thorns do; the veteran's practice arenas (everything met) do not.
    const terrain = nodeDangers({ arena: pick.arena, roster: pick.roster, met: rtScheduleMet(run), ...cardRules(run, node) }).find(line => line.id === 'terrain');
    if (['p-cliff', 'p-river', 'p-thicket'].includes(arena)) expect(terrain?.newTerrain?.length, `${arena}: a terrain arc`).toBe(1);
    if (terrain) await expect(page.getByTestId('run-danger-terrain').getByTestId('run-new-sign'), arena).toHaveCount(terrain.newTerrain?.length ? 1 : 0);
    // One sign, one source (design 15.10.2026): the enemies line of a scheduled run reads the same history, not the view's memory.
    // Here the two differ — the memory is empty (storage cleared), the history has met the wolf: «Овраг» with wolves gets no «✦»
    // at its enemies (the view's memory would have given one).
    const met = rtScheduleMet(run), kindsNew = newKindsOfArena(pick.arena, pick.roster, { hasKind: kind => met.has(kind) }, cardRules(run, node).withoutKinds);
    if (arena === 'p-cliff') expect(kindsNew, 'the wolves of «Овраг» are met by the history').toEqual([]);
    await expect(page.getByTestId('run-danger-enemies').getByTestId('run-new-sign'), arena).toHaveCount(kindsNew.length ? 1 : 0);
    await page.screenshot({ path: `artifacts/realtime-schedule-card-${arena}.png` });
  }
  expect(errors).toEqual([]);
});
