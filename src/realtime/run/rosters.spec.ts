/**
 * Rosters of the real-time arenas (phase A, Т2; docs/realtime-phase-a.md, sections 2 and 4). Node only:
 * `npm run test:realtime-rosters`. Everything goes through the run's commands (enter a node, the preview of the map, the
 * fake victory of an arena) and the simulation; what is looked at is what the player meets:
 * - a roster never brings a kind the run has not seen on an earlier arena (the four kinds of the slice anywhere, the lynx
 *   and the shaman — only their own arenas bring them before), «Поляна» of run row 1 and the fixed arenas keep their own
 *   composition, an anchor arena is its own at the first meeting of its kind on run rows 1–3 and gets one role otherwise
 *   (design decision 09.10.2026, variant A with the row-4 threshold);
 * - the same seed and the same steps give the same rosters, the map's preview equals the roster played and spends nothing;
 * - a save keeps the rosters and is checked by choosing them again (version 5; version 4 — no run);
 * - an arena with a roster replays from its journal (`roster` in it) to the same hash; a journal without one plays the
 *   template as before (the browser fixtures keep their hashes);
 * - counts (printed, for docs/realtime-phase-a.md, section 4): rosters by run row over 300 runs (the walk of c8df2d4),
 *   the pairs «layout × roster» per run, the kinds that come in 60 s with each roster.
 */
// Task 50: the knack screen of a run (RT_KNACKS_ON) is passed over — «Пропустить» — where the route knows only the screens of before.
import { rtChooseKnack } from './rtRun';
import { replay, Simulation } from '../sim/simulation';
import { defaultParams, type Params } from '../sim/params';
import { arenaTemplate } from '../sim/arenas';
import { enemyKind } from '../sim/enemies/kinds';
import {
  ALWAYS_MET, ANCHOR_ARENAS, ANCHOR_ROLE_ROW, ANCHOR_ROLES, FIXED_ROSTER_ARENAS, KIND_ROLE, POOL_ROSTER_ARENAS, POOL_ROSTERS, rosterChoices, rosterDef, rosterKinds, rosterTitle, withRoster,
} from '../sim/rosters';
import { MIXED_ROSTER_ARENAS, rosterMet, RUN_ARENAS, runRow, SHOOTER_RUN_ARENAS, TRICK_RUN_ARENAS } from './arenaPools';
import { RT_TASK17_OFF,
  arenaPreview, createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtChooseTalisman, rtEnterNode,
  rtEventView, rtGiftView, rtNode, rtRestHeal, rtShopLeave, serializeRtRun, RT_RUN_FORCED, RT_RUN_VERSION, type RtRunState, type RtRunStep,
} from './rtRun';
import saveBeforeMix from '../../../tests/fixtures/rt-run-save-before-mix.json';
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import shieldsWolvesJournal from '../../../tests/fixtures/realtime-browser-journal-shields-wolves.json';
import type { Journal } from '../sim/simulation';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds, as the measure of c8df2d4: `Math.imul(k, 2654435761) >>> 0`. */
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ok = (step: RtRunStep, what: string): RtRunState => { if (!step.ok) throw new Error(`${what}: ${step.reason}`); return step.run; };
const roundTrip = (run: RtRunState) => parseRtRun(serializeRtRun(run));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The kinds an arena's template shows the player: its newcomers and every enemy standing on it from the start. */
const templateKinds = (arena: string): string[] => {
  const t = arenaTemplate(arena);
  return [...(t.newcomers ?? []).map(entry => entry.kind), ...t.enemies.map(entry => entry.kind ?? 'basic')];
};

function takeGift(run: RtRunState): RtRunState {
  const view = rtGiftView(run)!, first = view.options.find(entry => entry.available);
  let next = ok(rtChooseGift(run, first ? first.index : null), 'gift');
  const open = rtGiftView(next);
  if (open && open.chosen !== null) next = ok(rtChooseGiftPick(next, open.picks[0]), 'gift pick');
  return next;
}

interface Played { row: number; type: string; arena: string; roster?: string; run: RtRunState }
/**
 * The walk of the measure of c8df2d4 (rtRun.spec.ts, `arenaPath`): the mini gift, the first button of every screen, the
 * next node by `(k + step)`, every arena a victory without simulation. Each entered battle is checked against the map's
 * preview (equal, and the preview spends nothing) and the save (it loads back). `mix` — the run's roster mix (a new run:
 * on; off — a run before 11.10.2026, and so without the gentle entry of task 17).
 */
function walk(seed: number, k: number, mix = true, tricks = true): Played[] {
  // A run before the mix is also before the gentle entry (task 17, 13.10.2026), the Jailer's fight (task 28) and the forest's shooters (task 57а): its pools are the old ones.
  // Task 57б: `tricks` false — a run without the forest's mechanics (`forestTricks: false`, a save before 22.10.2026).
  let run = createRtRun(seed, { gift: 'mini', garrison: false, rosterMix: mix, ...mix ? {} : { ...RT_TASK17_OFF, jailer: false, troll: false, forms: false, forestShooters: false }, ...tricks ? {} : { forestTricks: false } });
  const played: Played[] = [];
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'gift') run = takeGift(run);
    else if (pending?.kind === 'battle') {
      const node = rtNode(run, pending.nodeId)!;
      played.push({ row: runRow(node.row), type: node.type, arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, run });
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'fake win');
      // Phase B: the Jailer's two screens (hammer, then oath) are one step of the walk, as its one screen before them —
      // the walk's node choices `(k + step)` and so the measure of c8df2d4 stay as they were.
    } else if (pending?.kind === 'hammer') run = ok(rtChooseTalisman(ok(rtChooseHammer(run, null), 'refuse hammer'), null), 'refuse');
    else if (pending?.kind === 'knack') run = ok(rtChooseKnack(run, null), 'knack');
    else if (pending?.kind === 'talisman') run = ok(rtChooseTalisman(run, null), 'refuse');
    else if (pending?.kind === 'rest') run = ok(rtRestHeal(run), 'rest');
    else if (pending?.kind === 'find') run = ok(rtChooseFind(run, pending.options.find(item => !rtItemRefusal(run, item)) ?? pending.options[0]), 'find');
    else if (pending?.kind === 'shop') run = ok(rtShopLeave(run), 'shop');
    else if (pending?.kind === 'event') run = ok(rtChooseEventOption(run, rtEventView(run)!.options.find(option => option.available)!.id), 'event');
    else {
      const next = rtAvailableNodes(run), chosen = next[(k + step) % next.length], before = serializeRtRun(run), preview = arenaPreview(run, chosen);
      assert(serializeRtRun(run) === before, 'the preview spends nothing');
      run = ok(rtEnterNode(run, chosen.id), 'enter');
      if (run.pending?.kind === 'battle') {
        assert(preview?.arena === run.pending.arena && preview.roster === run.pending.roster, `${chosen.id}: previewed ${preview?.arena}/${preview?.roster}, played ${run.pending.arena}/${run.pending.roster}`);
        assert(same(roundTrip(run), run), 'the save with the open arena loads back');
      }
    }
  }
  return played;
}

const RUNS = 300;
const walks = Array.from({ length: RUNS }, (_, n) => walk(seedOf(n + 1), n + 1));

// ---- Data ----

check('rosters are data apart from the layout: known kinds and roles; the arenas that take rosters have no start enemies outside their goal (except the anchor lynxes); every arena of the run is fixed, pool or anchor', () => {
  for (const def of [...POOL_ROSTERS, ...ANCHOR_ROLES]) {
    // Task 57а: the wisp has no role (design 17.10.2026: no badge) — every other kind has one.
    for (const kind of rosterKinds(def)) { assert(enemyKind(kind) && (KIND_ROLE[kind] || kind === 'wisp'), `${def.id}: kind ${kind}`); }
    assert(rosterKinds(def).length > 0 && rosterDef(def.id) === def, `${def.id}: registered`);
  }
  for (const arena of [...POOL_ROSTER_ARENAS, ...Object.keys(MIXED_ROSTER_ARENAS)]) assert(arenaTemplate(arena).enemies.every(e => e.marked || e.elite), `${arena}: a start enemy outside the goal`);
  for (const [arena, anchor] of Object.entries(ANCHOR_ARENAS)) {
    const t = arenaTemplate(arena);
    assert(t.newcomers?.[0]?.kind === anchor.kind && t.enemies.every(e => e.marked || e.elite || e.kind === anchor.kind), `${arena}: anchor ${anchor.kind}`);
  }
  const ruled = [...FIXED_ROSTER_ARENAS, ...POOL_ROSTER_ARENAS, ...Object.keys(ANCHOR_ARENAS)];
  assert(RUN_ARENAS.every(arena => ruled.filter(other => other === arena).length === 1), `run arenas without one rule: ${RUN_ARENAS.filter(arena => !ruled.includes(arena))}`);
  // The pool and its first rows, the anchor at its first meeting, the role differing from the anchor's.
  assert(rosterChoices('buttons', 1, new Set())?.join() === 'onslaught,wolves', `row 1, nothing met: ${rosterChoices('buttons', 1, new Set())}`);
  assert(rosterChoices('glade', 1, new Set(['shield'])) === null && rosterChoices('glade', 2, new Set())?.length === 2, '«Поляна»: own on row 1, the pool from row 2');
  assert(ANCHOR_ROLE_ROW === 4 && rosterChoices('shields', 3, new Set()) === null, '«Стена щитов»: own at the first meeting on row 3');
  assert(rosterChoices('shields', 4, new Set())!.join() === '+boar,+wolf', `«Стена щитов», first meeting on row 4: ${rosterChoices('shields', 4, new Set())}`);
  assert(!rosterChoices('shields', 3, new Set(['shield', 'archer']))!.includes('+shield'), '«Стена щитов» met before: a role, not the shield');
  assert(rosterChoices('thorns', 6, new Set(['porcupine', 'sapper', 'archer']))!.join() === '+boar,+wolf,+archer', `«Колючие заросли»: ${rosterChoices('thorns', 6, new Set(['porcupine', 'sapper', 'archer']))}`);
  assert(rosterChoices('ford', 9, new Set(['lynx', 'shaman'])) === null && rosterChoices('outpost', 8, new Set()) === null, 'fixed arenas');
  assert(rosterTitle('buttons', 'pack') === 'Стая' && rosterTitle('shields', '+archer') === 'Щитоносцы + лучники', 'titles');
});

// ---- Admission and the anchors, through runs ----

check(`${RUNS} runs: no roster brings a kind not seen on an earlier arena; «Поляна» of row 1 and the fixed arenas keep their own; an anchor arena is its own only at the first meeting of its kind on rows 1–3, else it gets one role of another class`, () => {
  let unseen = 0, anchorsOwn = 0, anchorsRole = 0, rostered = 0;
  for (const played of walks) {
    // What the player has seen: the kinds of the templates entered and of the rosters played (basic, wolves, boars from the start).
    const seen = new Set<string>(ALWAYS_MET);
    for (const entry of played) {
      const kinds = entry.roster !== undefined ? rosterKinds(rosterDef(entry.roster)!) : [];
      unseen += kinds.filter(kind => !seen.has(kind)).length;
      const anchor = ANCHOR_ARENAS[entry.arena];
      // The roster mix (11.10.2026): «Застава» and «Брод» — their own composition or a pool roster (checked below).
      if (entry.arena in MIXED_ROSTER_ARENAS) assert(entry.roster === undefined || rosterDef(entry.roster)!.mode === 'replace', `${entry.arena} row ${entry.row}: ${entry.roster}`);
      else if (FIXED_ROSTER_ARENAS.includes(entry.arena) || entry.arena === 'glade' && entry.row === 1) assert(entry.roster === undefined, `${entry.arena} row ${entry.row}: ${entry.roster}`);
      // Task 28 «Тюремщик в походе»: a new run's Jailer node plays the Jailer's fight — its own composition, no roster.
      else if (entry.type === 'checkpoint' && entry.arena === 'jailer') assert(entry.roster === undefined, `the Jailer's fight row ${entry.row}: ${entry.roster}`);
      // Task 48: the Troll's fight (the den branch's final of a new run) has no roster, as the Jailer's.
      else if (entry.arena === 'troll') assert(entry.roster === undefined, `the Troll's fight row ${entry.row}: ${entry.roster}`);
      // Task 57а (the flag on since 22.10.2026): «Осыпь» and «Пасека», the shooters' own arenas, keep their own composition.
      // Task 57б (RT_FOREST_TRICKS_ON on since 22.10.2026): «Трясина» and «Бурелом» keep their own composition as the shooters' arenas.
      else if (SHOOTER_RUN_ARENAS.includes(entry.arena) || TRICK_RUN_ARENAS.includes(entry.arena)) assert(entry.roster === undefined, `${entry.arena} row ${entry.row}: ${entry.roster}`);
      else if (anchor) {
        const pure = !seen.has(anchor.kind) && entry.row < ANCHOR_ROLE_ROW;
        assert((entry.roster === undefined) === pure, `${entry.arena} row ${entry.row}: ${entry.roster}, ${anchor.kind} ${seen.has(anchor.kind) ? 'seen' : 'unseen'}`);
        if (entry.roster === undefined) anchorsOwn++;
        else {
          anchorsRole++;
          const role = rosterDef(entry.roster)!;
          assert(role.mode === 'add' && rosterKinds(role).every(kind => KIND_ROLE[kind] !== KIND_ROLE[anchor.kind]), `${entry.arena}: a role of another class, not ${entry.roster}`);
        }
      } else assert(entry.roster !== undefined && rosterDef(entry.roster)!.mode === 'replace', `${entry.arena} row ${entry.row}: a pool roster, not ${entry.roster}`);
      if (entry.roster !== undefined) rostered++;
      for (const kind of [...templateKinds(entry.arena), ...kinds]) seen.add(kind);
    }
  }
  console.log(`   ${walks.reduce((sum, played) => sum + played.length, 0)} arenas, ${rostered} with a roster; anchors: own ${anchorsOwn}, with a role ${anchorsRole} (${(anchorsRole / (anchorsOwn + anchorsRole) * 100).toFixed(0)}%); rosters with an unseen kind: ${unseen}`);
  assert(unseen === 0, `rosters with an unseen kind: ${unseen}`);
});

check('the same seed and steps give the same rosters; different seeds — different roster sequences; the rosters do not spend the run\'s streams (the `pool` count is the number of arenas)', () => {
  for (let n = 0; n < 5; n++) {
    const again = walk(seedOf(n + 1), n + 1);
    assert(same(again.map(entry => [entry.arena, entry.roster]), walks[n].map(entry => [entry.arena, entry.roster])), `seed ${seedOf(n + 1)}: another sequence`);
  }
  const sequences = new Set(walks.slice(0, 20).map(played => played.map(entry => entry.roster ?? '-').join(',')));
  // Short pools (two rosters on the early rows): coincidences are allowed, a fixed sequence is not — as the arena sequences.
  assert(sequences.size >= 10, `roster sequences: ${sequences.size} of 20`);
  for (const played of walks.slice(0, 20)) for (const entry of played) assert(entry.run.streams.pool === entry.run.picks.filter(pick => pick.arena !== undefined).length, 'one pool draw per arena');
});

// ---- The roster mix (design decision 11.10.2026: «B half + A3») ----

/** FNV-1a of a text (a fingerprint of the walks). */
const fnv = (text: string): string => ([...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5)).toString(16);

check(`roster mix, ${RUNS} runs: «Застава» and «Брод» keep their own composition in some fights and take pool rosters in others, only of met kinds; «Шаманский щит» never on «Брод»; every pool roster comes`, () => {
  const byArena = new Map<string, Map<string, number>>(), runsWith = new Map<string, number>();
  for (const played of walks) {
    for (const entry of played) {
      if (!(entry.arena in MIXED_ROSTER_ARENAS)) continue;
      // Only met kinds: the rule's own meeting (`rosterMet`, the arenas entered before) holds every kind of the roster.
      const met = rosterMet(entry.run.picks.filter(pick => pick.arena !== undefined && pick.nodeId !== (entry.run.pending as { nodeId: string }).nodeId).map(pick => pick.arena!));
      if (entry.roster !== undefined) assert(rosterKinds(rosterDef(entry.roster)!).every(kind => ALWAYS_MET.includes(kind) || met.has(kind)), `${entry.arena} row ${entry.row}: ${entry.roster} with ${[...met]}`);
      assert(!(entry.arena === 'ford' && entry.roster === 'shaman-shield'), '«Шаманский щит» on «Брод»');
      const counts = byArena.get(entry.arena) ?? new Map<string, number>(), key = entry.roster ?? 'own';
      counts.set(key, (counts.get(key) ?? 0) + 1); byArena.set(entry.arena, counts);
    }
    for (const id of new Set(played.flatMap(entry => entry.roster !== undefined && rosterDef(entry.roster)!.mode === 'replace' ? [entry.roster] : []))) runsWith.set(id, (runsWith.get(id) ?? 0) + 1);
  }
  for (const arena of Object.keys(MIXED_ROSTER_ARENAS)) {
    const counts = byArena.get(arena)!, own = counts.get('own') ?? 0, fights = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`   ${arena}: ${fights} fights, own ${own}; ${[...counts].filter(([key]) => key !== 'own').map(([key, n]) => `${key} ${n}`).join(', ')}`);
    assert(own > 0 && own < fights, `${arena}: own composition ${own} of ${fights}`);
  }
  // The pool rosters that never came before the mix (docs/realtime-phase-a.md, section 4) come now; frequencies are not asserted.
  // «Шаманский щит» is the recorded exception (design 11.10.2026): with «Логово» on rows 6–8 the shaman is met too late for
  // «Застава» (never on «Брод»), so it almost never comes — not required here.
  console.log(`   runs with each pool roster: ${POOL_ROSTERS.map(def => `${def.id} ${runsWith.get(def.id) ?? 0}`).join(', ')}`);
  // Task 57а: «Светляки» (`wisps`) is the schedule's lesson of the wisp in a run with `forestShooters` — never in these pool runs. Task 57б:
  // «Корневики» and «Головешки» are the schedule's lessons of a run with `forestTricks` likewise.
  // Task 57б (RT_FOREST_TRICKS_ON on since 22.10.2026): «Охота» (the lynx and the archer met) came in 2 of these 300 runs before the flag
  // and in none with it — «Трясина» and «Бурелом» take ordinary nodes by the own-arena rule; checked on the runs without the flag below.
  for (const def of POOL_ROSTERS) if (!['shaman-shield', 'wisps', 'rootlings', 'firebrands', 'hunt'].includes(def.id)) assert((runsWith.get(def.id) ?? 0) > 0, `${def.id}: in no run`);
  const huntBefore = Array.from({ length: RUNS }, (_, n) => walk(seedOf(n + 1), n + 1, true, false)).filter(played => played.some(entry => entry.roster === 'hunt')).length;
  console.log(`   «Охота»: runs with it — ${runsWith.get('hunt') ?? 0} with the mechanics, ${huntBefore} without them`);
  assert(huntBefore > 0, `hunt: in no run without the mechanics (${huntBefore})`);
});

check(`roster mix off: the arenas and rosters of ${RUNS} runs are those before 11.10.2026 (the fingerprint of the walks at 99af5fb), «Застава» and «Брод» keep their own composition`, () => {
  const off = Array.from({ length: RUNS }, (_, n) => walk(seedOf(n + 1), n + 1, false));
  assert(off.every(played => played.every(entry => !(entry.arena in MIXED_ROSTER_ARENAS) || entry.roster === undefined)), 'a roster on «Застава» or «Брод» without the mix');
  assert(off.every(played => played.every(entry => entry.run.rosterMix === undefined)), 'no flag in the save');
  const print = fnv(off.map(played => played.map(entry => `${entry.arena}/${entry.roster ?? '-'}`).join(',')).join('|'));
  assert(print === '84916ad7', `fingerprint ${print}, at 99af5fb 84916ad7`);
  // A new run has the mix (the run turns it on, RT_RUN_FORCED) and plays other choices.
  assert(RT_RUN_FORCED.rosterMix === true && defaultParams().rosterMix === false && createRtRun(seedOf(1)).rosterMix === true, 'the run turns the mix on');
  assert(fnv(walks.map(played => played.map(entry => `${entry.arena}/${entry.roster ?? '-'}`).join(',')).join('|')) !== print, 'the mix changes the choices');
  console.log(`   fingerprint ${print} (99af5fb: 84916ad7)`);
});

check('a save before the roster mix (written by 99af5fb, the open «Брод» after «Логово» on run row 2) loads unchanged and plays on by the old rule; a mixed save without its flag, or with another value, is no run', () => {
  const text = (saveBeforeMix as { save: string }).save, run = parseRtRun(text);
  assert(run && serializeRtRun(run) === text && run.rosterMix === undefined, 'the old save loads unchanged');
  const pending = run.pending as { kind: string; arena: string; roster?: string; nodeId: string };
  assert(pending.kind === 'battle' && pending.arena === 'ford' && pending.roster === undefined, `the open battle: ${pending.arena}/${pending.roster}`);
  // The same save under the mix: «Логово» on row 2 is not a choice of its pools — the flag is what keeps it a run.
  assert(parseRtRun(JSON.stringify({ ...JSON.parse(text), rosterMix: true })) === null, 'the old save read under the mix');
  const won = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'win the old save\'s «Брод»');
  assert(same(roundTrip(won), won), 'plays on and saves');
  let tried = 0;
  for (const played of walks) {
    const entry = played.find(e => e.arena in MIXED_ROSTER_ARENAS && e.roster !== undefined);
    if (!entry) continue;
    const copy = JSON.parse(serializeRtRun(entry.run)) as Record<string, unknown>;
    assert(copy.rosterMix === true, 'a new run saves its flag');
    delete copy.rosterMix;
    assert(parseRtRun(JSON.stringify(copy)) === null, `a mixed save without the flag: ${entry.arena}/${entry.roster}`);
    assert(parseRtRun(JSON.stringify({ ...copy, rosterMix: false })) === null, 'rosterMix: false');
    if (++tried >= 10) break;
  }
  assert(tried >= 10, `mixed saves tried: ${tried}`);
});

// ---- The save ----

check(`save version ${RT_RUN_VERSION}: rosters load back and are chosen again — another roster, a missing one, one on a fixed arena or an open arena with another roster read as no run; a version 4 or 5 save is no run`, () => {
  assert(RT_RUN_VERSION === 7, `version ${RT_RUN_VERSION}`);
  let tried = 0;
  for (const played of walks.slice(0, 60)) {
    const rostered = played.find(entry => entry.roster !== undefined && entry.run.picks.filter(pick => pick.arena).length > 1);
    const fixed = played.find(entry => entry.roster === undefined);
    if (!rostered || !fixed) continue;
    const run = rostered.run, nodeId = (run.pending as { nodeId: string }).nodeId;
    assert(same(roundTrip(run), run), 'loads back');
    const other = POOL_ROSTERS.find(def => def.id !== rostered.roster)!.id;
    const edit = (change: (copy: RtRunState) => void): string => { const copy = structuredClone(run); change(copy); return serializeRtRun(copy); };
    const pickOf = (copy: RtRunState) => copy.picks.find(pick => pick.nodeId === nodeId)!;
    const bad = [
      edit(copy => { pickOf(copy).roster = other; (copy.pending as { roster?: string }).roster = other; }),
      edit(copy => { delete pickOf(copy).roster; delete (copy.pending as { roster?: string }).roster; }),
      edit(copy => { (copy.pending as { roster?: string }).roster = other; }),
      edit(copy => { delete (copy.pending as { roster?: string }).roster; }),
      edit(copy => { pickOf(copy).roster = 'no-such-roster'; }),
      edit(copy => { copy.version = 4 as typeof RT_RUN_VERSION; }),
      edit(copy => { copy.version = 5 as typeof RT_RUN_VERSION; }),
    ];
    // A roster on an arena of its own composition (a pick of the same run before the open one).
    const ownPick = run.picks.find(pick => pick.arena !== undefined && pick.roster === undefined && pick.nodeId !== nodeId);
    if (ownPick) bad.push(edit(copy => { copy.picks.find(pick => pick.nodeId === ownPick.nodeId)!.roster = 'onslaught'; }));
    for (const text of bad) assert(parseRtRun(text) === null, `accepted: ${text.slice(0, 80)}`);
    tried++;
  }
  assert(tried >= 10, `runs tried: ${tried}`);
});

// ---- The journal ----

/** A fight where the hero cannot fall (no damage), the arena's own pace. */
function harmless(): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 40; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0;
  return p;
}

check('a run arena with a roster replays from its journal (with `roster`) to the same hash; without the field the journal plays the template (the browser fixtures keep their hashes)', () => {
  const entry = walks.flatMap(played => played).find(e => e.roster !== undefined && e.arena === 'buttons')!;
  const pending = entry.run.pending as { arena: string; seed: number; roster?: string };
  const sim = new Simulation({ arena: pending.arena, params: defaultParams(), seed: pending.seed, record: true, hero: { hp: entry.run.hp, maxHp: entry.run.maxHp }, loadout: rtArenaLoadout(entry.run), roster: pending.roster });
  sim.command({ t: 'walk', x: 1, y: 0 });
  for (let i = 0; i < 900 && sim.world.status === 'playing'; i++) sim.tick();
  const journal = sim.exportJournal()!;
  assert(journal.roster === pending.roster && journal.version === 1, `journal roster ${journal.roster}`);
  assert(replay(JSON.parse(JSON.stringify(journal)) as Journal).hash() === sim.hash(), 'replay with the roster');
  // The same journal without the field is the template's fight: a simulation of the template, not of the roster.
  const bare = { ...journal } as Journal; delete bare.roster;
  const template = new Simulation({ arena: pending.arena, params: defaultParams(), seed: pending.seed, hero: { hp: entry.run.hp, maxHp: entry.run.maxHp }, loadout: rtArenaLoadout(entry.run) });
  template.command({ t: 'walk', x: 1, y: 0 });
  for (let i = 0; i < journal.ticks; i++) template.tick();
  assert(replay(bare).hash() === template.hash() && template.hash() !== sim.hash(), 'without `roster` — the template');
  // A template made by `withRoster` is journalled with its roster too (the page passes it so, main.ts).
  const made = new Simulation({ arena: withRoster(arenaTemplate(pending.arena), pending.roster!), params: defaultParams(), seed: pending.seed, record: true, hero: { hp: entry.run.hp, maxHp: entry.run.maxHp }, loadout: rtArenaLoadout(entry.run) });
  assert(made.exportJournal()!.roster === pending.roster && made.hash() === new Simulation({ arena: pending.arena, params: defaultParams(), seed: pending.seed, hero: { hp: entry.run.hp, maxHp: entry.run.maxHp }, loadout: rtArenaLoadout(entry.run), roster: pending.roster }).hash(), 'withRoster = the option');
  for (const fixture of [browserJournal, shieldsWolvesJournal] as unknown as { hash: string; journal: Journal }[]) {
    assert(fixture.journal.roster === undefined && replay(fixture.journal).hash() === fixture.hash, `fixture ${fixture.journal.arena}: ${replay(fixture.journal).hash()} vs ${fixture.hash}`);
  }
  console.log(`   ${journal.ticks} ticks on «${pending.arena}» with «${pending.roster}», hash ${sim.hash()}; fixtures ${browserJournal.hash}, ${shieldsWolvesJournal.hash}`);
});

// ---- Counts for the document (printed) ----

check(`counts over ${RUNS} runs: rosters by run row, the pairs «layout × roster» per run`, () => {
  const label = (entry: Played) => entry.roster === undefined ? (ANCHOR_ARENAS[entry.arena] ? `${entry.arena}:own` : 'own') : entry.roster;
  const byRow = new Map<string, number[]>(), runsWith = new Map<string, number>();
  for (const played of walks) {
    for (const entry of played) {
      const key = label(entry);
      if (!byRow.has(key)) byRow.set(key, Array(11).fill(0));
      byRow.get(key)![entry.row]++;
    }
    for (const key of new Set(played.map(label))) runsWith.set(key, (runsWith.get(key) ?? 0) + 1);
  }
  const order = [...POOL_ROSTERS, ...ANCHOR_ROLES].map(def => def.id).concat(Object.keys(ANCHOR_ARENAS).map(arena => `${arena}:own`), ['own']);
  console.log(`   roster | rows 1–9 (row 10 — the final) | runs`);
  for (const key of order) {
    const rows = byRow.get(key) ?? Array(11).fill(0);
    console.log(`   ${key.padEnd(16)} ${rows.slice(1).map(n => String(n).padStart(4)).join('')} | ${runsWith.get(key) ?? 0}`);
  }
  const pairs = walks.map(played => new Set(played.map(entry => `${entry.arena}|${entry.roster ?? '-'}`)).size);
  const arenas = walks.map(played => new Set(played.map(entry => entry.arena)).size);
  const all = new Set(walks.flatMap(played => played.map(entry => `${entry.arena}|${entry.roster ?? '-'}`)));
  const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
  console.log(`   pairs «layout × roster» per run: min ${Math.min(...pairs)}, mean ${mean(pairs)}, max ${Math.max(...pairs)} (distinct arenas per run: min ${Math.min(...arenas)}, mean ${mean(arenas)}, max ${Math.max(...arenas)}); arenas played per run ${mean(walks.map(p => p.length))}; distinct pairs over all runs ${all.size}`);
  const total = walks.reduce((sum, p) => sum + p.length, 0), withRoster = walks.reduce((sum, p) => sum + p.filter(e => e.roster !== undefined).length, 0);
  console.log(`   arenas with a roster: ${withRoster} of ${total} (${(withRoster / total * 100).toFixed(1)}%)`);
  const runsOf = (arena: string) => walks.filter(played => played.some(entry => entry.arena === arena)).length;
  console.log(`   the arenas as in c8df2d4: «Рысье логово» in ${runsOf('lynx-den')} runs, «Круг шамана» ${runsOf('shaman-circle')}, «Брод» ${runsOf('ford')}`);
  assert(Math.min(...pairs) >= Math.min(...arenas), 'a pair per arena at least');
});

/** Kinds of the newcomers that stepped out in `seconds` (the arena's own pace, the hero cannot fall). */
function newcomerKinds(arena: string, roster: string | undefined, seed: number, seconds: number): string[] {
  const sim = new Simulation({ arena, params: harmless(), seed, ...roster !== undefined ? { roster } : {} }), seen = new Map<number, string>();
  const start = new Set(sim.world.enemies.map(e => e.id));
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick();
    for (const ev of sim.world.events) {
      const kind = ev.type === 'spawn' && !start.has(ev.enemyId) ? sim.world.enemies.find(e => e.id === ev.enemyId)?.kind : undefined;
      if (ev.type === 'spawn' && kind) seen.set(ev.enemyId, kind);
    }
    sim.world.events.length = 0;
  }
  return [...seen.values()];
}
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

check('kinds in 60 s with each roster (6 seeds): the roster\'s kinds come, no other kind but basic enemies (and the anchor); an anchor keeps its share with a role', () => {
  const measure = (arena: string, roster: string | undefined) => {
    const all = [1, 2, 3, 4, 5, 6].flatMap(k => newcomerKinds(arena, roster, seedOf(k + 60), 60));
    const counts = new Map<string, number>();
    for (const kind of all) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return { total: all.length, share: (kind: string) => (counts.get(kind) ?? 0) / all.length, kinds: [...counts.keys()] };
  };
  for (const def of POOL_ROSTERS) {
    const m = measure('buttons', def.id), allowed = ['basic', ...rosterKinds(def)];
    assert(rosterKinds(def).every(kind => m.share(kind) > 0) && m.kinds.every(kind => allowed.includes(kind)), `${def.id} on «Двор кнопок»: ${m.kinds}`);
    console.log(`   «${def.title}» (Двор кнопок): ${m.total} newcomers — ${allowed.map(kind => `${kind} ${pct(m.share(kind))}`).join(', ')}`);
  }
  // Each role on an anchor of another role: «Стена щитов», the shield role on «Пороховой склад».
  for (const def of ANCHOR_ROLES) {
    const arena = def.id === '+shield' ? 'powder' : 'shields', anchor = ANCHOR_ARENAS[arena].kind;
    const own = measure(arena, undefined), m = measure(arena, def.id), allowed = ['basic', anchor, ...rosterKinds(def)];
    assert(rosterKinds(def).every(kind => m.share(kind) > 0) && m.kinds.every(kind => allowed.includes(kind)), `${def.id} on ${arena}: ${m.kinds}`);
    assert(Math.abs(m.share(anchor) - own.share(anchor)) < 0.08, `${def.id} on ${arena}: ${anchor} ${pct(m.share(anchor))}, own ${pct(own.share(anchor))}`);
    console.log(`   «${rosterTitle(arena, def.id)}» (${arena}): ${m.total} — ${allowed.map(kind => `${kind} ${pct(m.share(kind))}`).join(', ')} (own: ${anchor} ${pct(own.share(anchor))})`);
  }
});

check('«Натиск» caps its boars at 5 (design 09.10.2026), not the panel\'s 3: boars on the arena, at markers and in the queue reach 4–5 and never pass 5; the same arena with «Волки» keeps the panel cap', () => {
  const peak = (roster: string, k: number): number => {
    const sim = new Simulation({ arena: 'buttons', params: harmless(), seed: seedOf(k + 80), roster }), w = sim.world;
    let most = 0;
    for (let i = 0; i < 90 * 60; i++) {
      sim.tick(); w.events.length = 0;
      const boars = w.enemies.filter(e => e.kind === 'boar').length + w.markers.filter(m => m.kind === 'boar').length + w.queue.filter(q => q.kind === 'boar').length;
      most = Math.max(most, boars);
    }
    return most;
  };
  const onslaught = [1, 2, 3, 4].map(k => peak('onslaught', k));
  assert(withRoster(arenaTemplate('buttons'), 'onslaught').boarMax === 5 && onslaught.every(n => n <= 5) && Math.max(...onslaught) > 3, `«Натиск»: boar peaks ${onslaught}`);
  assert(harmless().boarMax === 3 && withRoster(arenaTemplate('buttons'), 'wolves').boarMax === undefined, 'other rosters keep the panel cap');
  console.log(`   «Натиск» on «Двор кнопок», 90 s: boar peaks ${onslaught.join(', ')} (cap 5; the panel's 3)`);
});

console.log(`realtime-rosters: ${checks} checks passed`);
