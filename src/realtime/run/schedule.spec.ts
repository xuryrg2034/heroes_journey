/**
 * Task 26 «Расписание леса» (design 15.10.2026; docs/realtime-slice.md, «Расписание леса»; run/schedule.ts): a run with the
 * viewer's history — what the player meets, read from REAL short fights played on the run's own arenas and from the run's own
 * commands: at most one new living element a fight over the first three runs of a new viewer, the first elite, the forest's
 * outputs untouched, a run without the schedule playing the arenas of before (a reference made on main before the task), the
 * variety of practice fights over seeds with the same choice for the same seed, the saves, the loadout rules, the simulation's
 * two rules (`affixMetKinds`, the wolf and boar out by `withoutKinds`) and the viewer's history in the profile.
 * `npm run test:realtime-schedule`.
 */
import { defaultParams, type Params } from '../sim/params';
import { replay, Simulation } from '../sim/simulation';
import { AFFIX_IDS } from '../sim/elites';
import { arenaKinds } from './arenaKinds';
import { runRow } from './arenaPools';
import { RtDeathWatch } from './rtRunEnd';
import { createRtProfileStore, type RunStorage } from './rtRunStorage';
import {
  arenaSeed, createRtRun, parseRtRun, resolveArena, RT_FIRST_ELITE_KINDS, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtEnterNode, rtFightArc, rtNode, rtRunParams, rtScheduleMet,
  serializeRtRun, type RtArenaOutcome, type RtRunState,
} from './rtRun';
import { affixElement, allowedAffixes, BUST_ARC, SCHEDULE_ELEMENTS, SCHEDULE_HARD_FLOOR, SCHEDULE_KINDS, scheduleKindCap, scheduleSeedHistory } from './schedule';
import { cardRules } from '../view/nodeCard';
import { arenaPreview, isArenaNode } from './rtRun';
import { assert, closeNode, ok, same, seedOf, takeGift } from './runFight.testkit';
import { SCHEDULE_REFERENCE as reference } from './schedule.reference';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const TICKS = (s: number): number => Math.round(s * 60);
/** Every living element but the affix types: a viewer who has met the whole forest. */
const VETERAN = [...SCHEDULE_ELEMENTS, ...AFFIX_IDS.map(affixElement)];

/** Newcomers come, nothing hurts the hero (what stands on the arena is counted, not fought). */
function harmless(): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.porcupineQuills = 0; p.lynxDamage = 0;
  return p;
}
type Battle = Extract<RtRunState['pending'], { kind: 'battle' }>;
/**
 * A short real fight of the open battle (`seconds` of game time) on its own arena, roster and loadout: what stood on the arena
 * is read as the view reads it (`RtDeathWatch` before every tick) — the kinds, an elite, the affixes; the elites seen are kept.
 * The outcome is a victory with the run's HP (the run layer does not judge the fight).
 */
function shortFight(run: RtRunState, seconds: number): { outcome: RtArenaOutcome; sim: Simulation; elites: Map<number, { kind: string; plates: number; affixes: string[] }> } {
  const pending = run.pending as Battle, watch = new RtDeathWatch(), elites = new Map<number, { kind: string; plates: number; affixes: string[] }>();
  const sim = new Simulation({ arena: pending.arena, params: rtArenaParams(run, rtRunParams(harmless())), seed: pending.seed, record: true, loadout: rtArenaLoadout(run),
    ...pending.roster !== undefined ? { roster: pending.roster } : {}, beforeTick: w => watch.seen(w) });
  for (let t = 0; t < TICKS(seconds); t++) {
    sim.tick();
    for (const e of sim.world.enemies) if (e.elite && !elites.has(e.id)) elites.set(e.id, { kind: e.kind, plates: e.armor?.max ?? 0, affixes: [...e.affixes ?? []] });
    sim.world.events.length = 0;
  }
  const w = sim.world;
  return { outcome: { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: w.time, kinds: watch.kinds(w), ...watch.elite(w) ? { elite: true } : {}, ...watch.affixes(w).length ? { affixes: watch.affixes(w) } : {} }, sim, elites };
}
/** The next node: a battle two steps in three when one is open, else by `k` and the step. */
function enterNext(run: RtRunState, k: number, step: number): RtRunState {
  const next = rtAvailableNodes(run), battle = next.find(node => node.type === 'battle');
  return ok(rtEnterNode(run, (step % 3 && battle ? battle : next[(k + step) % next.length]).id), 'enter');
}
/** A fight as the test saw it: its arc, the living elements new to the viewer (the bag apart; an affix type is not one — `types`), the elites. */
interface Seen { run: number; row: number; arena: string; arc: string | null; fresh: string[]; types: string[]; elites: { kind: string; plates: number; affixes: string[] }[]; metBefore: Set<string>; allowed?: string[] }

/** A viewer's `runs` runs from `history`, every fight a short real fight; the history after each run is the profile's (`rtScheduleMet`). */
function viewer(k: number, runs: number, seconds: number, history: string[] = []): Seen[] {
  const out: Seen[] = [];
  for (let r = 1; r <= runs; r++) {
    let run = createRtRun(seedOf(1000 * k + r), { gift: 'mini', schedule: history });
    for (let step = 0; step < 300 && !run.result; step++) {
      const pending = run.pending;
      if (pending?.kind === 'battle') {
        const node = rtNode(run, pending.nodeId)!, metBefore = rtScheduleMet(run), arc = rtFightArc(run), kit = rtArenaLoadout(run);
        const fight = shortFight(run, seconds);
        assert(replay(JSON.parse(JSON.stringify(fight.sim.exportJournal()!))).hash() === fight.sim.hash(), `viewer ${k} run ${r}: the fight replays`);
        run = ok(resolveArena(run, fight.outcome), 'resolve');
        const seen = run.battles.at(-1)!.seen ?? [];
        out.push({ run: r, row: runRow(node.row), arena: pending.arena, arc, fresh: seen.filter(id => !metBefore.has(id) && id !== 'bag' && !id.startsWith('affix:')), types: seen.filter(id => !metBefore.has(id) && id.startsWith('affix:')), elites: [...fight.elites.values()], metBefore, ...kit.affixKinds ? { allowed: kit.affixKinds } : {} });
      } else if (pending) run = closeNode(run);
      else run = enterNext(run, k, step);
    }
    history = [...rtScheduleMet(run)].sort();
  }
  return out;
}

check('a new viewer (empty history), 3 runs each, real short fights (4 viewers): every fight brings at most one new living element (the bag apart, variant E) — its arc; the first elite comes in the elite arc fight, of a met kind with an elite behaviour (or basic), 2 plates, no affix; no elite before it; an affix type is new in a fight at most once', () => {
  let fights = 0, arcs = 0, firstElites = 0;
  const met: number[] = [];
  for (let k = 1; k <= 4; k++) {
    const seen = viewer(k, 3, 15);
    let eliteMet = false;
    for (const f of seen) {
      fights++;
      const where = `viewer ${k} run ${f.run} row ${f.row} ${f.arena} (arc ${f.arc}): new ${f.fresh}`;
      // The final «Последний рубеж» may bring its braziers and its pond unmet (a short route; design 15.10.2026 — see the docs).
      assert(f.fresh.length <= 1 || (f.arena === 'last-stand' && f.fresh.every(id => id === 'brazier' || id === 'water')), where);
      assert(f.types.length <= 1, `${where}: new affix types ${f.types}`);
      if (f.arc) { arcs++; assert(f.fresh.length === 0 || f.fresh.every(id => id === f.arc) || f.arc === BUST_ARC, `${where}: not the arc's own`); }
      if (!eliteMet) assert(f.elites.length === 0 || f.arc === 'elite', `${where}: an elite before the elite arc ${JSON.stringify(f.elites)}`);
      if (f.arc === 'elite' && f.elites.length) {
        firstElites++;
        const first = f.elites[0], kinds = RT_FIRST_ELITE_KINDS.filter(kind => kind === 'basic' || f.metBefore.has(kind));
        assert(kinds.includes(first.kind) && first.plates === 2 && first.affixes.length === 0, `${where}: the first elite ${JSON.stringify(first)} (allowed ${kinds})`);
      }
      if (f.elites.length) eliteMet = true;
      if (f.allowed) assert(f.allowed.filter(id => !f.metBefore.has(affixElement(id))).length <= 1, `${where}: affix types allowed ${f.allowed}`);
    }
    met.push(new Set(seen.flatMap(f => f.fresh)).size);
  }
  assert(firstElites >= 2, `the first elite seen in ${firstElites} viewers`);
  console.log(`   ${fights} fights, ${arcs} with an arc; new living elements met over 3 runs by viewer: ${met.join(', ')} (heuristic, 15.10.2026)`);
});

/** A walk of `run` by the run's own commands, every fight won at once with the kinds its arena brings (no simulation). */
function quickWalk(run: RtRunState, k: number, each?: (run: RtRunState) => void): RtRunState {
  for (let step = 0; step < 300 && !run.result; step++) {
    each?.(run);
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      const kit = rtArenaLoadout(run), kinds = [...arenaKinds(pending.arena, pending.roster)].filter(kind => !(kit.withoutKinds ?? []).includes(kind));
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.maxHp, kills: 30, damage: 0, time: 60, kinds, ...kit.guaranteedElite ? { elite: true } : {} }), 'resolve');
    } else if (pending) run = closeNode(run);
    else run = ok(rtEnterNode(run, rtAvailableNodes(run)[(k * 7 + step) % rtAvailableNodes(run).length].id), 'enter');
  }
  return run;
}

check('the forest\'s outputs (300 seeds, the run\'s own commands): a run with the schedule has the map, the visited nodes, the events, the event choices, the gift and the stream counters of a run without it', () => {
  for (let k = 1; k <= 300; k++) {
    const plain = quickWalk(createRtRun(seedOf(k), { gift: 'mini' }), k), scheduled = quickWalk(createRtRun(seedOf(k), { gift: 'mini', schedule: k % 2 ? [] : VETERAN }), k);
    assert(scheduled.schedule && !plain.schedule, `seed ${k}: the flag`);
    for (const [what, a, b] of [['map', plain.map, scheduled.map], ['visited', plain.visited, scheduled.visited], ['events', plain.picks.map(p => p.eventId ?? null), scheduled.picks.map(p => p.eventId ?? null)],
      ['event choices', plain.eventChoices, scheduled.eventChoices], ['gift', plain.gift, scheduled.gift], ['streams', plain.streams, scheduled.streams]] as const)
      assert(same(a, b), `seed ${k}: ${what} differ`);
  }
});

check('a run without the schedule (40 runs, the walk of the reference): the arenas and rosters of every node are those of main before the task (reference made 15.10.2026 on 9c43931); every step saves and reads back the same', () => {
  for (let k = 1; k <= 40; k++) {
    let run = createRtRun(seedOf(k), { gift: 'mini' });
    for (let step = 0; step < 300 && !run.result; step++) {
      const pending = run.pending;
      if (!pending) { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, next[(k * 7 + step) % next.length].id), 'enter'); }
      else if (pending.kind === 'gift') run = takeGift(run);
      else if (pending.kind === 'battle') run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.maxHp, kills: 30, damage: 0, time: 60, kinds: [...arenaKinds(pending.arena, pending.roster)] }), 'resolve');
      else run = closeNode(run);
      assert(same(parseRtRun(serializeRtRun(run)), run), `seed ${k} step ${step}: the save reads back`);
    }
    const picks = run.picks.filter(p => p.arena).map(p => `${p.nodeId}:${p.arena}${p.roster ? `[${p.roster}]` : ''}`);
    assert(same(picks, reference[k]), `seed ${k}: ${picks.join(' ')} vs ${reference[k].join(' ')}`);
  }
});

check('variety and repeat (a veteran: everything met — every fight a practice fight): over 24 seeds the second fight takes at least 4 arenas; the same seed gives the same arenas, rosters and arcs; no arena of the last two fights again while another fits', () => {
  const second = new Set<string>();
  for (let k = 1; k <= 24; k++) {
    const walk = (): RtRunState => quickWalk(createRtRun(seedOf(k + 500), { gift: 'mini', schedule: VETERAN }), k);
    const a = walk(), b = walk();
    assert(same(a.picks, b.picks), `seed ${k}: the same seed, other picks`);
    const arenas = a.picks.filter(p => p.arena).map(p => p.arena!);
    if (arenas[1]) second.add(arenas[1]);
    assert(a.picks.every(p => p.arc === undefined), `seed ${k}: a veteran got an arc ${a.picks.map(p => p.arc)}`);
    for (let i = 2; i < arenas.length; i++) if (!['outpost', 'last-stand'].includes(arenas[i])) assert(!arenas.slice(i - 2, i).includes(arenas[i]), `seed ${k}: ${arenas[i]} again after ${arenas.slice(i - 2, i)}`);
  }
  assert(second.size >= 4, `the second fight: ${[...second]}`);
  console.log(`   the second fight of a veteran over 24 seeds: ${[...second].sort().join(', ')}`);
});

check('the save of a scheduled run reads back; a changed arena, arc, snapshot or record is no run; «Испытание II» never has a schedule', () => {
  let run = quickWalk(createRtRun(seedOf(77), { gift: 'mini', schedule: [] }), 3, r => {
    assert(same(parseRtRun(serializeRtRun(r)), r), 'the save reads back');
  });
  assert(run.result && run.battles.every(b => Array.isArray(b.seen)), 'every record has what it showed');
  run = createRtRun(seedOf(78), { gift: 'mini', schedule: [] });
  for (let step = 0; step < 300 && !(run.pending?.kind === 'battle' && run.battles.length >= 3); step++) run = run.pending ? (run.pending.kind === 'battle' ? ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.maxHp, kills: 30, damage: 0, time: 60, kinds: [] }), 'resolve') : closeNode(run)) : enterNext(run, 1, step);
  const text = serializeRtRun(run), saved = JSON.parse(text);
  assert(parseRtRun(text), 'the open battle reads');
  const broken = (change: (value: any) => void): boolean => { const copy = structuredClone(saved); change(copy); return parseRtRun(JSON.stringify(copy)) === null; };
  const open = saved.picks.findIndex((p: { nodeId: string }) => p.nodeId === saved.pending.nodeId);
  assert(broken(v => { v.picks[open].arena = v.picks[open].arena === 'glade' ? 'p-yard' : 'glade'; v.pending.arena = v.picks[open].arena; }), 'another arena');
  assert(broken(v => { v.picks[open].arc = 'horde'; }), 'another arc');
  assert(broken(v => { v.schedule.seen = ['wolf']; }), 'another snapshot');
  assert(broken(v => { v.schedule.seen = ['dragon']; }), 'an unknown element');
  assert(broken(v => { v.battles[0].seen = ['wolf', 'wolf']; }), 'a record with a repeat');
  assert(broken(v => { v.ash = 2; }), '«Испытание II» with a schedule');
  assert(!createRtRun(seedOf(79), { ash: 2, schedule: [] }).schedule && !!createRtRun(seedOf(79), { ash: 1, schedule: [] }).schedule, 'the schedule below II only');
  assert(!createRtRun(seedOf(79)).schedule, 'no history — no schedule');
});

/** A scheduled run (history `seen`) walked until a battle of run row `row` of one of `types` is open; null — not on this seed. */
function openOn(k: number, seen: readonly string[], test: (run: RtRunState) => boolean): RtRunState | null {
  let run = createRtRun(seedOf(k), { gift: 'mini', schedule: seen });
  for (let step = 0; step < 300 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      if (test(run)) return run;
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.maxHp, kills: 30, damage: 0, time: 60, kinds: [] }), 'resolve');
    } else if (pending) run = closeNode(run);
    else run = enterNext(run, k, step);
  }
  return null;
}
const rowOf = (run: RtRunState): number => runRow(rtNode(run, (run.pending as Battle).nodeId)!.row);

check('the loadout of a scheduled fight: a veteran — rows 6–8 plates 4 and tough HP 4, row 9 — 4 and 4, elites of every met kind, the affixes among the met types; the hard node — floor ×1,25 (and a guaranteed elite on its stand-in); a new viewer — no elite, no affix, unmet kinds taken out', () => {
  for (const [rows, plates, tough] of [[[6, 7, 8], 4, 4], [[9], 4, 4]] as const) {
    let found = 0;
    for (let k = 1; k <= 30 && found < 3; k++) {
      const run = openOn(k, VETERAN, r => (rows as readonly number[]).includes(rowOf(r)) && (r.pending as Battle).battle === 'battle');
      if (!run) continue;
      const kit = rtArenaLoadout(run);
      assert(kit.elitePlates === plates && kit.toughHp === tough, `seed ${k} row ${rowOf(run)}: plates ${kit.elitePlates}, tough ${kit.toughHp}`);
      assert(same(kit.eliteKinds, ['basic', ...SCHEDULE_KINDS]) && !kit.withoutKinds, `seed ${k}: elite kinds ${kit.eliteKinds}, without ${kit.withoutKinds}`);
      if (kit.eliteAffixes) assert(same(kit.affixKinds, [...AFFIX_IDS]), `seed ${k}: affix types ${kit.affixKinds}`);
      found++;
    }
    assert(found >= 1, `rows ${rows}: no battle`);
  }
  const hardOf = (seen: readonly string[]): RtRunState | null => { for (let k = 1; k <= 40; k++) { const run = openOn(k, seen, r => (r.pending as Battle).battle === 'hard'); if (run) return run; } return null; };
  const hard = hardOf(VETERAN);
  assert(hard && (hard.pending as Battle).arena === 'outpost' && rtArenaLoadout(hard).floorScale === SCHEDULE_HARD_FLOOR, `the hard node of a veteran: ${hard && (hard.pending as Battle).arena} ×${hard && rtArenaLoadout(hard).floorScale}`);
  const stand = hardOf(['wolf']);
  assert(stand && (stand.pending as Battle).arena !== 'outpost' && rtArenaLoadout(stand).floorScale === SCHEDULE_HARD_FLOOR, `a stand-in for «Застава»: ${stand && (stand.pending as Battle).arena}`);
  const fresh = openOn(9, [], () => true)!, kit = rtArenaLoadout(fresh);
  assert(!kit.guaranteedElite && !kit.randomElites && !kit.eliteAffixes, `a new viewer's first fight: ${JSON.stringify({ g: kit.guaranteedElite, r: kit.randomElites, a: kit.eliteAffixes })}`);
  assert((fresh.pending as Battle).arena === 'glade' && same(kit.withoutKinds ?? [], ['wolf', 'boar'].filter(kind => arenaKinds('glade').has(kind)).sort((a, b) => SCHEDULE_KINDS.indexOf(a) - SCHEDULE_KINDS.indexOf(b))), `the first fight: ${(fresh.pending as Battle).arena}, without ${kit.withoutKinds}`);
});

check('card = fight and В-1 (new viewers and veterans, 60 runs, the run\'s own commands): the card of every available arena node (its preview) and of every open battle has the elite and enemy rules of the fight\'s loadout; no ordinary fight has more special kinds standing than the row\'s cap (2 on rows 1–5, 3 on 6–9)', () => {
  let cards = 0, fights = 0;
  for (let k = 1; k <= 60; k++) {
    quickWalk(createRtRun(seedOf(k + 3000), { gift: 'mini', schedule: k % 2 ? [] : VETERAN }), k, run => {
      const pending = run.pending;
      if (pending?.kind === 'battle') {
        const node = rtNode(run, pending.nodeId)!, kit = rtArenaLoadout(run), rules = cardRules(run, node);
        const want = { guaranteedElite: !!kit.guaranteedElite, randomElites: !!kit.randomElites, elitePlates: kit.elitePlates, eliteAffixes: kit.eliteAffixes ?? 0, eliteKinds: kit.eliteKinds, withoutKinds: kit.withoutKinds };
        const got = { guaranteedElite: rules.guaranteedElite, randomElites: rules.randomElites, elitePlates: rules.elitePlates, eliteAffixes: rules.eliteAffixes, eliteKinds: rules.eliteKinds, withoutKinds: rules.withoutKinds };
        assert(same(want, got), `seed ${k} ${pending.arena}: fight ${JSON.stringify(want)} / card ${JSON.stringify(got)}`);
        cards++;
        if (pending.battle === 'battle' || pending.battle === 'event') {
          const standing = [...arenaKinds(pending.arena, pending.roster)].filter(kind => SCHEDULE_KINDS.includes(kind) && !(kit.withoutKinds ?? []).includes(kind));
          assert(standing.length <= scheduleKindCap(rowOf(run)), `seed ${k} row ${rowOf(run)} ${pending.arena}[${pending.roster}]: ${standing}`);
          fights++;
        }
      } else if (!pending) for (const node of rtAvailableNodes(run).filter(isArenaNode)) {
        const pick = arenaPreview(run, node);
        if (!pick) continue;
        const preview = structuredClone(run);
        preview.picks.push({ nodeId: node.id, arena: pick.arena, ...pick.roster !== undefined ? { roster: pick.roster } : {}, ...pick.arc !== undefined ? { arc: pick.arc } : {} });
        preview.pending = { kind: 'battle', nodeId: node.id, arena: pick.arena, seed: arenaSeed(run, node.id), battle: node.type === 'boss' ? 'final' : node.type === 'hard' ? 'hard' : 'battle', ...pick.roster !== undefined ? { roster: pick.roster } : {} };
        const kit = rtArenaLoadout(preview), rules = cardRules(run, node);
        assert(rules.elitePlates === kit.elitePlates && rules.eliteAffixes === (kit.eliteAffixes ?? 0) && rules.guaranteedElite === !!kit.guaranteedElite && same(rules.withoutKinds, kit.withoutKinds), `seed ${k} preview ${node.id} ${pick.arena}`);
        cards++;
      }
    });
  }
  console.log(`   ${cards} cards against their fights, ${fights} ordinary fights under the cap`);
});

check('the simulation: with `affixMetKinds` an elite draws only the kit\'s affix types; without the key — any type (as before); `withoutKinds` with the wolf and the boar — no wolf on «Поляна» with the roster «Волки» and no boar with «Натиск» in 60 s (without the list: some)', () => {
  const kinds = (loadout: object, seconds: number, params: Partial<Params> = {}, roster?: string): { kinds: Set<string>; affixes: Set<string> } => {
    const sim = new Simulation({ arena: 'glade', ...roster ? { roster } : {}, params: { ...rtRunParams(harmless()), ...params }, seed: seedOf(3), loadout: { items: { frost: 0, bomb: 0, healing: 0, fire: 0 }, energy: 0, openItems: [], ...loadout } });
    const out = { kinds: new Set<string>(), affixes: new Set<string>() };
    for (let t = 0; t < TICKS(seconds); t++) { sim.tick(); for (const e of sim.world.enemies) { out.kinds.add(e.kind); for (const a of e.affixes ?? []) out.affixes.add(a); } sim.world.events.length = 0; }
    return out;
  };
  const only = kinds({ randomElites: true, guaranteedElite: true, eliteAffixes: 2, affixKinds: ['fat'] }, 60);
  assert(only.affixes.size > 0 && [...only.affixes].every(a => a === 'fat'), `with the key: ${[...only.affixes]}`);
  const any = kinds({ randomElites: true, guaranteedElite: true, eliteAffixes: 2, affixKinds: ['fat'] }, 60, { affixMetKinds: false });
  assert([...any.affixes].some(a => a !== 'fat'), `without the key: ${[...any.affixes]}`);
  for (const [roster, kind] of [['wolves', 'wolf'], ['onslaught', 'boar']] as const) {
    const plain = kinds({}, 60, {}, roster), gone = kinds({ withoutKinds: ['wolf', 'boar'] }, 60, {}, roster);
    assert(plain.kinds.has(kind), `«Поляна» with «${roster}» brings the ${kind}: ${[...plain.kinds]}`);
    assert(!gone.kinds.has('wolf') && !gone.kinds.has('boar'), `«${roster}» without them: ${[...gone.kinds]}`);
  }
});

check('the viewer\'s history (profile): the first read starts from the older memory and keeps it; a fight adds; «Обучение» empties it and the older memory is not read again; the history of the view\'s stores', () => {
  const data = new Map<string, string>(), storage: RunStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
  const profile = createRtProfileStore(storage);
  assert(same(profile.scheduleHistory(() => ['wolf', 'elite', 'dragon']), ['elite', 'wolf']), 'seeded from the older memory');
  assert(same(profile.scheduleHistory(() => ['boar']), ['elite', 'wolf']), 'read once');
  profile.meetSchedule(['cliff', 'wolf'], 5);
  assert(same(profile.scheduleHistory(() => []), ['cliff', 'elite', 'wolf']), 'a fight adds');
  profile.resetSchedule(5);
  profile.meetSchedule(['boar'], 5);
  assert(same(profile.load().seen, []), 'the run open at «Обучение» goes on but feeds nothing');
  assert(same(profile.scheduleHistory(() => ['boar']), []) && profile.load().seenMute === undefined, '«Обучение» empties it for good; the next run\'s snapshot lifts the mute');
  profile.meetSchedule(['boar'], 6);
  assert(same(profile.load().seen, ['boar']), 'the next run feeds it');
  assert(same(scheduleSeedHistory(['basic', 'wolf', 'lynx'], ['fat'], ['elite', 'goblin-bust', 'bag', 'feat']), ['affix', 'affix:fat', 'bag', 'bust', 'elite', 'lynx', 'wolf']), 'the view\'s stores');
  assert(same(allowedAffixes(new Set(), 1).length, 1) && same(allowedAffixes(new Set(VETERAN), 1), [...AFFIX_IDS]), 'one new affix type at most');
});

console.log(`schedule: ${checks} checks passed`);
