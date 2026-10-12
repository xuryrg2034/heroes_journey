import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';

/**
 * The view of «Прямая», the barbarian's pierce (docs/realtime-prototype.md, «Прямая»; loop research step 3), in the sandbox:
 * the panel toggle; with real mouse input a straight chain of 3 shows the arrow, the end mark and the outcome marks over the
 * corridor bodies, and the dash kills them; a bent tail shows none. Runs through playwright.realtime.config.ts only. The
 * rules (highlight = dash) are checked in Node (`npm run test:realtime-pierce`); this test looks at what the player sees.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The sandbox, quiet (only what the test places acts); the hero at (8, 5.5). The pierce stays as the caller set it. */
async function openQuiet(page: Page, extra: [string, unknown][] = []): Promise<void> {
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.evaluate(params => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ...params] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5.5);
  }, extra);
}
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

/** Three weak red links straight to the right of the hero; two bodies of other colours in the corridor ahead. */
const LINKS: [number, number][] = [[9.2, 5.5], [10.4, 5.5], [11.6, 5.5]];
async function line(page: Page): Promise<{ links: number[]; bodies: number[] }> {
  const links = [];
  for (const [x, y] of LINKS) links.push(await place(page, x, y, 0, 0));
  return { links, bodies: [await place(page, 12.4, 5.65, 1, 0), await place(page, 13.1, 5.35, 2, 2)] };
}
async function drawThrough(page: Page, points: [number, number][]): Promise<void> {
  const at = await Promise.all(points.map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 });
}

test('«Прямая»: the panel toggle; a straight chain of 3 shows the arrow, the end and the corridor marks; the dash kills the corridor', async ({ page }) => {
  const errors = collectErrors(page);
  await openQuiet(page);
  // The panel's flag (group «Прямая»): off by default, the checkbox turns it on.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  const box = page.locator('[data-param="pierceEnabled"] input');
  await expect(box).not.toBeChecked();
  await box.check();
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.params.pierceEnabled)).toBe(true);

  const { links, bodies } = await line(page);
  await drawThrough(page, LINKS);
  await expect.poll(async () => (await snap(page)).chain).toEqual(links);
  await expect.poll(async () => (await snap(page)).pierce.shown).toMatchObject({ arrow: 1, end: 1, marks: 2 });
  const plan = (await snap(page)).pierce.plan;
  expect(plan.bodies).toEqual([{ id: bodies[0], killed: true }, { id: bodies[1], killed: true }]);
  // The 1280×720 picture of the arrow, the end mark and the corridor marks (looked at by the developer).
  await page.screenshot({ path: 'artifacts/realtime-pierce-arrow.png' });
  await page.mouse.up();
  // The dash runs on past the last link: both corridor bodies die, the hero stops at the arrow's end.
  await expect.poll(async () => (await snap(page)).enemies.filter((e: any) => bodies.includes(e.id)).length, { timeout: 8000 }).toBe(0);
  await expect.poll(async () => (await snap(page)).pierce.shown.ends, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  const hero = (await snap(page)).hero;
  expect(Math.abs(hero.x - plan.to.x)).toBeLessThan(0.05);
  expect(Math.abs(hero.y - plan.to.y)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test('«Прямая»: a bent tail shows no arrow; off (the default) the same straight chain shows none', async ({ page }) => {
  const errors = collectErrors(page);
  await openQuiet(page, [['pierceEnabled', true]]);
  // A 40° bend at the second link.
  const bent: [number, number][] = [[9.2, 5.5], [10.4, 5.5], [11.32, 6.27]];
  for (const [x, y] of bent) await place(page, x, y, 0, 0);
  await place(page, 12.2, 6.9, 1, 0);
  await drawThrough(page, bent);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(3);
  expect((await snap(page)).pierce.plan).toBeNull();
  expect((await snap(page)).pierce.shown).toMatchObject({ arrow: 0, end: 0, marks: 0 });
  await page.mouse.up();

  await openQuiet(page);
  expect(await page.evaluate(() => (window as any).__realtime.params.pierceEnabled)).toBe(false);
  const { links } = await line(page);
  await drawThrough(page, LINKS);
  await expect.poll(async () => (await snap(page)).chain).toEqual(links);
  expect((await snap(page)).pierce.plan).toBeNull();
  expect((await snap(page)).pierce.shown).toMatchObject({ arrow: 0, end: 0, marks: 0 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});
