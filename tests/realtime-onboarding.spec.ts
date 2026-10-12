import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gameWait } from './realtimeFrames';

/**
 * «Обучение v1» (src/realtime/view/hints.ts, docs/realtime-onboarding.md): real input at 1280×720.
 * - A new viewer's first run: the hint Б1 appears with the first link of the first chain, Б2 after it; the hints come one at a
 *   time, 6 s or more apart; the second run does not repeat them; the run record names the hints shown. Task 5 (12.10.2026):
 *   the run has no cauldron — no Б4 after a cheque of 3+ links (there is no cheque).
 * - The toggle «Подсказки» off: none (also not the queued ones); «Показать подсказки снова»: Б1 again.
 * - The sandbox shows none and writes no memory.
 * - The door opened (task 5): neither Б4 nor Б5 (they speak of the cauldron, the run has none) — the goblin's Б9 comes;
 *   screenshots with Б1 and Б9 keep the HP, the goal and the energy in view. Б4 before Б5 with the cauldron on is checked in
 *   Node (src/realtime/view/hints.spec.ts).
 * - Б8 is on screen before the chest is taken (it goes first in the queue); the hero under the box fades it (screenshot).
 * - The lines on the screens: Э2 on the first two appearances of the map. Task 5: a won run fight has no «Котёл» row (Э1)
 *   and no die screen (Э4); Э1 against the payout is checked in Node (src/realtime/view/hints.spec.ts), the die screen's
 *   own test reads a save that stands at it (tests/realtime-die.spec.ts).
 * Hint times are real (wall) time by the design; the scenes are frozen with `maxEnemies` 0 (docs/realtime-slice.md, section 13).
 * The hard-battle save is made by the run code (seed `Math.imul(2, 2654435761) >>> 0`, the «Застава» node entered).
 */

const SEED = 10;
const RUN_KEY = 'ashen-oath-rt-run-v7';
const hardBattle = readFileSync(new URL('./fixtures/rt-run-save-hard-battle.json', import.meta.url), 'utf8').trim();

interface Onboarding { on: boolean; id: string | null; text: string | null; faded: boolean; box: { left: number; top: number; right: number; bottom: number } | null; shown: string[]; pending: string[]; log: { id: string; t: number }[] }
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const onboarding = async (page: Page): Promise<Onboarding> => (await snap(page)).onboarding;
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
/** The memory of the viewer (`shown`: every id with its count — the fight hints `b1`…`b9` and the screen lines `e2`, `e4`); null — nothing stored. */
const stored = (page: Page): Promise<{ version: number; shown: Record<string, number> } | null> =>
  page.evaluate(() => { const raw = localStorage.getItem('ashen-oath-realtime-hints'); return raw ? JSON.parse(raw) : null; });
/** Only the fight hints of the memory. */
const shownHints = async (page: Page): Promise<Record<string, number>> => Object.fromEntries(Object.entries((await stored(page))?.shown ?? {}).filter(([id]) => id.startsWith('b')));

function watch(page: Page, errors: string[]): void {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}
/** A new viewer: the page with empty storage. */
async function freshViewer(page: Page, errors: string[], url = '/'): Promise<void> {
  watch(page, errors);
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}
/** A seeded run to the first battle of the map (the gift's first button), the arena open. */
async function startFight(page: Page): Promise<void> {
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
}
/** The arena is quiet: nobody walks, touches or comes (the arena's start enemies removed). */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0; rt.params.contactDamage = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0; rt.params.maxEnemies = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false; rt.params.dashSpeed = 5; rt.params.hitstop = false;
    rt.clear(false);
  });
}
const DIRECTIONS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const movingNull = (page: Page) => expect.poll(async () => (await snap(page)).moving, { timeout: 10_000 }).toBeNull();

/**
 * A chain of `count` weak enemies drawn with the mouse along a free line from the hero. With `hold` the button stays down (the
 * chain is being drawn); otherwise it is released and the dash is waited out. Returns once the chain has `count` links.
 */
async function drawChain(page: Page, count: number, hold = false): Promise<void> {
  const start = (await snap(page)).hero as { x: number; y: number };
  for (const [ox, oy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0]]) for (const [dx, dy] of DIRECTIONS) {
    if (ox || oy) await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [start.x + ox, start.y + oy] as const);
    const hero = (await snap(page)).hero as { x: number; y: number };
    const points = Array.from({ length: count }, (_, i) => ({ x: hero.x + dx * 1.2 * (i + 1), y: hero.y + dy * 1.2 * (i + 1) }));
    for (const p of points) await page.evaluate(([x, y]) => (window as any).__realtime.place(x, y, 0, 0), [p.x, p.y] as const);
    const screens: { x: number; y: number }[] = [];
    for (const p of points) screens.push(await screen(page, p.x, p.y));
    await page.mouse.move(screens[0].x, screens[0].y);
    await page.mouse.down();
    for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
    if ((await snap(page)).chain.length === count) {
      if (!hold) { await page.mouse.up(); await movingNull(page); }
      return;
    }
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await movingNull(page);
    await page.evaluate(() => (window as any).__realtime.clear(false));
  }
  throw new Error('no free line for the chain');
}
/** One more chain release (a mouse press on one enemy beside the hero): lets a hint on screen go once its time is over. */
const tap = (page: Page): Promise<void> => drawChain(page, 1);

/** Releases chains until `done` holds (the hints need releases to go); the wait is wall time by the design. */
async function untilHint(page: Page, done: (o: Onboarding) => boolean, seconds = 90): Promise<Onboarding> {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const o = await onboarding(page);
    if (done(o)) return o;
    if (Date.now() > end) throw new Error(`the hint did not come: ${JSON.stringify(o)}`);
    await tap(page);
    await page.waitForTimeout(400);
  }
}
async function leaveFight(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snap(page)).status, { timeout: 15_000 }).toBe('victory');
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  // A small cauldron pays the same on every face: no die. Otherwise «Забрать».
  const die = (await page.evaluate(() => (window as any).__realtime.run.state().pending?.kind)) === 'die';
  await page.getByTestId('result-map').click();
  if (die) await page.getByTestId('die-take').click();
}
const gearOpen = async (page: Page): Promise<void> => { if (!(await page.getByTestId('run-settings-panel').isVisible())) await page.getByTestId('run-settings').click(); };

const rect = (page: Page, testId: string) => page.getByTestId(testId).evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
const overlaps = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

test('a new viewer: Б1 with the first link of the first chain, then Б2, one at a time 6 s or more apart; no Б4 (task 5: no cauldron); the second run does not repeat them; the run record names them', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await freshViewer(page, errors);
  await startFight(page);
  await quiet(page);
  expect((await onboarding(page)).id).toBeNull();
  expect(await shownHints(page)).toEqual({});

  // The first link of the first chain: Б1 stands at once, bottom centre, narrow, above the item line, not over the HUD.
  await drawChain(page, 4, true);
  await expect.poll(async () => (await onboarding(page)).id).toBe('b1');
  const first = await onboarding(page);
  expect(first.text).toBe('Пока рисуешь цепь — время замедлено. Полоса — фокус, каждый враг в цепи его пополняет.');
  const box = await rect(page, 'onboarding-hint'), hud = await rect(page, 'hud'), bar = await rect(page, 'action-bar');
  expect(box.width).toBeLessThanOrEqual(560);
  expect(Math.abs((box.left + box.right) / 2 - 640)).toBeLessThan(2);
  expect(box.bottom).toBeLessThan(bar.top);
  expect(box.bottom).toBeGreaterThan(560);
  expect(overlaps(box, hud) || overlaps(box, bar)).toBe(false);
  expect(await page.getByTestId('onboarding-hint').evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  for (const id of ['hud', 'focus', 'goal', 'action-bar']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.locator('.rt-hp')).toBeVisible();
  await expect(page.locator('.rt-energy')).toBeVisible();
  await page.mouse.move(640, 300);
  await page.screenshot({ path: 'artifacts/realtime-onboarding-b1.png' });
  await page.mouse.up();
  await movingNull(page);

  // Б2 follows; the hints come one by one, a release lets each go after its 4 s. The chain of 4 put no cheque (task 5): no Б4.
  const seen = await untilHint(page, o => o.log.some(h => h.id === 'b2'));
  const ids = seen.log.map(h => h.id);
  expect(ids.slice(0, 2)).toEqual(['b1', 'b2']);
  expect(new Set(ids).size).toBe(ids.length);
  for (let i = 1; i < seen.log.length; i++) expect(seen.log[i].t - seen.log[i - 1].t).toBeGreaterThanOrEqual(6000);
  await expect(page.locator('[data-testid="onboarding-hint"]')).toHaveCount(1);
  expect((await shownHints(page)).b2).toBe(1);
  expect(ids).not.toContain('b4');
  expect([...seen.pending, ...ids]).not.toContain('b4');
  expect((await snap(page)).purse.on).toBe(false);

  // Telemetry: the run record has the ids shown, in order.
  const records = await page.evaluate(() => (window as any).__realtime.telemetry.records()) as { kind: string; hints?: string[] }[];
  expect(records.find(r => r.kind === 'run')?.hints).toEqual(ids);

  // The second run: the same chain, nothing that was shown comes again.
  const shownBefore = (await onboarding(page)).log.length;
  await leaveFight(page);
  await startFight(page);
  await quiet(page);
  await drawChain(page, 4);
  await page.waitForTimeout(8_000);
  await tap(page);
  const after = await onboarding(page);
  const allIds = after.log.map(h => h.id);
  expect(allIds.filter(id => id === 'b2')).toHaveLength(1);
  expect(new Set(allIds).size).toBe(allIds.length);
  expect(after.log.slice(shownBefore).every(h => !['b1', 'b2', 'b4'].includes(h.id))).toBe(true);
  expect((await shownHints(page)).b2).toBe(1);
  expect((await shownHints(page)).b4).toBeUndefined();
  expect(errors).toEqual([]);
});

test('the toggle «Подсказки» off: no hint, also not the queued ones; «Показать подсказки снова» brings Б1 back', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await freshViewer(page, errors);
  // Fight 1: Б1 is shown (the toggle is on by default).
  await startFight(page);
  await quiet(page);
  await drawChain(page, 3);
  await expect.poll(async () => (await onboarding(page)).log.map(h => h.id)).toEqual(['b1']);
  expect(await shownHints(page)).toEqual({ b1: 1 });
  await leaveFight(page);

  // Fight 2: the toggle off on the gear of the map — no hint in 8 s (Б2 was waiting), memory unchanged.
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await gearOpen(page);
  await expect(page.getByTestId('view-hints')).toBeChecked();
  await page.getByTestId('view-hints').uncheck();
  await expect(page.getByTestId('line-resources')).toHaveCount(0);
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await quiet(page);
  await drawChain(page, 4);
  await tap(page);
  await page.waitForTimeout(8_000);
  const off = await onboarding(page);
  expect(off.on).toBe(false);
  expect(off.id).toBeNull();
  expect(off.log.map(h => h.id)).toEqual(['b1']);
  expect(await shownHints(page)).toEqual({ b1: 1 });
  await leaveFight(page);

  // Fight 3: on again and «Показать подсказки снова» — the memory is empty, Б1 comes with the first link.
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await gearOpen(page);
  await page.getByTestId('view-hints').check();
  await page.getByTestId('hints-reset').click();
  await expect(page.getByTestId('hints-reset')).toHaveText('Подсказки покажутся снова ✓');
  expect(await shownHints(page)).toEqual({});
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await quiet(page);
  await drawChain(page, 3, true);
  await expect.poll(async () => (await onboarding(page)).id).toBe('b1');
  await page.mouse.up();
  expect((await onboarding(page)).log.map(h => h.id)).toEqual(['b1', 'b1']);
  expect(errors).toEqual([]);
});

test('the sandbox shows no hint and keeps no memory', async ({ page }) => {
  const errors: string[] = [];
  await freshViewer(page, errors, '/?sandbox=1');
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  await quiet(page);
  await drawChain(page, 4);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await page.evaluate(() => (window as any).__realtime.setEnergy(7));
  await page.waitForTimeout(7_000);
  expect((await snap(page)).onboarding).toBeNull();
  await expect(page.getByTestId('onboarding-hint')).toBeHidden();
  expect(await stored(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('task 5: the door opened in a run — neither Б4 nor Б5 (no cauldron); the goblin\'s Б9 comes — the screenshot keeps HP, the goal and the energy in view', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  await freshViewer(page, errors);
  await startFight(page);
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  // The goblin stands 3 game seconds after the goals (the run: every battle from row 1): Б9 is the first hint.
  await expect.poll(async () => (await onboarding(page)).id, { timeout: 20_000 }).toBe('b9');
  const seen = await onboarding(page);
  expect(seen.log.map(h => h.id)).toEqual(['b9']);
  expect([...seen.pending, ...seen.log.map(h => h.id)]).not.toContain('b4');
  expect([...seen.pending, ...seen.log.map(h => h.id)]).not.toContain('b5');
  expect(seen.text).toBe('Однорукий гоблин: закончи цепь на рычаге. Первые 3 рывка безопасны, дальше — риск взрыва.');
  const box = await rect(page, 'onboarding-hint'), hud = await rect(page, 'hud'), bar = await rect(page, 'action-bar');
  expect(box.width).toBeLessThanOrEqual(560);
  expect(overlaps(box, hud) || overlaps(box, bar)).toBe(false);
  for (const id of ['hud', 'goal', 'action-bar', 'focus']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.locator('.rt-hp')).toBeVisible();
  await expect(page.locator('.rt-energy')).toBeVisible();
  await expect(page.getByTestId('goal')).toContainText('дверь открыта');
  await page.mouse.move(640, 300);
  await page.screenshot({ path: 'artifacts/realtime-onboarding-b9.png' });
  expect((await shownHints(page)).b4).toBeUndefined();
  expect((await shownHints(page)).b5).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Б8 stands on screen before the chest is taken (first in the queue); the hero under the box fades it to a quarter', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  watch(page, errors);
  await page.goto('/');
  await page.evaluate(([key, save]) => { localStorage.clear(); localStorage.setItem(key, save); }, [RUN_KEY, hardBattle] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run-battle-modal')).toBeHidden();
  // The chest is there, the curse is not: Б8 is the first hint, whatever else the yard shows (armoured elites — Б6).
  await expect.poll(async () => (await onboarding(page)).id, { timeout: 5_000 }).toBe('b8');
  const s = await snap(page);
  expect(s.objects.some((o: { kind: string }) => o.kind === 'chest')).toBe(true);
  expect(s.curse).toBeNull();
  expect((await onboarding(page)).text).toBe('Проклятый сундук: касания врагов +1 урон до 12 убийств цепью. Награда за победу — талисман.');
  expect((await onboarding(page)).pending).toContain('b6');
  await expect(page.getByTestId('onboarding-hint')).toBeVisible();
  // One hint at a time: the item hint of the arena start (it stood over the action bar at the same moment) waits.
  expect((await snap(page)).itemHint).toBe(false);
  await expect(page.getByTestId('item-hint')).toBeHidden();

  // The hero starts at the bottom edge of the yard, under the box: it is faded to a quarter (the arena edges are spawn places,
  // the hero and the markers must not stay covered).
  const box = (await onboarding(page)).box!;
  const heroAt = async () => { const hero = (await snap(page)).hero as { x: number; y: number }; return screen(page, hero.x, hero.y); };
  const at = await heroAt();
  expect(at.x).toBeGreaterThan(box.left - 40);
  expect(at.x).toBeLessThan(box.right + 40);
  expect(at.y).toBeGreaterThan(box.top - 40);
  expect(at.y).toBeLessThan(box.bottom + 40);
  const solid = () => page.getByTestId('onboarding-hint').evaluate(node => Number(getComputedStyle(node).opacity));
  await expect.poll(async () => (await onboarding(page)).faded).toBe(true);
  await expect.poll(solid).toBeLessThan(0.3);
  await page.mouse.move(640, 120);
  await page.screenshot({ path: 'artifacts/realtime-onboarding-faded.png' });
  // The display time runs only while the box is not faded: 5 s (wall time) with the hero under it, Б8 is still there and
  // the item hint still waits...
  await quiet(page);
  await page.waitForTimeout(5_000);
  expect((await onboarding(page)).id).toBe('b8');
  expect((await onboarding(page)).faded).toBe(true);
  expect((await snap(page)).itemHint).toBe(false);
  // ...he walks to the top of the yard (the camera follows): Б8 is still shown, now at full opacity, and can be read.
  await page.evaluate(() => (window as any).__realtime.teleport(10, 3));
  await gameWait(page, 1.5);
  const far = await heroAt();
  expect(far.y).toBeLessThan(box.top - 40);
  await expect.poll(async () => (await onboarding(page)).faded).toBe(false);
  await expect.poll(solid).toBeGreaterThan(0.95);
  expect((await onboarding(page)).id).toBe('b8');
  await page.waitForTimeout(2_000);
  expect((await onboarding(page)).id).toBe('b8');
  await expect.poll(solid).toBeGreaterThan(0.95);
  await page.mouse.move(640, 120);
  await page.screenshot({ path: 'artifacts/realtime-onboarding-b8-readable.png' });
  // And back under it: faded again.
  await page.evaluate(() => (window as any).__realtime.teleport(10, 12.5));
  await gameWait(page, 1.5);
  await expect.poll(async () => (await onboarding(page)).faded).toBe(true);
  expect(errors).toEqual([]);
});

test('the lines on the screens: Э2 on the first two appearances of the map, then quiet, back after «Показать подсказки снова»; the toggle off hides it', async ({ page }) => {
  const errors: string[] = [];
  await freshViewer(page, errors);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await expect(page.getByTestId('line-resources')).toHaveCount(0);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('line-resources')).toHaveText('Ресурсы — крафт на привале, покупки у торговца, переброс талисманов.');
  await page.getByTestId('node-r5c0').click();
  await expect(page.getByTestId('line-resources')).toBeVisible();
  expect((await stored(page))?.shown.e2).toBe(1);
  await page.reload();
  await expect(page.getByTestId('line-resources')).toBeVisible();
  expect((await stored(page))?.shown.e2).toBe(2);
  await page.reload();
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.getByTestId('line-resources')).toHaveCount(0);
  expect((await stored(page))?.shown.e2).toBe(2);
  await gearOpen(page);
  await page.getByTestId('hints-reset').click();
  await expect(page.getByTestId('line-resources')).toBeVisible();
  await page.getByTestId('view-hints').uncheck();
  await expect(page.getByTestId('line-resources')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('task 5: a won run fight has no «Котёл» row (Э1) — «Очки» instead — and no die screen (Э4): the result leads to the map', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await freshViewer(page, errors);
  await startFight(page);
  await quiet(page);
  await drawChain(page, 5);
  await drawChain(page, 5);
  expect((await snap(page)).purse.on).toBe(false);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snap(page)).status, { timeout: 15_000 }).toBe('victory');
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('result').locator('dt', { hasText: 'Котёл' })).toHaveCount(0);
  await expect(page.getByTestId('result').locator('dt', { hasText: 'Очки' })).toHaveCount(1);
  await expect(page.getByTestId('result')).not.toContainText('→ ресурсов');
  await expect(page.getByTestId('result-map')).toHaveText('К карте (Enter)');
  await page.screenshot({ path: 'artifacts/realtime-onboarding-result.png' });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.getByTestId('run-die')).toHaveCount(0);
  await expect(page.getByTestId('line-die')).toHaveCount(0);
  expect((await stored(page))?.shown.e4).toBeUndefined();
  expect(errors).toEqual([]);
});
