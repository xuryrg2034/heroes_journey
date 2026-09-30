import { expect, test, type Page } from '@playwright/test';
import { chooseFindItem, createForestRun, enterNode, resolveBattle, serializeForestRun, type ForestRunState, type ForestRunStep } from '../src/game/run/forestRun';

// Refill palette of map battles (AGENTS.md, docs/biomes/forest-map.md): rows 1–2 — 2 colors, 3–4 — 3, 5–8 — 4, from
// row 9 — 5, plus the colors of the authored start. Checked on nodes entered from the real map screen.
const RUN_KEY = 'ashen-oath-forest-run-v1';
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const inPalette = (s: any) => s.customLevel.paletteWeights.flatMap((weight: number, color: number) => weight > 0 ? [color] : []);
async function ready(page: Page) {
  await expect(page.locator('#board-host canvas')).toBeVisible();
  await expect.poll(async () => (await state(page)).phase).toBe('PLAYER_INPUT');
}
function ok(step: ForestRunStep): ForestRunState { if (!step.ok) throw new Error(step.reason); return step.run; }
function walk(ids: string[]): ForestRunState {
  let run = createForestRun(4242);
  for (const id of ids) {
    run = ok(enterNode(run, id));
    const pending = run.pending;
    if (pending?.kind === 'battle') run = ok(resolveBattle(run, { nodeId: pending.nodeId, won: true, player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { ...run.resources.inventory } }));
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]));
  }
  return run;
}
async function openNode(page: Page, visited: string[], nodeId: string) {
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } },
    [RUN_KEY, serializeForestRun(walk(visited))]);
  await page.goto('/'); await page.locator('#run-start-button').click();
  await page.locator(`.map-node[data-node="${nodeId}"]`).click(); await ready(page);
}

for (const [nodeId, visited, colors] of [
  ['trunk-1', [], 2],
  ['beast-wolf', ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4'], 4],
  ['jailer', ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4', 'beast-wolf', 'beast-boar', 'trail-find', 'trail-banners'], 5],
] as const) {
  test(`${nodeId}: the refill palette of its map row holds ${colors} colors and covers the authored start`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openNode(page, [...visited], nodeId);
    const s = await state(page);
    expect(s.runNode.nodeId).toBe(nodeId);
    const palette = inPalette(s);
    expect(palette.length).toBeGreaterThanOrEqual(colors);
    for (const cell of s.board) if (cell && cell.color !== null && cell.kind !== 'door') expect(palette).toContain(cell.color);
    expect(errors).toEqual([]);
  });
}

test('a real chain in a map battle refills from the palette without repainting survivors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openNode(page, [], 'trunk-1');
  const before = await state(page);
  const path = await page.evaluate(() => {
    const g = (window as any).__PUZZLE_GAME;
    return g.availableMoves().filter((move: number[]) => { const p = g.preview(move); return p.valid && !p.completesRoom && p.damage === 0; })
      .sort((a: number[], b: number[]) => b.length - a.length)[0];
  });
  expect(path).toBeTruthy();
  const point = (i: number) => page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), i);
  const first = await point(path[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const i of path.slice(1)) { const p = await point(i); await page.mouse.move(p.x, p.y, { steps: 4 }); }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  await page.mouse.up(); await ready(page);
  const after = await state(page);
  expect(after.turn).toBe(before.turn + 1);
  const palette = inPalette(before);
  const knownIds = new Set(before.board.filter(Boolean).map((cell: any) => cell.id));
  for (const cell of after.board.filter(Boolean)) {
    const previous = before.board.find((old: any) => old?.id === cell.id);
    if (previous) expect(cell.color).toBe(previous.color);
    else if (cell.kind !== 'prism' && !knownIds.has(cell.id)) expect(palette).toContain(cell.color);
  }
  await page.screenshot({ path: 'artifacts/palette-map-refill.png' });
  expect(errors).toEqual([]);
});
