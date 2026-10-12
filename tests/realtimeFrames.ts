import type { Page } from '@playwright/test';

/**
 * Waits measured in game time and read frame by frame inside the page (de-flake of 12.10.2026, docs/realtime-slice.md,
 * section 13). Not a spec file: the realtime config's `testMatch` does not pick it up.
 *
 * The browser tests drive the real game through real input; the page advances the world from its own animation frames
 * (main.ts: whole fixed ticks, a long frame clamped to 0.05 s). Under load the frames get long, so game time runs slower
 * than the wall clock, and a poll from Node (`expect.poll`, 100–1000 ms apart, plus the round trip) can miss a short window
 * (a 0.5 s tremble, a 1 s windup) or time out before the world got there. These helpers run the probe in the page once per
 * animation frame (`waitForFunction`, polling `raf`) and bound the wait by game seconds, not by wall time.
 */

/**
 * A probe run in the page every frame: `snap` is `window.__realtime.snapshot()` of this frame, `rt` is `window.__realtime`.
 * `undefined` — keep waiting; anything else ends the wait.
 */
export type Probe<A, T> = (snap: any, arg: A, late: boolean, rt: any) => T | undefined;

/**
 * Runs `probe` in the page every animation frame until it returns something other than `undefined`, or until `gameSeconds`
 * of game time (`snapshot().time`) have passed — then it runs once more with `late` true and must return its reading, which
 * the test asserts on (so a miss fails with the real value, not with a timeout). The probe must be self-contained (it is
 * sent to the page as source) and its argument and result JSON values.
 */
export async function untilFrame<A, T>(page: Page, probe: Probe<A, T>, arg: A, gameSeconds: number): Promise<T> {
  const token = `${Date.now()}:${Math.random()}`;
  const handle = await page.waitForFunction(({ token, source, arg, gameSeconds }) => {
    const rt = (window as any).__realtime, snap = rt.snapshot();
    const state = (window as any).__untilFrame ??= { token: '', deadline: 0, probe: null };
    if (state.token !== token) { state.token = token; state.deadline = snap.time + gameSeconds; state.probe = new Function(`return (${source})`)(); }
    const late = snap.time > state.deadline, value = state.probe(snap, arg, late, rt);
    if (value === undefined && !late) return false;
    return { value };
  }, { token, source: probe.toString(), arg, gameSeconds }, { polling: 'raf', timeout: 0 });
  return ((await handle.jsonValue()) as { value: T }).value;
}

/** Lets `seconds` of game time pass (read in the page every frame); returns the game time reached. */
export const gameWait = async (page: Page, seconds: number): Promise<number> => {
  const t0 = await page.evaluate(() => (window as any).__realtime.snapshot().time as number);
  return untilFrame(page, (snap, until: number) => snap.time >= until ? snap.time as number : undefined, t0 + seconds, seconds + 60);
};
