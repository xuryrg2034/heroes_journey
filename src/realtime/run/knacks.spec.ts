/**
 * Task 50 «Сноровка» и «Повадка» in the run (docs/design-notes/task-50-levels-archetype.md, sections 3, 4, 8 and 11; docs/realtime-slice.md,
 * section 8). Node only: `npm run test:realtime-knacks-run`.
 *
 * Every check walks real runs by the run's own commands (metaWalk.testkit.ts: enter, the arena fed back, every screen chosen), saving and
 * reading back every state on the way:
 * - without the flags the run is the run of before (the flags are absent, the default constants off);
 * - the knack screen stands after an ordinary fight and a breakthrough from run row 2 (the garrison's too), never after «Застава», the
 *   Jailer, «Караульня», an event's fight, a final; a walk refusing every knack is the walk without the flag, state for state;
 * - the cards: one to rank II and one new (or two of a kind), the node's own roll, no rare new one, nothing gone or locked; rank II goes
 *   into the loadout; nothing refused leaves the pool; the feat's screen comes after the knack's;
 * - the archetype: «Без повадки» is the run without the flag; an archetype weighs the offers towards its tag (summed over 40 seeds), most
 *   screens still show an untagged card, two archetypes differ on some screens; the Jailer's form screen holds the tagged form in place 1
 *   (through the camp's reroll too);
 * - a save of every case «похода нет» reads as no run; the telemetry's fields, `checkRecord` and the report's sections.
 */
import { walkRun, ok, seedOf, type Walk, type WalkOptions } from './metaWalk.testkit';
import {
  createRtRun, parseRtRun, rtArenaLoadout, rtFusionsReady, rtRestFuse, rtChooseGift, rtChooseHabit, rtFormPool, rtFusionOwed, rtGiftView, rtHabitForm, rtHabitKept, rtKnackNode, rtKnackOptions,
  rtNode, serializeRtRun, RT_HABITS_ON, RT_KNACK_ROW, RT_KNACKS_ON, type RtRunState,
} from './rtRun';
import { runRow } from './arenaPools';
import { RT_COUNTER_TALISMANS, RT_HABITS, rtTalisman, rtWeightedIndex, type RtHabitId } from './rtTalismans';
import { fusionOfHalf, fusionRecipe } from '../sim/buildIds';
import { kitOf } from '../sim/kit';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { copyParams, defaultParams } from '../sim/params';
import type { Journal } from '../sim/simulation';
import { checkRecord, type RunRecord } from '../telemetry/schema';
import { choicesSection, habitsSection, knacksSection } from '../telemetry/report';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

const COUNTERS = RT_COUNTER_TALISMANS.map(def => def.id);
const tags = (id: string): readonly string[] => rtTalisman(id)?.tags ?? [];
/** Every state reads back from its save as it is. */
const readsBack = (state: RtRunState, label: string): void => { assert(serializeRtRun(parseRtRun(serializeRtRun(state))!) === serializeRtRun(state), `${label}: the save reads back`); };
// Task 50: a walk is of a run without the knack screen unless its `create` says `knacks: true` (RT_KNACKS_ON turned on at the view's step, 16.10.2026).
const walk = (k: number, create: WalkOptions['create'], extra: Partial<WalkOptions> = {}): Walk => walkRun({ k, create: { knacks: false, ...create }, ...extra });
/** The run's state without the task-50 fields (to compare with a run without the flags). */
const plain = (run: RtRunState): string => { const copy = structuredClone(run) as Partial<RtRunState>; delete copy.knacks; delete copy.honed; delete copy.habits; delete copy.habit; return JSON.stringify(copy); };
/** The states of a walk without the task-50 fields, the knack screens left out, a repeat of the same state (the archetype's step) once. */
function plainStates(k: number, create: WalkOptions['create'], extra: Partial<WalkOptions> = {}): string[] {
  const out: string[] = [];
  walk(k, create, { ...extra, each: state => { if (state.pending?.kind === 'knack') return; const s = plain(state); if (out[out.length - 1] !== s) out.push(s); } });
  return out;
}

// ---- Flags ----

await check('the flags: a new run takes them from the constants (`knacks` on since the view of step 3, 16.10.2026), only with the forms, the archetype only with the gift `full`; a run with them off is the run of before', () => {
  assert(typeof RT_KNACKS_ON === 'boolean' && typeof RT_HABITS_ON === 'boolean', 'the constants are flags');
  for (let k = 1; k <= 8; k++) {
    const seed = seedOf(k), base = createRtRun(seed, { gift: 'full', knacks: false, habits: false });
    assert(!('knacks' in base) && !('habits' in base) && !('honed' in base) && !('habit' in base), `seed ${k}: no fields with the flags off`);
    assert(('knacks' in createRtRun(seed, { gift: 'full' })) === RT_KNACKS_ON, `seed ${k}: the constant decides the default`);
    assert(serializeRtRun(createRtRun(seed, { gift: 'full', knacks: false, habits: false })) === serializeRtRun(base), `seed ${k}: off — byte for byte`);
    const on = createRtRun(seed, { gift: 'full', knacks: true, habits: true });
    assert(on.knacks === true && on.habits === true, 'on with the forms');
    assert(!createRtRun(seed, { gift: 'full', knacks: true, habits: true, forms: false }).knacks && !createRtRun(seed, { gift: 'full', habits: true, forms: false }).habits, 'never without the forms');
    assert(!createRtRun(seed, { gift: 'mini', habits: true }).habits && !createRtRun(seed, { habits: true }).habits, 'the archetype only with the gift `full`');
    readsBack(on, `seed ${k}`);
  }
});

// ---- Where the knack screen stands ----

await check('the knack screen: after an ordinary fight and a breakthrough from run row 2 (the garrison\'s too), never after row 1, «Застава», the Jailer, «Караульня», an event\'s fight, a final (16 seeds)', () => {
  let screens = 0, garrison = 0, breakthrough = 0, owed = 0;
  for (let k = 1; k <= 16; k++) {
    const shown = new Set<string>();
    let previous: RtRunState | null = null;
    const result = walk(k, { gift: k % 2 ? 'full' : 'mini', garrison: k % 2 === 0, knacks: true }, { each: state => {
      readsBack(state, `seed ${k}`);
      if (state.pending?.kind === 'knack') {
        const node = rtNode(state, state.pending.nodeId)!;
        assert((node.type === 'battle' || node.type === 'breakthrough') && runRow(node.row) >= RT_KNACK_ROW, `seed ${k}: a knack after ${node.type} of row ${runRow(node.row)}`);
        assert(previous?.pending?.kind === 'battle' && previous.pending.nodeId === node.id, `seed ${k}: right after the fight was fed back`);
        shown.add(node.id); screens++;
        if (node.id.startsWith('g:')) garrison++;
        if (node.type === 'breakthrough') breakthrough++;
      }
      previous = state;
    } });
    // Every ordinary fight and breakthrough of row 2+ the run won had its screen (the counters' pool is never empty here).
    for (const record of result.run.battles) {
      const node = rtNode(result.run, record.nodeId)!;
      if (!record.won || !rtKnackNode(result.run, node)) continue;
      owed++;
      assert(shown.has(node.id), `seed ${k}: no knack after ${node.type} ${node.id}`);
    }
  }
  assert(screens === owed && screens > 40 && garrison > 0 && breakthrough > 0, `screens ${screens} of ${owed}, garrison ${garrison}, breakthrough ${breakthrough}`);
});

await check('a walk that refuses every knack is the walk without the flag, state for state — the other screens and the streams\' counters are the same (40 seeds, forest and garrison)', () => {
  for (let k = 1; k <= 40; k++) {
    const create = { gift: k % 2 ? 'full' as const : 'mini' as const, garrison: k % 3 === 0, knacks: false, ...k % 4 === 0 ? { feats: true } : {} };
    const off = plainStates(k, create), on = plainStates(k, { ...create, knacks: true }, { knack: () => null });
    assert(on.length === off.length && on.every((s, i) => s === off[i]), `seed ${k}: ${on.length} states with the screens refused, ${off.length} without (first difference at ${on.findIndex((s, i) => s !== off[i])})`);
  }
});

// ---- The cards ----

await check('the cards: rank II of a counter held on rank I and a new common or uncommon one of the pool (two of a kind when one side is empty); the node\'s own roll; different across seeds', () => {
  const firsts = new Set<string>();
  let both = 0, hones = 0, news = 0;
  for (let k = 1; k <= 30; k++) {
    let first: string | null = null;
    walk(k, { gift: k % 2 ? 'full' : 'mini', knacks: true }, { each: state => {
      if (state.pending?.kind !== 'knack') return;
      const options = state.pending.options;
      first ??= JSON.stringify(options);
      assert(JSON.stringify(rtKnackOptions(state, state.pending.nodeId)) === JSON.stringify(options), `seed ${k}: the cards are the node's roll`);
      assert(options.length >= 1 && options.length <= 2 && new Set(options.map(o => `${o.id}${o.hone ? ':2' : ''}`)).size === options.length, `seed ${k}: 1–2 different cards`);
      const held = COUNTERS.filter(id => state.talismans.includes(id) && !state.honed?.includes(id));
      const pool = RT_COUNTER_TALISMANS.filter(d => d.rarity !== 'rare' && !state.talismans.includes(d.id) && !state.talismansGone.includes(d.id)).length;
      for (const o of options) {
        assert(COUNTERS.includes(o.id), `seed ${k}: ${o.id} is a counter`);
        if (o.hone) { hones++; assert(held.includes(o.id), `seed ${k}: rank II of a counter held on rank I (${o.id})`); }
        else { news++; assert(rtTalisman(o.id)!.rarity !== 'rare' && !state.talismans.includes(o.id) && !state.talismansGone.includes(o.id), `seed ${k}: a new common or uncommon one of the pool (${o.id})`); }
      }
      if (held.length && pool) { assert(options[0].hone && !options[1]?.hone, `seed ${k}: one of each`); both++; }
    } });
    if (first) firsts.add(first);
  }
  assert(firsts.size > 10 && both > 20 && hones > 0 && news > 0, `first screens ${firsts.size} distinct, one of each ${both}, rank II cards ${hones}, new ${news}`);
});

await check('a meta run\'s locked counters never come; the rare ones («Длинная рука», «Иней на клинке») are never new here', () => {
  const locked = ['prism', 'shockwave', 'third-chain'];
  let screens = 0;
  for (let k = 1; k <= 20; k++) {
    walk(k, { gift: 'mini', knacks: true, locked }, { each: state => {
      if (state.pending?.kind !== 'knack') return;
      screens++;
      for (const o of state.pending.options) assert(!locked.includes(o.id) && (o.hone || !['long-arm', 'frost-edge'].includes(o.id)), `seed ${k}: ${JSON.stringify(o)}`);
    } });
  }
  assert(screens > 20, `screens ${screens}`);
});

await check('taking: rank II joins `honed` and the loadout (the kit names it), never offered again; a new counter joins the run; a refusal leaves the pool as it was; the guarantee of a pair is not spent', () => {
  let honedSeen = 0, fresh = 0, refused = 0, fused = 0;
  for (let k = 1; k <= 30; k++) {
    walk(k, { gift: k % 2 ? 'full' : 'mini', knacks: true }, { knack: (_run, options) => options[k % 3 === 0 ? 1 : 0] ?? options[0], onStep: (before, step) => {
      if (before.pending?.kind !== 'knack') return;
      const after = step.run, chosen = step.events.find(e => e.type === 'knack-chosen');
      assert(chosen?.type === 'knack-chosen', 'the event');
      assert(JSON.stringify(after.fusionShown ?? []) === JSON.stringify(before.fusionShown ?? []), `seed ${k}: no guarantee spent by the knack screen`);
      assert(JSON.stringify(after.talismansGone) === JSON.stringify(before.talismansGone), `seed ${k}: nothing refused leaves the pool`);
      const option = chosen.option;
      if (option?.hone) {
        honedSeen++;
        assert(after.honed?.at(-1) === option.id && !before.honed?.includes(option.id), 'rank II joins honed');
        assert(JSON.stringify(after.talismans) === JSON.stringify(before.talismans), 'the talismans stay');
      } else if (option) { fresh++; assert(after.talismans.includes(option.id) && !before.talismans.includes(option.id), 'a new counter joins'); }
      else refused++;
    }, each: state => {
      if (!state.honed) return;
      if (state.pending?.kind === 'knack') assert(!state.pending.options.some(o => o.hone && state.honed!.includes(o.id)), `seed ${k}: rank II never twice`);
      if (state.pending?.kind === 'battle') {
        const loadout = rtArenaLoadout(state);
        assert(JSON.stringify(loadout.honed) === JSON.stringify(state.honed) && JSON.stringify(kitOf(loadout).honed) === JSON.stringify(state.honed), `seed ${k}: the loadout and the kit name rank II`);
      }
      // A part of a fusion keeps its rank (`honed` is not touched by the rest).
      for (const id of state.honed) if (!state.talismans.includes(id)) { const of = fusionOfHalf(id); assert(of && state.talismans.includes(of.fusion), `seed ${k}: ${id} on rank II is held or fused`); fused++; }
    } });
  }
  assert(honedSeen > 10 && fresh > 10, `rank II ${honedSeen}, new ${fresh}, refused ${refused}, fused parts seen ${fused}`);
  console.log(`  rank II ${honedSeen}, new ${fresh}, states with a fused part on rank II ${fused}`);
});

await check('the order of a node\'s screens: the knack, then the feat\'s talisman screen', () => {
  let after = 0;
  for (let k = 1; k <= 40 && after < 3; k++) {
    walk(k, { gift: 'mini', knacks: true, feats: true }, { onStep: (before, step) => {
      if (before.pending?.kind === 'knack' && step.run.pending?.kind === 'talisman' && step.run.pending.source === 'feat') { after++; assert(step.run.pending.nodeId === before.pending.nodeId, 'the same node'); }
      if (before.pending?.kind === 'battle' && step.run.pending?.kind === 'talisman' && step.run.pending.source === 'feat') assert(!rtKnackNode(step.run, rtNode(step.run, before.pending.nodeId)!), `seed ${k}: the feat before the knack`);
    } });
  }
  assert(after >= 3, `feat screens after the knack: ${after}`);
});

await check('a part keeps its rank in the fusion: the rest fuses a counter on rank II — `honed` stays, the save reads, the loadout names it, the kit expands the fusion with the part on rank II', () => {
  let fused = 0;
  for (let k = 1; k <= 200 && fused < 3; k++) {
    let rest: RtRunState | null = null;
    walk(k, { gift: 'mini', knacks: true }, { knack: (_run, options) => options.find(o => o.hone && fusionOfHalf(o.id)) ?? options.find(o => !o.hone && fusionOfHalf(o.id)) ?? options[0], each: s => {
      if (!rest && s.pending?.kind === 'rest' && s.honed && rtFusionsReady(s).some(f => s.honed!.includes(fusionRecipe(f)!.counter))) rest = s;
    } });
    if (!rest) continue;
    const at: RtRunState = rest, fusion = rtFusionsReady(at).find(f => at.honed!.includes(fusionRecipe(f)!.counter))!, part = fusionRecipe(fusion)!.counter;
    const after = ok(rtRestFuse(at, fusion), 'fuse');
    assert(JSON.stringify(after.honed) === JSON.stringify(at.honed) && !after.talismans.includes(part) && after.talismans.includes(fusion), `seed ${k}: ${part} stays on rank II inside ${fusion}`);
    readsBack(after, `seed ${k}`);
    const kit = kitOf({ talismans: after.talismans, honed: after.honed });
    assert(kit.talismans.includes(part) && kit.honed?.includes(part), `seed ${k}: the kit holds the part on rank II`);
    fused++;
  }
  assert(fused >= 3, `fusions of a part on rank II: ${fused}`);
});

// ---- Saves ----

await check('saves: every case «похода нет» of the design (3.4) reads as no run; the controls read', () => {
  let state: RtRunState | null = null;
  for (let k = 1; k <= 20 && !state; k++) walk(k, { gift: 'mini', knacks: true }, { knack: (_run, options) => options.find(o => o.hone) ?? null, each: s => { if (!state && s.honed && s.pending?.kind === 'knack') state = s; } });
  assert(state, 'a knack screen of a run with rank II');
  const run: RtRunState = state;
  readsBack(run, 'control');
  const bad = (value: unknown, what: string) => assert(parseRtRun(JSON.stringify(value)) === null, `${what} — no run`);
  const pending = run.pending as Extract<RtRunState['pending'], { kind: 'knack' }>;
  bad({ ...run, knacks: undefined }, 'honed without knacks');
  bad({ ...run, forms: undefined, fusions: undefined }, 'knacks without forms');
  bad({ ...run, knacks: 1 }, 'knacks: 1');
  bad({ ...run, honed: ['whetstone'] }, 'a non-counter on rank II');
  bad({ ...run, honed: [COUNTERS.find(id => !run.talismans.includes(id) && !fusionOfHalf(id))] }, 'a counter on rank II not held');
  bad({ ...run, honed: [...run.honed!, run.honed![0]] }, 'a repeat');
  bad({ ...run, honed: [] }, 'an empty list');
  bad({ ...run, pending: { ...pending, options: [...pending.options].reverse().concat(pending.options.length === 1 ? [{ id: 'prism' }] : []) } }, 'the cards not of the node\'s roll');
  bad({ ...run, pending: { ...pending, extra: 1 } }, 'an unknown key');
  const noRank = { ...run, honed: undefined };
  bad({ ...noRank, knacks: undefined }, 'a knack screen in a run without the flag');
  assert(parseRtRun(JSON.stringify({ ...run, honed: undefined, pending: { ...pending, options: rtKnackOptions({ ...run, honed: undefined } as RtRunState, pending.nodeId) } })), 'control: no rank II yet, its own cards');
});

// ---- «Повадка» ----

await check('«Без повадки» is the run without the flag, state for state (30 seeds of the gift `full`); the field leaves with the gift', () => {
  for (let k = 1; k <= 60; k += 2) {
    const create = { gift: 'full' as const, garrison: k % 3 === 0 };
    const off = plainStates(k, create), on = plainStates(k, { ...create, habits: true }, { habit: null });
    assert(on.length === off.length && on.every((s, i) => s === off[i]), `seed ${k}: ${on.length} / ${off.length} states (first difference at ${on.findIndex((s, i) => s !== off[i])})`);
    const end = walk(k, { ...create, habits: true }, { habit: null }).run;
    assert(end.habits === true && !('habit' in end), `seed ${k}: «Без повадки» leaves no field`);
  }
});

await check('the archetype row: before the gift\'s buttons, once; the gift\'s buttons are the same; the archetype stays to the end', () => {
  for (let k = 1; k <= 10; k++) {
    const run = createRtRun(seedOf(k), { gift: 'full', habits: true }), view = rtGiftView(run)!;
    assert(view.habit && !view.habit.chosen, 'the row is open');
    assert(!rtChooseGift(run, view.options.findIndex(o => o.available)).ok, 'a button before the archetype is refused');
    const chosen = ok(rtChooseHabit(run, 'cold'), 'habit');
    assert(!rtChooseHabit(chosen, 'flame').ok, 'once');
    const flagless = createRtRun(seedOf(k), { gift: 'full' });
    assert(JSON.stringify(rtGiftView(chosen)!.options) === JSON.stringify(rtGiftView(flagless)!.options), 'the buttons are the same');
    const end = walk(k, { gift: 'full', habits: true, garrison: true }, { habit: 'shift' }).run;
    assert(end.habit === 'shift', 'to the end of the run');
  }
});

await check('the weight (40 seeds × 4): the offers lean to the archetype\'s tag (the sum over seeds); most screens still show an untagged card; two archetypes differ on some screens; without one — `value mod n`', () => {
  // The weighed pick: without a habit the index of before.
  for (let v = 0; v < 500; v++) assert(rtWeightedIndex(v * 2654435761 >>> 0, ['a', 'b', 'c', 'd']) === (v * 2654435761 >>> 0) % 4, 'no habit — value mod n');
  // The talisman screens and the merchant's talisman (`talismanPool`'s draws) apart from the knack screen's new cards (its own roll).
  const screensOf = (k: number, habit: RtHabitId | null, knack = false): string[][] => {
    const out: string[][] = [];
    walk(k, { gift: 'full', habits: true, knacks: true, garrison: k % 2 === 0 }, { habit, each: s => {
      const p = s.pending;
      if (knack) { if (p?.kind === 'knack') out.push(p.options.filter(o => !o.hone).map(o => o.id)); return; }
      if (p?.kind === 'talisman' && p.source !== 'form') out.push([...p.options]);
      else if (p?.kind === 'shop' && p.stock.talisman && !p.stock.pair) out.push([p.stock.talisman]);
    } });
    return out;
  };
  const base = Array.from({ length: 40 }, (_, i) => screensOf(i + 1, null));
  let differ = 0, compared = 0;
  for (const habit of RT_HABITS.map(h => h.id)) {
    let withTag = 0, withAll = 0, noneTag = 0, noneAll = 0, untagged = 0, multi = 0;
    for (let k = 1; k <= 40; k++) {
      const screens = screensOf(k, habit);
      for (const s of screens) { withAll += s.length; withTag += s.filter(id => tags(id).includes(habit)).length; if (s.length >= 2) { multi++; if (s.some(id => !tags(id).includes(habit))) untagged++; } }
      for (const s of base[k - 1]) { noneAll += s.length; noneTag += s.filter(id => tags(id).includes(habit)).length; }
      if (habit !== 'cold') {
        const cold = screensOf(k, 'cold');
        compared++;
        if (JSON.stringify(cold[0]) !== JSON.stringify(screens[0]) || JSON.stringify(cold) !== JSON.stringify(screens)) differ++;
      }
    }
    const share = withTag / withAll, before = noneTag / noneAll;
    assert(share > before, `${habit}: tagged ${(share * 100).toFixed(1)} % of the offers, without an archetype ${(before * 100).toFixed(1)} %`);
    assert(untagged > multi / 2, `${habit}: ${untagged} of ${multi} screens show an untagged card`);
    // The knack screen's new cards lean the same way (its own roll, weighed).
    let kTag = 0, kAll = 0, kNoneTag = 0, kNoneAll = 0;
    for (let k = 1; k <= 40; k++) {
      for (const s of screensOf(k, habit, true)) { kAll += s.length; kTag += s.filter(id => tags(id).includes(habit)).length; }
      for (const s of screensOf(k, null, true)) { kNoneAll += s.length; kNoneTag += s.filter(id => tags(id).includes(habit)).length; }
    }
    // «Стужа» has no counter a knack may bring new («Иней на клинке» is rare): its cards are untagged either way.
    if (habit !== 'cold') assert(kTag / kAll > kNoneTag / kNoneAll, `${habit}: the knack's new cards tagged ${kTag}/${kAll}, without ${kNoneTag}/${kNoneAll}`);
    console.log(`  ${habit}: tagged ${(share * 100).toFixed(1)} % (without ${(before * 100).toFixed(1)} %), untagged card on ${untagged} of ${multi} screens`);
  }
  assert(differ > 0, `two archetypes differ on some runs (${differ} of ${compared})`);
});

await check('the Jailer\'s form screen: place 1 — a form of the archetype\'s tag when the pool has one and the draw showed none; a pair keeps the last place; the camp\'s reroll keeps the form in place 1', () => {
  let forced = 0, rerolled = 0, screens = 0, pairs = 0;
  for (let k = 1; k <= 40; k++) {
    for (const habit of RT_HABITS.map(h => h.id)) {
      const meta = k % 3 === 0;
      let before: RtRunState | null = null;
      walk(k, { gift: 'full', habits: true, ...meta ? { locked: [], hearth: { jailerRerolls: 1 } } : {} }, { habit, jailerReroll: meta ? 'form' : undefined, each: s => {
        const p = s.pending;
        if (p?.kind === 'talisman' && p.source === 'form') {
          screens++;
          const tagged = rtFormPool(s).filter(id => tags(id).includes(habit)), form = rtHabitForm(s, p.nodeId);
          if (tagged.length) assert(p.options.some(id => tagged.includes(id)), `seed ${k} ${habit}: a tagged form on the screen (${p.options})`);
          if (form) { forced++; assert(p.options[0] === form, `seed ${k} ${habit}: place 1 holds ${form} (${p.options})`); }
          const owed = rtFusionOwed(s).map(o => o.partner), pair = p.options.findIndex(id => owed.includes(id));
          // The guarantee's pair takes the last place; in place 1 only when it is the archetype's form itself (the pair then stands by it).
          if (form && pair === 0) assert(p.options[0] === form, `seed ${k}: place 1 is the archetype's form`);
          if (form && pair > 0) { pairs++; assert(pair === p.options.length - 1 || !rtFusionOwed(s).some(o => o.partner === p.options[p.options.length - 1]), `seed ${k}: the pair in the last place (${p.options})`); }
          assert(new Set(p.options).size === p.options.length, `seed ${k}: distinct forms`);
          const prev = before?.pending;
          if (prev?.kind === 'talisman' && prev.source === 'form' && p.rerolls && !prev.rerolls) {
            rerolled++;
            const kept = rtHabitKept(before!, prev.nodeId);
            if (kept) assert(prev.options.includes(kept) && p.options[0] === kept, `seed ${k}: the reroll keeps the archetype's form in place 1 (${prev.options} → ${p.options})`);
          }
        }
        before = s;
      } });
    }
  }
  assert(forced > 10 && screens > 100 && rerolled > 0, `screens ${screens}, place 1 forced ${forced}, rerolled ${rerolled}`);
  console.log(`  form screens ${screens}, place 1 forced ${forced}, with a pair beside it ${pairs}, rerolled ${rerolled}`);
});

await check('a save of the open gift with «Без повадки» (`habit: null`) loads as the state right after the choice: the same state, view and actions (12 seeds)', () => {
  for (let k = 1; k <= 12; k++) {
    const after = ok(rtChooseHabit(createRtRun(seedOf(k), { gift: 'full', habits: true }), null), 'none'), loaded = parseRtRun(serializeRtRun(after));
    assert(loaded && serializeRtRun(loaded) === serializeRtRun(after) && loaded.habit === null, `seed ${k}: the same state`);
    assert(JSON.stringify(rtGiftView(loaded)) === JSON.stringify(rtGiftView(after)) && rtGiftView(loaded)!.habit?.chosen === true, `seed ${k}: the same view, the archetype decided`);
    assert(!rtChooseHabit(loaded, 'cold').ok && !rtChooseHabit(after, 'cold').ok, `seed ${k}: no second choice`);
    const view = rtGiftView(after)!, at = view.options.find(o => o.available)?.index ?? null;
    const a = rtChooseGift(after, at), b = rtChooseGift(loaded, at);
    assert(a.ok && b.ok && serializeRtRun(a.run) === serializeRtRun(b.run) && JSON.stringify(a.events) === JSON.stringify(b.events), `seed ${k}: the gift's button gives the same step`);
  }
});

await check('saves of the archetype: every malformed case reads as no run; the open gift with «Без повадки» reads', () => {
  const run = createRtRun(seedOf(3), { gift: 'full', habits: true });
  const none = ok(rtChooseHabit(run, null), 'none'), cold = ok(rtChooseHabit(run, 'cold'), 'cold');
  for (const s of [run, none, cold]) readsBack(s, 'the open gift');
  const bad = (value: unknown, what: string) => assert(parseRtRun(JSON.stringify(value)) === null, `${what} — no run`);
  bad({ ...cold, habits: undefined }, 'an archetype without the flag');
  bad({ ...cold, habit: 'wind' }, 'an unknown archetype');
  bad({ ...cold, forms: undefined, fusions: undefined }, 'the flag without the forms');
  bad({ ...createRtRun(seedOf(3), { gift: 'mini' }), habits: true }, 'the flag with the gift `mini`');
  bad({ ...run, gift: { ...run.gift!, chosen: 0 } }, 'a gift button before the archetype');
  const end = walk(3, { gift: 'full', habits: true }, { habit: 'flame' }).run;
  readsBack(end, 'the end');
  bad({ ...end, habit: null }, '«Без повадки» kept after the gift');
});

// ---- Telemetry ----

await check('telemetry: `knacksOn`, `knacks`, `honed`, `habitsOn`, `habit` of the run record; `checkRecord` takes them and refuses malformed ones; the report\'s sections count them', async () => {
  const fake = (): KeyValueStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
  };
  const sessionFake = (): SessionStore => { const map = new Map<string, string>(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }; };
  const records: RunRecord[] = [];
  for (let k = 1; k <= 6; k++) {
    const local = fake();
    const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: copyParams(defaultParams() as unknown as Journal['params']), local, sessionStore: sessionFake(), channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
    let started = false, screens = 0, honed = 0;
    walk(k, { gift: 'full', knacks: true, habits: true }, { habit: k % 5 === 0 ? null : RT_HABITS[k % 4].id, knack: (_run, options) => options[k % 2] ?? null, onStep: (before, step) => {
      if (!started) { rec.runStarted(null, before); started = true; }
      if (before.pending?.kind === 'knack') screens++;
      if (step.events.some(e => e.type === 'talisman-honed')) honed++;
      rec.runStep(before, step, { realSeconds: 2 + k });
    } });
    await new Promise(r => setTimeout(r, 10));
    const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run').pop()!;
    assert(record.knacksOn === true && record.habitsOn === true && (record.knacks?.length ?? 0) === screens && (record.honed?.length ?? 0) === honed, `seed ${k}: ${screens} screens, ${honed} rank II (${JSON.stringify(record.knacks?.slice(0, 2))})`);
    assert(record.knacks!.every(s => s.row >= RT_KNACK_ROW && s.offered.length && s.realSeconds === 2 + k), `seed ${k}: rows and seconds`);
    assert(k % 5 === 0 ? record.habit === undefined : record.habit === RT_HABITS[k % 4].id, `seed ${k}: the archetype ${record.habit}`);
    assert(record.choices.some(c => c.source === 'knack'), 'the knack screen is a choice');
    assert(checkRecord(record) === null, `seed ${k}: checkRecord ${checkRecord(record)}`);
    assert(checkRecord({ ...record, knacks: [{ nodeId: 'x', row: 'a' }] } as unknown as RunRecord) === 'run knacks' && checkRecord({ ...record, habitsOn: undefined }) === 'run habit' || record.habit === undefined, 'malformed ones refused');
    records.push(record);
  }
  const knack = knacksSection(records), habit = habitsSection(records), choices = choicesSection(records);
  assert(/Походов со «Сноровкой»: 6/.test(knack) && /«Ранг II» \d+/.test(knack) && /медиана/.test(knack), knack);
  assert(RT_HABITS.every(h => habit.includes(h.name)) && habit.includes('Без повадки'), habit);
  assert(/Выборов сборки за поход/.test(choices), choices);
});

console.log(`realtime-knacks-run: ${checks} checks passed`);
