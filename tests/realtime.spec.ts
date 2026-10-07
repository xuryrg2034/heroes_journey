import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke test of the draft real-time prototype (realtime.html, docs/realtime-prototype.md).
 * Runs only through playwright.realtime.config.ts; the main game suite does not include it.
 */
interface Snapshot {
  arena: string;
  menuOpen: boolean;
  status: 'playing' | 'defeat' | 'victory';
  time: number;
  hero: { x: number; y: number; hp: number; maxHp: number };
  enemies: { id: number; kind: string; x: number; y: number; color: number; hp: number; marked: boolean; boar: string | null; age: number }[];
  markers: number;
  queue: number;
  stage: 'goals' | 'greed';
  phaseIndex: number;
  panelOpen: boolean;
}

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

/** Opens the page with clean storage; the arena menu shows first, `arena` (key 1–3) starts a fight. */
async function open(page: Page, errors: string[], arena: 1 | 2 | 3 | null = 1): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  if (arena === null) return;
  await page.keyboard.press(String(arena));
  await expect(page.getByTestId('menu')).toBeHidden();
}

test('realtime page opens, the horde arrives from the edges and walks to the hero', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  // A warning marker comes first, then the enemy steps out of it.
  await expect.poll(async () => (await snapshot(page)).enemies.length, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(0);
  const first = await snapshot(page);
  const forbidden = await page.evaluate(() => (window as any).__realtime.params.spawnMinDistance as number);
  const distances = (snap: Snapshot, ids: number[]) => ids.map(id => snap.enemies.find(e => e.id === id)!).map(e => Math.hypot(e.x - snap.hero.x, e.y - snap.hero.y));
  const ids = first.enemies.map(e => e.id);
  const before = distances(first, ids);
  // Never appears inside the forbidden radius around the hero (small slack for the first step). Since stage B the
  // density floor brings ~28 at once, so some have walked a little before the snapshot: no faster than 2 u/s since appearing.
  first.enemies.forEach((e, i) => expect(before[i] + e.age * 2).toBeGreaterThanOrEqual(forbidden - 0.2));
  // 1.5 s of game time (the software renderer may stall a frame; long frames are clamped).
  await expect.poll(async () => (await snapshot(page)).time, { timeout: 10_000 }).toBeGreaterThan(first.time + 1.5);
  const after = distances(await snapshot(page), ids);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // Along the flow field (iteration 2) or straight (toggle): the group as a whole closes in.
  expect(mean(after)).toBeLessThan(mean(before) - 0.5);
  // Bodies do not pass through each other: a crowd keeps its circles apart.
  await page.evaluate(() => (window as any).__realtime.burst(30));
  await page.waitForTimeout(2500);
  const crowd = await snapshot(page);
  // Body radius × the enemy size (stage D: 0.8 by default).
  const radius = await page.evaluate(() => { const p = (window as any).__realtime.params; return p.bodyRadius * p.enemyScale as number; });
  let closest = Infinity;
  for (let i = 0; i < crowd.enemies.length; i++) for (let j = i + 1; j < crowd.enemies.length; j++) {
    const a = crowd.enemies[i], b = crowd.enemies[j];
    closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
  }
  expect(closest).toBeGreaterThan(radius * 2 * 0.7);
  // Touching enemies hurt the standing hero.
  await expect.poll(async () => (await snapshot(page)).hero.hp, { timeout: 15_000 }).toBeLessThan(crowd.hero.maxHp);
  expect(errors).toEqual([]);
});

test('debug panel toggles by key and button, stores values and the defeat screen restarts', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const panel = page.getByTestId('debug-panel');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('debug-stats')).toContainText('FPS');
  await expect(page.getByTestId('debug-stats')).toContainText('В куче до смерти: по доле HP');
  await page.keyboard.press('F1');
  await expect(panel).toBeHidden();
  await page.getByTestId('open-panel').click();
  await expect(panel).toBeVisible();

  // A slider changes the live value and survives a reload.
  await page.locator('[data-param="heroHp"] input').fill('2');
  await expect(page.locator('[data-param="heroHp"] output')).toHaveText('2');
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.params.heroHp)).toBe(2);
  await expect(panel).toBeVisible();

  // With 2 HP the crowd kills the standing hero: defeat screen, then restart.
  await page.keyboard.press('1');
  await page.getByTestId('restart').click();
  await page.getByTestId('burst').click();
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('result')).toContainText('Поражение');
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat');
  await page.getByTestId('result-again').click();
  await expect(page.getByTestId('result')).toBeHidden();
  const fresh = await snapshot(page);
  expect(fresh.status).toBe('playing');
  expect(fresh.hero.hp).toBe(2);

  await page.getByTestId('reset-params').click();
  await expect(page.locator('[data-param="heroHp"] output')).toHaveText('12');
  expect((await snapshot(page)).hero.hp).toBe(12);
  expect(errors).toEqual([]);
});

test('before the goals the pace stays base; the goals button starts the greed table, the limit queues newcomers', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.keyboard.press('Backquote');
  // A low arena limit: the first greed phase wants a density floor above it.
  await page.locator('[data-param="maxEnemies"] input').fill('4');
  await page.getByTestId('restart').click();
  await page.waitForTimeout(1500);
  let snap = await snapshot(page);
  expect(snap.stage).toBe('goals');
  expect(snap.phaseIndex).toBe(-1);
  await expect(page.getByTestId('debug-stats')).toContainText('до целей');

  await page.getByTestId('complete-goals').click();
  await expect(page.getByTestId('complete-goals')).toBeDisabled();
  await expect.poll(async () => (await snapshot(page)).stage).toBe('greed');
  await expect(page.getByTestId('debug-stats')).toContainText('фаза 1/');
  await expect(page.locator('[data-testid="phase-table"] tr.rt-current')).toHaveCount(1);
  // Floor of phase 1 (6) is above the limit (4): the arena never exceeds the limit, the rest waits in the queue.
  await expect.poll(async () => (await snapshot(page)).queue, { timeout: 5_000 }).toBeGreaterThan(0);
  snap = await snapshot(page);
  expect(snap.enemies.length + snap.markers).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});

// ---- Stage 2: chain, focus, dash ----

interface ChainSnapshot extends Snapshot {
  chain: number[];
  moving: 'dash' | 'jump' | null;
  focus: number;
  focusing: boolean;
  energy: number;
  kills: number;
}

const chainSnapshot = (page: Page): Promise<ChainSnapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

/** A still arena: enemies stand where they are put, no newcomers walk in. */
async function stillArena(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    // No density floor (stage B: 28 before the goals) and no groups: only the placed enemies.
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    rt.clear();
  });
}

const place = (page: Page, x: number, y: number, color: number, hp = 0): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp), [x, y, color, hp] as const);

const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

test('a chain drawn with the mouse over two enemies of one color kills both and moves the hero', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await stillArena(page);
  const start = await chainSnapshot(page);
  const { x: hx, y: hy } = start.hero;
  const a = await place(page, hx + 1, hy, 0);
  const b = await place(page, hx + 2.2, hy, 0);
  // A different color next to the first link cannot join the chain.
  const other = await place(page, hx + 1.6, hy + 0.9, 1);
  const pa = await screen(page, hx + 1, hy), pb = await screen(page, hx + 2.2, hy), po = await screen(page, hx + 1.6, hy + 0.9);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.mouse.move(po.x, po.y, { steps: 4 });
  expect((await chainSnapshot(page)).chain).toEqual([a]);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a, b]);
  await page.screenshot({ path: 'artifacts/realtime-chain.png' });
  await page.mouse.up();
  await expect.poll(async () => (await chainSnapshot(page)).kills, { timeout: 5_000 }).toBe(2);
  const after = await chainSnapshot(page);
  expect(after.enemies.map(e => e.id)).not.toContain(a);
  expect(after.enemies.map(e => e.id)).not.toContain(b);
  expect(after.enemies.map(e => e.id)).toContain(other);
  // The hero stops on the last killed link; two attacked enemies give 2 × 0.5 energy.
  await expect.poll(async () => (await chainSnapshot(page)).moving).toBeNull();
  const end = await chainSnapshot(page);
  expect(Math.hypot(end.hero.x - (hx + 2.2), end.hero.y - hy)).toBeLessThan(0.05);
  expect(end.energy).toBeCloseTo(1, 5);
  expect(errors).toEqual([]);
});

test('a tough link spends the power; a survivor stays and the hero returns to the previous spot', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await stillArena(page);
  const { x: hx, y: hy } = (await chainSnapshot(page)).hero;
  const a = await place(page, hx + 1, hy, 2);
  const tough = await place(page, hx + 2.2, hy, 2, 2);
  const pa = await screen(page, hx + 1, hy), pt = await screen(page, hx + 2.2, hy);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(pt.x, pt.y, { steps: 6 });
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a, tough]);
  await page.mouse.up();
  // Power: 1 after the weak one (0 HP), +1 = 2 at the tough one with 2 HP — it dies.
  await expect.poll(async () => (await chainSnapshot(page)).kills, { timeout: 5_000 }).toBe(2);
  await expect.poll(async () => (await chainSnapshot(page)).moving).toBeNull();

  // A single tough enemy with 2 HP: power 1 wounds it to 1 HP; the hero comes back to where it stood.
  const here = (await chainSnapshot(page)).hero;
  const lone = await place(page, here.x - 1.2, here.y, 3, 2);
  const pl = await screen(page, here.x - 1.2, here.y);
  await page.mouse.move(pl.x, pl.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await chainSnapshot(page)).enemies.find(e => e.id === lone)?.hp, { timeout: 5_000 }).toBe(1);
  await expect.poll(async () => (await chainSnapshot(page)).moving).toBeNull();
  const end = await chainSnapshot(page);
  expect(end.kills).toBe(2);
  expect(Math.hypot(end.hero.x - here.x, end.hero.y - here.y)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test('Esc and the mouse back on the hero cancel the chain; focus slows the world while a chain is held', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await stillArena(page);
  const { x: hx, y: hy } = (await chainSnapshot(page)).hero;
  const a = await place(page, hx, hy + 1.1, 1);
  const pa = await screen(page, hx, hy + 1.1), ph = await screen(page, hx, hy);

  // Esc cancels: releasing afterwards strikes nobody.
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.keyboard.press('Escape');
  expect((await chainSnapshot(page)).chain).toEqual([]);
  await page.mouse.up();
  await page.waitForTimeout(300);
  let snap = await chainSnapshot(page);
  expect(snap.kills).toBe(0);
  expect(snap.enemies.map(e => e.id)).toContain(a);
  expect(Math.hypot(snap.hero.x - hx, snap.hero.y - hy)).toBeLessThan(0.01);

  // The mouse back on the hero cancels too.
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.mouse.move(ph.x, ph.y, { steps: 5 });
  expect((await chainSnapshot(page)).chain).toEqual([]);
  await page.mouse.up();

  // Focus: world time runs at about a quarter of real time while the chain is held.
  const rate = () => page.evaluate(async () => {
    const rt = (window as any).__realtime;
    const t0 = rt.snapshot().time, r0 = performance.now();
    await new Promise(resolve => setTimeout(resolve, 600));
    return (rt.snapshot().time - t0) / ((performance.now() - r0) / 1000);
  });
  const normal = await rate();
  expect(normal).toBeGreaterThan(0.6);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).focusing).toBe(true);
  const slowed = await rate();
  expect(slowed).toBeLessThan(normal * 0.5);
  snap = await chainSnapshot(page);
  expect(snap.focus).toBeLessThan(3);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(errors).toEqual([]);
});

// Stage E (user 07.10.2026): each new link refreshes focus to the full reserve, once per link per chain; a new chain
// starts full. Truncating and adding the same enemy again gives nothing back.
test('a new link refreshes focus to the full reserve; truncating and re-adding the same enemy does not', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await stillArena(page);
  expect(await page.evaluate(() => { const rt = (window as any).__realtime.params; return [rt.linkRefreshesFocus, rt.focusPerLink]; })).toEqual([true, 0]);
  const { x: hx, y: hy } = (await chainSnapshot(page)).hero;
  const a = await place(page, hx, hy + 1.1, 1), b = await place(page, hx, hy + 2.2, 1);
  const pa = await screen(page, hx, hy + 1.1), pb = await screen(page, hx, hy + 2.2);
  const focus = async () => (await chainSnapshot(page)).focus;
  // Drain: hold a chain on A, then cancel; a new chain on A starts with the full reserve again.
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.waitForTimeout(900);
  expect(await focus()).toBeLessThan(2.6);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.mouse.down();
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  expect(await focus()).toBeGreaterThan(2.9);
  // Drain again, then add B: back to the full reserve.
  await page.waitForTimeout(900);
  expect(await focus()).toBeLessThan(2.6);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a, b]);
  expect(await focus()).toBeGreaterThan(2.9);
  // Drain, cut back to A and add B again: no refill (each link once per chain).
  await page.waitForTimeout(900);
  const drained = await focus();
  expect(drained).toBeLessThan(2.6);
  await page.mouse.move(pa.x, pa.y, { steps: 6 });
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a]);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await chainSnapshot(page)).chain).toEqual([a, b]);
  expect(await focus()).toBeLessThanOrEqual(drained + 0.01);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(errors).toEqual([]);
});

// ---- Stage 3: arenas, buttons, the door, the boar, wolves ----

interface ArenaSnapshot extends ChainSnapshot {
  objects: { id: number; kind: 'button' | 'door'; x: number; y: number; pressed: boolean }[];
  chainLinks: { kind: 'enemy' | 'object'; id: number }[];
  stats: { kills: number; markedKills: number; boarHits: number; damageTaken: number; hitsTaken: number };
  goal: { done: number; total: number; label: string };
  lanes: number;
  packLines: number;
}

const arenaSnapshot = (page: Page): Promise<ArenaSnapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

/** Freezes the crowd in place; `clear` also removes every enemy (keep it off to keep the marked ones). */
async function freeze(page: Page, clear = true): Promise<void> {
  await page.evaluate(clear => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000;
    // No density floors (stage B: 28 before the goals, 28–48 after): only the placed enemies.
    rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    // No newcomer boars: a charge would move the frozen scene.
    rt.params.boarMax = 0;
    rt.clear(!clear);
  }, clear);
}

const teleport = (page: Page, x: number, y: number): Promise<void> =>
  page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [x, y] as const);

const placeKind = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

/** Press on the first point and drag to the others (one pointer move each, no points in between); the caller releases. */
async function chainAt(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const screens: { x: number; y: number }[] = [];
  for (const p of points) screens.push(await screen(page, p.x, p.y));
  await page.mouse.move(screens[0].x, screens[0].y);
  await page.mouse.down();
  for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y);
}

test('the menu opens each arena by key and by click without errors', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, null);
  const menu = page.getByTestId('menu');
  await expect(menu).toContainText('Убить 30');
  await expect(menu).toContainText('Нажать 3 кнопки');
  await expect(menu).toContainText('Отмеченные и дверь');
  await expect(menu.locator('summary')).toContainText('вопросы');
  await page.screenshot({ path: 'artifacts/realtime-menu.png' });
  const expected = [
    { id: 'kills', buttons: 0, marked: 0, goal: 'убито 0 / 30' },
    { id: 'buttons', buttons: 3, marked: 0, goal: 'кнопки 0 / 3' },
    { id: 'marked', buttons: 0, marked: 5, goal: 'отмеченные 0 / 5' },
  ];
  for (let i = 0; i < 3; i++) {
    if (i === 1) await page.getByTestId('arena-2').click(); else await page.keyboard.press(String(i + 1));
    await expect(menu).toBeHidden();
    const snap = await arenaSnapshot(page);
    expect(snap.arena).toBe(expected[i].id);
    expect(snap.objects.filter(o => o.kind === 'button')).toHaveLength(expected[i].buttons);
    expect(snap.objects.filter(o => o.kind === 'door')).toHaveLength(1);
    expect(snap.enemies.filter(e => e.marked)).toHaveLength(expected[i].marked);
    expect(snap.stage).toBe('goals');
    await expect(page.getByTestId('goal')).toHaveText(expected[i].goal);
    await page.waitForTimeout(1200);
    expect((await arenaSnapshot(page)).time).toBeGreaterThan(0.5);
    await page.screenshot({ path: `artifacts/realtime-arena-${i + 1}.png` });
    await page.keyboard.press('KeyM');
    await expect(menu).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('a button fires only when the chain ends on it; nothing follows a button; three buttons open the door', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 2);
  await freeze(page);
  const objects = (await arenaSnapshot(page)).objects;
  const [left, right, top] = objects.filter(o => o.kind === 'button');
  const door = objects.find(o => o.kind === 'door')!;

  // The closed door is not a link before the goals.
  await teleport(page, door.x, door.y - 1);
  await chainAt(page, [door]);
  expect((await arenaSnapshot(page)).chainLinks).toEqual([]);
  await page.mouse.up();

  // A chain of one button next to the hero presses it; the hero stands on it.
  await teleport(page, left.x + 1.2, left.y);
  await chainAt(page, [left]);
  await expect.poll(async () => (await arenaSnapshot(page)).chainLinks).toEqual([{ kind: 'object', id: left.id }]);
  await page.mouse.up();
  await expect.poll(async () => (await arenaSnapshot(page)).objects.find(o => o.id === left.id)!.pressed, { timeout: 5_000 }).toBe(true);
  await expect.poll(async () => (await arenaSnapshot(page)).moving).toBeNull();
  let snap = await arenaSnapshot(page);
  expect(Math.hypot(snap.hero.x - left.x, snap.hero.y - left.y)).toBeLessThan(0.05);
  expect(snap.goal.done).toBe(1);
  // Pressed once and for all: it is no longer a link.
  await teleport(page, left.x + 1.2, left.y);
  await chainAt(page, [left]);
  expect((await arenaSnapshot(page)).chainLinks).toEqual([]);
  await page.mouse.up();

  // The dash runs over the right button but the chain ends on an enemy behind it: not pressed.
  await teleport(page, right.x - 1.8, right.y);
  const a = await place(page, right.x - 0.7, right.y, 0);
  const b = await place(page, right.x + 0.7, right.y, 0);
  await chainAt(page, [{ x: right.x - 0.7, y: right.y }, { x: right.x + 0.7, y: right.y }]);
  await expect.poll(async () => (await arenaSnapshot(page)).chain).toEqual([a, b]);
  await page.mouse.up();
  await expect.poll(async () => (await arenaSnapshot(page)).kills, { timeout: 5_000 }).toBe(2);
  await expect.poll(async () => (await arenaSnapshot(page)).moving).toBeNull();
  snap = await arenaSnapshot(page);
  expect(snap.objects.find(o => o.id === right.id)!.pressed).toBe(false);
  expect(snap.goal.done).toBe(1);

  // Enemy → button: the button ends the chain, a same-colored enemy past it does not join.
  const c = await place(page, right.x, right.y + 1.2, 1);
  const d = await place(page, right.x - 1, right.y, 1);
  await chainAt(page, [{ x: right.x, y: right.y + 1.2 }, right, { x: right.x - 1, y: right.y }]);
  await expect.poll(async () => (await arenaSnapshot(page)).chainLinks).toEqual([{ kind: 'enemy', id: c }, { kind: 'object', id: right.id }]);
  await page.screenshot({ path: 'artifacts/realtime-button-chain.png' });
  await page.mouse.up();
  await expect.poll(async () => (await arenaSnapshot(page)).objects.find(o => o.id === right.id)!.pressed, { timeout: 5_000 }).toBe(true);
  await expect.poll(async () => (await arenaSnapshot(page)).moving).toBeNull();
  snap = await arenaSnapshot(page);
  expect(snap.enemies.map(e => e.id)).not.toContain(c);
  expect(snap.enemies.map(e => e.id)).toContain(d);
  expect(Math.hypot(snap.hero.x - right.x, snap.hero.y - right.y)).toBeLessThan(0.05);

  // The third button completes the goals: greed stage, the door opens, entering it wins.
  await teleport(page, top.x - 0.9, top.y);
  await chainAt(page, [top]);
  await page.mouse.up();
  await expect.poll(async () => (await arenaSnapshot(page)).stage, { timeout: 5_000 }).toBe('greed');
  await expect(page.getByTestId('goal')).toContainText('дверь открыта');
  await expect.poll(async () => (await arenaSnapshot(page)).moving).toBeNull();
  await teleport(page, door.x, door.y - 1);
  await chainAt(page, [door]);
  await expect.poll(async () => (await arenaSnapshot(page)).chainLinks).toEqual([{ kind: 'object', id: door.id }]);
  await page.mouse.up();
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  expect(errors).toEqual([]);
});

test('after the kill goal the door opens and a chain into it wins; another arena: marked kills and a jump into the door', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  await page.evaluate(() => { (window as any).__realtime.params.killGoal = 2; });
  const door = (await arenaSnapshot(page)).objects.find(o => o.kind === 'door')!;
  await teleport(page, door.x, door.y + 1.1);
  // Closed before the goals.
  await chainAt(page, [door]);
  expect((await arenaSnapshot(page)).chainLinks).toEqual([]);
  await page.mouse.up();
  const a = await place(page, door.x + 0.8, door.y + 1.1, 3);
  const b = await place(page, door.x + 0.8, door.y + 2.3, 3);
  await chainAt(page, [{ x: door.x + 0.8, y: door.y + 1.1 }, { x: door.x + 0.8, y: door.y + 2.3 }]);
  await expect.poll(async () => (await arenaSnapshot(page)).chain).toEqual([a, b]);
  await page.mouse.up();
  await expect.poll(async () => (await arenaSnapshot(page)).stage, { timeout: 5_000 }).toBe('greed');
  await expect.poll(async () => (await arenaSnapshot(page)).moving).toBeNull();
  await page.waitForTimeout(600);
  await teleport(page, door.x, door.y + 1.1);
  await chainAt(page, [door]);
  await expect.poll(async () => (await arenaSnapshot(page)).chainLinks.map(l => l.kind)).toEqual(['object']);
  await page.screenshot({ path: 'artifacts/realtime-door-open.png' });
  await page.mouse.up();
  const result = page.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 5_000 });
  await expect(result).toContainText('Победа');
  await expect(result).toContainText('В стадии жадности');
  await page.screenshot({ path: 'artifacts/realtime-victory.png' });
  expect((await arenaSnapshot(page)).status).toBe('victory');

  // «Другая арена» → menu → arena 3.
  await page.getByTestId('result-arenas').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.getByTestId('menu')).toBeHidden();
  await freeze(page, false);
  let snap = await arenaSnapshot(page);
  expect(snap.arena).toBe('marked');
  // A weak marked enemy killed by a chain counts towards the goal.
  const weak = snap.enemies.find(e => e.marked && e.hp === 0)!;
  await teleport(page, weak.x - 1, weak.y);
  await chainAt(page, [weak]);
  await page.mouse.up();
  await expect.poll(async () => (await arenaSnapshot(page)).goal.done, { timeout: 5_000 }).toBe(1);
  await expect(page.getByTestId('goal')).toHaveText('отмеченные 1 / 5');
  await expect.poll(async () => (await arenaSnapshot(page)).moving).toBeNull();
  // The rest through the hook; the door opens, a jump onto it wins.
  await page.evaluate(() => (window as any).__realtime.completeGoals());
  const door3 = (await arenaSnapshot(page)).objects.find(o => o.kind === 'door')!;
  await teleport(page, door3.x - 1.8, door3.y);
  await page.evaluate(() => (window as any).__realtime.setEnergy(2));
  await page.keyboard.press('Space');
  const pd = await screen(page, door3.x, door3.y);
  await page.mouse.click(pd.x, pd.y);
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  snap = await arenaSnapshot(page);
  expect(snap.status).toBe('victory');
  expect(errors).toEqual([]);
});

test('the boar announces its charge with a lane, shoves the crowd without hurting it and knocks the hero back', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  // Only the charge hurts here: a shoved enemy touching the hero must not spend its invulnerability first.
  await page.evaluate(() => { (window as any).__realtime.params.contactDamage = 0; });
  const { x: hx, y: hy, maxHp } = (await arenaSnapshot(page)).hero;
  const boar = await placeKind(page, hx - 3, hy, 0, 2, 'boar');
  // Two enemies of another color lie on the lane (half-width = body 0.32 at enemy size 0.8), a bit off its axis.
  const c1 = await place(page, hx - 1.8, hy + 0.2, 1);
  const c2 = await place(page, hx - 1.1, hy - 0.25, 1);
  const before = await arenaSnapshot(page);
  const pos = (snap: ArenaSnapshot, id: number) => snap.enemies.find(e => e.id === id)!;

  await expect.poll(async () => pos(await arenaSnapshot(page), boar).boar, { timeout: 5_000 }).toBe('windup');
  // The lane (and the «!») is drawn while the charge is announced; the boar stands.
  await expect.poll(async () => (await arenaSnapshot(page)).lanes).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-boar-lane.png' });
  let snap = await arenaSnapshot(page);
  expect(Math.hypot(pos(snap, boar).x - (hx - 3), pos(snap, boar).y - hy)).toBeLessThan(0.05);
  expect(snap.hero.hp).toBe(maxHp);

  await expect.poll(async () => (await arenaSnapshot(page)).stats.boarHits, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(400);
  snap = await arenaSnapshot(page);
  // Damage 2 and a knockback of ~1.5 along the charge (to +x).
  expect(snap.stats.damageTaken).toBe(2);
  expect(snap.hero.hp).toBe(maxHp - 2);
  expect(snap.hero.x - hx).toBeGreaterThan(1.0);
  // The crowd on the lane is shoved, not hurt: both alive with their HP, nobody killed.
  for (const id of [c1, c2]) {
    const was = pos(before, id), now = pos(snap, id);
    expect(now).toBeTruthy();
    expect(now.hp).toBe(was.hp);
    expect(Math.hypot(now.x - was.x, now.y - was.y)).toBeGreaterThan(0.25);
  }
  expect(snap.kills).toBe(0);
  // The boar is a chain link of its color with its HP.
  expect(pos(snap, boar).hp).toBe(2);
  expect(errors).toEqual([]);
});

test('wolves hit harder next to other wolves and their pack is drawn', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  const { x: hx, y: hy } = (await arenaSnapshot(page)).hero;
  // A lone wolf touching the hero: base damage 1.
  await placeKind(page, hx + 0.55, hy, 2, 0, 'wolf');
  await expect.poll(async () => (await arenaSnapshot(page)).stats.damageTaken, { timeout: 5_000 }).toBe(1);
  await page.evaluate(() => (window as any).__realtime.clear());
  // Two wolves next to each other (one pack line), not touching the hero.
  await placeKind(page, hx + 1.4, hy, 2, 0, 'wolf');
  await placeKind(page, hx + 1.0, hy + 0.9, 2, 0, 'wolf');
  await expect.poll(async () => (await arenaSnapshot(page)).packLines).toBe(1);
  expect((await arenaSnapshot(page)).stats.damageTaken).toBe(1);
  // A third wolf touches the hero with two packmates in the radius: every hit is 1 + 2 = 3.
  await placeKind(page, hx - 0.55, hy, 2, 0, 'wolf');
  await expect.poll(async () => (await arenaSnapshot(page)).stats.hitsTaken, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  const snap = await arenaSnapshot(page);
  expect(snap.packLines).toBe(3);
  expect(snap.stats.damageTaken).toBe(1 + 3 * (snap.stats.hitsTaken - 1));
  await page.screenshot({ path: 'artifacts/realtime-wolves.png' });
  expect(errors).toEqual([]);
});

test('a chain dragged from an empty spot starts only on an enemy within R of the hero (design answer 36)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  const { x: hx, y: hy } = (await arenaSnapshot(page)).hero;
  const R = await page.evaluate(() => (window as any).__realtime.params.linkRadius as number);
  const far = await place(page, hx, hy + R + 0.6, 0);
  const near = await place(page, hx + R - 0.3, hy, 0);
  // Press on an empty spot, drag onto the far enemy: no chain.
  await chainAt(page, [{ x: hx - 0.9, y: hy + 0.9 }, { x: hx, y: hy + R + 0.6 }]);
  expect((await arenaSnapshot(page)).chain).toEqual([]);
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect((await arenaSnapshot(page)).enemies.map(e => e.id)).toContain(far);
  // The same gesture onto the near one starts the chain.
  await chainAt(page, [{ x: hx - 0.9, y: hy + 0.9 }, { x: hx + R - 0.3, y: hy }]);
  await expect.poll(async () => (await arenaSnapshot(page)).chain).toEqual([near]);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // Defaults of the stage 2 answers: other colors at 35% opacity (strength 0.65), survivor knockback distance 0.8.
  const p = await page.evaluate(() => { const rt = (window as any).__realtime.params; return { dim: rt.dimStrength, mode: rt.dimMode, knock: rt.survivorKnockbackDistance }; });
  expect(p).toEqual({ dim: 0.65, mode: 'alpha', knock: 0.8 });
  expect(errors).toEqual([]);
});

// ---- Iteration 2, stage A: hero walking, flow field ----

interface WalkSnapshot extends ArenaSnapshot { flow: { builds: number; lastBuildMs: number } }
const walkSnapshot = (page: Page): Promise<WalkSnapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

/**
 * Holds a key (physical code) for `seconds` of game time: the software renderer may stall the
 * first frames, and a long frame is clamped, so wall-clock time is not a measure of movement.
 */
async function hold(page: Page, code: string, seconds: number): Promise<void> {
  const t0 = (await walkSnapshot(page)).time;
  await page.keyboard.down(code);
  await expect.poll(async () => (await walkSnapshot(page)).time, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(t0 + seconds);
  await page.keyboard.up(code);
}

/** Hero circle (a share of the body at size 1, not scaled) + the enemy's touch circle (body × enemy size × touch share). */
const touchDistance = (page: Page): Promise<number> =>
  page.evaluate(() => { const p = (window as any).__realtime.params; return p.bodyRadius * p.heroHitFactor + p.bodyRadius * p.enemyScale * p.touchFactor as number; });
/** Where the walking hero stops at an enemy («сквозь врагов» off): hero circle + the enemy's body circle (design answer 37). */
const blockDistance = (page: Page): Promise<number> =>
  page.evaluate(() => { const p = (window as any).__realtime.params; return p.bodyRadius * p.heroHitFactor + p.bodyRadius * p.enemyScale as number; });

test('the hero walks with WASD and arrows, stops at a wall and cannot walk through an enemy', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  // Arena 1: the wall x 3–4, y 2–5 left of the start. A limit of 1 keeps newcomers away.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.maxEnemies = 1; rt.teleport(5.5, 3.5); });
  const heroR = await page.evaluate(() => { const p = (window as any).__realtime.params; return p.bodyRadius * p.heroHitFactor as number; });
  // D walks right at 4 u/s of game time, straight (measured between two snapshots while the key is held).
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await walkSnapshot(page)).hero.x, { intervals: [20] }).toBeGreaterThan(5.55);
  const a = await walkSnapshot(page);
  await expect.poll(async () => (await walkSnapshot(page)).time, { intervals: [20] }).toBeGreaterThan(a.time + 0.3);
  let s = await walkSnapshot(page);
  await page.keyboard.up('KeyD');
  const speed = (s.hero.x - a.hero.x) / (s.time - a.time);
  expect(speed).toBeGreaterThan(3.4);
  expect(speed).toBeLessThan(4.2);
  expect(Math.abs(s.hero.y - 3.5)).toBeLessThan(0.01);
  await hold(page, 'ArrowUp', 0.2);
  s = await walkSnapshot(page);
  expect(s.hero.y).toBeLessThan(3.1);
  // Walking left into the wall: the hero stops at its face, never inside.
  await page.evaluate(() => (window as any).__realtime.teleport(5.5, 3.5));
  await page.keyboard.down('KeyA');
  await expect.poll(async () => (await walkSnapshot(page)).hero.x, { timeout: 10_000 }).toBeLessThan(4.4);
  await hold(page, 'KeyA', 0.5);
  s = await walkSnapshot(page);
  expect(s.hero.x).toBeGreaterThanOrEqual(4 + heroR - 0.01);
  expect(s.hero.x).toBeLessThan(4 + heroR + 0.05);
  await page.screenshot({ path: 'artifacts/realtime-walk-wall.png' });

  // «Сквозь врагов» off (on by default since stage D): an enemy is solid — the hero walks up to its
  // body circle and stops (design answer 37), outside its touch zone, so bumping into it does not hurt; the enemy is not shoved.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.heroThroughEnemies = false; rt.teleport(6, 6); });
  const block = await blockDistance(page);
  const id = await place(page, 8, 6, 0);
  await hold(page, 'KeyD', 1);
  s = await walkSnapshot(page);
  const enemy = s.enemies.find(e => e.id === id)!;
  expect(Math.hypot(enemy.x - 8, enemy.y - 6)).toBeLessThan(0.02);
  expect(s.hero.x).toBeGreaterThan(6.8);
  expect(enemy.x - s.hero.x).toBeGreaterThanOrEqual(block - 0.02);
  expect(s.hero.hp).toBe(s.hero.maxHp);
  // Walking kills nobody: only the chain kills.
  expect(s.kills).toBe(0);
  // «Сквозь врагов» on: the hero passes, parting the body aside.
  await page.evaluate(() => { (window as any).__realtime.params.heroThroughEnemies = true; });
  await hold(page, 'KeyD', 1);
  s = await walkSnapshot(page);
  expect(s.hero.x).toBeGreaterThan(8.5);
  expect(errors).toEqual([]);
});

test('an enemy behind a wall walks around it to the hero along the flow field; straight walking sticks', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.speedSpread = 0; rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000;
    rt.params.maxEnemies = 1; rt.params.boarMax = 0; rt.params.baseFloor = 0;
    rt.clear();
    // Arena 1: the hero left of the wall (x 3–4, y 2–5), the enemy right of it — no straight way.
    rt.teleport(2.2, 3.5);
  });
  await expect.poll(async () => (await walkSnapshot(page)).flow.builds, { timeout: 10_000 }).toBeGreaterThan(0);
  const touch = await touchDistance(page);
  const id = await place(page, 5, 3.5, 0);
  let wentAround = false;
  await expect.poll(async () => {
    const s = await walkSnapshot(page);
    const e = s.enemies.find(x => x.id === id)!;
    if (e.y < 2 || e.y > 5) wentAround = true;
    return Math.hypot(e.x - s.hero.x, e.y - s.hero.y);
  }, { timeout: 15_000, intervals: [100] }).toBeLessThan(touch + 0.1);
  expect(wentAround).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-flow-around-wall.png' });

  // Toggle off (stages 1–3): straight at the hero, the wall holds the enemy.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.pathfinding = false; rt.clear(); });
  const stuck = await place(page, 5, 3.5, 0);
  await page.waitForTimeout(3000);
  const s = await walkSnapshot(page);
  const e = s.enemies.find(x => x.id === stuck)!;
  expect(Math.hypot(e.x - s.hero.x, e.y - s.hero.y)).toBeGreaterThan(1.5);
  expect(errors).toEqual([]);
});

test('a crowd follows a walking hero around the den walls', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 3);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.contactDamage = 0; rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.burst(40); });
  await hold(page, 'KeyD', 1.5);
  const t = (await walkSnapshot(page)).time;
  await expect.poll(async () => (await walkSnapshot(page)).time, { timeout: 20_000 }).toBeGreaterThan(t + 6);
  const s = await walkSnapshot(page);
  const near = s.enemies.filter(e => Math.hypot(e.x - s.hero.x, e.y - s.hero.y) <= 3.5).length;
  expect(near).toBeGreaterThan(s.enemies.length / 3);
  await page.screenshot({ path: 'artifacts/realtime-flow-crowd.png' });
  expect(errors).toEqual([]);
});

// ---- Iteration 2, stage B: passable water, density floor, brushing past the crowd ----

interface WaterSnapshot extends WalkSnapshot { ripples: number; heroInWater: boolean }
const waterSnapshot = (page: Page): Promise<WaterSnapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

test('the pond is passable: the hero and an enemy wade in slowed, with ripples; water does not break a chain link', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  // Arena 1: the pond at (12.6, 4.6), radius 0.95.
  await page.evaluate(() => (window as any).__realtime.teleport(12.2, 4.6));
  const slow = await page.evaluate(() => (window as any).__realtime.params.waterSlow as number);
  expect(slow).toBe(0.5);
  expect((await waterSnapshot(page)).heroInWater).toBe(true);
  // Speed between two snapshots taken while the key is held (no key latency in the measure).
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await waterSnapshot(page)).hero.x, { intervals: [20] }).toBeGreaterThan(12.25);
  const a = await waterSnapshot(page);
  await expect.poll(async () => (await waterSnapshot(page)).time, { intervals: [20] }).toBeGreaterThan(a.time + 0.25);
  let s = await waterSnapshot(page);
  await page.keyboard.up('KeyD');
  const heroSpeed = (s.hero.x - a.hero.x) / (s.time - a.time);
  expect(heroSpeed).toBeGreaterThan(1.7);
  expect(heroSpeed).toBeLessThan(2.2);
  expect(s.heroInWater).toBe(true);
  expect(s.ripples).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-water.png' });

  // An enemy walks straight (pathfinding off) through the pond: half speed in the water.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.enemySpeed = 1.2; rt.params.pathfinding = false; rt.teleport(14.1, 4.6); });
  const id = await place(page, 10, 4.6, 0);
  const samples: { t: number; x: number }[] = [];
  await expect.poll(async () => {
    const w = await waterSnapshot(page);
    const e = w.enemies.find(x => x.id === id)!;
    samples.push({ t: w.time, x: e.x });
    return e.x;
  }, { timeout: 15_000, intervals: [50] }).toBeGreaterThan(13.3);
  const speedIn = (lo: number, hi: number): number => {
    const inside = samples.filter(p => p.x >= lo && p.x <= hi);
    const first = inside[0], last = inside[inside.length - 1];
    return (last.x - first.x) / (last.t - first.t);
  };
  const land = speedIn(10.2, 11.4), water = speedIn(11.9, 13.2);
  expect(land).toBeGreaterThan(1);
  expect(water / land).toBeGreaterThan(0.4);
  expect(water / land).toBeLessThan(0.62);

  // A chain link across the water: the first link stands in the pond, the second beyond it.
  await freeze(page);
  await page.evaluate(() => (window as any).__realtime.teleport(11.3, 4.6));
  const l1 = await place(page, 12.5, 4.6, 0), l2 = await place(page, 13.7, 4.6, 0);
  await chainAt(page, [{ x: 12.5, y: 4.6 }, { x: 13.7, y: 4.6 }]);
  await expect.poll(async () => (await walkSnapshot(page)).chain).toEqual([l1, l2]);
  await page.mouse.up();
  await expect.poll(async () => (await walkSnapshot(page)).kills, { timeout: 5_000 }).toBe(2);
  expect(errors).toEqual([]);
});

test('before the goals the density floor keeps at least 25 enemies alive; greed floors are not lower', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  const p = await page.evaluate(() => { const rt = (window as any).__realtime.params; return { floor: rt.baseFloor, phases: rt.phases.map((x: { floor: number }) => x.floor) }; });
  expect(p.floor).toBe(28);
  for (const f of p.phases) expect(f).toBeGreaterThanOrEqual(p.floor);
  // The hero must survive the crowd; shorter markers speed the top-up up.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.contactDamage = 0; rt.params.markerDelay = 0.3; });
  await expect.poll(async () => (await walkSnapshot(page)).enemies.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(25);
  // The arena is emptied (as after a long chain): the floor tops it up again, still before the goals.
  await page.evaluate(() => (window as any).__realtime.clear());
  await expect.poll(async () => (await walkSnapshot(page)).enemies.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(25);
  expect((await walkSnapshot(page)).stage).toBe('goals');
  expect(errors).toEqual([]);
});

test('the hero brushes past a crowd pressed against it without being hit (design answer 37)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  // A still row of touching enemies at y = 6 (bodies 0.02 apart: spacing 2 × body, 0.66 at enemy size 0.8; stage B had 0.82
  // at body 0.4); the hero walks down-right into it and slides along («сквозь врагов» off).
  const rowEnd = await page.evaluate(() => {
    const rt = (window as any).__realtime, step = rt.params.bodyRadius * rt.params.enemyScale * 2 + 0.02;
    rt.params.heroThroughEnemies = false;
    for (let i = 0; i < 8; i++) rt.place(5 + i * step, 6, i % 4, 0);
    rt.teleport(4.6, 5.2);
    return 5 + 7 * step as number;
  });
  const block = await blockDistance(page), touch = await touchDistance(page);
  expect(touch + 0.03).toBeLessThan(block);
  await page.keyboard.down('KeyS');
  await hold(page, 'KeyD', 1.2);
  await page.keyboard.up('KeyS');
  const s = await walkSnapshot(page);
  // Slid along the row (it ends at x ≈ 9.6), still pressed against it, never hit.
  expect(s.hero.x).toBeGreaterThan(6.8);
  expect(s.hero.x).toBeLessThan(rowEnd);
  const nearest = Math.min(...s.enemies.map(e => Math.hypot(e.x - s.hero.x, e.y - s.hero.y)));
  expect(nearest).toBeLessThan(block + 0.15);
  expect(nearest).toBeGreaterThanOrEqual(block - 0.02);
  expect(s.hero.hp).toBe(s.hero.maxHp);
  expect(s.stats.hitsTaken).toBe(0);
  expect(errors).toEqual([]);
});

// ---- Iteration 2, stage C: crystals, chain juice ----

type JuiceSnapshot = Omit<WalkSnapshot, 'stats' | 'objects'> & {
  objects: { id: number; kind: string; x: number; y: number; value?: number }[];
  stats: { kills: number; score: number; bestChain: number; crystals: number; finishers: number; hitsTaken: number };
  lastChain: { kills: number; hits: number; crystals: number; score: number } | null;
  comboShown: number;
};
const juiceSnapshot = (page: Page): Promise<JuiceSnapshot> => page.evaluate(() => (window as any).__realtime.snapshot());
const crystals = (s: JuiceSnapshot) => s.objects.filter(o => o.kind === 'crystal');

test('the 6th kill of one chain drops a crystal off the rest of the path; a long chain scores with the length bonus', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  // Arena 1, the free bottom row: the hero and seven enemies of one color 1 unit apart.
  await page.evaluate(() => (window as any).__realtime.teleport(1, 9.2));
  const ids: number[] = [];
  for (let i = 0; i < 7; i++) ids.push(await place(page, 2 + i, 9.2, 0));
  await chainAt(page, ids.map((_, i) => ({ x: 2 + i, y: 9.2 })));
  await expect.poll(async () => (await juiceSnapshot(page)).chain.length).toBe(7);
  expect(crystals(await juiceSnapshot(page))).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(async () => (await juiceSnapshot(page)).kills, { timeout: 8_000 }).toBe(7);
  await expect.poll(async () => (await juiceSnapshot(page)).moving).toBeNull();
  const s = await juiceSnapshot(page);
  // One crystal (6 kills → 1), worth the chain's final length; it fell off the rest of the path (the 6th spot → the 7th enemy).
  const c = crystals(s);
  expect(c).toHaveLength(1);
  expect(s.stats.crystals).toBe(1);
  expect(c[0].value).toBe(7);
  const dx = Math.max(7, Math.min(8, c[0].x)) - c[0].x, dy = 9.2 - c[0].y;
  expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(0.6);
  // Near the crowd (design 07.10.2026): within the drop radius 4 of the 6th kill at (7, 9.2).
  expect(Math.hypot(c[0].x - 7, c[0].y - 9.2)).toBeLessThanOrEqual(4.001);
  // Score: 10 × 7 × (1 + 0.1 × 7) = 119; the combo counter showed ×7.
  expect(s.lastChain).toMatchObject({ kills: 7, score: 119 });
  expect(s.stats.score).toBe(119);
  expect(s.stats.bestChain).toBe(7);
  expect(s.comboShown).toBe(7);
  await page.screenshot({ path: 'artifacts/realtime-crystal-drop.png' });
  expect(errors).toEqual([]);
});

test('a crystal is a link of any color: it changes the chain color, gives score when broken and can start a chain', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await freeze(page);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.params.finisherLinks = 3; rt.teleport(1, 9.2); });
  // Color 0 → crystal (worth 6) → color 1 → color 1.
  const a = await place(page, 2, 9.2, 0);
  const crystal = await page.evaluate(() => (window as any).__realtime.placeCrystal(3, 9.2, 6) as number);
  const b = await place(page, 4, 9.2, 1), c = await place(page, 5, 9.2, 1);
  // Without the crystal the color-1 enemy is no link after a color-0 one.
  const off = await place(page, 2.8, 8.2, 1);
  await chainAt(page, [{ x: 2, y: 9.2 }, { x: 2.8, y: 8.2 }]);
  expect((await juiceSnapshot(page)).chain).toEqual([a]);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await chainAt(page, [{ x: 2, y: 9.2 }, { x: 3, y: 9.2 }, { x: 4, y: 9.2 }, { x: 5, y: 9.2 }]);
  await expect.poll(async () => (await juiceSnapshot(page)).chain).toEqual([a, crystal, b, c]);
  await page.screenshot({ path: 'artifacts/realtime-crystal-chain.png' });
  await page.mouse.up();
  await expect.poll(async () => (await juiceSnapshot(page)).kills, { timeout: 8_000 }).toBe(3);
  await expect.poll(async () => (await juiceSnapshot(page)).moving).toBeNull();
  let s = await juiceSnapshot(page);
  expect(crystals(s)).toHaveLength(0);
  expect(s.enemies.map(e => e.id)).toContain(off);
  // Chain 10 × 3 × 1.3 = 39, the crystal 20 × 6 = 120; 3 kills reach the finisher threshold (lowered to 3).
  expect(s.lastChain).toMatchObject({ kills: 3, crystals: 1, score: 159 });
  expect(s.stats.finishers).toBe(1);
  expect(Math.hypot(s.hero.x - 5, s.hero.y - 9.2)).toBeLessThan(0.05);

  // A chain starts on a crystal next to the hero; the next enemy sets the color.
  await page.evaluate(() => (window as any).__realtime.teleport(10, 9.2));
  const start = await page.evaluate(() => (window as any).__realtime.placeCrystal(11, 9.2, 2) as number);
  const d = await place(page, 12, 9.2, 2);
  await chainAt(page, [{ x: 11, y: 9.2 }, { x: 12, y: 9.2 }]);
  await expect.poll(async () => (await juiceSnapshot(page)).chain).toEqual([start, d]);
  await page.mouse.up();
  await expect.poll(async () => (await juiceSnapshot(page)).kills, { timeout: 8_000 }).toBe(4);
  s = await juiceSnapshot(page);
  expect(s.lastChain).toMatchObject({ kills: 1, crystals: 1, score: 11 + 40 });
  expect(errors).toEqual([]);
});

// ---- Iteration 2, stage D: smaller enemies, walking through the crowd, the R circle (user 07.10.2026) ----

type CrowdSnapshot = JuiceSnapshot & { heroInCrowd: boolean; reachCircles: number; heroReachShown: boolean };
const crowdSnapshot = (page: Page): Promise<CrowdSnapshot> => page.evaluate(() => (window as any).__realtime.snapshot());

test('the hero walks through a pile of five enemies, slowed to about 0.7 in it, and the touch still hurts', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  // Stage D defaults: walking through enemies, ×0.7 in a crowd, enemies ×0.8.
  const p = await page.evaluate(() => { const rt = (window as any).__realtime.params; return { through: rt.heroThroughEnemies, slow: rt.crowdSlow, scale: rt.enemyScale }; });
  expect(p).toEqual({ through: true, slow: 0.7, scale: 0.8 });
  await freeze(page);
  // Arena 1, the free bottom lane y = 9: a plus-shaped pile of five standing enemies at x = 6.5; the centre one is right on the way.
  const spots = [[6.5, 9], [5.85, 9], [7.15, 9], [6.5, 8.35], [6.5, 9.65]];
  await page.evaluate(() => (window as any).__realtime.teleport(2.5, 9));
  const ids: number[] = [];
  for (const [x, y] of spots) ids.push(await place(page, x, y, ids.length % 4));
  const samples: { t: number; x: number; crowd: boolean }[] = [];
  let crowdSeen = false;
  await page.keyboard.down('KeyD');
  await expect.poll(async () => {
    const s = await crowdSnapshot(page);
    samples.push({ t: s.time, x: s.hero.x, crowd: s.heroInCrowd });
    if (s.heroInCrowd) crowdSeen = true;
    return s.hero.x;
  }, { timeout: 15_000, intervals: [20] }).toBeGreaterThan(8.6);
  await page.keyboard.up('KeyD');
  expect(crowdSeen).toBe(true);
  // Speed over consecutive samples: before the pile (free) and while both samples are in the crowd.
  type Sample = typeof samples[number];
  const speed = (keep: (a: Sample, b: Sample) => boolean): number => {
    let dx = 0, dt = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (b.t > a.t && keep(a, b)) { dx += b.x - a.x; dt += b.t - a.t; }
    }
    return dx / dt;
  };
  const free = speed((a, b) => !a.crowd && !b.crowd && a.x > 2.6 && b.x < 5);
  const crowd = speed((a, b) => a.crowd && b.crowd);
  expect(free).toBeGreaterThan(3.4);
  expect(crowd / free).toBeGreaterThan(0.6);
  expect(crowd / free).toBeLessThan(0.8);
  const s = await crowdSnapshot(page);
  // Through, not around and not bulldozing: past the pile, every enemy alive and still near its spot (parted aside).
  expect(s.hero.x).toBeGreaterThan(8.6);
  expect(Math.abs(s.hero.y - 9)).toBeLessThan(0.05);
  for (const [i, id] of ids.entries()) {
    const e = s.enemies.find(x => x.id === id);
    expect(e).toBeTruthy();
    expect(Math.hypot(e!.x - spots[i][0], e!.y - spots[i][1])).toBeLessThan(0.8);
  }
  // Walking kills nobody; the touch hurts on the way through (a risk, not a free way out).
  expect(s.kills).toBe(0);
  expect(s.stats.hitsTaken).toBeGreaterThanOrEqual(1);
  expect(s.hero.hp).toBeLessThan(s.hero.maxHp);
  await page.screenshot({ path: 'artifacts/realtime-through-crowd.png' });
  expect(errors).toEqual([]);
});

// Design 07.10.2026: only enemies ahead slow the hero; one touching him from behind does not, or there is no getting away.
// The enemy press circle is back to about 0.59 (enemies are drawn smaller, misses must not grow).
test('an enemy touching the hero from behind does not slow his walk away; the enemy press circle stays 0.59', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  const press = await page.evaluate(() => { const rt = (window as any).__realtime.params; return rt.pickSlack * 0.45 * rt.enemyScale; });
  expect(press).toBeGreaterThan(0.58);
  expect(press).toBeLessThan(0.6);
  await freeze(page);
  await page.evaluate(() => (window as any).__realtime.teleport(4, 9));
  await place(page, 3.55, 9, 0);
  const start = await crowdSnapshot(page);
  let crowdSeen = false;
  await page.keyboard.down('KeyD');
  const samples: { t: number; x: number }[] = [];
  await expect.poll(async () => {
    const s = await crowdSnapshot(page);
    samples.push({ t: s.time, x: s.hero.x });
    if (s.heroInCrowd) crowdSeen = true;
    return s.hero.x;
  }, { timeout: 10_000, intervals: [20] }).toBeGreaterThan(6);
  await page.keyboard.up('KeyD');
  expect(crowdSeen).toBe(false);
  const moving = samples.filter(x => x.x > start.hero.x + 0.05);
  const v = (moving.at(-1)!.x - moving[0].x) / (moving.at(-1)!.t - moving[0].t);
  expect(v).toBeGreaterThan(3.4);
  expect(errors).toEqual([]);
});

test('the reach circle R is drawn around the hero without a chain; in a chain also around the last link', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  const R = await page.evaluate(() => (window as any).__realtime.params.linkRadius as number);
  expect(R).toBe(1.875);
  await freeze(page);
  const { x: hx, y: hy } = (await crowdSnapshot(page)).hero;
  const id = await place(page, hx + 1.6, hy, 0);
  // No chain: one circle R — around the hero.
  await expect.poll(async () => { const s = await crowdSnapshot(page); return [s.chain.length, s.heroReachShown, s.reachCircles]; }).toEqual([0, true, 1]);
  await page.screenshot({ path: 'artifacts/realtime-reach.png' });
  // A chain: the hero's circle plus the circle around the last link.
  await chainAt(page, [{ x: hx + 1.6, y: hy }]);
  await expect.poll(async () => { const s = await crowdSnapshot(page); return [s.chain, s.heroReachShown, s.reachCircles]; }).toEqual([[id], true, 2]);
  await page.screenshot({ path: 'artifacts/realtime-reach-chain.png' });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await crowdSnapshot(page)).reachCircles).toBe(1);
  // The panel shows the new defaults.
  await page.keyboard.press('Backquote');
  await expect(page.locator('[data-param="linkRadius"] output')).toContainText('1.875');
  await expect(page.locator('[data-param="enemyScale"] output')).toContainText('0.80');
  await expect(page.locator('[data-param="crowdSlow"] output')).toContainText('0.70');
  expect(errors).toEqual([]);
});
