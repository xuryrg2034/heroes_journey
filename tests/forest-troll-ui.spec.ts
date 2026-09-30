import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// The forest troll in the real UI (editor preset «Логово тролля», docs/examples/troll-den-demo.json): the club zone, its
// windup and strike, forced deaths by the club, regeneration and the risk line. Everything shown must come from the
// engine's forecast (`intent`, `damageBySource.troll`, `enemyPhase.deaths` / `regenerated`) and match the executed turn.
test.use({ viewport: { width: 1280, height: 720 } });

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const troll = async (page: Page) => (await state(page)).board.find((cell: any) => cell?.variant === 'troll');
const ready = (page: Page) => expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
async function openPreset(page: Page) {
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-preset').selectOption('troll');
  await page.locator('[data-editor="preset"]').click();
  await page.locator('#editor-play').click();
  await ready(page);
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
async function rest(page: Page) {
  await page.locator('#wait-button').click();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
  await ready(page);
}
async function holdChain(page: Page, path: number[]) {
  for (let n = 0; n < path.length; n++) {
    const point = await page.evaluate(index => (window as any).__PUZZLE_GAME.gridToScreen(index), path[n]);
    await page.mouse.move(point.x, point.y, { steps: n ? 5 : 1 });
    if (n === 0) await page.mouse.down();
  }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
}
async function finishTurn(page: Page) {
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
}
const preview = (page: Page) => page.evaluate(() => (window as any).__PUZZLE_GAME.preview((window as any).__PUZZLE_GAME.state.chain));
const marks = (page: Page) => page.evaluate(() => (window as any).__PUZZLE_GAME.forecastMarks);
const shot = async (page: Page, name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: `artifacts/${name}.png` }); };

test('windup is a contour a turn ahead, the raised club fills the zone; the guide names the troll', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page);
  const windup = await troll(page);
  expect(windup.intent.label).toBe('Замах дубиной'); expect(windup.behavior.club.raised).toBe(false);
  expect(windup.intent.cells).toEqual(windup.behavior.club.cells); expect(windup.intent.cells.length).toBeGreaterThan(0);
  await page.locator('.field-details summary').click();
  await expect(page.locator('.field-guide')).toContainText('Тролль · дубина');
  await shot(page, 'troll-windup');
  await rest(page);
  const strike = await troll(page);
  expect(strike.intent.label).toBe('Удар дубиной'); expect(strike.behavior.club.raised).toBe(true);
  expect(strike.intent.cells).toEqual(windup.intent.cells);
  await shot(page, 'troll-strike');
  expect(errors).toEqual([]);
});

test('the raised club: deaths by the club, the risk line key troll, and the forecast equals the executed turn', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page);
  await rest(page);
  const zone: number[] = (await troll(page)).intent.cells;
  // The engine's own forecast picks a chain that ends the cat inside the club zone.
  const path: number[] | null = await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
    for (const move of game.availableMoves(5)) for (let n = 2; n <= move.length; n++) {
      const chain = move.slice(0, n), key = chain.join(','); if (seen.has(key)) continue; seen.add(key);
      const p = game.preview(chain); if (p.valid && p.damageBySource.troll > 0) return chain;
    }
    return null;
  });
  expect(path).not.toBeNull();
  const hp = (await state(page)).player.hp;
  await holdChain(page, path!);
  const forecast = await preview(page);
  const clubDeaths = forecast.enemyPhase.deaths.filter((death: any) => death.cause === 'club');
  expect(zone).toContain(forecast.endIndex); expect(forecast.damageBySource.troll).toBe(2);
  expect(Object.values(forecast.damageBySource).reduce((sum: number, value) => sum + (value as number), 0)).toBe(forecast.damage);
  expect(clubDeaths.length).toBeGreaterThan(0);
  expect((await marks(page)).labels.filter((label: string) => label === 'ДУБИНА')).toHaveLength(clubDeaths.length);
  await expect(page.locator('#risk-preview')).toContainText('дубина тролля 2');
  await expect(page.locator('#chain-reward')).toContainText('дубина');
  await shot(page, 'troll-club-forecast');
  await finishTurn(page);
  const after = await state(page);
  expect(after.player.hp).toBe(hp - forecast.damage);
  for (const death of clubDeaths) expect(after.board[death.index]?.id).not.toBe(death.id);
  expect(errors).toEqual([]);
});

test('regeneration: a wounded troll that takes no damage is forecast to heal, and heals in the executed turn', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPreset(page);
  // Wound the troll directly on the engine state (the chain cannot reach it here); the display and the rule are then read as usual.
  await page.evaluate(() => { const game = (window as any).__PUZZLE_GAME; game.state.board.find((cell: any) => cell?.variant === 'troll').hp = 6; });
  const path: number[] = await page.evaluate(() => (window as any).__PUZZLE_GAME.availableMoves()[0].slice(0, 2));
  await holdChain(page, path);
  const forecast = await preview(page);
  expect(forecast.enemyPhase.regenerated).toHaveLength(1);
  const amount: number = forecast.enemyPhase.regenerated[0].amount;
  expect(amount).toBeGreaterThan(0);
  expect((await marks(page)).labels).toContain(`+${amount} HP`);
  await expect(page.locator('#chain-reward')).toContainText(`Тролль восстановит ${amount} HP`);
  await expect(page.locator('#chain-reward')).toContainText('урон или горение это остановят');
  await shot(page, 'troll-regen-forecast');
  await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME; (window as any).__regen = [];
    game.engine.subscribe((_state: unknown, event: any) => { if (event.type === 'regen') (window as any).__regen.push(event.amount); });
  });
  await finishTurn(page);
  expect(await page.evaluate(() => (window as any).__regen)).toEqual([amount]);
  expect((await troll(page)).hp).toBe(6 + amount);
  expect(errors).toEqual([]);
});

test('a club that finishes the goals is announced as «ПОБЕДА ПОСЛЕ ОТВЕТА ВРАГОВ»', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // The demo field with the goal "defeat 8": the troll's club kills six goblins in its zone, credited to the player.
  const definition = JSON.parse(await readFile('docs/examples/troll-den-demo.json', 'utf8'));
  definition.goals = [{ key: 'kills', target: 8 }];
  await page.goto('/');
  await page.locator('#editor-button').click();
  await page.locator('#editor-json').fill(JSON.stringify(definition));
  await page.locator('[data-editor="import"]').click();
  await page.locator('#editor-play').click();
  await ready(page);
  await rest(page);
  const path: number[] | null = await page.evaluate(() => {
    const game = (window as any).__PUZZLE_GAME, seen = new Set<string>();
    for (const move of game.availableMoves(5)) for (let n = 2; n <= move.length; n++) {
      const chain = move.slice(0, n), key = chain.join(','); if (seen.has(key)) continue; seen.add(key);
      const p = game.preview(chain); if (p.valid && !p.completesRoom && p.enemyPhase?.completesObjective) return chain;
    }
    return null;
  });
  expect(path).not.toBeNull();
  await holdChain(page, path!);
  const forecast = await preview(page);
  expect(forecast.enemyPhase.completesObjective).toBe(true); expect(forecast.completesRoom).toBeFalsy();
  await expect(page.locator('#chain-rank')).toContainText('ПОБЕДА ПОСЛЕ ОТВЕТА ВРАГОВ');
  await expect(page.locator('#chain-reward')).toContainText('Победа после ответа врагов');
  const plate = await page.evaluate(() => (window as any).__PUZZLE_GAME.endpointLabel);
  expect(plate.text).toBe('ПОБЕДА ПОСЛЕ ОТВЕТА ВРАГОВ'); expect(plate.plateWidth).toBeGreaterThan(plate.textWidth);
  await shot(page, 'troll-victory-after-club');
  await finishTurn(page);
  expect((await state(page)).phase).toBe('WIN');
  expect(errors).toEqual([]);
});
