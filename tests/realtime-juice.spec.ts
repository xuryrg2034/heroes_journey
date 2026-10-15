import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 35 «Сочность, пакет 1» (design 15.10.2026, docs/design-notes/task-35-juice.md): the view's juice. С1 «Тряска и вспышки»
 * (0 / 50 / 100 %) — at 0 the arena does not shake and no full-screen flash starts, the level outlives a reload, the fight's
 * journal replays in Node to the hash the page had (the level never reaches the sim); С2 — shards of the enemy's colour, more for
 * a later link; С3 — the resources gained fly to the header's number and it counts up; С4 — «Тяжёлый клинок» (a wider line with a
 * steel core, a lower hit and a thud) and «Пятое звено» (a gold notch at the link where it fires, a bell when the dash strikes
 * it). Real input: the chain is drawn with the mouse, the settings are chosen in the panel and on the gear.
 */
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The debug panel open (it remembers being open over a reload). */
async function openPanel(page: Page): Promise<void> {
  const open = page.getByTestId('open-panel');
  if (await open.isVisible()) await open.click();
  await expect(page.getByTestId('fx-level')).toBeVisible();
}

async function openSandbox(page: Page, clear = true): Promise<void> {
  await page.goto('/?sandbox=1&arena=1');
  if (clear) { await page.evaluate(() => localStorage.clear()); await page.reload(); }
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

/** Only what the test places acts; the hero at (4, 5.5); the finisher (its full-screen flash) from `finisherLinks` kills. */
async function quiet(page: Page, finisherLinks = 4): Promise<void> {
  await page.evaluate(n => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['finisherLinks', n]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(4, 5.5);
  }, finisherLinks);
}

/** `n` enemies of colour 0, HP 1, in a row to the right of the hero, 1.4 apart (each in reach of the last). */
async function row(page: Page, n: number): Promise<[number, number][]> {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { const p: [number, number] = [5.4 + 1.4 * i, 5.5]; await place(page, p[0], p[1], 0, 1); pts.push(p); }
  return pts;
}

/** Press on the first point and drag through the rest (the button stays down). */
async function drag(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const at = await Promise.all(points.map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 5 });
}

/** The dash after the release has ended: no move, none of the test's row left (newcomers elsewhere do not count). */
const dashDone = (page: Page): Promise<boolean> => untilFrame(page, (s, _a: number, late) => {
  const done = !s.move && !s.enemies.some((e: any) => Math.abs(e.y - 5.5) < 0.4 && e.x > 5);
  return done || late ? done : undefined;
}, 0, 6);

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

test('task 35 С1: «Тряска и вспышки» 0 % — a six-link dash does not shake and no full-screen flash starts; the level outlives a reload; 100 % shakes and flashes; the journals replay to the page hash', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  await openPanel(page);
  const choice = page.getByTestId('fx-level');
  await expect(choice).toHaveValue('100');
  await expect(choice.locator('option')).toHaveText(['100 %', '50 %', '0 %']);
  await choice.selectOption('0');
  expect(await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-fx'))).toBe('0');
  // The level is the viewer's: a reload keeps it.
  await openSandbox(page, false);
  await expect.poll(async () => (await snap(page)).juice.level).toBe(0);
  await openPanel(page);
  await expect(page.getByTestId('fx-level')).toHaveValue('0');
  await page.locator('.rt-close').first().click();

  await quiet(page);
  const before = (await snap(page)).juice;
  await drag(page, await row(page, 6));
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  let j = (await snap(page)).juice;
  expect(j.shakeFrames - before.shakeFrames, 'no shake at 0 %').toBe(0);
  expect(j.flashes - before.flashes, 'no full-screen flash at 0 %').toBe(0);
  expect(j.flashesHeld - before.flashesHeld, 'the finisher came and its flash was held').toBeGreaterThan(0);
  await sameHash(page);

  // 100 %: the same dash shakes and the finisher flashes the screen.
  await openPanel(page);
  await page.getByTestId('fx-level').selectOption('100');
  await page.locator('.rt-close').first().click();
  await quiet(page);
  const at100 = (await snap(page)).juice;
  await drag(page, await row(page, 6));
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  j = (await snap(page)).juice;
  expect(j.level).toBe(100);
  expect(j.shakeFrames - at100.shakeFrames, 'the dash shakes at 100 %').toBeGreaterThan(0);
  expect(j.flashes - at100.flashes, 'the finisher flashes at 100 %').toBe(1);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 35 С2 and С4: shards of the enemy colour — 4 for the first link, 8 for the sixth; «Пятое звено» notches the 5th link of the drawn chain and rings when the dash strikes it; «Тяжёлый клинок» widens the line and thuds', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  // The first link alone: four shards (held at 0.12 s of their flight for the shot; the finisher as by default, from 10 kills).
  await quiet(page, 10);
  await page.evaluate(() => (window as any).__realtime.freezeShards(0.12));
  await drag(page, await row(page, 1));
  await page.mouse.up();
  const first = await untilFrame(page, (s, _a: number, late) => s.juice.shards > 0 || late ? s.juice.lastBurst : undefined, 0, 4);
  expect(first).toBe(4);
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/realtime-juice-shards-1.png' });
  await page.evaluate(() => (window as any).__realtime.freezeShards(null));
  expect(await dashDone(page)).toBe(true);
  // The plain line of four links, to compare with the heavy one.
  await quiet(page, 10);
  await drag(page, await row(page, 4));
  await expect.poll(async () => (await snap(page)).chain.length).toBe(4);
  expect((await snap(page)).juice.heavyLine).toBe(0);
  await page.screenshot({ path: 'artifacts/realtime-juice-line-plain.png' });
  await page.mouse.up({ button: 'left' });
  expect(await dashDone(page)).toBe(true);

  await page.evaluate(() => (window as any).__realtime.useBuild({ talismans: ['fifth-link', 'relic-heavy-blade'] }));
  await quiet(page, 10);
  const pts = await row(page, 6);
  // Four links drawn: no notch yet (never an empty place ahead); the heavy line is on.
  await drag(page, pts.slice(0, 4));
  await expect.poll(async () => (await snap(page)).juice.notches).toEqual([]);
  expect((await snap(page)).juice.heavyLine).toBe(1);
  // The fifth: its notch; the sixth: still the one notch.
  const p5 = await screen(page, ...pts[4]), p6 = await screen(page, ...pts[5]);
  await page.mouse.move(p5.x, p5.y, { steps: 5 });
  await expect.poll(async () => (await snap(page)).juice.notches).toEqual([5]);
  await page.mouse.move(p6.x, p6.y, { steps: 5 });
  await expect.poll(async () => (await snap(page)).chain.length).toBe(6);
  expect((await snap(page)).juice.notches).toEqual([5]);
  await page.screenshot({ path: 'artifacts/realtime-juice-items.png' });
  const sounds = (await snap(page)).juice.sounds;
  await page.evaluate(() => (window as any).__realtime.freezeShards(0.12));
  await page.mouse.up();
  // The sixth link's kill throws eight shards; the bell once (the 5th struck), a thud per hit.
  const sixth = await untilFrame(page, (s, _a: number, late) => s.juice.lastBurst === 8 || late ? s.juice.lastBurst : undefined, 0, 4);
  expect(sixth).toBe(8);
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/realtime-juice-shards-6.png' });
  await page.evaluate(() => (window as any).__realtime.freezeShards(null));
  expect(await dashDone(page)).toBe(true);
  const after = (await snap(page)).juice.sounds;
  expect(after.bells - sounds.bells).toBe(1);
  expect(after.thuds - sounds.thuds).toBe(6);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 35 С3: resources gained on the run screen fly to the header number, which counts up; С1 sits on the gear and outlives a reload', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/?seed=35');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  const total = async (): Promise<number> => Number(await page.getByTestId('run-resources').locator('b').textContent());
  const start = await total();
  // The gift of resources: the tokens fly from the button to the number, which counts up to the new total.
  await page.getByTestId('run-gift').locator('button', { hasText: 'ресурс' }).first().click();
  // Read in the page's frame the flight starts in: the number still shows the old total while the tokens fly.
  const started = await (await page.waitForFunction(() => {
    const fly = (window as any).__realtime.run.resFly();
    if (fly.flights < 1) return false;
    return { ...fly, text: Number(document.querySelector('[data-testid="run-resources"] b')?.textContent), tokens: document.querySelectorAll('[data-testid="res-token"]').length };
  }, null, { polling: 'raf' })).jsonValue() as { from: number; to: number; text: number; tokens: number };
  expect(started.from).toBe(start);
  expect(started.to).toBeGreaterThan(start);
  expect(started.text).toBe(start);
  expect(started.tokens).toBe(Math.min(6, started.to - start));
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/realtime-juice-loot.png' });
  await expect.poll(total, { timeout: 3_000 }).toBe(started.to);
  await expect(page.getByTestId('res-token')).toHaveCount(0);
  // С1 on the gear of the map.
  await page.getByTestId('run-settings').click();
  const fx = page.getByTestId('view-fx');
  await expect(fx).toHaveValue('100');
  await fx.selectOption('50');
  await page.screenshot({ path: 'artifacts/realtime-juice-gear.png' });
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.snapshot?.().juice.level)).toBe(50);
  await page.getByTestId('run-settings').click();
  await expect(page.getByTestId('view-fx')).toHaveValue('50');
  // A reload shows the number as it is: nothing flies.
  expect(await page.evaluate(() => (window as any).__realtime.run.resFly().flights)).toBe(0);
  expect(errors).toEqual([]);
});
