import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { afterWinProfile, returnProfile, toadReturnProfile } from '../src/realtime/view/returnProfiles.testkit';
import { NPC_LINES } from '../src/realtime/view/npcLines';
import { TOAD_LINES } from '../src/realtime/view/heroLines';
import { RT_PROFILE_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';

/**
 * Task 61а–б «Возвращение» and «после первой победы», the camp's view (spec docs/design-notes/task-61-return-and-beyond.md, А.3, А.5,
 * Б.3; acceptance Г.5 items 1, 3, 4, 5): profiles built in Node by core's own way (view/returnProfiles.testkit.ts: whole runs walked by
 * their commands, the meta applied by the profile store), stored, the camp opened by a real click.
 * - the first death: the full scene (the ash, the hero rising, the sneeze), its end — one scorch, «…» over Неясыть, her `revive_first`;
 *   a reload — no scene, the scorch stays; a click or Space in the first 0,5 с — the last frame at once;
 * - 12 deaths: the short scene ends by itself, 10 scorches and 2 dark ones;
 * - Ведунья's first return: her own line after the scene, not during it;
 * - the first win over the castle: the fire turns turquoise, Неясыть and Евлампий say `win_castle_first`, Евлампий comes and his meeting
 *   is `first_fire`; skipped — «…» over both, the lines on a click; the fire stays turquoise after a reload.
 * Screenshots go to $SHOT_DIR when it is set.
 */
const shot = async (page: Page, name: string): Promise<void> => {
  if (!process.env.SHOT_DIR) return;
  await page.screenshot({ path: `${process.env.SHOT_DIR}/return-${name}.png` });
};
/**
 * A screenshot of a scene at its time `t` (s): the CSS animations paused and moved to `t` (their delays count from the scene's start,
 * `--rt-scene-t` of the stage's last draw), the picture taken, the animations played on. The scene is held (`campSceneHold`).
 */
const shotAt = async (page: Page, name: string, t: number): Promise<void> => {
  await page.evaluate(at => {
    const stage = document.querySelector('[data-testid="hearth-stage"]')!, from = parseFloat(getComputedStyle(stage).getPropertyValue('--rt-scene-t')) || 0;
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = Math.max(0, (at + from) * 1000); }
  }, t);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/return-${name}.png` });
  await page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });
};
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
interface Returns {
  scene: string | null; played: string | null; scorches: { light: number; dark: number }; fresh: number | null; fire: string; marks: string[]; says: string[]; heroLine: string; line: string;
}
const returns = (page: Page): Promise<Returns> => page.evaluate(() => (window as any).__realtime.run.returnsShown());

/** The game with the stored profile (JSON); the prologue is done. */
async function openWith(page: Page, profile: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, stored]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem(key, stored); }, [RT_PROFILE_STORAGE_KEY, profile] as const);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}
/** The camp from the run screen's «Лагерь» (a real click: the scene starts with it). */
async function toCamp(page: Page): Promise<void> {
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
}
/** A click on the bare ground of the camp (no NPC, no button). */
const ground = (page: Page): Promise<void> => page.mouse.click(160, 640);

test('task 61а: the first death — the full scene (the ash, the cat rising, the sneeze), then one scorch, «…» over Неясыть and her `revive_first`; a reload plays no scene (screenshots)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openWith(page, returnProfile(1));
  await toCamp(page);
  expect((await returns(page)).scene).toBe('full');
  await expect(page.getByTestId('camp-ash')).toHaveCount(1);
  await expect(page.locator('.rt-hearth-hero.rt-rise')).toHaveCount(1);
  // The sneeze is drawn with the scene (its CSS time is 1,5 с; the screenshots — the last test).
  await expect(page.getByTestId('camp-sneeze')).toHaveCount(1);
  await expect(page.getByTestId('hearth-say-owl')).toHaveCount(0);
  await expect.poll(async () => (await returns(page)).scene, { timeout: 6000 }).toBeNull();
  const end = await returns(page);
  expect(end.played).toBe('full');
  expect(end.scorches).toEqual({ light: 1, dark: 0 });
  await expect(page.getByTestId('hearth-scorch')).toHaveCount(1);
  await expect(page.getByTestId('camp-ash')).toHaveCount(0);
  expect(end.marks).toEqual(['owl']);
  await expect(page.getByTestId('hearth-say-owl')).toBeVisible();
  await shot(page, 'end');
  await page.getByTestId('hearth-npc-owl').click();
  await expect(page.getByTestId('hearth-line')).toHaveText(NPC_LINES.owl.revive_first![0]);
  await expect(page.getByTestId('hearth-say-owl')).toHaveCount(0);
  // A reload: the scene was marked when it began — none now; the scorch stays; the line is said.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await toCamp(page);
  const again = await returns(page);
  expect(again.scene).toBeNull();
  expect(again.played).toBeNull();
  expect(again.scorches).toEqual({ light: 1, dark: 0 });
  expect(again.marks).toEqual([]);
  await expect(page.getByTestId('hearth-scorch')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('task 61а: a click or Space in the first 0,5 с — the last frame at once (the scorch stands, «…» over Неясыть); the click does nothing else', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openWith(page, returnProfile(1, 120));
  await toCamp(page);
  expect((await returns(page)).scene).toBe('full');
  // A click on Неясыть herself skips the scene and opens no bubble.
  await page.getByTestId('hearth-npc-owl').click();
  const skipped = await returns(page);
  expect(skipped.scene).toBeNull();
  expect(skipped.played).toBe('full');
  await expect(page.getByTestId('hearth-bubble')).toHaveCount(0);
  await expect(page.getByTestId('hearth-scorch')).toHaveCount(1);
  await expect(page.getByTestId('hearth-say-owl')).toBeVisible();
  // Space: another profile's first death.
  await openWith(page, returnProfile(1, 130));
  await toCamp(page);
  expect((await returns(page)).scene).toBe('full');
  await page.keyboard.press('Space');
  expect((await returns(page)).scene).toBeNull();
  await expect(page.getByTestId('hearth-scorch')).toHaveCount(1);
  await ground(page);
  await expect(page.getByTestId('hearth-bubble')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('task 61а: 12 deaths — the short scene ends by itself; 10 scorches on the stones and 2 dark ones over them (screenshot)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openWith(page, returnProfile(12, 140));
  await toCamp(page);
  expect((await returns(page)).scene).toBe('short');
  await expect.poll(async () => (await returns(page)).scene, { timeout: 5000 }).toBeNull();
  const end = await returns(page);
  expect(end.played).toBe('short');
  expect(end.scorches).toEqual({ light: 10, dark: 2 });
  expect(end.fresh).toBe(11);
  await expect(page.getByTestId('hearth-scorch')).toHaveCount(10);
  await expect(page.getByTestId('hearth-scorch-dark')).toHaveCount(2);
  await shot(page, 'scorches-12');
  expect(errors).toEqual([]);
});

test('task 61а: Ведунья\'s first return — she shakes the ash off; her own line comes after the scene, not during it (screenshot)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openWith(page, toadReturnProfile());
  await toCamp(page);
  expect((await returns(page)).scene).toBe('full');
  await expect(page.locator('.rt-hearth-hero.rt-rise')).toHaveAttribute('data-hero', 'toad');
  await expect(page.getByTestId('hearth-hero-line')).toBeHidden();
  await expect(page.getByTestId('camp-drops')).toHaveCount(1);
  await expect(page.getByTestId('camp-sneeze')).toHaveCount(0);
  await expect.poll(async () => (await returns(page)).scene, { timeout: 6000 }).toBeNull();
  await expect(page.getByTestId('hearth-hero-line')).toBeVisible();
  await expect(page.getByTestId('hearth-hero-line')).toHaveText(TOAD_LINES.revive_first[0]);
  await shot(page, 'toad-end');
  expect(errors).toEqual([]);
});

test('task 61б: the first win over the castle — the fire turns turquoise, Неясыть says `win_castle_first`, Евлампий comes and meets with `first_fire`, his `win_castle_first` on a click; a reload keeps the fire (screenshots)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openWith(page, afterWinProfile(false));
  await toCamp(page);
  const start = await returns(page);
  expect(start.scene).toBe('win');
  expect(start.fire).toBe('turquoise');
  await expect(page.getByTestId('hearth-tint')).toHaveCount(1);
  await expect(page.getByTestId('hearth-npc-monk')).toBeVisible();
  await expect.poll(async () => (await returns(page)).says, { timeout: 2500 }).toEqual(['owl']);
  await expect(page.getByTestId('hearth-scene-line-owl')).toHaveText(NPC_LINES.owl.win_castle_first![0]);
  await expect.poll(async () => (await returns(page)).says, { timeout: 2500 }).toEqual(['owl', 'monk']);
  // He came with the scene: his meeting first — `first_fire`; his `win_castle_first` waits for a click («…»).
  await expect(page.getByTestId('hearth-scene-line-monk')).toHaveText(NPC_LINES.monk.first_fire![0]);
  await expect.poll(async () => (await returns(page)).scene, { timeout: 6000 }).toBeNull();
  const end = await returns(page);
  expect(end.says).toEqual([]);
  expect(end.marks).toEqual(['monk']);
  await shot(page, 'win-end');
  await page.getByTestId('hearth-npc-monk').click();
  await expect(page.getByTestId('hearth-line')).toHaveText(NPC_LINES.monk.win_castle_first![0]);
  expect((await returns(page)).marks).toEqual([]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await toCamp(page);
  const again = await returns(page);
  expect(again.scene).toBeNull();
  expect(again.fire).toBe('turquoise');
  await expect(page.getByTestId('hearth-tint')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('task 61б: the first win\'s scene skipped — the fire is turquoise at once, «…» over Неясыть and Евлампий; a click says `win_castle_first`', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openWith(page, afterWinProfile(true, 320));
  await toCamp(page);
  expect((await returns(page)).scene).toBe('win');
  await ground(page);
  const skipped = await returns(page);
  expect(skipped.scene).toBeNull();
  expect(skipped.fire).toBe('turquoise');
  expect([...skipped.marks].sort()).toEqual(['monk', 'owl']);
  await expect(page.getByTestId('hearth-say-owl')).toBeVisible();
  await expect(page.getByTestId('hearth-say-monk')).toBeVisible();
  await page.getByTestId('hearth-npc-owl').click();
  await expect(page.getByTestId('hearth-line')).toHaveText(NPC_LINES.owl.win_castle_first![0]);
  await page.getByTestId('hearth-npc-monk').click();
  await expect(page.getByTestId('hearth-line')).toHaveText(NPC_LINES.monk.win_castle_first![0]);
  expect((await returns(page)).marks).toEqual([]);
  expect(errors).toEqual([]);
});

test('task 61а–б, screenshots of the scenes at their times (held; animations paused and moved): the cat rising and sneezing, Ведунья shaking the ash off, the fire turning turquoise, the first win\'s lines', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const held = async (profile: string): Promise<void> => {
    await openWith(page, profile);
    await page.evaluate(() => (window as any).__realtime.run.campSceneHold(true));
    await toCamp(page);
  };
  await held(returnProfile(1, 160));
  for (const [name, t] of [['night', 0.2], ['flare', 0.45], ['rise', 1.1], ['sneeze', 1.62], ['scorch', 1.9]] as const) await shotAt(page, `cat-${name}`, t);
  await page.keyboard.press('Space');
  expect((await returns(page)).scene).toBeNull();
  await held(toadReturnProfile(220));
  await shotAt(page, 'toad-drops', 1.7);
  await page.keyboard.press('Space');
  await held(afterWinProfile(false, 340));
  await shotAt(page, 'win-turn', 0.9);
  await expect.poll(async () => (await returns(page)).says, { timeout: 2500 }).toEqual(['owl']);
  await shotAt(page, 'win-owl', 1.6);
  await expect.poll(async () => (await returns(page)).says, { timeout: 2500 }).toEqual(['owl', 'monk']);
  await shotAt(page, 'win-monk', 3.1);
  expect((await returns(page)).scene).toBe('win');
  await page.keyboard.press('Escape');
  expect((await returns(page)).scene).toBeNull();
  expect(errors).toEqual([]);
});
