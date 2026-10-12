/**
 * П3 «Финальная цепь» (sim/purse.ts, `Params.doorFinale`; docs/realtime-casino.md, «Финальная цепь (П3)»; research
 * docs/realtime-engagement-research.md, П3; design 12.10.2026). Node only: `npm run test:realtime-door-finale`.
 *
 * Every check plays journalled commands (place, crystal, begin / drag, release, teleport, energy, jump, clear) on a field
 * whose goal is 3 kills, and reads what the player gets — the cheque of the dash, the highlight's cheque (`planChain`, the
 * HUD forecast), the cauldron, the door's record:
 * - a chain that enters the open door gets +1 heat with the rule (1 weak: 1 × 2 = 2, not 1; 4 weak: 4 × 4 = 16, not 12),
 *   the highlight shows the same cheque before the release, from 1 enemy link;
 * - a chain that does not end on the door, a walk into the door and a jump into it get nothing; the door records how the
 *   hero went in (`purseDoor.by`);
 * - П4 «Раздув за дела» counts enemy links, not heat: a 2-link chain into the door does not count, a 3-link one does;
 * - the rule without the cauldron does nothing; a journal without the key plays the old world; fights replay to the same
 *   hash (hashes every 10 ticks) on 3 seeds; the run turns the rule on; the logs record the exit (`purse.exitBy`).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain } from './chain';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import type { World, WorldEvent } from './world';
import { rtRunParams, RT_RUN_FORCED } from '../run/rtRun';
import { createFightObserver } from '../telemetry/observe';
import { withSummaryDefaults, type FightSummary } from '../telemetry/schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'finale-field', name: 'Поле финала', summary: 'Тест финальной цепи', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 3,
});

/** A quiet fight with the cauldron and the rule on: no newcomers, nobody walks, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 1; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.purse = true; p.doorFinale = true;
  return Object.assign(p, extra);
}

/** Checkpoints: the fights here last some dozens of ticks, so the replay compares the hash every 10 (stricter than 300). */
const CHECKPOINT = 10;
interface Fight { sim: Simulation; hashes: Map<number, string>; events: WorldEvent[] }
function fight(params: Params = quiet(), k = 1): Fight {
  const sim = new Simulation({ arena: 'finale-field', params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return { sim, hashes: new Map(), events: [] };
}
function tick(f: Fight): void {
  f.sim.tick();
  f.events.push(...f.sim.world.events);
  f.sim.world.events.length = 0;
  if (f.sim.world.tick % CHECKPOINT === 0) f.hashes.set(f.sim.world.tick, f.sim.hash());
}
/** Ticks until the hero stands again (or the fight is over). */
function settle(f: Fight): void { for (let i = 0; i < 900 && (f.sim.world.move || i === 0) && f.sim.world.status === 'playing'; i++) tick(f); }

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
const shape = (c: { embers: number; heat: number; mult: number; total: number; links: number; door?: boolean }): string =>
  `${c.embers}×${c.heat}×${c.mult}=${c.total} links ${c.links}${c.door ? ' door' : ''}`;

/**
 * Draws a chain of enemies of HP `hps`, optionally ending on the door (the row then ends 1.4 before it), checks the
 * highlight's cheque is the dash's (every number), releases and plays the dash. Returns the dash's cheque (null — none).
 */
function chain(f: Fight, hps: readonly number[], door = false): Ev<'cheque'> | null {
  const w = f.sim.world, d = w.objects.find(o => o.kind === 'door')!;
  const points = lay(f, hps, door ? d.x - 1.4 * (hps.length + 1) : 3);
  if (door) points.push({ x: d.x, y: d.y });
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) f.sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === points.length, `the chain took ${w.chain.length} links, wanted ${points.length}`);
  const planned = planChain(w).cheque ?? null;
  const before = f.events.length;
  f.sim.command({ t: 'release' });
  settle(f);
  const cheques = of(f.events.slice(before), 'cheque');
  if (!w.params.purse) { assert(!planned && !cheques.length, 'no cauldron: no cheque'); return null; }
  assert(planned && cheques.length === 1, `one cheque: ${cheques.length}`);
  assert(shape(planned) === shape(cheques[0]), `the highlight ${shape(planned)} = the dash ${shape(cheques[0])}`);
  return cheques[0];
}
const weak = (n: number): number[] => Array<number>(n).fill(0);
/** Completes the goals with a chain of 3 weak enemies (3 × 2 = 6 in the cauldron). */
function goals(f: Fight): void {
  chain(f, weak(3));
  assert(f.sim.world.stage === 'greed', 'the 3 kills complete the goals');
}
const doorOf = (w: World) => w.objects.find(o => o.kind === 'door')!;
/** Walks into the door: the hero stands beside it, then on it — the next tick is a new touch. */
function walkIn(f: Fight): void {
  const d = doorOf(f.sim.world);
  f.sim.command({ t: 'teleport', x: d.x - 3, y: d.y });
  tick(f);
  f.sim.command({ t: 'teleport', x: d.x, y: d.y });
  for (let i = 0; i < 5 && f.sim.world.status === 'playing'; i++) tick(f);
}
/** Jumps into the door from 2 units away. */
function jumpIn(f: Fight): void {
  const d = doorOf(f.sim.world);
  f.sim.command({ t: 'teleport', x: d.x - 2, y: d.y });
  f.sim.command({ t: 'energy', value: 7 });
  assert(f.sim.command({ t: 'jump', x: d.x, y: d.y }), 'the jump started');
  settle(f);
}
const replays = (f: Fight): boolean => {
  const seen = new Map<number, string>();
  const again = replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, s => { if (s.world.tick % CHECKPOINT === 0) seen.set(s.world.tick, s.hash()); });
  return again.hash() === f.sim.hash() && f.hashes.size > 0 && [...f.hashes].every(([t, h]) => seen.get(t) === h);
};

// ---- The cheque of a chain into the door ----

check('a chain into the door gets +1 heat with the rule — 1 weak 1 × 2 = 2 (not 1), 3 weak 3 × 3 (not 3 × 2), 4 weak 4 × 4 = 16 (not 12); the highlight = the dash', () => {
  const cases: [number[], string, string][] = [
    [weak(1), '1×2×1=2 links 1 door', '1×1×1=1 links 1'],
    [weak(3), '3×3×1=9 links 3 door', '3×2×1=6 links 3'],
    [weak(4), '4×4×1=16 links 4 door', '4×3×1=12 links 4'],
  ];
  for (const [hps, on, off] of cases) {
    const a = fight(), b = fight(quiet({ doorFinale: false }));
    goals(a); goals(b);
    const withRule = chain(a, hps, true)!, without = chain(b, hps, true)!;
    assert(shape(withRule) === on && shape(without) === off, `${hps.length} into the door: ${shape(withRule)} / ${shape(without)}`);
    assert(a.sim.world.status === 'victory' && a.sim.world.purse?.door?.cauldron === 6 + withRule.total, `the door records the cheque: ${a.sim.world.purse?.door?.cauldron}`);
    assert(b.sim.world.purse?.door?.cauldron === 6 + without.total, 'without the rule the door records the old cheque');
  }
});

check('the highlight of a chain into the door shows the bonus from 1 enemy link (before the release) and with crystals and a tough last link', () => {
  const f = fight(), w = f.sim.world;
  goals(f);
  const d = doorOf(w), points = lay(f, [0], d.x - 2.8);
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  const open = planChain(w).cheque!;
  assert(!open.door && open.heat === 1, `1 link, not yet into the door: ${shape(open)}`);
  f.sim.command({ t: 'drag', x: d.x, y: d.y, mode: 'full' });
  const into = planChain(w).cheque!;
  assert(into.door && into.links === 1 && into.heat === 2 && into.total === 2, `1 link into the door: ${shape(into)}`);
  f.sim.command({ t: 'cancel' });
  // weak, crystal, weak, weak, tough 2 into the door: embers 1+1+1+2 = 5, heat 1 + 1 (3rd) + 1 (добивание) + 1 (door), ◆2.
  const c = chain(f, [0, CRYSTAL, 0, 0, 2], true)!;
  assert(shape(c) === '5×4×2=40 links 4 door', `crystal and tough into the door: ${shape(c)}`);
});

check('no bonus off the door: a chain to an enemy, a walk into the door and a jump into it; the door records how the hero went in', () => {
  const a = fight(), b = fight(quiet({ doorFinale: false }));
  goals(a); goals(b);
  assert(shape(chain(a, weak(4))!) === shape(chain(b, weak(4))!), 'a chain not into the door: the same cheque');
  const before = a.sim.world.purse!.cauldron;
  walkIn(a);
  assert(a.sim.world.status === 'victory' && a.sim.world.purse?.door?.cauldron === before, `a walk-in adds nothing: ${a.sim.world.purse?.door?.cauldron}`);
  assert(of(a.events, 'purseDoor')[0].by === 'walk', 'by walking');
  const j = fight();
  goals(j);
  chain(j, weak(4));
  const was = j.sim.world.purse!.cauldron;
  jumpIn(j);
  assert(j.sim.world.status === 'victory' && j.sim.world.purse?.door?.cauldron === was && of(j.events, 'purseDoor')[0].by === 'jump', `a jump adds nothing: ${j.sim.world.purse?.door?.cauldron}`);
  const c = fight();
  goals(c);
  chain(c, weak(2), true);
  assert(of(c.events, 'purseDoor')[0].by === 'chain', 'by the chain');
  assert(replays(a) && replays(j) && replays(c), 'the fights replay');
});

check('П4 counts enemy links, not heat: a 2-link chain into the door (heat 2) does not count, a 3-link one does', () => {
  const two = fight(quiet({ greedByDeeds: true }));
  goals(two);
  chain(two, weak(3));
  const c2 = chain(two, weak(2), true)!;
  assert(c2.heat === 2 && c2.door, `2 links into the door: heat ${c2.heat}`);
  assert(two.sim.world.purse?.greed?.chains === 1 && two.sim.world.purse.door?.greed === 1, `one counted chain, step ×1: ${JSON.stringify(two.sim.world.purse?.greed)}`);
  const three = fight(quiet({ greedByDeeds: true }));
  goals(three);
  chain(three, weak(3));
  chain(three, weak(3), true);
  assert(three.sim.world.purse?.door?.greed === 1.5, `3 links into the door: the second counted chain — ×1,5 (${three.sim.world.purse?.door?.greed})`);
});

// ---- Old journals, the cauldron off, replays ----

check('the rule without the cauldron does nothing; a journal without the key plays the old world; fights replay on 3 seeds', () => {
  const play = (params: Params, k: number): Fight => {
    const f = fight(params, k);
    goals(f);
    chain(f, weak(4)); chain(f, [0, CRYSTAL, 0]);
    chain(f, weak(3), true);
    return f;
  };
  const without = (w: World) => { const s = { ...(worldState(w) as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };
  const cauldrons = new Set<number>();
  for (let k = 1; k <= 3; k++) {
    const on = play(quiet(), k);
    assert(replays(on), `seed ${k}: the fight with the rule replays (hashes every 10 ticks)`);
    cauldrons.add(on.sim.world.purse!.door!.cauldron);
    const old = quiet({ doorFinale: false }) as Partial<Params>;
    delete old.doorFinale;
    const a = play(quiet({ doorFinale: false }), k), b = play(old as Params, k);
    assert(without(a.sim.world) === without(b.sim.world), `seed ${k}: the same world without the key`);
    assert(on.sim.world.purse!.door!.cauldron === a.sim.world.purse!.door!.cauldron + 3, `seed ${k}: the rule adds the door chain's +1 heat × 3 embers`);
    const journal = b.sim.exportJournal()!;
    assert(!('doorFinale' in journal.params) && replay(JSON.parse(JSON.stringify(journal)) as Journal).hash() === b.sim.hash(), `seed ${k}: the old journal replays`);
    const noPurse = play(quiet({ purse: false }), k);
    assert(!noPurse.sim.world.purse && !of(noPurse.events, 'cheque').length, `seed ${k}: no cauldron — nothing`);
  }
  assert(cauldrons.size === 1, 'no chance in the rule: every seed records the same cauldron');
});

// ---- The run ----

check('the run keeps the rule on, idle without its cauldron (task 5, 12.10.2026): a run arena\'s chain into the door puts no cheque; with the cauldron turned on over the run\'s values it pays its +1 heat (sandbox default off)', () => {
  assert(RT_RUN_FORCED.doorFinale === true && RT_RUN_FORCED.purse === false && rtRunParams(defaultParams()).doorFinale === true && defaultParams().doorFinale === false, 'on in the run (no cauldron there), off by default');
  const run = fight(rtRunParams(quiet({ purse: true, contactDamage: 0 })));
  goals(run);
  assert(chain(run, weak(4), true) === null && run.sim.world.status === 'victory' && run.sim.world.purse === undefined, 'the run arena: no cheque, no door record');
  const f = fight({ ...rtRunParams(quiet({ doorFinale: false, contactDamage: 0 })), purse: true }), w = f.sim.world;
  goals(f);
  const c = chain(f, weak(4), true)!;
  assert(c.door && c.heat === 4 && w.purse?.door?.cauldron === 22, `the run arena: ${shape(c)} → ${w.purse?.door?.cauldron}`);
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

check('the logs: `purse.exitBy` — chain, jump, walk (also without the rule); no exit — null; an older record reads null', () => {
  const by = (exit: (f: Fight) => void, params = quiet()): FightSummary['purse'] => {
    const f = fight(params);
    goals(f);
    exit(f);
    return observed(f.sim.exportJournal()!).purse;
  };
  const viaChain = by(f => { chain(f, weak(3), true); });
  const lastHeat = viaChain.heat[viaChain.heat.length - 1];
  assert(viaChain.exitBy === 'chain' && lastHeat === 3, `chain: ${viaChain.exitBy}, heat ${lastHeat}`);
  assert(by(jumpIn).exitBy === 'jump' && by(walkIn).exitBy === 'walk', 'jump and walk');
  assert(by(walkIn, quiet({ doorFinale: false })).exitBy === 'walk', 'without the rule too');
  assert(by(f => { chain(f, weak(3)); }).exitBy === null, 'no exit: null');
  const older = JSON.parse(JSON.stringify(viaChain)) as Record<string, unknown>;
  delete older.exitBy;
  assert(withSummaryDefaults({ purse: older }).purse.exitBy === null, 'an older record: null');
});

console.log(`realtime-door-finale: ${checks} checks passed`);
