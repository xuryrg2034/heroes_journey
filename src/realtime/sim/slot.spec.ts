/**
 * Casino stage 1: «Однорукий гоблин» (slot.ts, slotPlan.ts; docs/realtime-casino.md; design: docs/realtime-casino-research.md,
 * 8.3 and 8.5). Node only: `npm run test:realtime-slot`.
 *
 * Every check plays journalled commands (`goals`, `slot`, `place`, `teleport`, `begin` / `drag`, `release`, `jump`, `param` …)
 * and looks at what the player meets:
 * - appearance (a run battle): one roll per battle about 35 % of seeds, not before 3 s after the goals; a free spot 3–7 from
 *   the hero that he sees; the spot varies by seed; no roll without the run's leave (the sandbox) or with the toggle off;
 * - the lever ends a chain of any colour, nothing after it; a pull with 0 links; not a target during its marker, its 8 s
 *   cooldown and after the 3rd pull; greed: +1 skull a pull (the odds of the next bare pull grow);
 * - the odds line of the plan is the pull's odds; every 2 enemy links the dash really struck take a skull off (a plated elite
 *   counts — it was struck; a link killed before the dash reached it does not);
 * - the outcomes over many seeds of the first bare pull: ☠☠☠ ≈ 3.7 %, two ☠ ≈ 22.2 % (statistical, with a tolerance);
 * - the effect comes when the 3rd reel stops (1.2 s after the pull); leaving by the door during the spin cancels it;
 * - the rain hits enemies (the player's kills, source `slot`) and the hero; the jackpot rain never the hero; the volley hits
 *   the hero only; a jump and the invulnerability spare him; one plate per wave off an armoured elite; a sapper killed by an
 *   arrow blows up as the player's; ❤ never above the maximum HP;
 * - every fight replays to its hash (and the hashes every 300 ticks); a journal without the key plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { objectRefusal, planChain, type StrikeOutcome } from './chain';
import { lineOfSight } from './geometry';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { defaultParams, heroRadius, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { goblinOf, leverOf, pullOdds, skullOdds, type Goblin, type SlotOutcome } from './slot';
import { slotOddsText, slotPlanOdds } from './slotPlan';
import type { Enemy, World, WorldEvent } from './world';
import { createRtRun, rtArenaLoadout, rtMapNodes, rtRunParams, RT_SLOT_ROW, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';
import { createFightObserver } from '../telemetry/observe';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
const tick = (seconds: number): number => Math.round(seconds / SIM_DT);

registerArena({
  id: 'slot-field', name: 'Поле гоблина', summary: 'Тест однорукого гоблина', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 10, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
// Walls and trees around the hero: the idol must stand where he sees it.
registerArena({
  id: 'slot-walls', name: 'Поле со стенами', summary: 'Тест однорукого гоблина', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 10, y: 6 }, buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
  obstacles: [
    { shape: 'rect', kind: 'wall', x: 12, y: 1.5, w: 0.6, h: 9 },
    { shape: 'rect', kind: 'wall', x: 4, y: 3.5, w: 4.5, h: 0.6 },
    { shape: 'circle', kind: 'tree', x: 8, y: 8.5, r: 0.8 },
    { shape: 'circle', kind: 'tree', x: 6.5, y: 6.5, r: 0.7 },
  ],
});

/** A quiet fight: no newcomers, no reaper, nobody walks or touches, no hit-stop, no survivor knockback; the slot on. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 0; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.slot = true;
  return Object.assign(p, extra);
}
function field(params: Params = quiet(), k = 1, arena = 'slot-field', loadout?: Loadout, hero?: { hp: number; maxHp: number }): Simulation {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {}, ...hero ? { hero } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp = 0, extra: { elite?: boolean; kind?: string; color?: number } = {}): Enemy => {
  const id = sim.command({ t: 'place', x, y, color: extra.color ?? 0, hp, kind: extra.kind ?? 'basic', ...extra.elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Ticks until the hero stands again (the dash over), collecting the events. */
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0) && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const slotEvents = (events: readonly WorldEvent[], action: Ev<'slot'>['action']): Ev<'slot'>[] => of(events, 'slot').filter(e => e.action === action);
/** Replays the journal through JSON: the same hash at the end and at every 300th tick. */
function replays(sim: Simulation, checkpoints?: Map<number, string>): boolean {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  let ok = true;
  const again = replay(journal, s => { const want = checkpoints?.get(s.world.tick); if (want !== undefined && want !== s.hash()) ok = false; });
  return ok && again.hash() === sim.hash();
}

/** The sandbox goblin by the panel command; then its marker runs out. */
function summon(sim: Simulation): Goblin {
  assert(sim.command({ t: 'slot' }) === true, 'the command puts a goblin');
  const g = goblinOf(sim.world);
  assert(g, 'a goblin stands');
  return g;
}
const lever = (sim: Simulation) => leverOf(sim.world)!;
/** Waits until the lever is a target (its marker or cooldown over). */
function waitReady(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < tick(20) && objectRefusal(sim.world, lever(sim)) === 'lever'; i++) ticks(sim, 1, out);
  return out;
}
/** A unit direction from the lever towards the arena centre (room for a row of links). */
function inward(w: World, at: { x: number; y: number }): { x: number; y: number } {
  const dx = w.arena.width / 2 - at.x, dy = w.arena.height / 2 - at.y, d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}
/** A bare pull: the hero next to the lever, a chain of just the lever, the dash. Returns the pull event and all events. */
function bareTo(sim: Simulation): { pull: Ev<'slot'>; events: WorldEvent[] } {
  const L = lever(sim), dir = inward(sim.world, L);
  sim.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
  assert(sim.command({ t: 'begin', x: L.x, y: L.y }) === true, 'a chain of just the lever starts');
  assert(sim.world.chain.length === 1 && sim.world.chain[0].kind === 'object', 'the chain is the lever');
  sim.command({ t: 'release' });
  const events = settle(sim);
  const pull = slotEvents(events, 'pull')[0];
  assert(pull, 'the dash pulled the lever');
  return { pull, events };
}
/** `n` weak enemies of colour 0 in a row from the hero to the lever (spacing 1.2 < R), the hero put at the row's start. */
function rowTo(sim: Simulation, n: number, extra: (i: number) => { elite?: boolean; kind?: string; hp?: number; color?: number } = () => ({})): Enemy[] {
  const L = lever(sim), dir = inward(sim.world, L), step = 1.2;
  const start = { x: L.x + dir.x * step * (n + 1), y: L.y + dir.y * step * (n + 1) };
  sim.command({ t: 'teleport', x: start.x, y: start.y });
  const out: Enemy[] = [];
  for (let i = 1; i <= n; i++) { const o = extra(i); out.push(place(sim, start.x - dir.x * step * i, start.y - dir.y * step * i, o.hp ?? 0, o)); }
  return out;
}
function draw(sim: Simulation, points: readonly { x: number; y: number }[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** A sandbox fight whose first bare pull gives `want` (seeds searched in order). */
function findPull(want: SlotOutcome | ((o: SlotOutcome) => boolean), params: Params, from = 1, tries = 600): { sim: Simulation; k: number; pull: Ev<'slot'> } {
  const ok = typeof want === 'function' ? want : (o: SlotOutcome) => o === want;
  for (let k = from; k < from + tries; k++) {
    const sim = field(params, k);
    summon(sim); waitReady(sim);
    const { pull } = bareTo(sim);
    if (ok(pull.outcome!)) return { sim, k, pull };
  }
  throw new Error(`no seed gave ${String(want)}`);
}

// ---------------------------------------------------------------------------------------------------------------------

check('off by default: the toggle is off, a run turns it on; a journal without the key plays the same world', () => {
  const p = defaultParams();
  assert(p.slot === false && p.slotChance === 0.35, 'the defaults');
  assert(rtRunParams(defaultParams()).slot === true, 'the run turns it on');
  const without = (state: unknown): string => { const s = { ...(state as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };
  for (let k = 1; k <= 3; k++) {
    // A run-like loadout that would allow the goblin, the goals done: with the toggle off nothing rolls.
    const off = quiet({ slot: false }), old = quiet() as Partial<Params>;
    delete old.slot;
    const a = field(off, k, 'slot-field', { slot: true }), b = field(old as Params, k, 'slot-field', { slot: true });
    for (const sim of [a, b]) { sim.command({ t: 'goals' }); ticks(sim, tick(12)); assert(sim.command({ t: 'slot' }) === false, 'the command does nothing with the toggle off'); }
    assert(a.world.slot === undefined && b.world.slot === undefined && !a.world.objects.some(o => o.kind === 'lever'), 'no goblin, no slot state');
    assert(without(worldState(a.world)) === without(worldState(b.world)), `seed ${k}: the same world without the key`);
    assert(!a.world.rng.states().some(([name]) => name.startsWith('slot:')), 'no slot stream drawn');
    const journal = a.exportJournal()!;
    delete (journal.params as Partial<Params>).slot;
    assert(without(worldState(replay(journal).world)) === without(worldState(a.world)), 'the journal without the key replays the same world');
  }
});

check('appearance in a run battle: ≈ 35 % of seeds, not before 3 s after the goals, 3–7 from the hero and seen by him, varies by seed', () => {
  let rolled = 0, came = 0;
  const spots = new Set<string>();
  for (let k = 1; k <= 300; k++) {
    const arena = k % 2 ? 'slot-field' : 'slot-walls';
    const sim = field(quiet(), k, arena, { slot: true }), w = sim.world;
    sim.command({ t: 'teleport', x: 10, y: 6 });
    ticks(sim, 30);
    sim.command({ t: 'goals' });
    const goals = w.greedStart!;
    const events: WorldEvent[] = [];
    for (let i = 0; i < tick(6) && !w.slot; i++) {
      ticks(sim, 1, events);
      if (w.time + 1e-9 < goals + 3) assert(!w.slot, `seed ${k}: nothing before 3 s after the goals (${w.time - goals})`);
    }
    assert(w.slot, `seed ${k}: the battle rolled`);
    assert(w.time - goals >= 3 - 1e-6 && w.time - goals < 3 + 2 * SIM_DT, `seed ${k}: rolled ${w.time - goals} s after the goals`);
    rolled++;
    const g = goblinOf(w);
    if (!g) { assert(!w.objects.some(o => o.kind === 'lever'), 'no lever without a goblin'); continue; }
    came++;
    const d = Math.hypot(g.x - w.hero.x, g.y - w.hero.y);
    assert(d >= 3 - 1e-6 && d <= 7 + 1e-6, `seed ${k}: ${d.toFixed(2)} from the hero`);
    assert(lineOfSight(w.hero, g, w.arena, -w.params.sightSlack), `seed ${k}: the hero sees it`);
    assert(slotEvents(events, 'appear').length === 1, 'one appear event');
    // Its marker: 2 s the lever is not a target.
    assert(objectRefusal(w, lever(sim)) === 'lever', 'dark during the marker');
    ticks(sim, tick(2) + 1);
    assert(objectRefusal(w, lever(sim)) !== 'lever', `seed ${k}: a target after the marker (${objectRefusal(w, lever(sim))})`);
    spots.add(`${g.x.toFixed(2)},${g.y.toFixed(2)}`);
    // Once a battle: no second roll.
    ticks(sim, tick(10));
    assert(w.objects.filter(o => o.kind === 'lever').length === 1, 'one goblin a battle');
    if (k <= 6) assert(replays(sim), `seed ${k}: replay`);
  }
  const share = came / rolled;
  assert(share > 0.27 && share < 0.43, `the share of battles with a goblin: ${share.toFixed(3)} (35 %)`);
  assert(spots.size >= came * 0.95, `spots vary by seed: ${spots.size} of ${came}`);
  // No run leave (the sandbox): no roll after the goals.
  const sandbox = field(quiet(), 7);
  sandbox.command({ t: 'goals' });
  ticks(sandbox, tick(10));
  assert(sandbox.world.slot === undefined, 'the sandbox rolls nothing');
  console.log(`   goblin in ${came} of ${rolled} battles`);
});

check('the run gives the leave from row 3, not to the Jailer and not to a boss', () => {
  let rows = 0, jailer = 0, boss = 0, early = 0;
  for (let k = 1; k <= 4; k++) {
    const base = createRtRun(seedOf(500 + k));
    for (const node of rtMapNodes(base)) {
      const battle = node.type === 'boss' ? 'final' : node.type === 'hard' ? 'hard' : node.type === 'event' ? 'event' : 'battle';
      if (!['battle', 'hard', 'checkpoint', 'breakthrough', 'boss', 'event'].includes(node.type)) continue;
      const run: RtRunState = { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena: 'slot-field', seed: seedOf(k), battle } };
      const leave = !!rtArenaLoadout(run).slot, row = runRow(node.row);
      if (node.type === 'checkpoint') { assert(!leave, 'not the Jailer'); jailer++; }
      else if (node.type === 'boss') { assert(!leave, 'not a boss'); boss++; }
      else if (row < RT_SLOT_ROW) { assert(!leave, `not row ${row}`); early++; }
      else { assert(leave, `${node.type} row ${row}: may get the goblin`); rows++; }
    }
  }
  assert(rows > 0 && jailer > 0 && boss > 0 && early > 0, `checked: ${rows} battles, Jailer ${jailer}, boss ${boss}, rows 1–2 ${early}`);
});

check('the lever ends a chain of any colour; a 0-link pull; dark during the cooldown and after the 3rd pull; greed +1 skull a pull', () => {
  const sim = field(quiet(), 3), w = sim.world;
  const g = summon(sim);
  // A chain of colour 2 ending on the lever: nothing may follow it.
  const [a] = rowTo(sim, 1, () => ({ color: 2 }));
  waitReady(sim);
  const after = place(sim, lever(sim).x + 0.9, lever(sim).y, 0, { color: 2 });
  draw(sim, [a, lever(sim), after]);
  assert(w.chain.length === 2 && w.chain[1].kind === 'object', `the chain ends on the lever: ${JSON.stringify(w.chain)}`);
  assert(planChain(w).endsOnObject, 'the plan says the chain is over');
  sim.command({ t: 'cancel' });
  sim.command({ t: 'clear', keepMarked: false });
  const odds: number[] = [];
  for (let n = 1; n <= 3; n++) {
    waitReady(sim);
    const { pull, events } = bareTo(sim);
    assert(pull.links === 0 && pull.removed === 0 && pull.pull === n, `pull ${n}: 0 links, no skull off (${JSON.stringify(pull)})`);
    odds.push(pull.rain!);
    assert(of(events, 'chainEnd').length === 1 && w.lastChain?.kills === 0, 'the dash ended on the lever');
    assert(near(w.hero.x, g.x) && near(w.hero.y, g.y), 'the hero stands on the lever');
    assert(g.skulls.reduce((s, x) => s + x, 0) === 6 + n, `greed: ${g.skulls}`);
    // Dark now: the cooldown (and for good after the 3rd).
    assert(objectRefusal(w, lever(sim)) === 'lever', `pull ${n}: dark after the pull`);
    ticks(sim, tick(7.8));
    assert(objectRefusal(w, lever(sim)) === 'lever', `pull ${n}: still dark at 7.8 s`);
    ticks(sim, tick(0.4));
    if (n < 3) assert(objectRefusal(w, lever(sim)) !== 'lever', `pull ${n}: a target again after 8 s`);
    else assert(objectRefusal(w, lever(sim)) === 'lever', 'dark for good after the 3rd pull');
  }
  assert(near(odds[0], 1 / 27) && odds[1] > odds[0] && odds[2] > odds[1], `the bare odds grow: ${odds}`);
  assert(near(odds[1], skullOdds([3, 2, 2]).rain) && near(odds[2], skullOdds([3, 3, 2]).rain), 'greed puts the skulls on reels 1, 2, 3 in turn');
  // A chain cannot even start on the dark lever.
  sim.command({ t: 'teleport', x: g.x + 1, y: g.y });
  assert(sim.command({ t: 'begin', x: g.x, y: g.y }) === false, 'no chain on the dark lever');
  assert(replays(sim), 'replay');
});

check('the odds line of the plan is the pull\'s odds; every 2 struck enemy links take a skull off (a plated elite counts)', () => {
  for (const [n, k, elite] of [[0, 11, false], [1, 12, false], [2, 13, false], [5, 14, false], [6, 15, false], [7, 16, true], [9, 17, false]] as const) {
    const sim = field(quiet({ eliteArmor: true }), k), w = sim.world;
    summon(sim);
    const row = rowTo(sim, n, i => (elite && i === 3 ? { elite: true } : {}));
    waitReady(sim);
    const line: string[] = [];
    if (n) {
      sim.command({ t: 'begin', x: row[0].x, y: row[0].y });
      for (let i = 1; i <= n; i++) {
        // While the chain can take the lever (only from the last link), the line shows the odds with the links so far.
        const odds = slotPlanOdds(w);
        if (i === n) assert(odds && !odds.onLever && odds.links === n, `n ${n}: the line before the lever (${JSON.stringify(odds)})`);
        if (odds) line.push(slotOddsText(odds));
        if (i < n) sim.command({ t: 'drag', x: row[i].x, y: row[i].y, mode: 'full' });
      }
      sim.command({ t: 'drag', x: lever(sim).x, y: lever(sim).y, mode: 'full' });
    } else {
      sim.command({ t: 'teleport', x: lever(sim).x + 1, y: lever(sim).y });
      sim.command({ t: 'begin', x: lever(sim).x, y: lever(sim).y });
    }
    const planned = slotPlanOdds(w);
    assert(planned && planned.onLever && planned.links === n, `n ${n}: the line on the lever (${JSON.stringify(planned)})`);
    if (elite) assert(planChain(w).links.some(l => (l.outcome as StrikeOutcome | null)?.plate), 'the elite is a plate hit in the plan');
    sim.command({ t: 'release' });
    const events = settle(sim);
    const pull = slotEvents(events, 'pull')[0];
    assert(pull, `n ${n}: pulled`);
    assert(pull.links === n && pull.removed === Math.min(6, Math.floor(n / 2)), `n ${n}: ${pull.links} links, ${pull.removed} skulls off`);
    assert(pull.rain === planned.rain && pull.volley === planned.volley, `n ${n}: the line ${slotOddsText(planned)} = the pull ${slotOddsText({ rain: pull.rain!, volley: pull.volley! })}`);
    if (n === 6) assert(near(pull.rain!, 1 / 125) && near(pull.volley!, 12 / 125), `6 links: 0,8 % and 9,6 % (${slotOddsText(planned)})`);
    if (n === 0) assert(slotOddsText(planned) === 'дождь 3,7 % · залп 22,2 %', `the line text: ${slotOddsText(planned)}`);
    assert(replays(sim), `n ${n}: replay`);
  }
});

check('a link killed before the dash reached it is not struck: the pull counts the struck links, not the plan\'s', () => {
  // A sapper first: the chain kills it, its blast (0,8 s later) kills the last enemy link near it before the hero comes back.
  let seen = 0;
  for (const k of [21, 22, 23]) {
    const sim = field(quiet(), k), w = sim.world;
    const g = summon(sim);
    waitReady(sim);
    // A U-shaped row from the lever inwards: out along a side row (the sapper first), back along the lever's row; the lever
    // after the last link. The sapper's blast reaches the last link (1,3 away) 0,8 s after its death, before the hero is back.
    const L = lever(sim), u = inward(w, L), side = (L.y < w.arena.height / 2 ? 1 : -1) * (u.x >= 0 ? 1 : -1);
    const v = { x: -u.y * side, y: u.x * side };
    const at = (i: number, off: number) => ({ x: L.x + u.x * 1.2 * i + v.x * off, y: L.y + u.y * 1.2 * i + v.y * off });
    const pts = [...[1, 2, 3, 4, 5].map(i => at(i, 1.3)), ...[5, 4, 3, 2, 1].map(i => at(i, 0))];
    sim.command({ t: 'teleport', x: at(0, 1.3).x, y: at(0, 1.3).y });
    const links = pts.map((q, i) => place(sim, q.x, q.y, 0, i === 0 ? { kind: 'sapper' } : {}));
    draw(sim, [...links, L]);
    const planned = slotPlanOdds(w)!;
    assert(planned.links === links.length, `the plan strikes ${planned.links}`);
    sim.command({ t: 'release' });
    const events = settle(sim);
    const pull = slotEvents(events, 'pull')[0], hits = of(events, 'chainHit').length;
    const fallen = of(events, 'kill').filter(e => e.source === 'blast' && links.some(l => l.id === e.enemyId)).length;
    assert(pull && pull.links === hits, `the pull counts the struck links: ${pull?.links} = ${hits}`);
    assert(hits + fallen === links.length, `struck ${hits} + fallen ${fallen} = ${links.length}`);
    const want = pullOdds({ ...w, slot: { goblin: { ...g, skulls: [2, 2, 2] } } } as World, hits);
    assert(near(pull.rain!, want.rain), 'the odds of the struck count');
    if (fallen) seen++;
    assert(replays(sim), 'replay');
  }
  assert(seen > 0, 'a link died before the dash reached it');
});

check('outcomes of the first bare pull over many seeds: ☠☠☠ ≈ 3,7 %, two ☠ ≈ 22,2 %; every kind of outcome comes', () => {
  const tally: Record<string, number> = {};
  const N = 1500;
  for (let k = 1; k <= N; k++) {
    const sim = field(quiet(), 2000 + k);
    summon(sim); waitReady(sim);
    const { pull } = bareTo(sim);
    tally[pull.outcome!] = (tally[pull.outcome!] ?? 0) + 1;
  }
  const rain = (tally.rain ?? 0) / N, volley = (tally.volley ?? 0) / N;
  assert(Math.abs(rain - 1 / 27) < 0.016, `☠☠☠ ${(rain * 100).toFixed(1)} % (3,7 %)`);
  assert(Math.abs(volley - 2 / 9) < 0.033, `two ☠ ${(volley * 100).toFixed(1)} % (22,2 %)`);
  for (const kind of ['none', 'heart', 'bolt', 'gem', 'pot']) assert((tally[kind] ?? 0) > 0, `${kind} comes`);
  const triples = ['heart3', 'bolt3', 'gem3', 'jackpot'].reduce((s, x) => s + (tally[x] ?? 0), 0);
  assert(triples > 0, 'a triple comes');
  console.log(`   ${JSON.stringify(tally)}`);
});

check('the effect comes when the 3rd reel stops (1,2 s after the pull); leaving by the door during the spin cancels it', () => {
  const p = quiet({ slotSkulls: 0 });
  const found = findPull(o => o === 'heart3' || o === 'heart', p, 40);
  const { sim, k } = found, w = sim.world;
  // The same fight again: the hero hurt first, so the heart shows.
  for (const leave of [false, true]) {
    // The hero enters hurt (a run's HP), so the heart shows.
    const s = field(p, k, 'slot-field', undefined, { hp: 10, maxHp: 40 }), ws = s.world;
    summon(s); waitReady(s);
    const L = lever(s), dir = inward(ws, L);
    s.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
    s.command({ t: 'begin', x: L.x, y: L.y });
    s.command({ t: 'release' });
    const events = settle(s), pull = slotEvents(events, 'pull')[0];
    assert(pull.outcome === found.pull.outcome, 'the same outcome on the same seed');
    const pulledAt = ws.tick;
    if (leave) {
      s.command({ t: 'goals' });
      const door = ws.objects.find(o => o.kind === 'door')!;
      s.command({ t: 'teleport', x: door.x, y: door.y });
    }
    const after = ticks(s, tick(2));
    const effect = slotEvents(after, 'effect');
    if (leave) {
      assert(ws.status === 'victory' && !effect.length && ws.hero.hp === 10, `the door during the spin: no effect (${ws.status}, hp ${ws.hero.hp})`);
    } else {
      assert(effect.length === 1 && effect[0].outcome === pull.outcome, 'one effect');
      const at = pulledAt + tick(1.2);
      assert(ws.hero.hp === 10 + (pull.outcome === 'heart3' ? 3 : 1), `the heart: hp ${ws.hero.hp}`);
      // Find the effect tick by replaying the fight tick by tick.
      let effectTick = -1;
      replay(s.exportJournal()!, r => { if (effectTick < 0 && slotEvents(r.world.events, 'effect').length) effectTick = r.world.tick; r.world.events.length = 0; });
      assert(Math.abs(effectTick - at) <= 1, `the effect at the 3rd reel: tick ${effectTick}, the pull ${pulledAt} + 72`);
    }
    assert(replays(s), 'replay');
  }
  assert(w.slot, 'found');
});

check('❤ never above the maximum HP; ⚡ fills the energy; ◆ and 🍲 fall on free spots near the hero', () => {
  const p = quiet({ slotSkulls: 0 });
  const kinds = new Set<string>();
  for (let k = 60; k < 600 && kinds.size < 6; k++) {
    const sim = field(p, k, 'slot-field', undefined, { hp: 39, maxHp: 40 }), w = sim.world;
    summon(sim); waitReady(sim);
    sim.command({ t: 'energy', value: 2 });
    const objects = w.objects.length;
    const { pull } = bareTo(sim);
    const o = pull.outcome!;
    ticks(sim, tick(1.4));
    if (o === 'heart3' || o === 'heart') { assert(w.hero.hp === w.hero.maxHp, `❤ capped: ${w.hero.hp}/${w.hero.maxHp}`); kinds.add(o); }
    if (o === 'bolt3') { assert(w.energy === 7, `⚡⚡⚡ full: ${w.energy}`); kinds.add(o); }
    if (o === 'bolt') { assert(near(w.energy, 3), `⚡ +1: ${w.energy}`); kinds.add(o); }
    if (o === 'gem3' || o === 'gem' || o === 'pot') {
      const added = w.objects.slice(objects);
      const want = o === 'gem3' ? 3 : 1;
      assert(added.length === want && added.every(x => x.kind === (o === 'pot' ? 'loot' : 'crystal')), `${o}: ${added.map(x => x.kind)}`);
      for (const x of added) { const d = Math.hypot(x.x - w.hero.x, x.y - w.hero.y); assert(d >= 0.85 && d <= 2.3, `${o} near the hero: ${d}`); }
      kinds.add(o);
    }
    if (k < 70) assert(replays(sim), 'replay');
  }
  assert(kinds.size >= 5, `kinds seen: ${[...kinds]}`);
});

/** A field of weak enemies on every other cell (rain targets), the hero in the middle. */
function crowd(sim: Simulation, extra: (x: number, y: number) => { kind?: string; elite?: boolean } | null = () => ({})): Enemy[] {
  const out: Enemy[] = [];
  for (let x = 1.5; x < 19; x += 2) for (let y = 1.5; y < 11; y += 2) {
    if (Math.hypot(x - sim.world.hero.x, y - sim.world.hero.y) < 1.6) continue;
    const o = extra(x, y);
    if (o) out.push(place(sim, x, y, 0, o));
  }
  return out;
}
/** Plays out a pull's effect (the spin, every wave, every arrow), collecting the events. */
const playOut = (sim: Simulation): WorldEvent[] => ticks(sim, tick(5));

check('the rain hits enemies (the player\'s kills, source `slot`) and the hero; the jackpot rain never the hero', () => {
  let heroHits = 0, jackpotCovered = 0;
  for (const want of ['rain', 'jackpot'] as const) {
    const p = want === 'rain' ? quiet({ slotSkulls: 6 }) : quiet({ slotSkulls: 0 });
    let from = 100;
    for (let round = 0; round < 4; round++) {
      const found = findPull(want, p, from, 2000);
      from = found.k + 1;
      const s = field(p, found.k), w = s.world;
      summon(s); waitReady(s);
      const L = lever(s), dir = inward(w, L);
      s.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
      s.command({ t: 'begin', x: L.x, y: L.y });
      s.command({ t: 'release' });
      const events = settle(s);
      assert(slotEvents(events, 'pull')[0].outcome === want, 'the same outcome');
      // The hero stands where the dash ended; the crowd around him.
      const enemies = crowd(s);
      const before = w.stats.kills;
      events.push(...playOut(s));
      const waves = slotEvents(events, 'wave'), lands = slotEvents(events, 'land');
      assert(waves.length === 3, `${want}: 3 waves (${waves.length})`);
      for (const wave of waves) {
        const n = lands.filter(l => l.firing === wave.firing).length;
        assert(n >= 10 && n <= 12, `${want}: 10–12 marks a wave (${n})`);
      }
      const kills = of(events, 'kill').filter(e => e.source === 'slot');
      assert(kills.length > 0 && kills.every(e => e.credited), `${want}: arrows killed enemies, the player's (${kills.length})`);
      assert(w.stats.kills - before === kills.length, `kills counted: ${w.stats.kills - before}`);
      // Every enemy inside a fallen circle died (weak enemies), nobody outside.
      for (const e of enemies) {
        const covered = lands.some(l => Math.hypot(l.x - e.x, l.y - e.y) <= l.r! + 0.32 + 1e-9);
        assert(covered === !w.enemies.includes(e), `${want}: enemy ${e.id} covered ${covered}, alive ${w.enemies.includes(e)}`);
      }
      const hits = of(events, 'hit').filter(h => h.source.startsWith('slot'));
      const coveredHero = lands.some(l => Math.hypot(l.x - w.hero.x, l.y - w.hero.y) <= l.r! + heroRadius(w.params));
      if (want === 'rain') { heroHits += hits.length; assert(hits.every(h => h.source === 'slot-rain'), 'the rain\'s source'); if (coveredHero) assert(hits.length >= 1, 'a covered hero is hit'); }
      else { assert(!hits.length, 'the jackpot never hits the hero'); if (coveredHero) jackpotCovered++; }
      assert(replays(s), `${want}: replay`);
    }
  }
  assert(heroHits > 0, 'the rain hit the hero');
  assert(jackpotCovered > 0, 'an arrow of the jackpot fell on the hero and spared him');
});

check('the volley: marks within 2,5 of the hero, the hero only; a jump and the invulnerability spare him', () => {
  const p = quiet({ slotSkulls: 6 });
  let hit = 0, spared = 0, from = 300;
  for (let round = 0; round < 6 && (!hit || !spared); round++) {
    const found = findPull('volley', p, from, 2000);
    from = found.k + 1;
    for (const dodge of [false, true]) {
      const s = field(p, found.k), w = s.world;
      summon(s); waitReady(s);
      const L = lever(s), dir = inward(w, L);
      s.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
      s.command({ t: 'begin', x: L.x, y: L.y });
      s.command({ t: 'release' });
      const events = settle(s);
      const neighbours = [place(s, w.hero.x + 0.8, w.hero.y), place(s, w.hero.x - 0.8, w.hero.y + 0.5)];
      events.push(...ticks(s, tick(1.2) + 2));
      const marks = w.slot?.marks ?? [];
      assert(marks.length === 5 && marks.every(m => m.kind === 'volley' && Math.hypot(m.x - w.hero.x, m.y - w.hero.y) <= 2.5 + 1e-6), `5 marks within 2,5: ${marks.length}`);
      const covered = marks.some(m => Math.hypot(m.x - w.hero.x, m.y - w.hero.y) <= m.r + heroRadius(w.params));
      if (dodge) {
        // A jump a moment before the arrows fall: in flight he is spared.
        s.command({ t: 'energy', value: 7 });
        ticks(s, Math.max(0, Math.round(Math.min(...marks.map(m => m.left)) / SIM_DT) - 4), events);
        assert(s.command({ t: 'jump', x: w.hero.x + 0.3, y: w.hero.y }) === true, 'the jump starts');
      }
      events.push(...playOut(s));
      const hits = of(events, 'hit').filter(h => h.source.startsWith('slot'));
      assert(hits.every(h => h.source === 'slot-volley'), 'the volley\'s source');
      assert(hits.length <= 1, `one hit at most (the invulnerability): ${hits.length}`);
      assert(neighbours.every(e => w.enemies.includes(e)), 'the volley never hits enemies');
      if (!covered) continue;
      if (dodge) { assert(!hits.length, 'the jump spared him'); spared++; }
      else { assert(hits.length === 1 && hits[0].damage === 1, 'a covered hero takes 1'); hit++; }
      assert(replays(s), 'replay');
    }
  }
  assert(hit > 0 && spared > 0, `checked: hit ${hit}, spared ${spared}`);
});

check('arrows: one plate per wave off an armoured elite; a sapper killed by an arrow blows up as the player\'s', () => {
  const p = quiet({ slotSkulls: 6, eliteArmor: true, elitePlates: 6 });
  let multi = 0, sappers = 0, from = 700;
  for (let round = 0; round < 6 && (!multi || !sappers); round++) {
    const found = findPull('rain', p, from, 3000);
    from = found.k + 1;
    const s = field(p, found.k), w = s.world;
    summon(s); waitReady(s);
    const L = lever(s), dir = inward(w, L);
    s.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
    s.command({ t: 'begin', x: L.x, y: L.y });
    s.command({ t: 'release' });
    const events = settle(s);
    let i = 0;
    const placed = crowd(s, () => (i++ % 2 ? { elite: true } : { kind: 'sapper' }));
    events.push(...playOut(s));
    const lands = slotEvents(events, 'land');
    for (const e of placed.filter(x => x.elite)) {
      const strips = of(events, 'elitePlates').filter(x => x.enemyId === e.id && x.action === 'strip');
      const byWave = new Map<number, number>();
      for (const l of lands) if (Math.hypot(l.x - e.x, l.y - e.y) <= l.r! + 0.32) byWave.set(l.firing!, (byWave.get(l.firing!) ?? 0) + 1);
      assert(strips.length === byWave.size && strips.every(x => x.removed === 1 && x.source === 'slot'), `elite ${e.id}: ${strips.length} strips for ${byWave.size} waves over it`);
      if ([...byWave.values()].some(n => n > 1)) multi++;
    }
    for (const e of placed.filter(x => x.kind === 'sapper')) {
      const kill = of(events, 'kill').find(x => x.enemyId === e.id);
      if (!kill || kill.source !== 'slot') continue;
      assert(kill.credited, 'the arrow\'s kill is the player\'s');
      const blast = of(events, 'blast').some(b => Math.hypot(b.x - e.x, b.y - e.y) < 1e-6);
      assert(blast, `sapper ${e.id} killed by an arrow blew up`);
      sappers++;
    }
    const blastKills = of(events, 'kill').filter(x => x.source === 'blast');
    assert(blastKills.every(x => x.credited), 'the blasts of sappers killed by arrows are the player\'s');
    assert(replays(s), 'replay');
  }
  assert(multi > 0 && sappers > 0, `checked: elites under 2+ marks of one wave ${multi}, sappers ${sappers}`);
});

check('a run battle with the goblin replays to the same hash (and every 300 ticks)', () => {
  let played = 0;
  for (let k = 1; k <= 40 && played < 3; k++) {
    const sim = field(quiet({ slotSkulls: 3 }), 900 + k, 'slot-field', { slot: true }), w = sim.world;
    sim.command({ t: 'goals' });
    ticks(sim, tick(3.2));
    if (!goblinOf(w)) continue;
    crowd(sim, (x, y) => ((x + y) % 4 === 3 ? {} : null));
    const hashes = new Map<number, string>();
    for (let pull = 0; pull < 3; pull++) {
      waitReady(sim);
      bareTo(sim);
      for (let t = 0; t < tick(9); t++) { ticks(sim, 1); if (w.tick % 300 === 0) hashes.set(w.tick, sim.hash()); }
    }
    assert(goblinOf(w)!.pulls === 3, 'three pulls');
    assert(replays(sim, hashes), `seed ${k}: replay with checkpoints`);
    played++;
  }
  assert(played === 3, `fights played: ${played}`);
});

check('the fight observer counts the slot: appearance after the goals, pulls with their links, outcomes, effects, arrow damage and kills', () => {
  for (let k = 1; k <= 60; k++) {
    const sim = field(quiet({ slotSkulls: 6 }), 1200 + k, 'slot-field', { slot: true }), w = sim.world;
    sim.command({ t: 'goals' });
    ticks(sim, tick(3.2));
    if (!goblinOf(w)) continue;
    crowd(sim);
    waitReady(sim);
    bareTo(sim);
    playOut(sim);
    const journal = sim.exportJournal()!;
    // The report's way: the observer sees every command and tick of a replay.
    let observer: ReturnType<typeof createFightObserver> | null = null;
    const again = replay(journal, r => { observer ??= createFightObserver(r.world); observer.tick(r.world); });
    const s = observer!.summary().slot;
    assert(again.hash() === sim.hash(), 'replay');
    assert(s.appeared === 1 && s.appearAfterGoals !== null && near(s.appearAfterGoals, 3, 2 * SIM_DT), `appeared 3 s after the goals: ${JSON.stringify(s)}`);
    assert(s.pulls === 1 && s.links.join() === '0' && s.effects === 1 && s.cancelled === 0, `one bare pull, its effect: ${JSON.stringify(s)}`);
    const outcome = Object.keys(s.outcomes)[0];
    const hits = of(collectReplayEvents(journal), 'hit').filter(h => h.source.startsWith('slot')).reduce((a, h) => a + h.damage, 0);
    assert(s.damage.rain + s.damage.volley === hits && w.hero.maxHp - w.hero.hp === hits, `the arrows' damage: ${JSON.stringify(s.damage)} = ${hits}`);
    if (outcome === 'rain') { assert(s.kills > 0 && s.kills === w.stats.kills, `arrow kills ${s.kills}`); return; }
  }
  throw new Error('no rain fight found');
});

/** Every event of a journal's replay (the observer test compares with it). */
function collectReplayEvents(journal: Journal): WorldEvent[] {
  const out: WorldEvent[] = [];
  replay(journal, r => { out.push(...r.world.events); r.world.events.length = 0; });
  return out;
}

console.log(`${checks} checks passed`);
