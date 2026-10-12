/**
 * Task 5 «Срез казино-слоя в походе + гоблин главный» (design 12.10.2026; docs/realtime-casino.md, «Срез казино-слоя в походе»).
 * Node only: `npm run test:realtime-casino-slice`.
 *
 * The run goes by its own commands; its arenas are real fights (journalled commands on the quiet test field of
 * runFight.testkit.ts with the run's params `rtRunParams` and the node's loadout `rtArenaLoadout`), read as main.ts reads them:
 * - a row-1 battle: no cauldron (no `world.purse`, no cheque), the door records nothing, the outcome carries no die and the
 *   node completes at once; the goblin stands after the goals on every seed (the open field always has a spot), its spot
 *   varies by seed;
 * - «Длинная цепь кормит гоблина»: two chains of 6+ enemy links (before the goblin) — 3 + 2 = 5 safe pulls; a third does
 *   not make it 6 (the last pull stays risky); a chain of 5 gives nothing; a long chain after the goblin appears counts
 *   too; the floating text's event `feed` comes only when the safe pulls grew; the plan line of every pull says safe or
 *   risky as the pull does; a long chain ending on the lever pulls with the count before it, then feeds;
 * - the Jailer and a boss: no goblin, long chains feed nothing (no state, no event);
 * - the key 0 or absent — the old path: the same world (the params aside), no `slotChains`; the fights replay to the hash
 *   (every 300 ticks too);
 * - old run saves (fixtures) load byte for byte and play on to the next battles; an open battle of row 1–2 starts with the
 *   goblin's leave now; a save at an open die screen (fixture `rt-run-save-open-die.json`) closes it and plays on.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { worldState } from '../sim/hash';
import { Simulation, replay, type Journal } from '../sim/simulation';
import { goblinOf, leverOf, safePullsLeft, slotCharges } from '../sim/slot';
import { slotPlanOdds } from '../sim/slotPlan';
import type { WorldEvent } from '../sim/world';
import { runRow } from './arenaPools';
import {
  createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtDieChoose, rtEnterNode, rtMapNodes, rtNode, rtRunParams, serializeRtRun,
  RT_RUN_FORCED, RT_SLOT_ROW, type RtRunState,
} from './rtRun';
import { assert, closeNode, ok, outcomeOf, playFight, quiet, same, seedOf, takeGift, ticks, toBattle } from './runFight.testkit';
import beforeChain6 from '../../../tests/fixtures/rt-run-save-before-chain6.json';
import beforeMix from '../../../tests/fixtures/rt-run-save-before-mix.json';
import beforeRecord from '../../../tests/fixtures/rt-run-save-before-record.json';
import beforeReroll from '../../../tests/fixtures/rt-run-save-before-reroll.json';
import hardBattle from '../../../tests/fixtures/rt-run-save-hard-battle.json';
import openDie from '../../../tests/fixtures/rt-run-save-open-die.json';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const slotEvents = (events: readonly WorldEvent[], action: Ev<'slot'>['action']): Ev<'slot'>[] =>
  events.filter((e): e is Ev<'slot'> => e.type === 'slot' && e.action === action);
const TICKS_PER_S = 60;

/** The run of seed `k` at its first battle (run row 1). */
function firstBattle(k: number): RtRunState {
  const run = toBattle(takeGift(createRtRun(seedOf(k), { gift: 'mini' })));
  const pending = run.pending;
  assert(pending?.kind === 'battle' && runRow(rtNode(run, pending.nodeId)!.row) === 1, 'a battle of run row 1');
  return run;
}
/** The arena of the run's open battle on the quiet field: the run's params and the node's loadout. */
function arena(run: RtRunState, k: number, params = rtRunParams(quiet())): Simulation {
  const sim = new Simulation({ arena: 'run-fight-field', params, seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
/**
 * A chain of `n` weak enemies in a row (journalled place, begin, drag, release) on the row of the field farther from the
 * lever; ticks until the dash ends. Returns the events of the dash.
 */
function chain(sim: Simulation, n: number): WorldEvent[] {
  const w = sim.world, lever = leverOf(w), y = !lever || Math.abs(lever.y - 2) > Math.abs(lever.y - 10) ? 2 : 10;
  sim.command({ t: 'teleport', x: 1.5, y });
  const points = Array.from({ length: n }, (_, i) => ({ x: 1.5 + 1.4 * (i + 1), y }));
  for (const p of points) sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === n, `the chain took ${w.chain.length} of ${n} links`);
  sim.command({ t: 'release' });
  const out: WorldEvent[] = [...w.events];
  w.events.length = 0;
  ticks(sim, 900, x => out.push(...x.events), x => !x.move);
  return out;
}
/** The goals, then the goblin's delay: ticks until it stands (at most 5 s). */
function goalsAndGoblin(sim: Simulation): WorldEvent[] {
  const out: WorldEvent[] = [];
  sim.command({ t: 'goals' });
  ticks(sim, 5 * TICKS_PER_S, w => out.push(...w.events), w => !!w.slot);
  return out;
}
/** Waits for the lever (marker, cooldown, spin). */
function waitLever(sim: Simulation, out: WorldEvent[] = []): void {
  ticks(sim, 30 * TICKS_PER_S, w => out.push(...w.events), w => { const g = goblinOf(w); return !g || (!g.spin && w.time + 1e-6 >= g.ready); });
}
/**
 * A bare pull: the chain of just the lever is drawn, its plan line read (`slotPlanOdds`: `bust` — risky), released; the
 * reels stop. Returns what the plan said and the pull event.
 */
function pull(sim: Simulation): { planRisky: boolean; pull: Ev<'slot'>; events: WorldEvent[] } {
  const w = sim.world, events: WorldEvent[] = [];
  waitLever(sim, events);
  const lever = leverOf(w)!, dx = w.arena.width / 2 - lever.x, dy = w.arena.height / 2 - lever.y, d = Math.hypot(dx, dy) || 1;
  sim.command({ t: 'teleport', x: lever.x + dx / d * 1.2, y: lever.y + dy / d * 1.2 });
  assert(sim.command({ t: 'begin', x: lever.x, y: lever.y }) === true && w.chain.length === 1, 'a chain of just the lever');
  const plan = slotPlanOdds(w);
  assert(plan && plan.onLever, 'the plan line over the idol');
  sim.command({ t: 'release' });
  events.push(...w.events); w.events.length = 0;
  ticks(sim, 900, x => events.push(...x.events), x => !x.move && !goblinOf(x)?.spin);
  const p = slotEvents(events, 'pull')[0];
  assert(p, 'the dash pulled the lever');
  return { planRisky: !!plan.bust, pull: p, events };
}
/** Replays the journal through JSON: the same hash at the end and at every 300th tick. */
function replays(sim: Simulation, checkpoints: Map<number, string>): boolean {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  let good = true;
  const again = replay(journal, s => { const want = checkpoints.get(s.world.tick); if (want !== undefined && want !== s.hash()) good = false; });
  return good && again.hash() === sim.hash();
}
/** Hashes every 300 ticks while `play` runs (the replay compares them). */
function withCheckpoints(sim: Simulation, play: () => void): Map<number, string> {
  const marks = new Map<number, string>(), tick = sim.tick.bind(sim);
  sim.tick = () => { tick(); if (sim.world.tick % 300 === 0) marks.set(sim.world.tick, sim.hash()); };
  try { play(); } finally { sim.tick = tick; }
  return marks;
}

// ---------------------------------------------------------------------------------------------------------------------

check('the run\'s values: no cauldron, no die, no oath stake; the goblin in every battle from row 1 (chance 1), a chain of 6+ gives +1 safe pull', () => {
  const p = rtRunParams(quiet({ purse: true, doorDie: true, oathStake: true, slotChance: 0.2, slotSafePerLongChain: 0 }));
  assert(!p.purse && !p.doorDie && !p.oathStake, 'the cauldron, the die and the oath stake are off in the run whatever the panel says');
  assert(p.slot && p.slotBust && p.slotChance === 1 && p.slotSafePerLongChain === 1 && p.slotLongChainLinks === 6 && p.slotPulls === 6 && p.slotSafePulls === 3, 'the goblin\'s numbers');
  assert(RT_SLOT_ROW === 1 && RT_RUN_FORCED.goblinCircle === true, 'from row 1; the goblins\' circle stays');
});

check('a row-1 battle: no cauldron, the door records nothing and the node completes at once; the goblin stands after the goals on every seed, its spot varies', () => {
  const spots = new Set<string>();
  for (let k = 1; k <= 12; k++) {
    const run = firstBattle(k), loadout = rtArenaLoadout(run);
    assert(loadout.slot === true, `seed ${k}: the row-1 battle may get the goblin`);
    const sim = arena(run, k), w = sim.world, events: WorldEvent[] = [];
    events.push(...chain(sim, 6), ...chain(sim, 4));
    const goals = w.time;
    events.push(...goalsAndGoblin(sim));
    const g = goblinOf(w);
    assert(g, `seed ${k}: the goblin stands`);
    assert(Math.abs(g.born - goals - w.params.slotDelay) < 2 / TICKS_PER_S, `seed ${k}: ${(g.born - goals).toFixed(2)} s after the goals`);
    spots.add(`${g.x.toFixed(2)},${g.y.toFixed(2)}`);
    // Out by the door: no cheque, no door record.
    sim.command({ t: 'teleport', x: 16.5, y: 6 });
    sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(sim, 600, x => events.push(...x.events));
    assert(w.status === 'victory', `seed ${k}: won`);
    assert(w.purse === undefined && !events.some(e => e.type === 'cheque' || e.type === 'purseDoor' || e.type === 'purseKill'), `seed ${k}: no cauldron`);
    const outcome = outcomeOf(run, w);
    assert(outcome.purse === undefined && outcome.doorDie === undefined, `seed ${k}: the outcome has no door record, no die`);
    const done = ok(resolveArena(run, outcome), 'resolve');
    assert(done.pending?.kind !== 'die' && done.visited.includes(outcome.nodeId) && done.dieDraws === undefined, `seed ${k}: no die screen, the node completes`);
  }
  assert(spots.size >= 10, `the goblin's spot varies: ${spots.size} of 12`);
});

check('two chains of 6+ before the goblin: 3 + 2 = 5 safe; a chain of 5 gives nothing; a third long chain does not make 6; pulls 1–5 safe, the 6th risky — the plan line says the same each time', () => {
  let fights = 0;
  for (let k = 1; k <= 6; k++) {
    const run = firstBattle(20 + k), sim = arena(run, 20 + k), w = sim.world;
    const marks = withCheckpoints(sim, () => {
      const first = chain(sim, 6), second = chain(sim, 7), five = chain(sim, 5);
      assert(slotEvents(first, 'feed').length === 1 && slotEvents(first, 'feed')[0].safe === 1, `seed ${k}: the 1st long chain: «+1»`);
      assert(slotEvents(second, 'feed').length === 1 && w.slotChains === 2, `seed ${k}: the 2nd long chain: «+1»`);
      assert(!slotEvents(five, 'feed').length && w.slotChains === 2, `seed ${k}: a chain of 5 gives nothing`);
      assert(slotCharges(w).safe === 5, `seed ${k}: 5 safe before the goblin (${slotCharges(w).safe})`);
      goalsAndGoblin(sim);
      assert(goblinOf(w) && safePullsLeft(w) === 5, `seed ${k}: the goblin with 5 safe (${safePullsLeft(w)})`);
      const third = chain(sim, 6);
      assert(!slotEvents(third, 'feed').length && Number(w.slotChains) === 3 && safePullsLeft(w) === 5 && slotCharges(w).total === 6, `seed ${k}: a 3rd long chain — still 5 (${safePullsLeft(w)})`);
      for (let i = 1; i <= 6; i++) {
        const { planRisky, pull: p } = pull(sim);
        assert(p.pull === i && planRisky === !!p.risky && p.risky === (i === 6), `seed ${k}: pull ${i} — plan risky ${planRisky}, pull risky ${p.risky}`);
        if (i < 6) assert(safePullsLeft(w) === 5 - i, `seed ${k}: after pull ${i} — ${safePullsLeft(w)} safe left`);
      }
    });
    assert(replays(sim, marks), `seed ${k}: replay with checkpoints`);
    fights++;
  }
  assert(fights === 6, `fights ${fights}`);
});

check('a long chain after the goblin appears counts; a chain of 6 ending on the lever pulls with the count before it (the plan line agrees), then feeds', () => {
  let onLever = 0;
  for (let k = 1; k <= 12 && onLever < 3; k++) {
    const run = firstBattle(40 + k), sim = arena(run, 40 + k), w = sim.world;
    goalsAndGoblin(sim);
    if (!goblinOf(w)) continue;
    assert(safePullsLeft(w) === 3, 'no long chain yet: 3 safe');
    const after = chain(sim, 6);
    assert(slotEvents(after, 'feed').length === 1 && safePullsLeft(w) === 4, `seed ${k}: a long chain with the goblin standing: 4 safe`);
    for (let i = 0; i < 4; i++) assert(!pull(sim).pull.risky, `seed ${k}: safe pull ${i + 1}`);
    assert(safePullsLeft(w) === 0, 'the next pull is risky');
    // Six enemies in a row towards the lever, the lever the last link.
    waitLever(sim);
    const lever = leverOf(w)!, dx = w.arena.width / 2 - lever.x, dy = w.arena.height / 2 - lever.y, d = Math.hypot(dx, dy) || 1, step = 1.2;
    const start = { x: lever.x + dx / d * step * 7, y: lever.y + dy / d * step * 7 };
    if (start.x < 0.6 || start.x > w.arena.width - 0.6 || start.y < 0.6 || start.y > w.arena.height - 0.6) continue;
    sim.command({ t: 'teleport', x: start.x, y: start.y });
    const points = Array.from({ length: 6 }, (_, i) => ({ x: start.x - dx / d * step * (i + 1), y: start.y - dy / d * step * (i + 1) }));
    for (const p of points) sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp: 0, kind: 'basic' });
    sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
    for (const p of [...points.slice(1), lever]) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
    if (w.chain.length !== 7) { sim.command({ t: 'cancel' }); continue; }
    const plan = slotPlanOdds(w);
    assert(plan && plan.onLever && plan.links === 6 && !!plan.bust, `seed ${k}: the plan line of a risky pull after 6 links`);
    sim.command({ t: 'release' });
    const events: WorldEvent[] = [...w.events];
    w.events.length = 0;
    ticks(sim, 900, x => events.push(...x.events), x => !x.move);
    const p = slotEvents(events, 'pull')[0], feed = slotEvents(events, 'feed');
    assert(p && p.risky === true && p.links === 6, `seed ${k}: the pull was risky, as the plan said`);
    assert(feed.length === 1 && feed[0].links === 6 && events.indexOf(feed[0]) > events.indexOf(p), `seed ${k}: the chain fed the goblin after its pull`);
    assert(slotCharges(w).safe === 5 && safePullsLeft(w) === 0, `seed ${k}: 5 safe, all spent (${slotCharges(w).safe}, ${safePullsLeft(w)})`);
    onLever++;
  }
  assert(onLever >= 3, `chains of 6 on the lever: ${onLever}`);
});

check('the Jailer and a boss: no goblin, long chains feed nothing (no state, no event)', () => {
  let seen = 0;
  const base = takeGift(createRtRun(seedOf(77), { gift: 'mini' }));
  for (const node of rtMapNodes(base)) {
    if (node.type !== 'checkpoint' && node.type !== 'boss') continue;
    const run: RtRunState = { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena: 'run-fight-field', seed: seedOf(1), battle: node.type === 'boss' ? 'final' : 'battle' } };
    assert(!rtArenaLoadout(run).slot, `${node.type}: no goblin`);
    const sim = arena(run, 3), w = sim.world, events = [...chain(sim, 6), ...chain(sim, 8), ...goalsAndGoblin(sim), ...chain(sim, 6)];
    assert(!w.slot && w.slotChains === undefined && !slotEvents(events, 'feed').length, `${node.type}: nothing fed`);
    seen++;
  }
  assert(seen >= 2, `checked ${seen}`);
});

check('the key 0 or absent plays the old path: the same world (the params aside), no `slotChains`, 3 safe pulls after long chains; every fight replays', () => {
  for (let k = 1; k <= 3; k++) {
    const run = firstBattle(60 + k);
    const zero = { ...rtRunParams(quiet()), slotSafePerLongChain: 0 }, none = { ...zero } as Partial<typeof zero>;
    delete none.slotSafePerLongChain; delete none.slotLongChainLinks;
    const a = arena(run, 60 + k, zero), b = arena(run, 60 + k, none as typeof zero);
    for (const sim of [a, b]) {
      const events = [...chain(sim, 6), ...chain(sim, 6), ...goalsAndGoblin(sim), ...chain(sim, 7)];
      assert(!slotEvents(events, 'feed').length && sim.world.slotChains === undefined && safePullsLeft(sim.world) === 3, `seed ${k}: the old 3 safe`);
      const marks = withCheckpoints(sim, () => { for (let i = 0; i < 4; i++) pull(sim); });
      assert(replays(sim, marks), `seed ${k}: replay`);
    }
    const strip = (sim: Simulation): string => { const s = worldState(sim.world) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    assert(strip(a) === strip(b), `seed ${k}: the same world without the keys`);
    assert(!('slotChains' in (worldState(a.world) as Record<string, unknown>)), 'no field in the hash');
  }
});

check('old run saves (fixtures) load byte for byte and play on through their next battles; an open battle of row 1–2 starts with the goblin\'s leave', () => {
  const saves: [string, string][] = [
    ['before-chain6', beforeChain6.save], ['before-mix', beforeMix.save], ['before-record', beforeRecord.save],
    ['before-reroll hard', beforeReroll.hard], ['before-reroll event', beforeReroll.event], ['hard-battle', JSON.stringify(hardBattle)],
    ['open-die low', openDie.low], ['open-die high', openDie.high],
  ];
  let battles = 0;
  for (const [name, text] of saves) {
    let run = parseRtRun(text);
    assert(run, `${name}: loads`);
    if (name !== 'hard-battle') assert(serializeRtRun(run) === text, `${name}: saves back byte for byte`);
    let fought = 0;
    for (let step = 0; step < 200 && !run.result && fought < 3; step++) {
      const pending = run.pending;
      if (pending?.kind === 'battle') {
        const node = rtNode(run, pending.nodeId)!, loadout = rtArenaLoadout(run);
        assert(!!loadout.slot === (node.type !== 'checkpoint' && node.type !== 'boss'), `${name}: ${node.type} row ${runRow(node.row)} — the goblin's leave ${loadout.slot}`);
        const { outcome } = playFight(run, { chains: [6, 6], k: fought + 1 });
        assert(outcome.purse === undefined && outcome.doorDie === undefined, `${name}: no door record`);
        run = ok(resolveArena(run, outcome), `${name}: resolve`);
        assert(same(parseRtRun(serializeRtRun(run)), run), `${name}: the save after the fight loads back`);
        fought++; battles++;
        continue;
      }
      if (pending?.kind === 'die') { run = ok(rtDieChoose(run, false), `${name}: the old die`); continue; }
      if (pending) { run = closeNode(run); continue; }
      run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), `${name}: enter`);
    }
    assert(fought >= 1 || !!run.result, `${name}: played on (${fought} battles)`);
  }
  assert(battles >= 10, `battles after the old saves: ${battles}`);
  // A save with the first battle open (row 1): its reload starts the arena with the goblin's leave.
  const open = firstBattle(5), back = parseRtRun(serializeRtRun(open))!;
  assert(same(rtArenaLoadout(back), rtArenaLoadout(open)) && rtArenaLoadout(back).slot === true, 'the reloaded row-1 battle has the leave');
});

console.log(`realtime-casino-slice: ${checks} checks passed`);
