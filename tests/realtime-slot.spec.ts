import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
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
interface Snap { chain: number[]; chainLinks: { kind: string; id: number }[]; moving: string | null; hero: { hp: number; x: number; y: number }; enemies: { id: number }[]; slot: { goblin: { id: number; x: number; y: number; pulls: number; skulls: number[]; spinning: boolean } | null; shown: SlotShown; marks: number; flashes: number; bustCircles: number; riskCircles: number; bustBlasts: number }; guard: { sparks: number; wards: number; fails: boolean } }
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

async function openBustSandbox(page: Page, seed: number, topEdge = false, area = false): Promise<string[]> {
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
  await page.evaluate(([seed, topEdge, area]) => {
    const rt = (window as any).__realtime;
    rt.restart(seed);
    // Task 7: «Взрыв по площади» (the run's rule; the sandbox's default is off).
    if (area) rt.setParam('slotBustArea', true);
    // A quiet field (as above); six pulls, a short cooldown, the rule on — all journalled commands.
    for (const [k, v] of Object.entries({ enemySpeed: 0, speedSpread: 0, baseIntervalMin: 20, baseIntervalMax: 20, baseFloor: 0, contactDamage: 0, slot: true, slotBust: true, slotPulls: 6, slotCooldown: 0.5 })) rt.setParam(k, v);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(8, topEdge ? 1 : 5);
    rt.summonGoblin();
  }, [seed, topEdge, area] as const);
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

/**
 * One pull by the mouse: a hero 2.4 from the idol (towards `toward`, by default the field's middle 8, 5), a weak enemy between,
 * press on it, drag to the lever; `hold` runs with the chain drawn.
 */
async function pullByMouse(page: Page, hold?: () => Promise<void>, toward = { x: 8, y: 5 }): Promise<void> {
  const g = (await snap(page)).slot.goblin!;
  const d = Math.hypot(g.x - toward.x, g.y - toward.y), ux = (toward.x - g.x) / d, uy = (toward.y - g.y) / d;
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
 * stands. Task 11 «Гоблин-сюрприз» (13.10.2026): the idol has no caption «безопасно: N» and no dots; a chain of 6 drawn with the
 * mouse feeds nothing (no «+1 рывок без риска»); two pulls by the mouse show the same odds line, no percent: «взрыв? −4 HP в
 * круге · иначе тройка». The hero goes through the door: the result has no «Котёл» row and leads to the map, no die
 * screen. Row 2: the card says «В бой», no «Зарок», no stake line.
 */
test('task 5 and 11, the run: no «Зарок» on the cards, the goblin after the goals of a row-1 battle — no caption, no dots, a mouse chain of 6 feeds nothing, every pull shows one odds line without %; no «Котёл», no die', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 10);
  await skipHabit(page);
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
  // The goblin after the goals (the run's chance 1), its marker, then the idol: no caption, no dots (task 11).
  await untilFrame(page, (snap, _a, late) => snap.slot.goblin || late ? true : undefined, null, 6);
  await untilFrame(page, (snap, _a, late) => (snap.slot.shown.idols === 1 && snap.slot.shown.markers === 0 && snap.slot.shown.dark === 0) || late ? true : undefined, null, 6);
  let s = await snap(page);
  expect(s.slot.goblin).not.toBeNull();
  expect(s.slot.shown.caption).toBe('');
  expect(s.slot.shown.dots).toEqual({ gold: 0, red: 0, dark: 0 });
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
  // The dash ends: nothing fed (task 11: no long-chain feeding in the run), still no caption and no dots.
  await untilFrame(page, (snap, _a, late) => snap.moving === null || late ? true : undefined, null, 8);
  await gameWait(page, 0.3);
  s = await snap(page);
  expect(s.slot.shown.feeds).toBe(0);
  expect(s.slot.shown.caption).toBe('');
  expect(s.slot.shown.dots).toEqual({ gold: 0, red: 0, dark: 0 });
  expect(await page.evaluate(() => (window as any).__realtime.snapshot().purse.on)).toBe(false);

  // Two pulls by the mouse: the same line on each (the hidden count shows nowhere), no percent, the reels spin and stop.
  const lines: string[] = [];
  for (let i = 0; i < 2 && (await snap(page)).slot.goblin; i++) {
    await pullByMouse(page, async () => {
      const shown = (await snap(page)).slot.shown as SlotShown & { oddsSide: string | null; heroFrame: Rect | null };
      lines.push(shown.oddsText);
      // Design 13.10.2026: the line keeps off the power number and the combo over the hero (beside the idol when it would meet them).
      expect(shown.heroFrame).not.toBeNull();
      expect(meets(shown.oddsRect!, shown.heroFrame!)).toBe(false);
      // Both beside the idol: one column on the same side — the lever's label over, the line under it (design 13.10.2026).
      const label = ((await snap(page)).onboarding.labels as (Rect & { id: string })[]).find(l => l.id === 'b9');
      if (label && shown.oddsSide) {
        const idol = await screen(page, g.x, g.y);
        expect(shown.oddsSide === 'left' ? label.right < idol.x : label.left > idol.x).toBe(true);
        expect(label.bottom).toBeLessThanOrEqual(shown.oddsRect!.top + 1);
      }
      if (i === 0) await page.screenshot({ path: 'artifacts/realtime-slot-run-line.png' });
    });
    expect((await snap(page)).slot.shown.caption).toBe('');
    await untilReady(page);
  }
  expect(lines.length).toBeGreaterThanOrEqual(1);
  for (const line of lines) expect(line).toBe('взрыв? −4 HP в круге · иначе тройка');

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

/**
 * Task 7 «Взрыв по площади» (design 13.10.2026), the view with real input: the risky pull's odds line names the circle; the bust lights
 * a red circle round the idol (no blow, no spark to the hero); a hero who walks out of it by the keys takes nothing; one who stays
 * takes 4; an enemy in the circle dies of the blast.
 */
test('task 7: the bust lights a red circle; walking out of it by the keys spares the hero, no spark; an enemy inside dies', async ({ page }) => {
  const errors = await openBustSandbox(page, BUST_SEED, false, true);
  for (let i = 0; i < 3; i++) { await pullByMouse(page); await untilReady(page); }
  await untilFrame(page, snap => snap.slot.marks === 0 ? true : undefined, null, 30);
  const hpBefore = (await snap(page)).hero.hp;
  const g = (await snap(page)).slot.goblin!;
  await pullByMouse(page, async () => {
    expect((await snap(page)).slot.shown.oddsText).toBe('взрыв 55 % · −4 HP в круге · иначе тройка');
  });
  // The reels stop: the idol lights — the red circle, nobody hurt yet; the player walks away at once (towards the arena's middle).
  await untilFrame(page, snap => snap.slot.bustCircles > 0 ? true : undefined, null, 10);
  const key = g.x < 8 ? 'KeyD' : 'KeyA';
  await page.keyboard.down(key);
  const enemy = await page.evaluate(([x, y]) => (window as any).__realtime.place(x, y, 1, 2, 'basic') as number, [g.x + (g.x < 8 ? -1.2 : 1.2), g.y] as const);
  expect((await snap(page)).hero.hp).toBe(hpBefore);
  await page.screenshot({ path: 'artifacts/realtime-slot-bust-circle.png' });
  await untilFrame(page, snap => snap.slot.bustBlasts >= 1 ? true : undefined, null, 10);
  await page.keyboard.up(key);
  const s = await snap(page);
  // Out of the circle: the body (radius 0.28) clear of the 3.5.
  expect(Math.hypot(s.hero.x - g.x, s.hero.y - g.y)).toBeGreaterThan(3.78);
  expect(s.hero.hp).toBe(hpBefore);
  expect(s.slot.shown.sparks).toBe(0);
  expect(s.slot.shown.heroFlashes).toBe(0);
  expect(s.enemies.some(e => e.id === enemy)).toBe(false);
  await gameWait(page, 0.3);
  expect((await snap(page)).slot.bustCircles).toBe(0);
  expect(errors).toEqual([]);
});

test('task 7: a hero who stays in the lit circle takes the bust\'s 4 HP when it goes off', async ({ page }) => {
  const errors = await openBustSandbox(page, BUST_SEED, false, true);
  for (let i = 0; i < 3; i++) { await pullByMouse(page); await untilReady(page); }
  await untilFrame(page, snap => snap.slot.marks === 0 ? true : undefined, null, 30);
  const hpBefore = (await snap(page)).hero.hp;
  await pullByMouse(page);
  await untilFrame(page, snap => snap.slot.bustCircles > 0 ? true : undefined, null, 10);
  expect((await snap(page)).hero.hp).toBe(hpBefore);
  await untilFrame(page, snap => snap.slot.bustBlasts >= 1 ? true : undefined, null, 10);
  await gameWait(page, 0.1);
  const s = await snap(page);
  expect(s.hero.hp).toBe(hpBefore - 4);
  expect(s.slot.shown.sparks).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * Task 19а (design 14.10.2026): the lit bust circle is clipped to the arena's field. An idol at the top edge: before, the circle
 * ran out of the frame onto the dark margin and under the HUD plate. The shot's pixels: red in the field round the idol, none
 * above the frame (the HUD plate's own pixels left out).
 */
test('task 19а: an idol at the top edge — the lit bust circle stays inside the arena frame', async ({ page }) => {
  const errors = await openBustSandbox(page, BUST_SEED, true, true);
  const g = (await snap(page)).slot.goblin!;
  // Straight down from the idol: the way to the field's middle may run through a tree or a wall at this top-edge spot.
  const down = { x: g.x, y: g.y + 5 };
  for (let i = 0; i < 3; i++) { await pullByMouse(page, undefined, down); await untilReady(page); }
  await untilFrame(page, snap => snap.slot.marks === 0 ? true : undefined, null, 30);
  await pullByMouse(page, undefined, down);
  await untilFrame(page, snap => snap.slot.bustCircles > 0 ? true : undefined, null, 10);
  const shot = await page.screenshot({ path: 'artifacts/realtime-slot-bust-top-edge.png' });
  const idol = await screen(page, g.x, g.y), top = await screen(page, g.x, 0), edge = await screen(page, g.x + 3.5, g.y);
  const R = edge.x - idol.x, hud = await hudBox(page);
  expect(idol.y - R).toBeLessThan(top.y - 20); // the circle would reach well above the frame
  const reds = await page.evaluate(async ([b64, box]) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height), cx = c.getContext('2d')!;
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data;
    const red = (x: number, y: number): boolean => { const i = (y * img.width + x) * 4; return d[i] >= 50 && d[i] > 1.6 * d[i + 1] && d[i] > 1.6 * d[i + 2]; };
    let above = 0, inside = 0;
    for (let y = 0; y < img.height; y++) for (let x = Math.max(0, Math.floor(box.left)); x < Math.min(img.width, Math.ceil(box.right)); x++) {
      if (x >= box.hud.left && x < box.hud.right && y >= box.hud.top && y < box.hud.bottom) continue;
      if (y < box.frameTop && red(x, y)) above++;
      if (y > box.frameTop + 10 && y < box.bottom && red(x, y)) inside++;
    }
    return { above, inside };
  }, [shot.toString('base64'), { left: idol.x - R, right: idol.x + R, bottom: idol.y + R, frameTop: top.y - 10, hud }] as const);
  expect(reds.inside).toBeGreaterThan(500); // the circle is drawn in the field
  expect(reds.above).toBe(0); // and nothing of it above the frame
  expect(errors).toEqual([]);
});

/**
 * Task 23 (б) «Щит не держит» (design 15.10.2026; sim/guard.ts `shieldFails`): the pull's own chain (a weak enemy, then the lever,
 * by the mouse) gives the after-chain shield (1.5 s, a journalled param); the reels stop on the bust while it is up and the hero
 * stands in the lit circle — the shield's glow cracks (`snapshot().guard.fails`), and the blast (fuse 0.3 s) takes its 4 HP
 * through the shield. Before the lit circle the same shield holds: no crack.
 */
test('task 23 (б): the after-chain shield in the lit bust circle cracks, and the blast hurts through it', async ({ page }) => {
  const errors = await openBustSandbox(page, BUST_SEED, false, true);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('slotBustFuse', 0.3); rt.setParam('chainShield', 1.5); });
  for (let i = 0; i < 3; i++) { await pullByMouse(page); await untilReady(page); }
  await untilFrame(page, snap => snap.slot.marks === 0 ? true : undefined, null, 30);
  const g = (await snap(page)).slot.goblin!, hpBefore = (await snap(page)).hero.hp;
  await pullByMouse(page);
  // The dash killed its enemy: the shield is up, the reels spin — nothing it cannot stop yet.
  const spinning = await untilFrame(page, (q: any) => (q.hero.chainShield > 0 && !q.moving ? q : undefined), null, 3);
  expect(spinning.slot.bustCircles, 'the reels still spin').toBe(0);
  expect(spinning.guard.fails, 'the shield holds while nothing threatens through it').toBe(false);
  const cracked = await untilFrame(page, (q: any) => (q.slot.bustCircles > 0 ? q : undefined), null, 5);
  expect(cracked.hero.chainShield, 'the shield is still up at the lit').toBeGreaterThan(0);
  expect(Math.hypot(cracked.hero.x - g.x, cracked.hero.y - g.y), 'the hero stands in the circle').toBeLessThan(3.5);
  expect(cracked.guard.fails, 'the shield cracks in the lit circle').toBe(true);
  await page.screenshot({ path: 'artifacts/realtime-guard-cracked.png' });
  await untilFrame(page, q => (q.slot.bustBlasts >= 1 ? true : undefined), null, 3);
  await gameWait(page, 0.1);
  expect((await snap(page)).hero.hp, 'the bust hurts through the shield').toBe(hpBefore - 4);
  expect(errors).toEqual([]);
});

/**
 * Task 24 (а) «Урок перебора» (design 15.10.2026): in a run fight every pull — the safe ones too — shows a pale ring of the bust's
 * radius round the idol while the reels spin («pulled — walk out»; it tells nothing of the roll). A run (seed 10) entered by
 * clicks, the goblin after the goals, pulls by the mouse: during each spin the ring is drawn (`slot.riskCircles`); a pull that
 * ends in a triple leaves no circle at all; a bust lights the burning circle instead.
 */
test('task 24 (а): in a run fight the pale risk ring shows while the reels spin, on a safe pull too', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), 10);
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('node-r5c0').click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [k, v] of Object.entries({ enemySpeed: 0, speedSpread: 0, baseIntervalMin: 20, baseIntervalMax: 20, baseFloor: 0, contactDamage: 0 })) rt.setParam(k, v);
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.completeGoals();
  });
  await untilFrame(page, (q, _a, late) => (q.slot.shown.idols === 1 && q.slot.shown.markers === 0 && q.slot.shown.dark === 0) || late ? true : undefined, null, 8);
  expect((await snap(page)).slot.riskCircles, 'no ring before a pull').toBe(0);
  const outcomes: string[] = [];
  for (let i = 0; i < 3 && (await snap(page)).slot.goblin; i++) {
    await pullByMouse(page);
    const spin = await untilFrame(page, (q, _a, late) => (q.slot.riskCircles > 0 ? q : late ? q : undefined), null, 2);
    expect(spin.slot.goblin?.spinning, 'the reels spin').toBe(true);
    expect(spin.slot.riskCircles, `pull ${i + 1}: the ring while the reels spin`).toBe(1);
    if (i === 0) await page.screenshot({ path: 'artifacts/realtime-slot-risk-ring.png' });
    const stopped = await untilFrame(page, (q, _a, late) => (!q.slot.goblin?.spinning || late ? q : undefined), null, 5);
    outcomes.push(stopped.slot.bustCircles > 0 ? 'bust' : 'safe');
    expect(stopped.slot.riskCircles, 'the ring goes when the reels stop').toBe(0);
    if (stopped.slot.bustCircles > 0) break;
    await untilReady(page);
  }
  expect(outcomes[0], 'the first pull of this run is a safe one (a triple)').toBe('safe');
  expect(errors).toEqual([]);
});

/**
 * Task 24 (design 15.10.2026): «рычаг не готов» (the refusal hint at the pointer) is not shown while the reels spin — it read as
 * «wait at the lever» against «pulled — walk out»; after the reels stop, on the rest of the cooldown, it is back. The sandbox with
 * the bust by area, a cooldown of 3 s (journalled param), a safe pull by the mouse, the pointer held on the lever.
 */
test('task 24: no «рычаг не готов» at the lever while the reels spin; it is back on the rest of the cooldown', async ({ page }) => {
  const errors = await openBustSandbox(page, BUST_SEED, false, true);
  await page.evaluate(() => (window as any).__realtime.setParam('slotCooldown', 3));
  const g = (await snap(page)).slot.goblin!;
  await pullByMouse(page);
  const lever = await screen(page, g.x, g.y);
  await page.mouse.move(lever.x + 2, lever.y + 2);
  await page.mouse.move(lever.x, lever.y);
  // Every frame of the spin: the lever refuses, but no hint.
  const spun = await untilFrame(page, (q: any, _a, late) => (q.slot.goblin?.spinning ? (q.hint === 'lever' ? 'shown' : undefined) : 'stopped') ?? (late ? 'late' : undefined), null, 5);
  expect(spun, 'no hint while the reels spin').toBe('stopped');
  // The reels stopped (a safe triple), the cooldown runs on: the hint is back.
  expect((await snap(page)).slot.bustCircles).toBe(0);
  await page.mouse.move(lever.x + 1, lever.y + 1);
  await expect.poll(async () => page.evaluate(() => (window as any).__realtime.snapshot().hint)).toBe('lever');
  expect(errors).toEqual([]);
});
