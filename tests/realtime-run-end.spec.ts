import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import {
  createRtRun, resolveArena, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtChooseTalisman, rtDieChoose,
  rtEnterNode, rtEventView, rtGiftView, rtNode, rtRestHeal, rtShopLeave, serializeRtRun, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';

/**
 * П6 «Незакрытое дело» (src/realtime/run/rtRunEnd.ts, src/realtime/view/runView.ts; docs/realtime-slice.md, section 9) with
 * real input at 1280×720:
 * - defeat: a run (seed 13) entered by clicks, its first fight played — a chain of 4 drawn with the mouse, then an elite
 *   shield-bearer («Стремительный») set to touch the hero (test hooks) until he falls; «К карте» shows the end screen with
 *   the facts in their order: killer, row and rows left, Jailer, peak; a reload keeps them;
 * - victory: a run walked to its final arena by the run's own commands in Node (its first fight recorded a chain of 7) and
 *   put into the page's storage; the final is won by the run hook `winArena`; the end screen says only the final row and
 *   the peak; a reload keeps them.
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const facts = (page: Page): Promise<string[]> => page.getByTestId('run-end-facts').locator('li').allTextContents();

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** A quiet arena: nobody comes, the arena's own enemies gone; the enemies' speed is kept to be put back. */
async function quiet(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rt = (window as any).__realtime, speed = rt.params.enemySpeed;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false; rt.params.dashSpeed = 5;
    rt.clear(false);
    return speed as number;
  });
}

/** A chain of `n` weak enemies drawn with the mouse along a free line from the hero; returns when the dash is over. */
async function drawChain(page: Page, n: number): Promise<void> {
  const start = (await snapshot(page)).hero as { x: number; y: number };
  for (const [ox, oy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (ox || oy) await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [start.x + ox, start.y + oy] as const);
    const hero = (await snapshot(page)).hero as { x: number; y: number };
    const points = Array.from({ length: n }, (_, i) => ({ x: hero.x + dx * 1.2 * (i + 1), y: hero.y + dy * 1.2 * (i + 1) }));
    for (const p of points) await page.evaluate(([x, y]) => (window as any).__realtime.place(x, y, 0, 0), [p.x, p.y] as const);
    const screens: { x: number; y: number }[] = [];
    for (const p of points) screens.push(await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [p.x, p.y] as const));
    await page.mouse.move(screens[0].x, screens[0].y);
    await page.mouse.down();
    for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
    if ((await snapshot(page)).chain.length === n) {
      await page.mouse.up();
      await expect.poll(async () => (await snapshot(page)).moving, { timeout: 8_000 }).toBeNull();
      return;
    }
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).moving, { timeout: 8_000 }).toBeNull();
    await page.evaluate(() => (window as any).__realtime.clear(false));
  }
  throw new Error('no free line for the chain');
}

test('П6 defeat: the end screen says the killer, the row and rows left, the Jailer, the peak — in order; a reload keeps them', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(() => (window as any).__realtime.run.newRun(13));
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await page.locator('[data-status="available"][data-type="battle"]').first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const speed = await quiet(page);
  await drawChain(page, 4);
  // An elite shield-bearer with «Стремительный» at the hero's side walks into him (the only enemy on the arena: the limit of
  // 1 keeps newcomers out while it walks, so no plain enemy lands the last hit — a flake of 12.10.2026 under load).
  await page.evaluate(speedBack => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    rt.params.enemySpeed = speedBack; rt.params.maxEnemies = 1;
    rt.clear(false);
    rt.place(hero.x + 0.6, hero.y, 0, 2, 'shield', true, ['swift']);
  }, speed);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 60_000 });
  // Task 21 «Почему погиб»: under «Поражение» — the killer in the run-end screen's words, then the series of hits before it
  // (the shield-bearer's touches only); two lines, no more.
  await expect(page.getByTestId('result-killer')).toHaveText('Сразил: щитоносец-элита (броня, стремительный)');
  await expect(page.getByTestId('result-series')).toHaveText(/^касание ×\d+ за [1-5] с$/);
  await expect(page.getByTestId('result-death').locator('p')).toHaveCount(2);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-defeat-why.png' });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  const expected = ['Сразил: щитоносец-элита (броня, стремительный)', 'Ряд 1 · до «Последнего рубежа» 9', 'Тюремщик не пройден', 'Лучшая цепь похода: 4 убийства · ряд 1'];
  expect(await facts(page)).toEqual(expected);
  // The row «Ряд похода» of the numbers is gone (the facts replace it).
  await expect(page.locator('.rt-result-stats dt', { hasText: 'Ряд похода' })).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-run-end-defeat.png' });
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), RUN_KEY);
  expect(saved.battles[saved.battles.length - 1].death).toEqual({ source: 'touch', enemy: 'shield', elite: true, armor: true, affixes: ['swift'] });
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  expect(await facts(page)).toEqual(expected);
  // The way to a new run is the same button.
  await expect(page.getByTestId('run-new')).toBeVisible();
  expect(errors).toEqual([]);
});

function ok(step: RtRunStep): RtRunState { if (!step.ok) throw new Error(step.reason); return step.run; }
/** A run walked by its own commands to the open final arena: fights won (the first records a chain of 7, the rest 2). */
function finalSave(): string {
  for (let k = 1; k < 50; k++) {
    let run: RtRunState = createRtRun(seedOf(k), { gift: 'mini', garrison: false }), fights = 0;
    for (let n = 0; n < 200 && !run.result; n++) {
      const p = run.pending;
      if (p?.kind === 'battle') {
        if (rtNode(run, p.nodeId)!.type === 'boss') return serializeRtRun(run);
        run = ok(resolveArena(run, { nodeId: p.nodeId, won: true, hp: run.hp, kills: 5, damage: 0, time: 30, bestChain: fights++ === 0 ? 7 : 2 }));
      } else if (p?.kind === 'gift') {
        const view = rtGiftView(run)!;
        run = view.chosen !== null ? ok(rtChooseGiftPick(run, view.picks[0])) : ok(rtChooseGift(run, view.options.find(entry => entry.available)?.index ?? null));
      } else if (p?.kind === 'talisman') run = ok(rtChooseTalisman(run, null));
      else if (p?.kind === 'hammer') run = ok(rtChooseHammer(run, null));
      else if (p?.kind === 'die') run = ok(rtDieChoose(run, false));
      else if (p?.kind === 'find') run = ok(rtChooseFind(run, p.options.find(item => !rtItemRefusal(run, item)) ?? p.options[0]));
      else if (p?.kind === 'rest') run = ok(rtRestHeal(run));
      else if (p?.kind === 'shop') run = ok(rtShopLeave(run));
      else if (p?.kind === 'event') run = ok(rtChooseEventOption(run, rtEventView(run)!.options.find(option => option.safe && option.available)!.id));
      else if (!p) run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id));
      else break;
    }
  }
  throw new Error('no run reached the final arena');
}

test('П6 victory: the end screen says only the final row and the peak; a reload keeps them', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RUN_KEY, finalSave()] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  // A reload with the final arena open: the battle waits for its button.
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await page.getByTestId('result-map').click();
  // The cauldron of the final may open the die at the door first («Забрать»).
  await expect(page.getByTestId('run-result-victory').or(page.getByTestId('run-die'))).toBeVisible();
  if (await page.getByTestId('run-die').isVisible()) await page.getByTestId('die-take').click();
  await expect(page.getByTestId('run-result-victory')).toBeVisible();
  const expected = ['Ряд 10 · «Последний рубеж» пройден', 'Лучшая цепь похода: 7 убийств · ряд 1'];
  expect(await facts(page)).toEqual(expected);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-run-end-victory.png' });
  await page.reload();
  await expect(page.getByTestId('run-result-victory')).toBeVisible();
  expect(await facts(page)).toEqual(expected);
  expect(errors).toEqual([]);
});
