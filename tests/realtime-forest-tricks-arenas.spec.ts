import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame } from './realtimeFrames';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 57б «Лес: механики», the arenas (level design 22.10.2026): the sandbox menu's group «Лес: механики» at its end — «Механики леса
 * (проба)», «Трясина», «Бурелом» (`tricks-arena-1…3`, `?arena=45…47`). Smoke at 1280×720 with a real click on the menu: each arena
 * opens, its kinds stand from the start (the probe: rootlings, slimes, a firebrand; «Трясина»: slimes; «Бурелом»: weak enemies only,
 * the centipede comes with 57б-2), 8 s of game time pass (or the idle hero falls first — the sandbox's pace) with no page error, and the
 * page's journal replays in Node to its hash.
 * The run plays «Трясина» only with the flag `forestTricks` (off): its rules are checked in Node (`npm run test:realtime-forest-tricks-run`).
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

const ARENAS: readonly { id: string; name: string; kinds: readonly string[] }[] = [
  { id: 'tricks-arena-1', name: 'Механики леса (проба)', kinds: ['basic', 'firebrand', 'rootling', 'slime'] },
  { id: 'tricks-arena-2', name: 'Трясина', kinds: ['basic', 'slime'] },
  { id: 'tricks-arena-3', name: 'Бурелом', kinds: ['basic'] },
];

for (const arena of ARENAS) {
  test(`sandbox «${arena.name}»: opens from the menu, its kinds stand, 8 s of play, the journal replays to the page hash`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?sandbox=1');
    await expect(page.locator('h3.rt-arenas-head', { hasText: 'Лес: механики' })).toBeVisible();
    const button = page.getByTestId(arena.id);
    await expect(button.locator('b')).toHaveText(arena.name);
    await button.click();
    await expect(page.locator('#rt-app canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.snapshot())).toBe(true);
    const kinds = await page.evaluate(() => [...new Set(((window as any).__realtime.snapshot().enemies as { kind: string }[]).map(e => e.kind))].sort());
    expect(kinds).toEqual(arena.kinds);
    const t0 = await page.evaluate(() => (window as any).__realtime.snapshot().time as number);
    const end = await untilFrame(page, (snap, until: number) => (snap.time >= until || snap.status !== 'playing' ? { time: snap.time as number, status: snap.status as string } : undefined), t0 + 8, 30);
    expect(end.time).toBeGreaterThan(t0 + 2);
    const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
    expect(recorded.journal.arena).toBe(arena.id === 'tricks-arena-2' ? 'f-bog' : arena.id === 'tricks-arena-3' ? 'f-windfall' : 'forest-tricks-test');
    expect(replay(recorded.journal).hash()).toBe(recorded.hash);
    expect(errors).toEqual([]);
  });
}
