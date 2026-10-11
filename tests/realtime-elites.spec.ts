import { test, expect, type Page } from '@playwright/test';

/**
 * The view of elite armour and elite behaviours (package «Урон имеет значение», docs/realtime-damage.md,
 * docs/realtime-elite-behaviors.md): plate pips, the window pulse, the «−1 пластина» plan badge, the plaque «Элита · …»,
 * the goal-line badge, the column line and the elite boar's second lane. Runs through playwright.realtime.config.ts only.
 * The rules themselves are checked in Node (sim/eliteArmor.spec.ts, sim/eliteBehaviors.spec.ts).
 */
interface EliteView { pips: number; filledPips: number; windows: number; hotWindows: number; planPlates: number; formationLines: number; secondLanes: number; plaques: number; plaquesSeen: number; plaqueText: string; stripFlashes: number; downFlashes: number; cleanBreaks: number; edgeArrows: number }
interface Snap { arena: string; chain: number[]; kills: number; enemies: { id: number; kind: string; x: number; y: number; elite: boolean; armor: { plates: number; max: number; open?: number; clean?: number } | null }[]; eliteView: EliteView }
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

async function openArena(page: Page, errors: string[], n: number): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press(String(n));
  await expect(page.getByTestId('menu')).toBeHidden();
}

/** No newcomers, the package on, touches do not hurt; `speed` > 0 lets enemies walk. */
async function setup(page: Page, params: Record<string, unknown> = {}, speed = 0): Promise<void> {
  await page.evaluate(([params, speed]) => {
    const rt = (window as any).__realtime;
    const all: Record<string, unknown> = { enemySpeed: speed, speedSpread: 0, baseIntervalMin: 20, baseIntervalMax: 20, baseFloor: 0, contactDamage: 0, eliteArmor: true, eliteBehaviors: true, elitePlates: 3, eliteWindow: 6, ...params };
    for (const [k, v] of Object.entries(all)) rt.setParam(k, v);
    rt.clear(false);
    rt.teleport(6, 5);
  }, [params, speed] as const);
}

const placeElite = (page: Page, x: number, y: number, kind: string, color = 0, hp = 2): Promise<number> =>
  page.evaluate(([x, y, kind, color, hp]) => (window as any).__realtime.place(x, y, color, hp, kind, true), [x, y, kind, color, hp] as const);

test('armoured elite: plate pips, the plaque for 1.5 s, the goal badge, the plan badge «−1 пластина», then the window pulse', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await setup(page, { elitePlates: 1 });
  const id = await placeElite(page, 8.4, 5, 'basic');
  await expect.poll(async () => (await snap(page)).eliteView.pips).toBe(1);
  let s = await snap(page);
  expect(s.eliteView.filledPips).toBe(1);
  expect(s.eliteView.plaquesSeen).toBe(1);
  expect(s.eliteView.plaqueText).toBe('Элита · Ведёт строем');
  await expect(page.getByTestId('elite-badge')).toHaveText('Элита ×1');
  await page.screenshot({ path: 'artifacts/realtime-elite-plates.png' });
  await expect.poll(async () => (await snap(page)).eliteView.plaques, { timeout: 4_000 }).toBe(0);
  // The chain through the elite: its link shows the plate badge, not the kill cross or «!».
  const at = await screen(page, 8.4, 5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await expect.poll(async () => (await snap(page)).eliteView.planPlates).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-elite-plan.png' });
  await page.mouse.up();
  // The dash takes the only plate: the window opens (the pulse; the first second is the hotter one), the elite lives.
  await expect.poll(async () => (await snap(page)).eliteView.windows, { timeout: 5_000 }).toBe(1);
  s = await snap(page);
  expect(s.enemies.find(e => e.id === id)?.armor?.plates).toBe(0);
  expect(s.eliteView.stripFlashes).toBe(1);
  expect(s.eliteView.filledPips).toBe(0);
  expect(s.eliteView.planPlates).toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-elite-window.png' });
  expect(errors).toEqual([]);
});

test('window: the pulse is hotter in the first second (one sign), then the normal pulse', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await setup(page, { elitePlates: 1, eliteWindow: 6 });
  const id = await placeElite(page, 8.4, 5, 'basic');
  const at = await screen(page, 8.4, 5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).eliteView.hotWindows, { timeout: 5_000 }).toBe(1);
  await expect.poll(async () => { const v = (await snap(page)).eliteView; return v.windows === 1 && v.hotWindows === 0; }, { timeout: 5_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('column: the leading elite draws a line through its followers', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await setup(page, { elitePlates: 2 }, 1.2);
  await placeElite(page, 12, 5, 'basic', 0, 2);
  for (const [x, y] of [[13, 4], [13.5, 6], [14, 5]]) await page.evaluate(([x, y]) => (window as any).__realtime.place(x, y, 0, 0, 'basic'), [x, y] as const);
  await expect.poll(async () => (await snap(page)).eliteView.formationLines, { timeout: 8_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-elite-column.png' });
  expect(errors).toEqual([]);
});

test('elite boar: the second charge is a new lane, filled by the 0.6 s windup', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await setup(page, { elitePlates: 2 }, 0.5);
  await placeElite(page, 12, 5, 'boar', 1, 3);
  await expect.poll(async () => (await snap(page)).eliteView.secondLanes, { timeout: 15_000, intervals: [30] }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-elite-boar-second.png' });
  expect(errors).toEqual([]);
});
