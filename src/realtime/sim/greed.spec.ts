/**
 * П4 «Раздув за дела» (sim/purse.ts, `Params.greedByDeeds`; docs/realtime-casino.md, «Раздув за дела»; research
 * docs/realtime-engagement-research.md, П4 and decision 9.1.2). Node only: `npm run test:realtime-greed`.
 *
 * Every check plays journalled commands (place, begin / drag, release, teleport, clear) on a field whose goal is 3 kills,
 * and reads what the player gets: the goal line after the goals (`greedLine`, the HUD's text), the door's record and the
 * resources the run pays for it with and without the die:
 * - chains before the goals do not count (also the chain that completes the goals); after the goals every 2 chains of 3+
 *   enemy links raise the step ×1 → ×1,5 → ×2 → ×3 (the ceiling); a chain of 2 enemy links, or one whose dash stops on a
 *   survivor after 2, does not count;
 * - a hit on the hero (a touch) takes one step off and resets the count; a hit with nothing to take changes nothing;
 * - a 3+ chain into the door counts before the exit: the door pays the cauldron × its step (96 × 1,5 → 2 resources, not 1);
 *   the die screen's «Забрать» and both halves of the roll pay with the step; the cap stays the cap of the stakes (204 × 3 →
 *   still 3) and the line names it («потолок 3»);
 * - the cheque and its highlight (`planChain`) do not change with the rule;
 * - the fight replays to the same hash (hashes every 60 ticks: the fights are short); a journal without the key plays the old world; the rule
 *   without the cauldron does nothing; the run turns it on; the logs record the step at the door.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain } from './chain';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { greedLine, greedOn, purseResources, type PurseDoor } from './purse';
import { Simulation, replay } from './simulation';
import type { World, WorldEvent } from './world';
import { createRtRun, resolveArena, rtAvailableNodes, rtChooseGift, rtDieChoose, rtDieFace, rtDieMult, rtDieView, rtEnterNode, rtRunParams, RT_RUN_FORCED, type RtRunState, type RtRunStep } from '../run/rtRun';
import { createFightObserver } from '../telemetry/observe';
import { withSummaryDefaults, type FightSummary } from '../telemetry/schema';
import type { Journal } from './simulation';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'greed-field', name: 'Поле раздува', summary: 'Тест раздува', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 3,
});

/** A quiet fight with the cauldron and the rule on: no newcomers, nobody walks, no hit-stop; touch 1 HP (only who stands on the hero). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 1; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.purse = true; p.greedByDeeds = true;
  return Object.assign(p, extra);
}

/** Checkpoints: the fights here last a few hundred ticks, so the replay compares the hash every 60 (stricter than 300). */
const CHECKPOINT = 60;
/** A fight with its hashes every `CHECKPOINT` ticks (the replay must repeat them). */
interface Fight { sim: Simulation; hashes: Map<number, string>; events: WorldEvent[] }
function fight(params: Params = quiet(), k = 1, loadout: Loadout = {}): Fight {
  const sim = new Simulation({ arena: 'greed-field', params, seed: seedOf(k), record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  return { sim, hashes: new Map(), events: [] };
}
function tick(f: Fight): void {
  f.sim.tick();
  f.events.push(...f.sim.world.events);
  f.sim.world.events.length = 0;
  if (f.sim.world.tick % CHECKPOINT === 0) f.hashes.set(f.sim.world.tick, f.sim.hash());
}
/** Ticks until the hero stands again. */
function settle(f: Fight): void { for (let i = 0; i < 900 && (f.sim.world.move || i === 0); i++) tick(f); }

type Pt = { x: number; y: number };
const CRYSTAL = -1;
/** Enemies of HP `hps` (`CRYSTAL` — a crystal) in a row from x = `from`, y = 6, 1.4 apart (the hero is teleported to `from` first). */
function lay(f: Fight, hps: readonly number[], from = 3): Pt[] {
  f.sim.command({ t: 'teleport', x: from, y: 6 });
  return hps.map((hp, i) => {
    const p = { x: from + 1.4 * (i + 1), y: 6 };
    if (hp === CRYSTAL) { f.sim.command({ t: 'crystal', x: p.x, y: p.y, value: 6 }); return p; }
    f.sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp, kind: 'basic' });
    return p;
  });
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);

/**
 * Draws a chain of enemies of HP `hps`, optionally ending on the door (the row then ends 1.4 before it), checks the
 * highlight's cheque is the dash's, releases and plays the dash. Returns the cheque (the cauldron off: none is checked).
 */
function chain(f: Fight, hps: readonly number[], door = false): Ev<'cheque'> {
  const w = f.sim.world, d = w.objects.find(o => o.kind === 'door')!;
  const points = lay(f, hps, door ? d.x - 1.4 * (hps.length + 1) : 3);
  if (door) points.push({ x: d.x, y: d.y });
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) f.sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === points.length, `the chain took ${w.chain.length} links, wanted ${points.length}`);
  const planned = planChain(w).cheque;
  const before = f.events.length;
  f.sim.command({ t: 'release' });
  settle(f);
  const cheques = of(f.events.slice(before), 'cheque');
  if (!w.params.purse) { assert(!planned && !cheques.length, 'no cauldron: no cheque'); return null as unknown as Ev<'cheque'>; }
  assert(planned && cheques.length === 1, `one cheque: ${cheques.length}`);
  assert(cheques[0].total === planned.total && cheques[0].links === planned.links, `the highlight ${planned.total} = the dash ${cheques[0].total}`);
  return cheques[0];
}
const weak = (n: number): number[] => Array<number>(n).fill(0);

/** A touch: an enemy is placed on the hero and stays until it hits once; then the field is cleared. Returns the hit. */
function touch(f: Fight): Ev<'hit'> {
  const w = f.sim.world, before = f.events.length;
  f.sim.command({ t: 'place', x: w.hero.x, y: w.hero.y, color: 1, hp: 0, kind: 'basic' });
  for (let i = 0; i < 1200 && !of(f.events.slice(before), 'hit').length; i++) tick(f);
  f.sim.command({ t: 'clear', keepMarked: false });
  const hits = of(f.events.slice(before), 'hit');
  assert(hits.length === 1 && hits[0].damage > 0, `one hit: ${hits.length}`);
  return hits[0];
}

/** Completes the goals with a chain of 3 weak enemies (released before the goals: it does not count). */
function goals(f: Fight): void {
  chain(f, weak(3));
  assert(f.sim.world.stage === 'greed', 'the 3 kills complete the goals');
}
const line = (w: World): string | null => greedLine(w);
/** The greed state (a call: no narrowing between commands). */
const greedOf = (w: World) => w.purse?.greed;
const replays = (f: Fight): boolean => {
  const seen = new Map<number, string>();
  const again = replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, s => { if (s.world.tick % CHECKPOINT === 0) seen.set(s.world.tick, s.hash()); });
  return again.hash() === f.sim.hash() && f.hashes.size > 0 && [...f.hashes].every(([t, h]) => seen.get(t) === h);
};

// ---- Steps ----

check('steps: the chain that completes the goals does not count; after them every 2 chains of 3+ enemy links — ×1 → ×1,5 → ×2 → ×3, then the ceiling', () => {
  const f = fight(quiet({ purseRate: 200 })), w = f.sim.world;
  assert(line(w) === null, 'no line before the goals');
  goals(f);
  assert(!w.purse?.greed, 'the goals chain was released before the goals: no count');
  assert(line(w) === 'дверь открыта · котёл 6 ×1 · ещё 2 цепи 3+ → ×1,5', `the line: ${line(w)}`);
  chain(f, weak(2));
  assert(line(w) === 'дверь открыта · котёл 8 ×1 · ещё 2 цепи 3+ → ×1,5', `a chain of 2 does not count: ${line(w)}`);
  chain(f, weak(3));
  assert(line(w) === 'дверь открыта · котёл 14 ×1 · ещё 1 цепь 3+ → ×1,5', `one chain of 3: ${line(w)}`);
  chain(f, weak(4));
  assert(line(w) === 'дверь открыта · котёл 26 ×1,5 · ещё 2 цепи 3+ → ×2', `two chains: ×1,5 (${line(w)})`);
  chain(f, weak(3)); chain(f, weak(3));
  assert(line(w) === 'дверь открыта · котёл 38 ×2 · ещё 2 цепи 3+ → ×3', `four chains: ×2 (${line(w)})`);
  chain(f, weak(3));
  assert(line(w) === 'дверь открыта · котёл 44 ×2 · ещё 1 цепь 3+ → ×3', `five chains (${line(w)})`);
  chain(f, weak(3));
  assert(line(w) === 'дверь открыта · котёл 50 ×3', `six chains: the ceiling ×3 (${line(w)})`);
  chain(f, weak(3)); chain(f, weak(3));
  assert(line(w) === 'дверь открыта · котёл 62 ×3' && greedOf(w)?.step === 3, `no step above ×3 (${line(w)})`);
  const ups = of(f.events, 'greed');
  assert(ups.length === 6 && ups.every(e => e.cause === 'chain') && ups.map(e => e.mult).join() === '1,1.5,1.5,2,2,3', `greed events ${ups.map(e => e.mult).join()}`);
  assert(!of(f.events, 'hit').length, 'no hit on the way');
  assert(replays(f), 'the fight replays (hashes every 60 ticks: the fights are short)');
});

check('enemy links count, not links: 2 enemies and a crystal do not count; 3 enemies with a survivor at the end do', () => {
  const f = fight(quiet({ purseRate: 200 })), w = f.sim.world;
  goals(f);
  const crystal = chain(f, [0, CRYSTAL, 0]);
  assert(crystal.links === 2 && crystal.crystals === 1 && !w.purse?.greed, `2 enemies and a crystal: ${crystal.links} enemy links, no count`);
  // HP 6 at the end survives the hit (power 3): struck, an enemy link.
  const survivor = chain(f, [0, 0, 6]);
  assert(survivor.links === 3 && !survivor.finish && greedOf(w)?.chains === 1, 'weak, weak, a survivor: counted');
  f.sim.command({ t: 'clear', keepMarked: false });
  chain(f, [0, 0, 2]);
  assert(greedOf(w)?.step === 1, 'weak, weak, tough 2: the second — ×1,5');
});

// ---- Hits ----

check('a hit takes one step off and resets the count; a hit with nothing to take changes nothing (no field)', () => {
  const f = fight(quiet({ purseRate: 200 })), w = f.sim.world;
  goals(f);
  touch(f);
  assert(!w.purse?.greed && line(w)!.endsWith('×1 · ещё 2 цепи 3+ → ×1,5'), `nothing to take: ${line(w)}`);
  chain(f, weak(3)); chain(f, weak(3)); chain(f, weak(3));
  assert(line(w)!.endsWith('×1,5 · ещё 1 цепь 3+ → ×2'), `×1,5 and one toward ×2: ${line(w)}`);
  touch(f);
  assert(line(w)!.endsWith('×1 · ещё 2 цепи 3+ → ×1,5'), `the hit: back to ×1, the count reset (${line(w)})`);
  chain(f, weak(3));
  touch(f);
  assert(line(w)!.endsWith('×1 · ещё 2 цепи 3+ → ×1,5') && greedOf(w)?.chains === 0, `a hit at ×1 resets the count: ${line(w)}`);
  for (let i = 0; i < 6; i++) chain(f, weak(3));
  assert(line(w)!.endsWith('×3'), `the ceiling: ${line(w)}`);
  touch(f);
  assert(line(w)!.endsWith('×2 · ещё 2 цепи 3+ → ×3'), `a hit at ×3: ×2 (${line(w)})`);
  const hits = of(f.events, 'greed').filter(e => e.cause === 'hit');
  assert(hits.map(e => e.mult).join() === '1,1,2', `hit events ${hits.map(e => e.mult).join()}`);
  assert(replays(f), 'the fight replays');
});

// ---- The door ----

function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}
const total = (run: RtRunState): number => Object.values(run.materials).reduce((a, b) => a + b, 0);

/** 3 weak (goals, 6), 9 weak (45 → 51, counted), 9 weak into the door (45 → 96, counted: ×1,5 before the exit). */
function exitAt96(params: Params, k = 1): { f: Fight; door: PurseDoor; ev: Ev<'purseDoor'> } {
  const f = fight(params, k), w = f.sim.world;
  goals(f);
  chain(f, weak(9));
  chain(f, weak(9), true);
  assert(w.status === 'victory', 'the door won the arena');
  const evs = of(f.events, 'purseDoor');
  assert(evs.length === 1 && w.purse?.door, 'the door recorded the cauldron');
  return { f, door: w.purse.door, ev: evs[0] };
}

check('a 3+ chain into the door counts before the exit: the door records ×1,5 and pays 96 × 1,5 ÷ 60 = 2 (without the rule: 1)', () => {
  const on = exitAt96(quiet());
  assert(on.door.cauldron === 96 && on.door.greed === 1.5 && on.ev.step === 1 && on.ev.resources === 2, `door ${JSON.stringify(on.door)} → ${on.ev.resources}`);
  const off = exitAt96(quiet({ greedByDeeds: false }));
  assert(off.door.cauldron === 96 && off.door.greed === undefined && off.ev.resources === 1, `off: ${off.ev.resources}`);
  assert(replays(on.f), 'the fight replays');
});

// The run also plays П3 «Финальная цепь» (12.10.2026): the 9 weak into the door are 9 × 6 = 54, not 45 — the cauldron 105.
// The run's rate is 120 (12.10.2026, `RT_RUN_FORCED.purseRate`): 105 × 1,5 = 157,5 → 1 (without the step 105 → 0).
// Task 5 (12.10.2026): the run plays no cauldron and no die — the run layer still pays such a door record (the cauldron and the
// die turned on over the run's values, the sandbox's way); the run's own arena has no greed (no cauldron, `greedOn` false).
check('the run layer pays the step: «Забрать» 1 (105 × 1,5 ÷ 120; without the step 0), the roll 1–3 → 0 (105 × 1,5 × 0,5), 4–6 → 2 (105 × 1,5 × 2), on 6 seeds (both halves come up)', () => {
  assert(RT_RUN_FORCED.greedByDeeds === true && RT_RUN_FORCED.purse === false && rtRunParams(defaultParams()).greedByDeeds === true && defaultParams().greedByDeeds === false, 'on in the run (no cauldron there), off in the sandbox by default');
  assert(!greedOn(new Simulation({ arena: 'greed-field', params: rtRunParams(quiet()), seed: seedOf(1) }).world), 'the run arena: the greed rule idle');
  const faces = new Set<number>();
  for (let k = 1; k <= 6; k++) {
    let run = ok(rtChooseGift(createRtRun(seedOf(k), { gift: 'mini' }), 1), 'gift');
    run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
    const pending = run.pending;
    assert(pending?.kind === 'battle', 'a battle node');
    const params = { ...rtRunParams(quiet({ greedByDeeds: false, contactDamage: 0 })), purse: true };
    const { f, door } = exitAt96(params, k), w = f.sim.world;
    assert(w.params.greedByDeeds && door.greed === 1.5, `seed ${k}: the run arena plays with the rule`);
    const shown = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: w.hero.hp, kills: w.stats.kills, damage: 0, time: w.time, purse: door, doorDie: true }), 'resolve');
    const view = rtDieView(shown)!;
    assert(view && view.cauldron === 105 && view.greed === 1.5 && view.rate === 120 && view.take === 1 && view.low === 0 && view.high === 2, `seed ${k}: the die screen ${JSON.stringify(view)}`);
    assert(purseResources(door.cauldron, door.oath, 1, door.rate) === 0, `seed ${k}: without the step «Забрать» would pay 0`);
    const before = total(shown);
    assert(total(ok(rtDieChoose(shown, false), 'take')) - before === 1, `seed ${k}: «Забрать» pays 1`);
    const face = shown.pending?.kind === 'die' ? shown.pending.face : 0;
    faces.add(face);
    const rolled = total(ok(rtDieChoose(shown, true), 'roll')) - before;
    assert(rolled === (rtDieMult(face) > 1 ? 2 : 0) && face === rtDieFace(run.seed, 0), `seed ${k}: the roll (face ${face}) pays ${rolled}`);
  }
  assert([...faces].some(x => rtDieMult(x) < 1) && [...faces].some(x => rtDieMult(x) > 1), `both halves of the die: ${[...faces].join()}`);
});

check('the cap stays the cap of the stakes: 204 at ×3 still pays 3; the line names it («потолок 3») and keeps the step', () => {
  const f = fight(quiet()), w = f.sim.world;
  goals(f);
  chain(f, weak(9)); chain(f, weak(9));
  assert(line(w) === 'дверь открыта · котёл 96 ×1,5 · ещё 2 цепи 3+ → ×2', `96 × 1,5 = 144 → 2 of 3, below the cap: ${line(w)}`);
  chain(f, weak(3));
  chain(f, weak(4));
  assert(line(w) === 'дверь открыта · котёл 114 ×2 · потолок 3', `114 × 2 = 228 → 3: the cap (${line(w)})`);
  chain(f, weak(9)); chain(f, weak(9));
  assert(line(w) === 'дверь открыта · котёл 204 ×3 · потолок 3', `the ceiling at the cap: ${line(w)}`);
  chain(f, weak(3), true);
  assert(w.status === 'victory' && w.purse?.door?.greed === 3 && of(f.events, 'purseDoor')[0].resources === 3, `the door pays 3: ${JSON.stringify(w.purse?.door)}`);
});

check('the cap line and the oath (design 12.10.2026): an «at least once» oath that waits shows no cap; a holding one — its cap 6', () => {
  // «Кристалл в цепи» not met yet: 114 × 2 = 228 would pay 1 at ×0.5, but meeting the oath may still raise the cap — no «потолок».
  const once = fight(quiet({ oathStake: true }), 1, { oath: 'crystal-chain' }), w = once.sim.world;
  goals(once);
  chain(once, weak(9)); chain(once, weak(9)); chain(once, weak(3)); chain(once, weak(4));
  assert(line(w) === 'дверь открыта · котёл 114 ×2 · ещё 2 цепи 3+ → ×3', `the waiting oath: no cap (${line(w)})`);
  // «Цепи 3+» holds (every chain after the first has 3+): ×2 raises the cap to 6; 114 × 2 × 2 = 456 → 7 → «потолок 6».
  const holds = fight(quiet({ oathStake: true }), 1, { oath: 'chains3' }), h = holds.sim.world;
  goals(holds);
  chain(holds, weak(9)); chain(holds, weak(9)); chain(holds, weak(3)); chain(holds, weak(4));
  assert(line(h) === 'дверь открыта · котёл 114 ×2 · потолок 6', `the holding oath: its cap (${line(h)})`);
});

// ---- The rule does not touch the cheque; old journals ----

check('the cheque and its highlight are the same with and without the rule (the step multiplies only the door)', () => {
  const shape = (params: Params): string => {
    const f = fight(params);
    goals(f);
    const out = [chain(f, weak(4)), chain(f, [0, 0, 2, 0, 0, 3]), chain(f, weak(6))].map(c => `${c.embers}×${c.heat}×${c.mult}=${c.total}`);
    return `${out.join(' ')} → ${f.sim.world.purse!.cauldron}`;
  };
  const on = shape(quiet()), off = shape(quiet({ greedByDeeds: false }));
  assert(on === off, `with the rule ${on}, without ${off}`);
});

check('off: a journal without the key plays the old world (no greed field, no door field); the rule without the cauldron does nothing; 3 seeds', () => {
  const play = (params: Params, k: number): Fight => {
    const f = fight(params, k);
    goals(f);
    chain(f, weak(3)); chain(f, weak(3)); touch(f);
    chain(f, weak(3)); chain(f, weak(3), true);
    return f;
  };
  const without = (w: World) => { const s = { ...(worldState(w) as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };
  for (let k = 1; k <= 3; k++) {
    const old = quiet({ greedByDeeds: false }) as Partial<Params>;
    delete old.greedByDeeds;
    const a = play(quiet({ greedByDeeds: false }), k), b = play(old as Params, k);
    for (const f of [a, b]) assert(!f.sim.world.purse?.greed && f.sim.world.purse?.door?.greed === undefined && !of(f.events, 'greed').length, `seed ${k}: no greed`);
    assert(without(a.sim.world) === without(b.sim.world), `seed ${k}: the same world`);
    const journal = b.sim.exportJournal()!;
    assert(!('greedByDeeds' in journal.params) && replay(JSON.parse(JSON.stringify(journal)) as Journal).hash() === b.sim.hash(), `seed ${k}: the old journal replays`);
    const noPurse = play(quiet({ purse: false }), k);
    assert(!noPurse.sim.world.purse && line(noPurse.sim.world) === null, `seed ${k}: no cauldron — no rule, no line`);
  }
});

// ---- Logs ----

function observed(journal: Journal): FightSummary {
  const sim = new Simulation({ arena: journal.arena, params: journal.params, seed: journal.seed });
  const observer = createFightObserver(sim.world);
  let next = 0;
  const upTo = (t: number) => { while (next < journal.commands.length && journal.commands[next].tick <= t) { const c = journal.commands[next++].cmd; sim.command(c); observer.command(c, sim.world); } };
  for (let t = 0; t < journal.ticks; t++) { upTo(t); sim.tick(); observer.tick(sim.world); sim.world.events.length = 0; }
  upTo(journal.ticks);
  return observer.summary();
}

check('the logs: `purse.exitStep` — the step at the door (1 for ×1,5); without the rule null; an older record reads null', () => {
  const on = exitAt96(quiet()), off = exitAt96(quiet({ greedByDeeds: false }));
  const a = observed(on.f.sim.exportJournal()!).purse, b = observed(off.f.sim.exportJournal()!).purse;
  assert(a.exitStep === 1 && a.resources === 2, `on: step ${a.exitStep}, resources ${a.resources}`);
  assert(b.exitStep === null && b.resources === 1, `off: step ${b.exitStep}`);
  const older = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
  delete older.exitStep;
  assert(withSummaryDefaults({ purse: older }).purse.exitStep === null, 'an older record: null');
});

console.log(`realtime-greed: ${checks} checks passed`);
