/**
 * Task 57а «Лес: стрелки» — the run's flag `forestShooters` (run/rtRun.ts; docs/design-notes/task-57-forest-enemies.md, 10.1). Node only:
 * `npm run test:realtime-forest-shooters-run`.
 *
 * Walks whole runs by the run's own commands (metaWalk.testkit.ts) and checks what a fight of the run plays:
 * - a run without the flag (the default while `RT_FOREST_SHOOTERS_ON` is off, and an old save): its fights play the values of before —
 *   no shooters' timer, no snuffing;
 * - a run with the flag: its forest fights play the timer 2.5 s and the snuffing (`RT_FOREST_SHOOTERS_PARAMS`), its garrison fights do
 *   not; the flag alone changes no arena, roster, stream or step of the walk (the arcs and pools of the new kinds are level design);
 * - the save keeps the flag; a broken value is no run.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { defaultParams } from '../sim/params';
import { rtGarrisonNodeId } from './garrison';
import { seedOf, walkRun } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtArenaParams, rtNode, rtRunParams, RT_FOREST_SHOOTERS_ON, RT_FOREST_SHOOTERS_PARAMS, serializeRtRun, type RtRunState } from './rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const RUN = rtRunParams(defaultParams());
interface Fight { arena: string; roster?: string; seed: number; garrison: boolean; volleyGap: number; snuffShots: boolean }
/** Every fight a walk opens: its arena, roster, seed and the values it plays. */
function fights(k: number, create: Parameters<typeof createRtRun>[1]): { list: Fight[]; streams: string[] } {
  const list: Fight[] = [], streams: string[] = [];
  walkRun({
    k, create, each: (run: RtRunState) => {
      streams.push(JSON.stringify(run.streams));
      const p = run.pending;
      if (p?.kind !== 'battle' || list.some(f => f.seed === p.seed && f.arena === p.arena)) return;
      const params = rtArenaParams(run, RUN), node = rtNode(run, p.nodeId);
      list.push({ arena: p.arena, ...p.roster !== undefined ? { roster: p.roster } : {}, seed: p.seed, garrison: !!node && !!rtGarrisonNodeId(node.id), volleyGap: params.volleyGap, snuffShots: params.snuffShots });
    },
  });
  return { list, streams };
}

check('the flag is off by default (no arena of the new shooters in the run yet): a new run has no `forestShooters`, its fights play no timer and no snuffing', () => {
  assert(!RT_FOREST_SHOOTERS_ON, 'RT_FOREST_SHOOTERS_ON is off');
  for (const k of [1, 2, 3]) {
    const run = createRtRun(seedOf(k));
    assert(run.forestShooters === undefined && !serializeRtRun(run).includes('forestShooters'), `seed ${k}: no flag in the save`);
    const { list } = fights(k, { garrison: true });
    assert(list.length > 5 && list.every(f => f.volleyGap === 0 && !f.snuffShots), `seed ${k}: ${list.length} fights with the values of before`);
  }
});

check('a run with the flag: its forest fights play the timer 2.5 and the snuffing, its garrison fights do not; the arenas, rosters, seeds and streams are those of the run without it (10 seeds, forest and garrison)', () => {
  let forest = 0, garrison = 0;
  for (let k = 1; k <= 10; k++) {
    const create = { garrison: k % 2 === 0, gift: k % 2 ? 'full' as const : 'mini' as const };
    const on = fights(k, { ...create, forestShooters: true }), off = fights(k, create);
    const key = (f: Fight): string => `${f.arena}|${f.roster ?? ''}|${f.seed}`;
    assert(on.list.map(key).join() === off.list.map(key).join(), `seed ${k}: the same fights`);
    assert(on.streams.join() === off.streams.join(), `seed ${k}: the same streams at every step`);
    for (const f of on.list) {
      if (f.garrison) { garrison++; assert(f.volleyGap === 0 && !f.snuffShots, `seed ${k}: a garrison fight keeps its values (${f.arena})`); }
      else { forest++; assert(f.volleyGap === RT_FOREST_SHOOTERS_PARAMS.volleyGap && f.snuffShots, `seed ${k}: a forest fight plays the shooters' rules (${f.arena})`); }
    }
  }
  console.log(`   forest fights ${forest}, garrison fights ${garrison}`);
  assert(forest > 50 && garrison > 10, 'both kinds of fights were walked');
});

check('the save keeps the flag; a save without it loads as a run without it; a broken value is no run', () => {
  const run = createRtRun(seedOf(4), { forestShooters: true });
  const text = serializeRtRun(run), back = parseRtRun(text);
  assert(back?.forestShooters === true && serializeRtRun(back) === text, 'the flag survives the save');
  const without = createRtRun(seedOf(4), { forestShooters: false });
  assert(parseRtRun(serializeRtRun(without))?.forestShooters === undefined, 'without the flag');
  for (const bad of [false, 1, 'yes', null]) {
    const raw = JSON.parse(text) as Record<string, unknown>;
    raw.forestShooters = bad;
    assert(parseRtRun(JSON.stringify(raw)) === null, `forestShooters ${JSON.stringify(bad)} is no run`);
  }
});

console.log(`forest shooters run: ${checks} checks passed`);
