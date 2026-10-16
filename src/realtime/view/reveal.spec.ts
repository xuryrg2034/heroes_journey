/**
 * Task 47 (view/reveal.ts): the tier of a reward chord (С5), the reveal of the choice cards (С6) and the run-end lines (С8).
 * Node only: `npx tsx src/realtime/view/reveal.spec.ts`. The screens themselves (a click skips, the chord sounds) are
 * tests/realtime-juice2-screens.spec.ts.
 */
import { END_STEP, REVEAL_FADE, REVEAL_TOTAL, cardTier, endShown, endTotal, revealDelays, revealDone, revealShown, screenTier } from './reveal';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

check('С5: tier by rarity — common/uncommon 0, rare/relic/oath/hammer 1, form 2, unknown 0', () => {
  assert(cardTier('common') === 0 && cardTier('uncommon') === 0 && cardTier(undefined) === 0, 'plain');
  assert(cardTier('rare') === 1 && cardTier('relic') === 1 && cardTier('oath') === 1 && cardTier('hammer') === 1, 'rare');
  assert(cardTier('form') === 2, 'form');
});

check('С5: a screen takes the tier of its best card; an empty screen is 0', () => {
  assert(screenTier(['common', 'uncommon', 'common']) === 0, 'plain screen');
  assert(screenTier(['common', 'rare', 'common']) === 1, 'one rare lifts it');
  assert(screenTier(['rare', 'form', 'common']) === 2, 'a form is the top');
  assert(screenTier([]) === 0, 'empty');
});

check('С6: cards show one by one inside 0.4–0.6 s; the last fade ends at the total', () => {
  assert(REVEAL_TOTAL >= 0.4 && REVEAL_TOTAL <= 0.6, 'total in the design range');
  for (const n of [2, 3, 4, 5]) {
    const d = revealDelays(n);
    assert(d.length === n && d[0] === 0, `first at once, n=${n}`);
    for (let i = 1; i < n; i++) assert(d[i] > d[i - 1], `strictly later, n=${n} i=${i}`);
    assert(Math.abs(d[n - 1] + REVEAL_FADE - REVEAL_TOTAL) < 1e-9, `ends at the total, n=${n}`);
    assert(revealShown(n, 0) === 1 && revealShown(n, REVEAL_TOTAL) === n, `1 → all, n=${n}`);
    assert(!revealDone(n, REVEAL_TOTAL - 0.01) && revealDone(n, REVEAL_TOTAL), `done at the total, n=${n}`);
  }
});

check('С6: one card or none — nothing to reveal', () => {
  assert(revealDelays(1).length === 0 && revealDelays(0).length === 0, 'no delays');
  assert(revealDone(1, 0) && revealShown(1, 0) === 1 && revealShown(0, 0) === 0, 'shown at once');
});

check('С8: the lines come 0.15 s apart, the first at once, never beyond the count', () => {
  assert(END_STEP === 0.15, 'step');
  assert(endShown(8, 0) === 1 && endShown(8, 0.149) === 1 && endShown(8, 0.15) === 2, 'steps');
  assert(endShown(8, 99) === 8 && endShown(0, 1) === 0, 'clamped');
  let last = 0;
  for (let t = 0; t < 3; t += 0.01) { const s = endShown(8, t); assert(s >= last, `monotone at ${t}`); last = s; }
  assert(endShown(8, endTotal(8)) === 8, 'all shown at the total');
  assert(endTotal(0) === 0, 'empty');
});
