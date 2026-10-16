import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import { gameWait } from './realtimeFrames';

/**
 * Task 40 «Гарнизон, шаг 1б» (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md, 2 and 8): the sandbox «Ров»
 * (`?arena=25`) with real mouse input — the keymaster's prisoner: the pointer over it says «в кандалах» and a press on it takes
 * nothing; a chain drawn across the shackle cuts it after the dash; the next chain takes the freed prisoner; the browser fight
 * replays in Node to the same hash. The rules: `npm run test:realtime-keymaster`. The look of the shackle and the prisoner is the
 * ui session's (the placeholder line of the tethers is drawn now).
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page, query: string): Promise<void> {
  await page.goto(`/?sandbox=1${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

test('task 40: «Ров» — the prisoner: «в кандалах» at the pointer, a press takes nothing; a chain across the shackle cuts it; the next chain takes the prisoner; the fight replays in Node', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=25');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-moat');
  // Only what the test places acts: no newcomers, bodies stand, nothing hurts the hero; the hero below the moat.
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(5, 7.6);
  });
  // The keymaster across the moat and one plain body 2.5 to its side: the first shackle 3 s after the keymaster appears.
  const keymaster = await place(page, 8, 2.4, 1, 1, 'keymaster'), prisoner = await place(page, 10.5, 2.4, 0, 0, 'basic');
  await gameWait(page, 3.3);
  type Snap = { enemies: { id: number; x: number; y: number }[]; tethers: { list: { holder: number; held: number; kind: string }[] }; chain: number[]; loop: { hintText: string | null } };
  const read = async (): Promise<Snap> => snap(page);
  expect((await read()).tethers.list).toEqual([{ holder: keymaster, held: prisoner, kind: 'shackle' }]);
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = (await read()).enemies.find(x => x.id === id)!; return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  // The hero next to the prisoner, on its side of the moat (the jump is the player's; the test puts him there).
  await page.evaluate(() => (window as any).__realtime.teleport(10.5, 1.2));
  const pp = await at(prisoner);
  await page.mouse.move(pp.x, pp.y);
  await expect.poll(async () => (await read()).loop.hintText).toBe('в кандалах');
  await page.mouse.down();
  await page.mouse.up();
  expect((await read()).chain).toEqual([]);
  await page.screenshot({ path: 'artifacts/realtime-keymaster-prisoner.png' });
  // A chain across the shackle's middle: two plain links of colour 2 on both sides of it.
  const a = await place(page, 9.25, 1.5, 2, 0, 'basic'), b = await place(page, 9.25, 3.3, 2, 0, 'basic');
  await page.evaluate(() => (window as any).__realtime.teleport(9.25, 0.6));
  const pa = await at(a), pb = await at(b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await read()).chain).toEqual([a, b]);
  // While the chain is held the shackle stands (the highlight shows the cut: the placeholder line turns red).
  await expect.poll(async () => (await snap(page)).tethers.cut).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-keymaster-cut-held.png' });
  await page.mouse.up();
  await expect.poll(async () => (await read()).tethers.list.length, { timeout: 5_000 }).toBe(0);
  // The next chain takes the freed prisoner.
  await page.evaluate(() => (window as any).__realtime.teleport(10.5, 1.2));
  const free = await at(prisoner);
  await page.mouse.move(free.x, free.y);
  await page.mouse.down();
  await expect.poll(async () => (await read()).chain).toEqual([prisoner]);
  await page.mouse.up();
  await expect.poll(async () => (await read()).enemies.some(e => e.id === prisoner), { timeout: 5_000 }).toBe(false);
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});
