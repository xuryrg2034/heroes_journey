import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { readFileSync } from 'node:fs';
import {
  createRtRun, resolveArena, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtChooseTalisman, rtDieChoose,
  rtEnterNode, rtEventView, rtGiftView, rtNode, rtRestHeal, rtShopLeave, serializeRtRun, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';

/**
 * Task 47 «Сочность, пакет 2», the reward screens and the run end (design 16.10.2026, docs/design-notes/task-47-view-polish.md):
 * С5 — a short chord by the best card's tier on the screens of the talisman choice (the «Застава», the Jailer's relics and forms)
 * and of the hammer; С6 — the choice cards show one by one (0.5 s), a click on the bare screen or a key shows them all, and that
 * press takes no card; С8 — the lines of the run-end screen come one by one, a click shows them all. Real input at 1280×720;
 * `__realtime.run.screens()` counts what the view did. The chord of the tier 0 (common cards) is Node only (reveal.spec.ts): no
 * offer of the walked runs is all common. Screenshots go to $SHOT_DIR when it is set.
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/rt-run-save-before-reroll.json', import.meta.url), 'utf8')) as { hard: string };
const screens = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.screens());
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

function ok(step: RtRunStep): RtRunState { if (!step.ok) throw new Error(step.reason); return step.run; }

/** A run walked by its own commands (the first node of each row) until `stop` holds for its open screen; null — never. */
function walk(options: Parameters<typeof createRtRun>[1], stop: (run: RtRunState) => boolean): string | null {
  for (let k = 1; k < 40; k++) {
    let run: RtRunState = createRtRun(seedOf(k), options);
    for (let n = 0; n < 200 && !run.result; n++) {
      const p = run.pending;
      if (p && stop(run)) return serializeRtRun(run);
      if (p?.kind === 'battle') {
        if (rtNode(run, p.nodeId)!.type === 'boss' && stop(run)) return serializeRtRun(run);
        run = ok(resolveArena(run, { nodeId: p.nodeId, won: true, hp: run.hp, kills: 5, damage: 0, time: 30, bestChain: n === 3 ? 7 : 2 }));
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
  return null;
}

async function openSave(page: Page, save: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, value); }, [RUN_KEY, save] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

/** The cards of the open choice screen and their opacity (the reveal fades them in). */
const opacities = (page: Page): Promise<number[]> => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.rt-run-modal .rt-run-choice')].map(card => Number(getComputedStyle(card).opacity)));

test('С5: a chord by the best card — the Jailer\'s form screen is the form tier, the relic screen the rare one, the hammer the rare one', async ({ page }) => {
  const errors = collectErrors(page);
  const form = walk({ gift: 'mini', garrison: false }, run => run.pending?.kind === 'talisman' && run.pending.source === 'form');
  const relics = walk({ gift: 'mini', garrison: false, forms: false }, run => run.pending?.kind === 'talisman' && run.pending.source === 'oath');
  const hammer = walk({ gift: 'mini', garrison: false, forms: false }, run => run.pending?.kind === 'hammer');
  expect(form && relics && hammer).toBeTruthy();
  await openSave(page, form!);
  await expect(page.getByTestId('run-form')).toBeVisible();
  expect((await screens(page)).chords).toEqual([0, 0, 1]);
  expect((await screens(page)).last).toBe(2);
  await expect.poll(async () => (await screens(page)).reveal.running).toBe(false);
  await shot(page, 's5-form');
  await openSave(page, relics!);
  await expect(page.getByTestId('run-talisman')).toBeVisible();
  expect((await screens(page)).chords).toEqual([0, 1, 0]);
  await shot(page, 's5-rare');
  await openSave(page, hammer!);
  await expect(page.getByTestId('run-hammer')).toBeVisible();
  expect((await screens(page)).chords).toEqual([0, 1, 0]);
  await shot(page, 's5-hammer');
  expect(errors).toEqual([]);
});

test('С5: a chord asks for tones when the sound is on', async ({ page }) => {
  await openSave(page, fixture.hard);
  await expect(page.getByTestId('run-talisman')).toBeVisible();
  const before = await page.evaluate(() => ({ tones: (window as any).__realtime.snapshot().sound.tones, on: (window as any).__realtime.snapshot().sound.on }));
  expect(before.on).toBe(true);
  // A reroll opens a new screen — a new chord, three or more tones of a rare tier or two of a common one.
  await page.getByTestId('talisman-reroll').click();
  const info = await screens(page);
  expect(info.chords.reduce((a: number, b: number) => a + b, 0)).toBe(2);
  expect(await page.evaluate(() => (window as any).__realtime.snapshot().sound.tones)).toBeGreaterThanOrEqual(before.tones + 2);
});

test('С6: the cards show one by one in half a second; a click on the bare screen shows them all and takes no card', async ({ page }) => {
  const errors = collectErrors(page);
  await openSave(page, fixture.hard);
  await expect(page.getByTestId('run-talisman')).toBeVisible();
  const reroll = page.getByTestId('talisman-reroll');
  // The screen of the load already played its reveal; each reroll opens a new one. The click must come inside the half second.
  let skipped = false;
  for (let attempt = 0; attempt < 3 && !skipped; attempt++) {
    const before = (await screens(page)).reveal.skips;
    const talismans = (await page.evaluate(() => (window as any).__realtime.run.state())).talismans;
    await reroll.click();
    const mid = await screens(page);
    if (!mid.reveal.running) continue;
    expect(mid.reveal.cards).toBe(3);
    expect(mid.reveal.shown).toBeLessThan(3);
    if (attempt === 0) await shot(page, 's6-mid');
    await page.mouse.click(20, 400);
    const after = await screens(page);
    if (after.reveal.skips === before) continue;
    skipped = true;
    expect(after.reveal.running).toBe(false);
    expect(after.reveal.shown).toBe(3);
    expect(await opacities(page)).toEqual([1, 1, 1]);
    // The press that showed the cards took none of them.
    const state = await page.evaluate(() => (window as any).__realtime.run.state());
    expect(state.talismans).toEqual(talismans);
    expect(state.pending.kind).toBe('talisman');
    await expect(page.getByTestId('run-talisman')).toBeVisible();
  }
  expect(skipped).toBe(true);
  expect(errors).toEqual([]);
});

test('С6: a key shows the cards at once; left alone the cards all show by themselves', async ({ page }) => {
  await openSave(page, fixture.hard);
  await expect(page.getByTestId('run-talisman')).toBeVisible();
  const reroll = page.getByTestId('talisman-reroll');
  let skipped = false;
  for (let attempt = 0; attempt < 2 && !skipped; attempt++) {
    const before = (await screens(page)).reveal.skips;
    await reroll.click();
    if (!(await screens(page)).reveal.running) continue;
    await page.keyboard.press('x');
    skipped = (await screens(page)).reveal.skips === before + 1;
  }
  expect(skipped).toBe(true);
  expect(await opacities(page)).toEqual([1, 1, 1]);
  // Left alone: the next reroll's cards come by themselves (no press) and the reveal ends.
  await reroll.click();
  await expect.poll(async () => (await screens(page)).reveal.running, { timeout: 3_000 }).toBe(false);
  expect((await screens(page)).reveal.shown).toBe(3);
  expect(await opacities(page)).toEqual([1, 1, 1]);
});

test('С6: the potion screen and the camp have no reveal', async ({ page }) => {
  const find = walk({ gift: 'mini', garrison: false }, run => run.pending?.kind === 'find');
  expect(find).toBeTruthy();
  await openSave(page, find!);
  await expect(page.getByTestId('run-find')).toBeVisible();
  const info = await screens(page);
  expect(info.reveal.screens).toBe(0);
  expect(info.chords).toEqual([0, 0, 0]);
  expect(await opacities(page)).toEqual(await page.evaluate(() => [...document.querySelectorAll('.rt-run-modal .rt-run-choice')].map(() => 1)));
});

/** A run at the open final arena (the walk stops at the boss battle). */
const finalSave = (): string => {
  const save = walk({ gift: 'mini', garrison: false }, run => run.pending?.kind === 'battle' && rtNode(run, run.pending.nodeId)!.type === 'boss');
  if (!save) throw new Error('no run reached the final arena');
  return save;
};

test('С8: the run-end lines come one by one; a click shows them all at once', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSave(page, finalSave());
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-victory').or(page.getByTestId('run-die'))).toBeVisible();
  if (await page.getByTestId('run-die').isVisible()) await page.getByTestId('die-take').click();
  await expect(page.getByTestId('run-result-victory')).toBeVisible();
  // One read: the staging and the meta block's hold are the same moment.
  const mid = await page.evaluate(() => ({ ...(window as any).__realtime.run.screens(), held: document.querySelector('[data-testid="meta-end"]')?.classList.contains('rt-end-wait') ?? null }));
  expect(mid.end.screens).toBe(1);
  expect(mid.end.lines).toBeGreaterThanOrEqual(5);
  expect(mid.end.running).toBe(true);
  expect(mid.end.shown).toBeLessThan(mid.end.lines);
  // The meta block (the experience, the record) waits for the last line.
  if (mid.held !== null) expect(mid.held).toBe(true);
  await page.mouse.click(20, 400);
  const after = await screens(page);
  expect(after.end.skips).toBe(1);
  expect(after.end.running).toBe(false);
  expect(after.end.shown).toBe(after.end.lines);
  const lines = await page.locator('.rt-run-end-facts li, .rt-result-stats dt, .rt-result-stats dd').evaluateAll(els => els.map(el => Number(getComputedStyle(el).opacity)));
  expect(lines.length).toBeGreaterThanOrEqual(5);
  expect(lines.every(v => v === 1)).toBe(true);
  if (await page.getByTestId('meta-end').count()) expect(await page.getByTestId('meta-end').evaluate(el => el.classList.contains('rt-end-wait'))).toBe(false);
  await shot(page, 's8-after');
  // A reload shows the end whole, no staging.
  await page.reload();
  await expect(page.getByTestId('run-result-victory')).toBeVisible();
  expect((await screens(page)).end.screens).toBe(0);
  expect(errors).toEqual([]);
});

test('С8: left alone the lines all come by themselves', async ({ page }) => {
  test.setTimeout(90_000);
  await openSave(page, finalSave());
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory', { timeout: 15_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-victory').or(page.getByTestId('run-die'))).toBeVisible();
  if (await page.getByTestId('run-die').isVisible()) await page.getByTestId('die-take').click();
  await expect(page.getByTestId('run-result-victory')).toBeVisible();
  await shot(page, 's8-mid');
  await expect.poll(async () => (await screens(page)).end.running, { timeout: 8_000 }).toBe(false);
  const info = await screens(page);
  expect(info.end.skips).toBe(0);
  expect(info.end.shown).toBe(info.end.lines);
});
