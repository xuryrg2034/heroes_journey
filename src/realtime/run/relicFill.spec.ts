/**
 * Task 51 (design 17.10.2026, docs/design-notes/task-51-camp-l3.md, section 17): one rule for every relic screen of a run — the places the
 * relics (and oaths) left empty take a rare talisman each by the screen's own draw (`rtFillRares`), the ones shown out of the pool. Since
 * task 38 (710b7f4) the forest final's relic showed 1–2 of 3 and «Караульня» 0–1 (the relics and oaths spent by the Jailer's screen and the
 * screens before). A new run with the garrison keeps the flag `relicFill`; a save without it plays the screens of before. The Jailer's
 * screen is not touched. Node only: `npm run test:realtime-relic-fill`. Whole runs walked by the run's own commands (metaWalk.testkit.ts):
 * - the forest final's relic on both branches (the den's — the Troll's 1 of 3 and, with its three parts severed, 1 of 4) and «Караульня»
 *   show their full places: the relics (oaths) the pool still had first, then rares; without the flag — as before (the Troll's 1 of 4 filled
 *   as before);
 * - the same by the seed; the saves round-trip; the filled screen rerolls (a free reroll of «Правка в гарнизоне»).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { walkRun, type WalkOptions } from './metaWalk.testkit';
import { parseRtRun, rtLevelSlots, rtNode, rtOathSlots, rtRerollTalismans, rtRerollView, serializeRtRun, type RtArenaOutcome, type RtRunState } from './rtRun';
import { rtTalisman } from './rtTalismans';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
type Screen = { run: RtRunState; options: string[]; slots: number };
let rares = 0, addedAll = 0;

/**
 * The relic screens of a walk: the forest final's (`level`) and «Караульня»'s (the garrison's oath screen). `branch` — the walk steers to
 * that branch of the forest; `parts` — the final's won fight severed the Troll's three parts (its outcome as the view hands it).
 */
function screens(k: number, create: Record<string, unknown>, branch: 'den' | 'camp', parts = false): { level: Screen | null; guardroom: Screen | null } {
  let level: Screen | null = null, guardroom: Screen | null = null;
  const fight: WalkOptions['fight'] = run => {
    const p = run.pending;
    if (!parts || p?.kind !== 'battle' || rtNode(run, p.nodeId)?.type !== 'boss' || p.nodeId.startsWith('g:')) return null;
    const outcome: RtArenaOutcome = { nodeId: p.nodeId, won: true, hp: run.maxHp, kills: 30, damage: 0, time: 90, parts: 3 };
    return outcome;
  };
  walkRun({ k, create: { gift: 'full', garrison: true, ...create }, fight,
    pickNode: (_run, ids) => ids.find(id => id.startsWith(`${branch}-`)) ?? null,
    each: r => {
      const p = r.pending;
      if (p?.kind !== 'talisman') return;
      if (!level && p.source === 'level') level = { run: r, options: [...p.options], slots: rtLevelSlots(r, p.nodeId) };
      if (!guardroom && p.source === 'oath' && p.nodeId.startsWith('g:')) guardroom = { run: r, options: [...p.options], slots: rtOathSlots(r, p.nodeId) };
    } });
  return { level, guardroom };
}
/** The filled screen: full, the screen of before first, then rares; the same by the seed; the save round-trips. */
function filledLike(on: Screen, off: Screen, what: string): number {
  assert(on.options.length === on.slots, `${what}: full places (${on.options.length} of ${on.slots})`);
  // The filled places are the rare place's draw of a hard battle: a rare talisman — a lower rarity once the rares are spent (the draw falls
  // through, as «Застава»'s rare place); never a relic or an oath.
  const added = on.options.slice(off.options.length);
  assert(same(on.options.slice(0, off.options.length), off.options) && added.every(id => !['relic', 'oath'].includes(rtTalisman(id)?.rarity ?? 'relic')), `${what}: before ${off.options}, now ${on.options}`);
  rares += added.filter(id => rtTalisman(id)?.rarity === 'rare').length; addedAll += added.length;
  assert(new Set(on.options).size === on.options.length && same(parseRtRun(serializeRtRun(on.run)), on.run), `${what}: no repeat; the save`);
  return on.options.length - off.options.length;
}

check('the forest final\'s relic on both branches and «Караульня»: full places with the flag (the pool\'s first, then rares); without — as before; 30 seeds each', () => {
  const counts: Record<string, { screens: number; filled: number }> = {};
  const add = (key: string, n: number) => { const c = counts[key] ??= { screens: 0, filled: 0 }; c.screens++; if (n > 0) c.filled++; };
  for (const branch of ['den', 'camp'] as const) for (let k = 1; k <= 30; k++) {
    const on = screens(k, {}, branch), off = screens(k, { relicFill: false }, branch);
    assert(!!on.level === !!off.level && !!on.guardroom === !!off.guardroom, `${branch} ${k}: the same walk`);
    assert(on.level?.run.relicFill === true && off.level?.run.relicFill === undefined, 'the flag');
    if (on.level && off.level) add(`final ${branch}`, filledLike(on.level, off.level, `${branch} ${k} final`));
    if (on.guardroom && off.guardroom) add('Караульня', filledLike(on.guardroom, off.guardroom, `${branch} ${k} Караульня`));
    assert(same(screens(k, {}, branch).level?.options, on.level?.options), `${branch} ${k}: the same by the seed`);
  }
  for (const key of ['final den', 'final camp', 'Караульня']) assert(counts[key].screens >= 25 && counts[key].filled >= counts[key].screens / 2, `${key}: ${JSON.stringify(counts[key])}`);
  assert(rares >= addedAll / 2, `mostly rares: ${rares} of ${addedAll}`);
  console.log(`  (filled: ${Object.entries(counts).map(([key, c]) => `${key} ${c.filled} of ${c.screens}`).join('; ')}; places added ${addedAll}, rare ${rares})`);
});

check('the Troll\'s 1 of 4 (three parts severed): full with the flag and without it (as before); 1 of 3 without the parts: full with the flag only', () => {
  let four = 0;
  for (let k = 1; k <= 20; k++) {
    const on = screens(k, {}, 'den', true).level, off = screens(k, { relicFill: false }, 'den', true).level;
    if (!on || !off) continue;
    assert(on.slots === 4 && off.slots === 4 && same(on.options, off.options) && on.options.length === 4, `seed ${k}: the Troll's 1 of 4 full either way (${on.options} / ${off.options})`);
    const three = screens(k, {}, 'den').level, plain = screens(k, { relicFill: false }, 'den').level;
    assert(three!.slots === 3 && three!.options.length === 3 && plain!.options.length <= 3, `seed ${k}: 1 of 3`);
    four++;
  }
  assert(four >= 15, `Troll fights ${four}`);
});

check('the filled «Караульня» rerolls: «Правка в гарнизоне» draws other rares (before it: «Других талисманов не осталось»)', () => {
  let rerolled = 0;
  for (let k = 1; k <= 12 && rerolled < 3; k++) {
    const flags = { garrisonRerolls: 1 }, on = screens(k, { locked: [], hearth: flags }, 'camp').guardroom, off = screens(k, { locked: [], hearth: flags, relicFill: false }, 'camp').guardroom;
    if (!on || !off) continue;
    assert(!rtRerollView(off.run)!.available, `seed ${k}: before — nothing to reroll`);
    const view = rtRerollView(on.run)!;
    assert(view.free && view.available, `seed ${k}: free and available`);
    const step = rtRerollTalismans(on.run);
    assert(step.ok && (step.run.pending as { options: string[] }).options.length >= 1 && same(parseRtRun(serializeRtRun(step.run)), step.run), `seed ${k}: rerolled`);
    rerolled++;
  }
  assert(rerolled >= 3, `rerolled ${rerolled}`);
});

console.log(`relic fill: ${checks} checks passed`);
