import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { leaveResult } from './realtimeResult';
import { trophyProfile, RT_PROFILE_STORAGE_KEY } from './trophyProfiles';
import { NPC_LINES } from '../src/realtime/view/npcLines';

/**
 * Task 51е «Трофеи на стене лагеря» (design 17.10.2026, docs/design-notes/task-51-camp-l3.md, section 4), the view: the perch at the top of
 * the camp, the drop of the trophies a run earned on the first entry after it, the pointer's name and «Поход N», the owl's `trophy` line
 * once per trophy, the worst-case layout, a seeded run with no trophy. The profiles are made by REAL runs of core's rules (the walk of the
 * run's own commands, `tests/trophyProfiles.ts`), stored in `localStorage`; the camp is opened with real clicks at 1280×720 and 1920×1080.
 * Screenshots go to $SHOT_DIR when it is set.
 */
const shot = async (page: Page, name: string): Promise<void> => {
  if (!process.env.SHOT_DIR) return;
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The game with the stored profile `json` (the prologue is done). */
async function openWith(page: Page, json: string, url = '/'): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, text]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem(key as string, text as string); }, [RT_PROFILE_STORAGE_KEY, json] as const);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

async function toCamp(page: Page): Promise<void> {
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
}

const shown = (page: Page) => page.evaluate(() => (window as any).__realtime.run.trophiesShown());
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), RT_PROFILE_STORAGE_KEY);
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const keyOf = (e: { id: string; mark?: number }): string => (e.mark ? `${e.id}:${e.mark}` : e.id);

test('task 51е: the trophies a run earned fall on their hooks at the first entry to the camp — also after a reload before it, not again after it; the pointer shows the name and «Поход N»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const made = trophyProfile(12, true);
  expect(made.earned.length).toBeGreaterThan(0);
  await openWith(page, made.json);
  // A reload before the camp: the end of the run is in the profile, nothing was shown yet.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await toCamp(page);
  const first = await shown(page);
  expect(first.held, 'the perch holds the profile\'s trophies in the order they came').toEqual(made.held);
  expect([...first.dropping].sort(), 'what the run earned falls').toEqual([...new Set(made.earned.map(e => e.id))].sort());
  expect(first.hooks).toBe(10);
  await expect(page.locator('.rt-hearth-hung.rt-drop')).toHaveCount(first.dropping.length);
  await expect(page.locator('.rt-hearth-hook')).toHaveCount(10);
  // The pointer: the name and the run's number («Поход N»); «Доска Испытания» also its steps.
  const jailer = made.held[0]!;
  await page.getByTestId(`hearth-trophy-${jailer}`).hover();
  await expect(page.getByTestId(`hearth-trophy-tip-${jailer}`)).toBeVisible();
  await expect(page.getByTestId(`hearth-trophy-tip-${jailer}`)).toContainText('Поход 1');
  await expect(page.getByTestId('hearth-trophy-tip-ash')).toBeHidden();
  await page.getByTestId('hearth-trophy-ash').hover();
  await expect(page.getByTestId('hearth-trophy-tip-ash')).toContainText('Доска Испытания');
  await expect(page.getByTestId('hearth-trophy-tip-ash')).toContainText('Испытание: V');
  // The memory of the drop is the profile's.
  const lines = (await stored(page)).meta.hearth.lines as Record<string, number>;
  for (const e of made.earned) expect(lines[`trophy-drop:${keyOf(e)}`], `the drop of ${e.id} is remembered`).toBe(1);
  await shot(page, 'camp-trophies-drop');
  // The camp seen: a reload and the camp again - the trophies hang, nothing falls.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await toCamp(page);
  const again = await shown(page);
  expect(again.held).toEqual(made.held);
  expect(again.dropping).toEqual([]);
  await expect(page.locator('.rt-drop')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('task 51е: the owl says `trophy` once per trophy (two lines in turn), never again for the same ones', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const made = trophyProfile(12, true);
  await openWith(page, made.json);
  await toCamp(page);
  const trophyLines: string[] = [...NPC_LINES.owl.trophy!];
  const seen: string[] = [];
  // Real clicks on the owl: the bubble opens with a line; a click on her again closes it. Other lines (the retro, the occasion) may come too.
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('hearth-npc-owl').click();
    await expect(page.getByTestId('hearth-bubble')).toBeVisible();
    seen.push((await page.getByTestId('hearth-line').textContent()) ?? '');
    await page.getByTestId('hearth-npc-owl').click();
  }
  expect(seen.filter(line => trophyLines.includes(line)), 'once for the run\'s trophies').toHaveLength(1);
  const lines = (await stored(page)).meta.hearth.lines as Record<string, number>;
  const said = Object.keys(lines).filter(key => key.startsWith('owl:trophy:')).sort();
  expect(said).toEqual([...new Set(made.earned.map(e => `owl:trophy:${keyOf(e)}`))].sort());
  for (const key of said) expect(lines[key]).toBe(1);
  // After a reload her line does not come back.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await toCamp(page);
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('hearth-npc-owl').click();
    expect(trophyLines).not.toContain(await page.getByTestId('hearth-line').textContent());
    await page.getByTestId('hearth-npc-owl').click();
  }
  expect(errors).toEqual([]);
});

for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
  test(`task 51е: the worst case at ${width}×${height} — the perch full (8 of 9 trophies, 10 hooks), the owl's panel open, the stock — the perch covers no stock, name, figure or «В поход», and the panel stays above it`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    const made = trophyProfile(12);
    expect(made.held.length).toBeGreaterThanOrEqual(8);
    await openWith(page, made.json);
    await toCamp(page);
    await expect(page.locator('.rt-hearth-hung')).toHaveCount(made.held.length);
    const stage = (await page.locator('.rt-hearth-stage').boundingBox())!;
    const perch = await box(page, 'hearth-perch');
    expect(perch.x >= stage.x - 1 && perch.x + perch.width <= stage.x + stage.width + 1 && perch.y >= stage.y - 1, 'the perch is on the scene').toBe(true);
    // The perch covers none of: the stock, the title, the NPC names, the figures, «В поход».
    const stock = await box(page, 'hearth-stock'), title = (await page.locator('.rt-hearth-head > b').boundingBox())!;
    expect(overlap(perch, stock) || overlap(perch, title), 'the perch is clear of the stock and the title').toBe(false);
    const others = page.locator('.rt-hearth-place:not(.rt-hearth-empty), .rt-hearth-go, .rt-hearth-name');
    for (let i = 0; i < await others.count(); i++) {
      const b = await others.nth(i).boundingBox();
      if (!b || b.width === 0) continue;
      expect(overlap(perch, b), `the perch is clear of ${(await others.nth(i).getAttribute('data-testid')) ?? (await others.nth(i).textContent())}`).toBe(false);
    }
    // Every trophy hangs inside the perch.
    const hung = page.locator('.rt-hearth-hung');
    for (let i = 0; i < await hung.count(); i++) { const b = (await hung.nth(i).boundingBox())!; expect(b.x >= perch.x - 1 && b.x + b.width <= perch.x + perch.width + 1, `trophy ${i} on the perch`).toBe(true); }
    // The owl's panel open: in the window, above the perch where they meet, covering no figure.
    await page.getByTestId('hearth-npc-owl').click();
    const bubble = await box(page, 'hearth-bubble');
    expect(bubble.x >= 0 && bubble.y >= 0 && bubble.x + bubble.width <= width && bubble.y + bubble.height <= height, 'the panel in the window').toBe(true);
    const inBubble = await page.evaluate(([x, y]) => !!document.elementFromPoint(x as number, y as number)?.closest('.rt-hearth-bubble'), [bubble.x + bubble.width / 2, Math.max(bubble.y + 4, perch.y + 20)] as const);
    expect(inBubble, 'the panel is above the perch where they meet').toBe(true);
    const places = page.locator('.rt-hearth-place:not(.rt-hearth-empty)');
    for (let i = 0; i < await places.count(); i++) {
      const b = await places.nth(i).boundingBox(), id = await places.nth(i).getAttribute('data-testid');
      if (!b || b.width === 0 || id === 'hearth-npc-owl') continue;
      expect(overlap(bubble, b), `the panel covers no figure (${id})`).toBe(false);
    }
    await shot(page, `camp-trophies-worst-${width}x${height}`);
    expect(errors).toEqual([]);
  });
}

test('task 51е: the camp with five NPC and the trophies (the shot for the design)', async ({ page }) => {
  test.setTimeout(90_000);
  const made = trophyProfile(12);
  const profile = JSON.parse(made.json);
  // Five NPC at the fire; the perch as the runs made it.
  profile.meta.hearth.met = { herb: true, smith: true, gambler: true, monk: true };
  await openWith(page, JSON.stringify(profile));
  await toCamp(page);
  await expect(page.locator('.rt-hearth-hung')).toHaveCount(made.held.length);
  await shot(page, 'camp-five-npc-trophies');
});

test('task 51е: a run with a given seed earns no trophy (a real fight lost); the perch stays as it was', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const made = trophyProfile(2);
  await openWith(page, made.json, '/?seed=7');
  const before = (await stored(page)).meta;
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await page.locator('[data-action="gift"]:not([disabled])').last().click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  const nodes = page.locator('[data-status="available"]');
  await expect(nodes.first()).toBeVisible();
  await nodes.first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await leaveResult(page);
  const after = (await stored(page)).meta;
  expect(after.trophies, 'a seeded run changes no trophy').toEqual(before.trophies);
  expect(after.applied, 'and has no meta end of its own').toEqual(before.applied);
  expect(errors).toEqual([]);
});
