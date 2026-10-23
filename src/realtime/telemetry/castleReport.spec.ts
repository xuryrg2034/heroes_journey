/**
 * Task 55в «Замок» — the telemetry of the shoves and the report's sections «Замок» and «Босс» (the warlock's line): observe.ts `shove`,
 * report.ts `castleSection`, `warlockLines` (docs/realtime-telemetry.md, «Замок»). Node only: `npm run test:realtime-castle-report`.
 * Fights on the castle's arenas played by journal commands (a chain ending on a barrel), the summary read from the replay of the
 * journal (`analyzeJournal`, as the report does), then the report's numbers and lines over those fights.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { HALL_ARENA, WARLOCK_ARENA } from '../sim/arenasCastle';
import { planChain } from '../sim/chain';
import type { Command } from '../sim/commands';
import { BARREL } from '../sim/enemies/castle';
import { WARLOCK } from '../sim/enemies/warlock';
import type { Vec } from '../sim/geometry';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, SIM_DT } from '../sim/simulation';
import type { World } from '../sim/world';
import { analyzeJournal, bossEntries, castleSection, castleStats, summaryDiff, warlockLines, type FightEntry } from './report';
import { createFightObserver } from './observe';
import type { FightObserver } from './schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

/** Nobody comes, nobody walks, the hero is not hurt by a touch: the shove alone decides what dies. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.warlockCrowd = 0.01;
  return Object.assign(p, extra);
}
/** A fight watched live (the browser's summary), its journal kept (the replay's). */
class Fight {
  readonly sim: Simulation; readonly live: FightObserver;
  constructor(arena: string, k: number) { this.sim = new Simulation({ arena, params: quiet(), seed: seedOf(k), record: true }); this.live = createFightObserver(this.sim.world); }
  get world(): World { return this.sim.world; }
  cmd(c: Command): unknown { const r = this.sim.command(c); this.live.command(c, this.world); return r; }
  run(n: number, until: (w: World) => boolean = () => false): void {
    for (let i = 0; i < n && this.world.status === 'playing'; i++) { this.sim.tick(); this.live.tick(this.world); this.world.events.length = 0; if (until(this.world)) break; }
  }
  draw(points: readonly Vec[]): void { this.cmd({ t: 'begin', x: points[0].x, y: points[0].y }); for (const q of points.slice(1)) this.cmd({ t: 'drag', x: q.x, y: q.y, mode: 'full' }); }
  /** Releases the drawn chain and ticks until the dash and the shove are over. */
  pass(): void { assert(this.cmd({ t: 'release' }), 'the chain is released'); this.run(ticksOf(4), w => !w.move && !w.shoves); this.run(2); }
  /** The fight as the report holds it: the record (the browser's summary) and the replay's analysis. */
  entry(name: string, outcome = 'victory'): FightEntry {
    const journal = JSON.parse(JSON.stringify(this.sim.exportJournal()!)), analysis = analyzeJournal(journal), summary = this.live.summary();
    assert(analysis.hash === this.sim.hash(), `${name}: the replay reaches the hash`);
    assert(!summaryDiff(summary, analysis.summary).length, `${name}: the live summary is the replay's (${summaryDiff(summary, analysis.summary)})`);
    return { record: { kind: 'fight', run: 'R1', fight: name, nodeId: 'c:r5c0', arena: journal.arena, row: 1, level: 3, outcome, time: this.world.time, summary }, run: null, notes: [], journal, error: null, analysis, hashOk: true, summaryDiff: [] } as unknown as FightEntry;
  }
}

check('«Прихожая»: a chain onto the barrel before the hero — one shove, the bodies the plan crushes, its stop, the barrel broken, its length and second; a fight without a shove counts 0; the summary is the replay\'s (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const f = new Fight(HALL_ARENA.id, k), w = f.world;
    const barrel = w.enemies.find(e => e.kind === BARREL && Math.abs(e.x - 8) < 0.1 && Math.abs(e.y - 6.8) < 0.1)!;
    assert(barrel, 'the barrel before the hero');
    f.run(ticksOf(0.5));
    f.draw([barrel]);
    const plan = planChain(w).shove;
    assert(plan && plan.thing === barrel.id, `seed ${k}: the shove is planned`);
    f.pass();
    const sh = f.entry(`hall-${k}`).analysis!.summary.shove;
    assert(sh && sh.shoves === 1 && sh.crushed === plan.crushed.length && sh.cancels === 0 && sh.firstAt !== null && sh.firstAt >= 0.5 && sh.length > 0, `seed ${k}: ${JSON.stringify(sh)} (plan crushed ${plan.crushed.length})`);
    const stop = plan.stop === 'body' ? (w.enemies.find(e => e.id === plan.target)?.elite ? 'elite' : 'tough') : plan.stop;
    assert(JSON.stringify(sh.stops) === JSON.stringify({ [stop]: 1 }) && sh.barrels.start === 3 && sh.barrels.used === 1 && (sh.broken[plan.stop] ?? 0) === 1, `seed ${k}: the stop ${stop}, the barrel (${JSON.stringify(sh)})`);
    const idle = new Fight(HALL_ARENA.id, k);
    idle.run(ticksOf(2));
    const none = idle.entry(`idle-${k}`).analysis!.summary.shove;
    assert(none && none.shoves === 0 && none.firstAt === null && none.barrels.start === 3 && none.barrels.used === 0, `seed ${k}: no shove (${JSON.stringify(none)})`);
  }
});

check('the section «Замок»: by arena — fights, with a shove, shoves a fight, crushed a shove, barrels; an older record without the field counts in the fights only; «Прихожая» below one shove a fight — the alarm', () => {
  const shoved = new Fight(HALL_ARENA.id, 1), barrel = shoved.world.enemies.find(e => e.kind === BARREL && Math.abs(e.y - 6.8) < 0.1)!;
  shoved.run(ticksOf(0.5)); shoved.draw([barrel]); shoved.pass();
  const idle = new Fight(HALL_ARENA.id, 2);
  idle.run(ticksOf(1));
  const a = shoved.entry('hall-a'), b = idle.entry('hall-b', 'defeat');
  const old = { ...b, analysis: null, record: { ...b.record, fight: 'hall-old', summary: {} } } as FightEntry;
  const st = castleStats([a, b, old]).arenas[HALL_ARENA.id];
  const crushed = a.analysis!.summary.shove!.crushed;
  assert(st.fights === 3 && st.counted === 2 && st.withShove === 1 && st.shoves === 1 && st.crushed === crushed && st.barrels === 6 && st.barrelsUsed === 1 && st.deaths === 2, JSON.stringify(st));
  const text = castleSection([a, b, old]);
  assert(text.includes('| Прихожая (c-hall) | 3 | 2 | 1 (50%) | 0,5 |') && text.includes('Тревожно: в «Прихожей» 0,5 толчка на бой'), text);
  const calm = castleSection([a]);
  assert(!calm.includes('толчка на бой (меньше одного)') && calm.includes('| Прихожая (c-hall) | 1 | 1 | 1 (100%) | 1 |'), calm);
  assert(castleSection([]).includes('_боёв на аренах замка нет_'), 'no castle fight');
});

check('the warlock: a barrel shoved into his core along C1\'s row — `boss.warlock` one shove hit and one barrel, the shove\'s stop `core`; the line of «Босс» says so (2 seeds)', () => {
  for (const k of [1, 2]) {
    const f = new Fight(WARLOCK_ARENA.id, k), w = f.world, core = w.enemies.find(e => e.kind === WARLOCK)!;
    const barrel = w.enemies.find(e => e.kind === BARREL && Math.abs(e.x - 2.4) < 0.1 && Math.abs(e.y - 3.2) < 0.1)!;
    assert(core && barrel, 'the warlock at C1, the barrel B1 on his row');
    f.cmd({ t: 'teleport', x: 1, y: 4.6 });
    const link = f.cmd({ t: 'place', x: 0.9, y: 3.2, color: 0, hp: 0, kind: 'basic' }) as number;
    f.draw([w.enemies.find(e => e.id === link)!, barrel]);
    const plan = planChain(w).shove;
    assert(plan && plan.stop === 'core' && plan.target === core.id, `seed ${k}: the barrel goes into the core (${JSON.stringify(plan && { stop: plan.stop, target: plan.target })})`);
    f.pass();
    const e = f.entry(`warlock-${k}`, 'defeat'), s = e.analysis!.summary;
    assert(s.boss?.warlock && s.boss.warlock.hits.shove === 1 && s.boss.warlock.barrels === 1 && s.shove?.stops.core === 1 && s.shove.barrels.start === 4, `seed ${k}: ${JSON.stringify({ warlock: s.boss?.warlock, shove: s.shove })}`);
    const line = warlockLines(bossEntries([e])).join('\n');
    assert(line.includes('Колдун (задача 55): боёв 1, побед с первой попытки 0 (0%)') && line.includes('толчок 1') && line.includes('(толчком 100%)') && line.includes('бочек в ядро на бой 1'), line);
  }
  assert(!warlockLines([]).length, 'no warlock fight — no line');
});

console.log(`castle report: ${checks} checks passed`);
