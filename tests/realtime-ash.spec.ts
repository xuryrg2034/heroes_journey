import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { createRtRun, isArenaNode, resolveArena, rtArenaLoadout, rtAvailableNodes, rtEnterNode, serializeRtRun, type RtAshLevel, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_PROFILE_STORAGE_KEY, RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { runRow } from '../src/realtime/run/arenaPools';
import { closeNode, ok, seedOf, takeGift } from '../src/realtime/run/runFight.testkit';

/**
 * Task 18 «Испытание I–V», the view (design 13–14.10.2026; src/realtime/view/runView.ts, view/nodeCard.ts, docs/realtime-slice.md
 * «Испытание») at 1280×720 by real clicks. Runs are walked in Node by the run's own commands and put into the page's storage:
 * - a lost run's end screen has no choice (the profile never won); a run won in the page — its final fought, the hero walked
 *   through the door — opens «Испытание: 0 · I · … · VII» (task 45: VIII after the fifth colour's view) over «Новый поход» for good;
 * - a click chooses the level and its line («Неуязвимость 0,5 с, касание 2»), a reload keeps it, the new run takes it: the map
 *   header says «Испытание III», the run has no gentle entry;
 * - the node card of an «Испытание IV» run on row 6 says the fight's 2 traits («2 особых свойства»).
 */
const runState = (page: Page): Promise<RtRunState> => page.evaluate(() => (window as any).__realtime.run.state());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** A run (seed k, level `ash`) walked by its own commands, every fight won, until `stop` says so. */
function walk(k: number, ash: RtAshLevel, stop: (run: RtRunState) => boolean): RtRunState {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini', ash, garrison: false }));
  for (let step = 0; step < 600 && !run.result; step++) {
    if (stop(run)) return run;
    if (run.pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic', 'wolf'] }), 'win'); continue; }
    if (run.pending) { run = closeNode(run); continue; }
    run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  }
  throw new Error(`seed ${k}: the walk did not stop`);
}

async function open(page: Page, run: RtRunState, profile: object | null): Promise<void> {
  await page.goto('/');
  await page.evaluate(([runKey, value, profileKey, stored]) => {
    localStorage.clear();
    localStorage.setItem(runKey, value);
    if (stored) localStorage.setItem(profileKey, stored);
  }, [RT_RUN_STORAGE_KEY, serializeRtRun(run), RT_PROFILE_STORAGE_KEY, profile ? JSON.stringify(profile) : ''] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('task 18: no choice before a won run; the final won in the page opens «Испытание: 0 · I · … · VII» (task 45); the level is remembered and the new run takes it — «Испытание III» on the map', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  // A lost run's end: the profile has not won — no choice, only «Новый поход».
  let lost = takeGift(createRtRun(seedOf(5), { gift: 'mini', garrison: false }));
  lost = ok(rtEnterNode(lost, rtAvailableNodes(lost).find(isArenaNode)!.id), 'enter');
  lost = ok(resolveArena(lost, { nodeId: (lost.pending as { nodeId: string }).nodeId, won: false, hp: 0, kills: 3, damage: 15, time: 20, kinds: ['basic'] }), 'lose');
  await open(page, lost, null);
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.getByTestId('run-new')).toBeVisible();
  await expect(page.getByTestId('run-ash')).toHaveCount(0);

  // The final, open (a run without a given seed): fought in the page and won through the door.
  const final = walk(6, 0, run => run.pending?.kind === 'battle' && run.pending.battle === 'final');
  await open(page, final, null);
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await expect(page.getByTestId('run-ash')).toHaveCount(0);
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await page.getByTestId('result-map').click();
  const end = page.getByTestId('run-result-victory');
  await expect(end).toBeVisible();
  const choice = end.getByTestId('run-ash');
  await expect(choice).toBeVisible();
  await expect(choice).toHaveText('Испытание:0IIIIIIIVVVIVII'); // task 45, step 1: 0 … VII
  await expect(end.getByTestId('ash-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(end.getByTestId('run-ash-text')).toHaveText('Обычный поход');
  await expect(page.locator('body')).not.toContainText('Пепел');

  await end.getByTestId('ash-3').click();
  await expect(page.getByTestId('ash-3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('ash-0')).toHaveAttribute('aria-pressed', 'false');
  // Cumulative levels: the line says what III adds, with «+» (design 14.10.2026).
  await expect(page.getByTestId('run-ash-text')).toHaveText('+ неуязвимость 0,5 с, касание 2');
  await expect(page.getByTestId('ash-3')).toHaveAttribute('title', 'Испытание III: + неуязвимость 0,5 с, касание 2');
  await page.getByTestId('ash-1').click();
  await expect(page.getByTestId('run-ash-text')).toHaveText('+ без зелья и второго дыхания');
  // Task 45, step 1: VI and VII are offered with their lines, VIII not yet (the fifth colour's view comes in step 2).
  await page.getByTestId('ash-6').click();
  await expect(page.getByTestId('run-ash-text')).toHaveText('+ фокус короче на четверть');
  await page.getByTestId('ash-7').click();
  await expect(page.getByTestId('run-ash-text')).toHaveText('+ враги быстрее на десятую');
  await expect(page.getByTestId('ash-8')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-ash-choice-vii.png' });
  await page.getByTestId('ash-3').click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-ash-choice.png' });
  // A reload keeps the choice (the profile).
  await page.reload();
  await expect(page.getByTestId('ash-3')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('run-new').click();
  await page.getByTestId('gift-0').click();
  const pick = page.locator('[data-action="gift-pick"]').first();
  if (await pick.count()) await pick.click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  await expect(page.getByTestId('run-ash-title')).toHaveText('Испытание III');
  const state = await runState(page);
  expect(state.ash).toBe(3);
  expect(state.gentleEntry).toBeUndefined();
  expect(state.startPotion).toBeUndefined();
  // Small, by the title, in the header's first line.
  const title = (await page.locator('.rt-run-head > b').boundingBox())!, mark = (await page.getByTestId('run-ash-title').boundingBox())!;
  expect(mark.x).toBeGreaterThan(title.x + title.width - 2);
  expect(mark.height).toBeLessThan(title.height + 2);
  await page.screenshot({ path: 'artifacts/realtime-ash-header.png' });

  // Back to 0: the header has no mark.
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  // Smoke v62 (view): the abandoned run's end screen first; its «Новый поход» starts the new run.
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  expect((await runState(page)).ash).toBe(3);
  await page.evaluate(([key]) => { const p = JSON.parse(localStorage.getItem(key)!); delete p.ash; localStorage.setItem(key, JSON.stringify(p)); }, [RT_PROFILE_STORAGE_KEY] as const);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), seedOf(7));
  await page.getByTestId('gift-0').click();
  if (await pick.count()) await pick.click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.getByTestId('run-ash-title')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('task 18: «Испытание IV» — the node card on row 6 says the fight\'s 2 traits', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  let checked = 0;
  for (const k of [2, 3]) {
    const run = walk(k, 4, r => !r.pending && rtAvailableNodes(r).some(n => isArenaNode(n) && runRow(n.row) === 6));
    await open(page, run, null);
    await expect(page.getByTestId('run-ash-title')).toHaveText('Испытание IV');
    for (const node of rtAvailableNodes(run).filter(n => isArenaNode(n) && runRow(n.row) === 6)) {
      await page.getByTestId(`node-${node.id}`).click();
      await expect(page.getByTestId('run-detail')).toHaveAttribute('data-card', node.id);
      const elites = page.getByTestId('run-danger-elites');
      if (!(await elites.count())) continue;
      await expect(elites).toContainText('2 особых свойства');
      // The fight plays 2 traits: the run's loadout once the node is entered.
      const entered = ok(rtEnterNode(run, node.id), 'enter');
      if (entered.pending?.kind === 'battle') expect(rtArenaLoadout(entered).eliteAffixes).toBe(2);
      if (!checked) await page.screenshot({ path: 'artifacts/realtime-ash-card-iv.png' });
      checked++;
      await page.keyboard.press('Escape');
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
