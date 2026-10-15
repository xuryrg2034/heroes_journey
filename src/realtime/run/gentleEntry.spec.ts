/**
 * Task 17 «Пологий вход» (design 13.10.2026; docs/realtime-slice.md, section 7, «Пологий вход»): a run with the flag
 * `gentleEntry` and a run without it (a save before the task) — what the player meets, read from real fights played by
 * journal commands and from the run's own commands: elites from row 4, an affix, 3 plates and tough HP 3 from row 6,
 * «Колючие заросли» on rows 7–8 (final design decision 13.10.2026: one novelty per row — 4, 6, 7, 9), the row's invulnerability after a hit and the raised tough touch from row 3, a healing potion
 * at the start with the first elite loot opening another kind, the second wind once on rows 1–4; the saves; the run's params
 * do not depend on the sandbox panel.
 */
import { arenaTemplate, registerArena, type ArenaTemplate } from '../sim/arenas';
import { withoutKinds } from '../sim/rosters';
import { worldState } from '../sim/hash';
import { defaultParams, type Params } from '../sim/params';
import { replay, Simulation } from '../sim/simulation';
import { SLOT_ITEMS, type Loadout } from '../sim/kit';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { SECOND_WIND_HP, SECOND_WIND_INVULNERABLE } from '../sim/world';
import { arenaCandidates, arenaNewKinds, runArenaPools, runRow } from './arenaPools';
import { RtDeathWatch } from './rtRunEnd';
import { PROLOGUE_ROOMS } from './prologue';
import { RT_TASK17_OFF, rtMetKinds,
  createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtChooseGift, rtChooseGiftPick, rtGiftView, rtArenaParams, rtArenaRules, rtAvailableNodes, rtEnterNode, rtMapNodes, rtNode, rtPageParams,
  rtRunParams, serializeRtRun, type RtArenaOutcome, type RtBattleKind, type RtRunState,
} from './rtRun';
import { assert, closeNode, ok, outcomeOf, quiet, same, seedOf, takeGift, toBattle } from './runFight.testkit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

registerArena({
  id: 'gentle-open', name: 'Поле новичков', summary: 'Тест пологого входа', goal: 'kills', width: 16, height: 10,
  heroStart: { x: 8, y: 5 }, obstacles: [], buttons: [], door: { x: 15.3, y: 5 }, enemies: [], killGoal: 9999,
});
const TICKS = (s: number): number => Math.round(s * 60);

/** Newcomers come, nothing hurts the hero (the elites and the tough are counted, not fought). */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.porcupineQuills = 0; p.lynxDamage = 0;
  return Object.assign(p, extra);
}

/**
 * A run (`gentle` — with the flag) whose open battle is a node of run row `row` (`battle` kind) of one of `types`; null — the
 * map has none. Run row 5 is the Jailer's (`checkpoint`) on every map, row 9 the breakthrough.
 */
const ORDINARY = ['battle', 'event', 'breakthrough'];
function rowRun(row: number, gentle: boolean, k: number, battle: RtBattleKind = 'battle', arena = 'gentle-open', types: readonly string[] = ['battle', 'event', 'breakthrough', 'checkpoint', 'hard']): RtRunState | null {
  for (let s = 0; s < 20; s++) {
    const base = createRtRun(seedOf(400 + 37 * k + s), gentle ? {} : RT_TASK17_OFF);
    const node = rtMapNodes(base).find(n => runRow(n.row) === row && types.includes(n.type));
    if (node) return { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena, seed: seedOf(k), battle } };
  }
  return null;
}
/** The open battle of `run` on the newcomers' field with the run's params of its row (`rtArenaParams`) over `base`. */
function arenaOf(run: RtRunState, base: Params, k: number): Simulation {
  return new Simulation({ arena: 'gentle-open', params: rtArenaParams(run, rtRunParams(base)), seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** The elites that came in the first `seconds` of the fight (the guaranteed one comes in the first 10 s). */
function elitesIn(sim: Simulation, seconds: number): Enemy[] {
  const seen = new Map<number, Enemy>(), w = sim.world;
  for (let t = 0; t < TICKS(seconds); t++) { sim.tick(); for (const e of w.enemies) if (e.elite && !seen.has(e.id)) seen.set(e.id, e); w.events.length = 0; }
  return [...seen.values()];
}

check('elites by the row: a gentle run meets none on rows 1–3 and the guaranteed one from row 4; a run without the flag — from row 3 (real fights of ordinary battles, 3 seeds each)', () => {
  for (const [gentle, row, want] of [[true, 1, false], [true, 2, false], [true, 3, false], [true, 4, true], [true, 6, true], [false, 2, false], [false, 3, true], [false, 4, true]] as const) {
    for (let k = 1; k <= 3; k++) {
      const run = rowRun(row, gentle, k, 'battle', 'gentle-open', ORDINARY);
      assert(run, `a node of row ${row}`);
      const sim = arenaOf(run, harmless(), k), elites = elitesIn(sim, 12);
      assert(want ? elites.length >= 1 : elites.length === 0, `${gentle ? 'gentle' : 'old'} row ${row} seed ${k}: elites ${elites.length}`);
      assert(rtArenaLoadout(run).randomElites === want, `${gentle ? 'gentle' : 'old'} row ${row}: random elites ${rtArenaLoadout(run).randomElites}`);
      assert(replays(sim), 'replay');
    }
  }
});

check('the elite of a gentle run: row 4 — 2 plates, no affix; rows 6–8 — 3 plates and 1 affix; row 9 — 4 plates and 2 affixes; a run without the flag — the same on row 6 (real fights)', () => {
  const plateOf = (e: Enemy): number => (e.armor?.max ?? 0) - (e.affixes?.includes('fat') ? 1 : 0) + (e.affixes?.includes('swift') ? 1 : 0);
  for (const [gentle, row, plates, affixes] of [[true, 4, 2, 0], [true, 6, 3, 1], [true, 7, 3, 1], [true, 8, 3, 1], [true, 9, 4, 2], [false, 4, 2, 0], [false, 6, 3, 1]] as const) {
    for (let k = 1; k <= 2; k++) {
      const run = rowRun(row, gentle, k, 'battle', 'gentle-open', ORDINARY);
      assert(run, `a node of row ${row}`);
      const sim = arenaOf(run, harmless(), k), first = elitesIn(sim, 12)[0];
      assert(first && plateOf(first) === plates && (first.affixes?.length ?? 0) === affixes, `${gentle ? 'gentle' : 'old'} row ${row} seed ${k}: plates ${first ? plateOf(first) : '—'}, affixes ${first?.affixes ?? []}`);
    }
  }
});

check('the Jailer\'s row 5: an elite of a gentle run has 2 plates and the row gives no affix (was 3 plates and 1 affix — the run without the flag)', () => {
  for (const [gentle, plates, affixes] of [[true, 2, 0], [false, 3, 1]] as const) {
    const run = rowRun(5, gentle, 1, 'battle', 'gentle-open', ['checkpoint'])!;
    const sim = arenaOf(run, harmless(), 1);
    sim.command({ t: 'clear', keepMarked: false });
    const id = sim.command({ t: 'place', x: 10, y: 5, color: 0, hp: 0, kind: 'basic', elite: true }) as number, e = sim.world.enemies.find(en => en.id === id)!;
    assert(e.armor?.max === plates, `${gentle ? 'gentle' : 'old'}: plates ${e.armor?.max}`);
    assert((rtArenaLoadout(run).eliteAffixes ?? 0) === affixes, `${gentle ? 'gentle' : 'old'}: affixes of the row's elites ${rtArenaLoadout(run).eliteAffixes}`);
  }
});

check('tough newcomers: a gentle run keeps 1–2 HP on row 5 and gets 3 HP from row 6; a run without the flag — 3 HP on row 5', () => {
  const hps = (run: RtRunState): Set<number> => {
    const out = new Set<number>();
    for (let k = 1; k <= 3; k++) {
      const sim = arenaOf(run, harmless({ baseToughShare: 1 }), k);
      for (let t = 0; t < TICKS(40); t++) { sim.tick(); for (const e of sim.world.enemies) if (!e.elite && (e.kind === 'basic' || e.kind === 'wolf')) out.add(e.hp); sim.world.events.length = 0; }
    }
    return out;
  };
  const top = (s: Set<number>): number => Math.max(...s);
  assert(top(hps(rowRun(5, true, 1)!)) === 2, 'gentle row 5: up to 2');
  assert(top(hps(rowRun(6, true, 1)!)) === 3, 'gentle row 6: 3');
  assert(top(hps(rowRun(5, false, 1)!)) === 3, 'old row 5: 3');
});

/** The run row and arena of every arena a run meets, its outcomes faked as victories (the run's own commands, no simulation); the old run — without the task-17 flags and the Jailer's fight (task 28: its node plays the pool). */
function arenaRows(seed: number, k: number, gentle: boolean): [number, string][] {
  let run = createRtRun(seed, { gift: 'mini', ...gentle ? {} : { ...RT_TASK17_OFF, jailer: false } });
  const out: [number, string][] = [];
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      out.push([runRow(rtNode(run, pending.nodeId)!.row), pending.arena]);
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'resolve');
    } else if (pending) run = pending.kind === 'gift' ? takeGift(run) : closeNode(run);
    else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, next[(k + step) % next.length].id), 'enter'); }
  }
  return out;
}

check('arenas by row (300 runs each, the run\'s own commands): a gentle run plays «Колючие заросли» on rows 7–8 only, row 1 never «Двор кнопок» (Е1), no kind met for the first time on row 9 (Q1 = b); a run without the flags still meets thorns on rows 5–6, buttons on row 1 and a first kind on row 9', () => {
  const rows = { gentle: new Map<number, number>(), old: new Map<number, number>() };
  const firstOn9 = { gentle: 0, old: 0 }, buttons1 = { gentle: 0, old: 0 };
  for (let k = 1; k <= 300; k++) {
    for (const gentle of [true, false]) {
      const map = gentle ? rows.gentle : rows.old, path = arenaRows(seedOf(k), k, gentle), key = gentle ? 'gentle' : 'old';
      path.forEach(([row, arena], i) => {
        if (arena === 'thorns') map.set(row, (map.get(row) ?? 0) + 1);
        if (row === 1 && arena === 'buttons') buttons1[key]++;
        // A first meeting: the arena brings one of the four new kinds no arena before it brought (arenaPools.ts `metKinds`).
        const met = new Set(path.slice(0, i).flatMap(([, a]) => arenaNewKinds(a)));
        if (row === 9 && arenaNewKinds(arena).some(kind => !met.has(kind))) firstOn9[key]++;
      });
    }
  }
  const text = (m: Map<number, number>): string => [...m].sort((a, b) => a[0] - b[0]).map(([r, n]) => `${r}: ${n}`).join(', ');
  console.log(`   thorns by row (heuristic walk, 13.10.2026) — gentle ${text(rows.gentle)}; old ${text(rows.old)}; a first kind on row 9 — gentle ${firstOn9.gentle}, old ${firstOn9.old}; «Двор кнопок» on row 1 — gentle ${buttons1.gentle}, old ${buttons1.old}`);
  assert([...rows.gentle.keys()].every(row => row === 7 || row === 8) && [7, 8].every(row => (rows.gentle.get(row) ?? 0) > 0), `gentle: ${text(rows.gentle)}`);
  assert(firstOn9.gentle === 0 && firstOn9.old > 0, `a first kind on row 9: gentle ${firstOn9.gentle}, old ${firstOn9.old}`);
  assert(buttons1.gentle === 0 && buttons1.old > 0, `«Двор кнопок» on row 1: gentle ${buttons1.gentle}, old ${buttons1.old}`);
  assert((rows.old.get(5) ?? 0) > 0 && (rows.old.get(6) ?? 0) > 0, `old: ${text(rows.old)}`);
});

check('Е1: every arena row 1 of a gentle run may play has a goal the prologue teaches; «Двор кнопок» (buttons) is not one of them', () => {
  const taught = new Set(PROLOGUE_ROOMS.map(room => room.arena.goal));
  const row1 = arenaCandidates(1, runArenaPools(true, true)), row1old = arenaCandidates(1, runArenaPools(true, false));
  assert(row1.length > 0 && row1.every(arena => taught.has(arenaTemplate(arena).goal)), `gentle row 1: ${row1.map(a => `${a}/${arenaTemplate(a).goal}`)} (taught ${[...taught]})`);
  assert(!taught.has(arenaTemplate('buttons').goal) && row1old.includes('buttons') && !row1.includes('buttons'), 'buttons out of row 1');
  console.log(`   prologue goals: ${[...taught].join(', ')}; gentle row 1: ${row1.join(', ')}; old row 1: ${row1old.join(', ')}`);
});

/**
 * A short real fight of the open battle of `run` (review 13.10.2026: «met» is what actually stood on the arena): the node's own
 * arena and roster with the run's params of its row over harmless numbers, `seconds` of game time; the kinds are read as the
 * view reads them (`RtDeathWatch` before every tick) and, apart, by a scan of the arena after every tick. The outcome is a
 * victory with the run's HP (the run layer does not judge the fight) carrying the watch's kinds.
 */
function shortFight(run: RtRunState, seconds: number): { outcome: RtArenaOutcome; scanned: Set<string>; sim: Simulation } {
  const pending = run.pending as Extract<RtRunState['pending'], { kind: 'battle' }>, watch = new RtDeathWatch();
  const sim = new Simulation({ arena: pending.arena, params: rtArenaParams(run, rtRunParams(harmless())), seed: pending.seed, record: true, loadout: rtArenaLoadout(run),
    ...pending.roster !== undefined ? { roster: pending.roster } : {}, beforeTick: w => watch.seen(w) });
  const scanned = new Set<string>(sim.world.enemies.map(e => e.kind));
  for (let t = 0; t < TICKS(seconds); t++) { sim.tick(); for (const e of sim.world.enemies) scanned.add(e.kind); sim.world.events.length = 0; }
  return { outcome: { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: sim.world.time, kinds: watch.kinds(sim.world) }, scanned, sim };
}
/**
 * A run (`opts` of createRtRun) walked by its own commands; every battle a short real fight (`shortFight`, `seconds`) — until
 * `stop` says so for an open battle. Returns the run there and the union of the kinds scanned in its fights; null — not reached.
 */
function walkFights(seed: number, k: number, opts: Parameters<typeof createRtRun>[1], seconds: number, stop: (run: RtRunState, row: number, battle: RtBattleKind) => boolean | null): { run: RtRunState; scanned: Set<string> } | null {
  let run = createRtRun(seed, { gift: 'mini', ...opts });
  const scanned = new Set<string>();
  for (let step = 0; step < 300 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      const row = runRow(rtNode(run, pending.nodeId)!.row), verdict = stop(run, row, pending.battle);
      if (verdict) return { run, scanned };
      if (verdict === null) return null;
      const fight = shortFight(run, seconds);
      for (const kind of fight.scanned) scanned.add(kind);
      run = ok(resolveArena(run, fight.outcome), 'resolve');
    } else if (pending) run = pending.kind === 'gift' ? takeGift(run) : closeNode(run);
    else {
      const next = rtAvailableNodes(run), battle = next.find(node => node.type === 'battle');
      run = ok(rtEnterNode(run, (step % 3 && battle ? battle : next[(k + step) % next.length]).id), 'enter');
    }
  }
  return null;
}
/** The elites that come in the first `seconds` of the open battle of `run`, on its own arena and roster (harmless numbers). */
function runElites(run: RtRunState, seconds: number): Enemy[] {
  const pending = run.pending as Extract<RtRunState['pending'], { kind: 'battle' }>;
  const sim = new Simulation({ arena: pending.arena, params: rtArenaParams(run, rtRunParams(harmless())), seed: pending.seed, record: true, loadout: rtArenaLoadout(run), ...pending.roster !== undefined ? { roster: pending.roster } : {} });
  const out = elitesIn(sim, seconds);
  assert(replays(sim), 'replay');
  return out;
}

check('«met» is what stood on the arena (review 13.10.2026): the run keeps the kinds of real fights — equal to a scan of the arena every tick; «Двор кнопок» cut after 1 s has no boar although its phases can bring one (60 s on the same seed does); a run without the flag keeps nothing', () => {
  // A gentle run whose first ordinary battle (row 2+) plays «Двор кнопок»: 1 s, then 60 s on the same node.
  let checked = 0;
  for (let k = 1; k <= 60 && checked < 2; k++) {
    const at = walkFights(seedOf(k + 1300), k, {}, 6, run => (run.pending as { arena: string }).arena === 'buttons');
    if (!at) continue;
    const cut = shortFight(at.run, 1), full = shortFight(at.run, 60);
    assert(full.scanned.has('boar') || full.scanned.has('wolf'), `seed ${k}: 60 s bring a wolf or a boar (${[...full.scanned]})`);
    const lateKind = ['boar', 'wolf'].find(kind => full.scanned.has(kind) && !cut.scanned.has(kind));
    if (!lateKind) continue;
    assert(same(cut.outcome.kinds, [...cut.scanned].sort()), `seed ${k}: the watch ${cut.outcome.kinds} = the scan ${[...cut.scanned]}`);
    const after = ok(resolveArena(at.run, cut.outcome), 'resolve');
    assert(!after.metKinds?.includes(lateKind) && same(after.metKinds, [...new Set([...at.run.metKinds ?? [], ...cut.scanned])].sort()), `seed ${k}: met ${after.metKinds} (not ${lateKind})`);
    const back = parseRtRun(serializeRtRun(after));
    assert(back && same(back.metKinds, after.metKinds), 'the save keeps it');
    checked++;
  }
  assert(checked >= 1, 'a cut fight found');
  // A whole walk: the run's met kinds are exactly the kinds scanned in its fights.
  for (let k = 1; k <= 5; k++) {
    const at = walkFights(seedOf(k + 1400), k, {}, 8, (_run, row) => row >= 6);
    assert(at && same(at.run.metKinds, [...at.scanned].sort()), `seed ${k}: met ${at?.run.metKinds}, scanned ${at ? [...at.scanned] : ''}`);
    const old = walkFights(seedOf(k + 1400), k, RT_TASK17_OFF, 8, (_run, row) => row >= 3);
    assert(old && old.run.metKinds === undefined, 'an old run keeps nothing');
  }
});

check('Е2: the elites of row 4 of a gentle run are only of a kind the hero fought on rows 1–3 that has an elite behaviour (basic, wolf, boar); a run without the flag — any kind; real fights all the way (60 seeds each)', () => {
  const behaviour = ['basic', 'wolf', 'boar'], seen = { gentle: new Set<string>(), old: new Set<string>() }, lists = new Set<string>();
  let fights = 0;
  for (let k = 1; k <= 60; k++) {
    const toRow4 = (_run: RtRunState, row: number, battle: RtBattleKind): boolean | null => row === 4 && battle === 'battle' ? true : row > 4 ? null : false;
    const at = walkFights(seedOf(k + 600), k, {}, 8, toRow4);
    if (at) {
      const allowed = rtArenaLoadout(at.run).eliteKinds ?? [], fought = [...at.scanned].filter(kind => behaviour.includes(kind));
      lists.add(allowed.join('+'));
      assert(same(allowed, fought.length ? behaviour.filter(kind => fought.includes(kind)) : ['basic']), `seed ${k}: allowed ${allowed}, fought ${[...at.scanned]}`);
      for (const e of runElites(at.run, 15)) { assert(allowed.includes(e.kind), `seed ${k}: an elite ${e.kind} (allowed ${allowed})`); seen.gentle.add(e.kind); }
      fights++;
    }
    const old = walkFights(seedOf(k + 600), k, RT_TASK17_OFF, 8, toRow4);
    if (old) { assert(rtArenaLoadout(old.run).eliteKinds === undefined, 'no list in an old run'); for (const e of runElites(old.run, 15)) seen.old.add(e.kind); }
  }
  console.log(`   row-4 elite kinds (heuristic, 13.10.2026) — gentle ${[...seen.gentle].join(', ')} (allowed lists: ${[...lists].join(' | ')}); old ${[...seen.old].join(', ')} (${fights} gentle fights)`);
  assert(fights >= 20 && lists.size >= 2 && seen.gentle.size >= 1, `fights ${fights}, lists ${[...lists]}, kinds ${[...seen.gentle]}`);
  assert([...seen.old].some(kind => !behaviour.includes(kind)), `the old run makes elites of other kinds too: ${[...seen.old]}`);
});

/** The porcupines of the final of `run` in its first `seconds` (start enemies and newcomers), on its own arena with the run's params. */
function finalPorcupines(run: RtRunState, seconds: number, k: number): number {
  const pending = run.pending as Extract<RtRunState['pending'], { kind: 'battle' }>;
  const sim = new Simulation({ arena: pending.arena, params: rtArenaParams(run, rtRunParams(harmless())), seed: seedOf(k), record: true, loadout: rtArenaLoadout(run) });
  const ids = new Set<number>();
  for (let t = 0; t < TICKS(seconds); t++) { for (const e of sim.world.enemies) if (e.kind === 'porcupine') ids.add(e.id); sim.tick(); sim.world.events.length = 0; }
  assert(replays(sim), 'replay');
  return ids.size;
}

check('the final of a gentle run whose hero never fought a porcupine: none in it (start enemy and newcomers), its share goes to the other three kinds of the mix; a run that fought one, and a run without the flags, play the old final (real fights all the way, up to 150 runs)', () => {
  let unmet = 0, metRuns = 0, oldFinals = 0, cutThorns = 0;
  const toFinal = (_run: RtRunState, _row: number, battle: RtBattleKind): boolean => battle === 'final';
  for (let k = 1; k <= 150 && (unmet < 4 || metRuns < 2 || oldFinals < 2); k++) {
    const at = walkFights(seedOf(k + 900), k, {}, 6, toFinal);
    if (at) {
      const met = at.scanned.has('porcupine'), gone = rtArenaLoadout(at.run).withoutKinds;
      assert(met === rtMetKinds(at.run).has('porcupine') && (met ? gone === undefined : same(gone, ['porcupine'])), `seed ${k}: fought ${met}, without ${gone}`);
      // A thorns fight of the walk whose porcupine never stepped out (6 s) — the template could bring it, the hero did not fight it.
      if (!met && at.run.picks.some(pick => pick.arena === 'thorns')) cutThorns++;
      if (!met && unmet < 4) { assert(finalPorcupines(at.run, 40, k) === 0, `seed ${k}: a porcupine in the final`); unmet++; }
      else if (met && metRuns < 2) { assert(finalPorcupines(at.run, 40, k) > 0, `seed ${k}: the old final`); metRuns++; }
    }
    if (oldFinals < 2) {
      const old = walkFights(seedOf(k + 900), k, RT_TASK17_OFF, 6, toFinal);
      if (old) { assert(rtArenaLoadout(old.run).withoutKinds === undefined && finalPorcupines(old.run, 40, k) > 0, `seed ${k}: an old run's final keeps it`); oldFinals++; }
    }
  }
  console.log(`   finals without a porcupine fought: ${unmet} checked; of them after a thorns fight that met none: ${cutThorns}`);
  assert(unmet >= 4 && metRuns >= 2 && oldFinals >= 2, `checked: unmet ${unmet}, met ${metRuns}, old ${oldFinals}`);
  // The mix: the porcupine's 10 % of all single newcomers split equally — each of the other three 13,3 %, the total 40 % kept.
  const ofAll = (template: ArenaTemplate): Record<string, number> => { let left = 1; const out: Record<string, number> = {}; for (const n of template.newcomers ?? []) { out[n.kind] = n.share * left; left -= n.share * left; } return out; };
  const before = ofAll(arenaTemplate('last-stand')), after = ofAll(withoutKinds(arenaTemplate('last-stand'), ['porcupine']));
  const total = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);
  assert(after.porcupine === undefined && ['shield', 'archer', 'sapper'].every(kind => Math.abs(after[kind] - (before[kind] + before.porcupine / 3)) < 1e-9) && Math.abs(total(after) - total(before)) < 1e-9, `shares ${JSON.stringify(after)}`);
  const start = withoutKinds(arenaTemplate('last-stand'), ['porcupine']).enemies;
  assert(!start.some(e => e.kind === 'porcupine') && start.length === arenaTemplate('last-stand').enemies.length && start.filter(e => e.elite).length === 2, 'the start porcupine elite stands as a basic elite');
  // A journal without the kit field plays the old final.
  const plain = new Simulation({ arena: 'last-stand', params: rtRunParams(harmless()), seed: seedOf(3), record: true, loadout: {} });
  assert(plain.world.enemies.some(e => e.kind === 'porcupine') && !('withoutKinds' in plain.world.kit!), 'the old final');
});

check('Е2 in the simulation: with `eliteMetKinds` and a kit list only those kinds become elites (the guarantee and random elites wait for one); without the key — the old path, every kind', () => {
  const kindsOf = (params: Params, loadout: Loadout, k: number): Set<string> => {
    const sim = new Simulation({ arena: 'gentle-open', params, seed: seedOf(k), record: true, loadout });
    const out = new Set(elitesIn(sim, 30).map(e => e.kind));
    assert(replays(sim), 'replay');
    return out;
  };
  const many = (extra: Partial<Params> = {}): Params => harmless({ eliteArmor: true, eliteSandbox: true, eliteChance: 1, eliteChanceAfter: 1, eliteArmorCap: 99, eliteArmorCapAfter: 99, baseWolfShare: 0.4, ...extra });
  const on = new Set<string>(), off = new Set<string>();
  for (let k = 1; k <= 3; k++) {
    for (const kind of kindsOf(many({ eliteMetKinds: true }), { eliteKinds: ['wolf'], guaranteedElite: true }, k)) on.add(kind);
    for (const kind of kindsOf(many(), { eliteKinds: ['wolf'], guaranteedElite: true }, k)) off.add(kind);
  }
  assert(same([...on], ['wolf']), `with the key: ${[...on]}`);
  assert(off.has('basic') && off.has('wolf'), `without the key: ${[...off]}`);
  // A journal without the key plays the world of before (the kit list is there, the rule is off).
  const params = many(); delete (params as Partial<Params>).eliteMetKinds;
  const a = new Simulation({ arena: 'gentle-open', params, seed: seedOf(9), record: true, loadout: { eliteKinds: ['wolf'] } }), b = new Simulation({ arena: 'gentle-open', params: many(), seed: seedOf(9), record: true, loadout: { eliteKinds: ['wolf'] } });
  for (let t = 0; t < TICKS(20); t++) { a.tick(); b.tick(); a.world.events.length = 0; b.world.events.length = 0; }
  const strip = (sim: Simulation): string => { const st = worldState(sim.world) as Record<string, unknown>; delete st.params; return JSON.stringify(st); };
  assert(strip(a) === strip(b) && replay(JSON.parse(JSON.stringify(a.exportJournal()!))).hash() === a.hash(), 'the old path');
});

/** The hero touched once by an enemy of `hp` standing on him: the hit's damage and the invulnerability it left. */
function touch(run: RtRunState, hp: number, k: number): { damage: number; invulnerable: number; sim: Simulation } {
  const sim = arenaOf(run, quiet({ contactDamage: 1 }), k), w = sim.world;
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'place', x: w.hero.x + 0.3, y: w.hero.y, color: 0, hp, kind: 'basic' });
  for (let t = 0; t < TICKS(3); t++) {
    sim.tick();
    const hit = w.events.find((ev): ev is Extract<WorldEvent, { type: 'hit' }> => ev.type === 'hit');
    w.events.length = 0;
    if (hit) return { damage: hit.damage, invulnerable: w.hero.invulnerable, sim };
  }
  throw new Error('no touch');
}

check('a touch: a gentle run leaves 1 / 1 / 0,8 / 0,65 s of invulnerability on rows 1–4 and 0,5 from row 5; the tough touch hurts 1 on rows 1–2 and 2 from row 3; a run without the flag — 0,5 s and 2 everywhere', () => {
  const tick = 1 / 60 + 1e-9;
  for (const [gentle, row, grace, tough] of [[true, 1, 1, 1], [true, 2, 1, 1], [true, 3, 0.8, 2], [true, 4, 0.65, 2], [true, 5, 0.5, 2], [true, 9, 0.5, 2], [false, 1, 0.5, 2], [false, 4, 0.5, 2]] as const) {
    const run = rowRun(row, gentle, 1)!;
    const weak = touch(run, 0, 1), strong = touch(run, 2, 2);
    assert(weak.damage === 1 && Math.abs(weak.invulnerable - grace) <= tick, `${gentle ? 'gentle' : 'old'} row ${row}: a touch ${weak.damage}, invulnerable ${weak.invulnerable}`);
    assert(strong.damage === tough, `${gentle ? 'gentle' : 'old'} row ${row}: the tough touch ${strong.damage}`);
    assert(replays(strong.sim), 'replay');
  }
});

check('a new gentle run starts with 1 healing potion, the kind open; a run without the flag — none', () => {
  for (let k = 1; k <= 5; k++) {
    const run = createRtRun(seedOf(k), { gift: 'mini' }), old = createRtRun(seedOf(k), { gift: 'mini', ...RT_TASK17_OFF });
    assert(run.gentleEntry === true && run.items.healing === 1 && same(run.openItems, ['healing']), `seed ${k}: ${JSON.stringify(run.items)} ${run.openItems}`);
    assert(old.gentleEntry === undefined && Object.values(old.items).every(n => n === 0) && !old.openItems.length, 'the old start');
    // The same map, gift and streams: the potion draws nothing.
    assert(same(run.map, old.map) && same(run.gift, old.gift) && same(run.streams, old.streams), 'nothing else differs');
  }
});

/** The first battle of a gentle run whose gift opened nothing more than the start's healing. */
function firstBattle(k: number): RtRunState | null {
  let run = createRtRun(seedOf(k), { gift: 'mini' });
  // The gift's button without consumables (as a player who took the HP).
  const view = rtGiftView(run)!, option = view.options.find(o => o.available && o.option.kind !== 'items') ?? view.options.find(o => o.available)!;
  run = ok(rtChooseGift(run, option.index), 'gift');
  const open = rtGiftView(run);
  if (open && open.chosen !== null) run = ok(rtChooseGiftPick(run, open.picks[0]), 'gift pick');
  for (let step = 0; step < 40 && run.pending?.kind !== 'battle'; step++) run = run.pending ? closeNode(run) : ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  return run.pending?.kind === 'battle' && run.openItems.every(item => item === 'healing') ? run : null;
}

check('the first armoured elite loot of a gentle run opens another kind (not healing) and drops it; the run opens it; a second elite of the fight and the next arena play the old rule', () => {
  const kinds = new Set<string>();
  let runs = 0;
  for (let k = 1; k <= 30 && runs < 6; k++) {
    const run = firstBattle(k);
    if (!run) continue;
    const sim = new Simulation({ arena: 'run-fight-field', params: rtArenaParams(run, rtRunParams(quiet())), seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
    const w = sim.world, events: WorldEvent[] = [];
    const tickAll = (n: number, until: (world: World) => boolean = () => false): void => { for (let i = 0; i < n && !until(w); i++) { sim.tick(); events.push(...w.events); w.events.length = 0; } };
    sim.command({ t: 'clear', keepMarked: false });
    const id = sim.command({ t: 'place', x: 8, y: 6, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
    for (let i = 0; i < 8 && w.enemies.some(e => e.id === id); i++) {
      const e = w.enemies.find(en => en.id === id)!;
      sim.command({ t: 'teleport', x: e.x - 2, y: 6 }); sim.command({ t: 'begin', x: e.x, y: e.y }); sim.command({ t: 'release' });
      events.push(...w.events); w.events.length = 0;
      tickAll(900, world => !world.move);
    }
    const dropped = events.flatMap(ev => ev.type === 'loot' && !ev.picked ? [ev.loot] : []);
    assert(dropped.length >= 1 && dropped.every(l => l === dropped[0]) && dropped[0] !== 'healing' && (SLOT_ITEMS as readonly string[]).includes(dropped[0]), `seed ${k}: dropped ${dropped}`);
    assert(same(w.kit!.openItems, ['healing', dropped[0]]) && w.kit!.lootOpens === undefined, `seed ${k}: open ${w.kit!.openItems}`);
    // A second elite of the same fight: the rule of before — one of the open kinds, nothing new opened.
    const second = sim.command({ t: 'place', x: 8, y: 6, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
    for (let i = 0; i < 8 && w.enemies.some(e => e.id === second); i++) {
      const e = w.enemies.find(en => en.id === second)!;
      sim.command({ t: 'teleport', x: e.x - 2, y: 6 }); sim.command({ t: 'begin', x: e.x, y: e.y }); sim.command({ t: 'release' });
      events.push(...w.events); w.events.length = 0;
      tickAll(900, world => !world.move);
    }
    assert(w.kit!.openItems.length === 2, `seed ${k}: no second kind (${w.kit!.openItems})`);
    sim.command({ t: 'goals' }); sim.command({ t: 'teleport', x: 16.5, y: 6 }); sim.command({ t: 'walk', x: 1, y: 0 });
    tickAll(600, world => world.status !== 'playing');
    assert(w.status === 'victory' && replays(sim), `seed ${k}: won, replays`);
    const after = ok(resolveArena(run, outcomeOf(run, w)), 'resolve');
    assert(same(after.openItems, ['healing', dropped[0]]) && !rtArenaLoadout({ ...after, pending: run.pending }).lootOpens, `seed ${k}: the run opened ${after.openItems}`);
    kinds.add(dropped[0]);
    runs++;
  }
  console.log(`   kinds the first loot opened: ${[...kinds].join(', ')}`);
  assert(runs >= 4 && kinds.size >= 2, `runs ${runs}, kinds ${[...kinds]}`);
});

/**
 * A fight of the open battle of `run` where a ring of touching enemies takes the hero's HP (default touch and speed); `win` —
 * once the second wind stood him up, the ring is cleared and he walks into the door. The events of every tick in order.
 */
function lethalFight(run: RtRunState, k: number, win: boolean): { sim: Simulation; events: { tick: number; time: number; ev: WorldEvent; hp: number; invulnerable: number }[] } {
  const params = rtArenaParams(run, rtRunParams(quiet({ contactDamage: defaultParams().contactDamage, enemySpeed: defaultParams().enemySpeed })));
  const sim = new Simulation({ arena: 'run-fight-field', params, seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
  const w = sim.world, events: { tick: number; time: number; ev: WorldEvent; hp: number; invulnerable: number }[] = [];
  sim.command({ t: 'clear', keepMarked: false });
  for (let i = 0; i < 8; i++) sim.command({ t: 'place', x: w.hero.x + Math.cos(i * Math.PI / 4) * 0.6, y: w.hero.y + Math.sin(i * Math.PI / 4) * 0.6, color: i % 4, hp: 2, kind: 'basic' });
  for (let t = 0; t < TICKS(240) && w.status === 'playing'; t++) {
    sim.tick();
    for (const ev of w.events) events.push({ tick: w.tick, time: w.time, ev, hp: w.hero.hp, invulnerable: w.hero.invulnerable });
    const stood = w.events.some(ev => ev.type === 'secondWind');
    w.events.length = 0;
    if (stood && win) {
      sim.command({ t: 'clear', keepMarked: false }); sim.command({ t: 'goals' });
      sim.command({ t: 'teleport', x: 16.5, y: 6 }); sim.command({ t: 'walk', x: 1, y: 0 });
    }
  }
  assert(w.status !== 'playing', 'the fight ended');
  assert(replays(sim), 'the fight replays from its journal');
  return { sim, events };
}

check('the second wind of a gentle run: on row 1 the lethal touch stands the hero up with 3 HP and 2 s of invulnerability; once a fight; spent for the run — the next battle of rows 1–4 has none', () => {
  let stood = 0;
  for (let k = 1; k <= 3; k++) {
    // A real run at its first battle (run row 1), the hero at the run's 15 HP.
    const run = toBattle(takeGift(createRtRun(seedOf(k + 50), { gift: 'mini' })));
    assert(runRow(rtNode(run, (run.pending as { nodeId: string }).nodeId)!.row) === 1 && rtArenaLoadout(run).secondWind === true, 'the loadout has it');
    // A lost fight: the wind once, then the next lethal hit ends it.
    const lost = lethalFight(run, k, false), winds = lost.events.filter(e => e.ev.type === 'secondWind');
    assert(winds.length === 1 && lost.sim.world.status === 'defeat', `seed ${k}: winds ${winds.length}, ${lost.sim.world.status}`);
    const wind = winds[0];
    assert(wind.hp === SECOND_WIND_HP && wind.invulnerable >= SECOND_WIND_INVULNERABLE - 1 / 60 - 1e-9, `seed ${k}: stood with ${wind.hp} HP, invulnerable ${wind.invulnerable}`);
    assert(!lost.events.some(e => e.ev.type === 'hit' && e.time > wind.time && e.time < wind.time + SECOND_WIND_INVULNERABLE - 1e-6), `seed ${k}: no hit in the 2 s`);
    const lostRun = ok(resolveArena(run, outcomeOf(run, lost.sim.world)), 'resolve lost');
    assert(lostRun.result?.outcome === 'defeat' && lostRun.secondWindSpent === true, `seed ${k}: the lost run spent it`);
    // A won fight: the run goes on without it.
    const won = lethalFight(run, k, true);
    assert(won.sim.world.status === 'victory' && won.events.filter(e => e.ev.type === 'secondWind').length === 1, `seed ${k}: won after the wind`);
    const after = ok(resolveArena(run, outcomeOf(run, won.sim.world)), 'resolve won');
    assert(after.secondWindSpent === true && !after.result, `seed ${k}: spent`);
    const back = parseRtRun(serializeRtRun(after));
    assert(back && same(back, after), 'the save keeps it');
    // The next battle of rows 1–4 (setup: the spent flag on a run whose open battle is on row 2): no wind in its loadout.
    const next = rowRun(2, true, k, 'battle', 'run-fight-field')!, spent: RtRunState = { ...structuredClone(next), secondWindSpent: true, battles: after.battles };
    assert(rtArenaLoadout(next).secondWind === true && !rtArenaLoadout(spent).secondWind, 'none in the next battle');
    const again = lethalFight(spent, k, false);
    assert(!again.events.some(e => e.ev.type === 'secondWind') && again.sim.world.status === 'defeat', `seed ${k}: the next lethal hit ends the fight`);
    stood++;
  }
  assert(stood === 3, 'three seeds');
});

check('the second wind: not on row 5 or later of a new run, not in a run without its flag', () => {
  for (const [gentle, row] of [[true, 5], [true, 7], [false, 1], [false, 3]] as const) {
    const run = rowRun(row, gentle, 1, 'battle', 'run-fight-field')!;
    assert(!rtArenaLoadout(run).secondWind, `${gentle ? 'gentle' : 'old'} row ${row}: no wind in the loadout`);
    const fight = lethalFight(run, 1, false);
    assert(!fight.events.some(e => e.ev.type === 'secondWind') && fight.sim.world.status === 'defeat', `${gentle ? 'gentle' : 'old'} row ${row}: the lethal hit ends the fight`);
    // A run without the flag ignores an outcome that says so (nothing to spend).
    if (!gentle) {
      const after = ok(resolveArena(run, { ...outcomeOf(run, fight.sim.world), secondWind: true }), 'resolve');
      assert(after.secondWindSpent === undefined, 'nothing spent');
    }
  }
});

check('a run with ONLY the flag `secondWind` (no gentle entry, no potion): the wind stands the hero up once in a row-1 fight, the run spends it, and a lethal hit in its next fight of rows 1–4 ends that fight', () => {
  let checked = 0;
  for (let k = 1; k <= 6 && checked < 3; k++) {
    const run = toBattle(takeGift(createRtRun(seedOf(k + 700), { gift: 'mini', gentleEntry: false, startPotion: false, secondWind: true })));
    assert(run.secondWind === true && !run.gentleEntry && !run.startPotion && rtArenaLoadout(run).secondWind === true, 'only the wind');
    const first = lethalFight(run, k, true);
    assert(first.sim.world.status === 'victory' && first.events.filter(e => e.ev.type === 'secondWind').length === 1, `seed ${k}: the wind in the first fight`);
    const after = ok(resolveArena(run, outcomeOf(run, first.sim.world)), 'resolve');
    assert(after.secondWindSpent === true, `seed ${k}: spent`);
    const next = toBattle(closeNode(after));
    if (runRow(rtNode(next, (next.pending as { nodeId: string }).nodeId)!.row) > 4) continue;
    assert(!rtArenaLoadout(next).secondWind, `seed ${k}: no wind in the next loadout`);
    const second = lethalFight(next, k + 1, false);
    assert(second.sim.world.status === 'defeat' && !second.events.some(e => e.ev.type === 'secondWind'), `seed ${k}: the next lethal hit ends the fight`);
    checked++;
  }
  assert(checked >= 2, `runs checked ${checked}`);
});

check('saves: a new run keeps its three flags and `secondWindSpent`; a save without them (before task 17) loads and plays the old rules; malformed flags read as no run', () => {
  let run = takeGift(createRtRun(seedOf(77), { gift: 'mini' }));
  const back = parseRtRun(serializeRtRun(run));
  assert(back && back.gentleEntry === true && back.startPotion === true && back.secondWind === true && same(back, run), 'the flags load back');
  const old = JSON.parse(serializeRtRun(run)) as Record<string, unknown>;
  delete old.gentleEntry; delete old.startPotion; delete old.secondWind;
  const oldRun = parseRtRun(JSON.stringify(old));
  assert(oldRun && oldRun.gentleEntry === undefined && oldRun.startPotion === undefined && oldRun.secondWind === undefined, 'a save without the flags loads');
  const battle = rowRun(3, true, 1)!, oldBattle: RtRunState = { ...structuredClone(battle) };
  delete oldBattle.gentleEntry; delete oldBattle.shortFuse;
  assert(rtArenaLoadout(battle).randomElites === false && rtArenaLoadout(oldBattle).randomElites === true, 'the old save plays the old row 3');
  assert(same(rtArenaRules(oldBattle), {}) || same(rtArenaRules(oldBattle), { markedGoals: true }), 'no row params for the old save');
  for (const bad of [{ gentleEntry: false }, { gentleEntry: 1 }, { startPotion: false }, { secondWind: 1 }, { secondWindSpent: true }, { secondWindSpent: false }]) {
    const value = { ...JSON.parse(serializeRtRun(run)), ...bad };
    if ('secondWindSpent' in bad && bad.secondWindSpent === true) value.battles = [];
    assert(parseRtRun(JSON.stringify(value)) === null, `malformed ${JSON.stringify(bad)}`);
  }
  run = { ...run, battles: [{ nodeId: run.visited[0] ?? 'x', arena: 'glade', won: true, kills: 0, damage: 0, time: 1 }] };
  const noFlag = { ...JSON.parse(serializeRtRun(run)), secondWindSpent: true };
  delete noFlag.secondWind;
  assert(parseRtRun(JSON.stringify(noFlag)) === null, 'a spent second wind without its flag reads as no run');
});

check('each of the three flags alone changes only its own system (design 13.10.2026): `gentleEntry` — the tables and the row numbers; `startPotion` — the potion and the first loot; `secondWind` — the run\'s second wind', () => {
  // A seed whose map has ordinary battles on rows 1, 3 and 6.
  const k = Array.from({ length: 40 }, (_, i) => 91 + i).find(n => [1, 3, 6].every(row => rtMapNodes(createRtRun(seedOf(n))).some(node => runRow(node.row) === row && ORDINARY.includes(node.type))))!;
  const only = (flag: 'gentleEntry' | 'startPotion' | 'secondWind'): RtRunState => createRtRun(seedOf(k), { gift: 'mini', gentleEntry: flag === 'gentleEntry', startPotion: flag === 'startPotion', secondWind: flag === 'secondWind' });
  const atRow = (run: RtRunState, row: number): RtRunState => {
    const node = rtMapNodes(run).find(n => runRow(n.row) === row && ORDINARY.includes(n.type))!;
    return { ...structuredClone(run), pending: { kind: 'battle', nodeId: node.id, arena: 'run-fight-field', seed: seedOf(row), battle: 'battle' } };
  };
  const look = (run: RtRunState) => {
    const r1 = atRow(run, 1), r3 = atRow(run, 3), r6 = atRow(run, 6), l1 = rtArenaLoadout(r1), l3 = rtArenaLoadout(r3), l6 = rtArenaLoadout(r6), p1 = rtArenaParams(r1, rtRunParams(defaultParams()));
    return { potion: run.items.healing === 1 && same(run.openItems, ['healing']), loot: !!l1.lootOpens, wind: !!l1.secondWind, gentleTables: l3.randomElites === false && (l6.eliteAffixes ?? 0) === 1 && l6.elitePlates === 3,
      oldTables: l3.randomElites === true && (l6.eliteAffixes ?? 0) === 1, grace: p1.invulnerability === 1 && p1.toughTouch === false };
  };
  const g = look(only('gentleEntry')), p = look(only('startPotion')), w = look(only('secondWind')), none = look(createRtRun(seedOf(k), { gift: 'mini', ...RT_TASK17_OFF }));
  assert(g.gentleTables && g.grace && !g.potion && !g.loot && !g.wind, `gentleEntry alone: ${JSON.stringify(g)}`);
  assert(p.potion && p.loot && p.oldTables && !p.grace && !p.wind, `startPotion alone: ${JSON.stringify(p)}`);
  assert(w.wind && w.oldTables && !w.grace && !w.potion && !w.loot, `secondWind alone: ${JSON.stringify(w)}`);
  assert(none.oldTables && !none.grace && !none.potion && !none.loot && !none.wind, `none: ${JSON.stringify(none)}`);
  // Each flag defaults to its own constant: switching one off leaves the others on (review 13.10.2026).
  const noGentle = createRtRun(seedOf(k), { gentleEntry: false }), noPotion = createRtRun(seedOf(k), { startPotion: false }), noWind = createRtRun(seedOf(k), { secondWind: false });
  assert(!noGentle.gentleEntry && noGentle.startPotion === true && noGentle.secondWind === true, 'gentleEntry off alone');
  assert(noPotion.gentleEntry === true && !noPotion.startPotion && noPotion.secondWind === true && noPotion.items.healing === 0, 'startPotion off alone');
  assert(noWind.gentleEntry === true && noWind.startPotion === true && !noWind.secondWind, 'secondWind off alone');
  // The pools: only `gentleEntry` moves «Колючие заросли» off rows 5–6 (the walk of the thorns check, 60 runs).
  const thornsEarly = (opts: { gentleEntry: boolean; startPotion: boolean; secondWind: boolean }): number => {
    let n = 0;
    for (let k = 1; k <= 60; k++) {
      let run = createRtRun(seedOf(k), { gift: 'mini', ...opts });
      for (let step = 0; step < 200 && !run.result; step++) {
        const pending = run.pending;
        if (pending?.kind === 'battle') { if (pending.arena === 'thorns' && runRow(rtNode(run, pending.nodeId)!.row) <= 6) n++; run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'resolve'); }
        else if (pending) run = pending.kind === 'gift' ? takeGift(run) : closeNode(run);
        else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, next[(k + step) % next.length].id), 'enter'); }
      }
    }
    return n;
  };
  assert(thornsEarly({ gentleEntry: true, startPotion: false, secondWind: false }) === 0 && thornsEarly({ gentleEntry: false, startPotion: true, secondWind: true }) > 0, 'the pools follow gentleEntry only');
  // A real lethal fight on row 1: the wind with `secondWind` alone, none with `gentleEntry` alone.
  const windFight = lethalFight(atRow(only('secondWind'), 1), 2, false), plain = lethalFight(atRow(only('gentleEntry'), 1), 2, false);
  assert(windFight.events.filter(e => e.ev.type === 'secondWind').length === 1 && !plain.events.some(e => e.ev.type === 'secondWind'), 'the wind follows its own flag');
});

check('the run ignores the sandbox panel: its params are the defaults with the run\'s numbers, whatever the panel saved; the same fight plays the same world', () => {
  const panel = defaultParams();
  Object.assign(panel, { invulnerability: 2, toughTouch: false, eliteChance: 0.5, contactDamage: 9, heroAnchor: true, eliteSandbox: true, crystals: true, colorsByRow: true });
  const fromPanel = rtPageParams(false, () => panel), fromDefaults = rtPageParams(false, defaultParams);
  assert(same(fromPanel, fromDefaults) && same(fromDefaults, rtRunParams(defaultParams())), 'the run params do not depend on the panel');
  assert(rtPageParams(true, () => panel) === panel, 'the sandbox plays its panel');
  const run = rowRun(2, true, 1)!;
  const play = (params: Params): string => {
    const sim = new Simulation({ arena: 'gentle-open', params: rtArenaParams(run, params), seed: seedOf(5), loadout: rtArenaLoadout(run) });
    for (let t = 0; t < TICKS(10); t++) { sim.tick(); sim.world.events.length = 0; }
    return JSON.stringify(worldState(sim.world));
  };
  assert(play(fromPanel) === play(fromDefaults), 'the same world');
});

check('a run journal without the new kit fields plays the old path: a row-1 battle of a run without the flag is the world of before', () => {
  // The old run's loadout carries neither `secondWind` nor `lootOpens`; its kit hashes as before (no new keys).
  const run = rowRun(1, false, 3, 'battle', 'run-fight-field')!, loadout = rtArenaLoadout(run);
  assert(!('secondWind' in loadout) && !('lootOpens' in loadout), 'no new loadout fields');
  const sim = new Simulation({ arena: 'run-fight-field', params: rtArenaParams(run, rtRunParams(quiet())), seed: seedOf(3), record: true, loadout });
  assert(!('secondWind' in sim.world.kit!) && !('lootOpens' in sim.world.kit!), 'no new kit fields');
  const gentle = rowRun(1, true, 3, 'battle', 'run-fight-field')!, kit = new Simulation({ arena: 'run-fight-field', params: rtRunParams(quiet()), seed: seedOf(3), loadout: rtArenaLoadout(gentle) }).world.kit!;
  assert(kit.secondWind === true && kit.lootOpens === true, 'the gentle run carries them');
});

console.log(`realtime-gentle-entry: ${checks} checks passed`);
