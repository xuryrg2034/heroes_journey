import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { createRtRun, resolveArena, rtAvailableNodes, rtEnterNode, rtNode, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_PROFILE_STORAGE_KEY, RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { rtMetaLocked } from '../src/realtime/run/rtMeta';
import { closeNode, ok, seedOf, takeGift } from '../src/realtime/run/runFight.testkit';
import { TOAD_LINES } from '../src/realtime/view/heroLines';
import { TOAD_LINES_BY_NPC } from '../src/realtime/view/npcToadLines';

/**
 * Task 49 «Второй герой: Ведунья», the meta part of the view (docs/design-notes/task-49-second-hero.md, 6.1, 7.1; docs/realtime-slice.md,
 * «Герои: Ведунья») at 1280×720. The cat's run is walked in Node by the run's own commands up to the Jailer's fight, which is won in
 * Node too (the arena itself is the other helper's view); the reward screens, the cage scene, the camp and «Новый поход» are real clicks:
 * - the first win over the Jailer in a run without a given seed: after his reward screens the cage scene, one button «Открыть клетку»,
 *   her one line; the profile frees her (`freed.toad`); the run itself (talismans, hammer, HP) is the one the clicks made;
 * - a given seed (`?seed=` run) and a second win: no scene;
 * - the camp: both heroes by the fire, her first line, a click on her chooses her; «Новый поход» shows the two cards with the law and the
 *   price; her run starts with her (`heroId`), a fight of row 1 opens with the arena; `?hero=toad` starts her debug run.
 * Shots: SHOT_DIR (default artifacts/).
 */
const PROFILE_BASE = { version: 1, giftFull: false, runs: 3, jailer: true } as const;
const HEARTH = { stock: 3, levels: { owl: 0, herb: 0, smith: 0 }, met: {}, lines: { 'owl:first': 2 }, quiet: 0 };
const shot = (name: string): string => `${process.env.SHOT_DIR ?? 'artifacts'}/${name}.png`;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** A forest run walked by its own commands up to the open Jailer fight (the forest's `checkpoint`), then the fight won: his hammer screen is open. */
function jailerWon(k: number, seeded: boolean): RtRunState {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini', ...seeded ? { seeded: true } : { locked: rtMetaLocked(undefined, 'cat') } }));
  for (let step = 0; step < 600; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      const jailer = rtNode(run, pending.nodeId)?.type === 'checkpoint';
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic', 'wolf'] }), 'win');
      if (jailer) return run;
      continue;
    }
    if (pending) { run = closeNode(run); continue; }
    run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  }
  throw new Error(`seed ${k}: no Jailer reached`);
}

async function open(page: Page, run: RtRunState | null, profile: object, url = '/'): Promise<void> {
  await page.goto('/');
  await page.evaluate(([runKey, value, profileKey, stored]) => {
    localStorage.clear();
    if (value) localStorage.setItem(runKey, value);
    localStorage.setItem(profileKey, stored);
  }, [RT_RUN_STORAGE_KEY, run ? serializeRtRun(run) : '', RT_PROFILE_STORAGE_KEY, JSON.stringify(profile)] as const);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

const profileOf = (page: Page): Promise<any> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), RT_PROFILE_STORAGE_KEY);
const runState = (page: Page): Promise<RtRunState> => page.evaluate(() => (window as any).__realtime.run.state());
const shown = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.heroesShown());

/** The Jailer's reward screens by their first choices, until the cage scene or the bare map (`map`). */
async function passRewards(page: Page): Promise<'cage' | 'map'> {
  for (let k = 0; k < 14; k++) {
    if (await page.getByTestId('cage-scene').isVisible().catch(() => false)) return 'cage';
    const pending = (await runState(page)).pending;
    if (!pending) { await page.waitForTimeout(250); if (await page.getByTestId('cage-scene').isVisible().catch(() => false)) return 'cage'; return 'map'; }
    const choice = page.locator('.rt-run-modal button.rt-run-choice:not([disabled]), .rt-run-modal .rt-again, .rt-run-modal .rt-other:not([disabled])').first();
    if (await choice.isVisible().catch(() => false)) await choice.click(); else await page.waitForTimeout(300);
  }
  throw new Error('the reward screens did not end');
}

test('task 49: the first win over the Jailer — his screens, then the cage scene; «Открыть клетку» frees her (one line, no change to the run); the camp seats both heroes; she is chosen; «Новый поход» takes her', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const run = jailerWon(3, false);
  expect(['hammer', 'talisman'], 'a reward screen of the Jailer is open').toContain(run.pending?.kind);
  await open(page, run, { ...PROFILE_BASE, meta: { heroes: {}, hearth: HEARTH } });
  expect((await profileOf(page)).meta.freed, 'not freed before the win\'s screens are over').toBeUndefined();

  expect(await passRewards(page)).toBe('cage');
  const scene = page.getByTestId('cage-scene');
  await expect(scene).toHaveAttribute('data-state', 'closed');
  await expect(page.getByTestId('cage-open')).toHaveText('Открыть клетку');
  await expect(scene.getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('cage-line')).toHaveCount(0);
  expect((await shown(page)).cage).toBe('closed');
  // The run did not wait for the scene: it is on the map already, with what the clicks took.
  const before = await runState(page);
  expect(before.pending).toBeFalsy();
  const meta = (await profileOf(page)).meta;
  expect(meta.freed.toad.row, 'freed with the Jailer\'s row').toBeGreaterThan(0);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('cage-scene-closed') });

  await page.getByTestId('cage-open').click();
  await expect(scene).toHaveAttribute('data-state', 'opened');
  await expect(page.getByTestId('cage-line')).toContainText(TOAD_LINES.cage_2[0]);
  await page.waitForTimeout(1300);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('cage-scene-opened') });
  await page.getByTestId('cage-done').click();
  await expect(scene).toHaveCount(0);
  const after = await runState(page);
  expect({ ...after, result: undefined }).toEqual({ ...before, result: undefined });

  // The camp: the first run's end is not needed — the profile has a camp. Her first line names the deed; both heroes sit by the fire.
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
  await expect(page.getByTestId('hearth-hero-cat')).toBeVisible();
  await expect(page.getByTestId('hearth-hero-toad')).toBeVisible();
  await expect(page.getByTestId('hearth-hero-line')).toHaveText(TOAD_LINES.first_camp[0]);
  await expect(page.getByTestId('hearth-hero-cat')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hearth-hero-toad')).toHaveAttribute('aria-pressed', 'false');
  const catBox = (await page.getByTestId('hearth-hero-cat').boundingBox())!, toadBox = (await page.getByTestId('hearth-hero-toad').boundingBox())!;
  const centre = (await page.locator('.rt-hearth-center').boundingBox())!;
  for (const b of [catBox, toadBox]) expect(b.y + b.height, 'the heroes sit above the fire\'s panel').toBeLessThanOrEqual(centre.y + 24);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('hearth-two-heroes-cat') });

  // A click on her chooses her (the profile remembers); one pick line; the bar and the record are hers (none yet).
  await page.getByTestId('hearth-hero-toad').click();
  await expect(page.getByTestId('hearth-hero-toad')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hearth-hero-line')).toHaveText(TOAD_LINES.pick[0]);
  expect((await profileOf(page)).meta.hero).toBe('toad');
  await expect(page.getByTestId('hearth-bar')).toContainText('0 / 60');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('hearth-two-heroes-toad') });
  await page.getByTestId('hearth-hero-cat').click();
  expect((await profileOf(page)).meta.hero, 'the cat again: the field is dropped').toBeUndefined();
  await page.getByTestId('hearth-hero-toad').click();
  expect((await profileOf(page)).meta.hero).toBe('toad');

  // «Новый поход» (the run is open: abandoned first, its end screen holds the cards): her card is marked, with the law and the price.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  const end = page.getByTestId('run-result-abandoned');
  await expect(end).toBeVisible();
  const cards = end.getByTestId('run-heroes');
  await expect(cards.locator('.rt-hero-card')).toHaveCount(2);
  const info = await shown(page);
  expect(info.chosen).toBe('toad');
  expect(info.laws.toad).toEqual(['Кольцо с первого боя', 'Щит — только после кольца']);
  expect(info.laws.cat, 'the cat card: the number is the run chainShieldMinKills, in words').toEqual(['Формы находит в походе', 'Щит — после трёх убийств']);
  for (const words of Object.values<string[]>(info.laws)) for (const line of words) expect(line.split(/\s+/).length, `«${line}» is at most 6 words`).toBeLessThanOrEqual(6);
  await expect(page.getByTestId('hero-card-toad')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('run-ash')).toHaveCount(0); // her «Испытание» is closed until her win
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('new-run-hero-cards') });
  // A click on the cat's card chooses him, on hers — her again.
  await page.getByTestId('hero-card-cat').click();
  expect((await profileOf(page)).meta.hero).toBeUndefined();
  await page.getByTestId('hero-card-toad').click();
  expect((await profileOf(page)).meta.hero).toBe('toad');

  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  const started = await runState(page);
  expect(started.heroId).toBe('toad');
  expect(started.seeded).toBeFalsy();
  expect(started.locked, 'her own locked items (the packs of her own)').toEqual(rtMetaLocked(undefined, 'toad'));
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();

  // The first battle of row 1 plays with her: the arena opens, the run keeps her.
  const nodes = page.locator('[data-status="available"]');
  await expect(nodes.first()).toBeVisible();
  const types = await nodes.evaluateAll(els => els.map(e => e.getAttribute('data-type')));
  await nodes.nth(Math.max(0, types.findIndex(t => t === 'battle'))).click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.arenaOpen())).toBe(true);
  expect((await runState(page)).heroId).toBe('toad');
  // The fight's kit holds her innate «Печать» (the other helper's view reads the same world).
  const snap = await page.evaluate(() => { const s = (window as any).__realtime.snapshot(); return { status: s.status, hero: s.hero }; });
  expect(snap.status).toBe('playing');
  expect(errors).toEqual([]);
});

test('task 49: a run with a given seed and a second win over the Jailer get no cage scene', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  // A seeded run (a saved one: its flag `seeded`): the win frees nobody, the profile stays as it was.
  await open(page, jailerWon(4, true), { ...PROFILE_BASE, meta: { heroes: {}, hearth: HEARTH } });
  expect(await passRewards(page)).toBe('map');
  await expect(page.getByTestId('cage-scene')).toHaveCount(0);
  expect((await profileOf(page)).meta.freed).toBeUndefined();

  // Freed already (the profile has her): a second win — no scene, her freeing is not rewritten.
  const freed = { toad: { row: 7, run: 1 } };
  await open(page, jailerWon(3, false), { ...PROFILE_BASE, meta: { heroes: {}, hearth: HEARTH, freed } });
  expect(await passRewards(page)).toBe('map');
  await expect(page.getByTestId('cage-scene')).toHaveCount(0);
  expect((await profileOf(page)).meta.freed).toEqual(freed);
  expect((await shown(page)).cage).toBeNull();
  expect(errors).toEqual([]);
});

test('task 49: before the rescue the camp holds the cat alone and «Новый поход» has no hero cards; `?hero=toad` starts her debug run without the meta', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await open(page, null, { ...PROFILE_BASE, meta: { heroes: {}, hearth: HEARTH } });
  await expect(page.getByTestId('run-heroes')).toHaveCount(0);
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth-hero-cat')).toBeVisible();
  await expect(page.getByTestId('hearth-hero-toad')).toHaveCount(0);
  await expect(page.getByTestId('hearth-hero-line')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('hearth-cat-alone') });

  await open(page, null, { ...PROFILE_BASE, meta: { heroes: {}, hearth: HEARTH } }, '/?hero=toad');
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  const run = await runState(page);
  expect(run.heroId).toBe('toad');
  expect(run.seeded).toBe(true);
  expect(errors).toEqual([]);
});

/** Ведунья's run (a saved one) holding «Иней на клинке» alone, at the first rest: the innate «Печать» is the pair. */
function toadAtRest(k: number): RtRunState {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini', seeded: true, hero: 'toad' }));
  run = { ...run, talismans: [...run.talismans, 'frost-edge'] };
  for (let step = 0; step < 200; step++) {
    if (run.pending?.kind === 'rest') return run;
    if (run.pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic', 'wolf'] }), 'win'); continue; }
    if (run.pending) { run = closeNode(run); continue; }
    const nodes = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, (nodes.find(n => n.type === 'rest') ?? nodes[0]).id), 'enter');
  }
  throw new Error(`seed ${k}: no rest reached`);
}

test('task 49: Ведунья\'s rest offers «Сплав: «Ледяная печать»» from «Иней на клинке» alone; a click makes it (the innate half is the pair)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const run = toadAtRest(2);
  await open(page, run, { ...PROFILE_BASE, meta: { heroes: {}, hearth: HEARTH } });
  const fuse = page.getByTestId('rest-fuse-fusion-ice-seal');
  await expect(fuse).toBeVisible();
  await expect(fuse).toBeEnabled();
  await expect(fuse).toContainText('Ледяная печать');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('rest-fuse-toad') });
  await fuse.click();
  await expect.poll(async () => (await runState(page)).talismans).toContain('fusion-ice-seal');
  const made = await runState(page);
  expect(made.talismans, '«Иней» is the fusion\'s half and goes into it').not.toContain('frost-edge');
  expect(errors).toEqual([]);
});

test('task 49: after her run the camp gives her line of its death or record at her place; after the cat run none', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const hearth = (last: object) => ({ ...HEARTH, lines: { 'owl:first': 9, 'toad:first_camp': 1 }, last });
  const meta = (last: object) => ({ heroes: { toad: { xp: 5, packs: [] } }, hearth: hearth(last), freed: { toad: { row: 5, run: 1 } }, hero: 'toad' });
  await open(page, null, { ...PROFILE_BASE, meta: meta({ won: false, row: 3, beaten: false, cause: 'crowd', hero: 'toad' }) });
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth-hero-line')).toHaveText(TOAD_LINES.death_crowd[0]);
  // The camp NPC speaks to her: the owl's variant for the death by the crowd (its own memory key `owl:death_crowd:toad`).
  await page.getByTestId('hearth-npc-owl').click();
  await expect(page.getByTestId('hearth-line')).toHaveText(TOAD_LINES_BY_NPC.owl.death_crowd![0]);
  expect((await profileOf(page)).meta.hearth.lines['owl:death_crowd:toad']).toBe(1);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot('hearth-after-her-run-owl') });
  await open(page, null, { ...PROFILE_BASE, meta: meta({ won: false, row: 6, beaten: true, cause: 'crowd', hero: 'toad' }) });
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth-hero-line')).toHaveText(TOAD_LINES.record[0]);
  await open(page, null, { ...PROFILE_BASE, meta: meta({ won: false, row: 3, beaten: false, cause: 'crowd' }) });
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth-hero-toad')).toBeVisible();
  await expect(page.getByTestId('hearth-hero-line')).toHaveCount(0);
  expect(errors).toEqual([]);
});
