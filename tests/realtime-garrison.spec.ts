import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';

/**
 * Task 38 «Гарнизон, шаг 1а» — the view (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md): the leash on the field
 * (red with the cut mark while the drawn chain's dash would cut it, a snap after the dash), the hound's frenzy, the Castellan's
 * lane and boss bar; the way from the forest's final relic to «Предместье» (the HP bar fills to full) and the garrison's map (cold
 * stone, «Караульня» and «Кастелян» named), the level's word in the header. Real input: the chain with the mouse, the run's own
 * buttons; the run is walked in Node to the forest's final (its own commands). The rules: core's suites and tests (task 38).
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

/** Only what the test places acts (no newcomers, bodies stand, nothing hurts the hero); the hero at `hero`. */
async function quiet(page: Page, hero: { x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(x, y);
  }, [hero.x, hero.y] as const);
}

const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

test('task 38 view: «Псарня» — the leash drawn, red with the cut mark while a chain across it is held; after the dash it snaps and the hound shows its frenzy', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=21');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-kennel');
  await quiet(page, { x: 4, y: 5 });
  const handler = await place(page, 8.5, 5, 1, 1, 'handler');
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 1.5));
  await gameWait(page, 2.5);
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 0));
  await gameWait(page, 0.1);
  let s = await snap(page);
  expect(s.tethers.lines).toBe(2);
  expect(s.tethers.cut).toBe(0);
  const h = s.enemies.find((e: any) => e.id === handler)!, hound = s.enemies.find((e: any) => e.id === s.tethers.list[0].held)!;
  const mx = (h.x + hound.x) / 2, my = (h.y + hound.y) / 2, d = Math.hypot(hound.x - h.x, hound.y - h.y), px = -(hound.y - h.y) / d, py = (hound.x - h.x) / d;
  const a = await place(page, mx + px * 0.9, my + py * 0.9, 0, 0, 'basic'), b = await place(page, mx - px * 0.9, my - py * 0.9, 0, 0, 'basic');
  // Bodies of colour 2 round the hound: its frenzy will have prey (held by the cold, they stand).
  const crowd = await page.evaluate(([x, y]) => { const rt = (window as any).__realtime; const ids = [rt.place(x + 1.1, y, 2, 0, 'basic'), rt.place(x + 1.1, y + 0.8, 2, 0, 'basic')]; for (const id of ids) rt.chill(id, 30); return ids; }, [hound.x, hound.y] as const);
  void crowd;
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [mx + px * 1.9, my + py * 1.9] as const);
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = (await snap(page)).enemies.find((x: any) => x.id === id)!; return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  const pa = await at(a);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  const pb = await at(b);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await snap(page)).chain).toEqual([a, b]);
  // The leash the dash will cut: red, with the cut mark on the dash's path.
  await expect.poll(async () => (await snap(page)).tethers.marks).toBeGreaterThanOrEqual(1);
  { const t = (await snap(page)).tethers; expect(t.marks).toBe(t.cut); }
  await page.screenshot({ path: 'artifacts/realtime-garrison-leash-held.png' });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).tethers.snaps, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  // The frenzy: the red ring round the hound (its 6 s), the crowd of colour 2 its prey.
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 1.5));
  const frenzy = await untilFrame(page, (sn, _a: number, late) => sn.garrison.frenzy > 0 || late ? sn.garrison.frenzy : undefined, 0, 4);
  expect(frenzy).toBeGreaterThanOrEqual(1);
  await gameWait(page, 0.4);
  await page.screenshot({ path: 'artifacts/realtime-garrison-frenzy.png' });
  expect(errors).toEqual([]);
});

test('task 38 view: «Двор кастеляна» — the boss bar and the goal name the Castellan, «Спустить пса» shows its lane', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=24');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-castellan');
  await expect.poll(async () => (await snap(page)).bossBar?.visible ?? false).toBe(true);
  await expect(page.getByTestId('boss-bar')).toBeVisible();
  await expect(page.locator('[data-testid="hud"]')).toContainText('Кастелян');
  // A hound winds up its lunge when the hero is within its reach: the hero by the first hound (touches do not hurt).
  await page.evaluate(() => {
    const rt = (window as any).__realtime, h = rt.snapshot().enemies.find((e: any) => e.kind === 'hound');
    rt.setParam('contactDamage', 0);
    rt.teleport(h.x + (h.x < 8 ? 2 : -2), h.y + 0.5);
  });
  const lane = await untilFrame(page, (sn, _a: number, late) => sn.garrison.lunges > 0 || late ? sn.garrison.lunges : undefined, 0, 8);
  expect(lane).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-garrison-castellan.png' });
  expect(errors).toEqual([]);
});

test('task 38 view: a run walked in Node to the forest final\'s relic — the relic taken, «Предместье» fills the HP bar, «В гарнизон» opens the cold garrison map with «Караульня» and «Кастелян»; the header says «Лес», then «Гарнизон»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); });
  // The run's own commands in Node (metaWalk.testkit.ts): every fight won, every screen chosen; stop at the final's relic screen.
  let relic: RtRunState | null = null;
  walkRun({ k: 3, create: { gift: 'full', seeded: true, garrison: true }, each: state => { if (!relic && state.pending?.kind === 'talisman' && state.pending.source === 'level') relic = structuredClone(state); } });
  expect(relic, 'the walk reached the final\'s relic').not.toBeNull();
  // A hurt hero (the walk wins every fight unhurt): «Предместье» has something to heal.
  const hurt = { ...relic!, hp: 4 };
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(hurt)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run-title')).toHaveText('Лес');
  await expect(page.getByTestId('run-talisman')).toContainText('Реликвия на выбор');
  await page.screenshot({ path: 'artifacts/realtime-garrison-relic.png' });
  await page.locator('[data-testid="run-talisman"] button[data-action="talisman"][data-option]:not([data-option=""])').first().click();
  // «Предместье»: HP to full, the bar fills from 4.
  await expect(page.getByTestId('run-outskirts')).toBeVisible();
  const state = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(state.hp).toBe(state.maxHp);
  await expect(page.getByTestId('outskirts-hp')).toHaveText(`HP ${state.maxHp} / ${state.maxHp}`);
  await expect(page.locator('[data-testid="outskirts-bar"] i')).toHaveAttribute('style', /width: ?100(\.0)?%/, { timeout: 3_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'artifacts/realtime-garrison-outskirts.png' });
  await page.getByTestId('run-garrison').click();
  await expect(page.getByTestId('run-outskirts')).toBeHidden();
  await expect(page.getByTestId('run-title')).toHaveText('Гарнизон');
  await expect(page.getByTestId('run-map')).toHaveAttribute('data-level', '2');
  await expect(page.getByTestId('map-cap-checkpoint')).toHaveText('Караульня');
  await expect(page.getByTestId('map-cap-boss').first()).toHaveText('Кастелян');
  await page.screenshot({ path: 'artifacts/realtime-garrison-map.png' });
  expect(errors).toEqual([]);
});
