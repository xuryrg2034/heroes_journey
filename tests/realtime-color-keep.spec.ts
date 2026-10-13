import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';

/**
 * Task 10 «Свобода цвета держится», the view (design 13.10.2026): with `colorShiftKeep` the rainbow ring stands on the LAST enemy
 * link while the colour stays free and moves with the chain's end; the link that freed the colour keeps a small rainbow mark; the
 * shift sounds once per freeing link (the 6th, the 12th), a step back onto an earlier shift is silent. Real mouse input in the
 * sandbox (the rule's keys set on the panel, as a tester would).
 */

type Shift = { left: number | null; rainbow: number; mark: number; freedBy: number; sounds: number };
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

/** The sandbox, arena 1, still enemies; the hero at (2.6, 3); 13 weak enemies of colour 0 in a snake of two rows (0.8 apart). */
async function setup(page: Page, errors: string[], keep: boolean): Promise<{ at: { x: number; y: number }[]; ids: number[] }> {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=1&seed=77');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  return page.evaluate(keep => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['crystals', false], ['colorShiftLinks', 6], ['colorShiftKeep', keep], ['hitstop', false]] as const) rt.setParam(k, v);
    rt.clear(false);
    rt.teleport(4.2, 3.6);
    const pts: [number, number][] = [];
    for (let i = 0; i < 7; i++) pts.push([5 + 0.8 * i, 3.6]);
    for (let i = 0; i < 6; i++) pts.push([9.8 - 0.8 * i, 4.5]);
    const at = pts.map(([x, y]) => { rt.place(x, y, 0, 0, 'basic'); return rt.toScreen(x, y) as { x: number; y: number }; });
    return { at, ids: rt.snapshot().enemies.map((e: { id: number }) => e.id) as number[] };
  }, keep);
}

/** Moves the pointer to link `i` (0-based) and waits for the drawn chain to have `n` links; returns the colour shift reading. */
async function to(page: Page, at: { x: number; y: number }[], i: number, n: number): Promise<Shift> {
  await page.mouse.move(at[i].x, at[i].y, { steps: 2 });
  await expect.poll(async () => (await snap(page)).chain.length).toBe(n);
  // The view draws the frame after the sim took the link.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return (await snap(page)).colorShift as Shift;
}

test('task 10 view: with the colour kept free the ring rides the chain end, the 6th keeps a small mark; a shift sounds once per freeing link', async ({ page }) => {
  const errors: string[] = [];
  const { at, ids } = await setup(page, errors, true);
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (let i = 1; i < 5; i++) await to(page, at, i, i + 1);
  const sixth = await to(page, at, 5, 6);
  expect(sixth).toMatchObject({ left: 0, rainbow: ids[5], mark: 0, freedBy: ids[5], sounds: 1 });
  expect(await to(page, at, 6, 7)).toMatchObject({ left: 0, rainbow: ids[6], mark: ids[5], sounds: 1 });
  expect(await to(page, at, 7, 8)).toMatchObject({ left: 0, rainbow: ids[7], mark: ids[5], sounds: 1 });
  await page.screenshot({ path: 'artifacts/realtime-color-keep-8.png' });
  for (let i = 8; i < 11; i++) await to(page, at, i, i + 1);
  // The 12th frees the colour again: its own shift sounds; the mark moves to it (it is the ring's link — no separate mark).
  expect(await to(page, at, 11, 12)).toMatchObject({ left: 0, rainbow: ids[11], mark: 0, freedBy: ids[11], sounds: 2 });
  // A step back to 11 links (the pointer on the 11th): the 6th frees again — heard already, silent; the ring on the 11th, the mark on the 6th.
  expect(await to(page, at, 10, 11)).toMatchObject({ left: 0, rainbow: ids[10], mark: ids[5], freedBy: ids[5], sounds: 2 });
  // The 12th taken again: it left the chain, so it is a new shift — it sounds (as the 6th after a step back below it).
  expect(await to(page, at, 11, 12)).toMatchObject({ freedBy: ids[11], sounds: 3 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 10 view: without the key the ring stays on the 6th (no mark); a 7th of the same colour starts a new segment and the ring goes', async ({ page }) => {
  const errors: string[] = [];
  const { at, ids } = await setup(page, errors, false);
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (let i = 1; i < 5; i++) await to(page, at, i, i + 1);
  expect(await to(page, at, 5, 6)).toMatchObject({ left: 0, rainbow: ids[5], mark: 0, sounds: 1 });
  // The 7th of the same colour opens a new segment of that colour (the old rule): the ring goes, the count starts again.
  const seventh = await to(page, at, 6, 7);
  expect(seventh).toMatchObject({ rainbow: 0, mark: 0 });
  expect(seventh.left).toBeGreaterThan(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 10 view (review): 6 blue (the shift sounds), a red 7th, a step back to the 6th — silent; back below the 6th and the 6th again — it sounds again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=1&seed=77');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  const { at, ids } = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['crystals', false], ['colorShiftLinks', 6], ['colorShiftKeep', true], ['hitstop', false]] as const) rt.setParam(k, v);
    rt.clear(false);
    rt.teleport(4.2, 3.6);
    const at = [];
    for (let i = 0; i < 7; i++) { const x = 5 + 0.8 * i; rt.place(x, 3.6, i < 6 ? 0 : 1, 0, 'basic'); at.push(rt.toScreen(x, 3.6)); }
    return { at, ids: rt.snapshot().enemies.map((e: { id: number }) => e.id) as number[] };
  });
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (let i = 1; i < 5; i++) await to(page, at, i, i + 1);
  expect(await to(page, at, 5, 6)).toMatchObject({ left: 0, freedBy: ids[5], sounds: 1 });
  // The red 7th: the colour is taken, the count starts again — no ring.
  expect(await to(page, at, 6, 7)).toMatchObject({ rainbow: 0, sounds: 1 });
  // Back to the 6th (the pointer on it): the colour is free again — the 6th was heard, silent.
  expect(await to(page, at, 5, 6)).toMatchObject({ left: 0, rainbow: ids[5], sounds: 1 });
  // Back to the 5th, then the 6th again: a new shift, it sounds.
  await to(page, at, 4, 5);
  expect(await to(page, at, 5, 6)).toMatchObject({ freedBy: ids[5], sounds: 2 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});
