/**
 * Task 51 (design 17.10.2026, docs/design-notes/task-51-camp-l3.md, section 17): «Караульня»'s oath and relic screen filled. Since task 38
 * (710b7f4) the oaths and relics were spent by the Jailer's screen and the forest final's relic before the garrison: the screen showed 0–1.
 * A run with the flag `guardroomFill` fills the empty places with a rare talisman each by the same draw (as the Troll's 1 of 4). Node only:
 * `npm run test:realtime-guardroom`. Whole runs walked by the run's own commands (metaWalk.testkit.ts), 30 seeds:
 * - with the flag the screen shows its full places (3), the oaths and relics the pool still had first, then rares; without — as before;
 * - the same by the seed; the saves round-trip; the screen rerolls now (a free reroll of «Правка в гарнизоне»).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { walkRun } from './metaWalk.testkit';
import { parseRtRun, rtOathSlots, rtRerollTalismans, rtRerollView, serializeRtRun, type RtRunState } from './rtRun';
import { rtTalisman } from './rtTalismans';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The first «Караульня» screen of a walk (the garrison's oath screen). */
function guardroom(k: number, create: Record<string, unknown>): RtRunState | null {
  let at: RtRunState | null = null;
  walkRun({ k, create: { gift: 'full', garrison: true, ...create }, each: r => { const p = r.pending; if (!at && p?.kind === 'talisman' && p.source === 'oath' && p.nodeId.startsWith('g:')) at = r; } });
  return at;
}

check('«Караульня» with the flag shows its full places (the pool\'s oaths and relics first, then rares); without the flag — the screen of before; 30 seeds', () => {
  let screens = 0, filled = 0;
  for (let k = 1; k <= 30; k++) {
    const on = guardroom(k, {}), off = guardroom(k, { guardroomFill: false });
    if (!on || !off) { assert(!on && !off, `seed ${k}: the same walk to «Караульня»`); continue; }
    screens++;
    assert(on.guardroomFill === true && off.guardroomFill === undefined, 'the flag');
    const a = (on.pending as { options: string[] }).options, b = (off.pending as { options: string[] }).options;
    assert(a.length === rtOathSlots(on, on.pending!.kind === 'talisman' ? on.pending.nodeId : ''), `seed ${k}: full places (${a.length})`);
    assert(same(a.slice(0, b.length), b) && a.slice(b.length).every(id => rtTalisman(id)?.rarity === 'rare'), `seed ${k}: before ${b}, now ${a}`);
    if (a.length > b.length) filled++;
    assert(same(guardroom(k, {})?.pending, on.pending) && same(parseRtRun(serializeRtRun(on)), on) && same(parseRtRun(serializeRtRun(off)), off), `seed ${k}: the same by the seed; saves`);
  }
  assert(screens >= 25 && filled >= screens - 2, `screens ${screens}, filled ${filled}`);
});

check('the filled screen rerolls: «Правка в гарнизоне» draws other rares (before it: «Других талисманов не осталось»)', () => {
  let rerolled = 0;
  for (let k = 1; k <= 12 && rerolled < 3; k++) {
    const flags = { garrisonRerolls: 1 }, on = guardroom(k, { locked: [], hearth: flags }), off = guardroom(k, { locked: [], hearth: flags, guardroomFill: false });
    if (!on || !off) continue;
    assert(!rtRerollView(off)!.available, `seed ${k}: before — nothing to reroll`);
    const view = rtRerollView(on)!;
    assert(view.free && view.available, `seed ${k}: free and available`);
    const step = rtRerollTalismans(on);
    assert(step.ok && (step.run.pending as { options: string[] }).options.length >= 1 && same(parseRtRun(serializeRtRun(step.run)), step.run), `seed ${k}: rerolled`);
    rerolled++;
  }
  assert(rerolled >= 3, `rerolled ${rerolled}`);
});

console.log(`guardroom: ${checks} checks passed`);
