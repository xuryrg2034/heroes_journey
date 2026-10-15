/**
 * Task 28 «Тюремщик в походе» (design 15.10.2026, docs/design-notes/tasks-26-28.md; docs/realtime-slice.md, «Тюремщик в походе»):
 * the run's Jailer node plays the Jailer's fight. Node only: `npm run test:realtime-jailer-run`. Everything goes through the run's
 * own commands (enter, resolve, choose) and real fights of journalled commands:
 * - a new run reaches run row 5 and its Jailer node plays «Тюремщик» (preview = the arena played); the run's `pool` draws, the
 *   map, the visited nodes, the events and every stream counter are those of a run without the flag (300 seeds); a save without
 *   the flag (before the task) plays the pool's arena there; malformed saves read as no run;
 * - a scheduled run: a new viewer meets the part as the fight's arc with no other new element (the ravine out until the cliff is
 *   met, the core's shield out until the shieldbearer is met); a viewer who met them — «Тюремщик» as it is;
 * - a real Jailer fight of a run: the boss frame, `bossClears` and `bossPartLoot` on; the weight severed by a chain drops loot; the
 *   chain that kills the core ends the fight (no enemy left, the door open); the won fight with the weight severed offers 1 of 4
 *   on its oath and relic screen (the three of 1 of 3 and one more); the save reads back; the telemetry reads the boss (the
 *   second of the sever and of the death, the crowd that died with it apart from every kill count) and the threats of «Кистень»
 *   and «Бросок гири».
 * Seeds `Math.imul(k, 2654435761) >>> 0`. No claim on winning or losing a fight.
 */
import { JAILER, JAILER_WEIGHT, BOSS_CLEAR } from '../sim/enemies/jailer';
import { Simulation, replay, type Journal } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { AFFIX_IDS } from '../sim/elites';
import { RUN_ARENAS } from './arenaPools';
import { analyzeJournal } from '../telemetry/report';
import {
  arenaPreview, createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtChooseHammer, rtEnterNode, rtFightArc, rtNode, rtRunParams,
  serializeRtRun, RT_JAILER_SEVERED_SLOTS, type RtRunState,
} from './rtRun';
import { affixElement, PART_ARC, SCHEDULE_ELEMENTS } from './schedule';
import { assert, closeNode, ok, outcomeOf, quiet, same, seedOf, ticks } from './runFight.testkit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const VETERAN = [...SCHEDULE_ELEMENTS, ...AFFIX_IDS.map(affixElement)];
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);

/** A won arena by the run layer alone (no simulation): the kinds its arena brings. */
function fakeWin(run: RtRunState): RtRunState {
  const pending = run.pending as Extract<RtRunState['pending'], { kind: 'battle' }>;
  return ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.maxHp, kills: 20, damage: 0, time: 60 }), 'resolve');
}
/**
 * The run walks by its own commands until its Jailer node's battle is open (a Jailer node taken when one is offered, else the
 * node `(k + step)`; other battles won without a fight, screens closed simply); `previews` — the arena the map showed for it.
 */
function toJailer(run: RtRunState, k: number): { run: RtRunState; preview: string | null } {
  let preview: string | null = null;
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      if (rtNode(run, pending.nodeId)!.type === 'checkpoint') return { run, preview };
      run = fakeWin(run);
    } else if (pending) run = closeNode(run);
    else {
      const next = rtAvailableNodes(run), node = next.find(n => n.type === 'checkpoint') ?? next[(k + step) % next.length];
      if (node.type === 'checkpoint') preview = arenaPreview(run, node)?.arena ?? null;
      run = ok(rtEnterNode(run, node.id), 'enter');
    }
  }
  throw new Error(`seed ${k}: no Jailer node`);
}
/** The whole run by the same walk (every battle won without a fight). */
function walkAll(run: RtRunState, k: number): RtRunState {
  for (let step = 0; step < 300 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') run = fakeWin(run);
    else if (pending) run = closeNode(run);
    else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, (next.find(n => n.type === 'checkpoint') ?? next[(k + step) % next.length]).id), 'enter'); }
  }
  return run;
}
const pendingArena = (run: RtRunState): string => (run.pending as { arena: string }).arena;

check('a new run (300 seeds) reaches run row 5 and its Jailer node plays «Тюремщик» (the map\'s preview the same); the pool draws, the map, the visited nodes, the events and the streams are those of a run without the flag; that run (a save before the task) plays the pool\'s arena there', () => {
  const old = new Set<string>();
  for (let k = 1; k <= 300; k++) {
    const a = toJailer(createRtRun(seedOf(k), { gift: 'mini' }), k), b = toJailer(createRtRun(seedOf(k), { gift: 'mini', jailer: false }), k);
    const node = rtNode(a.run, (a.run.pending as { nodeId: string }).nodeId)!;
    assert(a.run.jailer === true && b.run.jailer === undefined, `seed ${k}: the flag`);
    assert(pendingArena(a.run) === 'jailer' && a.preview === 'jailer' && (a.run.pending as { roster?: string }).roster === undefined, `seed ${k}: the Jailer's fight (${pendingArena(a.run)}, preview ${a.preview})`);
    assert(node.row - 4 === 5, `seed ${k}: on run row 5 (map row ${node.row})`);
    assert(RUN_ARENAS.includes(pendingArena(b.run)) && pendingArena(b.run) !== 'jailer' && b.preview === pendingArena(b.run), `seed ${k}: the old run plays its pool (${pendingArena(b.run)})`);
    old.add(pendingArena(b.run));
    assert(same(a.run.streams, b.run.streams) && same(a.run.visited, b.run.visited) && same(a.run.map, b.run.map), `seed ${k}: the streams (pool ${a.run.streams.pool} / ${b.run.streams.pool}), the path, the map`);
    const wa = walkAll(a.run, k), wb = walkAll(b.run, k);
    for (const [what, x, y] of [['visited', wa.visited, wb.visited], ['events', wa.picks.map(p => p.eventId ?? null), wb.picks.map(p => p.eventId ?? null)], ['streams', wa.streams, wb.streams], ['event choices', wa.eventChoices, wb.eventChoices]] as const)
      assert(same(x, y), `seed ${k}: ${what} differ over the whole run`);
  }
  assert(old.size >= 2, `the old runs' Jailer nodes vary: ${[...old]}`);
});

check('saves: a new run\'s Jailer pick reads back; a save without the flag keeps no flag and its pool arena; a Jailer pick in a run without the flag, another arena at the Jailer node of a run with it, a malformed flag — no run', () => {
  for (let k = 1; k <= 20; k++) {
    const a = toJailer(createRtRun(seedOf(k), { gift: 'mini' }), k).run, b = toJailer(createRtRun(seedOf(k), { gift: 'mini', jailer: false }), k).run;
    assert(same(parseRtRun(serializeRtRun(a)), a) && same(parseRtRun(serializeRtRun(b)), b), `seed ${k}: both read back`);
    assert(!serializeRtRun(b).includes('"jailer"'), `seed ${k}: no flag in the old save`);
    const nodeId = (a.pending as { nodeId: string }).nodeId;
    const swap = (run: RtRunState, arena: string): RtRunState => {
      const x = structuredClone(run);
      x.picks.find(p => p.nodeId === nodeId)!.arena = arena; (x.pending as { arena: string }).arena = arena;
      return x;
    };
    assert(parseRtRun(serializeRtRun(swap(a, pendingArena(b)))) === null, `seed ${k}: a pool arena at the Jailer node of a run with the flag`);
    assert(parseRtRun(serializeRtRun(swap(b, 'jailer'))) === null, `seed ${k}: the Jailer's fight in a run without the flag`);
    assert(parseRtRun(serializeRtRun({ ...a, jailer: 'yes' as unknown as true })) === null, `seed ${k}: a malformed flag`);
  }
});

check('a scheduled run: a new viewer meets the part as the Jailer fight\'s arc with nothing else new — «Тюремщик» without the ravine (the cliff not met), the core without its shield (the shieldbearer not met); a viewer who met them plays «Тюремщик» as it is, the arc gone once the part is met', () => {
  const cases: [string, string[], string, string | null, boolean][] = [
    ['new viewer', [], 'jailer-yard', PART_ARC, true],
    ['cliff and shieldbearer met', ['cliff', 'shield'], 'jailer', PART_ARC, false],
    ['veteran', VETERAN, 'jailer', null, false],
  ];
  let yards = 0;
  for (const [who, history, arena, arc, bare] of cases) {
    for (let k = 1; k <= 6; k++) {
      const { run, preview } = toJailer(createRtRun(seedOf(k + 40), { gift: 'mini', schedule: history }), k);
      const met = new Set([...history, ...run.battles.flatMap(r => r.seen ?? [])]);
      const expect = { arena: met.has('cliff') ? 'jailer' : 'jailer-yard', bare: !met.has('shield') };
      if (expect.arena === 'jailer-yard') yards++;
      if (who !== 'new viewer') assert(expect.arena === arena && expect.bare === bare, `${who} seed ${k}: the case holds`);
      assert(pendingArena(run) === expect.arena && preview === expect.arena, `${who} seed ${k}: ${pendingArena(run)} (met cliff ${met.has('cliff')})`);
      assert(rtFightArc(run) === arc, `${who} seed ${k}: arc ${rtFightArc(run)}`);
      const kit = rtArenaLoadout(run);
      // No guaranteed elite on the Jailer's node; with the arc no random elite either (Б2: the fight of a first meeting).
      assert((kit.withoutKinds ?? []).includes('shield') === expect.bare && !kit.guaranteedElite && (!arc || kit.randomElites === false) && !kit.eliteAffixes, `${who} seed ${k}: ${JSON.stringify(kit.withoutKinds)}, elites ${kit.guaranteedElite}/${kit.randomElites}`);
      // The fight as the run starts it: the boss frame and the rule on, the core bare as the loadout says.
      const sim = new Simulation({ arena: pendingArena(run), params: rtArenaParams(run, rtRunParams(quiet())), seed: (run.pending as { seed: number }).seed, loadout: kit });
      const core = sim.world.enemies.find(e => e.kind === JAILER)!;
      assert(sim.world.params.bossFrame && sim.world.params.bossClears && sim.world.params.bossPartLoot && (core.vars.bare === 1) === expect.bare, `${who} seed ${k}: the fight's rules`);
      assert(!!sim.world.arena.terrain === met.has('cliff'), `${who} seed ${k}: the ravine only when the cliff is met`);
      // What the fight shows: the part (and the ravine only when met) — at most one new element.
      const next = ok(resolveArena(run, { nodeId: (run.pending as { nodeId: string }).nodeId, won: true, hp: run.maxHp, kills: 1, damage: 0, time: 30, kinds: ['basic'] }), 'resolve');
      const seen = next.battles.at(-1)!.seen ?? [], fresh = seen.filter(id => !met.has(id) && id !== 'bag');
      assert(seen.includes(PART_ARC) && fresh.length === (arc ? 1 : 0) && (!arc || fresh[0] === PART_ARC), `${who} seed ${k}: seen ${seen}, new ${fresh}`);
    }
  }
  assert(yards >= 3, `a new viewer meets the yard without the ravine (${yards} of 6)`);
});

/** The weight severed by chains [a, weight] (the plate, then the kill); the hero beside it each time. */
function sever(sim: Simulation, weight: Enemy, seen: (w: World) => void): void {
  for (let i = 0; i < 4 && sim.world.enemies.includes(weight); i++) {
    sim.command({ t: 'teleport', x: weight.x - 1.4, y: weight.y });
    sim.command({ t: 'place', x: weight.x - 0.7, y: weight.y + 0.05, color: 0, hp: 0, kind: 'basic' });
    const a = sim.world.enemies[sim.world.enemies.length - 1];
    sim.command({ t: 'begin', x: a.x, y: a.y });
    sim.command({ t: 'drag', x: weight.x, y: weight.y, mode: 'full' });
    sim.command({ t: 'release' });
    seen(sim.world); sim.world.events.length = 0;
    ticks(sim, 900, seen, w => !w.move);
  }
}
/** The core's plates (and, task 32, its HP down to 1) taken by one-link chains on it (frozen: no moves, no shield), then a chain [b, core] kills it. */
function killCore(sim: Simulation, core: Enemy, seen: (w: World) => void): void {
  const w = sim.world;
  for (let i = 0; i < 16 && ((core.armor?.plates ?? 0) > 0 || core.hp > 1); i++) {
    sim.command({ t: 'teleport', x: core.x + 1.2, y: core.y });
    sim.command({ t: 'begin', x: core.x, y: core.y });
    sim.command({ t: 'release' });
    seen(w); w.events.length = 0;
    ticks(sim, 900, seen, x => !x.move);
  }
  assert((core.armor?.plates ?? 0) === 0, 'the core\'s plates taken');
  sim.command({ t: 'teleport', x: core.x + 2, y: core.y });
  sim.command({ t: 'place', x: core.x + 1, y: core.y, color: core.color, hp: 0, kind: 'basic' });
  const b = w.enemies[w.enemies.length - 1];
  sim.command({ t: 'begin', x: b.x, y: b.y });
  sim.command({ t: 'drag', x: core.x, y: core.y, mode: 'full' });
  assert(w.chain.length === 2, `the chain [b, core]: ${w.chain.length}`);
  sim.command({ t: 'release' });
  seen(w); w.events.length = 0;
  ticks(sim, 900, seen, x => !x.move);
}
/** The Jailer's fight of `run` played for real: the weight severed or not, the core killed, the crowd placed, the walk into the door. */
function jailerFight(run: RtRunState, k: number, severed: boolean): { sim: Simulation; events: WorldEvent[]; outcome: ReturnType<typeof outcomeOf> } {
  const pending = run.pending as Extract<RtRunState['pending'], { kind: 'battle' }>;
  const sim = new Simulation({ arena: pending.arena, params: rtArenaParams(run, rtRunParams(quiet())), seed: pending.seed, record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
  const w = sim.world, events: WorldEvent[] = [], seen = (x: World): void => { events.push(...x.events); };
  const core = w.enemies.find(e => e.kind === JAILER)!, weight = w.enemies.find(e => e.kind === JAILER_WEIGHT)!;
  sim.command({ t: 'chill', id: core.id, seconds: 300 });
  if (severed) sever(sim, weight, seen);
  // The crowd: three plain enemies away from the core.
  for (const [x, y] of [[13, 6], [13.5, 7.5], [12, 8]]) sim.command({ t: 'place', x: x + (k % 3) * 0.1, y, color: 2, hp: 1, kind: 'basic' });
  killCore(sim, core, seen);
  sim.command({ t: 'teleport', x: 10, y: 2.4 });
  sim.command({ t: 'walk', x: 0, y: -1 });
  ticks(sim, 600, seen);
  seen(w);
  assert(w.status === 'victory', `seed ${k}: the hero walked into the door (${w.status})`);
  const outcome = { ...outcomeOf(run, w), ...of(events, 'partSevered').length ? { severed: true } : {} };
  return { sim, events, outcome };
}

check('a real Jailer fight of a new run (3 seeds): the rules on; the weight severed by a chain drops loot; the chain that kills the core leaves no enemy, the door opens; the won fight with the weight severed offers 1 of 4 (the 1 of 3 of a fight without it, and one more); the save reads back, a record without its sever does not match the screen; the fight replays to its hash', () => {
  for (const k of [1, 2, 3]) {
    const run = toJailer(createRtRun(seedOf(k), { gift: 'mini' }), k).run;
    const cut = jailerFight(run, k, true), whole = jailerFight(run, k, false);
    const w = cut.sim.world;
    assert(w.params.bossFrame && w.params.bossClears && w.params.bossPartLoot, `seed ${k}: the rules of the run's Jailer fight`);
    assert(of(cut.events, 'partSevered').length === 1 && of(cut.events, 'loot').some(e => !e.picked), `seed ${k}: the weight severed, its loot dropped`);
    const cleared = of(cut.events, 'kill').filter(e => e.source === BOSS_CLEAR);
    assert(cleared.length === 3 && cleared.every(e => !e.credited) && w.bossCleared, `seed ${k}: the crowd died with the core (${cleared.length})`);
    assert(cut.outcome.severed === true && whole.outcome.severed === undefined, 'the outcome reads the sever');
    for (const f of [cut, whole]) assert(replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!))).hash() === f.sim.hash(), `seed ${k}: replay`);
    const after = (outcome: typeof cut.outcome): RtRunState => {
      const won = ok(resolveArena(run, outcome), 'resolve');
      assert(won.pending?.kind === 'hammer', `seed ${k}: the hammer first (${won.pending?.kind})`);
      return ok(rtChooseHammer(won, null), 'no hammer');
    };
    const four = after(cut.outcome), three = after(whole.outcome);
    const o4 = (four.pending as { options: string[] }).options, o3 = (three.pending as { options: string[] }).options;
    assert(four.pending?.kind === 'talisman' && (four.pending as { source: string }).source === 'oath' && o4.length === RT_JAILER_SEVERED_SLOTS && o3.length === 3 && same(o4.slice(0, 3), o3), `seed ${k}: 1 of 4 ${o4} vs 1 of 3 ${o3}`);
    assert(four.battles.at(-1)!.severed === true && three.battles.at(-1)!.severed === undefined, 'the record keeps the sever');
    assert(same(four.streams, three.streams), `seed ${k}: the same draws`);
    assert(same(parseRtRun(serializeRtRun(four)), four) && same(parseRtRun(serializeRtRun(three)), three), `seed ${k}: both saves read back`);
    const forged = structuredClone(four);
    delete forged.battles.at(-1)!.severed;
    assert(parseRtRun(serializeRtRun(forged)) === null, `seed ${k}: four options without the sever — no run`);
  }
});

check('telemetry of the run\'s Jailer fight: the boss — the second of the sever and of the death, its moves; the crowd that died with it — `kills.bossClear`, not the chain\'s, not the tools\', not the enemies\' abilities\'; «Кистень» and «Бросок гири» warnings in the threats with an outcome each', () => {
  const run = toJailer(createRtRun(seedOf(5), { gift: 'mini' }), 5).run;
  const { sim } = jailerFight(run, 5, true);
  const a = analyzeJournal(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal), s = a.summary;
  assert(s.boss && s.boss.severedAt !== null && s.boss.diedAt !== null && s.boss.severedAt < s.boss.diedAt, `the boss: ${JSON.stringify(s.boss)}`);
  assert(s.kills.bossClear === 3 && s.kills.enemies === 0 && !('boss-clear' in s.kills.tools), `the kills: ${JSON.stringify(s.kills)}`);
  // A fight with the Jailer awake: the hero stands within its reach — the moves begin, each warning ends with an outcome.
  let warned = 0, outcomes = new Set<string>();
  for (const k of [1, 2, 3, 4]) {
    const r = toJailer(createRtRun(seedOf(k + 10), { gift: 'mini' }), k).run, pending = r.pending as { arena: string; seed: number };
    const fight = new Simulation({ arena: pending.arena, params: rtArenaParams(r, rtRunParams(quiet({ heroHp: 99 }))), seed: pending.seed, record: true, loadout: rtArenaLoadout(r), hero: { hp: 99, maxHp: 99 } });
    const core = fight.world.enemies.find(e => e.kind === JAILER)!;
    fight.command({ t: 'teleport', x: core.x + 2, y: core.y });
    ticks(fight, 60 * 8);
    fight.command({ t: 'teleport', x: core.x + 2.6, y: core.y + 2.4 });
    ticks(fight, 60 * 8);
    const b = analyzeJournal(JSON.parse(JSON.stringify(fight.exportJournal()!)) as Journal);
    const boss = b.warnings.filter(x => x.kind === 'flail' || x.kind === 'throw');
    assert(boss.every(x => x.outcome !== null) && b.summary.boss && Object.keys(b.summary.boss.moves).length > 0, `seed ${k}: ${JSON.stringify(boss.map(x => [x.kind, x.outcome]))}`);
    const hits = b.summary.damage.hits;
    assert(boss.filter(x => x.outcome === 'hit').length === (hits.flail ?? 0) + (hits.throw ?? 0), `seed ${k}: a hit warning per hit of the moves`);
    warned += boss.length; for (const x of boss) outcomes.add(`${x.kind}:${x.outcome}`);
  }
  assert(warned >= 4, `the moves warned ${warned} times`);
  console.log(`   boss warnings over 4 seeds: ${warned}; outcomes ${[...outcomes].sort().join(', ')} (heuristic, 15.10.2026)`);
});

console.log(`jailer-run: ${checks} checks passed`);
