import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { readFileSync } from 'node:fs';

/**
 * B6 К7 «Проклятый сундук» (src/realtime/sim/chest.ts, src/realtime/run/rtRun.ts, docs/realtime-casino.md): real input at
 * 1280×720.
 * - The sandbox: «Застава» has no chest until the debug panel's checkbox is on and the fight starts again (R); a click on
 *   the chest takes it by a chain — the violet border and «проклятие 0/12» at the hero; a mouse chain of 3 → «проклятие 3/12»;
 *   an enemy's touch takes 2 HP instead of 1.
 * - The run: a save at the «Застава» choice whose fight took the chest (the fixture of 7ae55fc with `chest` on its record);
 *   after the «Застава» talisman the chest's own screen — two talismans, the reroll, the choice closes it.
 */

const RUN_KEY = 'ashen-oath-rt-run-v7';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/rt-run-save-before-reroll.json', import.meta.url), 'utf8')) as { hard: string };

function watch(page: Page, errors: string[]): void {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}
type Snap = { objects: { kind: string; x: number; y: number }[]; curse: { kills: number; by: string; lifted?: number } | null; curseView: { chests: number; border: boolean; label: string }; hero: { x: number; y: number; hp: number; chainShield: number; invulnerable: number }; moving: string | null; chain: number[] };
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color = 0): Promise<number> =>
  page.evaluate(([x, y, color]) => (window as any).__realtime.place(x, y, color, 0), [x, y, color] as const);

/** Only the placed enemies, standing still (as `freeze` of realtime.spec.ts); the start enemies of the arena removed. */
async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.params.enemySpeed = 0; rt.params.wolfSpeed = 0; rt.params.speedSpread = 0;
    rt.params.baseIntervalMin = 1000; rt.params.baseIntervalMax = 1000; rt.params.baseFloor = 0;
    for (const phase of rt.params.phases) phase.floor = 0;
    rt.params.boarMax = 0; rt.params.wolfRing = false; rt.params.hitstop = false;
    rt.clear(false);
  });
}

test('the sandbox: the panel puts the chest on «Застава»; a click takes it — the border and «проклятие N/12» at the hero; a touch takes 2 HP', async ({ page }) => {
  const errors: string[] = [];
  watch(page, errors);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('9');
  await expect(page.getByTestId('menu')).toBeHidden();
  expect((await snap(page)).objects.some(o => o.kind === 'chest')).toBe(false);

  // The panel's checkbox, then the fight again (R): the chest stands in the yard.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeVisible();
  const box = page.locator('[data-param="cursedChest"] input');
  await expect(box).not.toBeChecked();
  await box.check();
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-panel')).toBeHidden();
  await freeze(page);
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snap(page)).objects.some(o => o.kind === 'chest')).toBe(true);
  await freeze(page);
  const chest = (await snap(page)).objects.find(o => o.kind === 'chest')!;
  expect(chest).toMatchObject({ x: 13.8, y: 7.7 });
  await expect.poll(async () => (await snap(page)).curseView.chests).toBe(1);
  expect((await snap(page)).curse).toBeNull();

  // A click on the chest: a chain of just the chest, the dash takes it.
  await page.evaluate(() => (window as any).__realtime.teleport(12.4, 7.7));
  await page.screenshot({ path: 'artifacts/realtime-chest-object.png' });
  const at = await screen(page, chest.x, chest.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).curse?.by ?? null, { timeout: 8_000 }).toBe('chain');
  await expect.poll(async () => (await snap(page)).curseView).toEqual({ chests: 0, border: true, label: 'проклятие 0/12' });
  await page.mouse.move(40, 40);
  await page.screenshot({ path: 'artifacts/realtime-chest-curse.png' });

  // A mouse chain of 3: the counter counts the dash's kills.
  const hero = (await snap(page)).hero, xs = [hero.x - 0.8, hero.x - 1.8, hero.x - 2.8], y = hero.y - 0.9;
  for (const x of xs) await place(page, x, y);
  const points: { x: number; y: number }[] = [];
  for (const x of xs) points.push(await screen(page, x, y));
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
  await expect.poll(async () => (await snap(page)).chain.length).toBe(3);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).curseView.label, { timeout: 8_000 }).toBe('проклятие 3/12');
  expect((await snap(page)).curse?.kills).toBe(3);

  // A touch of a weak enemy (the sandbox's touch 1): the curse makes it 2.
  await expect.poll(async () => { const h = (await snap(page)).hero; return h.chainShield <= 0 && h.invulnerable <= 0 && (await snap(page)).moving === null; }, { timeout: 8_000 }).toBe(true);
  const before = (await snap(page)).hero;
  await place(page, before.x + 0.3, before.y, 1);
  await expect.poll(async () => (await snap(page)).hero.hp, { timeout: 8_000 }).toBeLessThan(before.hp);
  expect((await snap(page)).hero.hp).toBe(before.hp - 2);
  expect(errors).toEqual([]);
});

test('the run: after the «Застава» talisman the chest\'s screen — two talismans, the reroll, the choice closes it', async ({ page }) => {
  const errors: string[] = [];
  watch(page, errors);
  // The fixture's «Застава» offer, its fight's record with the chest taken (as the new code writes it).
  const value = JSON.parse(fixture.hard);
  value.battles.find((record: { nodeId: string }) => record.nodeId === value.pending.nodeId).chest = true;
  await page.goto('/');
  await page.evaluate(([key, save]) => { localStorage.clear(); localStorage.setItem(key, save); }, [RUN_KEY, JSON.stringify(value)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  const hard = page.getByTestId('run-talisman');
  await expect(hard).toBeVisible();
  await expect(hard).toContainText('Талисман на выбор');
  const first = await hard.locator('[data-action="talisman"][data-option]:not([data-option=""])').first().getAttribute('data-option');
  await hard.locator(`[data-option="${first}"]`).click();

  const card = page.getByTestId('run-chest');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Проклятый сундук');
  const options = () => card.locator('[data-action="talisman"][data-option]:not([data-option=""])').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.option!));
  const shown = await options();
  expect(shown).toHaveLength(2);
  expect(shown).not.toContain(first);
  const reroll = card.getByTestId('talisman-reroll');
  await expect(reroll).toHaveText('Перебросить — 1 ресурс');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/realtime-chest-screen.png' });
  await reroll.click();
  await expect(reroll).toHaveText('Перебросить — 2 ресурса');
  const fresh = await options();
  expect(fresh).toHaveLength(2);
  expect(fresh.some(id => shown.includes(id))).toBe(false);
  await card.locator(`[data-option="${fresh[0]}"]`).click();
  await expect(card).toBeHidden();
  const state = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(state.pending).toBeNull();
  expect(state.talismans).toEqual(expect.arrayContaining([first, fresh[0]]));
  expect(errors).toEqual([]);
});
