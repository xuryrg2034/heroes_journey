/**
 * Task 29 (8) «попарный набор форм» (design 15.10.2026, docs/design-notes/tasks-29-30.md; docs/realtime-prototype.md, 9ф): every
 * pair of forms of DIFFERENT fields — «Звено» (Развилка, Чужак, Близнецы, Якорь у героя), «Путь» (Наледь, Огненный проход,
 * Режущий проход, «Возврат»), «Конец» (Печать, Прямая, Взрыв на конце) — plays real fights by journal commands: a bot draws
 * chains (the nearest first link, then the straightest), on each the plan before the release is compared with what the dash did.
 * The plan promises the links up to the stop, the pierce's bodies and the return run's hits (`planChain`: links, pierce, back);
 * the other forms' effects (fire, cuts, the end blast, the seal's strike, the frost) are not outcomes of the plan — a body they
 * hit is left out of the comparison and counted. Every fight replays from its journal to the same hash (checkpoints every 300
 * ticks). The bot's victory or defeat is not asserted. Two hammers never go together (one hammer slot): such pairs are left out.
 * Besides the pairs (the shadow of «Возврат», 15.10.2026): «Возврат» with the counter «Ударная волна» of the chain window — the
 * wave's hits on bodies the run then strikes are compared (the plan's marks see the wave, `Params.returnShadowEnd`).
 * `npm run test:realtime-form-pairs`.
 */
import { registerArena } from './arenas';
import { nextCandidates, planChain, type ChainPlan, type StrikeOutcome } from './chain';
import { platesOf } from './elites';
import { BUILD_SOURCES, COUNTER_TALISMANS, FORMS, FROST_PASS, HAMMERS } from './buildIds';
import { defaultParams, type Params } from './params';
import { replay, Simulation, type Journal } from './simulation';
import type { Loadout } from './kit';
import type { Enemy, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
function lcg(seed: number): () => number { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

registerArena({ goal: 'kills', width: 20, height: 12, heroStart: { x: 4.5, y: 5 }, buttons: [], enemies: [], killGoal: 999, id: 'form-pairs', name: 'Поле пар', summary: 'Тест пар форм', obstacles: [], door: { x: 19.3, y: 6 } });

/** A form: a talisman of the kit or the hammer. */
interface Form { name: string; field: 'link' | 'path' | 'end'; talisman?: string; hammer?: string }
const FORMS_ALL: readonly Form[] = [
  { name: 'Развилка', field: 'link', talisman: FORMS.fork }, { name: 'Чужак', field: 'link', talisman: FORMS.alien },
  { name: 'Близнецы', field: 'link', talisman: FORMS.twins }, { name: 'Якорь', field: 'link', talisman: 'hero-anchor' },
  { name: 'Наледь', field: 'path', talisman: FROST_PASS }, { name: 'Огонь', field: 'path', hammer: HAMMERS.fire },
  { name: 'Разрез', field: 'path', hammer: HAMMERS.cut }, { name: 'Возврат', field: 'path', hammer: HAMMERS.return },
  { name: 'Печать', field: 'end', talisman: FORMS.seal }, { name: 'Прямая', field: 'end', talisman: FORMS.pierce },
  { name: 'Взрыв', field: 'end', hammer: HAMMERS.blast },
];
const PAIRS: [Form, Form][] = FORMS_ALL.flatMap((a, i) => FORMS_ALL.slice(i + 1).filter(b => b.field !== a.field && !(a.hammer && b.hammer)).map(b => [a, b] as [Form, Form]));

/** The fight of a pair: the sandbox's values with the newcomers off (the bot's bodies only); `moving` — the enemies walk. */
function params(moving: boolean): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false;
  p.loopEnabled = false; p.pierceEnabled = false;
  if (!moving) { p.enemySpeed = 0; p.speedSpread = 0; } else p.speedSpread = 0.2;
  return p;
}
const loadoutOf = (pair: readonly Form[]): Loadout => {
  const talismans = pair.flatMap(f => f.talisman ? [f.talisman] : []), hammer = pair.find(f => f.hammer)?.hammer;
  return { talismans, ...hammer ? { hammer } : {} } as Loadout;
};

/** What the plan promises: the links up to the stop, the pierce's bodies, the return run's hits. */
function promised(plan: ChainPlan): Map<number, StrikeOutcome> {
  const out = new Map<number, StrikeOutcome>();
  for (const l of plan.links) {
    if (l.link.kind !== 'enemy' || !l.outcome) continue;
    out.set(l.link.id, l.outcome);
    if (!l.outcome.killed && !l.outcome.plate) break;
  }
  for (const b of plan.pierce?.bodies ?? []) out.set(b.id, b.outcome);
  for (const h of plan.back?.hits ?? []) out.set(h.id, h.outcome);
  return out;
}
/** Sources of the plan's own strikes; any other source is a form's effect outside the plan. */
const PLANNED = new Set(['chain', 'pierce', 'hammer-return']);
interface PairTally { chains: number; compared: number; side: number; diverged: string[]; shadowed?: number; waves?: number; marks?: string[] }

/**
 * Besides the pair (task 29, the shadow of «Возврат»): more talismans of the kit, more params, and `shadowed` — sources of
 * effects the return run's plan sees (`endShadow`, «Ударная волна»): a body they hit stays compared when the plan's run strikes it.
 */
interface FightExtra { talismans?: string[]; params?: Partial<Params>; shadowed?: string[] }

/** One fight of a pair on seed `k`: 6 chains of the bot; the plan against the dash on each. */
function pairFight(pair: readonly Form[], k: number, moving: boolean, tally: PairTally, extra: FightExtra = {}): void {
  const kit = loadoutOf(pair), loadout = { ...kit, talismans: [...kit.talismans ?? [], ...extra.talismans ?? []] } as Loadout;
  const sim = new Simulation({ arena: 'form-pairs', params: Object.assign(params(moving), extra.params ?? {}), seed: seedOf(k), record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  const rnd = lcg(seedOf(k) ^ 0x5bd1e995);
  for (let i = 0; i < 18; i++) sim.command({ t: 'place', x: 5 + rnd() * 10, y: 1.5 + rnd() * 9, color: Math.floor(rnd() * 4), hp: Math.floor(rnd() * 3), kind: 'basic' });
  // A straight row from the hero and a body ahead of it (a pierce, a seal-able cluster nearby).
  const y = 4 + rnd() * 2;
  for (let i = 1; i <= 3; i++) sim.command({ t: 'place', x: 4.5 + 1.2 * i, y: y + (i - 2) * 0.05, color: 3, hp: 0, kind: 'basic' });
  sim.command({ t: 'place', x: 9.3, y, color: 1, hp: 1, kind: 'basic' });
  const checkpoints: string[] = [];
  const events: WorldEvent[] = [];
  const tick = (): void => { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; if (sim.world.tick % 300 === 0) checkpoints.push(sim.hash()); };
  const enemy = (id: number): Enemy | undefined => sim.world.enemies.find(e => e.id === id);
  for (let c = 0; c < 6 && sim.world.enemies.length; c++) {
    const w = sim.world, first = [...nextCandidates(w)].sort((a, b) => Math.hypot(a.x - w.hero.x, a.y - w.hero.y) - Math.hypot(b.x - w.hero.x, b.y - w.hero.y))[0];
    if (!first) { for (let t = 0; t < 30; t++) tick(); continue; }
    sim.command({ t: 'begin', x: first.x, y: first.y });
    for (let n = 1; n < 5; n++) {
      const pts = w.chain.flatMap(l => { const e = enemy(l.id); return e ? [e] : []; }), last = pts[pts.length - 1], prev = pts[pts.length - 2] ?? w.hero;
      const cands = [...nextCandidates(w)];
      if (!cands.length || !last) break;
      const dx = last.x - prev.x, dy = last.y - prev.y;
      const score = (e: Enemy): number => { const vx = e.x - last.x, vy = e.y - last.y; return (dx * vx + dy * vy) / ((Math.hypot(dx, dy) * Math.hypot(vx, vy)) || 1); };
      const next = cands.sort((a, b) => score(b) - score(a))[0];
      sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    }
    if (!w.chain.length) continue;
    const plan = planChain(w), want = promised(plan);
    const before = new Map(w.enemies.map(e => [e.id, { hp: e.hp, plates: platesOf(e) }]));
    events.length = 0;
    sim.command({ t: 'release' });
    for (let t = 0; t < 1200 && (sim.world.move || t === 0); t++) tick();
    for (let t = 0; t < 20; t++) tick();
    // A body a form's own effect hit (fire, cut, blast, seal, frost) is out of the comparison.
    const backHits = new Set((plan.back?.hits ?? []).map(h => h.id)), seen = new Set(extra.shadowed ?? []);
    const side = new Set(events.flatMap(e => (e.type === 'kill' || e.type === 'enemyHit') && 'source' in e && e.source && !PLANNED.has(e.source as string)
      && !(seen.has(e.source as string) && backHits.has((e as { enemyId: number }).enemyId)) ? [(e as { enemyId: number }).enemyId] : []));
    tally.shadowed = (tally.shadowed ?? 0) + events.filter(e => (e.type === 'kill' || e.type === 'enemyHit') && seen.has(e.source as string) && backHits.has(e.enemyId)).length;
    tally.waves = (tally.waves ?? 0) + events.filter(e => seen.size && e.type === 'wave').length;
    if (seen.size) {
      // The run struck the bodies the plan marked, in its order (a hit, or a plate taken).
      const struck = events.flatMap(e => ((e.type === 'enemyHit' || (e.type === 'elitePlates' && e.action === 'strip')) && e.source === BUILD_SOURCES.hammerReturn ? [e.enemyId] : []));
      const marked = (plan.back?.hits ?? []).map(h => h.id);
      if (struck.join() !== marked.join()) (tally.marks ??= []).push(`${pair.map(f => f.name).join(' + ')} k${k} chain ${c}${moving ? ' (moving)' : ''}: the run struck [${struck.join()}], the plan marked [${marked.join()}]`);
    }
    tally.chains++;
    const label = `${pair.map(f => f.name).join(' + ')} k${k} chain ${c}${moving ? ' (moving)' : ''}`;
    for (const [id, o] of want) {
      if (side.has(id)) { tally.side++; continue; }
      const e = enemy(id);
      const ok = o.killed ? !e : o.plate ? !!e && platesOf(e) === o.platesAfter : !!e && e.hp === o.hpAfter;
      tally.compared++;
      if (!ok) tally.diverged.push(`${label}: ${id} planned ${o.killed ? 'killed' : o.plate ? `plates ${o.platesAfter}` : `HP ${o.hpAfter}`}, got ${e ? `HP ${e.hp} plates ${platesOf(e)}` : 'dead'}`);
    }
    for (const [id, s] of before) {
      if (want.has(id) || side.has(id)) continue;
      const e = enemy(id);
      if (!e || e.hp !== s.hp || platesOf(e) !== s.plates) tally.diverged.push(`${label}: ${id} not in the plan, touched (HP ${s.hp} → ${e ? e.hp : 'dead'})`);
    }
  }
  const again: string[] = [];
  const copy = replay(JSON.parse(JSON.stringify(sim.exportJournal())) as Journal, step => { step.world.events.length = 0; if (step.world.tick % 300 === 0) again.push(step.hash()); });
  assert(copy.hash() === sim.hash() && again.join() === checkpoints.join(), `${pair.map(f => f.name).join(' + ')} k${k}: the replay gives another hash`);
}

const report: string[] = [];
check(`every pair of forms of different fields (${PAIRS.length} pairs, 2 seeds, still enemies): the plan of every chain is the dash; every fight replays to the same hash`, () => {
  let chains = 0, compared = 0, side = 0;
  const failures: string[] = [];
  for (const pair of PAIRS) {
    const tally: PairTally = { chains: 0, compared: 0, side: 0, diverged: [] };
    for (const k of [1, 2]) pairFight(pair, k, false, tally);
    chains += tally.chains; compared += tally.compared; side += tally.side;
    failures.push(...tally.diverged);
    if (tally.diverged.length) report.push(`${pair.map(f => f.name).join(' + ')}: ${tally.diverged.length} of ${tally.compared}`);
  }
  console.log(`   ${chains} chains, ${compared} promised outcomes compared, ${side} bodies hit by a form's own effect left out`);
  assert(!failures.length, `the plan differs from the dash:\n${failures.slice(0, 12).join('\n')}${failures.length > 12 ? `\n… ${failures.length} in all` : ''}`);
});

check('the same pairs with walking enemies: with `returnFixed` the plan is the dash; every fight replays', () => {
  let chains = 0, compared = 0;
  const failures: string[] = [];
  for (const pair of PAIRS) {
    const tally: PairTally = { chains: 0, compared: 0, side: 0, diverged: [] };
    pairFight(pair, 3, true, tally);
    chains += tally.chains; compared += tally.compared;
    failures.push(...tally.diverged);
  }
  console.log(`   ${chains} chains, ${compared} promised outcomes compared`);
  assert(!failures.length, `the plan differs from the dash:\n${failures.slice(0, 12).join('\n')}${failures.length > 12 ? `\n… ${failures.length} in all` : ''}`);
});

// Task 29, the shadow of «Возврат» (`returnShadowEnd`, closed 15.10.2026): «Возврат» with «Ударная волна» of the chain window
// (the pair a run will hold, task 30): the wave at the end of the dash kills and wounds before the run — the plan's run marks
// see it. Bodies the wave hits and the run strikes stay compared; the wave's own hits elsewhere are left out (not in the plan).
check('«Возврат» + «Ударная волна» (window — one chain, from 3 links), `returnFixed`: the run strikes the marked bodies with the planned outcomes after the wave, still and walking enemies (the release fixes the wave\'s bodies, `returnWaveFixed`)', () => {
  const back = FORMS_ALL.find(f => f.hammer === HAMMERS.return)!;
  const wave: FightExtra = { talismans: [COUNTER_TALISMANS.shockwave], params: { counterWindow: true, shockwaveLinks: 3 }, shadowed: [BUILD_SOURCES.wave] };
  const runs: { moving: boolean; fixed: boolean; ks: number[] }[] = [
    { moving: false, fixed: true, ks: [1, 2, 3, 4, 5, 6, 7, 8] }, { moving: true, fixed: true, ks: [1, 2, 3, 4, 5, 6, 7, 8] }, { moving: false, fixed: false, ks: [1, 2, 3, 4, 5, 6, 7, 8] },
  ];
  for (const r of runs) {
    const tally: PairTally = { chains: 0, compared: 0, side: 0, diverged: [] };
    for (const k of r.ks) pairFight([back], k, r.moving, tally, { ...wave, params: { ...wave.params, returnFixed: r.fixed } });
    const marks = tally.marks ?? [];
    console.log(`   ${r.moving ? 'walking' : 'still'}, returnFixed ${r.fixed}: ${tally.chains} chains, ${tally.waves} waves, ${tally.compared} promised outcomes compared, ${tally.shadowed} run hits on bodies the wave hit first; outcomes differ ${tally.diverged.length}, the run's bodies differ from the marks on ${marks.length} chains`);
    assert((tally.waves ?? 0) > 0 && tally.compared > 0, 'the wave went off');
    // The old path (no `returnFixed`, a run until task 30): the run reads the real path — counted, not asserted (its known
    // defect: bodies the overlap pushes apart during the dash; one lone surviving first link the old path still ran from).
    if (!r.fixed) continue;
    assert(!tally.diverged.length, `the plan differs from the dash:\n${tally.diverged.slice(0, 12).join('\n')}`);
    // `returnWaveFixed` (design 15.10.2026): the release fixes the wave's bodies too — one that walks out of the circle during
    // the dash is still struck, one that walks in is not; the marks hold while the enemies walk.
    assert(!marks.length, `the run struck other bodies than the marks:\n${marks.join('\n')}`);
  }
});

console.log(`realtime-form-pairs: ${checks} checks passed`);
