import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { gameWait } from './realtimeFrames';
import { serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';

/**
 * Task 51 «Лагерь, этап 3», step 51г, the view of Евлампий (docs/design-notes/task-51-camp-l3.md, 3.3, 11.1, 11.2; docs/design-notes/npc-lines-v2.md):
 * he comes to the camp (the fallback path of the profile's quiet runs), sits on the right front rug under «✦», his bubble sells «Обет» and «Два обета»
 * (level 3 stays shut whatever the gate: «Закрыто / После замка колдуна»), his lines; the vows at the start of a run (2 offered, 1 taken; 3 offered, 2
 * taken), the shackles a fight cut reach the run's record (`cuts`), «Обеты: N» in the end screen's experience. Real mouse; runs walked in Node.
 * The rules: core's (run/hearthMonk.spec.ts).
 */
const shot = (name: string): string => `${process.env.SHOT_DIR ?? 'artifacts'}/${name}.png`;
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const fight = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

const everyone = { herb: true, smith: true, gambler: true };
const hearth = (levels: object, stock: number, extra: object = {}, met: object = everyone) => ({ stock, levels, met, lines: { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2, 'gambler:first': 1 }, quiet: 0, ...extra });
const profile = (gate: boolean, h: object) => ({ heroes: { cat: { xp: 40, packs: [], record: gate ? { row: 9, won: true, xp: 40 } : { row: 6, won: false, xp: 40 } } }, hearth: h });

async function open(page: Page, meta: object, run?: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([m, key, value]) => {
    localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1');
    localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 3, won: true, meta: m }));
    if (value) localStorage.setItem(key as string, value as string);
  }, [meta, RT_RUN_STORAGE_KEY, run ? serializeRtRun(run) : null] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('task 51г view: the third finished run after the garrison brings Евлампий — the right front rug, «✦» until the first click, his meeting line, «Обет» and «Два обета» bought, level 3 shut even with the gate open', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  // The profile counted two quiet runs since the garrison (`monkQuiet`); an abandoned run is the third.
  await open(page, profile(true, hearth({ owl: 0, herb: 0, smith: 0, gambler: 0 }, 40, { monkQuiet: 2 })));
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  await page.getByTestId('run-to-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
  await expect(page.getByTestId('hearth-npc-monk')).toBeVisible();
  await expect(page.getByTestId('hearth-new-monk')).toHaveText('✦');
  await expect(page.locator('[data-testid^="hearth-new-"]')).toHaveCount(1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('monk-camp') });
  await page.getByTestId('hearth-npc-monk').click();
  await expect(page.getByTestId('hearth-new-monk')).toHaveCount(0);
  await expect(page.getByTestId('hearth-line')).toHaveText('Кандалов ты не рубил, а я всё равно пришёл. В замке колдуна стало тесно.');
  await expect(page.getByTestId('hearth-bubble')).toContainText('Евлампий');
  await page.getByTestId('up-monk-1').click();
  await expect(page.getByTestId('up-monk-1-bought')).toBeVisible();
  await expect(page.getByTestId('hearth-line')).toHaveText('Обет, чадо. Возьми один — и держи, как я не умел.');
  await page.getByTestId('up-monk-2').click();
  await expect(page.getByTestId('up-monk-2-bought')).toBeVisible();
  await expect(page.getByTestId('hearth-line')).toHaveText('Два обета разом. Сам бы не взял — я и одного не держу.');
  // Level 3: always «Закрыто · После замка колдуна» (the gate of the others does not open it).
  await expect(page.getByTestId('up-monk-3-lock')).toBeVisible();
  await expect(page.getByTestId('up-monk-3-row')).toContainText('Закрыто');
  await expect(page.getByTestId('up-monk-3-row')).toContainText('После замка колдуна');
  await expect(page.getByTestId('up-monk-3')).toHaveCount(0);
  await page.screenshot({ path: shot('monk-bubble') });
  await page.reload();
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth-new-monk')).toHaveCount(0);
  await page.getByTestId('hearth-npc-monk').click();
  await expect(page.getByTestId('up-monk-2-bought')).toBeVisible();
  expect(errors).toEqual([]);
});

test('task 51г view: «Обет» — two vows at the start of a run, one taken (the second goes off), «В поход» starts the run with it; none taken is a choice', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await open(page, profile(false, hearth({ owl: 0, herb: 0, smith: 0, gambler: 0, monk: 1 }, 5, {}, { ...everyone, monk: true })));
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('hearth-vows')).toBeVisible();
  const cards = page.locator('[data-testid^="vow-"]');
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('vows-go')).toHaveText('Без обета');
  const ids = await cards.evaluateAll(els => els.map(e => e.getAttribute('data-vow')!));
  expect(new Set(ids).size).toBe(2);
  await page.screenshot({ path: shot('monk-vows') });
  await page.getByTestId(`vow-${ids[0]}`).click();
  await expect(page.getByTestId(`vow-${ids[0]}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`vow-${ids[1]}`)).toBeDisabled();
  await expect(page.getByTestId('vows-go')).toHaveText('В поход');
  await page.getByTestId('vows-go').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  expect((await snap(page)).hearth.vows).toEqual([ids[0]]);
  // None taken: the run has no vows.
  await open(page, profile(false, hearth({ owl: 0, herb: 0, smith: 0, gambler: 0, monk: 1 }, 5, {}, { ...everyone, monk: true })));
  await page.getByTestId('run-new').click();
  await page.getByTestId('vows-go').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  expect((await snap(page)).hearth?.vows).toBeUndefined();
  expect(errors).toEqual([]);
});

test('task 51г view: «Два обета» — three vows, two taken (the third goes off), a taken one can be put back', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, profile(false, hearth({ owl: 0, herb: 0, smith: 0, gambler: 0, monk: 2 }, 5, {}, { ...everyone, monk: true })));
  await page.getByTestId('run-new').click();
  const cards = page.locator('[data-testid^="vow-"]');
  await expect(cards).toHaveCount(3);
  const ids = await cards.evaluateAll(els => els.map(e => e.getAttribute('data-vow')!));
  await page.getByTestId(`vow-${ids[0]}`).click();
  await page.getByTestId(`vow-${ids[2]}`).click();
  await expect(page.getByTestId(`vow-${ids[1]}`)).toBeDisabled();
  await page.screenshot({ path: shot('monk-vows-two') });
  await page.getByTestId(`vow-${ids[0]}`).click();
  await expect(page.getByTestId(`vow-${ids[1]}`)).toBeEnabled();
  await page.getByTestId(`vow-${ids[1]}`).click();
  await page.getByTestId('vows-go').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  expect(new Set((await snap(page)).hearth.vows)).toEqual(new Set([ids[1], ids[2]]));
});

const CAMP = { gift: 'full' as const, garrison: true, moat: true, locked: [] as string[], hearth: { jailerRerolls: 1 } };
const MONK_PROFILE = profile(true, hearth({ owl: 0, herb: 0, smith: 0, gambler: 0, monk: 1 }, 5, {}, { ...everyone, monk: true }));

test('task 51г view: the shackle cut in a real fight (a chain across it, the mouse) reaches the run\'s record as `cuts`', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  let moat: RtRunState | null = null;
  for (let k = 1; k <= 12 && !moat; k++) walkRun({ k, create: CAMP, each: state => { if (!moat && state.pending?.kind === 'battle' && state.pending.arena === 'g-moat') moat = structuredClone(state); } });
  expect(moat, 'a walk reached «Ров»').not.toBeNull();
  await open(page, MONK_PROFILE, moat!);
  await page.getByTestId('run-battle').click();
  await expect.poll(async () => (await fight(page)).arena).toBe('g-moat');
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(5, 7.6);
  });
  const place = (x: number, y: number, color: number, hp: number, kind: string): Promise<number> => page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);
  await place(8, 2.4, 1, 1, 'keymaster'); await place(10.5, 2.4, 0, 0, 'basic');
  await gameWait(page, 3.3);
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = (await fight(page)).enemies.find((x: { id: number }) => x.id === id)!; return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  const a = await place(9.25, 1.5, 2, 0, 'basic'), b = await place(9.25, 3.3, 2, 0, 'basic');
  await page.evaluate(() => (window as any).__realtime.teleport(9.25, 0.6));
  const pa = await at(a), pb = await at(b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await fight(page)).chain).toEqual([a, b]);
  await page.mouse.up();
  await expect.poll(async () => (await fight(page)).tethers.list.length, { timeout: 5_000 }).toBe(0);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snap(page)).battles.length, { timeout: 15_000 }).toBeGreaterThan(moat!.battles.length);
  const record = (await snap(page)).battles.at(-1);
  expect(record.cuts, 'the cut shackle is in the record').toBe(1);
  expect(errors).toEqual([]);
});

test('task 51г view: a kept vow shows «Обеты: сдержано 1 из 1 · +15×1» in the end screen\'s experience; a run without vows has no such line', async ({ page }) => {
  test.setTimeout(120_000);
  const kept = walkRun({ k: 5, loot: 4, create: { ...CAMP, hearth: { jailerRerolls: 1, vows: ['vow-no-mapheal'] } } }).run;
  expect(kept.result?.outcome, 'the walk won').toBe('victory');
  await open(page, MONK_PROFILE, kept);
  await expect(page.getByTestId('meta-part-vows')).toContainText('Обеты: сдержано 1 из 1');
  await expect(page.getByTestId('meta-part-vows')).toContainText('+15×1');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('monk-end') });
  // A broken vow is seen by the number: «сдержано 0 из 1 · +15×0» (the walk rerolls, «Без переброса» is broken).
  const broken = walkRun({ k: 5, loot: 4, create: { ...CAMP, hearth: { jailerRerolls: 1, vows: ['vow-no-reroll'] } } }).run;
  await open(page, MONK_PROFILE, broken);
  await expect(page.getByTestId('meta-part-vows')).toContainText('Обеты: сдержано 0 из 1');
  await expect(page.getByTestId('meta-part-vows')).toContainText('+15×0');
  const plain = walkRun({ k: 5, loot: 4, create: CAMP }).run;
  await open(page, MONK_PROFILE, plain);
  await expect(page.getByTestId('meta-record')).toBeVisible();
  await expect(page.getByTestId('meta-part-vows')).toHaveCount(0);
});

test('task 51г view: the vows taken show a sign in the header of the map, a hover lists them; before the Jailer none is struck, after it the broken one is (the check of the core)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const { rtVowsOf } = await import('../src/realtime/run/rtMeta');
  let early: RtRunState | null = null, late: RtRunState | null = null;
  // «Без переброса» is broken by the walk's reroll, «Без лечения на карте» is kept; the state at the map after the Jailer's row counts them.
  walkRun({ k: 5, loot: 4, jailerReroll: 'oath', create: { ...CAMP, hearth: { jailerRerolls: 1, vows: ['vow-no-reroll', 'vow-no-mapheal'] } } as never,
    each: r => { if (r.pending) return; if (!early && !rtVowsOf(r)) early = structuredClone(r); const v = rtVowsOf(r); if (!late && v?.some(x => !x.kept)) late = structuredClone(r); } });
  expect(early, 'a map before the Jailer').not.toBeNull();
  expect(late, 'a map after the Jailer with a broken vow').not.toBeNull();
  await open(page, MONK_PROFILE, early!);
  await expect(page.getByTestId('run-vows')).toBeVisible();
  await expect(page.getByTestId('run-vows-tip')).toBeHidden();
  await page.getByTestId('run-vows').hover();
  await expect(page.getByTestId('run-vows-tip')).toBeVisible();
  await expect(page.getByTestId('run-vow-vow-no-reroll')).toContainText('Без переброса');
  await expect(page.getByTestId('run-vow-vow-no-mapheal')).toContainText('Без лечения на карте');
  await expect(page.locator('.rt-vows-tip .rt-broken')).toHaveCount(0);
  await open(page, MONK_PROFILE, late!);
  await page.getByTestId('run-vows').hover();
  await expect(page.getByTestId('run-vow-vow-no-reroll')).toHaveAttribute('data-broken', 'true');
  await expect(page.getByTestId('run-vow-vow-no-mapheal')).toHaveAttribute('data-broken', 'false');
  await expect(page.getByTestId('run-vow-vow-no-reroll')).toHaveCSS('text-decoration-line', 'line-through');
  await page.screenshot({ path: shot('monk-header-vows') });
  // A run without vows has no sign.
  await open(page, MONK_PROFILE, walkRun({ k: 5, create: CAMP, each: () => undefined }).run);
  await expect(page.getByTestId('run-vows')).toHaveCount(0);
  expect(errors).toEqual([]);
});
