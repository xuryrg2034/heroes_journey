import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import { warmupEnd, warmupScore, type WarmupId } from '../src/realtime/run/warmup';
import type { RtRecord } from '../src/realtime/telemetry/schema';

/**
 * Task 51ж «Разминка» (view/warmupFlow.ts, view/warmupView.ts, view/hearthView.ts, view/main.ts; rules — run/warmup.ts; design
 * docs/design-notes/task-51-camp-l3.md, section 5): real clicks and real mouse input at 1280×720.
 *
 * - «Чурбаки» stand by the fire on the free ground of the front, clear of every other place and inside the scene; a click opens the choice of
 *   the three layouts with the record of each («—» before the first attempt); «Назад» returns to the camp;
 * - «Строй»: the label at the hero (timer and the chain), no tiles, «Выход»; a chain of real links, the end at the time limit; the result panel with
 *   the score, «Новый рекорд!», Ерофей's line, the record in the profile; «Ещё раз» — a fresh attempt; an equal score is no record and says
 *   no line; a better one is a record and the second line of the turn; the score of the page is the Node replay's of the same journal;
 * - «Пестрота»: the game time in the label; «Выход» — no result: the profile's records stay, the telemetry says `exit`;
 * - «Через пропасть»: the jump and the whirl tiles only; a death — the panel «Погиб — без итога», no record, «Ещё раз» starts again at full HP;
 * - the sandbox's arena menu has no warmup layout.
 * Waits are in game time (tests/realtimeFrames.ts). Shots: SHOT_DIR (default artifacts).
 */
const shot = (name: string): string => `${process.env.SHOT_DIR ?? 'artifacts'}/${name}.png`;
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const wm = async (page: Page): Promise<any> => (await snap(page)).warmup;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** A camp with Ерофей at the fire (his meeting said), no records yet unless `warmup` says so. */
const metaOf = (warmup?: Record<string, { best: number }>, smith = true) => ({
  heroes: { cat: { xp: 40, packs: [], record: { row: 3, won: false, xp: 40 } } },
  hearth: {
    stock: 6, levels: { owl: 1 }, met: { smith }, lines: { 'owl:first': 2, ...smith ? { 'smith:first': 2 } : {} }, quiet: 0,
  },
  ...warmup ? { warmup } : {},
});

async function openCamp(page: Page, meta = metaOf()): Promise<void> {
  await page.goto('/');
  await page.evaluate(m => {
    localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1');
    localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 2, meta: m }));
  }, meta);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
}

const profile = (page: Page): Promise<any> => page.evaluate(() => JSON.parse(localStorage.getItem('ashen-oath-rt-profile-v1') ?? '{}'));

/** From the camp: «Чурбаки» → the layout's row → the attempt is on (the first frame played). */
async function startLayout(page: Page, id: WarmupId): Promise<void> {
  await page.getByTestId('hearth-warmup').click();
  await page.getByTestId(`warmup-pick-${id}`).click();
  expect(await untilFrame(page, (s, want: string) => s.warmup.active && s.warmup.id === want && s.tick > 0 ? true : undefined, id, 3)).toBe(true);
}

interface Pt { x: number; y: number }
/** The stage point of an enemy (arena units → the page). */
const screen = (page: Page, x: number, y: number): Promise<Pt> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

/** The enemies of the most common colour, nearest first from the hero (greedy nearest neighbour): the order of a chain through the arc. */
async function arcOrder(page: Page): Promise<{ id: number; x: number; y: number }[]> {
  const s = await snap(page);
  const count = new Map<number, number>();
  for (const e of s.enemies) count.set(e.color, (count.get(e.color) ?? 0) + 1);
  const color = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const left = s.enemies.filter((e: any) => e.color === color).map((e: any) => ({ id: e.id, x: e.x, y: e.y }));
  const order: { id: number; x: number; y: number }[] = [];
  let at = { x: s.hero.x, y: s.hero.y };
  while (left.length) {
    left.sort((a: any, b: any) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
    const next = left.shift()!;
    order.push(next); at = next;
  }
  return order;
}

/** A real chain over the first `links` of the arc with the mouse; the dash runs, then the label has counted them. */
async function dragArc(page: Page, links: number): Promise<void> {
  const arc = (await arcOrder(page)).slice(0, links);
  const pts = await Promise.all(arc.map(e => screen(page, e.x, e.y)));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps: 8 });
  await page.mouse.up();
  expect(await untilFrame(page, (s, want: number) => s.warmup.label?.includes(`цепь ${want}`) ? true : undefined, links, 6), `the label counts ${links} links`).toBe(true);
}

/** Waits (game time) for the end of the attempt and for the result panel. */
async function untilResult(page: Page, seconds: number): Promise<any> {
  const got = await untilFrame(page, s => s.warmup.final && s.warmup.panel.open ? s.warmup : undefined, 0, seconds);
  expect(got && got.final, 'the attempt ended with its result on the screen').toBeTruthy();
  return got;
}

/** The record the profile holds for layout `id` (undefined — none). */
const bestOf = async (page: Page, id: WarmupId): Promise<number | undefined> => (await profile(page)).meta?.warmup?.[id]?.best;

test('the camp: «Чурбаки» stand on the free ground clear of every place, a click opens the three layouts with their records, «Назад» returns', async ({ page }) => {
  const errors = collectErrors(page);
  await openCamp(page, metaOf({ 'warmup-line': { best: 6 }, 'warmup-mix': { best: 14.2 } }));
  const spot = page.getByTestId('hearth-warmup');
  await expect(spot).toBeVisible();
  await expect(spot).toContainText('Чурбаки');
  await page.screenshot({ path: shot('51w-hearth') });
  const box = (await spot.boundingBox())!, stage = (await page.locator('.rt-hearth-stage').boundingBox())!;
  expect(box.x >= stage.x && box.y >= stage.y && box.x + box.width <= stage.x + stage.width && box.y + box.height <= stage.y + stage.height, 'inside the 1280×720 scene').toBe(true);
  expect(box.y + box.height <= 720 - 40, 'not on the edge of the first screen').toBe(true);
  // Clear of every other place (NPC, heroes, the empty places), the fire's panel and the «В поход» button.
  const others = page.locator('.rt-hearth-place:not(.rt-hearth-warmup), .rt-hearth-center, .rt-hearth-go');
  for (let i = 0; i < await others.count(); i++) {
    const b = (await others.nth(i).boundingBox())!;
    if (!b || b.width === 0) continue;
    const cross = box.x < b.x + b.width && box.x + box.width > b.x && box.y < b.y + b.height && box.y + box.height > b.y;
    expect(cross, `«Чурбаки» do not cross ${await others.nth(i).getAttribute('data-testid') ?? await others.nth(i).getAttribute('class')}`).toBe(false);
  }
  await spot.click();
  await expect(page.getByTestId('warmup-choice')).toBeVisible();
  for (const id of ['warmup-line', 'warmup-mix', 'warmup-gap']) await expect(page.getByTestId(`warmup-pick-${id}`)).toBeVisible();
  await expect(page.getByTestId('warmup-pick-warmup-line')).toContainText('Строй');
  await expect(page.getByTestId('warmup-pick-warmup-mix')).toContainText('Пестрота');
  await expect(page.getByTestId('warmup-pick-warmup-gap')).toContainText('Через пропасть');
  await expect(page.getByTestId('warmup-best-warmup-line')).toHaveText('6 звеньев');
  await expect(page.getByTestId('warmup-best-warmup-mix')).toHaveText('14,2 с');
  await expect(page.getByTestId('warmup-best-warmup-gap')).toHaveText('—');
  await page.screenshot({ path: shot('51w-choice') });
  await page.getByTestId('warmup-back').click();
  await expect(page.getByTestId('warmup-choice')).toHaveCount(0);
  await expect(page.getByTestId('hearth')).toBeVisible();
  // Escape closes the choice too.
  await spot.click();
  await expect(page.getByTestId('warmup-choice')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('warmup-choice')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('«Строй»: label and exit, no tiles; a real chain; the end at the limit; the record, Ерофей\'s line, the profile; «Ещё раз» with an equal score is no record and no line, a better one is the second line; the score is the Node replay\'s', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openCamp(page);
  await startLayout(page, 'warmup-line');
  let s = await wm(page);
  expect(s.exitVisible).toBe(true);
  expect(s.tiles).toEqual({ jump: false, spin: false, items: [] });
  expect(s.label).toBe('20 с · цепь 0');
  await expect(page.getByTestId('hearth')).toBeHidden();
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.id)).toContain('warmup');
  await expect(page.getByTestId('warmup-exit')).toBeVisible();
  // The lean HUD: no energy and no focus bar on a layout with no jump or whirl.
  expect(await page.evaluate(() => ['.rt-energy', '.rt-focus'].map(q => { const el = document.querySelector(q); return !!el && getComputedStyle(el).display !== 'none'; }))).toEqual([false, false]);
  await dragArc(page, 4);
  await page.screenshot({ path: shot('51w-fight') });
  s = await untilResult(page, 24);
  expect(s.final.end).toBe('limit');
  expect(s.final.score).toBe(4);
  expect(s.exitVisible, 'the result panel has «В лагерь»; the corner «Выход» is gone').toBe(false);
  expect(s.panel).toMatchObject({ title: 'Строй', line: '4 звена', record: 'Новый рекорд!', isRecord: true, speaker: 'Ерофей', say: 'Ровно. Ещё раз — ровнее.' });
  await expect(page.getByTestId('warmup-score')).toHaveText('4 звена');
  await expect(page.getByTestId('warmup-say')).toContainText('Ерофей');
  await page.screenshot({ path: shot('51w-result') });
  expect(await bestOf(page, 'warmup-line')).toBe(4);
  expect((await profile(page)).meta.hearth.lines['smith:warmup_record']).toBe(1);
  // The score of the page is the one a Node replay of its journal reads at the first end (the same ticks, the same rules).
  const rec = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(rec.journal).hash()).toBe(rec.hash);
  let end: ReturnType<typeof warmupEnd> = null, score: number | null = null;
  replay(rec.journal, sim => { if (!end) { end = warmupEnd(sim.world, 'warmup-line'); if (end) score = warmupScore(sim.world, 'warmup-line', end); } });
  expect([end, score]).toEqual(['limit', 4]);
  // «Ещё раз»: a fresh attempt (the clock and the label at the start); the same chain again = the same score = no new record, no line.
  await page.getByTestId('warmup-again').click();
  s = await wm(page);
  expect(s.final).toBeNull();
  expect(s.panel.open).toBe(false);
  expect(s.label).toBe('20 с · цепь 0');
  await dragArc(page, 4);
  s = await untilResult(page, 24);
  expect(s.panel).toMatchObject({ line: '4 звена', record: 'Рекорд: 4 звена', isRecord: false, say: '' });
  await expect(page.getByTestId('warmup-say')).toBeHidden();
  expect((await profile(page)).meta.hearth.lines['smith:warmup_record'], 'no line for an equal score').toBe(1);
  // A better chain: a record and the line in turn (the second).
  await page.getByTestId('warmup-again').click();
  await dragArc(page, 6);
  s = await untilResult(page, 24);
  expect(s.final.score).toBe(6);
  expect(s.panel).toMatchObject({ line: '6 звеньев', record: 'Новый рекорд!', isRecord: true, say: 'Опять рекорд на «Чурбаках». Солома в клочья — значит, рука встала.' });
  expect(await bestOf(page, 'warmup-line')).toBe(6);
  expect((await profile(page)).meta.hearth.lines['smith:warmup_record']).toBe(2);
  // «В лагерь»: the camp, the record in the choice.
  await page.getByTestId('warmup-camp').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
  await expect(page.getByTestId('warmup-result')).toBeHidden();
  await page.getByTestId('hearth-warmup').click();
  await expect(page.getByTestId('warmup-best-warmup-line')).toHaveText('6 звеньев');
  expect(errors).toEqual([]);
});

test('a record without Ерофей at the fire is Неясыть\'s line', async ({ page }) => {
  test.setTimeout(90_000);
  await openCamp(page, metaOf(undefined, false));
  await startLayout(page, 'warmup-line');
  await dragArc(page, 3);
  const s = await untilResult(page, 24);
  expect(s.panel).toMatchObject({ record: 'Новый рекорд!', speaker: 'Неясыть', say: 'Новый рекорд на «Чурбаках». Записала мелко, на полях.' });
  expect((await profile(page)).meta.hearth.lines['owl:warmup_record']).toBe(1);
});

test('«Пестрота»: the label is the game time; «Выход» leaves with no result — the records stay, the telemetry says `exit`', async ({ page }) => {
  const errors = collectErrors(page);
  await openCamp(page, metaOf({ 'warmup-mix': { best: 14.2 } }));
  await startLayout(page, 'warmup-mix');
  await gameWait(page, 1.2);
  const s = await wm(page);
  expect(s.label).toMatch(/^\d+,\d с$/);
  expect(Number(s.label.replace(' с', '').replace(',', '.'))).toBeGreaterThan(0.9);
  expect(s.tiles).toEqual({ jump: false, spin: false, items: [] });
  await page.getByTestId('warmup-exit').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
  expect((await wm(page)).active).toBe(false);
  expect(await bestOf(page, 'warmup-mix'), 'the record stays').toBe(14.2);
  expect((await profile(page)).meta.hearth.lines['smith:warmup_record']).toBeUndefined();
  const records = await page.evaluate(() => (window as any).__realtime.telemetry?.records() ?? null) as RtRecord[] | null;
  expect(records, 'the telemetry records the attempt').not.toBeNull();
  const warm = records!.filter(r => r.kind === 'warmup') as any[];
  expect(warm.length).toBe(1);
  expect(warm[0]).toMatchObject({ layout: 'warmup-mix', end: 'exit', score: null, before: 14.2, record: false });
  // The camp is as it was: the choice shows the same record.
  await page.getByTestId('hearth-warmup').click();
  await expect(page.getByTestId('warmup-best-warmup-mix')).toHaveText('14,2 с');
  expect(errors).toEqual([]);
});

test('«Через пропасть»: the jump and the whirl tiles only; a death — «Погиб — без итога», no record; «Ещё раз» starts again at full HP', async ({ page }) => {
  const errors = collectErrors(page);
  await openCamp(page);
  await startLayout(page, 'warmup-gap');
  let s = await wm(page);
  expect(s.tiles).toEqual({ jump: true, spin: true, items: [] });
  expect(s.label).toBe('30 с · убито 0');
  expect(await page.evaluate(() => { const el = document.querySelector('.rt-energy'); return !!el && getComputedStyle(el).display !== 'none'; }), 'the energy shows where the jump and the whirl are').toBe(true);
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 99));
  s = await untilResult(page, 40);
  expect(s.final).toMatchObject({ end: 'death', score: null });
  expect(s.panel).toMatchObject({ title: 'Через пропасть', line: 'Погиб — без итога', isRecord: false, say: '' });
  expect(await bestOf(page, 'warmup-gap')).toBeUndefined();
  await page.screenshot({ path: shot('51w-death') });
  await page.getByTestId('warmup-again').click();
  s = await wm(page);
  expect(s.final).toBeNull();
  expect(s.panel.open).toBe(false);
  const w = await snap(page);
  expect(w.hero.hp).toBe(15);
  expect(w.arena).toBe('warmup-gap');
  expect(w.seed).toBe(51);
  expect(errors).toEqual([]);
});

test('the sandbox\'s arena menu has no warmup layout and no «Чурбаки»', async ({ page }) => {
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Чурбаки');
  expect(text).not.toContain('Через пропасть');
  expect(text).not.toContain('Пестрота');
  await expect(page.getByTestId('hearth-warmup')).toHaveCount(0);
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[data-summary]')).length);
  expect(ids).toBeGreaterThan(5);
});
