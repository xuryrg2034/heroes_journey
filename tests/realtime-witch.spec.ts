import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 62 «Ведунья v2: круг, разряд, кольцо», stage A, the view (docs/design-notes/task-62-witch-v2.md, 2.1–2.3, 3.1, 3.7, 6; design decisions
 * 21.10.2026; docs/realtime-prototype.md, «Ведунья v2») in the sandbox («Герой» «ведунья v2» = Ведунья with the key `witchV2`): the circle of
 * casting whole in the 1280×720 frame, thin without a chain and in the chain's colour with one; the bodies out of it muted (once); the refusal
 * «далеко»; the runes and the line to a body that walked off its point; the ring drawn with the real mouse through five enemies — closed on its
 * first rune, the word «Кольцо», the seal inside and the hero in place after the release; a square of four — refused «не фигура», grey contour; the
 * discharge's thread and flashes; «Показать фигуру»; the camera that keeps her in the centre while she draws. The journal of each fight replays in
 * Node to the page's hash. The rules are Node's (`npm run test:realtime-witch`, `test:realtime-witch-view`); this test looks at what the player sees
 * by real mouse input. Shots (1280×720) go to SHOT_DIR (default artifacts/); the «-deut» ones are the same shots through a deuteranopia matrix
 * (a simulation of the shot's pixels in the test; the game has no colour-blind filter).
 */
const SHOTS = process.env.SHOT_DIR ?? 'artifacts';
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The sandbox, quiet (only what the test places acts); Ведунья v2 (or the cat) in the next fight; the hero at (8, 5.5) of a 16×10 arena. */
async function openWitch(page: Page, hero: 'toad' | null = 'toad', query = 'arena=1'): Promise<void> {
  await page.goto(`/?sandbox=1&${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.evaluate(h => (window as any).__realtime.useHero(h, 1), hero);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['witchV2', true], ['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as [string, unknown][]) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5.5);
  });
}

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** A 1280×720 shot, and the same through a deuteranopia matrix (Machado, severity 1.0) as `<name>-deut.png`. */
async function shot(page: Page, name: string, deut = false): Promise<void> {
  const png = await page.screenshot({ path: `${SHOTS}/${name}.png` });
  if (!deut) return;
  const url = await page.evaluate(async b64 => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d')!; g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, img.width, img.height), d = data.data;
    const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const enc = (v: number): number => { const c = Math.min(1, Math.max(0, v)); return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
    for (let i = 0; i < d.length; i += 4) {
      const r = lin(d[i]), gr = lin(d[i + 1]), b = lin(d[i + 2]);
      d[i] = enc(0.367322 * r + 0.860646 * gr - 0.227968 * b);
      d[i + 1] = enc(0.280085 * r + 0.672501 * gr + 0.047413 * b);
      d[i + 2] = enc(-0.011820 * r + 0.042940 * gr + 0.968881 * b);
    }
    g.putImageData(data, 0, 0);
    return cv.toDataURL('image/png');
  }, png.toString('base64'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${SHOTS}/${name}-deut.png`, Buffer.from(url.split(',')[1], 'base64'));
}

/** A regular pentagon of radius 1.3 round (8, 5.5), the first corner on top (no body overlaps). */
const PENTAGON: [number, number][] = [[8, 6.8], [6.764, 5.902], [7.236, 4.448], [8.764, 4.448], [9.236, 5.902]];
const SQUARE: [number, number][] = [[7.2, 4.7], [8.8, 4.7], [8.8, 6.3], [7.2, 6.3]];

async function pressThrough(page: Page, points: [number, number][]): Promise<void> {
  const at = await Promise.all(points.map(([x, y]) => screen(page, x, y)));
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 });
}

test('the circle of casting: whole in the frame, thin without a chain, in the chain\'s colour with one; the cat keeps her old circle', async ({ page }) => {
  const errors = collectErrors(page);
  await openWitch(page);
  await expect.poll(async () => (await snap(page)).witch.shown.circle).toBe(1);
  const s = await snap(page);
  expect(s.witch.on).toBe(true);
  // 2 × R of the build (R = 1.875): 3.75 units.
  expect(s.witch.radius).toBeCloseTo(3.75, 5);
  expect(s.reachRadius).toBeCloseTo(3.75, 5);
  const hud = (await page.getByTestId('hud').boundingBox())!;
  const hero = s.hero;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const p = await screen(page, hero.x + dx * s.witch.radius, hero.y + dy * s.witch.radius);
    expect(p.x, `the circle's edge (${dx}, ${dy}) is in the frame`).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(1280);
    expect(p.y).toBeGreaterThan(hud.y + hud.height);
    expect(p.y).toBeLessThan(720);
  }
  await shot(page, 'witch-circle-idle', true);
  // A chain in hand: the same circle in the chain's colour.
  await place(page, 10.4, 5.5, 0, 3);
  const at = await screen(page, 10.4, 5.5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).witch.shown.circle).toBe(2);
  expect((await snap(page)).reachCircles).toBe(1);
  await shot(page, 'witch-circle-chain', true);
  await page.mouse.up();
  await sameHash(page);
  // The cat: no v2 circle, her R.
  await openWitch(page, null);
  const cat = await snap(page);
  expect(cat.witch.on).toBe(false);
  expect(cat.witch.shown.circle).toBe(0);
  expect(cat.reachRadius).toBeCloseTo(1.875, 5);
  expect(errors).toEqual([]);
});

test('bodies out of the circle are muted once (also the foreign colour out of it); «далеко» at the pointer; the line to a body that walked off its rune', async ({ page }) => {
  const errors = collectErrors(page);
  await openWitch(page);
  const first = await place(page, 10.6, 5.5, 0, 3);
  await place(page, 9.6, 3.4, 0, 3);
  await place(page, 7.0, 3.8, 0, 3);
  // Muted: a blue one in the circle (the colour), a red one out of it (the circle), a blue one out of it (both — still once).
  const far: number[] = [await place(page, 12.5, 5.5, 0, 3), await place(page, 3.0, 5.5, 1, 3)];
  await place(page, 5.5, 6.5, 1, 3);
  await page.evaluate(ids => { for (const id of ids) (window as any).__realtime.chill(id, 60); }, far);
  await pressThrough(page, [[10.6, 5.5], [9.6, 3.4], [7.0, 3.8]]);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(3);
  // Three muted: the blue in the circle, the red out of it, the blue out of it. The red ones in the circle are not.
  await expect.poll(async () => (await snap(page)).colorShift.dimmed).toBe(3);
  // The refusal at the pointer: the far red one (4.5 from her) — the old «далеко»; the chain is not changed.
  const outside = await screen(page, 12.5, 5.5);
  await page.mouse.move(outside.x, outside.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).hint).toBe('far');
  expect((await snap(page)).chain.length).toBe(3);
  // The chain's bodies walk to her; each leaves its rune: the dot stays, a thin line leads to the body.
  const back = await screen(page, 7.0, 3.8);
  await page.mouse.move(back.x, back.y, { steps: 4 });
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 2));
  await gameWait(page, 0.5);
  await expect.poll(async () => (await snap(page)).witch.shown.ties).toBeGreaterThan(0);
  const s = await snap(page);
  expect(s.witch.shown.runes).toBe(3);
  expect(s.witch.runes.length).toBe(3);
  // The runes did not follow the bodies: the first rune is where the first body was taken.
  expect(s.witch.runes[0].x).toBeCloseTo(10.6, 1);
  expect(s.enemies.find((e: any) => e.id === first).x).toBeLessThan(10.2);
  await shot(page, 'witch-chain-muted', true);
  await page.mouse.up();
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('the ring: five enemies by the real mouse, closed on the first rune — the word «Кольцо», the seal inside, the hero in place; the discharge shows its thread and flashes', async ({ page }) => {
  const errors = collectErrors(page);
  await openWitch(page);
  const ids: number[] = [];
  for (const [x, y] of PENTAGON) ids.push(await place(page, x, y, 0, 1));
  const inner = await place(page, 8.4, 5.3, 1, 3);
  const before = (await snap(page)).hero;
  await pressThrough(page, PENTAGON);
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
  // The first rune: the dim ring (the pointer is elsewhere); the sim has not closed.
  await expect.poll(async () => (await snap(page)).witch.shown.firstRing).toBe(1);
  expect((await snap(page)).loop.closed).toBeNull();
  // The pointer on the first rune closes the ring: the word, the lit ring, the filled outline with a mark on the inner enemy.
  const first = await screen(page, PENTAGON[0][0], PENTAGON[0][1]);
  await page.mouse.move(first.x, first.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('first');
  await expect.poll(async () => (await snap(page)).witch.shown).toMatchObject({ word: 'Кольцо', firstRing: 2 });
  expect((await snap(page)).loop.shown).toMatchObject({ closed: 1, marks: 1 });
  expect((await snap(page)).hint).toBeNull();
  await shot(page, 'witch-ring-closed', true);
  await page.mouse.up();
  // The discharge: the thread and the flashes are on the screen right after the release; she has not moved a step.
  await expect.poll(async () => (await snap(page)).witch.shown.casts).toBe(1);
  await shot(page, 'witch-discharge');
  await expect.poll(async () => (await snap(page)).witch.shown.flashes).toBe(5);
  await expect.poll(async () => (await snap(page)).enemies.filter((e: any) => ids.includes(e.id)).length).toBe(0);
  const after = await snap(page);
  expect(after.hero.x).toBeCloseTo(before.x, 6);
  expect(after.hero.y).toBeCloseTo(before.y, 6);
  // The seal struck the inner enemy once and held it.
  const held = after.enemies.find((e: any) => e.id === inner);
  expect(held.hp).toBe(2);
  expect(held.chill).toBeGreaterThan(0);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('a square of four: the closing is refused «не фигура» — the same contour in grey, no word, the old hint at the pointer; the release is an open chain', async ({ page }) => {
  const errors = collectErrors(page);
  await openWitch(page);
  const ids: number[] = [];
  for (const [x, y] of SQUARE) ids.push(await place(page, x, y, 0, 1));
  await pressThrough(page, SQUARE);
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
  const first = await screen(page, SQUARE[0][0], SQUARE[0][1]);
  await page.mouse.move(first.x, first.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).hint).toBe('notFigure');
  const s = await snap(page);
  expect(s.loop.closed).toBeNull();
  expect(s.witch.shown).toMatchObject({ contour: 'refused', word: '' });
  await shot(page, 'witch-refused-square', true);
  await page.mouse.up();
  // An open chain: the four are struck one after another from where she stands.
  await expect.poll(async () => (await snap(page)).enemies.filter((e: any) => ids.includes(e.id)).length).toBe(0);
  expect((await snap(page)).witch.shown.casts).toBe(1);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('«Показать фигуру» (the sandbox panel): the class word at the centre of any contour — a square, a triangle, a ring', async ({ page }) => {
  const errors = collectErrors(page);
  await openWitch(page);
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  await page.getByTestId('show-glyph').check();
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeHidden();
  for (const [x, y] of SQUARE) await place(page, x, y, 0, 1);
  await pressThrough(page, SQUARE);
  await expect.poll(async () => (await snap(page)).witch.shown.classWord).toBe('Квадрат');
  await shot(page, 'witch-show-figure');
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).chain.length).toBe(0);
  await gameWait(page, 0.4);
  const TRIANGLE: [number, number][] = [[8, 3.9], [9.6, 6.6], [6.4, 6.6]];
  for (const [x, y] of TRIANGLE) await place(page, x, y, 0, 1);
  await pressThrough(page, TRIANGLE);
  await expect.poll(async () => (await snap(page)).witch.shown.classWord).toBe('Треугольник');
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).chain.length).toBe(0);
  await gameWait(page, 0.4);
  for (const [x, y] of PENTAGON) await place(page, x, y, 0, 1);
  await pressThrough(page, PENTAGON);
  await expect.poll(async () => (await snap(page)).witch.shown.classWord).toBe('Кольцо');
  await page.mouse.up();
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('the camera keeps Ведунья in the centre while she draws (a glide, no jump); the cat\'s camera stands still', async ({ page }) => {
  const errors = collectErrors(page);
  for (const hero of ['toad', null] as const) {
    await openWitch(page, hero, 'arena=18&seed=77');
    await page.evaluate(() => { const rt = (window as any).__realtime; rt.teleport(8, 7.5); });
    await page.waitForTimeout(1500);
    await place(page, 9.6, 7.5, 0, 3);
    const at = await screen(page, 9.6, 7.5);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await expect.poll(async () => (await snap(page)).chain.length).toBe(1);
    const start = await page.evaluate(() => (window as any).__realtime.camera());
    // The hero is carried 6 units to the right while the chain is in her hand; the camera's x is sampled on every frame.
    const frames: number[] = await page.evaluate(async () => {
      const rt = (window as any).__realtime, xs: number[] = [];
      rt.teleport(14, 7.5);
      for (let i = 0; i < 90; i++) { await new Promise(r => requestAnimationFrame(r)); xs.push(rt.camera().x); }
      return xs;
    });
    const end = frames[frames.length - 1], travel = 14 - start.x;
    if (hero === 'toad') {
      expect(Math.abs(end - 14)).toBeLessThan(0.1);
      // No jump: no single frame covers more than half of the way; the glide is monotonic.
      let biggest = 0;
      frames.reduce((prev, x) => { biggest = Math.max(biggest, Math.abs(x - prev)); expect(x).toBeGreaterThanOrEqual(prev - 1e-9); return x; }, start.x);
      expect(biggest).toBeLessThan(Math.abs(travel) * 0.5);
    } else {
      expect(Math.abs(end - start.x)).toBeLessThan(0.01);
    }
    await page.mouse.up();
  }
  expect(errors).toEqual([]);
});
