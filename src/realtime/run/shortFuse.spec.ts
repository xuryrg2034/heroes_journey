/**
 * Task 19 «Короткий запал» (user decision 14.10.2026 after playtest v44; docs/design-notes/tasks-19-20.md): a run battle plays
 * the goblin's bust fuse 0.6 s (`RT_RUN_BUST_FUSE`, the run's flag `shortFuse`, `rtArenaParams`). Playtest v44: three busts,
 * each time the hero stood in the circle when the idol lit and walked out in 0.25–0.68 s of the 1.2 s fuse — 0 damage.
 *
 * Acceptance by real journal commands (the hero's walking input `walk`, the chain onto the lever):
 * (a) the hero walks off right after the risky pull — the blast finds him outside: 0 damage, with either fuse;
 * (b) the hero stands at the idol until it lights, then walks off — 0.6 s: the blast catches him (−4); 1.2 s: he is out
 *     (0 — the problem the playtest showed).
 * And: a new run carries the flag; a save without it keeps 1.2 s; the prologue and the sandbox keep 1.2 s; a journal keeps the
 * fuse it was recorded with (the same hash on replay).
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import '../view/nodeNavigator.testkit';
import { registerArena } from '../sim/arenas';
import { objectRefusal } from '../sim/chain';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, SIM_DT, replay, type Journal } from '../sim/simulation';
import { goblinOf, leverOf } from '../sim/slot';
import type { WorldEvent } from '../sim/world';
import { prologueParams } from './prologue';
import { createRtRun, parseRtRun, rtArenaParams, rtArenaRules, rtPageParams, rtRunParams, serializeRtRun, RT_RUN_BUST_FUSE, RT_RUN_FORCED } from './rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const tick = (seconds: number): number => Math.round(seconds / SIM_DT);

// A wide open field: the hero walks 5+ away from the idol in any direction.
registerArena({
  id: 'fuse-field', name: 'Поле запала', summary: 'Тест короткого запала', goal: 'kills', width: 60, height: 40,
  heroStart: { x: 30, y: 20 }, obstacles: [], buttons: [], door: { x: 59.3, y: 20 }, enemies: [], killGoal: 999,
});

/** The run's own numbers on a quiet field: no newcomers, no reaper, nobody walks or touches, no hit-stop. */
function quiet(): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 0; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  return rtRunParams(p);
}
/** A run battle's params: with the run's flag (`short`) or as a save before task 19. */
const battleParams = (short: boolean): Params => rtArenaParams(short ? { shortFuse: true } : {}, quiet());

type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const slotOf = (events: readonly WorldEvent[], action: Ev<'slot'>['action']): Ev<'slot'>[] =>
  events.filter((e): e is Ev<'slot'> => e.type === 'slot' && e.action === action);
function ticks(sim: Simulation, n: number, out: WorldEvent[]): void {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
}

type Plan = 'leave' | 'stand';
interface Bust { damage: number; lit: Ev<'slot'>; blast: Ev<'slot'>; litTime: number; blastTime: number; sim: Simulation }

/**
 * A run battle (the kit's goblin, the goals at once — it comes 3 s later): bare pulls of the lever (a chain of just the lever,
 * the dash) until one busts; then the plan by the walking input — `leave`: walk off from the idol at once; `stand`: no input
 * until the idol lights, then walk off. Null — no bust in this seed's pulls.
 */
function bust(k: number, short: boolean, plan: Plan): Bust | null {
  const sim = new Simulation({ arena: 'fuse-field', params: battleParams(short), seed: seedOf(k), record: true, loadout: { slot: true } });
  const w = sim.world, events: WorldEvent[] = [];
  sim.command({ t: 'goals' });
  ticks(sim, tick(3.2), events);
  assert(goblinOf(w), `seed ${k}: the run goblin stands`);
  for (let pull = 0; pull < 6; pull++) {
    for (let i = 0; i < tick(20) && leverOf(w) && objectRefusal(w, leverOf(w)!) === 'lever'; i++) ticks(sim, 1, events);
    const L = leverOf(w);
    if (!L) return null;
    // Stand 1.2 on the field side of the lever, start a chain on it, release: the dash pulls it.
    const dx = w.arena.width / 2 - L.x, dy = w.arena.height / 2 - L.y, d = Math.hypot(dx, dy) || 1;
    sim.command({ t: 'teleport', x: L.x + dx / d * 1.2, y: L.y + dy / d * 1.2 });
    assert(sim.command({ t: 'begin', x: L.x, y: L.y }) === true, 'a chain of just the lever');
    sim.command({ t: 'release' });
    const from = events.length;
    for (let i = 0; i < tick(5) && !slotOf(events.slice(from), 'pull').length; i++) ticks(sim, 1, events);
    const pulled = slotOf(events.slice(from), 'pull')[0];
    assert(pulled, `seed ${k}: the dash pulled`);
    if (!pulled.bust) { ticks(sim, tick(1.2) + 2, events); continue; }
    // The bust: the idol lights when the reels stop. The hero walks off from it (`leave` at once, `stand` after the light).
    const g = goblinOf(w)!, idol = { x: g.x, y: g.y };
    for (let i = 0; i < tick(1) && w.move; i++) ticks(sim, 1, events);
    // Off towards the field's centre (the dash ends at the lever, on the idol: «away from the idol» has no direction there).
    const away = (): void => {
      const ax = w.arena.width / 2 - idol.x, ay = w.arena.height / 2 - idol.y, a = Math.hypot(ax, ay) || 1;
      sim.command({ t: 'walk', x: ax / a, y: ay / a });
    };
    if (plan === 'leave') away();
    let litTime = -1, blastTime = -1;
    for (let i = 0; i < tick(4) && blastTime < 0 && w.status === 'playing'; i++) {
      const at = events.length;
      ticks(sim, 1, events);
      const now = events.slice(at);
      if (litTime < 0 && slotOf(now, 'lit').length) { litTime = w.time; if (plan === 'stand') away(); }
      if (slotOf(now, 'blast').length) blastTime = w.time;
    }
    const lit = slotOf(events, 'lit')[0], blast = slotOf(events, 'blast')[0];
    assert(lit && blast, `seed ${k}: the idol lit and blew up`);
    sim.command({ t: 'walk', x: 0, y: 0 });
    const damage = events.filter((e): e is Ev<'hit'> => e.type === 'hit' && e.source === 'slot-bust').reduce((s, e) => s + e.damage, 0);
    return { damage, lit, blast, litTime, blastTime, sim };
  }
  return null;
}
/** Seeds whose run goblin busts within its pulls (searched in order). */
function bustingSeeds(count: number): number[] {
  const out: number[] = [];
  for (let k = 1; out.length < count && k < 200; k++) if (bust(k, true, 'leave')) out.push(k);
  assert(out.length === count, `busting seeds: ${out.length}`);
  return out;
}
function replays(sim: Simulation): boolean {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  return replay(journal).hash() === sim.hash();
}

const SEEDS = bustingSeeds(5);

check('the run\'s numbers: a run battle with the flag plays the fuse 0.6 s; the run base, the prologue and the sandbox keep 1.2 s', () => {
  assert(RT_RUN_BUST_FUSE === 0.6 && RT_RUN_FORCED.slotBustFuse === 1.2, 'the constants');
  assert(battleParams(true).slotBustFuse === 0.6 && battleParams(false).slotBustFuse === 1.2, 'the battle params by the flag');
  assert(battleParams(true).slotBustRadius === 3.5 && battleParams(true).slotBustDamage === 4 && battleParams(true).slotBustEnemyDamage === 3, 'the radius and the damage unchanged');
  for (let n = 1; n <= 10; n++) assert(prologueParams(n).slotBustFuse === 1.2, `prologue room ${n}`);
  assert(rtPageParams(false, defaultParams).slotBustFuse === 1.2, 'the run page base');
  assert(rtPageParams(true, defaultParams).slotBustFuse === 1.2 && defaultParams().slotBustFuse === 1.2, 'the sandbox');
});

check('a new run carries `shortFuse`; its rules give the battle 0.6 s; a save without the flag loads and keeps 1.2 s; a bad flag is refused', () => {
  const run = createRtRun(seedOf(3));
  assert(run.shortFuse === true, 'a new run has the flag');
  assert(rtArenaParams(run, quiet()).slotBustFuse === 0.6 && rtArenaRules(run).shortFuse === true, 'its battle: 0.6 s');
  const loaded = parseRtRun(serializeRtRun(run));
  assert(loaded?.shortFuse === true && serializeRtRun(loaded) === serializeRtRun(run), 'it saves and loads');
  const old = JSON.parse(serializeRtRun(run)) as Record<string, unknown>;
  delete old.shortFuse;
  const before = parseRtRun(JSON.stringify(old));
  assert(before && before.shortFuse === undefined && JSON.stringify(before) === JSON.stringify(old), 'a save before it loads as it was');
  assert(rtArenaParams(before, quiet()).slotBustFuse === 1.2 && rtArenaRules(before).shortFuse === undefined, 'its battle: 1.2 s');
  assert(parseRtRun(JSON.stringify({ ...old, shortFuse: false })) === null, 'shortFuse: false is refused');
  const off = createRtRun(seedOf(3), { shortFuse: false });
  assert(off.shortFuse === undefined && rtArenaParams(off, quiet()).slotBustFuse === 1.2, 'the option off: no flag');
});

check('(a) the hero walks off right after the risky pull: the blast finds him outside — 0 damage, with 0.6 s and with 1.2 s', () => {
  for (const k of SEEDS) for (const short of [true, false]) {
    const b = bust(k, short, 'leave')!;
    const fuse = short ? 0.6 : 1.2;
    assert(b.lit.fuse === fuse && Math.abs(b.blastTime - b.litTime - fuse) <= 2 * SIM_DT, `seed ${k}: the fuse ${b.lit.fuse}, blast ${(b.blastTime - b.litTime).toFixed(3)} s after the light`);
    assert(b.damage === 0 && b.blast.inside === false, `seed ${k} fuse ${fuse}: damage ${b.damage}, inside ${b.blast.inside}`);
    assert(replays(b.sim), `seed ${k}: the journal replays`);
  }
});

check('(b) the hero stands at the idol until it lights, then walks off: 0.6 s — the blast catches him (−4); 1.2 s — he is out (0, the playtest v44 problem)', () => {
  for (const k of SEEDS) {
    const short = bust(k, true, 'stand')!;
    assert(short.lit.fuse === 0.6 && short.damage === 4 && short.blast.inside === true && short.blast.hurt === true, `seed ${k} 0.6 s: damage ${short.damage}, inside ${short.blast.inside}`);
    const long = bust(k, false, 'stand')!;
    assert(long.lit.fuse === 1.2 && long.damage === 0 && long.blast.inside === false, `seed ${k} 1.2 s: damage ${long.damage}, inside ${long.blast.inside}`);
    assert(replays(short.sim) && replays(long.sim), `seed ${k}: the journals replay`);
  }
});

check('a journal keeps the fuse it was recorded with: a 1.2 s fight replays to the same hash and the same blast', () => {
  const b = bust(SEEDS[0], false, 'stand')!;
  const journal = JSON.parse(JSON.stringify(b.sim.exportJournal()!)) as Journal;
  assert(journal.params.slotBustFuse === 1.2, 'the journal carries 1.2 s');
  const again = replay(journal);
  assert(again.hash() === b.sim.hash() && again.world.hero.hp === b.sim.world.hero.hp, 'the same world');
});

console.log(`short fuse: ${checks} checks passed (seeds ${SEEDS.join(', ')})`);
