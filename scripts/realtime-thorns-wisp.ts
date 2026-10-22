/**
 * Task 57б (design 22.10.2026, the pools' profile rule «а»): a targeted measure — «Колючие заросли» with the role «+светляки» against the
 * same fights without a role and as the run gave them; ash 2, a veteran's profile, `forestTricks`; the fights the pools give on that arena
 * (walked with fights counted as won until N are found), each played by the curve's bot (scripts/garrisonBot.ts, limit 240 s). Prints
 * deaths, the killing blow and the damage by source. A heuristic for the design, not a test: `npx tsx scripts/realtime-thorns-wisp.ts [N=300]`.
 */
import { defaultParams } from '../src/realtime/sim/params';
import { walkRun, seedOf } from '../src/realtime/run/metaWalk.testkit';
import { rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, type RtArenaOutcome, type RtRunState } from '../src/realtime/run/rtRun';
import { arenaKinds } from '../src/realtime/run/arenaKinds';
import { runRow } from '../src/realtime/run/arenaPools';
import { rtGarrisonNodeId } from '../src/realtime/run/garrison';
import { botFight } from './garrisonBot';
import type { World } from '../src/realtime/sim/world';
const N = Number(process.argv[2] ?? 300);
const ALL = ['bust', 'wolf', 'elite', 'brazier', 'cliff', 'boar', 'water', 'shield', 'buttons', 'archer', 'sapper', 'leader', 'lynx', 'affix', 'thorns', 'porcupine', 'shaman', 'horde', 'part', 'chest', 'slinger', 'hive', 'wisp', 'rootling', 'slime', 'firebrand'];
function madeUp(run: RtRunState): RtArenaOutcome | null {
  const p = run.pending; if (p?.kind !== 'battle') return null;
  const gone = rtArenaLoadout(run).withoutKinds ?? [], kinds = [...arenaKinds(p.arena, p.roster)].filter(kind => !gone.includes(kind));
  return { nodeId: p.nodeId, won: true, hp: run.maxHp, kills: 20, damage: 1, time: 60, kinds } as RtArenaOutcome;
}
const states: { run: RtRunState; row: number; roster?: string }[] = [];
for (let k = 1; states.length < N && k < 20000; k++) {
  const seen = new Set<string>();
  walkRun({ k, seed: seedOf(k), create: { gift: k % 2 ? 'full' : 'mini', ash: 2, forestTricks: true, schedule: ALL }, fight: madeUp, each: s => {
    const p = s.pending; if (p?.kind !== 'battle' || seen.has(p.nodeId) || rtGarrisonNodeId(p.nodeId) || p.arena !== 'thorns' || states.length >= N) return;
    seen.add(p.nodeId); states.push({ run: structuredClone(s), row: runRow(rtNode(s, p.nodeId)!.row), roster: p.roster });
  } });
}
const RUN = rtRunParams(defaultParams());
function play(run: RtRunState, roster: string | undefined) {
  const p = run.pending as Extract<RtRunState['pending'], { kind: 'battle' }>;
  const r = { ...run, pending: { ...p, ...roster !== undefined ? { roster } : {} } } as RtRunState;
  if (roster === undefined) delete (r.pending as { roster?: string }).roster;
  const damage: Record<string, number> = {};
  const played = botFight(r, { params: rtArenaParams(run, RUN), loadout: rtArenaLoadout(run), limit: 240, seen: (w: World) => { for (const ev of w.events) if (ev.type === 'hit') damage[ev.source] = (damage[ev.source] ?? 0) + ev.damage; } });
  const w = played.sim.world;
  return { won: w.status === 'victory', cause: w.status === 'victory' ? null : played.timeout ? 'timeout' : played.lastSource ?? '?', damage, time: w.time };
}
const sum = (rows: ReturnType<typeof play>[]) => {
  const deaths = rows.filter(r => !r.won), causes: Record<string, number> = {}, dmg: Record<string, number> = {};
  for (const r of deaths) causes[r.cause!] = (causes[r.cause!] ?? 0) + 1;
  for (const r of rows) for (const [s, n] of Object.entries(r.damage)) dmg[s] = (dmg[s] ?? 0) + n;
  return `${deaths.length}/${rows.length} (${(100 * deaths.length / rows.length).toFixed(1)} %), causes ${JSON.stringify(causes)}, damage ${JSON.stringify(dmg)}`;
};
const withWisp = states.map(s => play(s.run, '+wisp')), without = states.map(s => play(s.run, undefined)), asRun = states.map(s => play(s.run, s.roster));
const rows: Record<number, number> = {}; for (const s of states) rows[s.row] = (rows[s.row] ?? 0) + 1;
const ran: Record<string, number> = {}; for (const s of states) ran[s.roster ?? 'own'] = (ran[s.roster ?? 'own'] ?? 0) + 1;
console.log(`«Колючие заросли», ash 2, veteran profile, forestTricks, ${states.length} fights (rows ${JSON.stringify(rows)}; rosters the run gave ${JSON.stringify(ran)}), ${new Date().toISOString().slice(0, 10)}`);
console.log(`with +wisp:      ${sum(withWisp)}`);
console.log(`without a role:  ${sum(without)}`);
console.log(`as the run gave: ${sum(asRun)}`);
