import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { arenaPreview, createRtRun, isArenaNode, resolveArena, rtAvailableNodes, rtEnterNode, rtNode, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { runRow } from '../src/realtime/run/arenaPools';
import { closeNode, ok, seedOf, takeGift } from '../src/realtime/run/runFight.testkit';
import { cardRules, nodeDangers } from '../src/realtime/view/nodeCard';

/**
 * Task 17 «Пологий вход», the view (design 13–14.10.2026; docs/realtime-slice.md) at 1280×720 by real input:
 * - the node card of a gentle run equals its fight (core review 14.10.2026: the card said the old tables — row 3 «1 элита ·
 *   броня 2», row 5 «броня 3 · особое свойство» — while the fight played none and 2 plates): runs walked in Node to the map that
 *   offers row 3, then row 5, put into the page's storage; a click on each battle node opens its card, whose lines are the ones
 *   `nodeDangers` gives with the fight's own rules (`cardRules` — the same conditions as `rtArenaLoadout`, checked over whole runs
 *   in Node: `npm run test:realtime-node-card`);
 * - the winged heart by the map's HP: lit at the start; a lethal hit in the first fight stands the hero up with 3 HP and the text
 *   «второе дыхание: 3 HP»; back on the map the heart is dim. Gone from row 5: Node (`npm run test:realtime-gentle-view`).
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** A gentle run (seed k) walked by its own commands to the map that offers battle nodes of run row `row`. */
function runToRow(k: number, row: number): RtRunState {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  for (let step = 0; step < 400 && !run.result; step++) {
    if (run.pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic', 'wolf'] }), 'win'); continue; }
    if (run.pending) { run = closeNode(run); continue; }
    const nodes = rtAvailableNodes(run);
    if (nodes.some(node => isArenaNode(node) && runRow(node.row) === row)) return run;
    run = ok(rtEnterNode(run, nodes[0].id), 'enter');
  }
  throw new Error(`seed ${k}: no map offering row ${row}`);
}

test('task 17: a gentle run\'s node card on rows 3 and 5 says what its fight plays (the gentle tables, not the old ones)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  let cards = 0, shot = false;
  for (const [k, row] of [[1, 3], [2, 3], [1, 5], [2, 5]] as const) {
    const run = runToRow(k, row);
    expect(run.gentleEntry).toBe(true);
    await page.goto('/');
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(run)] as const);
    await page.reload();
    await expect(page.getByTestId('run-map')).toBeVisible();
    for (const node of rtAvailableNodes(run).filter(n => isArenaNode(n) && runRow(n.row) === row)) {
      await page.getByTestId(`node-${node.id}`).click();
      await expect(page.getByTestId('run-dangers')).toBeVisible();
      const pick = arenaPreview(run, rtNode(run, node.id)!)!;
      const want = nodeDangers({ arena: pick.arena, roster: pick.roster, ...cardRules(run, node) }).map(line => `${line.label}: ${line.text}`);
      const shown = await page.getByTestId('run-dangers').locator('li').allTextContents();
      expect(shown.length, `seed ${k} ${node.id}`).toBe(want.length);
      // The enemies line may carry «✦ новое» after its text (a fresh viewer).
      want.forEach((line, i) => expect(shown[i].startsWith(line), `seed ${k} ${node.id}: «${shown[i]}» / «${line}»`).toBe(true));
      const elites = shown.find(line => line.startsWith('Элиты'));
      if (row === 3) expect(elites, `seed ${k} ${node.id}: row 3 of a gentle run`).toBeUndefined();
      if (row === 5 && elites) expect(elites, `seed ${k} ${node.id}: row 5`).not.toMatch(/броня 3|свойств/);
      if (!shot && row === 5) { shot = true; await page.screenshot({ path: 'artifacts/realtime-gentle-card-row5.png' }); }
      cards++;
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('run-dangers')).toBeHidden();
    }
  }
  expect(cards).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});

test('task 17: the winged heart by the map\'s HP — lit at the start; a lethal hit in the first fight stands the hero up with «второе дыхание: 3 HP»; back on the map the heart is dim', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 10);
  await page.getByTestId('gift-1').click();
  const heart = page.getByTestId('run-second-wind');
  await expect(heart).toHaveAttribute('data-state', 'ready');
  await expect(heart).not.toHaveClass(/rt-spent/);
  await expect(heart).toHaveAttribute('title', /^Второе дыхание: 3 HP\./);
  // Beside the HP, in the header's first line.
  const hp = (await page.getByTestId('run-hp').boundingBox())!, at = (await heart.boundingBox())!;
  expect(at.x).toBeGreaterThan(hp.x + hp.width - 8);
  expect(at.x).toBeLessThan(hp.x + hp.width + 40);
  expect(Math.abs((at.y + at.height / 2) - (hp.y + hp.height / 2))).toBeLessThan(10);
  await page.screenshot({ path: 'artifacts/realtime-gentle-heart.png', clip: { x: 0, y: 0, width: 640, height: 60 } });
  // The first fight: a lethal touch (the fight's own params), the hero stands up with 3 HP.
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await untilFrame(page, (s: any) => (s.enemies.length >= 1 ? true : undefined), null, 8);
  await page.evaluate(() => {
    const rt = (window as any).__realtime, s = rt.snapshot();
    Object.assign(rt.params, { enemySpeed: 0, wolfSpeed: 0, speedSpread: 0, contactDamage: 99 });
    rt.place(s.hero.x, s.hero.y, 1, 0, 'basic');
  });
  const s = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.secondWind.used !== null || late ? q : undefined), null, 8);
  expect(s.secondWind.used).not.toBeNull();
  expect(s.secondWind.text).toBe('второе дыхание: 3 HP');
  expect(s.hero.hp).toBe(3);
  expect(s.status).toBe('playing');
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.contactDamage = 0; rt.clear(false); });
  await page.mouse.move(640, 700);
  await page.screenshot({ path: 'artifacts/realtime-gentle-second-wind.png' });
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run')).toBeVisible();
  expect((await page.evaluate(() => (window as any).__realtime.run.state())).secondWindSpent).toBe(true);
  await expect(heart).toHaveAttribute('data-state', 'spent');
  await expect(heart).toHaveClass(/rt-spent/);
  await expect(heart).toHaveAttribute('title', 'Второе дыхание потрачено в этом походе.');
  await page.screenshot({ path: 'artifacts/realtime-gentle-heart-spent.png', clip: { x: 0, y: 0, width: 640, height: 60 } });
  expect(errors).toEqual([]);
});
