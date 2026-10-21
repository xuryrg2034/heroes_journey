/**
 * Task 59б «Гарнизон, шаг 3» — the telemetry of the step 3's kinds (observe.ts `garrison.step3`, threats.ts `pot`, `warden-swing`;
 * docs/realtime-telemetry.md, «Гарнизон, шаг 3»). Node only: `npm run test:realtime-garrison-step3-telemetry`. Fights on the sandbox
 * probes (sim/arenasStep3.ts) by journal commands, the observer and the threat tracker watching; the live summary is the replay's.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { PITCH_TEST_ARENA, RECRUIT_TEST_ARENA, WARDEN_TEST_ARENA, WARDEN_TEST_COLUMNS } from '../sim/arenasStep3';
import { HAMMERS } from '../sim/buildIds';
import type { Command } from '../sim/commands';
import { RECRUIT } from '../sim/enemies/recruit';
import { WARDEN, wardenAngry } from '../sim/enemies/warden';
import type { Vec } from '../sim/geometry';
import type { Loadout } from '../sim/kit';
import { defaultParams, type Params } from '../sim/params';
import { pitchPools } from '../sim/pitch';
import { replay, Simulation, SIM_DT } from '../sim/simulation';
import type { Enemy, World } from '../sim/world';
import { createFightObserver } from './observe';
import { garrisonStats, type FightEntry } from './report';
import { checkRecord, emptyFightSummary, fightRecordId, RT_TELEMETRY_SCHEMA, step3SummaryOk, withSummaryDefaults, type FightObserver, type FightSummary, type GarrisonStep3Summary } from './schema';
import { ThreatTracker } from './threats';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.maxEnemies = 1;
  return Object.assign(p, extra);
}
/** A fight watched from its start: commands and ticks go through the observer and the tracker. */
class Watched {
  readonly sim: Simulation; readonly observer: FightObserver; readonly threats: ThreatTracker;
  constructor(arena: string, k: number, extra: Partial<Params> = {}, loadout?: Loadout) {
    this.sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
    this.observer = createFightObserver(this.sim.world); this.threats = new ThreatTracker(this.sim.world);
  }
  get world(): World { return this.sim.world; }
  cmd(c: Command): void { this.sim.command(c); this.observer.command(c, this.sim.world); }
  run(n: number, until: (w: World) => boolean = () => false): void {
    for (let i = 0; i < n && this.world.status === 'playing'; i++) { this.sim.tick(); this.observer.tick(this.world); this.threats.tick(this.world); this.world.events.length = 0; if (until(this.world)) break; }
  }
  place(at: Vec, hp: number, color = 0): number {
    const c: Command = { t: 'place', x: at.x, y: at.y, color, hp, kind: 'basic' }, id = this.sim.command(c) as number;
    this.observer.command(c, this.world);
    return id;
  }
  draw(points: readonly Vec[]): void { this.cmd({ t: 'begin', x: points[0].x, y: points[0].y }); for (const q of points.slice(1)) this.cmd({ t: 'drag', x: q.x, y: q.y, mode: 'full' }); }
  pass(): void { this.cmd({ t: 'release' }); this.run(ticksOf(3), w => !w.move); this.run(2); }
  step3() { return this.observer.summary().garrison.step3; }
  /** The same summary from a replay of the journal (the observer on every command and tick of it). */
  replayed() {
    let observer: FightObserver | null = null;
    replay(JSON.parse(JSON.stringify(this.sim.exportJournal()!)), r => { observer ??= createFightObserver(r.world); observer.tick(r.world); });
    return observer!.summary().garrison.step3;
  }
}

check('the pitcher: pots thrown, the hero hit, seconds in pitch, the path\'s ignition, the burning pitch\'s kill; threats `pot` — hit when he stands, dodged when he walks off (2 seeds)', () => {
  for (const k of [1, 2]) {
    const f = new Watched(PITCH_TEST_ARENA.id, k, {}, { talismans: [], hammer: HAMMERS.fire });
    f.run(ticksOf(4), w => !!w.pitch?.pools.length);
    f.run(ticksOf(1));
    const pool = pitchPools(f.world)[0];
    // The path's fire across the pool: the weak links stand round it (from the hero's spot by the pool).
    f.cmd({ t: 'teleport', x: pool.x - 2.4, y: pool.y });
    const links = [-1.2, 0, 1.2].map(dx => { const id = f.place({ x: pool.x + dx, y: pool.y }, 0); return f.world.enemies.find(e => e.id === id)!; });
    const victim = f.place({ x: pool.x, y: pool.y + 0.8 }, 1, 2);
    f.draw(links);
    f.pass();
    f.run(ticksOf(1.5));
    const s = f.step3()!;
    assert(s && s.pots >= 1 && s.potHits === 1 && s.pitchSeconds > 0.5 && s.ignites.path === 1 && s.ignites.burning === 0, `seed ${k}: ${JSON.stringify(s)}`);
    assert(!f.world.enemies.some(e => e.id === victim) && s.pitchKills === 1, `seed ${k}: the burning pitch killed (${s.pitchKills})`);
    assert(f.threats.tally().pot?.hit === 1, `seed ${k}: threat pot hit ${JSON.stringify(f.threats.tally().pot)}`);
    const off = new Watched(PITCH_TEST_ARENA.id, k);
    off.run(ticksOf(2), w => !!w.pots?.length);
    off.cmd({ t: 'walk', x: 1, y: 0 });
    off.run(ticksOf(3), w => !!w.pitch?.pools.length);
    assert(off.threats.tally().pot?.dodged === 1 && off.step3()?.potHits === 0, `seed ${k}: walked off — dodged ${JSON.stringify(off.threats.tally().pot)}`);
    assert(JSON.stringify(f.replayed()) === JSON.stringify(s), `seed ${k}: the replay's summary`);
  }
});

check('the recruits: the formation seen, refusals out of order — a press on #2, the pointer on #3 in a chain (twice: once per chain length), the formation by one pass, a bomb out of order put out (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const f = new Watched(RECRUIT_TEST_ARENA.id, k, { bombRange: 20 });
    f.run(1);
    const line = f.world.enemies.filter(e => e.kind === RECRUIT).sort((a, b) => a.vars.rn - b.vars.rn);
    f.cmd({ t: 'items', kind: 'bomb', count: 1 });
    f.cmd({ t: 'item', kind: 'bomb', x: line[3].x, y: line[3].y });
    f.run(1);
    f.cmd({ t: 'begin', x: line[1].x, y: line[1].y });
    f.cmd({ t: 'begin', x: line[0].x, y: line[0].y });
    f.cmd({ t: 'drag', x: line[2].x, y: line[2].y, mode: 'full' });
    f.cmd({ t: 'drag', x: line[2].x, y: line[2].y, mode: 'full' });
    f.draw(line);
    f.pass();
    const s = f.step3()!;
    assert(s && s.formations === 1 && s.orderRefusals === 2 && s.orderBlocks === 1 && s.drills === 1 && s.unlinks === 0, `seed ${k}: ${JSON.stringify(s)}`);
  }
});

check('the step-backs in a fight with recruits (design 21.10.2026): the pointer back on the link before the last, or a sweep ending over it, a recruit taken off — both counters +1 each time; the same step-back in a fight without recruits — no counter of step 3 (3 seeds)', () => {
  let swept = 0;
  for (const k of [1, 2, 3]) {
    const f = new Watched(RECRUIT_TEST_ARENA.id, k);
    f.run(1);
    const line = f.world.enemies.filter(e => e.kind === RECRUIT).sort((a, b) => a.vars.rn - b.vars.rn);
    f.draw(line.slice(0, 3));
    assert(f.world.chain.length === 3, `seed ${k}: 1 → 3 drawn`);
    f.cmd({ t: 'drag', x: line[1].x, y: line[1].y, mode: 'full' });
    assert((f.world.chain.length as number) === 2, `seed ${k}: stepped back to #2 (${f.world.chain.length})`);
    const all = f.observer.summary(), s = all.garrison.step3!;
    assert(all.chain.backsteps === 1 && s.backsteps === 1 && s.recruitBacksteps === 1, `seed ${k}: ${all.chain.backsteps} / ${JSON.stringify({ b: s.backsteps, r: s.recruitBacksteps })}`);
    // The sweep of the ui's finding: the chain again to #3, then one stroke from #3 that ends over #2 (the link before the last) — again
    // +1 each (#2 and #3 next to each other in the line: no other body under the stroke).
    if (Math.abs(line[1].x - line[2].x) < 1) {
      f.cmd({ t: 'drag', x: line[2].x, y: line[2].y, mode: 'full' });
      f.cmd({ t: 'sweep', fx: line[2].x, fy: line[2].y, x: line[1].x, y: line[1].y });
      const again = f.observer.summary().garrison.step3!;
      assert((f.world.chain.length as number) === 2 && again.backsteps === 2 && again.recruitBacksteps === 2, `seed ${k}: the sweep over #2 (${f.world.chain.length}, ${again.backsteps}, ${again.recruitBacksteps})`);
      swept++;
    }
    // A column of weak enemies of the wardens' probe, from its bottom (no recruit on that arena).
    const plain = new Watched(WARDEN_TEST_ARENA.id, k);
    const weak = plain.world.enemies.filter(e => e.kind === 'basic' && Math.abs(e.x - WARDEN_TEST_COLUMNS[1]) < 0.01).sort((a, b) => b.y - a.y).slice(0, 3);
    plain.draw(weak);
    const n = plain.world.chain.length;
    plain.cmd({ t: 'drag', x: weak[n - 2].x, y: weak[n - 2].y, mode: 'full' });
    const p = plain.observer.summary();
    assert(n >= 2 && p.chain.backsteps === 1 && (p.garrison.step3?.backsteps ?? 0) === 0 && (p.garrison.step3?.recruitBacksteps ?? 0) === 0, `seed ${k}: no step 3 counter without recruits (${n}, ${p.chain.backsteps}, ${JSON.stringify(p.garrison.step3)})`);
  }
  assert(swept >= 1, `seeds with the sweep: ${swept}`);
});

check('the wardens: the pair seen; a chain into one — an anger, the angry touch\'s HP, «Размах» a threat `warden-swing`; both by one pass — the pair cleared, no anger (2 seeds)', () => {
  for (const k of [1, 2]) {
    const f = new Watched(WARDEN_TEST_ARENA.id, k, { contactDamage: 1 });
    f.run(1);
    const [a, b] = f.world.enemies.filter(e => e.kind === WARDEN).sort((x, y) => x.id - y.id);
    const column = (w: World, color: number): Enemy[] => w.enemies.filter(e => e.kind === 'basic' && e.color === color && Math.abs(e.x - WARDEN_TEST_COLUMNS[color]) < 0.01).sort((x, y) => x.y - y.y);
    f.cmd({ t: 'teleport', x: 9.4, y: 6.2 });
    f.draw([column(f.world, a.color)[0], a]);
    f.pass();
    assert(wardenAngry(b), `seed ${k}: angry`);
    // The hero beside the angry one: its touch, then its «Размах» on him.
    f.cmd({ t: 'teleport', x: b.x, y: b.y + 0.7 });
    f.run(ticksOf(4));
    const s = f.step3()!, swing = f.threats.tally()['warden-swing'];
    assert(s && s.pairs === 1 && s.angers === 1 && s.pairsCleared === 0 && s.angerDamage > 0, `seed ${k}: ${JSON.stringify(s)}`);
    assert(swing && swing.warned >= 1 && swing.hit >= 1, `seed ${k}: the swing a threat ${JSON.stringify(swing)}`);
    const both = new Watched(WARDEN_TEST_ARENA.id, k, { colorShiftLinks: 6 });
    both.run(1);
    const [ba, bb] = both.world.enemies.filter(e => e.kind === WARDEN).sort((x, y) => x.id - y.id);
    both.draw([...column(both.world, ba.color).reverse(), ba, bb]);
    both.pass();
    const t = both.step3()!;
    assert(t && t.pairs === 1 && t.pairsCleared === 1 && t.angers === 0, `seed ${k}: both by one pass ${JSON.stringify(t)}`);
  }
});

/** «Привратники (проба)»: a chain into the warden A (the top of its colour's column, then A) — B is angry after the pass. */
function angerB(k: number, extra: Partial<Params> = {}): { f: Watched; b: Enemy } {
  const f = new Watched(WARDEN_TEST_ARENA.id, k, extra);
  f.run(1);
  const [a, b] = f.world.enemies.filter(e => e.kind === WARDEN).sort((x, y) => x.id - y.id);
  const top = f.world.enemies.filter(e => e.kind === 'basic' && e.color === a.color && Math.abs(e.x - WARDEN_TEST_COLUMNS[a.color]) < 0.01).sort((x, y) => x.y - y.y)[0];
  f.cmd({ t: 'teleport', x: 9.4, y: 6.2 });
  f.draw([top, a]);
  f.pass();
  assert(wardenAngry(b), `seed ${k}: B angry`);
  return { f, b };
}

check('the anger\'s ends (design 22.10.2026): killed in its anger, its clock over, the fight lost while it runs — one each; the three add up to `angers`; the record check takes it; the replay gives the same (2 seeds)', () => {
  for (const k of [1, 2]) {
    // Killed: a link of B's colour placed beside it, then B (HP 2: the second link kills it).
    const { f: killed, b } = angerB(k);
    const link = killed.place({ x: b.x, y: b.y + 1.1 }, 0, b.color);
    killed.cmd({ t: 'teleport', x: b.x, y: b.y + 2.4 });
    killed.draw([killed.world.enemies.find(e => e.id === link)!, b]);
    killed.pass();
    assert(!killed.world.enemies.includes(b), `seed ${k}: B fell`);
    // Calm: the hero away, the 8 s run out.
    const { f: calm, b: cb } = angerB(k);
    calm.cmd({ t: 'teleport', x: 2, y: 10.5 });
    calm.run(ticksOf(9));
    assert(!wardenAngry(cb) && calm.world.enemies.includes(cb), `seed ${k}: B calm again, alive`);
    // At the end: the hero of 2 HP beside the angry B — its touch 2 ends the fight in the anger.
    const { f: end, b: eb } = angerB(k, { heroHp: 2, contactDamage: 1 });
    end.cmd({ t: 'teleport', x: eb.x, y: eb.y + 0.6 });
    end.run(ticksOf(4));
    assert(end.world.status === 'defeat' && wardenAngry(eb), `seed ${k}: the fight lost in the anger (${end.world.status})`);
    for (const [name, f, want] of [['killed', killed, [1, 0, 0]], ['calm', calm, [0, 1, 0]], ['at the end', end, [0, 0, 1]]] as const) {
      const t = f.step3()!, got = [t.angerKilled, t.angerCalm, t.angerAtEnd];
      assert(t.angers === 1 && JSON.stringify(got) === JSON.stringify(want), `seed ${k} ${name}: ${JSON.stringify({ angers: t.angers, got })}`);
      assert(step3SummaryOk(t), `seed ${k} ${name}: the record check takes it`);
      assert(JSON.stringify(f.replayed()) === JSON.stringify(t), `seed ${k} ${name}: the replay's summary is the live one`);
    }
  }
});

check('an older record without the anger\'s ends reads as before (no field added), the report shows «—»; the record check refuses a part of them, a wrong sum, an unknown key', () => {
  const t: GarrisonStep3Summary = { ...emptyFightSummary().garrison.step3 ?? { pots: 0, potHits: 0, pitchSeconds: 0, ignites: { path: 0, burning: 0 }, pitchKills: 0, formations: 0, orderRefusals: 0, orderBlocks: 0, drills: 0, unlinks: 0, backsteps: 0, recruitBacksteps: 0, pairs: 1, pairsCleared: 0, angers: 1, angerDamage: 0 } };
  const old = emptyFightSummary();
  old.garrison.step3 = t;
  const read = withSummaryDefaults(JSON.parse(JSON.stringify(old)));
  assert(read.garrison.step3 && !('angerKilled' in read.garrison.step3) && step3SummaryOk(read.garrison.step3), 'the old block reads as it was');
  const entry = (summary: FightSummary): FightEntry => ({ record: { level: 2, nodeId: 'g:r1c0', arena: 'g-barbican', summary }, run: null, notes: [], journal: null, error: null } as unknown as FightEntry);
  assert(garrisonStats([], [entry(read)]).step3.angerEnds === null, 'the report: «—» for older records');
  const fresh = withSummaryDefaults(JSON.parse(JSON.stringify(old)));
  fresh.garrison.step3 = { ...t, angerKilled: 1, angerCalm: 0, angerAtEnd: 0 };
  assert(JSON.stringify(garrisonStats([], [entry(read), entry(fresh)]).step3.angerEnds) === JSON.stringify({ angers: 1, killed: 1, calm: 0, atEnd: 0 }), 'the report sums the records that have them');
  assert(!step3SummaryOk({ ...t, angerKilled: 1 }), 'a part of them — refused');
  assert(!step3SummaryOk({ ...t, angerKilled: 1, angerCalm: 1, angerAtEnd: 0 }), 'a wrong sum — refused');
  assert(!step3SummaryOk({ ...t, angerEnds: 1 }), 'an unknown key — refused');
  // The same through a fight record's check (the recorder's and the export's).
  const record = (summary: FightSummary): Record<string, unknown> => ({ schema: RT_TELEMETRY_SCHEMA, id: fightRecordId('s1', 'r1', 'f0'), kind: 'fight', session: 's1', run: 'r1', fight: 'f0', build: 'b', at: 't',
    params: { storage: 'x', hash: 'h' }, arena: 'g-barbican', seed: 1, ticks: 1, time: 1, hpIn: 1, hpOut: 1, endHash: 'e', summary, outcome: 'defeat', journal: { parts: 1, chars: 1, digest: 'd', encoding: 'e' } });
  assert(checkRecord(record(read)) === null && checkRecord(record(fresh)) === null, `a record old and new passes (${checkRecord(record(read))}, ${checkRecord(record(fresh))})`);
  const broken = withSummaryDefaults(JSON.parse(JSON.stringify(fresh)));
  broken.garrison.step3 = { ...t, angerKilled: 2, angerCalm: 0, angerAtEnd: 0 };
  assert(checkRecord(record(broken)) === 'fight step3', `a wrong sum in a record — 'fight step3' (${checkRecord(record(broken))})`);
});

console.log(`garrison step 3 telemetry: ${checks} checks passed`);
