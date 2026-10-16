import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 47 (docs/design-notes/task-47-view-polish.md): the camera's border under the HUD plate (§2, design variant 1 — the world is
 * masked from the plate's bottom down, the hero stays whole over it) and the juice pack 2 of the fight (С4 rest, С7). Real mouse
 * input; runs only through playwright.realtime.config.ts.
 */
interface CameraState { x: number; y: number; viewW: number; viewH: number; frozen: boolean }
const camera = (page: Page): Promise<CameraState> => page.evaluate(() => (window as any).__realtime.camera());
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp = 0): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);

async function open(page: Page, errors: string[], n: number): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/?sandbox=1&arena=${n}&seed=77`);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeHidden();
}

async function still(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = (window as any).__realtime;
    r.params.enemySpeed = 0; r.params.wolfSpeed = 0; r.params.speedSpread = 0;
    r.params.baseIntervalMin = 1000; r.params.baseIntervalMax = 1000; r.params.baseFloor = 0;
    r.params.maxEnemies = 0;
    r.clear();
  });
}

async function settled(page: Page): Promise<CameraState> {
  await page.waitForTimeout(600);
  let last = await camera(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const now = await camera(page);
    if (Math.abs(now.x - last.x) < 1e-3 && Math.abs(now.y - last.y) < 1e-3) return now;
    last = now;
  }
  throw new Error('the camera never settled');
}

/** Pixels of the screenshot in `box` whose colour is within `tol` of `rgb`: counted per band of rows. */
async function colourRows(page: Page, shot: Buffer, rgb: number, x0: number, x1: number, bands: [number, number][], tol = 48): Promise<number[]> {
  return page.evaluate(async ([b64, rgb, x0, x1, bands, tol]) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height), cx = c.getContext('2d')!;
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data, r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
    return bands.map(([y0, y1]) => {
      let n = 0;
      for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x1)); x++) {
        const i = (y * img.width + x) * 4;
        if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < tol) n++;
      }
      return n;
    });
  }, [shot.toString('base64'), rgb, x0, x1, bands, tol] as const);
}

test('task 47 §2: on arena 1 every body stands below the HUD plate', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 1);
  await page.waitForTimeout(4000);
  const s = await snap(page), plate = (await page.getByTestId('hud').boundingBox())!;
  const k = (await screen(page, 1, 0)).x - (await screen(page, 0, 0)).x;
  expect(s.enemies.length).toBeGreaterThan(0);
  const top = Math.min(...await Promise.all(s.enemies.map(async (e: any) => (await screen(page, e.x, e.y)).y - 0.42 * k)));
  expect(top, 'the topmost body\'s rectangle starts below the plate').toBeGreaterThanOrEqual(plate.y + plate.height);
  expect(errors).toEqual([]);
});

/**
 * «Большая поляна» (24×15, larger than the view): an enemy half over the view's top border is cut along it — none of its colour above
 * the border (beside the plate, where nothing else covers it), its lower half drawn; the real mouse takes it by its visible part, and
 * the chain's line to it is cut at the border too.
 */
test('task 47 §2: a large arena — a body half over the border is cut along it, taken by its visible part, the chain line cut too', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, 18);
  await still(page);
  // A long reach (the panel's slider stops at 4): the hero stays low, the body at the border is still his first link.
  await page.evaluate(() => { (window as any).__realtime.params.linkRadius = 9; });
  const plate = (await page.getByTestId('hud').boundingBox())!;
  // The hero low enough that the camera stands off the arena's top: the view's top border is inside the arena.
  await page.evaluate(() => (window as any).__realtime.teleport(12, 8));
  const cam = await settled(page);
  const viewTop = cam.y - cam.viewH / 2;
  expect(viewTop, 'the view\'s top is inside the arena').toBeGreaterThan(1);
  const border = (await screen(page, 0, viewTop)).y;
  expect(border, 'the border is under the plate').toBeGreaterThanOrEqual(plate.y + plate.height);
  // The column right of the plate (no HUD there): an enemy whose centre is a quarter unit above the border.
  const k = (await screen(page, 1, 0)).x - (await screen(page, 0, 0)).x;
  const sx = plate.x + plate.width + 50, ax = (await page.evaluate(([x, y]) => (window as any).__realtime.toWorld(x, y), [sx, border] as const)).x;
  const ay = viewTop - 0.25, id = await place(page, ax, ay, 0);
  // The body's pop-in (0.2 s of game time) is over.
  await gameWait(page, 0.5);
  const red = (await snap(page)).palette.chain[0] as number;
  const at = await screen(page, ax, ay), half = 0.3 * k;
  let [above, below] = await colourRows(page, await page.screenshot({ path: 'artifacts/realtime-juice2-cut.png' }), red, at.x - half, at.x + half, [[border - 0.4 * k, border - 2], [border + 2, border + 0.12 * k]]);
  expect(above, 'nothing of the body above the border').toBe(0);
  expect(below, 'the body\'s lower part is drawn').toBeGreaterThan(20);
  // Its visible part under the real mouse starts the chain.
  await page.mouse.move(at.x, border + 0.08 * k);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([id]);
  await page.mouse.move(at.x, border + 0.1 * k);
  await page.waitForTimeout(200);
  const shot = await page.screenshot({ path: 'artifacts/realtime-juice2-border.png' });
  // The chain's line from the hero runs up to the body: nothing of the chain colour above the border, beside the plate.
  [above] = await colourRows(page, shot, red, plate.x + plate.width + 6, 1050, [[0, border - 2]]);
  expect(above, 'no chain line or body above the border').toBe(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

// ---- С4 (the rest) and С7: the dash's juice from the build, the hero's squash ----

/** The sandbox on arena 1 with `build`; only what the test places acts; the hero at (4, 5.5); the counters' window on. */
async function fight(page: Page, build: { talismans: string[]; hammer?: string }, fx: 0 | 100 = 100): Promise<void> {
  await page.evaluate(([build, fx]) => {
    localStorage.setItem('ashen-oath-realtime-fx', String(fx));
    (window as any).__realtime.useBuild(build);
  }, [build, fx] as const);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['finisherLinks', 10], ['counterWindow', true]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(4, 5.5);
  });
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

/** The dash after the release has ended: no move, none of the test's row left. */
const dashDone = (page: Page): Promise<boolean> => untilFrame(page, (s, _a: number, late) => {
  const done = !s.moving && !s.enemies.some((e: any) => Math.abs(e.y - 5.5) < 0.4 && e.x > 5);
  return done || late ? done : undefined;
}, 0, 6);

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** One six-link dash drawn with the mouse; `bystanders` — bodies of another colour beside the path (for «Режущий проход» to cut). */
async function dash(page: Page, bystanders = false): Promise<void> {
  const pts = await row(page, 6);
  if (bystanders) for (const x of [6.1, 8.9]) await place(page, x, 5.95, 1, 1);
  await drag(page, pts);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(6);
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
}

test('task 47 С4 and С7: «Длинная рука» brightens the ring when the window gives R ×1.5; «Быстрые ноги» — speed lines and a whistle; the hero stretches and squashes; «Огненный проход» crackles, «Ударная волна» hums; the hash is the page’s', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  await open(page, errors, 1);
  await fight(page, { talismans: ['long-arm', 'relic-swift-feet', 'shockwave'], hammer: 'fire-pass' });
  expect((await snap(page)).juice.level).toBe(100);
  const before = (await snap(page)).juice;
  const pts = await row(page, 6);
  // One link: no window yet; the second link gives the next reach ×1.5 (LONG_ARM_FROM 3) — the rings burn brighter.
  await drag(page, pts.slice(0, 1));
  await expect.poll(async () => (await snap(page)).chain.length).toBe(1);
  expect((await snap(page)).juice.armFlashes).toBe(before.armFlashes);
  const p2 = await screen(page, ...pts[1]);
  await page.mouse.move(p2.x, p2.y, { steps: 5 });
  await expect.poll(async () => (await snap(page)).juice.armFlashes).toBe(before.armFlashes + 1);
  await page.screenshot({ path: 'artifacts/realtime-juice2-long-arm.png' });
  for (const p of pts.slice(2)) { const at = await screen(page, ...p); await page.mouse.move(at.x, at.y, { steps: 5 }); }
  await expect.poll(async () => (await snap(page)).chain.length).toBe(6);
  // The ring's brightness lasts 0.2 s, then it is the plain ring again.
  await expect.poll(async () => (await snap(page)).juice.armBright).toBe(0);
  const sounds = (await snap(page)).juice.sounds;
  await page.mouse.up();
  // While the hero dashes: the speed lines behind him (the shot of the moment).
  await untilFrame(page, (s, lines: number, late) => s.juice.speedLines > lines || late ? true : undefined, before.speedLines, 3);
  await page.screenshot({ path: 'artifacts/realtime-juice2-swift.png' });
  expect(await dashDone(page)).toBe(true);
  const j = (await snap(page)).juice;
  expect(j.speedLines - before.speedLines, 'speed lines while dashing').toBeGreaterThan(0);
  expect(j.squashes - before.squashes, 'stretched at the start, squashed at the end').toBeGreaterThanOrEqual(2);
  expect(j.squashMax, 'the squash is seen').toBeGreaterThan(0.05);
  expect(j.squashMax, 'at most 15 %').toBeLessThanOrEqual(0.15 + 1e-9);
  expect(j.sounds.whistles - sounds.whistles, 'a whistle at the dash’s start').toBe(1);
  expect(j.sounds.crackles - sounds.crackles, 'the fire laid crackles').toBeGreaterThanOrEqual(1);
  expect(j.sounds.hums - sounds.hums, 'the wave hums').toBe(1);
  expect(j.sounds.humLast, 'the hum’s strength').toBeGreaterThanOrEqual(0.3);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('task 47 С4: the hammers’ sounds — «Взрыв на конце» pops, «Режущий проход» swishes, «Возврат» rings backwards', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  await open(page, errors, 1);
  for (const [hammer, key] of [['end-blast', 'pops'], ['cutting-pass', 'swishes'], ['return-pass', 'rings']] as const) {
    await fight(page, { talismans: [], hammer });
    const before = (await snap(page)).juice.sounds;
    await dash(page, hammer === 'cutting-pass');
    const after = (await snap(page)).juice.sounds;
    expect(after[key] - before[key], `${hammer}: ${key}`).toBeGreaterThanOrEqual(1);
    for (const other of ['pops', 'swishes', 'rings', 'crackles'] as const) if (other !== key) expect(after[other] - before[other], `${hammer}: no ${other}`).toBe(0);
    await sameHash(page);
  }
  expect(errors).toEqual([]);
});

test('task 47 С1 × С4, С7: «Тряска и вспышки» 0 % — no speed lines and no squash of the hero; the journal replays to the page hash', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  await open(page, errors, 1);
  await fight(page, { talismans: ['relic-swift-feet'] }, 0);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await fight(page, { talismans: ['relic-swift-feet'] }, 0);
  expect((await snap(page)).juice.level).toBe(0);
  const before = (await snap(page)).juice;
  await dash(page);
  const j = (await snap(page)).juice;
  expect(j.speedLines - before.speedLines, 'no speed lines at 0 %').toBe(0);
  expect(j.squashes - before.squashes, 'no squash at 0 %').toBe(0);
  expect(j.squashMax).toBe(before.squashMax);
  // The sound is no flash: the whistle stays.
  expect(j.sounds.whistles - before.sounds.whistles).toBe(1);
  await sameHash(page);
  expect(errors).toEqual([]);
});
