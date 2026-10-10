import { test, expect, type Page } from '@playwright/test';

/**
 * Step 3 of the slice in the browser (stage 2 of the transition; docs/realtime-slice.md, sections 6–9): the spin (Q) and
 * the consumables 1–4 from the keyboard and the mouse in the sandbox, the item panel of the HUD, an elite on screen.
 * Runs through playwright.realtime.config.ts only. The rules themselves are checked in Node (`npm run test:realtime-kit`).
 */
interface Snap {
  arena: string;
  status: string;
  hero: { x: number; y: number; hp: number; maxHp: number };
  enemies: { id: number; kind: string; x: number; y: number; hp: number; chill: number }[];
  energy: number;
  kills: number;
  spinsShown: number;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());

/** Opens the sandbox with clean storage and starts arena `n` by its menu key. */
async function openArena(page: Page, errors: string[], n: number): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press(String(n));
  await expect(page.getByTestId('menu')).toBeHidden();
}

/** No newcomers, enemies stand, touches do not hurt: only what the test places acts (journalled param commands). */
async function quiet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 20], ['baseIntervalMax', 20], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5);
  });
}

const place = (page: Page, x: number, y: number, kind: string, color = 0, hp = 0): Promise<number> =>
  page.evaluate(([x, y, kind, color, hp]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, kind, color, hp] as const);

test('spin: Q with 3 energy kills the enemies around the hero (a ring flashes); the HUD shows Q with its price and readiness', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await quiet(page);
  const near = await place(page, 8.9, 5, 'basic', 0, 0), tough = await place(page, 7.2, 5.3, 'basic', 2, 2), far = await place(page, 11, 5, 'basic', 1, 0);
  await expect(page.getByTestId('ability-spin')).toHaveText(/Q круговой · 3/);
  await expect(page.getByTestId('ability-spin')).not.toHaveClass(/rt-ready/);
  // Without energy Q does nothing.
  await page.keyboard.press('q');
  expect((await snap(page)).enemies.map(e => e.id).sort()).toEqual([near, tough, far].sort());
  await page.evaluate(() => (window as any).__realtime.setEnergy(3));
  await expect(page.getByTestId('ability-spin')).toHaveClass(/rt-ready/);
  await page.keyboard.press('q');
  await expect.poll(async () => (await snap(page)).enemies.map(e => e.id)).toEqual([far]);
  const s = await snap(page);
  expect(s.kills).toBe(2);
  expect(s.energy).toBe(0);
  // The ring is drawn in the next frame (the renderer reads the world's events).
  await expect.poll(async () => (await snap(page)).spinsShown).toBeGreaterThan(0);
  await expect(page.getByTestId('ability-spin')).not.toHaveClass(/rt-ready/);
  expect(errors).toEqual([]);
});

interface KitSnap extends Snap {
  items: Record<string, number> | null;
  itemsShown: Record<string, number>;
  signals: Record<string, number>;
  enemies: (Snap['enemies'][number] & { brittle: boolean; burn: number })[];
}
const kitSnap = (page: Page): Promise<KitSnap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);
/** Moves the mouse to an arena point (the consumables aim at the pointer). */
async function pointAt(page: Page, x: number, y: number): Promise<void> {
  const at = await screen(page, x, y);
  await page.mouse.move(at.x, at.y);
}

test('consumables 1–4 from the keyboard at the mouse: cold freezes (×2 ring), bomb kills, healing heals, fire burns; the HUD counts them', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await quiet(page);
  // The sandbox gives the panel's number of each (3).
  await expect(page.getByTestId('item-frost')).toHaveText(/1.*Холод.*×3/);
  await expect(page.getByTestId('item-fire')).toHaveText(/4.*Огонь.*×3/);
  const frozen = await place(page, 10, 5, 'basic', 0, 2), bombed = await place(page, 6, 6.5, 'basic', 1, 6), burnt = await place(page, 8, 2.5, 'basic', 2, 1);
  // 1 — cold at the pointer.
  await pointAt(page, 10, 5);
  await page.keyboard.press('1');
  await expect.poll(async () => (await kitSnap(page)).enemies.find(e => e.id === frozen)?.chill ?? 0).toBeGreaterThan(2);
  expect((await kitSnap(page)).enemies.find(e => e.id === frozen)!.brittle).toBe(true);
  await expect.poll(async () => (await kitSnap(page)).signals.frozen).toBe(1);
  await expect(page.getByTestId('item-frost')).toHaveText(/×2/);
  // 2 — the bomb on the enemy under the pointer.
  await pointAt(page, 6, 6.5);
  await page.keyboard.press('2');
  await expect.poll(async () => (await kitSnap(page)).enemies.some(e => e.id === bombed)).toBe(false);
  await expect(page.getByTestId('item-bomb')).toHaveText(/×2/);
  // 4 — fire: the enemy under the pointer burns (flames on screen) and dies at the first tick (1.5 s).
  await pointAt(page, 8, 2.5);
  await page.keyboard.press('4');
  await expect.poll(async () => (await kitSnap(page)).signals.burning).toBe(1);
  await expect.poll(async () => (await kitSnap(page)).enemies.some(e => e.id === burnt), { timeout: 5_000 }).toBe(false);
  // 3 — healing: refused at full HP (nothing spent), +9 after damage (iteration 2.1: the elixir +3 × 3; +8 before).
  await page.keyboard.press('3');
  await expect(page.getByTestId('item-healing')).toHaveText(/×3/);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 2); rt.place(rt.snapshot().hero.x + 0.5, rt.snapshot().hero.y, 3, 9, 'basic'); });
  await expect.poll(async () => (await kitSnap(page)).hero.hp, { timeout: 5_000 }).toBeLessThan(11);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 0); });
  const hurt = (await kitSnap(page)).hero.hp;
  await page.keyboard.press('3');
  await expect.poll(async () => (await kitSnap(page)).hero.hp).toBe(Math.min(15, hurt + 9));
  await expect(page.getByTestId('item-healing')).toHaveText(/×2/);
  const s = await kitSnap(page);
  expect(s.itemsShown).toEqual({ frost: 1, bomb: 1, healing: 1, fire: 1 });
  expect(s.items).toEqual({ frost: 2, bomb: 2, healing: 2, fire: 2 });
  expect(s.kills).toBe(2);
  await page.screenshot({ path: 'artifacts/realtime-items.png' });
  expect(errors).toEqual([]);
});

test('elite: a gold rim on a larger drawing; killed by the bomb it drops loot on screen, the hero walks onto it and takes it', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await quiet(page);
  // A random elite: its loot always drops (a resource).
  const id = await page.evaluate(() => (window as any).__realtime.place(10, 5, 0, 2, 'basic', 'random')) as number;
  await expect.poll(async () => (await kitSnap(page)).signals.elites).toBe(1);
  const elite = (await kitSnap(page)).enemies.find(e => e.id === id) as KitSnap['enemies'][number] & { elite: boolean };
  expect(elite.elite).toBeTruthy();
  expect(elite.hp).toBe(4);
  await page.screenshot({ path: 'artifacts/realtime-elite.png' });
  // Two bombs: 4 HP. The hero stands 4.7 away (bombs reach 5): the loot falls within 1.5 of the elite (`eliteLootRadius`)
  // and his touch cannot reach it — at 2 away it fell within his reach on about 1% of the random sandbox seeds and was
  // picked up the same tick (Node, 400 seeds).
  await page.evaluate(() => (window as any).__realtime.teleport(5.3, 5));
  await pointAt(page, 10, 5);
  await page.keyboard.press('2');
  await page.keyboard.press('2');
  await expect.poll(async () => (await kitSnap(page)).enemies.some(e => e.id === id)).toBe(false);
  await expect.poll(async () => (await kitSnap(page)).signals.loot).toBe(1);
  const before = await kitSnap(page) as KitSnap & { materials: Record<string, number> | null };
  const loot = (await page.evaluate(() => (window as any).__realtime.snapshot().objects)).find((o: { kind: string }) => o.kind === 'loot') as { x: number; y: number; loot: string };
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x - 1.2, y), [loot.x, loot.y]);
  await page.keyboard.down('d');
  await expect.poll(async () => (await kitSnap(page)).signals.loot, { timeout: 5_000 }).toBe(0);
  await page.keyboard.up('d');
  const after = await kitSnap(page) as KitSnap & { materials: Record<string, number> | null };
  const total = (s: { items: Record<string, number> | null; materials: Record<string, number> | null }) =>
    Object.values(s.items ?? {}).reduce((a, b) => a + b, 0) + Object.values(s.materials ?? {}).reduce((a, b) => a + b, 0);
  expect(total(after)).toBe(total(before) + 1);
  expect(errors).toEqual([]);
});

// ---- Phase B, track Д5 (docs/realtime-phase-b.md, section 9, «Д5»): the build column, the player's effects, colours Т5 ----

interface BuildSnap extends Snap {
  buildColumn: number;
  buildItems: { id: string; kind: string; progress: string; price: string | null }[];
  buildFlashing: string[];
  talismanFlashes: number;
  talismanTexts: number;
  playerEffects: { waves: number; blasts: number; cuts: number; cutTrail: number; cutFrames: number; fire: number; bombs: number; returns: number };
  palette: { chain: number[]; target: number; playerFx: number };
  kit: { talismans: string[]; hammer: string | null; counters: Record<string, number> } | null;
  buildFolded: number;
  buildBottom: number;
  buildTip: { ids: string; text: string } | null;
  reachRadius: number;
  focus: number;
  goal: { done: number; total: number };
}
const buildSnap = (page: Page): Promise<BuildSnap> => page.evaluate(() => (window as any).__realtime.snapshot());
const TEST_MODULE = 'view-test-counter';
const progressOf = async (page: Page, id: string): Promise<string> => (await buildSnap(page)).buildItems.find(i => i.id === id)?.progress ?? '';

/** Draws a chain with the mouse through the enemies `ids` in order and releases it; waits until the hero stands again. */
async function chainThrough(page: Page, ids: number[]): Promise<void> {
  const s = await buildSnap(page);
  const points = [];
  for (const id of ids) { const e = s.enemies.find(x => x.id === id)!; points.push(await screen(page, e.x, e.y)); }
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.up();
  // The release starts the dash at once (pointerup → `release`); wait until it is over.
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.snapshot().moving)).toBe(null);
}

test('build column (Д5): only the items taken, the hammer and the relic in frames, the relic with its price; a counter grows by real chains and flashes', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  // Nothing taken: no column.
  await expect(page.getByTestId('build-column')).toBeHidden();
  expect((await buildSnap(page)).buildColumn).toBe(0);
  // The sandbox test hook: a counter talisman, a relic, a hammer and the view's test counter (buildTestModule.ts — the real
  // rules are tracks Д1–Д3). It restarts the arena with them in the loadout.
  await page.evaluate(() => (window as any).__realtime.useBuild({ talismans: ['fifth-link', 'relic-millstone'], hammer: 'cutting-pass', testModule: true }, 5));
  await quiet(page);
  await expect(page.getByTestId('build-column')).toBeVisible();
  const s0 = await buildSnap(page);
  expect(s0.kit?.hammer).toBe('cutting-pass');
  expect(s0.buildColumn).toBe(4);
  expect(s0.buildItems.map(i => [i.id, i.kind])).toEqual([['fifth-link', 'talisman'], [TEST_MODULE, 'talisman'], ['cutting-pass', 'hammer'], ['relic-millstone', 'relic']]);
  expect(s0.buildItems.find(i => i.id === 'relic-millstone')!.price).toBe('−3 HP');
  await expect(page.getByTestId('build-relic-millstone')).toContainText('Жерн');
  await expect(page.getByTestId('build-relic-millstone')).toContainText('−3 HP');
  // The column stays left of the arena 16×10 (x 8–70; the arena starts at ≈ 83 px at 1280×720) and below the top HUD.
  const box = (await page.getByTestId('build-column').boundingBox())!;
  const arenaLeft = (await screen(page, 0, 0)).x;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(70.5);
  expect(box.x + box.width).toBeLessThan(arenaLeft);
  expect(box.y).toBeGreaterThanOrEqual(70);
  // The test counter fires on every 3rd chain kill: dots ○○○ → ●●○ after a chain of two.
  expect(s0.buildItems.find(i => i.id === TEST_MODULE)!.progress).toBe('○○○');
  const a = await place(page, 9, 5, 'basic', 0, 0), b = await place(page, 10, 5, 'basic', 0, 0);
  await chainThrough(page, [a, b]);
  await expect.poll(() => progressOf(page, TEST_MODULE)).toBe('●●○');
  expect((await buildSnap(page)).talismanFlashes).toBe(0);
  // The cut hammer is in the kit: the dash left its thin white trail; the test module's events drew the wave, the blast,
  // the cut with the pale-blue rim (the fire — the real hammer test).
  let fx = (await buildSnap(page)).playerEffects;
  expect(fx.cutFrames).toBeGreaterThan(0);
  expect(fx.waves).toBe(1);
  expect(fx.blasts).toBe(1);
  expect(fx.cuts).toBe(1);
  // The third kill fires: the icon flashes (0.6 s), a short text at the hero, the counter starts again.
  const c = await place(page, 11.5, 5, 'basic', 1, 0);
  await chainThrough(page, [c]);
  await expect.poll(async () => (await buildSnap(page)).talismanFlashes).toBe(1);
  const s1 = await buildSnap(page);
  expect(s1.talismanTexts).toBe(1);
  expect(await progressOf(page, TEST_MODULE)).toBe('○○○');
  await page.screenshot({ path: 'artifacts/realtime-phaseB-build-column.png' });
  await expect.poll(async () => (await buildSnap(page)).buildFlashing, { timeout: 3_000 }).toEqual([]);
  // The player's bomb (key 2) — counted as a player effect (the pale-blue rim, apart from the sapper's blast).
  const hero = (await buildSnap(page)).hero, dx = hero.x - 2.5, dy = hero.y + 1;
  const d = await place(page, dx, dy, 'basic', 2, 3);
  await pointAt(page, dx, dy);
  await page.keyboard.press('2');
  await expect.poll(async () => (await kitSnap(page)).enemies.some(e => e.id === d)).toBe(false);
  // The burst is drawn in the next frame (the renderer reads the world's events).
  await expect.poll(async () => (await buildSnap(page)).playerEffects.bombs).toBe(1);
  // Back to the panel's build: nothing taken — no column.
  await page.evaluate(() => (window as any).__realtime.useBuild(null));
  await expect(page.getByTestId('build-column')).toBeHidden();
  expect(errors).toEqual([]);
});

test('build in the sandbox panel (Д5): a hammer and a relic chosen there reach the next arena\'s loadout and the column; the journal keeps the loadout', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await page.keyboard.press('Backquote');
  await page.getByTestId('build-hammer').selectOption('end-blast');
  await page.getByTestId('build-relic').selectOption('relic-wide-circle');
  await page.getByTestId('build-talisman').selectOption('long-arm');
  await page.getByTestId('restart').click();
  await expect.poll(async () => (await buildSnap(page)).kit?.hammer ?? null).toBe('end-blast');
  // The column follows the kit in the next frame.
  await expect.poll(async () => (await buildSnap(page)).buildItems.map(i => i.id)).toEqual(['long-arm', 'end-blast', 'relic-wide-circle']);
  const s = await buildSnap(page);
  expect(s.kit!.talismans).toEqual(['long-arm', 'relic-wide-circle']);
  expect(s.buildItems.find(i => i.id === 'relic-wide-circle')!.price).toBe('враг +10%');
  const journal = await page.evaluate(() => (window as any).__realtime.journal());
  expect(journal.loadout.hammer).toBe('end-blast');
  expect(journal.params.sandboxTalismans).toBe('');
  // The choice survives a reload (its own storage key, not a Param).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press('1');
  await expect.poll(async () => (await buildSnap(page)).kit?.hammer ?? null).toBe('end-blast');
  expect(errors).toEqual([]);
});

/** Pixels of a page rectangle, decoded in the page (no PNG library in Node): [r, g, b] per pixel, row by row. */
async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number[][]> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async src => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data, out: number[][] = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, png);
}
const near = (p: number[], hex: number, tol: number): boolean => Math.abs(p[0] - (hex >> 16 & 255)) <= tol && Math.abs(p[1] - (hex >> 8 & 255)) <= tol && Math.abs(p[2] - (hex & 255)) <= tol;

test('colours Т5 (Д5): the yellow of the chain is ochre c8962e, the rim of an elite is lemon ffff66 (pixels of the arena)', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await quiet(page);
  const s = await buildSnap(page);
  expect(s.palette.chain.slice(0, 4)).toEqual([0xca7970, 0x9fba7c, 0x79b0c4, 0xc8962e]);
  expect(s.palette.target).toBe(0xffff66);
  // A plain enemy of colour 3: its disc below the sigil is ochre.
  const plain = await place(page, 6, 6.5, 'basic', 3, 0);
  const elite = await page.evaluate(() => (window as any).__realtime.place(10, 5, 3, 1, 'basic', true)) as number;
  await page.waitForTimeout(400);
  const scale = (await page.evaluate(() => (window as any).__realtime.camera())).scale as number;
  const r = 0.4 * 0.8 * 72 * scale;
  const where = (await buildSnap(page)).enemies, p0 = where.find(x => x.id === plain)!, p1 = where.find(x => x.id === elite)!;
  const at = await screen(page, p0.x, p0.y);
  // A vertical strip from under the sigil to past the rim: the disc fill is in it whatever the drawn size.
  const disc = await pixels(page, { x: Math.round(at.x) - 1, y: Math.round(at.y + r * 0.4), width: 3, height: Math.round(r * 0.8) });
  expect(disc.some(p => near(p, 0xc8962e, 6)), JSON.stringify(disc)).toBe(true);
  expect(disc.some(p => near(p, 0xd8b66a, 6))).toBe(false);
  // The elite: a lemon rim around its larger drawing (scan a strip to the right of its centre).
  const e = await screen(page, p1.x, p1.y);
  const strip = await pixels(page, { x: Math.round(e.x + r), y: Math.round(e.y) - 1, width: Math.round(r * 1.2), height: 3 });
  expect(strip.some(p => near(p, 0xffff66, 12)), JSON.stringify(strip)).toBe(true);
  expect(strip.some(p => near(p, 0xffd36b, 8))).toBe(false);
  expect(errors).toEqual([]);
});

// ---- Phase B, Д5 round 2: acceptance through real actions with the real modules (section 7 of docs/realtime-phase-b.md) ----

const panelParam = (page: Page, key: string): Promise<number> => page.evaluate(k => (window as any).__realtime.params[k], key);
/** A plain enemy of `color` at `dx` units right of the hero (left with a negative `dx`). */
async function besideHero(page: Page, dx: number, color = 0, hp = 0): Promise<number> {
  const h = (await buildSnap(page)).hero;
  return place(page, h.x + dx, h.y, 'basic', color, hp);
}

test('acceptance Т1 «Длинная рука» (Д5): progress in the column grows by real chains, the 4th chain has R ×1.5 (wider circle), the release flashes the icon and writes at the hero', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await page.evaluate(() => (window as any).__realtime.useBuild({ talismans: ['long-arm'] }, 5));
  await quiet(page);
  const base = await panelParam(page, 'linkRadius');
  await expect.poll(() => progressOf(page, 'long-arm')).toBe('○○○○');
  expect((await buildSnap(page)).reachRadius).toBeCloseTo(base, 6);
  // Three chains of one enemy each, drawn with the mouse (left, right, left: the hero stays near the middle).
  const expected = ['●○○○', '●●○○', '●●●●'];
  for (let i = 0; i < 3; i++) {
    await chainThrough(page, [await besideHero(page, i % 2 ? 1 : -1, i % 4)]);
    await expect.poll(() => progressOf(page, 'long-arm')).toBe(expected[i]);
  }
  // The next chain is the 4th: armed — the circle of R around the hero is 1.5 times wider before and while it is drawn.
  expect((await buildSnap(page)).reachRadius).toBeCloseTo(base * 1.5, 6);
  expect((await buildSnap(page)).talismanFlashes).toBe(0);
  const id = await besideHero(page, 1.2);
  const e = (await buildSnap(page)).enemies.find(x => x.id === id)!, at = await screen(page, e.x, e.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  expect((await buildSnap(page)).reachRadius).toBeCloseTo(base * 1.5, 6);
  await page.mouse.up();
  // Released: the item fired — the icon flashes, a short text at the hero; the counter starts again, R is back.
  await expect.poll(async () => (await buildSnap(page)).talismanFlashes).toBe(1);
  expect((await buildSnap(page)).talismanTexts).toBe(1);
  await expect.poll(() => progressOf(page, 'long-arm')).toBe('○○○○');
  expect((await buildSnap(page)).reachRadius).toBeCloseTo(base, 6);
  expect(errors).toEqual([]);
});

test('acceptance Т2 hammers (Д5): «Режущий проход» kills an enemy of another colour beside the path (credited, «убито» grows, the cut drawn); «Огненный проход» leaves fire drawn from its state', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await page.evaluate(() => (window as any).__realtime.useBuild({ hammer: 'cutting-pass' }, 5));
  await quiet(page);
  await expect(page.getByTestId('build-cutting-pass')).toBeVisible();
  // Two links of colour 0 to the right; an enemy of colour 1 lies just off the line between them (not a link).
  const a = await place(page, 9.2, 5, 'basic', 0, 0), b = await place(page, 10.8, 5, 'basic', 0, 0), bystander = await place(page, 10, 5.35, 'basic', 1, 0);
  expect((await buildSnap(page)).stats.kills).toBe(0);
  await chainThrough(page, [a, b]);
  await expect.poll(async () => (await buildSnap(page)).enemies.some(x => x.id === bystander)).toBe(false);
  const s = await buildSnap(page);
  expect(s.stats.kills).toBe(3);
  expect(s.goal.done).toBe(3);
  await expect(page.getByTestId('goal')).toHaveText(/убито 3/);
  expect(s.playerEffects.cuts).toBeGreaterThanOrEqual(1);
  expect(s.playerEffects.cutFrames).toBeGreaterThan(0);
  // «Огненный проход»: the path burns — the view draws the module's fire points (World.build['fire-pass'].points).
  await page.evaluate(() => (window as any).__realtime.useBuild({ hammer: 'fire-pass' }, 6));
  await quiet(page);
  const c = await place(page, 9.2, 5, 'basic', 2, 0), d = await place(page, 10.6, 5, 'basic', 2, 0);
  await chainThrough(page, [c, d]);
  await expect.poll(async () => (await buildSnap(page)).playerEffects.fire).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-phaseB-hammer-fire.png' });
  expect(errors).toEqual([]);
});

test('acceptance Т3 relics (Д5): «Широкий круг» — the R circle 1.25 times wider; «Тяжёлый клинок» — the focus reserve and its bar half as long', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  const base = await panelParam(page, 'linkRadius'), focusMax = await panelParam(page, 'focusMax');
  const barWidth = async (): Promise<number> => (await page.getByTestId('focus').boundingBox())!.width;
  const plainBar = await barWidth();
  await page.evaluate(() => (window as any).__realtime.useBuild({ talismans: ['relic-wide-circle'] }, 5));
  await expect.poll(async () => (await buildSnap(page)).reachRadius).toBeCloseTo(base * 1.25, 6);
  await expect(page.getByTestId('build-relic-wide-circle')).toContainText('враг +10%');
  await page.evaluate(() => (window as any).__realtime.useBuild({ talismans: ['relic-heavy-blade'] }, 5));
  await expect.poll(async () => Math.round(await barWidth())).toBe(Math.round(plainBar / 2));
  expect((await buildSnap(page)).focus).toBeCloseTo(focusMax / 2, 6);
  expect((await buildSnap(page)).reachRadius).toBeCloseTo(base, 6);
  await expect(page.getByTestId('build-relic-heavy-blade')).toContainText('фокус ½');
  expect(errors).toEqual([]);
});

test('column hover card (Д5): the full name and rule from the run catalogue, a relic and the oath with their price; a chain dragged over the column goes on', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  await page.evaluate(() => (window as any).__realtime.useBuild({ talismans: ['third-chain', 'oath-hunger', 'relic-blood-oath'], hammer: 'end-blast' }, 5));
  await quiet(page);
  await expect(page.getByTestId('build-tip')).toBeHidden();
  await page.getByTestId('build-relic-blood-oath').hover();
  const tip = page.getByTestId('build-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Кровавая клятва');
  await expect(tip).toContainText('+1 энергия за каждые 6 убийств цепью на арене');
  await expect(tip).toContainText('Цена: лечение расходником вдвое слабее (9 → 5)');
  await page.getByTestId('build-third-chain').hover();
  await expect(tip).toContainText('Третья цепь');
  await expect(tip).toContainText('следующий прыжок за 5 с бесплатен');
  await expect(tip).not.toContainText('Цена:');
  await page.getByTestId('build-oath-hunger').hover();
  await expect(tip).toContainText('+1 HP за 15 убийств цепью');
  await expect(tip).toContainText('Цена: без привала');
  await expect(page.getByTestId('build-oath-hunger')).toContainText('0/15');
  await page.getByTestId('build-end-blast').hover();
  await expect(tip).toContainText('Взрыв на конце');
  await page.screenshot({ path: 'artifacts/realtime-phaseB-column-tip.png' });
  // A chain drawn over the column: the button held, the pointer passes over it and comes back — the chain is released whole.
  const a = await place(page, 9, 5, 'basic', 0, 0), b = await place(page, 10.2, 5, 'basic', 0, 0);
  const s = await buildSnap(page), pa = await screen(page, 9, 5), pb = await screen(page, 10.2, 5);
  const column = (await page.getByTestId('build-column').boundingBox())!;
  void s;
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move(column.x + 30, column.y + 20, { steps: 6 });
  await expect(tip).toBeHidden();
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  expect((await page.evaluate(() => (window as any).__realtime.snapshot().chain)) as number[]).toEqual([a, b]);
  await page.mouse.up();
  await expect.poll(async () => (await buildSnap(page)).enemies.filter(x => x.id === a || x.id === b).length).toBe(0);
  expect(errors).toEqual([]);
});

test('column with many items (Д5): 12 items end above the action bar; 22 items get compact and fold the rest into «+N», whose card lists them', async ({ page }) => {
  const errors: string[] = [];
  await openArena(page, errors, 1);
  const actionTop = async (): Promise<number> => (await page.getByTestId('action-bar').boundingBox())!.y;
  const twelve = ['whetstone', 'dew-flask', 'tough-hide', 'millstone-shard', 'hourglass', 'nimble-paws', 'ash-ward', 'hero-anchor', 'fifth-link', 'long-arm', 'relic-millstone'];
  await page.evaluate(t => (window as any).__realtime.useBuild({ talismans: t, hammer: 'return-pass' }, 5), twelve);
  await expect.poll(async () => (await buildSnap(page)).buildColumn).toBe(12);
  let s = await buildSnap(page);
  expect(s.buildFolded).toBe(0);
  expect(s.buildBottom).toBeLessThanOrEqual(await actionTop());
  await page.screenshot({ path: 'artifacts/realtime-phaseB-column-12.png' });
  const all = [...twelve, 'third-chain', 'shockwave', 'prism', 'finishing-blow', 'elite-hunter', 'frost-edge', 'oath-hunger', 'relic-heavy-blade', 'relic-wide-circle', 'relic-blood-oath'];
  await page.evaluate(t => (window as any).__realtime.useBuild({ talismans: t, hammer: 'return-pass' }, 5), all);
  await expect.poll(async () => (await buildSnap(page)).buildColumn).toBe(22);
  await expect.poll(async () => (await buildSnap(page)).buildFolded).toBeGreaterThan(0);
  s = await buildSnap(page);
  expect(s.buildBottom).toBeLessThanOrEqual(await actionTop());
  await expect(page.getByTestId('build-column')).toHaveClass(/rt-build-compact/);
  const more = page.getByTestId('build-more');
  await expect(more).toContainText(`+${s.buildFolded}`);
  await more.hover();
  await expect(page.getByTestId('build-tip')).toContainText('Кровавая клятва');
  await page.screenshot({ path: 'artifacts/realtime-phaseB-column-22.png' });
  expect(errors).toEqual([]);
});
