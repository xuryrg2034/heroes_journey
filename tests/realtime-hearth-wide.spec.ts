import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';

/**
 * UI-01 (approved 20.10.2026 after the council on the Codex PC UI ideas): the camp «Очаг» on a window wider or taller than 1280×720.
 * The background art is a 1280×720 picture in the window's middle; the heroes, the NPC, the fire and the panel must stand on it — before
 * the fix they kept the window's left-top 1280×720 coordinates and slid off the picture at 1920×1080. Real window sizes, real clicks.
 */
const shot = (name: string): string => `${process.env.SHOT_DIR ?? 'artifacts'}/${name}.png`;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

// A camp with every place taken: both heroes (Ведунья freed), the five NPC; their meetings said (no «✦»).
const META = {
  heroes: { cat: { xp: 40, packs: [], record: { row: 9, won: true, xp: 40 } }, toad: { xp: 5, packs: [] } },
  freed: { toad: { row: 5 } },
  // The worst case of the owl's panel: the retro line (Ведунья freed, no run counted: `retro`), her quest, the new in the chronicle («Летопись ✦ N»).
  chronicle: { kinds: ['wolf'], unread: ['kind:wolf'] },
  hearth: {
    quest: { npc: 'owl', id: 'owl-forest' },
    stock: 10, levels: { owl: 1, herb: 1, smith: 1, gambler: 1, monk: 1 }, met: { herb: true, smith: true, gambler: true, monk: true },
    lines: { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2, 'gambler:first': 2, 'monk:first': 2, 'toad:first_camp': 1 }, quiet: 0,
  },
};

async function openCamp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(m => {
    localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1');
    localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 3, won: true, meta: m }));
  }, META);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('run-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
}

for (const [width, height] of [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]] as const) {
  test(`UI-01б: the camp at ${width}×${height} — the scene is 1280·s × 720·s in the middle (one scale); every NPC answers a click and its panel covers no other figure; «В поход» leaves`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await openCamp(page);
    const s = Math.max(1, Math.min(width / 1280, height / 720));
    const art = { x: (width - 1280 * s) / 2, y: (height - 720 * s) / 2, w: 1280 * s, h: 720 * s };
    const stage = (await page.locator('.rt-hearth-stage').boundingBox())!;
    expect(Math.abs(stage.x - art.x), 'the scene starts where the picture does').toBeLessThan(1.5);
    expect(Math.abs(stage.y - art.y)).toBeLessThan(1.5);
    expect(Math.abs(stage.width - art.w), 'the scene is 1280·s wide').toBeLessThan(1.5);
    expect(Math.abs(stage.height - art.h), 'the scene is 720·s high').toBeLessThan(1.5);
    // The title and the stock stay in the window's corners (not scaled).
    const head = (await page.locator('.rt-hearth-head > b').boundingBox())!;
    expect(head.x < 40 && head.y < 40 && head.height < 40, 'the title in the window corner, not scaled').toBe(true);
    const stock = (await page.getByTestId('hearth-stock').boundingBox())!;
    expect(stock.x + stock.width > width - 40 && stock.y < 40, 'the stock in the window corner').toBe(true);
    // Every place stands inside the scene.
    const places = page.locator('.rt-hearth-place');
    const count = await places.count();
    expect(count, 'both heroes and the five NPC').toBeGreaterThanOrEqual(7);
    for (let i = 0; i < count; i++) {
      const box = (await places.nth(i).boundingBox())!;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      expect(cx > art.x && cx < art.x + art.w && cy > art.y && cy < art.y + art.h, `place ${i} on the picture (${cx.toFixed(0)}, ${cy.toFixed(0)})`).toBe(true);
    }
    // Task 51ж: «Чурбаки» — the design's picture loaded, 115·s px high, the name under it, clear of every other place and of the fire's panel.
    const dummies = page.getByTestId('hearth-warmup'), dArt = page.getByTestId('hearth-warmup-art');
    expect(await dArt.evaluate((img: HTMLImageElement) => img.naturalWidth), 'the dummies picture loaded').toBeGreaterThan(0);
    const dh = (await dArt.boundingBox())!, dn = (await dummies.locator('.rt-hearth-name').boundingBox())!, db = (await dummies.boundingBox())!;
    expect(Math.abs(dh.height - 115 * s), `the picture's height ${dh.height} at scale ${s}`).toBeLessThan(3);
    expect(dn.y >= dh.y + dh.height - 6 * s, 'the name under the dummies').toBe(true);
    const others = page.locator('.rt-hearth-place:not(.rt-hearth-warmup), .rt-hearth-center, .rt-hearth-go');
    for (let i = 0; i < await others.count(); i++) {
      const b = await others.nth(i).boundingBox();
      if (!b || b.width === 0) continue;
      expect(db.x < b.x + b.width && db.x + db.width > b.x && db.y < b.y + b.height && db.y + db.height > b.y, `«Чурбаки» cross no other place (${await others.nth(i).getAttribute('data-testid') ?? 'panel'})`).toBe(false);
    }
    const go = (await page.locator('.rt-hearth-go').boundingBox())!;
    expect(go.x >= art.x && go.x + go.width <= art.x + art.w && go.y + go.height <= art.y + art.h).toBe(true);
    // A real click on every NPC opens their panel in the window; the panel covers no other figure or name.
    for (const npc of ['owl', 'herb', 'smith', 'gambler', 'monk']) {
      await page.getByTestId(`hearth-npc-${npc}`).click();
      const bubble = page.getByTestId('hearth-bubble');
      await expect(bubble).toBeVisible();
      await expect(bubble).toHaveAttribute('data-npc', npc);
      const b = (await bubble.boundingBox())!;
      expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height, `${npc}: the panel in the window`).toBe(true);
      for (let i = 0; i < count; i++) {
        const box = (await places.nth(i).boundingBox())!;
        const cross = box.x < b.x + b.width && box.x + box.width > b.x && box.y < b.y + b.height && box.y + box.height > b.y;
        expect(cross, `${npc}: the panel does not cross place ${i} (${await places.nth(i).getAttribute('data-testid')})`).toBe(false);
      }
      if (npc === 'owl' && width <= 1920 && (width === 1280 || width === 1920)) await page.screenshot({ path: shot(`hearth-owl-retro-${width}x${height}`) });
      if (npc === 'monk') await page.screenshot({ path: shot(`hearth-scale-${width}x${height}`) });
    }
    // «В поход» leaves the camp.
    await page.getByTestId('hearth-go').click();
    await expect(page.getByTestId('hearth')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
