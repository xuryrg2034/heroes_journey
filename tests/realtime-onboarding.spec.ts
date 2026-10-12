import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gameWait, untilFrame } from './realtimeFrames';

/**
 * «Обучение» (src/realtime/view/hints.ts, src/realtime/view/worldLabels.ts, docs/realtime-onboarding.md): real input at 1280×720.
 * Task 6 (12.10.2026): the box of hints at the bottom of a run fight is GONE (Б1, Б2, Б3, Б7 go to the prologue, Б4 and Б5 belong
 * to the cauldron the run does not play). Б6, Б8, Б9 are labels in the world, at their object:
 * - a new viewer's fight on a plain field: no box, no label; the memory stays empty;
 * - «Застава»: «Пластина — 1 удар» over the armoured elite and the chest's price at the chest, each until the action (a real
 *   click on the elite takes a plate, a real click on the chest takes it), then gone and not back in the next fight;
 * - the goblin: «Закончи цепь здесь» at the lever until the first pull, odds line and dots stay; gone for the next fight;
 * - the gear's toggle «Подсказки» hides the labels, «Показать подсказки снова» clears the memory (a later step renames it);
 * - the sandbox shows the labels by the same toggle, keeps no memory, has no box;
 * - the lines on the screens (Э2); a won run fight has no «Котёл» row (Э1) and no die screen (Э4).
 * The scenes are frozen with `maxEnemies` 0 and still enemies (docs/realtime-slice.md, section 13); waits are in game time.
 * The hard-battle save is made by the run code (seed `Math.imul(2, 2654435761) >>> 0`, the «Застава» node entered).
 */

const SEED = 10;
const RUN_KEY = 'ashen-oath-rt-run-v7';
const hardBattle = readFileSync(new URL('./fixtures/rt-run-save-hard-battle.json', import.meta.url), 'utf8').trim();

interface Onboarding { on: boolean; labels: { id: string; text: string; left: number; top: number; right: number; bottom: number }[]; shown: string[]; log: { id: string; t: number }[] }
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

test('the box of hints at the bottom is gone: a new viewer\'s first fight shows no box and no label on a plain field; chains, a long wait and the end of the fight add none', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  await freshViewer(page, errors);
  await startFight(page);
  await quiet(page);
  await drawChain(page, 4, true);
  await gameWait(page, 1);
  await expect(page.getByTestId('onboarding-hint')).toHaveCount(0);
  await expect(page.locator('.rt-onboard')).toHaveCount(0);
  await expect(page.getByTestId('world-label')).toBeHidden();
  expect((await onboarding(page)).labels).toEqual([]);
  await page.mouse.up();
  await movingNull(page);
  await gameWait(page, 8);
  await drawChain(page, 4);
  await gameWait(page, 2);
  // The old Б1, Б2, Б3, Б7 (prologue), Б4, Б5 (no cauldron) are not shown anywhere; nothing is written to the memory.
  await expect(page.getByTestId('onboarding-hint')).toHaveCount(0);
  expect((await onboarding(page)).log).toEqual([]);
  expect(await shownHints(page)).toEqual({});
  for (const id of ['hud', 'focus', 'goal', 'action-bar']) await expect(page.getByTestId(id)).toBeVisible();
  expect(errors).toEqual([]);
});

/** One pull by the mouse: a hero 2.4 from the idol, a weak enemy between, press on it, drag to the lever, release; returns once the pull landed. */
async function pullLever(page: Page): Promise<void> {
  const g = (await snap(page)).slot.goblin as { x: number; y: number; pulls: number };
  const by = Math.hypot(g.x - 8, g.y - 5), ux = (8 - g.x) / by, uy = (5 - g.y) / by;
  await page.evaluate(([e, h]) => {
    const rt = (window as any).__realtime;
    rt.teleport(h.x, h.y);
    rt.place(e.x, e.y, 0, 0, 'basic');
  }, [{ x: g.x + ux * 1.2, y: g.y + uy * 1.2 }, { x: g.x + ux * 2.4, y: g.y + uy * 2.4 }] as const);
  await gameWait(page, 0.15);
  const enemy = await screen(page, g.x + ux * 1.2, g.y + uy * 1.2), lever = await screen(page, g.x, g.y);
  await page.mouse.move(enemy.x, enemy.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain.length).toBe(1);
  await page.mouse.move(lever.x, lever.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chainLinks.map((l: { kind: string }) => l.kind)).toEqual(['enemy', 'object']);
  await untilFrame(page, snap => snap.slot.shown.odds === 1 ? true : undefined, null, 5);
  await page.mouse.up();
  await untilFrame(page, (snap, was: number) => snap.slot.goblin && snap.slot.goblin.pulls > was ? true : undefined, g.pulls, 10);
}

/** The save of «Застава» (armoured elites and the chest in the yard); the viewer's memory is NOT cleared when `keepMemory`. */
async function enterHardBattle(page: Page, keepMemory: boolean): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, save, keep]) => {
    if (keep) localStorage.removeItem(key); else localStorage.clear();
    localStorage.setItem(key, save);
  }, [RUN_KEY, hardBattle, keepMemory] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run-battle-modal')).toBeHidden();
}
/** Nobody walks or comes, touches do not hurt; the yard's elites and chest stay. */
async function stillYard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0; rt.params.contactDamage = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0; rt.params.maxEnemies = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false; rt.params.hitstop = false;
  });
}
interface Label { id: string; text: string; left: number; top: number; right: number; bottom: number }
const labelOf = async (page: Page, id: string): Promise<Label | undefined> => (await onboarding(page)).labels.find(l => l.id === id);
const centreX = (l: Label): number => (l.left + l.right) / 2;

test('«Застава»: «Пластина — 1 удар» hangs over the armoured elite and the chest\'s price at the chest, both until the action; a real click takes the plate / the chest, the label goes and does not come back in the next fight', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watch(page, errors);
  await enterHardBattle(page, false);
  await stillYard(page);
  await expect(page.getByTestId('onboarding-hint')).toHaveCount(0);

  // Both labels stand at once, each at its object; the old box is nowhere.
  await expect.poll(async () => (await onboarding(page)).labels.map(l => l.id).sort(), { timeout: 8_000 }).toEqual(['b6', 'b8']);
  const s = await snap(page);
  const chest = s.objects.find((o: { kind: string }) => o.kind === 'chest');
  const elites = s.enemies.filter((e: { armor: unknown }) => e.armor);
  expect(chest && elites.length > 0).toBeTruthy();
  const elite = elites.sort((a: any, b: any) => Math.hypot(a.x - s.hero.x, a.y - s.hero.y) - Math.hypot(b.x - s.hero.x, b.y - s.hero.y))[0];
  const eliteLabel = (await labelOf(page, 'b6'))!, chestLabel = (await labelOf(page, 'b8'))!;
  expect(eliteLabel.text).toBe('Пластина — 1 удар');
  expect(chestLabel.text).toBe('+1 урон касания, 12 убийств');
  const eliteAt = await screen(page, elite.x, elite.y), chestAt = await screen(page, chest.x, chest.y);
  for (const [label, at] of [[eliteLabel, eliteAt], [chestLabel, chestAt]] as const) {
    expect(Math.abs(centreX(label) - at.x), `${label.id} stands over its object`).toBeLessThan(label.right - label.left);
    expect(label.bottom, `${label.id} is above its object`).toBeLessThanOrEqual(at.y);
    expect(at.y - label.bottom, `${label.id} is near its object`).toBeLessThan(110);
    expect(label.left).toBeGreaterThanOrEqual(0);
    expect(label.right).toBeLessThanOrEqual(1280);
  }
  const hud = await rect(page, 'hud'), bar = await rect(page, 'action-bar');
  for (const label of [eliteLabel, chestLabel]) expect(overlaps(label, hud) || overlaps(label, bar), `${label.id} clear of the HUD`).toBe(false);
  expect(await page.getByTestId('world-label').first().evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  for (const id of ['hud', 'focus', 'goal', 'action-bar']) await expect(page.getByTestId(id)).toBeVisible();
  await page.mouse.move(640, 130);
  await page.screenshot({ path: 'artifacts/realtime-label-elite.png' });

  // The labels move with the camera: the hero walks to the far side — a label that leaves the view goes with its object,
  // and the one in view keeps standing at its object (it stays until the action, not for some seconds).
  await gameWait(page, 3);
  expect((await onboarding(page)).labels.map(l => l.id).sort()).toEqual(['b6', 'b8']);
  expect(await shownHints(page)).toEqual({});

  // A real click on the elite: the dash takes a plate — «Пластина» goes (memory b6), the chest's price stays.
  const plates = (await snap(page)).enemies.find((e: { id: number }) => e.id === elite.id).armor.plates;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [elite.x - 1.4, elite.y] as const);
  await gameWait(page, 0.2);
  const target = await screen(page, elite.x, elite.y);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).enemies.find((e: { id: number }) => e.id === elite.id)?.armor?.plates, { timeout: 10_000 }).toBeLessThan(plates);
  await movingNull(page);
  await expect.poll(async () => (await onboarding(page)).labels.map(l => l.id), { timeout: 5_000 }).toEqual(['b8']);
  expect(await shownHints(page)).toEqual({ b6: 1 });
  await page.mouse.move(640, 130);
  await page.screenshot({ path: 'artifacts/realtime-label-chest.png' });

  // A real click on the chest: taken — its price goes (memory b8).
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [chest.x - 1.4, chest.y] as const);
  await gameWait(page, 0.2);
  const chestTarget = await screen(page, chest.x, chest.y);
  await page.mouse.move(chestTarget.x, chestTarget.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).curse?.by ?? null, { timeout: 10_000 }).toBe('chain');
  await expect.poll(async () => (await onboarding(page)).labels, { timeout: 5_000 }).toEqual([]);
  expect(await shownHints(page)).toEqual({ b6: 1, b8: 1 });
  expect((await onboarding(page)).log.map(h => h.id).sort()).toEqual(['b6', 'b8']);
  const records = await page.evaluate(() => (window as any).__realtime.telemetry?.records() ?? []) as { kind: string; hints?: string[] }[];
  expect(records.find(r => r.kind === 'run')?.hints ?? ['b6', 'b8']).toEqual(expect.arrayContaining(['b6', 'b8']));

  // The next fight of the same viewer (the memory kept): the same yard, no label — they do not come back.
  await enterHardBattle(page, true);
  await stillYard(page);
  const again = await snap(page);
  expect(again.objects.some((o: { kind: string }) => o.kind === 'chest')).toBe(true);
  expect(again.enemies.some((e: { armor: unknown }) => e.armor)).toBe(true);
  await gameWait(page, 3);
  expect((await onboarding(page)).labels).toEqual([]);
  expect((await onboarding(page)).log).toEqual([]);
  await expect(page.getByTestId('world-label')).toBeHidden();
  expect(await shownHints(page)).toEqual({ b6: 1, b8: 1 });
  expect(errors).toEqual([]);
});

test('the goblin: «Закончи цепь здесь» stands at the lever until the first pull, then goes and does not come back; the odds line and the dots stay', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await freshViewer(page, errors);
  await startFight(page);
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  // The goblin stands 3 game seconds after the goals (the run: every battle from row 1); its lever carries the label.
  await expect.poll(async () => (await onboarding(page)).labels.map(l => l.id), { timeout: 20_000 }).toEqual(['b9']);
  const g = (await snap(page)).slot.goblin as { x: number; y: number; pulls: number };
  const label = (await labelOf(page, 'b9'))!;
  expect(label.text).toBe('Закончи цепь здесь');
  const lever = await screen(page, g.x, g.y);
  // At the lever: beside the idol (right of it, or left at the edge), on its height, clear of the HUD and the action bar.
  expect(Math.abs((label.top + label.bottom) / 2 - lever.y)).toBeLessThan(60);
  expect(label.left > lever.x || label.right < lever.x).toBe(true);
  expect(Math.min(Math.abs(label.left - lever.x), Math.abs(label.right - lever.x))).toBeLessThan(110);
  const hud = await rect(page, 'hud'), bar = await rect(page, 'action-bar');
  expect(overlaps(label, hud) || overlaps(label, bar)).toBe(false);
  await expect(page.getByTestId('onboarding-hint')).toHaveCount(0);
  await page.mouse.move(640, 130);
  await page.screenshot({ path: 'artifacts/realtime-label-lever.png' });

  // It stays without any action (not a timer): 6 s of game time later it is still there; the memory is empty.
  await gameWait(page, 6);
  expect((await onboarding(page)).labels.map(l => l.id)).toEqual(['b9']);
  expect(await shownHints(page)).toEqual({});

  // A real chain to the lever: the first pull takes the label away (memory b9).
  await pullLever(page);
  await expect.poll(async () => (await onboarding(page)).labels, { timeout: 5_000 }).toEqual([]);
  expect(await shownHints(page)).toEqual({ b9: 1 });
  const dots = (await snap(page)).slot.shown.dots as { gold: number; red: number; dark: number };
  expect(dots.gold + dots.red + dots.dark).toBeGreaterThan(0);
  await expect(page.getByTestId('world-label')).toBeHidden();

  // The next fight of the same viewer: the goblin comes again, no label.
  await movingNull(page);
  await leaveFight(page);
  await startFight(page);
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await expect.poll(async () => (await snap(page)).slot.goblin !== null, { timeout: 20_000 }).toBe(true);
  await gameWait(page, 3);
  expect((await onboarding(page)).labels).toEqual([]);
  expect((await onboarding(page)).log.map(h => h.id)).toEqual(['b9']);
  expect(errors).toEqual([]);
});

test('the toggle «Подсказки» off hides the labels and marks nothing; on again they come back; after a pull the memory holds b9 and «Показать подсказки снова» clears it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await freshViewer(page, errors);
  const goblinFight = async (): Promise<void> => {
    await startFight(page);
    await quiet(page);
    await page.evaluate(() => (window as any).__realtime.completeGoals());
    await expect.poll(async () => (await snap(page)).slot.goblin !== null, { timeout: 20_000 }).toBe(true);
  };
  // Fight 1: the toggle off on the gear of the map — the goblin stands, no label in 3 s of game time, nothing marked.
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await gearOpen(page);
  await page.getByTestId('view-hints').uncheck();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await quiet(page);
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  await expect.poll(async () => (await snap(page)).slot.goblin !== null, { timeout: 20_000 }).toBe(true);
  await gameWait(page, 3);
  expect((await onboarding(page)).on).toBe(false);
  expect((await onboarding(page)).labels).toEqual([]);
  expect(await shownHints(page)).toEqual({});
  await leaveFight(page);

  // Fight 2: on again — the label is there; one real pull marks b9.
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await gearOpen(page);
  await page.getByTestId('view-hints').check();
  await goblinFight();
  await expect.poll(async () => (await onboarding(page)).labels.map(l => l.id)).toEqual(['b9']);
  await pullLever(page);
  await expect.poll(async () => (await onboarding(page)).labels).toEqual([]);
  expect(await shownHints(page)).toEqual({ b9: 1 });
  await movingNull(page);
  await leaveFight(page);

  // «Показать подсказки снова»: the memory is empty, the label comes again in the next fight.
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await gearOpen(page);
  await page.getByTestId('hints-reset').click();
  await expect(page.getByTestId('hints-reset')).toHaveText('Подсказки покажутся снова ✓');
  expect(await shownHints(page)).toEqual({});
  await goblinFight();
  await expect.poll(async () => (await onboarding(page)).labels.map(l => l.id)).toEqual(['b9']);
  expect(errors).toEqual([]);
});

test('the sandbox has no box either; its labels follow the toggle and keep no memory: the chest\'s price stands until the chest is taken', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  await freshViewer(page, errors, '/?sandbox=1');
  await page.keyboard.press('9');
  await expect(page.getByTestId('menu')).toBeHidden();
  await page.keyboard.press('Backquote');
  await page.locator('[data-param="cursedChest"] input').check();
  await page.keyboard.press('Backquote');
  await stillYard(page);
  await page.evaluate(() => (window as any).__realtime.clear(false));
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snap(page)).objects.some((o: { kind: string }) => o.kind === 'chest')).toBe(true);
  await stillYard(page);
  await page.evaluate(() => (window as any).__realtime.clear(false));
  await expect(page.getByTestId('onboarding-hint')).toHaveCount(0);
  await expect.poll(async () => (await onboarding(page)).labels.map(l => l.text)).toEqual(['+1 урон касания, 12 убийств']);
  expect(await stored(page)).toBeNull();
  const chest = (await snap(page)).objects.find((o: { kind: string }) => o.kind === 'chest');
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [chest.x - 1.4, chest.y] as const);
  await gameWait(page, 0.2);
  const at = await screen(page, chest.x, chest.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).curse?.by ?? null, { timeout: 10_000 }).toBe('chain');
  await expect.poll(async () => (await onboarding(page)).labels).toEqual([]);
  expect(await stored(page)).toBeNull();

  // The toggle off (its storage key, read at the start): no label in a new page.
  await page.evaluate(() => localStorage.setItem('ashen-oath-realtime-hints-on', '0'));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press('9');
  await page.keyboard.press('Backquote');
  await page.locator('[data-param="cursedChest"] input').check();
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snap(page)).objects.some((o: { kind: string }) => o.kind === 'chest')).toBe(true);
  await gameWait(page, 2);
  expect((await onboarding(page)).on).toBe(false);
  expect((await onboarding(page)).labels).toEqual([]);
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
