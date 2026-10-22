/**
 * Task 12 «Отмеченные — атаман или орда» (design 13.10.2026; docs/realtime-slice.md, section 5). Node only:
 * `npm run test:realtime-marked-goals`.
 *
 * The user's report (playtest v40): on the arenas where every marked enemy must die they must not be lone enemies — either one
 * enemy with raised HP or many standing together. Every check plays the simulation through journalled commands (teleport,
 * place, begin, drag, release, walk) or walks real runs through the run's own steps, and looks at what the player meets:
 * - the goal of every `marked` arena of the run, as a run of each of its rows starts it: a horde (8+ marked within the horde's
 *   radius of one point, two colours) or one or two leaders with HP above the row's tough HP — no lone marked enemy;
 * - real chains: one chain through the horde with the colour shift kills most of it (the highlight says the same), the
 *   goal completes and the door lets the hero out; a long chain kills the leader, a shorter one only wounds it, a brazier
 *   makes the shorter one enough;
 * - the leader's HP grows with the row by the run's tough table; it is drawn and reached like an elite;
 * - the old path: without the key (old journals) and in a run without the flag (old saves) the old layouts; the choice of
 *   arenas and rosters is the same with and without the flag.
 * Seeds: `Math.imul(k, 2654435761) >>> 0`.
 */
// Task 50: the knack screen of a run (RT_KNACKS_ON) is passed over — «Пропустить» — where the route knows only the screens of before.
import { rtChooseKnack } from './rtRun';
import { arenaTemplate, LEADER_HP_OVER_TOUGH, markedCount, type ArenaTemplate } from '../sim/arenas';
import '../sim/arenasStage3';
import { beginChain, cancelChain, dragChain, nextCandidates, planChain } from '../sim/chain';
import { enemyArtRadius, artRadiusOf } from '../sim/enemies/kinds';
import { dist } from '../sim/geometry';
import { worldState } from '../sim/hash';
import { defaultParams, type Params } from '../sim/params';
import { replay, Simulation, type Journal } from '../sim/simulation';
import { toughHpMaxOf } from '../sim/spawn';
import type { Enemy, World } from '../sim/world';
import { ARENA_POOLS, RUN_ARENAS, runRow } from './arenaPools';
import {
  createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtItemRefusal, rtChooseHammer, rtChooseTalisman, rtEnterNode,
  rtEventView, rtNode, rtRestHeal, rtRunParams, rtShopLeave, rtToughHp, serializeRtRun, RT_RUN_FORCED, type RtRunState, type RtRunStep,
} from './rtRun';
import { quiet, takeGift } from './runFight.testkit';
import { goalText, nodeDangers } from '../view/nodeCard';
import saveBeforeMix from '../../../tests/fixtures/rt-run-save-before-mix.json';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ok = (step: RtRunStep, what: string): RtRunState => { if (!step.ok) throw new Error(`${what}: ${step.reason}`); return step.run; };

/** The `marked` arenas of the run (every pool arena, the hard battle and the final are read from the run's own list). */
const MARKED_ARENAS = RUN_ARENAS.filter(id => arenaTemplate(id).goal === 'marked');
/** The horde rule of the design: at least this many marked, all within `HORDE_RADIUS` of their common centre. */
const HORDE_MIN = 8, HORDE_RADIUS = 2;
const centre = (es: readonly { x: number; y: number }[]) => ({ x: es.reduce((s, e) => s + e.x, 0) / es.length, y: es.reduce((s, e) => s + e.y, 0) / es.length });
const markedOf = (w: World): Enemy[] => w.enemies.filter(e => e.marked);
const ticks = (sim: Simulation, n: number, until: (w: World) => boolean = () => false): void => {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); sim.world.events.length = 0; }
};

/** A quiet run fight on `arena` with the goal layouts (or without): the run's rules (colour shift …), nobody walks or comes. */
function quietFight(arena: string, markedGoals: boolean, seed = seedOf(1), extra: Partial<Params> = {}): Simulation {
  return new Simulation({ arena, params: { ...rtRunParams(quiet(extra)), markedGoals }, seed, record: true });
}

/** The shape of a world's goal: a horde (with its centre) or leaders; throws on lone marked enemies. */
function goalShape(w: World, row: number): { horde: boolean; marked: number; leaders: Enemy[]; colours: number } {
  const marked = markedOf(w), leaders = marked.filter(e => e.leader);
  const colours = new Set(marked.map(e => e.color)).size;
  if (leaders.length) {
    // The design (13.10.2026): exactly one leader on a leader arena, and no other marked enemy beside it.
    assert(leaders.length === 1 && marked.length === 1, `${w.arena.id}: leaders ${leaders.length}, marked ${marked.length}`);
    // Above the row's tough HP: a tough newcomer of the row never has as much.
    for (const e of leaders) assert(e.hp > rtToughHp(row) && e.hp >= toughHpMaxOf(w) + LEADER_HP_OVER_TOUGH, `${w.arena.id} row ${row}: leader HP ${e.hp}, tough ${rtToughHp(row)}`);
    return { horde: false, marked: marked.length, leaders, colours };
  }
  const c = centre(marked), far = Math.max(...marked.map(e => dist(e, c)));
  assert(marked.length >= HORDE_MIN && far <= HORDE_RADIUS, `${w.arena.id}: ${marked.length} marked, the farthest ${far.toFixed(2)} from their centre — neither a horde nor a leader`);
  assert(colours >= 2, `${w.arena.id}: a horde of one colour`);
  return { horde: true, marked: marked.length, leaders, colours };
}

// ---- Real runs: the arenas a run enters, as it starts them ----

interface Fight { row: number; arena: string; roster?: string; run: RtRunState }
/** A run walked by its own steps (fights won at once): every battle it opens. `markedGoals` — the run's flag. */
// Task 57а (the flag on since 22.10.2026): the pools without the forest's shooters — with them the overdue «Осыпь» and «Пасека» take
// run row 8, the only row «Логово» came on in these 120 runs (2 runs before the flag, none with it); the layouts are the subject here.
function walk(seed: number, k: number, markedGoals?: boolean): Fight[] {
  let run = createRtRun(seed, { gift: 'mini', garrison: false, forestShooters: false, ...markedGoals !== undefined ? { markedGoals } : {} });
  const fights: Fight[] = [];
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'gift') run = takeGift(run);
    else if (pending?.kind === 'battle') {
      fights.push({ row: runRow(rtNode(run, pending.nodeId)!.row), arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, run });
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'fake win');
    } else if (pending?.kind === 'hammer') run = ok(rtChooseTalisman(ok(rtChooseHammer(run, null), 'refuse hammer'), null), 'refuse');
    else if (pending?.kind === 'knack') run = ok(rtChooseKnack(run, null), 'knack');
    else if (pending?.kind === 'talisman') run = ok(rtChooseTalisman(run, null), 'refuse');
    else if (pending?.kind === 'rest') run = ok(rtRestHeal(run), 'rest');
    else if (pending?.kind === 'find') run = ok(rtChooseFind(run, pending.options.find(item => !rtItemRefusal(run, item)) ?? pending.options[0]), 'find');
    else if (pending?.kind === 'shop') run = ok(rtShopLeave(run), 'shop');
    else if (pending?.kind === 'event') run = ok(rtChooseEventOption(run, rtEventView(run)!.options.find(option => option.available)!.id), 'event');
    else if (pending) throw new Error(`unexpected screen ${pending.kind}`);
    else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, next[(k + step) % next.length].id), 'enter'); }
  }
  return fights;
}
/** The world a run's battle starts with — the values, loadout and roster the run view gives it (main.ts, runView.ts). */
const startOf = (fight: Fight): Simulation => new Simulation({
  arena: fight.arena, params: rtArenaParams(fight.run, rtRunParams(defaultParams())), seed: seedOf(fight.row), loadout: rtArenaLoadout(fight.run),
  hero: { hp: fight.run.hp, maxHp: fight.run.maxHp }, ...fight.roster !== undefined ? { roster: fight.roster } : {},
});

const RUNS = 120;
const walks = Array.from({ length: RUNS }, (_, n) => walk(seedOf(n + 1), n + 1));

check(`every marked arena of the run (${MARKED_ARENAS.join(', ')}) has a goal layout; ${RUNS} runs: each one a run starts is a horde or leaders, never lone marked enemies`, () => {
  assert(MARKED_ARENAS.length === 4, `marked arenas of the run: ${MARKED_ARENAS}`);
  for (const id of MARKED_ARENAS) assert(arenaTemplate(id).markedGoal, `${id}: no goal layout`);
  const seen = new Map<string, { fights: number; rows: Set<number>; shape: string }>();
  for (const fights of walks) for (const fight of fights) {
    if (!MARKED_ARENAS.includes(fight.arena)) continue;
    assert(fight.run.markedGoals === true, 'a new run has the flag');
    const w = startOf(fight).world, shape = goalShape(w, fight.row);
    // The layout in play: its marked are the goal (the HUD counts them), the horde centre the view marks is theirs.
    assert(markedCount(w.arena) === shape.marked, `${fight.arena}: goal total ${markedCount(w.arena)} of ${shape.marked}`);
    if (shape.horde) {
      const h = w.arena.horde!;
      assert(h && markedOf(w).every(e => dist(e, h) <= h.r + 1e-9), `${fight.arena}: the horde mark (${JSON.stringify(h)}) holds every marked enemy`);
    } else assert(w.arena.horde === undefined, `${fight.arena}: no horde mark on a leader layout`);
    const entry = seen.get(fight.arena) ?? { fights: 0, rows: new Set<number>(), shape: shape.horde ? `horde ${shape.marked}, ${shape.colours} colours` : `leader HP ${shape.leaders.map(e => e.hp)}` };
    entry.fights++; entry.rows.add(fight.row); seen.set(fight.arena, entry);
  }
  for (const id of MARKED_ARENAS) {
    const entry = seen.get(id);
    assert(entry, `${id}: in no run of ${RUNS}`);
    console.log(`   ${id}: ${entry.fights} fights, rows ${[...entry.rows].sort().join(',')}; ${entry.shape}`);
  }
});

check('«Логово» is a horde of 12 in the den\'s centre (two colours, six tough); the three others are one leader each — «Стрелковая гряда» and «Брод» an archer, «Круг шамана» a shaman', () => {
  const den = quietFight('marked', true).world, shape = goalShape(den, 7);
  assert(shape.horde && shape.marked === 12 && shape.colours === 2, `«Логово»: ${JSON.stringify(shape)}`);
  assert(markedOf(den).filter(e => e.hp >= 3).length === 6, 'six tough');
  for (const [id, kind] of [['archers', 'archer'], ['ford', 'archer'], ['shaman-circle', 'shaman']] as const) {
    const w = quietFight(id, true).world, leaders = markedOf(w);
    assert(leaders.length === 1 && leaders[0].leader === true && leaders[0].kind === kind, `${id}: ${leaders.map(e => `${e.kind}${e.leader ? '*' : ''}`)}`);
    // The others of the old goal stand unmarked at their posts (the archers and wolves of «Брод», the archers of the ridge).
    console.log(`   ${id}: leader ${kind} HP ${leaders[0].hp}; ${w.enemies.length - 1} other start enemies, unmarked`);
  }
});

check('the leader\'s HP by the row: max(its own, the row\'s tough HP + 2) — read from the run\'s table (`rtToughHp`) through the kit, as the tough newcomers', () => {
  const rows: string[] = [];
  for (const id of MARKED_ARENAS.filter(a => !arenaTemplate(a).markedGoal!.horde)) {
    const own = arenaTemplate(id).markedGoal!.enemies.find(e => e.leader)!.hp!, pool = ARENA_POOLS.find(entry => entry.arena === id)!;
    const byRow: string[] = [];
    for (let row = 1; row <= 9; row++) {
      // The loadout the run gives a battle of that row (`rtArenaLoadout`: the tough table only above 2).
      const sim = new Simulation({ arena: id, params: { ...rtRunParams(quiet()), markedGoals: true }, seed: seedOf(row), loadout: rtToughHp(row) > 2 ? { toughHp: rtToughHp(row) } : {} });
      const leader = markedOf(sim.world)[0];
      assert(leader.hp === Math.max(own, rtToughHp(row) + LEADER_HP_OVER_TOUGH), `${id} row ${row}: HP ${leader.hp}, own ${own}, tough ${rtToughHp(row)}`);
      if (row >= pool.rows[0] && row <= pool.rows[1]) byRow.push(`${row}:${leader.hp}`);
    }
    rows.push(`${id} ${byRow.join(' ')}`);
  }
  // The table is read, not copied: task 17 moves it, the leader follows (a loadout of tough 4 on any row gives the archer 6).
  const raised = new Simulation({ arena: 'archers', params: { ...rtRunParams(quiet()), markedGoals: true }, seed: 1, loadout: { toughHp: 4 } });
  assert(markedOf(raised.world)[0].hp === 6, `tough 4 → leader ${markedOf(raised.world)[0].hp}`);
  console.log(`   ${rows.join('; ')}; the ridge with tough 4 → 6`);
});

check('the leader is reached and pressed like an elite: its art radius (the reach edge of a link and the press circle) is × `eliteArtScale`, its body as before; no other enemy has the field', () => {
  const w = quietFight('archers', true).world, leader = markedOf(w)[0], other = w.enemies.find(e => !e.marked)!;
  assert(Math.abs(enemyArtRadius(w.params, leader) - artRadiusOf(w.params, 'archer') * w.params.eliteArtScale) < 1e-9, 'the leader\'s art');
  assert(enemyArtRadius(w.params, other) === artRadiusOf(w.params, 'archer') && other.leader === undefined && !('leader' in other), 'the others');
});

// ---- Real chains ----

/**
 * The best chain of marked links from the hero, found as a player plans it: every route over the marked enemies in reach
 * (`beginChain`/`dragChain` on the world, put back after each try — nothing is journalled), the one whose highlight kills
 * most. It is then drawn by journalled commands and released; returns what its highlight said and its length.
 */
function hordeChain(sim: Simulation): { planned: number; links: number } {
  const w = sim.world;
  let best: Enemy[] = [], bestKills = -1;
  const killed = () => planChain(w).links.filter(l => l.outcome?.killed && w.enemies.find(e => e.id === l.link.id)?.marked).length;
  const search = (route: Enemy[]): void => {
    const n = killed();
    if (n > bestKills) { bestKills = n; best = [...route]; }
    if (planChain(w).endsOnSurvivor) return;
    for (const e of nextCandidates(w).filter(x => x.marked)) {
      const saved = [...w.chain];
      dragChain(w, e, 'full');
      if (w.chain.length > saved.length) search([...route, e]);
      w.chain = saved;
    }
  };
  for (const start of nextCandidates(w).filter(e => e.marked)) { beginChain(w, start); search([start]); cancelChain(w); }
  assert(best.length, 'a marked enemy in reach');
  sim.command({ t: 'begin', x: best[0].x, y: best[0].y });
  for (const e of best.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  const planned = killed(), links = w.chain.length;
  assert(planned === bestKills && links === best.length, `drawn again: ${planned} of ${bestKills}, ${links} links`);
  sim.command({ t: 'release' });
  ticks(sim, 900, world => !world.move);
  return { planned, links };
}

check('«Логово»: one chain through the horde with the colour shift kills most of it (the highlight says as much), a few more chains finish it, the door opens and the hero walks out', () => {
  const results: string[] = [];
  for (let k = 1; k <= 4; k++) {
    const sim = quietFight('marked', true, seedOf(k)), w = sim.world, total = markedOf(w).length;
    // The hero steps up to the horde's west side.
    sim.command({ t: 'teleport', x: 6.6, y: 4.9 });
    const first = hordeChain(sim), killed = total - markedOf(w).length;
    assert(killed === first.planned && w.stats.markedKills === killed, `the highlight ${first.planned}, the dash ${killed}`);
    // Most of it: the shift after six links of one colour carries the chain into the other colour (9 of 12: six, then three).
    assert(killed >= 8, `one chain: ${killed} of ${total}`);
    let chains = 1;
    while (markedOf(w).length && chains < 20) {
      const near = markedOf(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
      sim.command({ t: 'teleport', x: near.x - 1.2, y: near.y });
      hordeChain(sim); chains++;
    }
    assert(!markedOf(w).length && w.stage === 'greed', `the goal: ${w.stats.markedKills} of ${total}, stage ${w.stage}`);
    sim.command({ t: 'teleport', x: w.arena.door.x - 1.2, y: w.arena.door.y });
    sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(sim, 300);
    assert(sim.world.status === 'victory', `the door: ${sim.world.status}`);
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal).hash() === sim.hash(), 'the fight replays from its journal');
    results.push(`seed ${seedOf(k)}: first chain ${killed} of ${total} (${first.links} links), ${chains} chains`);
  }
  console.log(`   ${results.join('; ')}`);
});

/**
 * A chain to the leader of `arena` on run row `row` (the run's loadout of that row): weak links of the leader's colour placed
 * by commands at the points of `path` marked `weak` (a brazier — by its point), the hero 1.1 behind the first link, then the
 * leader as the last link; drawn and released by commands. Checks that the dash does what the highlight said (the leader's HP
 * after it, the kills) and that the fight replays from its journal.
 */
function leaderChain(arena: string, row: number, path: readonly { x: number; y: number; weak?: boolean }[]): { sim: Simulation; leader: Enemy; plannedKill: boolean; hpBefore: number } {
  const sim = new Simulation({ arena, params: { ...rtRunParams(quiet()), markedGoals: true }, seed: seedOf(row), record: true, loadout: rtToughHp(row) > 2 ? { toughHp: rtToughHp(row) } : {} });
  const w = sim.world, leader = markedOf(w)[0];
  for (const p of path) if (p.weak) sim.command({ t: 'place', x: p.x, y: p.y, color: leader.color, hp: 0, kind: 'basic' });
  const [a, b] = path, d = Math.hypot(a.x - b.x, a.y - b.y);
  sim.command({ t: 'teleport', x: a.x + (a.x - b.x) / d * 1.1, y: a.y + (a.y - b.y) / d * 1.1 });
  assert(sim.command({ t: 'begin', x: a.x, y: a.y }) === true, `${arena}: the chain begins`);
  for (const p of [...path.slice(1), leader]) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === path.length + 1, `${arena}: the chain took ${w.chain.length} of ${path.length + 1} links`);
  const plan = planChain(w), last = plan.links[plan.links.length - 1].outcome!, plannedKill = last.killed, hpBefore = leader.hp, kills = w.stats.kills;
  sim.command({ t: 'release' });
  ticks(sim, 900, world => !world.move);
  const hpAfter = w.enemies.includes(leader) ? leader.hp : 0;
  assert(hpAfter === last.hpAfter && w.stats.kills - kills === plan.kills, `${arena}: the dash — HP ${hpAfter}, kills ${w.stats.kills - kills}; the highlight — HP ${last.hpAfter}, kills ${plan.kills}`);
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal).hash() === sim.hash(), `${arena}: replays`);
  return { sim, leader, plannedKill, hpBefore };
}

check('the leader archers: «Стрелковая гряда» on row 4 (HP 5) — four weak links and the leader kill it and the goal, three only wound it; «Брод» (HP 6) — five kill it, four wound it', () => {
  const lines: string[] = [];
  for (const [arena, row, hp, path] of [
    ['archers', 4, 5, [{ x: 14.6, y: 6.4 }, { x: 14.3, y: 5.4 }, { x: 13.9, y: 4.4 }, { x: 13.5, y: 3.4 }]],
    ['ford', 6, 6, [{ x: 23.2, y: 12.2 }, { x: 22.8, y: 11.2 }, { x: 22.4, y: 10.2 }, { x: 21.9, y: 9.3 }, { x: 21.3, y: 8.5 }]],
  ] as const) {
    const weak = path.map(p => ({ ...p, weak: true })), full = leaderChain(arena, row, weak);
    assert(full.hpBefore === hp && full.plannedKill && !full.sim.world.enemies.includes(full.leader) && full.sim.world.stage === 'greed', `${arena}: ${weak.length} weak — HP ${full.hpBefore}, planned ${full.plannedKill}, stage ${full.sim.world.stage}`);
    const short = leaderChain(arena, row, weak.slice(1));
    assert(!short.plannedKill && short.sim.world.enemies.includes(short.leader) && short.leader.hp === 1 && short.sim.world.stage === 'goals', `${arena}: ${weak.length - 1} weak — planned ${short.plannedKill}, HP ${short.leader.hp}`);
    lines.push(`${arena} row ${row}: ${weak.length} weak — killed (HP ${hp}); ${weak.length - 1} weak — HP ${hp} → 1`);
  }
  console.log(`   ${lines.join('; ')}`);
});

check('«Круг шамана»: five weak links before the leader (HP 6) kill it and the goal; four only wound it (a reserve: a next chain chips it on); three and a brazier (+2) kill it', () => {
  const line = [{ x: 6.3, y: 6.7 }, { x: 6.5, y: 5.6 }, { x: 6.8, y: 4.5 }, { x: 7.2, y: 3.4 }, { x: 7.6, y: 2.3 }].map(p => ({ ...p, weak: true }));
  const five = leaderChain('shaman-circle', 7, line);
  assert(five.hpBefore === 6 && five.plannedKill && !five.sim.world.enemies.includes(five.leader) && five.sim.world.stage === 'greed', `five: HP ${five.hpBefore}, planned ${five.plannedKill}, stage ${five.sim.world.stage}`);
  const four = leaderChain('shaman-circle', 7, line.slice(1));
  assert(!four.plannedKill && four.sim.world.enemies.includes(four.leader) && four.leader.hp === 1 && four.sim.world.stage === 'goals', `four: planned ${four.plannedKill}, HP ${four.leader.hp}`);
  const brazier = arenaTemplate('shaman-circle').braziers!.find(b => b.x === 8)!;
  const lit = leaderChain('shaman-circle', 7, [{ x: 6.7, y: 5.6, weak: true }, { x: 7.3, y: 4.5, weak: true }, brazier, { x: 8.1, y: 2.3, weak: true }]);
  assert(lit.plannedKill && !lit.sim.world.enemies.includes(lit.leader) && lit.sim.world.stage === 'greed', `three and a brazier: planned ${lit.plannedKill}`);
  assert((lit.sim.world.objects.find(o => o.kind === 'brazier' && o.x === brazier.x && o.y === brazier.y)?.out ?? 0) > 0, 'the brazier went out');
  console.log('   five weak: killed; four weak: HP 6 → 1; two weak, the brazier, one weak: killed');
});

// ---- The old path ----

check('without the key (old journals, the sandbox by default) every marked arena plays its old layout — 5 / 3 / 5 / 3 marked, no leader, no horde mark', () => {
  const counts: string[] = [];
  for (const id of MARKED_ARENAS) {
    const t: ArenaTemplate = arenaTemplate(id), w = new Simulation({ arena: id, params: rtRunParams(quiet()), seed: 1 }).world;
    assert(w.params.markedGoals === true, 'the run\'s params turn it on');
    const off = new Simulation({ arena: id, params: { ...rtRunParams(quiet()), markedGoals: false }, seed: 1 }).world, plain = new Simulation({ arena: id, params: defaultParams(), seed: 1 }).world;
    for (const world of [off, plain]) {
      assert(world.arena.enemies === t.enemies && world.arena.summary === t.summary && world.arena.horde === undefined, `${id}: the template as it is`);
      assert(world.enemies.every(e => !('leader' in e)), `${id}: no leader field`);
    }
    counts.push(`${id} ${markedCount(off.arena)}`);
  }
  assert(counts.join() === 'marked 5,archers 3,ford 5,shaman-circle 3', counts.join());
  assert(defaultParams().markedGoals === false && RT_RUN_FORCED.markedGoals === true, 'off by default, on in the run');
  console.log(`   ${counts.join(', ')}`);
});

check('a journal without the key plays the same world as one recorded with it off; a journal with it on replays to the same hash', () => {
  for (const id of MARKED_ARENAS) {
    for (const on of [false, true]) {
      const sim = new Simulation({ arena: id, params: { ...rtRunParams(defaultParams()), markedGoals: on }, seed: seedOf(3), record: true, hero: { hp: 999, maxHp: 999 } });
      for (let i = 0; i < 600 && sim.world.status === 'playing'; i++) {
        if (i % 60 === 0) sim.command({ t: 'walk', x: (i / 60) % 2 ? 1 : -1, y: 0.5 });
        if (i % 45 === 20 && !sim.world.move) {
          const first = nextCandidates(sim.world).sort((a, b) => dist(a, sim.world.hero) - dist(b, sim.world.hero))[0];
          if (first && sim.command({ t: 'begin', x: first.x, y: first.y })) sim.command({ t: 'release' });
        }
        sim.tick(); sim.world.events.length = 0;
      }
      const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
      assert(replay(journal).hash() === sim.hash(), `${id} ${on}: replays`);
      if (!on) {
        delete (journal.params as Partial<Params>).markedGoals;
        const { params: _a, ...again } = worldState(replay(journal).world) as Record<string, unknown>, { params: _b, ...played } = worldState(sim.world) as Record<string, unknown>;
        assert(JSON.stringify(again) === JSON.stringify(played), `${id}: the journal without the key plays another world`);
      }
    }
  }
});

check('saves: a new run has the flag and keeps it; a save before 13.10.2026 (no flag) loads unchanged and its arenas keep the old layouts; a wrong flag is no run; the goal line of the node card follows the flag; the choice of arenas and rosters is the same with and without the flag', () => {
  const fresh = createRtRun(seedOf(1));
  assert(fresh.markedGoals === true && parseRtRun(serializeRtRun(fresh))?.markedGoals === true, 'a new run keeps the flag');
  const text = (saveBeforeMix as { save: string }).save, old = parseRtRun(text);
  assert(old && serializeRtRun(old) === text && old.markedGoals === undefined, 'the old save loads unchanged');
  assert(rtArenaParams(old, rtRunParams(defaultParams())).markedGoals === false, 'its arenas: the old layouts');
  const pending = old.pending as { arena: string };
  const w = new Simulation({ arena: pending.arena, params: rtArenaParams(old, rtRunParams(defaultParams())), seed: 1, loadout: rtArenaLoadout(old) }).world;
  assert(w.arena.enemies === arenaTemplate(pending.arena).enemies && markedCount(w.arena) === 5, `the open «${pending.arena}» of the old save: ${markedCount(w.arena)} marked`);
  assert(parseRtRun(JSON.stringify({ ...JSON.parse(serializeRtRun(fresh)), markedGoals: false })) === null, 'a wrong flag');
  // The node card's goal line: the goal layout's in a run with the flag, the old one without it.
  for (const id of MARKED_ARENAS) {
    const line = (markedGoals: boolean) => nodeDangers({ arena: id, row: 7, guaranteedElite: false, markedGoals })[0].text, t = arenaTemplate(id);
    assert(line(true) === goalText(t.markedGoal!.summary) && line(false) === goalText(t.summary) && line(true) !== line(false), `${id}: the card's goal «${line(true)}»`);
  }
  const print = (fights: Fight[][]) => fights.map(f => f.map(x => `${x.arena}/${x.roster ?? '-'}`).join(',')).join('|');
  const without = Array.from({ length: 60 }, (_, n) => walk(seedOf(n + 1), n + 1, false));
  assert(without.every(f => f.every(x => x.run.markedGoals === undefined)), 'no flag');
  assert(print(without) === print(walks.slice(0, 60)), 'the flag changes the choice of arenas or rosters');
  console.log(`   60 runs: the same ${without.reduce((s, f) => s + f.length, 0)} arenas and rosters with and without the flag`);
});

console.log(`realtime-marked-goals: ${checks} checks passed`);
