import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';

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
  await place(page, 9.5, 5.5, 0, 0); await place(page, 11, 5.5, 0, 0); await place(page, 11, 4, 0, 0);
  await drag(page, [[9.5, 5.5], [11, 5.5], [11, 4]]);
  await expect.poll(async () => (await snap(page)).forms.frostPreview).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-forms-frost-plan.png' });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).forms.frostPoints, { timeout: 4_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-forms-frost.png' });
  expect(errors).toEqual([]);
});

test('task 29: «Возврат» — the way back in the chain\'s colour with arrows and its hits before the release; the run along it after', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await withBuild(page, { hammer: 'return-pass' });
  // Three weak links, and a tough enemy of another colour on the way back (the run strikes it).
  await place(page, 9.5, 5.5, 0, 0); await place(page, 11, 5.5, 0, 0); await place(page, 11, 4, 0, 0);
  await place(page, 10.25, 5.5, 1, 3);
  await drag(page, [[9.5, 5.5], [11, 5.5], [11, 4]]);
  await expect.poll(async () => (await snap(page)).forms.returnArrows).toBeGreaterThan(0);
  expect((await snap(page)).forms.returnHits).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-forms-return-plan.png' });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).forms.returnRun, { timeout: 4_000, intervals: [30] }).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-forms-return-run.png' });
  expect(errors).toEqual([]);
});
