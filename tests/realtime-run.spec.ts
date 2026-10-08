import { test, expect, type Page } from '@playwright/test';

/**
 * The run of the real-time game in the browser (stage 2, step 1; docs/realtime-slice.md). Runs through
 * playwright.realtime.config.ts only. The page (realtime.html) opens on the run; the arena is won through the test hook
 * `__realtime.run.winArena` (the goals done and the hero put on the open door by journalled commands — the door's own
 * rule lets him in) and lost by a ring of enemies placed around the hero.
 */
interface RunState {
  seed: number; hp: number; maxHp: number; visited: string[]; currentNodeId: string | null;
  pending: { kind: string; nodeId?: string; arena?: string; seed?: number } | null; result: { outcome: string } | null;
}
const runState = (page: Page): Promise<RunState> => page.evaluate(() => (window as any).__realtime.run.state());
const snapshot = (page: Page) => page.evaluate(() => (window as any).__realtime.snapshot() as { seed: number; arena: string; time: number; status: string; hero: { x: number; y: number; hp: number; maxHp: number } });

async function openRun(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run')).toBeVisible();
}

/** A new run from the start screen; the start gift takes «+3 к максимуму HP» (a first run: the mini gift, its second button). */
async function newRun(page: Page): Promise<RunState> {
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  return runState(page);
}

/** Clicks the first available node of the map and enters it; returns its id. */
async function enterFirstNode(page: Page): Promise<string> {
  const node = page.locator('[data-status="available"]').first();
  const id = await node.getAttribute('data-node');
  await node.click();
  await page.getByTestId('run-enter').click();
  return id!;
}

test('run: a saved sandbox panel with the hero anchor and random elites on does not reach the run (no anchor, no elites on row 1)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await openRun(page, errors);
  // The panel as a sandbox session saved it.
  await page.evaluate(() => localStorage.setItem('ashen-oath-realtime-params-v16', JSON.stringify({ heroAnchor: true, eliteSandbox: true, eliteChance: 0.5, sandboxTalismans: 'hero-anchor' })));
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  const params = await page.evaluate(() => { const p = (window as any).__realtime.params; return { heroAnchor: p.heroAnchor, eliteSandbox: p.eliteSandbox, eliteChance: p.eliteChance }; });
  expect(params).toEqual({ heroAnchor: false, eliteSandbox: false, eliteChance: 0.5 });
  // Newcomers keep coming for a few seconds of game time: none is an elite; no second anchor is drawn in a chain.
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 0));
  // Game time, not wall time: the software renderer of the tests may run the crowd slowly.
  await expect.poll(async () => (await snapshot(page)).time, { timeout: 60_000 }).toBeGreaterThan(5);
  const s = await page.evaluate(() => (window as any).__realtime.snapshot()) as { enemies: { elite: boolean }[]; heroAnchorShown: boolean };
  expect(s.enemies.length).toBeGreaterThan(5);
  expect(s.enemies.some(e => e.elite)).toBe(false);
  // The saved panel itself is untouched (the sandbox keeps its toggles).
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ashen-oath-realtime-params-v16')))!).heroAnchor).toBe(true);
  expect(errors).toEqual([]);
});

test('run: a battle node starts its arena with the run HP, a reload starts it again, a victory returns to the map, a reload keeps the run', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  const start = await newRun(page);
  expect(start.visited).toEqual([]);
  expect(start.hp).toBe(15);
  expect(start.maxHp).toBe(15);
  await expect(page.locator('[data-status="available"]')).not.toHaveCount(0);
  // Row 5 holds battles only: the first node starts an arena.
  const nodeId = await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  const entered = await runState(page);
  expect(entered.pending?.kind).toBe('battle');
  expect(entered.pending?.nodeId).toBe(nodeId);
  let snap = await snapshot(page);
  expect(snap.seed).toBe(entered.pending!.seed);
  expect(snap.arena).toBe(entered.pending!.arena);
  expect(snap.hero.hp).toBe(15);
  expect(snap.hero.maxHp).toBe(15);
  await expect.poll(async () => (await snapshot(page)).time, { timeout: 10_000 }).toBeGreaterThan(1);

  // A reload in the middle of the arena: the open battle node waits, its arena starts again from the start.
  await page.reload();
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect(page.getByTestId('run')).toBeHidden();
  snap = await snapshot(page);
  expect(snap.seed).toBe(entered.pending!.seed);
  expect(snap.time).toBeLessThan(1);

  // Victory: the test hook opens the door and puts the hero on it; the next tick walks him in.
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  const won = await snapshot(page);
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId(`node-${nodeId}`)).toHaveAttribute('data-status', 'current');
  const after = await runState(page);
  expect(after.visited).toEqual([nodeId]);
  expect(after.pending).toBeNull();
  expect(after.hp).toBe(won.hero.hp);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('ashen-oath-rt-run-v2');
  expect(keys).not.toContain('ashen-oath-forest-run-v1');
  expect(keys).not.toContain('ashen-oath-profile-v1');

  // A reload keeps the run on the map.
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId(`node-${nodeId}`)).toHaveAttribute('data-status', 'current');
  expect(await runState(page)).toEqual(after);
  await expect(page.locator('[data-status="available"]')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('run: a lost arena ends the run, and the end survives a reload', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  // A ring of tough enemies around the standing hero: contact damage takes the run's HP.
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  expect((await runState(page)).result?.outcome).toBe('defeat');
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.locator('[data-status="available"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('run: the arena counts when it ends — a reload on «Поражение» ends the run, a reload on «Победа» keeps the victory', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await newRun(page);
  // Victory: reload on the result screen, before «К карте».
  const won = await enterFirstNode(page);
  await expect(page.getByTestId('run')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  const hp = (await snapshot(page)).hero.hp;
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await expect(page.getByTestId('run-battle-modal')).toHaveCount(0);
  await expect(page.getByTestId(`node-${won}`)).toHaveAttribute('data-status', 'current');
  const after = await runState(page);
  expect(after.visited).toEqual([won]);
  expect(after.pending).toBeNull();
  expect(after.hp).toBe(hp);
  // Defeat: walk on to the next arena node and reload on «Поражение».
  for (let step = 0; step < 8; step++) {
    const state = await runState(page);
    if (state.pending?.kind === 'battle') break;
    if (state.pending) {
      // A node screen of the trails: take its first button that is on (a rest, a find, an event, the merchant's «Уйти»).
      const leave = page.locator('[data-action="find"], [data-action="gift-pick"], [data-action="talisman"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first();
      await leave.click();
      continue;
    }
    await enterFirstNode(page);
  }
  expect((await runState(page)).pending?.kind).toBe('battle');
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await page.reload();
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
  await expect(page.getByTestId('run-battle-modal')).toHaveCount(0);
  expect((await runState(page)).result?.outcome).toBe('defeat');
  expect(errors).toEqual([]);
});

/** Run rows of the arena pools (docs/realtime-slice.md, section 5; step 4: «Брод» 6–9). Hard battles play «Застава», boss nodes «Последний рубеж». */
const POOL_ROWS: Record<string, [number, number]> = {
  glade: [1, 3], buttons: [1, 4], marked: [2, 5], shields: [3, 6], archers: [4, 7], powder: [4, 8], thorns: [5, 8], ford: [6, 9],
};

test('run: two runs walk to the final arena — every arena from its pool (hard → «Застава», boss → «Последний рубеж», no «временно»); the final victory ends the run, a reload keeps the end', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await openRun(page, errors);
  const met: { row: number; arena: string; type: string }[] = [];
  // Two runs (seeds spread apart) to the end: battles are won by the test hook, other nodes take their first button.
  for (const seed of [Math.imul(1, 2654435761) >>> 0, Math.imul(2, 2654435761) >>> 0]) {
    await page.evaluate(s => (window as any).__realtime.run.newRun(s), seed);
    let finalWon = false;
    for (let step = 0; step < 120; step++) {
      const state = await page.evaluate(() => (window as any).__realtime.run.state()) as RunState & { pending: { kind: string; nodeId?: string; arena?: string; battle?: string; standIn?: string } | null };
      if (state.result) break;
      const pending = state.pending;
      if (pending?.kind === 'battle') {
        // Node ids carry the map row (`r6c1`, `den-r11c0`); the run row is the map row less the trunk (4).
        const row = Number(/r(\d+)c/.exec(pending.nodeId!)![1]) - 4;
        expect(pending.standIn, `${pending.nodeId}: no temporary arena`).toBeUndefined();
        met.push({ row, arena: pending.arena!, type: pending.battle! });
        await expect(page.getByTestId('run')).toBeHidden();
        expect((await snapshot(page)).arena).toBe(pending.arena);
        // The map screen named the arena without «временно».
        await expect(page.getByText('временно')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
        await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
        if (pending.battle === 'final') {
          // The final victory ends the run: the result's button leads to the end of the run.
          await expect(page.getByTestId('result-map')).toHaveText('Итог похода (Enter)');
          expect((await runState(page)).result?.outcome).toBe('victory');
          finalWon = true;
        }
        await page.getByTestId('result-map').click();
        continue;
      }
      if (pending) {
        // A node screen: its first button that is on (the gift, a rest, a find, an event option, the merchant's «Уйти»).
        await page.locator('[data-action="gift"]:not([disabled]), [data-action="find"], [data-action="gift-pick"], [data-action="talisman"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click();
        continue;
      }
      await enterFirstNode(page);
    }
    expect(finalWon, `run ${seed} won its final arena`).toBe(true);
    // The end of the run: «Поход пройден»; a reload keeps it.
    await expect(page.getByTestId('run-result-victory')).toBeVisible();
    await expect(page.getByTestId('run-result-victory')).toContainText('Поход пройден');
    const ended = await runState(page);
    expect(ended.result?.outcome).toBe('victory');
    await page.reload();
    await expect(page.getByTestId('run-result-victory')).toBeVisible();
    expect(await runState(page)).toEqual(ended);
  }
  for (const { row, arena, type } of met) {
    if (type === 'hard') expect(arena, `row ${row}: hard`).toBe('outpost');
    else if (type === 'final') expect(arena, `row ${row}: final`).toBe('last-stand');
    else expect(row >= POOL_ROWS[arena][0] && row <= POOL_ROWS[arena][1], `row ${row}: ${arena}`).toBe(true);
  }
  expect(met.filter(m => m.type === 'final').length).toBe(2);
  expect(Math.max(...met.filter(m => m.type !== 'final').map(m => m.row))).toBe(9);
  const fresh = new Set(met.map(m => m.arena).filter(arena => ['shields', 'archers', 'powder', 'thorns', 'ford'].includes(arena)));
  expect(fresh.size, `arenas met: ${met.map(m => `${m.row}:${m.arena}`).join(', ')}`).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('run: a consumable taken at a find goes to the next arena (HUD 2 ×1) and is used there with the key at the mouse', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await openRun(page, errors);
  // A spread seed; battles are won by the test hook, find nodes are preferred on the map.
  await page.evaluate(s => (window as any).__realtime.run.newRun(s), Math.imul(3, 2654435761) >>> 0);
  let found = false;
  for (let step = 0; step < 60 && !found; step++) {
    const state = await page.evaluate(() => (window as any).__realtime.run.state()) as RunState & { pending: { kind: string } | null; items: Record<string, number> };
    if (state.result) break;
    const pending = state.pending;
    if (pending?.kind === 'find') {
      await expect(page.getByTestId('run-find')).toBeVisible();
      await page.getByTestId('find-bomb').click();
      expect((await page.evaluate(() => (window as any).__realtime.run.state())).items.bomb).toBe(state.items.bomb + 1);
      found = true;
      break;
    }
    if (pending?.kind === 'battle') {
      await expect(page.getByTestId('run')).toBeHidden();
      expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
      await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
      await page.getByTestId('result-map').click();
      continue;
    }
    if (pending) {
      await page.locator('[data-action="gift"]:not([disabled]), [data-action="find"], [data-action="gift-pick"], [data-action="talisman"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click();
      continue;
    }
    const find = page.locator('[data-status="available"][data-type="find"]');
    const node = (await find.count()) ? find.first() : page.locator('[data-status="available"]').first();
    await node.click();
    await page.getByTestId('run-enter').click();
  }
  expect(found).toBe(true);
  const bombs = (await page.evaluate(() => (window as any).__realtime.run.state())).items.bomb as number;
  await expect(page.getByTestId('run-items')).toContainText(`Бомба ${bombs}`);
  // The next battle node: the arena starts with the bomb in the HUD.
  for (let step = 0; step < 10; step++) {
    const state = await runState(page);
    if (state.pending?.kind === 'battle') break;
    if (state.pending) { await page.locator('[data-action="find"], [data-action="talisman"], [data-testid="shop-leave"], [data-testid="rest-heal"], [data-action="event-option"]:not([disabled])').first().click(); continue; }
    const battle = page.locator('[data-status="available"][data-type="battle"]');
    const node = (await battle.count()) ? battle.first() : page.locator('[data-status="available"]').first();
    await node.click();
    await page.getByTestId('run-enter').click();
  }
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('item-bomb')).toHaveText(new RegExp(`×${bombs}`));
  const target = await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    rt.setParam('contactDamage', 0);
    return { id: rt.place(hero.x + 2, hero.y, 0, 5, 'basic') as number, x: hero.x + 2, y: hero.y };
  });
  const at = await page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [target.x, target.y]);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press('2');
  await expect(page.getByTestId('item-bomb')).toHaveText(new RegExp(`×${bombs - 1}`));
  expect((await page.evaluate(() => (window as any).__realtime.snapshot())).enemies.some((e: { id: number }) => e.id === target.id)).toBe(false);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await page.getByTestId('result-map').click();
  expect((await page.evaluate(() => (window as any).__realtime.run.state())).items.bomb).toBe(bombs - 1);
  expect(errors).toEqual([]);
});

test('the sandbox keeps the prototype: ?sandbox=1 opens the arena menu and the debug panel, without the run', async ({ page }) => {
  await page.goto('/realtime.html?sandbox=1');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('open-panel')).toBeVisible();
  await expect(page.getByTestId('run')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__realtime.run)).toBeNull();
});

test('the sandbox opens by the anchor too: the run screen links to #sandbox, the link boots the sandbox (a published build keeps no query)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/realtime.html');
  await expect(page.getByTestId('run-new')).toBeVisible();
  await page.locator('a[href="#sandbox"]').first().click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('open-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.run)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__realtime?.run)).toBeNull();
  expect(errors).toEqual([]);
});
