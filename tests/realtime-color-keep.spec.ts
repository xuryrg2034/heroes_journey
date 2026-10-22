import { type Page } from '@playwright/test';
import { test, expect, takeStartGift } from './realtimeTest';
import { untilFrame } from './realtimeFrames';

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

test('task 34 (user 15.10.2026): in a run, 6 blue free the colour; a quick swipe through a mixed crowd keeps the chain blue; the pointer stopping on a red takes it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await takeStartGift(page);
  const node = page.locator('[data-status="available"]').first();
  await node.click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  // The run's own rule (no panel): the shift at 6, the colour kept free, another colour only at the pointer.
  expect(await page.evaluate(() => { const p = (window as any).__realtime.params; return [p.colorShiftLinks, p.colorShiftKeep, p.shiftAtPointer]; })).toEqual([6, true, true]);
  // Only the test's enemies, standing still: 6 blue in a row from the hero, then a red, a green beside it, a blue, and a red past it.
  const at = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['boarMax', 0], ['contactDamage', 0], ['hitstop', false]] as const) rt.setParam(k, v);
    rt.clear(false);
    const h = rt.snapshot().hero;
    const spots: [number, number, number][] = [[0.8, 0, 0], [1.6, 0, 0], [2.4, 0, 0], [3.2, 0, 0], [4.0, 0, 0], [4.8, 0, 0], [5.6, 0, 1], [5.6, 0.45, 2], [6.4, 0, 0], [7.2, 0, 1]];
    return spots.map(([dx, dy, color]) => ({ id: rt.place(h.x + dx, h.y + dy, color, 0, 'basic') as number, color, ...rt.toScreen(h.x + dx, h.y + dy) as { x: number; y: number } }));
  });
  const chain = async (): Promise<number[]> => (await snap(page)).chain as number[];
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (let i = 1; i < 6; i++) {
    await page.mouse.move(at[i].x, at[i].y, { steps: 2 });
    await expect.poll(async () => (await chain()).length).toBe(i + 1);
  }
  expect((await snap(page)).colorShift.left).toBe(0);
  // One quick move (a single pointer event) from the 6th to the blue past the red and the green: the swipe takes only the blue.
  await page.mouse.move(at[8].x, at[8].y, { steps: 1 });
  await expect.poll(async () => (await chain()).length).toBe(7);
  expect(await chain()).toEqual([...at.slice(0, 6), at[8]].map(e => e.id));
  // The pointer stops on the red: it joins, the chain's colour is red.
  await page.mouse.move(at[9].x, at[9].y, { steps: 1 });
  await expect.poll(async () => (await chain()).length).toBe(8);
  expect((await chain()).at(-1)).toBe(at[9].id);
  await page.screenshot({ path: 'artifacts/realtime-shift-pointer.png' });
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 39 (log analysis 15.10.2026): the held still pointer resting by the 3rd link next to another enemy takes nothing for 1 s; moved onto the enemy — it joins', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=1&seed=77');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  expect(await page.evaluate(() => (window as any).__realtime.params.holdNearest)).toBe(true);
  const { at, ids, rest } = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['hitstop', false]] as const) rt.setParam(k, v);
    rt.clear(false);
    rt.teleport(4.2, 3.6);
    const spots: [number, number][] = [[5, 3.6], [6, 3.6], [7, 3.6], [7.6, 4.05]];
    const at = spots.map(([x, y]) => { rt.place(x, y, 0, 0, 'basic'); return rt.toScreen(x, y) as { x: number; y: number }; });
    // The resting point: off the 3rd link's centre toward the 4th — the link is nearer, the 4th within its press circle.
    const rest = rt.toScreen(7 + 0.6 * 0.3, 3.6 + 0.45 * 0.3) as { x: number; y: number };
    return { at, ids: rt.snapshot().enemies.map((e: { id: number }) => e.id) as number[], rest };
  });
  const chain = async (): Promise<number[]> => (await snap(page)).chain as number[];
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (let i = 1; i < 3; i++) {
    await page.mouse.move(at[i].x, at[i].y, { steps: 2 });
    await expect.poll(async () => (await chain()).length).toBe(i + 1);
  }
  await page.mouse.move(rest.x, rest.y, { steps: 2 });
  // Hold still 1 s of real time (the held pointer is re-checked every frame).
  await page.waitForTimeout(1000);
  expect(await chain()).toEqual(ids.slice(0, 3));
  await page.mouse.move(at[3].x, at[3].y, { steps: 2 });
  await expect.poll(async () => (await chain()).length).toBe(4);
  expect((await chain()).at(-1)).toBe(ids[3]);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('task 42 (log analysis 16.10.2026): a press on an enemy touching the hero, the pointer slid onto the hero and held 1 s with a hair of movement — the chain is empty in every frame; back on the enemy — it is taken', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=1&seed=77');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  expect(await page.evaluate(() => (window as any).__realtime.params.holdHeroLink)).toBe(true);
  const { body, id, onHero } = await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of [['maxEnemies', 0], ['enemySpeed', 0], ['wolfSpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['hitstop', false]] as const) rt.setParam(k, v);
    rt.clear(false);
    rt.teleport(4.2, 3.6);
    // An enemy touching the hero (0.62 off its centre); the hero point: in the hero's circle (0.28 < 0.42), in the enemy's press circle.
    rt.place(4.82, 3.6, 0, 0, 'basic');
    return { body: rt.toScreen(4.82, 3.6) as { x: number; y: number }, id: rt.snapshot().enemies[0].id as number, onHero: rt.toScreen(4.48, 3.6) as { x: number; y: number } };
  });
  const chain = async (): Promise<number[]> => (await snap(page)).chain as number[];
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await expect.poll(chain).toEqual([id]);
  await page.mouse.move(onHero.x, onHero.y, { steps: 2 });
  await expect.poll(async () => (await chain()).length).toBe(0);
  // 1 s of game time read every frame in the page, while the hand trembles a pixel on the hero (pointer events in the same spot).
  const watch = untilFrame(page, (s, _arg: null, late) => {
    const st = (window as any).__heroHold ??= { frames: 0, taken: 0 };
    st.frames++; if (s.chain.length) st.taken++;
    return late ? { frames: st.frames as number, taken: st.taken as number } : undefined;
  }, null, 1);
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(onHero.x + (i % 2 ? 1 : -1), onHero.y + (i % 3 === 0 ? 1 : 0));
    await page.waitForTimeout(80);
  }
  const held = await watch;
  expect(held.frames).toBeGreaterThan(20);
  expect(held.taken).toBe(0);
  expect(await chain()).toEqual([]);
  await page.mouse.move(body.x, body.y, { steps: 2 });
  await expect.poll(chain).toEqual([id]);
  await page.mouse.up();
  expect(errors).toEqual([]);
});
