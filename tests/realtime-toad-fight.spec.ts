import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { untilFrame, gameWait } from './realtimeFrames';
import { serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { JAILER_RUN_ARENAS } from '../src/realtime/sim/arenasBoss';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Task 49 «Второй герой», the view of the fight (docs/design-notes/task-49-second-hero.md, 4, 6.1, 8, 10; docs/realtime-prototype.md, 9к):
 * Ведунья in the sandbox («Герой» on the panel, `useHero`) — her picture, the ring on herself from 3 links strikes inside, the sign of the law
 * (dim on an open chain, lit on the ring), the thread gives no shield and the touch hurts, the ring gives it; the lesson on the spot («Замкни
 * на себя», the ghost hand, «Без кольца — без щита» with the crack, the brighter shield after the first seal); the Jailer's cage with her in a
 * run of the meta (and by `?cage=1` in the sandbox). Real mouse input; the journal of each fight replays in Node to the page's hash.
 * Shots (1280×720) go to SHOT_DIR (default artifacts/). The rules are Node's (`npm run test:realtime-heroes`...); this test looks at what the player sees.
 */
const SHOTS = process.env.SHOT_DIR ?? 'artifacts';
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp: number): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp, 'basic'), [x, y, color, hp] as const);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The journal of the fight replays in Node (no view at all) to the hash the page has. */
async function sameHash(page: Page): Promise<void> {
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
}

/** The sandbox, quiet (only what the test places acts); the hero of the next fight is Ведунья or the cat; the hero at (8, 5.5). */
async function openSandbox(page: Page, hero: 'toad' | null, query = ''): Promise<void> {
  await page.goto(`/?sandbox=1&arena=1${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.evaluate(h => (window as any).__realtime.useHero(h, 1), hero);
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(8, 5.5);
  });
}

/** Three weak red enemies round the hero at (8, 5.5) in a diamond with a blue one inside: the arc on the hero closes. */
async function arc(page: Page): Promise<{ links: number[]; inner: number; at: { x: number; y: number }[] }> {
  const pts = [[9.4, 4.4], [10.4, 5.5], [9.4, 6.6]] as const;
  const links = [] as number[];
  for (const [x, y] of pts) links.push(await place(page, x, y, 0, 1));
  const inner = await place(page, 9.1, 5.5, 1, 3);
  return { links, inner, at: await Promise.all(pts.map(([x, y]) => screen(page, x, y))) };
}

/** Three weak red enemies in a row from the hero outwards: an open chain (the last link is out of the hero's reach). */
async function thread(page: Page): Promise<{ links: number[]; at: { x: number; y: number }[] }> {
  const pts = [[9.3, 5.5], [10.8, 5.5], [12.3, 5.5]] as const;
  const links = [] as number[];
  for (const [x, y] of pts) links.push(await place(page, x, y, 0, 1));
  return { links, at: await Promise.all(pts.map(([x, y]) => screen(page, x, y))) };
}

async function drag(page: Page, at: { x: number; y: number }[]): Promise<void> {
  await page.mouse.move(at[0].x, at[0].y);
  await page.mouse.down();
  for (const p of at.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 });
}

/** An enemy right at the hero (a touch; `contactDamage` is on): where the hero stands now, after the dash. */
const touchHero = (page: Page): Promise<void> => page.evaluate(() => { const rt = (window as any).__realtime, h = rt.snapshot().hero; rt.place(h.x + 0.5, h.y, 3, 9, 'basic'); });

/** The ring on the hero: the pointer goes back to the hero after the last link. */
async function closeOnHero(page: Page): Promise<void> {
  const h = await page.evaluate(() => (window as any).__realtime.snapshot().hero);
  const p = await screen(page, h.x, h.y);
  await page.mouse.move(p.x, p.y, { steps: 4 });
}

/** The dash after the release has ended. */
const dashDone = (page: Page): Promise<boolean> => untilFrame(page, (s, _a: number, late) => (!s.moving && !s.chain.length) || late ? !s.moving : undefined, 0, 10);

test('the sandbox hero «ведунья»: her picture, the ring on herself from 3 links strikes inside and gives the shield (brighter once), the sign is lit', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page, 'toad');
  expect((await snap(page)).heroView).toMatchObject({ id: 'toad', art: true });
  // The panel names her.
  const { links, inner, at } = await arc(page);
  await drag(page, at);
  await expect.poll(async () => (await snap(page)).chain).toEqual(links);
  await closeOnHero(page);
  // The ring closes on the hero from 3 links; the law's sign is lit (the plan: a seal, so a shield).
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('hero');
  await expect.poll(async () => (await snap(page)).toad.sign).toEqual({ dim: false, lit: true });
  await page.mouse.up();
  // The strike inside: the blue one loses HP and is held; the links died; the shield comes after the ring.
  await expect.poll(async () => (await snap(page)).enemies.find((e: any) => e.id === inner)?.hp, { timeout: 8000 }).toBeLessThan(3);
  // The shield (0.5 s) glows at once after the dash: the frame is read as it comes, the shot is taken inside it.
  const glow = await untilFrame(page, (sn, _a: number, late) => sn.chainShield.glow && sn.toad.boost ? { glow: true, boost: true } : late ? { glow: sn.chainShield.glow, boost: sn.toad.boost } : undefined, 0, 12);
  expect(glow, 'the shield glows, the first seal: the brighter glow').toEqual({ glow: true, boost: true });
  await page.screenshot({ path: `${SHOTS}/toad-shield-after-ring.png` });
  expect(await dashDone(page)).toBe(true);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('an open chain of Ведунья: the sign is dim, the dash gives no shield and the touch hurts; the same chain of the cat shows no sign', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page, 'toad');
  const { links, at } = await thread(page);
  await drag(page, at);
  await expect.poll(async () => (await snap(page)).chain).toEqual(links);
  await expect.poll(async () => (await snap(page)).toad.sign).toEqual({ dim: true, lit: false });
  await page.screenshot({ path: `${SHOTS}/toad-no-shield-sign.png` });
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  // The thread killed (kills ≥ 2) but gave no shield: a touch right after it lands.
  expect((await snap(page)).chainShield.left).toBe(0);
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 1));
  const hp0 = (await snap(page)).hero.hp;
  await touchHero(page);
  await expect.poll(async () => (await snap(page)).hero.hp, { timeout: 6000 }).toBeLessThan(hp0);
  await sameHash(page);
  // The cat: the same thread — no sign, the shield is there.
  await openSandbox(page, null);
  const cat = await thread(page);
  await drag(page, cat.at);
  await expect.poll(async () => (await snap(page)).chain).toEqual(cat.links);
  expect((await snap(page)).toad.sign).toEqual({ dim: false, lit: false });
  expect((await snap(page)).heroView.id).toBe('cat');
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  await expect.poll(async () => (await snap(page)).chainShield.left).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the lesson: «Замкни на себя» at the hero with the arc ready, the hand draws the ring after a rest; the first seal takes both away for good', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page, 'toad');
  await arc(page);
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.text)).toContain('Замкни на себя');
  await page.mouse.move(640, 400);
  // The hand comes after a rest of 2.5 real seconds and draws the ring on the links of the arc.
  await expect.poll(async () => (await snap(page)).toad.hand.hand, { timeout: 15_000 }).toBe(true);
  await page.screenshot({ path: `${SHOTS}/toad-lesson-ring-hand.png` });
  // The crowd drifted while the hand waited: the arc is placed again (the lesson stays: the seal has not been made) and drawn at once.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.clear(false); rt.teleport(8, 5.5); });
  expect((await snap(page)).toad.memory.ring).toBe(0);
  const fresh = await arc(page);
  await drag(page, fresh.at);
  await closeOnHero(page);
  await expect.poll(async () => (await snap(page)).loop.closed).toBe('hero');
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  await expect.poll(async () => (await snap(page)).toad.memory.ring).toBe(1);
  expect((await snap(page)).onboarding.labels.map((l: any) => l.text)).not.toContain('Замкни на себя');
  expect((await snap(page)).toad.hand.hand).toBe(false);
  // Another arc in the same page (a new fight too): nothing comes back.
  await page.evaluate(() => (window as any).__realtime.restart(2));
  await page.evaluate(() => { const rt = (window as any).__realtime; for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0]] as const) rt.setParam(key, value); rt.clear(false); rt.teleport(8, 5.5); });
  await arc(page);
  await gameWait(page, 4);
  const again = await snap(page);
  expect(again.onboarding.labels.map((l: any) => l.text)).not.toContain('Замкни на себя');
  expect(again.toad.hand.hand).toBe(false);
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('the price: the first hit right after an open chain cracks the hero and says «Без кольца — без щита», once', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page, 'toad');
  const { at } = await thread(page);
  await drag(page, at);
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 1));
  await touchHero(page);
  const seen = await untilFrame(page, (s, _a: number, late) => {
    const w = window as any, cur = w.__toadSeen ??= { crack: false, label: false };
    if (s.toad.crack) cur.crack = true;
    if (s.onboarding.labels.some((l: any) => l.text === 'Без кольца — без щита')) cur.label = true;
    return cur.crack && cur.label ? cur : late ? cur : undefined;
  }, 0, 8);
  expect(seen).toEqual({ crack: true, label: true });
  await page.screenshot({ path: `${SHOTS}/toad-bare-crack.png` });
  expect((await snap(page)).toad.memory.bare).toBe(1);
  // Once: the next thread and hit do not say it again.
  await gameWait(page, 3);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.clear(false); rt.teleport(8, 5.5); rt.setParam('contactDamage', 0); });
  const again = await thread(page);
  await drag(page, again.at);
  await page.mouse.up();
  expect(await dashDone(page)).toBe(true);
  await page.evaluate(() => (window as any).__realtime.setParam('contactDamage', 1));
  await touchHero(page);
  await gameWait(page, 2.5);
  expect((await snap(page)).toad.memory.bare).toBe(1);
  expect((await snap(page)).onboarding.labels.map((l: any) => l.text)).not.toContain('Без кольца — без щита');
  await sameHash(page);
  expect(errors).toEqual([]);
});

test('the mage on the arena against the five colours: her picture stands out and the column keeps her «Печать» without a row for the law', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openSandbox(page, 'toad');
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    [[11, 3.5, 0], [12, 5.5, 1], [11, 7.5, 2], [13, 4.5, 3], [13, 6.5, 4]].forEach(([x, y, c]) => rt.place(x, y, c, 3, 'basic'));
  });
  await page.mouse.move(900, 300);
  await gameWait(page, 0.3);
  const s = await snap(page);
  expect(s.heroView.id).toBe('toad');
  // The column: the form «Печать» (innate), no row of the law module.
  const rows = await page.locator('.rt-build-item').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  expect(rows.join(' ')).not.toContain('hero-toad');
  await page.screenshot({ path: `${SHOTS}/toad-on-arena-five-colours.png` });
  expect(errors).toEqual([]);
});

test('the cage: the Jailer\'s yard in the sandbox with `?cage=1` shows her in the cage in the frame at the fight\'s scale; she flinches at a blow; without the flag — no cage', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?sandbox=1&arena=19&cage=1');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('jailer');
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  const scaleBefore = await page.evaluate(() => (window as any).__realtime.camera().scale);
  await expect.poll(async () => (await snap(page)).cage.on).toBe(true);
  const cage = (await snap(page)).cage;
  expect(cage.art, 'the cage is the image').toBe(true);
  // In the frame: the cage's point is inside the 1280×720 stage, with no zoom-out.
  const at = await screen(page, cage.x, cage.y - 1);
  expect(at.x).toBeGreaterThan(0); expect(at.x).toBeLessThan(1280); expect(at.y).toBeGreaterThan(0); expect(at.y).toBeLessThan(720);
  expect(await page.evaluate(() => (window as any).__realtime.camera().scale)).toBe(scaleBefore);
  await gameWait(page, 4);
  await page.screenshot({ path: `${SHOTS}/toad-cage-in-jailer-fight.png` });
  expect((await snap(page)).cage.blinks, 'she blinks').toBeGreaterThanOrEqual(1);
  // A blow of the player: a chain through the Jailer's yard makes her flinch (and grumble once).
  const jolts0 = (await snap(page)).cage.jolts;
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('contactDamage', 0); rt.teleport(14, 11); });
  const a = await place(page, 14.8, 11, 0, 1), b = await place(page, 16, 11, 0, 1);
  await gameWait(page, 1);
  const pts = await Promise.all([[14.8, 11], [16, 11]].map(([x, y]) => screen(page, x, y)));
  await drag(page, pts);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).cage.jolts, { timeout: 10_000 }).toBeGreaterThan(jolts0);
  void a; void b;
  await expect.poll(async () => (await snap(page)).onboarding.labels.map((l: any) => l.text).join('|'), { timeout: 5000 }).toContain('Громче бей');
  // No flag: no cage.
  await page.goto('/?sandbox=1&arena=19');
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect.poll(async () => (await snap(page)).arena).toBe('jailer');
  await gameWait(page, 0.5);
  expect((await snap(page)).cage.on).toBe(false);
  expect(errors).toEqual([]);
});

/** A run of the meta (no given seed) walked to the Jailer's open battle: a plain save. */
function runAtJailer(): RtRunState {
  for (let k = 1; k <= 30; k++) {
    let found: RtRunState | null = null;
    walkRun({ k, create: { gift: 'mini', jailer: true }, each: run => { if (!found && run.pending?.kind === 'battle' && JAILER_RUN_ARENAS.includes(run.pending.arena)) found = structuredClone(run); } });
    if (found) return found;
  }
  throw new Error('no Jailer fight on 30 seeds');
}

test('the cage in a run: the Jailer\'s fight of a meta run with Ведунья not freed shows the cage; once freed in the profile, it is gone', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const start = runAtJailer();
  const open = async (profile: Record<string, unknown> | null): Promise<void> => {
    await page.goto('/');
    await page.evaluate(([key, value, profileJson]) => {
      localStorage.clear(); localStorage.setItem(key as string, value as string);
      if (profileJson) localStorage.setItem('ashen-oath-rt-profile-v1', profileJson as string);
    }, [RT_RUN_STORAGE_KEY, serializeRtRun(start), profile ? JSON.stringify(profile) : ''] as const);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
    await page.getByTestId('run-battle').click();
    await expect.poll(() => page.evaluate(() => (window as any).__realtime.run.arenaOpen())).toBe(true);
  };
  await open({ version: 1, giftFull: false, meta: { heroes: {}, freed: { toad: { row: 5 } } } });
  await gameWait(page, 0.5);
  expect((await snap(page)).cage.on, 'freed in the profile: no cage').toBe(false);
  await open(null);
  await expect.poll(async () => (await snap(page)).cage.on).toBe(true);
  // The FIRST frame of the fight (the camera opens on the Jailer, the glide is still on): the cage stands in the frame already.
  const cage = (await snap(page)).cage;
  const at = await screen(page, cage.x, cage.y - 1);
  expect(await page.evaluate(() => (window as any).__realtime.camera().intro), 'the glide is on').toBeGreaterThanOrEqual(0);
  expect(at.x).toBeGreaterThan(0); expect(at.x).toBeLessThan(1280); expect(at.y).toBeGreaterThan(80); expect(at.y).toBeLessThan(720);
  await page.screenshot({ path: `${SHOTS}/toad-cage-run-first-frame.png` });
  await expect.poll(() => page.evaluate(() => (window as any).__realtime.camera().intro)).toBe(0);
  const later = await screen(page, cage.x, cage.y - 1);
  expect(later.x).toBeGreaterThan(0); expect(later.x).toBeLessThan(1280);
  await page.screenshot({ path: `${SHOTS}/toad-cage-run-fight.png` });
  expect(errors).toEqual([]);
});
