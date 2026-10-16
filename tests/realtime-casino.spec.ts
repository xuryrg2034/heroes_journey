import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import {
  createRtRun, resolveArena, rtAvailableNodes, rtCasinoLeave, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtChooseTalisman, rtDieChoose, rtEnterNode,
  rtEventView, rtGiftView, rtRestHeal, rtShopLeave, rtChooseEventOption, serializeRtRun, parseRtRun, rtCasinoNode, RT_CASINO_TITLE, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';

/**
 * B7 К9 «Игорный круг гоблинов» and К12 «Колесо костей» вживую (src/realtime/run/rtRun.ts, src/realtime/view/runView.ts,
 * docs/realtime-casino.md, «Игорный круг (К9)»): real clicks at 1280×720. The run is walked to the node by the run's own
 * commands in Node (fights fed back as won with 2 resources picked up; the run's key `goblinCircle` on, as the game has it)
 * and put into the page's storage; the page loads it as it is.
 * - the circle: two tables and «Уйти»; «Кости» rolls 1.2 s and lands on the game's two faces (the win flash only on 8+);
 *   the wheel's roll is skipped by a click and lands on the game's sector; a reload shows the same last game; after 3 games
 *   both tables are off; «Уйти» goes to the map, the node named as the circle;
 * - the ordinary event «Колесо костей» (outside the circle): «Крутить» turns the live wheel to the event's own outcome.
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const runState = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());

function ok(step: RtRunStep): RtRunState { if (!step.ok) throw new Error(step.reason); return step.run; }
/** One step of a simple walk: fights won (2 resources), the first or safe choice elsewhere; null — stop here. */
function stepOf(run: RtRunState, stop: (run: RtRunState) => boolean, circle: boolean, n: number): RtRunState | null {
  if (stop(run)) return null;
  const p = run.pending;
  if (p?.kind === 'battle') return ok(resolveArena(run, { nodeId: p.nodeId, won: true, hp: run.hp, kills: 5, damage: 0, time: 60, materials: { herbs: 1, resin: n % 2 } }));
  if (p?.kind === 'gift') {
    const view = rtGiftView(run)!;
    if (view.chosen !== null) return ok(rtChooseGiftPick(run, view.picks[0]));
    const first = view.options.find(entry => entry.available);
    return ok(rtChooseGift(run, first ? first.index : null));
  }
  if (p?.kind === 'casino') return ok(rtCasinoLeave(run));
  if (p?.kind === 'talisman') return ok(rtChooseTalisman(run, null));
  if (p?.kind === 'hammer') return ok(rtChooseHammer(run, null));
  if (p?.kind === 'die') return ok(rtDieChoose(run, false));
  if (p?.kind === 'find') return ok(rtChooseFind(run, p.options.find(item => !rtItemRefusal(run, item)) ?? p.options[0]));
  if (p?.kind === 'rest') return ok(rtRestHeal(run));
  if (p?.kind === 'shop') return ok(rtShopLeave(run));
  if (p?.kind === 'event') return ok(rtChooseEventOption(run, rtEventView(run)!.options.find(option => option.safe && option.available)!.id));
  const next = rtAvailableNodes(run), node = next.find(entry => entry.type === 'event') ?? next[0];
  return ok(rtEnterNode(run, node.id, null, circle ? { goblinCircle: true } : {}));
}
/** The first seed whose walk reaches `stop`; its save. */
function walkTo(stop: (run: RtRunState) => boolean, circle: boolean): string {
  for (let k = 1; k < 400; k++) {
    let run: RtRunState | null = createRtRun(seedOf(k), { gift: 'mini', garrison: false }), last = run;
    for (let n = 0; n < 200 && run && !run.result; n++) { last = run; run = stepOf(run, stop, circle, n); }
    if (!run && stop(last)) return serializeRtRun(last);
  }
  throw new Error('no such run on 400 seeds');
}
const circleSave = walkTo(run => run.pending?.kind === 'casino' && Object.values(run.materials).reduce((a, b) => a + b, 0) >= 4, true);
// A map with an event node the circle may still stand on (the card's hint, design 12.10.2026).
const hintSave = walkTo(run => !run.pending && !run.casino && rtAvailableNodes(run).some(node => rtCasinoNode(node)), true);
const wheelSave = walkTo(run => run.pending?.kind === 'event' && rtEventView(run)?.event.id === 'bone-wheel' && !!rtEventView(run)!.options.find(o => o.id === 'spin')?.available, false);

async function openSave(page: Page, errors: string[], save: string): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RUN_KEY, save] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('the circle: «Кости» rolls and lands on the game\'s faces, the wheel\'s roll is skipped by a click, a reload keeps the last game, 3 games, «Уйти»', async ({ page }) => {
  const errors: string[] = [];
  await openSave(page, errors, circleSave);
  const card = page.getByTestId('run-casino'), roll = page.getByTestId('run-roll');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText(RT_CASINO_TITLE);
  await expect(page.getByTestId('casino-count')).toContainText('Игр: 0 из 3');
  await expect(page.getByTestId('casino-dice')).toBeEnabled();
  await expect(page.getByTestId('casino-dice')).toContainText('15 из 36');
  await expect(page.getByTestId('casino-wheel')).toContainText('1 из 6');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-casino.png' });

  // «Кости»: the roll shows (rolling), then lands by itself on the game's two faces.
  await page.getByTestId('casino-dice').click();
  await expect(roll).toHaveAttribute('data-kind', 'dice');
  await expect(roll).toHaveAttribute('data-landed', 'false');
  await expect(roll).toHaveAttribute('data-landed', 'true', { timeout: 3_000 });
  let state = await runState(page);
  const dice = state.casino.games[0], sum = dice.faces[0] + dice.faces[1];
  await expect(page.getByTestId('roll-face-0')).toHaveAttribute('data-face', String(dice.faces[0]));
  await expect(page.getByTestId('roll-face-1')).toHaveAttribute('data-face', String(dice.faces[1]));
  await expect(page.getByTestId('roll-result')).toHaveAttribute('data-win', String(sum >= 8));
  await expect(page.getByTestId('roll-result')).toContainText(`Кости: ${dice.faces[0]} и ${dice.faces[1]} = ${sum}`);
  await page.screenshot({ path: 'artifacts/realtime-casino-dice.png' });
  await page.getByTestId('roll-close').click();
  await expect(roll).toBeHidden();
  await expect(page.getByTestId('casino-count')).toContainText('Игр: 1 из 3');
  const lastDice = await page.getByTestId('casino-last').textContent();
  expect(lastDice).toContain(`= ${sum}`);

  // A reload: the same last game, no new roll.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('casino-last')).toHaveText(lastDice!);
  await expect(roll).toBeHidden();
  expect((await runState(page)).casinoDraws).toBe(state.casinoDraws);

  // The wheel: a click on the turning wheel skips the roll; it lands on the game's sector.
  await page.getByTestId('casino-wheel').click();
  await expect(roll).toHaveAttribute('data-kind', 'wheel');
  expect(await roll.getAttribute('data-landed')).toBe('false');
  await roll.click({ position: { x: 20, y: 20 } });
  // The click lands it at once (its handler redraws), long before the 1.2 s.
  expect(await roll.getAttribute('data-landed')).toBe('true');
  state = await runState(page);
  const spin = state.casino.games[1];
  expect(spin.table).toBe('wheel');
  await expect(page.getByTestId('roll-wheel')).toHaveAttribute('data-outcome', String(spin.outcome));
  await expect(page.locator('[data-testid="roll-wheel"] .rt-wheel-hit')).toHaveAttribute('data-sector', String(spin.outcome));
  await page.screenshot({ path: 'artifacts/realtime-casino-wheel.png' });
  await page.getByTestId('roll-close').click();

  // The third game, then both tables are off with the reason.
  if (state.hp >= 1 && Object.values(state.materials as Record<string, number>).reduce((a, b) => a + b, 0) >= 1) {
    await page.getByTestId('casino-dice').click();
    await roll.click({ position: { x: 20, y: 20 } });
    await page.getByTestId('roll-close').click();
    await expect(page.getByTestId('casino-count')).toContainText('Игр: 3 из 3');
    await expect(page.getByTestId('casino-dice')).toBeDisabled();
    await expect(page.getByTestId('casino-wheel')).toBeDisabled();
    await expect(page.getByTestId('casino-dice')).toContainText('Игр больше нет (3 из 3)');
  }

  // «Уйти»: the map; the node is the circle.
  await page.getByTestId('casino-leave').click();
  await expect(card).toBeHidden();
  state = await runState(page);
  expect(state.pending).toBeNull();
  expect(state.currentNodeId).toBe(state.casino.nodeId);
  await expect(page.getByTestId(`node-${state.casino.nodeId}`).locator('title')).toHaveText(RT_CASINO_TITLE);
  expect(errors).toEqual([]);
});

test('the map card of an event node the circle may stand on: «Может стать игорным кругом · 30 %», the terms in small print', async ({ page }) => {
  const errors: string[] = [];
  await openSave(page, errors, hintSave);
  const node = rtAvailableNodes(parseRtRun(hintSave)!).find(entry => rtCasinoNode(entry))!;
  await page.getByTestId(`node-${node.id}`).click();
  await expect(page.getByTestId('run-casino-hint')).toHaveText('Может стать игорным кругом · 30 %');
  await expect(page.getByTestId('run-casino-terms')).toHaveText('Не больше одного за поход, нужен хотя бы 1 ресурс.');
  expect(errors).toEqual([]);
});

test('the ordinary event «Колесо костей»: «Крутить» turns the live wheel to the event\'s own outcome', async ({ page }) => {
  const errors: string[] = [];
  await openSave(page, errors, wheelSave);
  await expect(page.getByTestId('run-event')).toBeVisible();
  const draws = (await runState(page)).streams.events;
  await page.getByTestId('event-spin').click();
  const roll = page.getByTestId('run-roll');
  await expect(roll).toHaveAttribute('data-kind', 'wheel');
  await expect(roll).toHaveAttribute('data-landed', 'false');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/realtime-bone-wheel-spin.png' });
  await expect(roll).toHaveAttribute('data-landed', 'true', { timeout: 3_000 });
  const state = await runState(page), choice = state.eventChoices[state.eventChoices.length - 1];
  expect(choice.option).toBe('spin');
  expect(state.streams.events).toBe(draws);
  await expect(page.getByTestId('roll-wheel')).toHaveAttribute('data-outcome', String(choice.outcome));
  await page.screenshot({ path: 'artifacts/realtime-bone-wheel.png' });
  await page.getByTestId('roll-close').click();
  await expect(roll).toBeHidden();
  expect(state.pending).toBeNull();
  expect(errors).toEqual([]);
});
