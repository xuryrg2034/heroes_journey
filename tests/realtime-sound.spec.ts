import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { untilFrame } from './realtimeFrames';

/**
 * The run's sound (design 14.10.2026; docs/realtime-slice.md): the gear of the run map holds «Звук» (on) and «Громкость» (0.3) —
 * a view setting in its own localStorage key, never a Param. The run plays the default Params, so before this the sandbox panel
 * was the only switch and the run could not be muted. Real input at 1280×720: the gear's switch and slider, a reload, a run fight
 * with a real chain press — the tones asked for (`snapshot().sound.tones`, `ChainAudio.requested`) count only with the sound on.
 * The sandbox keeps its panel. The storage itself (defaults, junk, no storage) is checked in Node: `npm run test:realtime-sound`.
 */
const KEY = 'ashen-oath-realtime-sound';
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The run's map after the gift (seed 10), storage cleared — or kept, when `keep`. */
async function runMap(page: Page, keep = false): Promise<void> {
  await page.goto('/');
  if (!keep) { await page.evaluate(() => localStorage.clear()); await page.reload(); }
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 10);
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
}

/**
 * Enters the first battle node; in the fight nobody walks or hurts (the run fight's own params); a real chain press on the enemy
 * nearest the hero that stands on the open field (not under the HUD) — its hit is the sound. Returns the tones asked for before
 * the press and after the dash.
 */
async function fightPress(page: Page): Promise<{ before: number; after: number }> {
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await untilFrame(page, (s: any) => (s.enemies.length >= 3 ? true : undefined), null, 8);
  await page.evaluate(() => { const p = (window as any).__realtime.params; p.enemySpeed = 0; p.wolfSpeed = 0; p.speedSpread = 0; p.contactDamage = 0; });
  // The hero steps next to an enemy (a journal command, as the tests' quiet scenes do); the press lands on the open field, not on
  // the HUD (the action bar takes a click unless faded).
  const s = await snap(page), enemy = [...s.enemies].sort((a: any, b: any) => Math.hypot(a.x - s.hero.x, a.y - s.hero.y) - Math.hypot(b.x - s.hero.x, b.y - s.hero.y))[0];
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [enemy.x - 1.2, enemy.y] as const);
  await untilFrame(page, (q: any, _a: null, late: boolean) => (late ? true : undefined), null, 0.4);
  const at = await screen(page, enemy.x, enemy.y);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y) instanceof HTMLCanvasElement, [at.x, at.y] as const), 'the enemy on the open field').toBe(true);
  const before = (await snap(page)).sound.tones;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 3, at.y + 2, { steps: 2 });
  await page.mouse.up();
  // The dash ran (it is the hit) and ended.
  expect(await untilFrame(page, (q: any, _a: null, late: boolean) => (q.moving ? 'moving' : undefined) ?? (late ? 'none' : undefined), null, 3)).toBe('moving');
  expect(await untilFrame(page, (q: any, _a: null, late: boolean) => (q.moving === null ? true : late ? q.moving : undefined), null, 10)).toBe(true);
  return { before, after: (await snap(page)).sound.tones };
}

test('run sound: on at 0.3 by default — the gear shows it, a chain hit in a run fight sounds', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await runMap(page);
  await page.getByTestId('run-settings').click();
  await expect(page.getByTestId('view-sound')).toBeChecked();
  const slider = page.getByTestId('view-sound-volume');
  await expect(slider).toHaveValue('0.3');
  await expect(slider).toBeEnabled();
  const box = await page.getByTestId('run-settings-panel').boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 1280 && box.y >= 0 && box.y + box.height <= 720, `settings box ${JSON.stringify(box)}`).toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-sound-gear.png' });
  await page.getByTestId('run-settings').click();
  expect((await snap(page)).sound).toMatchObject({ on: true, volume: 0.3 });
  const { before, after } = await fightPress(page);
  expect(after, 'tones of the hit').toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('run sound: the slider and the switch are kept — off on the gear, a reload, still off; a run fight asks for no tone; the sandbox keeps its panel', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await runMap(page);
  await page.getByTestId('run-settings').click();
  await page.getByTestId('view-sound-volume').fill('0.5');
  expect(JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY))!)).toEqual({ on: true, volume: 0.5 });
  expect((await snap(page)).sound).toMatchObject({ on: true, volume: 0.5 });
  await page.getByTestId('view-sound').uncheck();
  expect(JSON.parse((await page.evaluate(key => localStorage.getItem(key), KEY))!)).toEqual({ on: false, volume: 0.5 });
  await expect(page.getByTestId('view-sound-volume')).toBeDisabled();
  await page.screenshot({ path: 'artifacts/realtime-sound-gear-off.png' });
  // The reload: the setting comes back from its key.
  await runMap(page, true);
  await page.getByTestId('run-settings').click();
  await expect(page.getByTestId('view-sound')).not.toBeChecked();
  await expect(page.getByTestId('view-sound-volume')).toHaveValue('0.5');
  await expect(page.getByTestId('view-sound-volume')).toBeDisabled();
  await page.getByTestId('run-settings').click();
  expect((await snap(page)).sound).toMatchObject({ on: false, volume: 0.5, tones: 0 });
  // A run fight with a real chain hit: no tone asked for.
  const { after } = await fightPress(page);
  expect(after, 'no tone with the sound off').toBe(0);
  // The sandbox plays by its panel («Звук удара», on by default), not by the gear.
  await page.goto('/?sandbox=1');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  expect((await snap(page)).sound).toMatchObject({ on: true, volume: 0.3 });
  expect(errors).toEqual([]);
});

/**
 * Task 22 «Удар слышен» (view/soundGate.ts; design 15.10.2026): a run fight entered by clicks, enemies walk into the standing hero
 * and hit him — every hit asks for the hit's sound (`sound.asked.hurt` = the sim's `hitsTaken`), and every one sounds: the hits
 * of one hero are at least his invulnerability apart (0.5 s and more), past the gate's 0.3 s.
 */
test('task 22: in a run fight every hit on the hero asks for its sound, and each sounds (one in 0.3 s at most)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await runMap(page);
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await untilFrame(page, (s: any) => (s.enemies.length >= 1 ? true : undefined), null, 8);
  // Nobody comes; three plain enemies at the hero's side walk into him.
  await page.evaluate(() => {
    const rt = (window as any).__realtime, p = rt.params;
    p.baseIntervalMin = 1000; p.baseIntervalMax = 1000; p.baseFloor = 0;
    for (const phase of p.phases) phase.floor = 0;
    p.boarMax = 0; p.wolfRing = false; p.contactDamage = 1; p.speedSpread = 0;
    rt.clear(false);
    const hero = rt.snapshot().hero;
    for (let k = 0; k < 3; k++) rt.place(hero.x + Math.cos(k * 2.1) * 0.9, hero.y + Math.sin(k * 2.1) * 0.9, k, 2);
  });
  const hit = await untilFrame(page, (s: any) => (s.stats.hitsTaken >= 3 || s.status !== 'playing' ? s : undefined), null, 30);
  expect(hit.stats.hitsTaken, 'the enemies hit the hero').toBeGreaterThanOrEqual(3);
  const s = await snap(page);
  expect(s.sound.asked.hurt, 'a sound asked for on every hit').toBe(s.stats.hitsTaken);
  expect(s.sound.played.hurt, 'each one sounded').toBe(s.sound.asked.hurt);
  expect(errors).toEqual([]);
});
