import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { untilFrame } from './realtimeFrames';

/**
 * Task 14 «Котомка у двери», the view (design 13.10.2026; view/bagView.ts, docs/realtime-slice.md) at 1280×720 by real input:
 * the sandbox with «Котомка у двери» on — no sack before the goals; after them a sack beside the door, «0/10 · +1», three marks;
 * real chains drawn with the mouse fill it («4/10 · +1»; the 10th kill fills step 1: the flash, «10/20 · +2»); a touch that
 * takes HP sends the step back (the mark dims, «сброс»); walking into the door, the result screen says «Котомка: +1 — 1 <kind>».
 * The run: row 1's door has no sack; a row-2 fight has it and the door's payout reaches the run's materials (main.ts
 * `recordRunArena`). The numbers are the sim's (`snapshot().bag`); the drawing — `snapshot().bagView`.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** Waits for the frame the view drew `label` over the sack (or returns the last reading after `seconds` of game time). */
const labelShown = (page: Page, label: string, seconds = 3): Promise<any> =>
  untilFrame(page, (s: any, want: string, late: boolean) => (s.bagView.label === want || late ? s : undefined), label, seconds);

/**
 * A real chain: `n` weak enemies of one colour in a row from the hero away from the door (1.3 apart), drawn with the mouse
 * through each, released; waits for the dash to end.
 */
async function chain(page: Page, hero: { x: number; y: number }, dir: number, n: number): Promise<void> {
  // The field is cleared first: the greed stage may have brought a newcomer of the same colour next to the row.
  await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; rt.clear(false); rt.teleport(x, y); }, [hero.x, hero.y] as const);
  const points = Array.from({ length: n }, (_, i) => ({ x: hero.x + dir * 1.3 * (i + 1), y: hero.y }));
  await page.evaluate(ps => { for (const p of ps) (window as any).__realtime.place(p.x, p.y, 0, 0, 'basic'); }, points);
  await untilFrame(page, (_s: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.2);
  const at = await screen(page, points[0].x, points[0].y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (const p of points.slice(1)) { const q = await screen(page, p.x, p.y); await page.mouse.move(q.x, q.y, { steps: 4 }); }
  expect((await snap(page)).chain.length, 'the drawn chain').toBe(n);
  await page.mouse.up();
  expect(await untilFrame(page, (s: any, _a: null, late: boolean) => (s.moving === null && s.time > 0 ? true : late ? s.moving : undefined), null, 10)).toBe(true);
}

test('the bag in the sandbox: no sack before the goals; after them a sack by the door «0/10 · +1»; real chains fill it, the 10th kill flashes step 1; a touch resets the step; the door pays «Котомка: +1»', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1&arena=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of Object.entries({ enemySpeed: 0, wolfSpeed: 0, speedSpread: 0, contactDamage: 0, baseIntervalMin: 1000, baseIntervalMax: 1000, baseFloor: 0, reaperEnabled: false, doorBag: true })) rt.setParam(k, v);
    rt.clear(false);
  });
  let s = await snap(page);
  expect(s.bag).toBeNull();
  expect(s.bagView.visible).toBe(false);
  // The goals (setup): the sack appears beside the door, on the arena's side.
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  s = await labelShown(page, '0/10 · +1');
  expect(s.bagView).toMatchObject({ visible: true, label: '0/10 · +1', marks: ['filling', 'empty', 'empty'] });
  const door = s.objects.find((o: any) => o.kind === 'door'), dir = Math.sign(s.bagView.x - door.x);
  expect(Math.abs(s.bagView.x - door.x)).toBeCloseTo(1.5, 5);
  // The hero stands a little past the sack (the camera shows the door, the sack and the chain).
  const hero = { x: s.bagView.x + dir * 1.5, y: door.y };
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [hero.x, hero.y] as const);
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.6);
  await page.mouse.move(640, 700);
  await page.screenshot({ path: 'artifacts/realtime-bag-empty.png' });
  // Real chains: 4 kills — «4/10 · +1»; 3 and 3 more — step 1 fills: the flash, «+1», «10/20 · +2».
  await chain(page, hero, dir, 4);
  s = await labelShown(page, '4/10 · +1');
  expect(s.bag).toMatchObject({ step: 0, kills: 4 });
  expect(s.bagView.label).toBe('4/10 · +1');
  await chain(page, hero, dir, 3);
  await chain(page, hero, dir, 3);
  s = await labelShown(page, '10/20 · +2');
  expect(s.bag).toMatchObject({ step: 1, kills: 10, total: 1 });
  expect(s.bagView).toMatchObject({ label: '10/20 · +2', marks: ['full', 'filling', 'empty'], steps: 1 });
  await page.mouse.move(640, 700);
  await page.screenshot({ path: 'artifacts/realtime-bag-step.png' });
  // Two more, then a touch that takes HP (an enemy put where the hero stands after the dash): the step goes back to 10, the mark dims a moment; the filled step stays.
  await chain(page, hero, dir, 2);
  s = await labelShown(page, '12/20 · +2');
  expect(s.bagView.label).toBe('12/20 · +2');
  const hp = s.hero.hp;
  await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 1); rt.place(x, y, 1, 0, 'basic'); }, [s.hero.x, s.hero.y] as const);
  s = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.bagView.resets > 0 || late ? q : undefined), null, 5);
  expect(s.hero.hp).toBeLessThan(hp);
  expect(s.bag).toMatchObject({ step: 1, kills: 10, resets: 1 });
  expect(s.bagView).toMatchObject({ label: '10/20 · +2', marks: ['full', 'filling', 'empty'], dimmed: true, resets: 1 });
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 0); rt.clear(false); });
  await page.mouse.move(640, 700);
  await page.screenshot({ path: 'artifacts/realtime-bag-reset.png' });
  // Into the door: the result screen says what the door paid, with its kind.
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [door.x, door.y] as const);
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  s = await snap(page);
  expect(s.status).toBe('victory');
  const paid = s.bag.paid as Record<string, number>;
  expect(Object.values(paid).reduce((a, b) => a + b, 0)).toBe(1);
  expect(s.bagView.visible).toBe(false);
  const row = page.locator('.rt-result-stats dt', { hasText: 'Котомка' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('xpath=following-sibling::dd[1]')).toHaveText(/^\+1 — 1 (Роса|Порох|Смола|Травы)$/);
  expect(errors).toEqual([]);
});

test('the bag in the run: row 1\'s door has no sack; a row-2 fight has it, a filled step goes to the run\'s materials', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 10);
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  // Row 1: the goals open the door — no bag, no sack.
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  let s = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.stage === 'greed' || late ? q : undefined), null, 3);
  expect(s.stage).toBe('greed');
  await untilFrame(page, (_q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.3);
  s = await snap(page);
  expect(s.bag).toBeNull();
  expect(s.bagView.visible).toBe(false);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.rt-result-stats dt', { hasText: 'Котомка' })).toHaveCount(0);
  await page.getByTestId('result').getByRole('button').first().click();
  await expect(page.getByTestId('run')).toBeVisible();
  // Row 2: the bag. Step 1 is made 1 kill (the run fight's own params) so one real chain fills it.
  const node = page.locator('[data-testid^="node-r6"][data-status="available"]').first();
  await node.click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const before = (await page.evaluate(() => (window as any).__realtime.run.state())).materials as Record<string, number>;
  await untilFrame(page, (q: any) => (q.enemies.length >= 3 ? true : undefined), null, 8);
  await page.evaluate(() => { const p = (window as any).__realtime.params; Object.assign(p, { enemySpeed: 0, wolfSpeed: 0, speedSpread: 0, contactDamage: 0, bagStep1: 1 }); });
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  s = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.bagView.visible || late ? q : undefined), null, 3);
  expect(s.bagView).toMatchObject({ visible: true, label: '0/1 · +1' });
  const door = s.objects.find((o: any) => o.kind === 'door'), dir = Math.sign(s.bagView.x - door.x);
  await page.evaluate(() => (window as any).__realtime.clear(false));
  await chain(page, { x: s.bagView.x + dir * 1.5, y: door.y }, dir, 2);
  s = await untilFrame(page, (q: any, _a: null, late: boolean) => (q.bag?.step >= 1 || late ? q : undefined), null, 3);
  expect(s.bag.step).toBe(1);
  const gained = s.materials as Record<string, number>;
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  s = await snap(page);
  const paid = s.bag.paid as Record<string, number>;
  expect(Object.values(paid).reduce((a, b) => a + b, 0)).toBe(1);
  const after = (await page.evaluate(() => (window as any).__realtime.run.state())).materials as Record<string, number>;
  for (const kind of Object.keys(before)) expect(after[kind], kind).toBe(before[kind] + (gained?.[kind] ?? 0) + (paid[kind] ?? 0));
  await expect(page.locator('.rt-result-stats dt', { hasText: 'Котомка' }).locator('xpath=following-sibling::dd[1]')).toHaveText(/^\+1 — 1 (Роса|Порох|Смола|Травы)$/);
  expect(errors).toEqual([]);
});
