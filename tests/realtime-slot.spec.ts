import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { gameWait, untilFrame } from './realtimeFrames';

/**
 * Casino stage 1: the view and the input of «Однорукий гоблин» in the sandbox (docs/realtime-casino.md): the panel button
 * «Гоблин» puts the idol near the hero (its marker first), a chain drawn with the mouse to the lever shows the odds line over
 * the idol, the release pulls the lever — the reels spin and stop, the result shows, the lever goes dark. Runs through
 * playwright.realtime.config.ts only. The rules themselves are checked in Node (src/realtime/sim/slot.spec.ts).
 */
interface SlotShown { idols: number; markers: number; spinning: number; stopped: number; dark: number; odds: number; oddsText: string; pulls: number; results: number; lastResult: string; caption: string; captionRisky: boolean; dots: { gold: number; red: number; dark: number }; busts: number; feeds: number; feedText: string;
  textPlace: 'up' | 'down'; reelsPlace: 'up' | 'down'; captionRect: Rect | null; oddsRect: Rect | null; reelsRect: Rect | null; sparks: number; sparkFrom: { x: number; y: number } | null; sparkTo: { x: number; y: number } | null; heroFlashes: number }
interface Rect { left: number; top: number; right: number; bottom: number }
interface Snap { chain: number[]; chainLinks: { kind: string; id: number }[]; moving: string | null; hero: { hp: number }; slot: { goblin: { id: number; x: number; y: number; pulls: number; skulls: number[]; spinning: boolean } | null; shown: SlotShown; marks: number; flashes: number } }
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);

test('the panel button «Гоблин», a mouse chain to the lever with the odds line, the reels spin and stop, the lever goes dark', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  // A quiet field: no newcomers, nobody walks or touches; the hero in the open middle.
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    // De-flake 12.10.2026: the lever stays dark for `slotCooldown` game s after the pull, and the hint check came after
    // the spin, two screenshots and the hover; on a loaded runner the 8 s ran out first and the lever lit again (no hint).
    // 30 s keeps it dark through the check (the cooldown's length is Node's, src/realtime/sim/slot.spec.ts).
    for (const [k, v] of Object.entries({ enemySpeed: 0, speedSpread: 0, baseIntervalMin: 20, baseIntervalMax: 20, baseFloor: 0, contactDamage: 0, slotCooldown: 30 })) rt.setParam(k, v);
    // The group timer rolled at the start still fires once (and every 20 s): an arena limit of 0 keeps its newcomers out
    // of the scene — a direct write, since the journalled `setParam` clamps the limit to the panel's 1.
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(8, 5);
  });
  expect(await page.evaluate(() => (window as any).__realtime.params.slot)).toBe(false);

  // The sandbox button: the toggle turns on, the goblin stands 3–7 from the hero, its marker first (the lever not a target).
  await page.keyboard.press('Backquote');
  await page.getByTestId('slot-goblin').click();
  await expect.poll(async () => (await snap(page)).slot.goblin !== null).toBe(true);
  expect(await page.evaluate(() => (window as any).__realtime.params.slot)).toBe(true);
  let s = await snap(page);
  const g = s.slot.goblin!;
  const d = Math.hypot(g.x - 8, g.y - 5);
  expect(d).toBeGreaterThanOrEqual(3 - 1e-6);
  expect(d).toBeLessThanOrEqual(7 + 1e-6);
  // The marker is drawn on the next frame (the view reads the world as it draws).
  await expect.poll(async () => (await snap(page)).slot.shown.markers, { timeout: 1_500 }).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-slot-marker.png' });
  await page.keyboard.press('Backquote');
  await expect.poll(async () => { const v = (await snap(page)).slot.shown; return v.markers === 0 && v.idols === 1 && v.dark === 0; }, { timeout: 5_000 }).toBe(true);

  // Two weak enemies on the line the hero saw the idol along, the hero behind them: a chain of 2 links and the lever.
  const ux = (8 - g.x) / d, uy = (5 - g.y) / d, step = Math.min(1.1, d / 3);
  const at = (k: number) => ({ x: g.x + ux * step * k, y: g.y + uy * step * k });
  const ids = await page.evaluate(([a, b, h]) => {
    const rt = (window as any).__realtime;
    rt.teleport(h.x, h.y);
    return [rt.place(b.x, b.y, 0, 0, 'basic'), rt.place(a.x, a.y, 0, 0, 'basic')];
  }, [at(1), at(2), at(3)] as const);
  await page.waitForTimeout(300);
  const first = await screen(page, at(2).x, at(2).y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain).toEqual([ids[0]]);
  const second = await screen(page, at(1).x, at(1).y);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chain).toEqual(ids);
  // The chain can end on the lever now: the line over the idol (2 links take one skull off reel 1).
  await expect.poll(async () => (await snap(page)).slot.shown.odds).toBe(1);
  expect((await snap(page)).slot.shown.oddsText).toBe('дождь 2,2 % · залп 17,8 %');
  const leverAt = await screen(page, g.x, g.y);
  await page.mouse.move(leverAt.x, leverAt.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chainLinks.map(l => l.kind)).toEqual(['enemy', 'enemy', 'object']);
  s = await snap(page);
  expect(s.slot.shown.oddsText).toBe('дождь 2,2 % · залп 17,8 %');
  await page.screenshot({ path: 'artifacts/realtime-slot-odds.png' });
  await page.mouse.up();

  // The pull: the reels spin, then stop one by one; the result; the lever dark.
  await expect.poll(async () => (await snap(page)).slot.shown.spinning, { timeout: 5_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-slot-spin.png' });
  await expect.poll(async () => (await snap(page)).slot.shown.results, { timeout: 5_000 }).toBe(1);
  s = await snap(page);
  expect(s.slot.goblin!.pulls).toBe(1);
  expect(s.slot.shown.pulls).toBe(1);
  expect(s.slot.shown.dark).toBe(1);
  expect(s.slot.goblin!.skulls.reduce((a, b) => a + b, 0)).toBe(7);
  // «Перебор» off (the sandbox default): no dots, no caption — the old idol.
  expect(s.slot.shown.caption).toBe('');
  expect(s.slot.shown.dots).toEqual({ gold: 0, red: 0, dark: 0 });
  await page.screenshot({ path: 'artifacts/realtime-slot-result.png' });
  // The hint on the dark lever.
  await page.mouse.move(leverAt.x + 1, leverAt.y + 1);
  const hover = await screen(page, g.x, g.y);
  await page.mouse.move(hover.x, hover.y);
  await expect.poll(async () => page.evaluate(() => (window as any).__realtime.snapshot().hint)).toBe('lever');
  expect(errors).toEqual([]);
});

/**
 * «Перебор» (design 12.10.2026, playtest v34): the idol's charge dots, the caption «безопасно: N», the red odds line of the
 * risky pull and the bust, all with real mouse chains in the sandbox. Seeds: the bust roll is the first draw of the stream
 * `slot:bust`, which only the risky pulls (the 4th and later) draw — BUST_SEED (k=6) first draw is under 0.55 (busts), SAFE_SEED's
 * is not (a triple); both checked in Node against `world.rng.stream('slot:bust')` and here against the real game's result.
 */
const BUST_SEED = Math.imul(6, 2654435761) >>> 0;
const SAFE_SEED = Math.imul(1, 2654435761) >>> 0;

async function openBustSandbox(page: Page, seed: number, topEdge = false): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  await page.evaluate(([seed, topEdge]) => {
    const rt = (window as any).__realtime;
    rt.restart(seed);
    // A quiet field (as above); six pulls, a short cooldown, the rule on — all journalled commands.
    for (const [k, v] of Object.entries({ enemySpeed: 0, speedSpread: 0, baseIntervalMin: 20, baseIntervalMax: 20, baseFloor: 0, contactDamage: 0, slot: true, slotBust: true, slotPulls: 6, slotCooldown: 0.5 })) rt.setParam(k, v);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(8, topEdge ? 1 : 5);
    rt.summonGoblin();
  }, [seed, topEdge] as const);
  await expect.poll(async () => (await snap(page)).slot.goblin !== null).toBe(true);
  // Task 5б: the idol at the top edge — summon again (a standing idol is replaced, another spot by the rules) until it stands in the top 1.3 units.
  for (let i = 0; topEdge && i < 60 && (await snap(page)).slot.goblin!.y > 1.3; i++) {
    await page.evaluate(() => (window as any).__realtime.summonGoblin());
    await gameWait(page, 0.1);
  }
  if (topEdge) expect((await snap(page)).slot.goblin!.y).toBeLessThanOrEqual(1.3);
  // The marker first, then the lever is ready.
  await untilFrame(page, snap => snap.slot.shown.idols === 1 && snap.slot.shown.markers === 0 && snap.slot.shown.dark === 0 ? true : undefined, null, 20);
  return errors;
}

/** One pull by the mouse: a hero 2.4 from the idol, a weak enemy between, press on it, drag to the lever; `hold` runs with the chain drawn. */
async function pullByMouse(page: Page, hold?: () => Promise<void>): Promise<void> {
  const g = (await snap(page)).slot.goblin!;
  const d = Math.hypot(g.x - 8, g.y - 5), ux = (8 - g.x) / d, uy = (5 - g.y) / d;
  await page.evaluate(([e, h]) => {
    const rt = (window as any).__realtime;
    rt.teleport(h.x, h.y);
    rt.place(e.x, e.y, 0, 0, 'basic');
  }, [{ x: g.x + ux * 1.2, y: g.y + uy * 1.2 }, { x: g.x + ux * 2.4, y: g.y + uy * 2.4 }] as const);
  await gameWait(page, 0.15);
  const enemy = await screen(page, g.x + ux * 1.2, g.y + uy * 1.2);
  await page.mouse.move(enemy.x, enemy.y);
  await page.mouse.down();
  await expect.poll(async () => (await snap(page)).chain.length).toBe(1);
  const lever = await screen(page, g.x, g.y);
  await page.mouse.move(lever.x, lever.y, { steps: 4 });
  await expect.poll(async () => (await snap(page)).chainLinks.map(l => l.kind)).toEqual(['enemy', 'object']);
  await untilFrame(page, snap => snap.slot.shown.odds === 1 ? true : undefined, null, 5);
  if (hold) await hold();
  await page.mouse.up();
  // The release starts the dash; the pull lands when it touches the lever.
  await untilFrame(page, (snap, was: number) => snap.slot.goblin && snap.slot.goblin.pulls > was ? true : undefined, g.pulls, 10);
}

/** The lever may be pulled again: the spin and the result are over, the cooldown ran out. */
const untilReady = (page: Page): Promise<boolean> => untilFrame(page, snap => snap.slot.goblin && !snap.slot.goblin.spinning && snap.slot.shown.dark === 0 ? true : undefined, null, 20);

test('«Перебор»: dots and the caption count down 3→2→1→0, the 4th pull shows the risky odds, the first risky roll busts', async ({ page }) => {
  const errors = await openBustSandbox(page, BUST_SEED);
  const hp0 = (await snap(page)).hero.hp;
  let s = await snap(page);
  // Before any pull: six dots (3 gold, 3 red), «безопасно: 3»; the idol is the old one otherwise.
  await untilFrame(page, snap => snap.slot.shown.caption !== '' ? true : undefined, null, 5);
  s = await snap(page);
  expect(s.slot.shown.dots).toEqual({ gold: 3, red: 3, dark: 0 });
  expect(s.slot.shown.caption).toBe('безопасно: 3');
  expect(s.slot.shown.captionRisky).toBe(false);
  for (const left of [2, 1, 0]) {
    await pullByMouse(page);
    await untilFrame(page, snap => snap.slot.shown.results >= 1 && snap.slot.goblin && !snap.slot.goblin.spinning ? true : undefined, null, 10);
    await untilReady(page);
    s = await snap(page);
    const pulls = 3 - left;
    expect(s.slot.goblin!.pulls).toBe(pulls);
    // Spent dots go dark from the left; the gold ones are the safe pulls still to come.
    expect(s.slot.shown.dots).toEqual({ gold: left, red: 3, dark: pulls });
    if (left > 0) expect(s.slot.shown.caption).toBe(`безопасно: ${left}`);
    else { expect(s.slot.shown.caption).toBe('взрыв 55 % · −4 HP'); expect(s.slot.shown.captionRisky).toBe(true); }
    if (left === 2) {
      // The hero steps off the lever so the idol and its dots show.
      await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [8, 3] as const);
      await gameWait(page, 0.3);
      await page.screenshot({ path: 'artifacts/realtime-slot-charges.png' });
    }
    expect(s.hero.hp).toBeGreaterThanOrEqual(hp0 - 0); // the safe pulls never hurt
    // The three safe pulls never bust.
    expect(s.slot.shown.busts).toBe(0);
  }
  // The 4th pull: the odds line over the idol while the chain is drawn.
  // Arrows of an earlier pull (a skull on a safe pull) must not land during the check: the HP change below is the bust's alone.
  await untilFrame(page, snap => snap.slot.marks === 0 ? true : undefined, null, 30);
  await gameWait(page, 3);
  expect((await snap(page)).slot.marks).toBe(0);
  const flashes0 = (await snap(page)).slot.flashes;
  const hpBefore = (await snap(page)).hero.hp;
  await pullByMouse(page, async () => {
    expect((await snap(page)).slot.shown.oddsText).toBe('взрыв 55 % · −4 HP · иначе тройка');
    await page.screenshot({ path: 'artifacts/realtime-slot-risky-odds.png' });
  });
  // The reels spin (the warning), then the idol blows up: -4 HP wherever the hero stands, the goblin is gone.
  await untilFrame(page, snap => snap.slot.shown.spinning > 0 ? true : undefined, null, 5);
  expect((await snap(page)).slot.goblin).not.toBeNull();
  await untilFrame(page, snap => snap.slot.shown.busts >= 1 ? true : undefined, null, 10);
  await page.screenshot({ path: 'artifacts/realtime-slot-bust.png' });
  s = await snap(page);
  expect(s.slot.goblin).toBeNull();
  expect(s.slot.shown.lastResult).toBe('bust');
  expect(s.slot.shown.busts).toBe(1);
  expect(s.hero.hp).toBe(hpBefore - 4);
  expect(s.slot.flashes).toBe(flashes0); // no arrow fell: the bust flash is not the arrow's
  await gameWait(page, 1);
  s = await snap(page);
  expect(s.slot.shown.idols).toBe(0);
  expect(s.slot.shown.caption).toBe('');
  expect(errors).toEqual([]);
});

test('«Перебор»: a risky pull that does not bust gives a triple of a good symbol, no damage, the idol stays', async ({ page }) => {
  const errors = await openBustSandbox(page, SAFE_SEED);
  for (let i = 0; i < 3; i++) { await pullByMouse(page); await untilReady(page); }
  await pullByMouse(page);
  const hpBefore = (await snap(page)).hero.hp;
  await untilFrame(page, snap => snap.slot.shown.results >= 4 ? true : undefined, null, 10);
  const s = await snap(page);
  expect(['heart3', 'bolt3', 'gem3', 'jackpot']).toContain(s.slot.shown.lastResult);
  expect(s.slot.shown.busts).toBe(0);
  expect(s.slot.goblin!.pulls).toBe(4);
  expect(s.hero.hp).toBeGreaterThanOrEqual(hpBefore);
  // The caption keeps warning: the 5th pull is risky too.
  await untilReady(page);
  expect((await snap(page)).slot.shown.caption).toBe('взрыв 55 % · −4 HP');
  expect(errors).toEqual([]);
});

/**
 * Task 5 «Срез казино-слоя в походе + гоблин главный» (12.10.2026; docs/realtime-casino.md, «Срез казино-слоя в походе»): a run
 * with real clicks and a real mouse chain. Seed 10, the full gift button 1: `r5c0` is a battle of run row 1, `r6c1` a battle
 * of run row 2 (its card offered oaths before task 5). Row 1: the card says «В бой», no «Зарок»; after the goals the goblin
 * stands; a chain of 6 drawn with the mouse floats «+1 рывок без риска» over the hero and the caption over the idol grows
 * «безопасно: 3» → «безопасно: 4»; the hero goes through the door: the result has no «Котёл» row and leads to the map, no die
 * screen. Row 2: the card says «В бой», no «Зарок», no stake line.
 */
test('task 5, the run: no «Зарок» on the cards, the goblin after the goals of a row-1 battle, a mouse chain of 6 — «+1 рывок без риска» and the caption grows; no «Котёл», no die', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 10);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('node-r5c0').click();
  await expect(page.getByTestId('run-detail')).toBeVisible();
  await expect(page.getByTestId('run-oaths')).toHaveCount(0);
  await expect(page.getByTestId('run-detail')).not.toContainText('Зарок');
  await expect(page.getByTestId('run-enter')).toHaveText('В бой');
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('oath-line')).toBeHidden();

  // A quiet arena (journalled setup): nobody walks, touches or comes.
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of Object.entries({ enemySpeed: 0, speedSpread: 0, baseIntervalMin: 20, baseIntervalMax: 20, baseFloor: 0, contactDamage: 0 })) rt.setParam(k, v);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.completeGoals();
  });
  // The goblin after the goals (the run's chance 1), its marker, then the caption «безопасно: 3».
  await untilFrame(page, (snap, _a, late) => snap.slot.goblin || late ? true : undefined, null, 6);
  await untilFrame(page, (snap, _a, late) => (snap.slot.shown.idols === 1 && snap.slot.shown.markers === 0 && snap.slot.shown.caption !== '') || late ? true : undefined, null, 6);
  let s = await snap(page);
  expect(s.slot.goblin).not.toBeNull();
  expect(s.slot.shown.caption).toBe('безопасно: 3');
  expect(s.slot.shown.dots).toEqual({ gold: 3, red: 3, dark: 0 });
  const g = s.slot.goblin!;

  // A chain of 6 weak enemies drawn with the mouse on a free line away from the idol (other lines when one is blocked).
  const view = { hero: (await page.evaluate(() => (window as any).__realtime.snapshot().hero)) as { x: number; y: number } };
  const tries: [number, number, number, number][] = [];
  for (const [ox, oy] of [[0, 0], [0, 3], [0, -3], [4, 0], [-4, 0], [3, 3], [-3, -3], [3, -3], [-3, 3]]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) tries.push([ox, oy, dx, dy]);
  let drawn = false;
  for (const [ox, oy, dx, dy] of tries) {
    const start = { x: view.hero.x + ox, y: view.hero.y + oy };
    const points = Array.from({ length: 6 }, (_, i) => ({ x: start.x + dx * 1.2 * (i + 1), y: start.y + dy * 1.2 * (i + 1) }));
    // Off the idol and inside the arena's near edge (a line that leaves the arena takes fewer links and is tried no further).
    if ([start, ...points].some(p => Math.hypot(p.x - g.x, p.y - g.y) < 2 || p.x < 0.8 || p.y < 0.8)) continue;
    await page.evaluate(([h, pts]) => { const rt = (window as any).__realtime; rt.teleport(h.x, h.y); for (const p of pts) rt.place(p.x, p.y, 0, 0, 'basic'); }, [start, points] as const);
    await gameWait(page, 0.15);
    const screens: { x: number; y: number }[] = [];
    for (const p of points) screens.push(await screen(page, p.x, p.y));
    await page.mouse.move(screens[0].x, screens[0].y);
    await page.mouse.down();
    for (const p of screens.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 });
    const links = (await snap(page)).chainLinks;
    if (links.length === 6 && links.every(l => l.kind === 'enemy')) {
      await page.mouse.up();
      drawn = true;
      break;
    }
    // A blocked line (a tree, water, a wall): cancel before the button goes up, clear, try another.
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await untilFrame(page, (snap, _a, late) => snap.moving === null || late ? true : undefined, null, 5);
    await page.evaluate(() => (window as any).__realtime.clear(false));
  }
  expect(drawn).toBe(true);
  // The dash ends: «+1 рывок без риска» floats over the hero, the caption grows.
  const fed = await untilFrame(page, (snap, _a, late) => snap.slot.shown.feeds >= 1 || late ? { feeds: snap.slot.shown.feeds, text: snap.slot.shown.feedText } : undefined, null, 8);
  await page.screenshot({ path: 'artifacts/realtime-slot-long-chain.png' });
  expect(fed).toEqual({ feeds: 1, text: '+1 рывок без риска' });
  await untilFrame(page, (snap, _a, late) => snap.moving === null || late ? true : undefined, null, 5);
  s = await snap(page);
  expect(s.slot.shown.dots).toEqual({ gold: 4, red: 2, dark: 0 });
  expect(s.slot.shown.caption).toBe('безопасно: 4');
  expect(await page.evaluate(() => (window as any).__realtime.snapshot().purse.on)).toBe(false);

  // Out by the door: no «Котёл» row, the result leads to the map, no die.
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await untilFrame(page, (snap, _a, late) => snap.status === 'victory' || late ? true : undefined, null, 10);
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('result')).not.toContainText('Котёл');
  await expect(page.getByTestId('result-map')).toHaveText('К карте (Enter)');
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-map')).toBeVisible();
  await expect(page.getByTestId('run-die')).toHaveCount(0);

  // Run row 2 (its card offered oaths before task 5): «В бой», no «Зарок», no stake line.
  await page.getByTestId('node-r6c1').click();
  await expect(page.getByTestId('run-detail')).toBeVisible();
  await expect(page.getByTestId('run-oaths')).toHaveCount(0);
  await expect(page.getByTestId('run-stake-line')).toHaveCount(0);
  await expect(page.getByTestId('run-detail')).not.toContainText('Зарок');
  await expect(page.getByTestId('run-enter')).toHaveText('В бой');
  expect(errors).toEqual([]);
});

const hudBox = async (page: Page): Promise<Rect> => {
  const b = (await page.getByTestId('hud').boundingBox())!;
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
};
const meets = (a: Rect, b: Rect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Task 5б (12.10.2026): an idol at the top edge. The caption «безопасно: 3», the odds line of a drawn chain and the reels
 * would stand under the HUD plate over the idol; they stand under its dots instead, clear of the plate and of the idol.
 */
test('task 5б: an idol at the top edge — the caption, the odds line and the reels stand under the dots, clear of the HUD', async ({ page }) => {
  const errors = await openBustSandbox(page, SAFE_SEED, true);
  const hud = await hudBox(page);
  await untilFrame(page, snap => snap.slot.shown.caption !== '' ? true : undefined, null, 5);
  let s = await snap(page);
  const g = s.slot.goblin!, idol = await screen(page, g.x, g.y);
  expect(s.slot.shown.caption).toBe('безопасно: 3');
  expect(s.slot.shown.textPlace).toBe('down');
  const cap = s.slot.shown.captionRect!;
  expect(meets(cap, hud)).toBe(false);
  expect(cap.top).toBeGreaterThan(idol.y); // under the idol's centre, below its dots
  expect(cap.top).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: 'artifacts/realtime-slot-top-edge.png' });
  // A chain drawn to the lever: the odds line under the caption, still clear of the plate.
  await pullByMouse(page, async () => {
    const v = (await snap(page)).slot.shown;
    expect(v.oddsText).not.toBe('');
    expect(v.textPlace).toBe('down');
    expect(meets(v.oddsRect!, hud)).toBe(false);
    expect(v.captionRect === null || v.oddsRect!.top >= v.captionRect.bottom - 1).toBe(true); // below the caption, not on it
  });
  // The reels: under the idol too (clear of the plate), the outcome word floats from under them.
  await untilFrame(page, snap => snap.slot.shown.reelsRect ? true : undefined, null, 5);
  s = await snap(page);
  expect(s.slot.shown.reelsPlace).toBe('down');
  expect(meets(s.slot.shown.reelsRect!, hud)).toBe(false);
  expect(s.slot.shown.reelsRect!.top).toBeGreaterThan(idol.y);
  await untilFrame(page, snap => snap.slot.shown.results >= 1 ? true : undefined, null, 5);
  await gameWait(page, 0.2);
  await page.screenshot({ path: 'artifacts/realtime-slot-top-edge-reels.png' });
  expect(errors).toEqual([]);
});

/** The idol in the open middle keeps the old look: everything over it (no regression of the common case). */
test('task 5б: an idol with room above keeps the caption over it', async ({ page }) => {
  const errors = await openBustSandbox(page, SAFE_SEED);
  await untilFrame(page, snap => snap.slot.shown.caption !== '' ? true : undefined, null, 5);
  const s = await snap(page), idol = await screen(page, s.slot.goblin!.x, s.slot.goblin!.y);
  expect(s.slot.shown.textPlace).toBe('up');
  expect(s.slot.shown.captionRect!.bottom).toBeLessThan(idol.y);
  expect(errors).toEqual([]);
});

/**
 * Task 5б, «Перебор»: the blast finds the hero wherever he is. The hero walks out of the ring (here: far away) during the spin; the
 * bust still takes 4 HP, and the view draws a spark from the idol's point to the hero and a flash on him.
 */
test('task 5б: a bust with the hero far from the idol — the spark from the idol to the hero and the flash on him', async ({ page }) => {
  const errors = await openBustSandbox(page, BUST_SEED);
  for (let i = 0; i < 3; i++) { await pullByMouse(page); await untilReady(page); }
  await untilFrame(page, snap => snap.slot.marks === 0 ? true : undefined, null, 30);
  const hpBefore = (await snap(page)).hero.hp;
  await pullByMouse(page);
  await untilFrame(page, snap => snap.slot.shown.spinning > 0 ? true : undefined, null, 5);
  const g = (await snap(page)).slot.goblin!;
  // Out of the ring (2.2) by far: to the other side of the arena.
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [g.x < 8 ? 14 : 2, g.y < 5 ? 8 : 2] as const);
  await untilFrame(page, snap => snap.slot.shown.busts >= 1 ? true : undefined, null, 10);
  await page.screenshot({ path: 'artifacts/realtime-slot-bust-far.png' });
  const s = await snap(page), v = s.slot.shown;
  const hero = await page.evaluate(() => { const h = (window as any).__realtime.snapshot().hero; return { x: h.x, y: h.y }; });
  expect(Math.hypot(hero.x - g.x, hero.y - g.y)).toBeGreaterThan(4);
  expect(s.hero.hp).toBe(hpBefore - 4); // the ring did not protect him
  expect(v.sparks).toBe(1);
  expect(v.heroFlashes).toBe(1);
  expect(v.sparkFrom!.x).toBeCloseTo(g.x, 3); expect(v.sparkFrom!.y).toBeCloseTo(g.y, 3);
  expect(v.sparkTo!.x).toBeCloseTo(hero.x, 3); expect(v.sparkTo!.y).toBeCloseTo(hero.y, 3);
  expect(errors).toEqual([]);
});
