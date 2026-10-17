import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait } from './realtimeFrames';

/**
 * Task 29 «Формы в песочнице» (design 15.10.2026, docs/design-notes/tasks-29-30.md): the view of the forms in the sandbox — the
 * menu by fields, the icon's flight to the column, «Печать» as a talisman, the highlight of «Развилка», «Чужак», «Близнецы», the
 * trail of «Наледь», the run back of «Возврат». Real input: the chain is drawn with the mouse, the menu is clicked. Runs through
 * playwright.realtime.config.ts only; the rules are checked in Node (core's suites of task 29).
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page): Promise<void> {
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

/** The build by the page's hook (the arena restarts with it), then quiet: only what the test places acts; the hero at (8, 5.5). */
async function withBuild(page: Page, build: { talismans?: string[]; hammer?: string }): Promise<void> {
  await page.evaluate(b => (window as any).__realtime.useBuild(b), build);
  await quiet(page);
}
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5.5);
  });
}

/** Press on the first arena point and drag through the rest. */
async function drag(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const at = await Promise.all(points.map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 5 });
}

test('task 29: the menu lists the forms by field; «Печать» taken there flies to the column at the fight start and closes the ring with the loop toggle off — the release strikes inside', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await page.evaluate(() => (window as any).__realtime.setParam('loopEnabled', false));
  await page.getByTestId('open-panel').click();
  const end = page.getByTestId('build-form-end');
  await expect(end.locator('option')).toHaveText(['нет', 'Печать', 'Прямая']);
  await expect(page.getByTestId('build-form-link').locator('option')).toHaveText(['нет', 'Развилка', 'Чужак', 'Близнецы', 'Якорь у героя']);
  await expect(page.getByTestId('build-form-path').locator('option')).toHaveText(['нет', 'Наледь']);
  await expect(page.getByTestId('build-hammer').locator('option', { hasText: 'Возврат' })).toHaveText('Возврат · путь');
  await end.selectOption('form-seal');
  await page.locator('.rt-close').first().click();
  // The next fight takes it: its icon flies from the hero to its row, the row flashes.
  await page.evaluate(() => (window as any).__realtime.restart());
  await expect.poll(async () => (await snap(page)).kit?.talismans ?? []).toContain('form-seal');
  await expect.poll(async () => (await snap(page)).forms.flying).toContain('form-seal');
  // The flight runs in real time (the Web Animations of the column): the snapshot while the icon holds over the hero.
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/realtime-forms-flight.png' });
  await expect.poll(async () => (await snap(page)).forms.flying, { timeout: 4_000 }).toEqual([]);
  expect((await snap(page)).forms.arrivals).toBe(1);
  await expect(page.getByTestId('build-form-seal').locator('svg')).toHaveCount(1);

  await quiet(page);
  const corners = [await place(page, 9.2, 4.7, 0, 1), await place(page, 10.8, 4.7, 0, 1), await place(page, 10.8, 6.3, 0, 1), await place(page, 9.2, 6.3, 0, 1)];
  const inner = await place(page, 10, 5.5, 1, 3);
  await drag(page, [[9.2, 4.7], [10.8, 4.7], [10.8, 6.3], [9.2, 6.3], [9.2, 4.7]]);
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('first');
  expect((await snap(page)).chain).toEqual(corners);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).enemies.find((e: any) => e.id === inner)?.hp, { timeout: 8_000 }).toBe(2);
  expect(errors).toEqual([]);
});

test('task 29: «Развилка» — the reach rings at the links, a Y at the enemy reachable only from a link that is not the last; the chain takes it from there', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { talismans: ['form-fork'] });
  const a1 = await place(page, 9.5, 5.5, 0, 0), a2 = await place(page, 11.5, 5.5, 0, 0), a3 = await place(page, 10, 3.5, 0, 0);
  await drag(page, [[9.5, 5.5], [11.5, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, a2]);
  await expect.poll(async () => (await snap(page)).forms.forkMarks).toBe(1);
  expect((await snap(page)).forms.forkRings).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/realtime-forms-fork.png' });
  const at = await screen(page, 10, 3.5);
  await page.mouse.move(at.x, at.y, { steps: 5 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, a2, a3]);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 29: «Чужак» — a candidate of another colour gets a dashed ring of its colour while the rule is not spent; taken, the rings go', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { talismans: ['form-alien'] });
  const a1 = await place(page, 9.5, 5.5, 0, 0), b1 = await place(page, 11, 5.5, 1, 0);
  await place(page, 9.5, 7, 2, 0);
  await drag(page, [[9.5, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1]);
  await expect.poll(async () => (await snap(page)).forms.alienRings).toBe(2);
  await page.screenshot({ path: 'artifacts/realtime-forms-alien.png' });
  const at = await screen(page, 11, 5.5);
  await page.mouse.move(at.x, at.y, { steps: 5 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, b1]);
  await expect.poll(async () => (await snap(page)).forms.alienRings).toBe(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 29: «Близнецы» — a chain through the two colours of a pair is drawn in dashes of both', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { talismans: ['form-twins'] });
  const a1 = await place(page, 9.5, 5.5, 0, 0), a2 = await place(page, 11, 5.5, 2, 0);
  await drag(page, [[9.5, 5.5], [11, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, a2]);
  expect((await snap(page)).forms.twinLine).toBe(1);
  // The pair's other colour is the chain's colour: not muted (`sameColor`).
  expect((await snap(page)).colorShift.dimmed).toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-forms-twins.png' });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 29: without «Наледь» no cold is promised; with it — faint rings where the dash will leave the cold, then the trail on the arena fading', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await quiet(page);
  await place(page, 9.5, 5.5, 0, 0); await place(page, 11, 5.5, 0, 0);
  await drag(page, [[9.5, 5.5], [11, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(2);
  expect((await snap(page)).forms.frostPreview).toBe(0);
  await page.mouse.up();
  await withBuild(page, { talismans: ['frost-pass'] });
  const links = [await place(page, 9.5, 5.5, 0, 0), await place(page, 11, 5.5, 0, 0), await place(page, 11, 4, 0, 0)];
  // A tough enemy of another colour stands on the path (not a link): the trail freezes it.
  const bystander = await place(page, 10.25, 5.5, 1, 3);
  await drag(page, [[9.5, 5.5], [11, 5.5], [11, 4]]);
  await expect.poll(async () => (await snap(page)).forms.frostPreview).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-forms-frost-plan.png' });
  await page.mouse.up();
  // After the dash: the links are dead, the trail lies along the whole path, the bystander is frozen in it.
  await expect.poll(async () => { const s = await snap(page); return !s.moving && links.every(id => !s.enemies.some((e: any) => e.id === id)); }, { timeout: 5_000, intervals: [30] }).toBe(true);
  await expect.poll(async () => (await snap(page)).enemies.find((e: any) => e.id === bystander)?.chill ?? 0, { timeout: 3_000, intervals: [30] }).toBeGreaterThan(0);
  expect((await snap(page)).forms.frostPoints).toBeGreaterThanOrEqual(6);
  await page.screenshot({ path: 'artifacts/realtime-forms-frost.png' });
  expect(errors).toEqual([]);
});

test('task 29: «Возврат» — the way back in the chain\'s colour with arrows and its hits before the release; the run along it after', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { hammer: 'return-pass' });
  // Three weak links, and a tough enemy of another colour on the way back (the run strikes it).
  const links = [await place(page, 9.5, 5.5, 0, 0), await place(page, 11, 5.5, 0, 0), await place(page, 11, 4, 0, 0)];
  await place(page, 10.25, 5.5, 1, 3);
  await drag(page, [[9.5, 5.5], [11, 5.5], [11, 4]]);
  await expect.poll(async () => (await snap(page)).forms.returnArrows).toBeGreaterThan(0);
  expect((await snap(page)).forms.returnHits).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-forms-return-plan.png' });
  await page.mouse.up();
  // The run back: the first pass is over (its links are dead), the hero runs along the fixed way.
  await expect.poll(async () => { const s = await snap(page); return s.forms.returnRun === 1 && links.every(id => !s.enemies.some((e: any) => e.id === id)); }, { timeout: 4_000, intervals: [30] }).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-forms-return-run.png' });
  expect(errors).toEqual([]);
});

/**
 * Task 33 «Цена „Близнецов“ и „Развилки“» (design 15.10.2026, docs/design-notes/tasks-29-30.md, «ЗАДАЧА 33»; the sandbox keys
 * `twinsAlternate`, `twinsNoShift`, `forkBranches` 1 on by default). Real input: the chain is drawn with the mouse.
 */
test('task 33: «Близнецы» alternate — after A-Б the line shows the next colour A; a second Б is refused, an A joins; no «Смена цвета» with the pair', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { talismans: ['form-twins'] });
  await page.evaluate(() => (window as any).__realtime.setParam('colorShiftLinks', 6));
  const a1 = await place(page, 9.5, 5.5, 0, 0), b1 = await place(page, 11, 5.5, 2, 0);
  await place(page, 12.5, 5.5, 2, 0);
  const a2 = await place(page, 11, 4, 0, 0);
  // «Близнецы» turn the rainbow off: no «до смены N».
  expect((await snap(page)).colorShift.every).toBe(0);
  await drag(page, [[9.5, 5.5], [11, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, b1]);
  // Both colours taken: the next link must be A (colour 0) — the tail, the reach ring and the bead in it.
  await expect.poll(async () => (await snap(page)).forms.twinNext).toBe(0);
  expect((await snap(page)).forms.twinLine).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-forms-twins-next.png' });
  // A second Б: refused, the chain stays.
  const b2at = await screen(page, 12.5, 5.5);
  await page.mouse.move(b2at.x, b2at.y, { steps: 5 });
  await gameWait(page, 0.2);
  expect((await snap(page)).chain).toEqual([a1, b1]);
  // An A: joins; the next colour is Б again.
  const a2at = await screen(page, 11, 4);
  await page.mouse.move(a2at.x, a2at.y, { steps: 8 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, b1, a2]);
  await expect.poll(async () => (await snap(page)).forms.twinNext).toBe(2);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 33: «Развилка» — one fork a chain: before it the reach rings at the older links; after it they go, and a second fork is refused', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { talismans: ['form-fork'] });
  // a3 — from a1 only (1.9 from it, 2.8 from a2); a4 — from a2 only (1.9 from it, 2.8 from a1, far from a3): a second fork.
  const a1 = await place(page, 9.5, 5.5, 0, 0), a2 = await place(page, 11.3, 5.5, 0, 0), a3 = await place(page, 9.3, 3.6, 0, 0);
  await place(page, 11.5, 7.4, 0, 0);
  await drag(page, [[9.5, 5.5], [11.3, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, a2]);
  await expect.poll(async () => (await snap(page)).forms.forkRings).toBe(1);
  expect((await snap(page)).forms.forkMarks).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-forms-fork-before.png' });
  // The fork: a3 from a1.
  const a3at = await screen(page, 9.3, 3.6);
  await page.mouse.move(a3at.x, a3at.y, { steps: 5 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, a2, a3]);
  expect((await snap(page)).forms.forks).toBe(1);
  // Where the branch came from: a pale dashed stroke from a1 to a3 over the dash's line.
  expect((await snap(page)).forms.forkBranch).toBe(1);
  await expect.poll(async () => (await snap(page)).forms.forkRings).toBe(0);
  expect((await snap(page)).forms.forkMarks).toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-forms-fork-after.png' });
  // A second fork (a4 from a2): refused. The pointer goes round a2 (the link before the last: over it the chain steps back).
  for (const [x, y] of [[12.8, 3.6], [12.8, 7.4], [11.5, 7.4]] as const) { const at = await screen(page, x, y); await page.mouse.move(at.x, at.y, { steps: 6 }); }
  await gameWait(page, 0.2);
  expect((await snap(page)).chain).toEqual([a1, a2, a3]);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

/**
 * Task 52 «Числа», Р2 (docs/design-notes/task-52-numbers.md, 3.5; `Params.forkDwell`, the sandbox's panel «Талисманы»): «Развилка» with the
 * dwell gesture. Real input: the chain is drawn with the mouse; the pointer rests on the older link, then goes to the body beside it.
 */
test('task 52: «Развилка» with the dwell — the body beside an older link is refused until the pointer rests on that link 0,25 s; then it joins from it (a fork)', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { talismans: ['form-fork'] });
  await page.evaluate(() => (window as any).__realtime.setParam('forkDwell', 0.25));
  // a1, a2, a3 in a row; d — within R of a1 only (1.9 from it, 2.8 from a2, far from a3).
  const a1 = await place(page, 9.5, 5.5, 0, 0), a2 = await place(page, 11.3, 5.5, 0, 0), a3 = await place(page, 13.1, 5.5, 0, 0), d = await place(page, 9.3, 3.6, 0, 0);
  await drag(page, [[9.5, 5.5], [11.3, 5.5], [13.1, 5.5]]);
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, a2, a3]);
  // Straight to d (round a2: over it the chain steps back): refused — the anchor is the last link.
  for (const [x, y] of [[13.1, 3.6], [9.3, 3.6]] as const) { const at = await screen(page, x, y); await page.mouse.move(at.x, at.y, { steps: 8 }); }
  await gameWait(page, 0.2);
  expect((await snap(page)).chain).toEqual([a1, a2, a3]);
  // Rest on a1 for more than 0,25 s of game time, then back to d: it joins from a1.
  const a1at = await screen(page, 9.5, 5.5);
  await page.mouse.move(a1at.x, a1at.y, { steps: 4 });
  await gameWait(page, 0.4);
  const dat = await screen(page, 9.3, 3.6);
  await page.mouse.move(dat.x, dat.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a1, a2, a3, d]);
  expect((await snap(page)).forms.forks).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-forms-fork-dwell.png' });
  await page.mouse.up();
  expect(errors).toEqual([]);
});
