import { type Page } from '@playwright/test';
import { test, expect, takeStartGift } from './realtimeTest';
import { untilFrame } from './realtimeFrames';

/**
 * Task 12 «Отмеченные — атаман или орда» (design 13.10.2026; docs/realtime-slice.md): the view of the goal layouts at 1280×720 in the
 * sandbox with the toggle «Отмеченные: атаман или орда» (`markedGoals`) on. «Отмеченные и дверь» (the den) is a horde: one ring of
 * dashes round the crowd of marked enemies, no reticle on each. «Стрелковая гряда», «Круг шамана» and «Брод» have one leader: a
 * gold crown over its head and the HP plate on its chest, drawn larger (the sim's `enemyArtScale`). The menu says each arena's goal
 * from its layout. Off, the old arenas: no crown, no ring.
 */

interface Snap {
  arena: string;
  enemies: { id: number; x: number; y: number; marked: boolean; leader: boolean; hp: number }[];
  markedView: { hordeRing: boolean; hordeMembers: number; reticles: number; crowns: number; horde: { x: number; y: number; r: number } | null };
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());

const ARENAS = [
  { id: 'marked', name: 'Отмеченные и дверь', horde: true, shot: 'den' },
  { id: 'archers', name: 'Стрелковая гряда', horde: false, shot: 'ridge' },
  { id: 'shaman-circle', name: 'Круг шамана', horde: false, shot: 'shaman' },
  { id: 'ford', name: 'Брод', horde: false, shot: 'ford' },
] as const;

async function openSandbox(page: Page, markedGoals: boolean): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  // The toggle before the fight starts: the layout is chosen when the world is made.
  await page.evaluate(on => { (window as any).__realtime.params.markedGoals = on; }, markedGoals);
  return errors;
}

/**
 * Opens the arena by its menu button (the menu is reopened by M), a quiet field: nobody walks or comes, the start layout stays.
 * Returns the first frame the renderer drew for the new world: the snapshot reads the world at once but `markedView` from the
 * last draw, so the frame right after the click can pair the new arena with the old one's view (the den's horde, no crown). The
 * wait is for the view to agree with the sim (one crown per leader, the ring when the arena has a horde); a view that never draws
 * them still returns its reading after 5 s of game time and fails the checks with it.
 */
async function openArena(page: Page, name: string, id: string): Promise<Snap> {
  if (!(await page.getByTestId('menu').isVisible())) await page.keyboard.press('KeyM');
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.locator('.rt-arena', { hasText: name }).first().click();
  await expect(page.getByTestId('menu')).toBeHidden();
  await expect.poll(async () => (await snap(page)).arena).toBe(id);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of Object.entries({ enemySpeed: 0, wolfSpeed: 0, speedSpread: 0, contactDamage: 0, baseIntervalMin: 1000, baseIntervalMax: 1000, baseFloor: 0 })) rt.setParam(k, v);
  });
  return untilFrame(page, (s: Snap, _a: null, late: boolean) => {
    const drawn = s.markedView.crowns === s.enemies.filter(e => e.leader).length && s.markedView.hordeRing === !!s.markedView.horde;
    return late || (s.enemies.some(e => e.marked) && drawn) ? s : undefined;
  }, null, 5);
}

test('task 12: the den is a horde — one ring round the crowd, no reticle on each; the ridge, the shaman circle and the ford have one leader — a crown and its HP plate', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openSandbox(page, true);
  for (const arena of ARENAS) {
    const s = await openArena(page, arena.name, arena.id);
    const marked = s.enemies.filter(e => e.marked), leaders = s.enemies.filter(e => e.leader);
    if (arena.horde) {
      expect(s.markedView.horde, `${arena.id}: the sim's horde`).not.toBeNull();
      expect(marked.length).toBeGreaterThanOrEqual(8);
      expect(s.markedView.hordeRing).toBe(true);
      expect(s.markedView.hordeMembers).toBe(marked.length);
      expect(s.markedView.reticles).toBe(0);
      expect(s.markedView.crowns).toBe(0);
    } else {
      expect(s.markedView.horde).toBeNull();
      expect(leaders.length, `${arena.id}: one leader`).toBe(1);
      expect(leaders[0].marked).toBe(true);
      expect(leaders[0].hp).toBeGreaterThan(1);
      expect(s.markedView.crowns).toBe(1);
      expect(s.markedView.hordeRing).toBe(false);
    }
    // The shot: the hero a few steps from the leader (the ford is wider than the screen — the camera follows the hero).
    if (!arena.horde) {
      const at = leaders[0];
      await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [Math.max(1, at.x - 4), at.y] as const);
      await untilFrame(page, (_s: Snap, _a: null, late: boolean) => (late ? true : undefined), null, 0.5);
    }
    await page.mouse.move(640, 700);
    await page.screenshot({ path: `artifacts/realtime-marked-${arena.shot}.png` });
  }
  expect(errors).toEqual([]);
});

test('task 12: with the toggle off the old arenas play — no crown, no horde ring', async ({ page }) => {
  const errors = await openSandbox(page, false);
  for (const arena of ARENAS) {
    const s = await openArena(page, arena.name, arena.id);
    expect(s.enemies.some(e => e.leader)).toBe(false);
    expect(s.markedView.horde).toBeNull();
    expect(s.markedView.hordeRing).toBe(false);
    expect(s.markedView.crowns).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('task 12, the run: the fight plays the run\'s flag; `__realtime.params` tunes the fight itself; the sandbox\'s saved panel never takes the flag', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.includes('realtime-params')) localStorage.removeItem(key); });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 10);
  await takeStartGift(page);
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  // The hook is the fight's own values: the run's flag is on there, and a write reaches the fight (nobody walks any more).
  expect(await page.evaluate(() => (window as any).__realtime.params.markedGoals)).toBe(true);
  await untilFrame(page, (s: Snap) => (s.enemies.length >= 3 ? true : undefined), null, 8);
  await page.evaluate(() => { const p = (window as any).__realtime.params; p.enemySpeed = 0; p.wolfSpeed = 0; p.speedSpread = 0; });
  const before = (await snap(page)).enemies;
  const after = await untilFrame(page, (s: Snap, _a: null, late: boolean) => (late ? s : undefined), null, 1.5);
  for (const e of after.enemies) {
    const was = before.find(b => b.id === e.id);
    if (was) expect(Math.hypot(e.x - was.x, e.y - was.y), `enemy ${e.id} stands`).toBeLessThan(0.1);
  }
  // Out of the fight, then the sandbox: its saved panel and its values have no run flag (the default — off).
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 15_000 });
  const saved = await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('realtime-params')).map(k => localStorage.getItem(k) ?? ''));
  for (const text of saved) expect(JSON.parse(text).markedGoals ?? false, 'the saved panel').toBe(false);
  await page.goto('/?sandbox=1');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  expect(await page.evaluate(() => (window as any).__realtime.params.markedGoals)).toBe(false);
  expect(errors).toEqual([]);
});
