/**
 * Task 24 «Урок перебора» (design 15.10.2026), the telemetry: prologue room 8 played by journal commands, its frames read by
 * `PrologueTally.frame` (one tick a frame here) — the show bust lands in the room's tally (`busts`: inside at «lit», the exit,
 * the damage), the record passes `checkRecord`, and the report's table «Урок перебора» counts it. A bust whose fuse still burns
 * when the room ends is kept without its blast.
 */
// Node 20 has no global navigator; the report imports view modules that load pixi.js (nodeNavigator.testkit.ts). First import.
import '../view/nodeNavigator.testkit';
import { prologueLoadout, prologueParams, prologueRoom } from '../run/prologue';
import { Simulation } from '../sim/simulation';
import { goblinOf } from '../sim/slot';
import type { World } from '../sim/world';
import { PrologueTally, type PrologueBody } from './prologue';
import { prologueBustStats } from './report';
import { RT_TELEMETRY_SCHEMA, checkRecord, type PrologueRecord } from './schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const GOBLIN = 8;

/** Room 8 with a tally reading every tick as a frame. */
function play(k: number) {
  const loadout = prologueLoadout(GOBLIN);
  const sim = new Simulation({ arena: prologueRoom(GOBLIN).id, params: prologueParams(GOBLIN), seed: seedOf(k), ...loadout ? { loadout } : {} });
  let body: PrologueBody | null = null;
  const tally = new PrologueTally('first', b => { body = b; }, () => '2026-10-15T00:00:00.000Z');
  tally.roomStart(GOBLIN, 1);
  const w = sim.world;
  const tick = (): void => { sim.tick(); tally.frame(GOBLIN, w, w.events); w.events.length = 0; };
  const until = (done: (x: World) => boolean, max = 60 * 20): void => { for (let i = 0; i < max && !done(w); i++) tick(); assert(done(w), 'reached'); };
  const walkTo = (x: number, y: number): void => {
    until(z => { const dx = x - z.hero.x, dy = y - z.hero.y, d = Math.hypot(dx, dy); if (d <= 0.05) return true; sim.command({ t: 'walk', x: dx / d, y: dy / d }); return false; });
    sim.command({ t: 'walk', x: 0, y: 0 });
  };
  /** The lever alone (from beside it) once it is ready; the dash to its end. */
  const pull = (): void => {
    const g = goblinOf(w)!;
    until(z => !goblinOf(z)!.spin && z.time + 1e-9 >= goblinOf(z)!.ready && !z.move);
    walkTo(g.x - 1.2, g.y);
    assert(sim.command({ t: 'begin', x: g.x, y: g.y }) === true, 'the press on the lever');
    sim.command({ t: 'release' });
    until(z => !z.move);
  };
  return { sim, w, tally, tick, until, walkTo, pull, body: (): PrologueBody => body! };
}

check('the show bust in the room\'s tally: walked off during the reels — out of the circle at «lit», 0 damage; stood until «lit», then walked — inside, out inside the fuse 1.2 s, 0 damage; stood — inside, no exit, −4; the record passes `checkRecord` (seeds 1–3)', () => {
  for (let k = 1; k <= 3; k++) for (const plan of ['leave', 'late', 'stand'] as const) {
    const p = play(k), label = `seed ${k} ${plan}`;
    p.pull();
    p.pull();
    const g = p.w.slot?.goblin;
    assert(g?.pulls === 2 && g.spin, `${label}: the second pull spins`);
    const off = (): void => p.walkTo(Math.min(p.w.arena.width - 1, g.x + 4.6), g.y);
    if (plan === 'leave') off();
    if (plan === 'late') { p.until(z => z.blasts.some(b => !!b.bust), 60 * 3); off(); }
    p.until(z => z.blasts.length === 0 && !goblinOf(z), 60 * 6);
    p.tally.roomEnd(GOBLIN, 'win', p.w.time, p.w.time);
    const room = p.body().rooms.find(r => r.room === GOBLIN)!, busts = room.busts ?? [];
    assert(busts.length === 1, `${label}: one bust (${JSON.stringify(busts)})`);
    const [b] = busts;
    if (plan === 'leave') assert(!b.inside && b.outAfter === null && b.damage === 0, `${label}: out at «lit», unhurt (${JSON.stringify(b)})`);
    else if (plan === 'late') assert(b.inside && b.outAfter !== null && b.outAfter > 0.9 && b.outAfter < 1.2 && b.damage === 0, `${label}: out in the fuse, unhurt (${JSON.stringify(b)})`);
    else assert(b.inside && b.damage === 4 && b.outAfter === null, `${label}: −4, no exit (${JSON.stringify(b)})`);
    const record: PrologueRecord = { schema: RT_TELEMETRY_SCHEMA, id: 's1/P1/prologue', kind: 'prologue', build: 'test', params: { storage: 'x', hash: 'y' }, session: 's1', run: 'P1', at: '2026-10-15T00:00:00.000Z', ...p.body() } as PrologueRecord;
    assert(checkRecord(record) === null, `${label}: the record passes (${checkRecord(record)})`);
    const broken = JSON.parse(JSON.stringify(record)) as PrologueRecord;
    (broken.rooms.find(r => r.room === GOBLIN)!.busts![0] as unknown as Record<string, unknown>).inside = 'yes';
    assert(checkRecord(broken) === 'prologue room busts', 'a broken bust is refused');
  }
});

check('a room that ends in the fuse keeps the bust without its blast (damage null); the report\'s table counts by origin — records without busts give none', () => {
  const p = play(4);
  p.pull();
  p.pull();
  p.until(z => z.blasts.some(b => !!b.bust), 60 * 4);
  p.tally.roomEnd(GOBLIN, 'skip', p.w.time, p.w.time);
  const busts = p.body().rooms.find(r => r.room === GOBLIN)!.busts!;
  assert(busts.length === 1 && busts[0].damage === null && busts[0].outAfter === null, `the open bust kept (${JSON.stringify(busts)})`);
  const head = { schema: RT_TELEMETRY_SCHEMA, kind: 'prologue' as const, build: 'test', params: { storage: 'x', hash: 'y' }, session: 's', at: '2026-10-15T00:00:00.000Z', from: 'first' as const, outcome: 'done' as const, skipRoom: null, roomCount: 10 };
  const room = (busts: PrologueRecord['rooms'][number]['busts']) => ({ room: GOBLIN, attempts: 1, deaths: 0, restores: 0, gameSeconds: 9, realSeconds: 9, hands: 0, arrows: 0, outcome: 'win' as const, ...busts ? { busts } : {} });
  const records = [
    { ...head, id: 'A', run: 'A', rooms: [room([{ inside: true, outAfter: 0.5, damage: 0 }])] },
    { ...head, id: 'B', run: 'B', rooms: [room([{ inside: true, outAfter: null, damage: 4 }, { inside: true, outAfter: 0.9, damage: 0 }])] },
    { ...head, id: 'C', run: 'C', rooms: [room(undefined)] },
  ] as PrologueRecord[];
  const [s] = prologueBustStats(records);
  assert(s && s.from === 'first' && s.busts === 3 && s.insideAtLit === 3 && s.left === 2 && s.outMedian === 0.7 && s.hurt === 1 && s.outside === 0 && s.unfinished === 0, `stats ${JSON.stringify(s)}`);
  assert(prologueBustStats([records[2]]).length === 0, 'no busts — no row');
});

console.log(`prologue bust: ${checks} checks passed`);
