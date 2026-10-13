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
 * - every fight replays to its hash (and the hashes every 300 ticks); a journal without the key plays the same world;
 * - П11 «Правило частоты случая» (docs/realtime-engagement-research.md, П11; docs/realtime-casino.md, the section of that
 *   name): with the default params a run battle reveals chance at most 3 times, at least 8 s apart, each reveal at most
 *   1,2 s, even for a greedy player; the reel symbols the player sees are the outcome's own draw (χ² against s ÷ (4 + s));
 *   the view's stopped reels show the pull's reels only, its spinning blur does not depend on the outcome; a broken oath
 *   is no win. The two gaps found 11.10.2026 (the panel ranges in a run, the blur's fixed mix) are fixed (design answer).
 * - «Взрыв по площади» (task 7, 13.10.2026): the bust lights the idol (3.5, 1.2 s), the hero who stays takes −4, one who walks
 *   out at once (or 0.15 s late) takes nothing, 0.4 s late is caught; invulnerability, the dash and the jump spare him, the
 *   chain shield and «Щит фокуса» do not; weak enemies inside die as the player's kills, a tough 4 survives thrown off, one
 *   outside is untouched; the observer counts it; the plan of a chain into the lever is the dash; «Гоблин раньше»: a run
 *   battle's goblin at 5 s before the goals, once, at goals + 3 s when that is earlier, the spot varies by seed; a journal
 *   without the new keys plays the old world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { objectRefusal, planChain, type StrikeOutcome } from './chain';
import { lineOfSight } from './geometry';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { Graphics } from 'pixi.js';
import { oathLine, oathMark } from './oath';
import { defaultParams, heroRadius, PARAM_DEFS, type Params, sanitizeParams } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { bustOdds, GOOD_SYMBOLS, goblinOf, leverOf, outcomeOf, pullOdds, safePullsLeft, skullOdds, slotCharges, type Goblin, type SlotOutcome, type SlotSymbol } from './slot';
import { bustText, slotOddsText, slotPlanOdds } from './slotPlan';
import { focusGuarded, type Enemy, type World, type WorldEvent } from './world';
import { createRtRun, rtArenaLoadout, rtMapNodes, rtRunParams, RT_SLOT_ROW, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';
import { observeFightLuck, type RtLuckTally } from '../run/rtLuck';
import { RT_DEATH_ABILITY } from '../run/rtRunEnd';
import { createFightObserver } from '../telemetry/observe';
import { withSummaryDefaults } from '../telemetry/schema';
import { drawSymbol, reelStrip, riskyStrip, SlotView } from '../view/slotView';

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
  // «Перебор»: a bust during the wait takes the lever away — the wait ends.
  for (let i = 0; i < tick(20) && leverOf(sim.world) && objectRefusal(sim.world, lever(sim)) === 'lever'; i++) ticks(sim, 1, out);
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

check('appearance in a battle that may get it (the sandbox default chance; the run\'s 50 % — the «Перебор» run check): ≈ 35 % of seeds, not before 3 s after the goals, 3–7 from the hero and seen by him, varies by seed', () => {
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

check('the run gives the leave from row 1 (task 5, 12.10.2026; was row 3), not to the Jailer and not to a boss', () => {
  assert(RT_SLOT_ROW === 1, `the run's first goblin row: ${RT_SLOT_ROW}`);
  let rows = 0, jailer = 0, boss = 0, early = 0, first = 0;
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
      else { assert(leave, `${node.type} row ${row}: may get the goblin`); rows++; if (row <= 2) first++; }
    }
  }
  assert(rows > 0 && jailer > 0 && boss > 0 && early === 0 && first > 0, `checked: ${rows} battles (rows 1–2: ${first}), Jailer ${jailer}, boss ${boss}, before row ${RT_SLOT_ROW}: ${early}`);
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

check('the odds line hides when a survivor stands before the lever (the dash stops there, no pull) — review 11.10.2026', () => {
  const sim = field(quiet(), 7);
  summon(sim); waitReady(sim);
  const row = rowTo(sim, 2), L = lever(sim);
  draw(sim, [...row, L]);
  assert(slotPlanOdds(sim.world)?.onLever, 'the chain ends on the lever: the line shows');
  // A shaman's empowering (`shamanEmpowerHp`) raises a link's HP while the chain is held; stood in by setting it here.
  row[1].hp = 5;
  assert(planChain(sim.world).endsOnSurvivor && slotPlanOdds(sim.world) === null, 'a survivor before the lever: no line');
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(slotEvents(events, 'pull').length === 0, 'and no pull');
});

check('with the cauldron on, every enemy the arrows kill puts 1 ember (source `slot`, no heat); with it off — none', () => {
  for (const purse of [true, false]) {
    const p = quiet({ slotSkulls: 6, purse });
    const found = findPull('rain', p, 300, 2000);
    const s = field(p, found.k), w = s.world;
    summon(s); waitReady(s);
    const L = lever(s), dir = inward(w, L);
    s.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
    s.command({ t: 'begin', x: L.x, y: L.y });
    s.command({ t: 'release' });
    const events = settle(s);
    crowd(s);
    const before = w.purse?.cauldron ?? 0;
    events.push(...playOut(s));
    const kills = of(events, 'kill').filter(e => e.source === 'slot').length;
    const embers = of(events, 'purseKill').filter(e => e.source === 'slot').length;
    assert(kills > 0, 'the rain killed');
    if (purse) assert(embers === kills && (w.purse?.cauldron ?? 0) - before === kills, `1 ember per arrow kill: kills ${kills}, embers ${embers}, cauldron +${(w.purse?.cauldron ?? 0) - before}`);
    else assert(embers === 0 && !w.purse, 'no cauldron, no embers');
    assert(replays(s), 'replay');
  }
});

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

// ---- П11 «Правило частоты случая» (docs/realtime-engagement-research.md, П11; docs/realtime-casino.md) -----------------
// A chance reveal in a fight: at most once per 8 s of play, at most 1,2 s long, at most 3 per fight; the reel symbols the
// player sees are drawn from the outcome's own distribution (no tuned near-misses); a ×0,5 outcome has no win effect.

/** Every event of a journal's replay with the tick it came in. */
function replayLog(sim: Simulation): { tick: number; ev: WorldEvent }[] {
  const out: { tick: number; ev: WorldEvent }[] = [];
  replay(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal, r => { for (const ev of r.world.events) out.push({ tick: r.world.tick, ev }); r.world.events.length = 0; });
  return out;
}

check('П11: the sandbox defaults keep the rule (8 s, 1,2 s, 3 pulls); a run plays its own whatever the saved panel says — since «Перебор» (design 12.10.2026) 6 pulls 5 s apart, 3 safe; since task 5 the goblin in every battle, +1 safe pull a chain of 6+', () => {
  const d = defaultParams(), r = rtRunParams(defaultParams());
  assert(d.slotCooldown === 8 && d.slotSpin === 1.2 && d.slotPulls === 3 && d.slotChance === 0.35 && !d.slotBust, `sandbox: cooldown ${d.slotCooldown}, spin ${d.slotSpin}, pulls ${d.slotPulls}`);
  const runRule = (p: Params): boolean => p.slotCooldown === 5 && p.slotSpin === 1.2 && p.slotPulls === 6 && p.slotChance === 1 && p.slotBust === true
    && p.slotSafePulls === 3 && p.slotBustChance === 0.55 && p.slotBustDamage === 4 && p.slotSafePerLongChain === 1 && p.slotLongChainLinks === 6;
  assert(d.slotSafePerLongChain === 0 && d.slotLongChainLinks === 6, `sandbox: the long chain off (${d.slotSafePerLongChain})`);
  assert(runRule(r), `run: cooldown ${r.slotCooldown}, spin ${r.slotSpin}, pulls ${r.slotPulls}, chance ${r.slotChance}, bust ${r.slotBust}`);
  // The sandbox panel may debug anything (its ranges stay wide); the run's copy is forced back to the rule.
  const range = (key: string) => PARAM_DEFS.find(d => d.kind === 'number' && d.key === key) as { min: number; max: number } | undefined;
  const keys = ['slotPulls', 'slotCooldown', 'slotSpin', 'slotChance', 'slotSafePulls', 'slotBustChance', 'slotBustDamage', 'slotSafePerLongChain', 'slotLongChainLinks'] as const;
  assert(keys.every(k => range(k)) && PARAM_DEFS.some(d => d.key === 'slotBust' && d.group === 'Однорукий гоблин'), 'the panel has the numbers and the toggle');
  const wild = rtRunParams(sanitizeParams({ ...Object.fromEntries(keys.map(k => [k, range(k)!.max])), slotBust: false, slotCooldown: range('slotCooldown')!.min }));
  assert(runRule(wild), `a run with a wild panel: ${wild.slotPulls} / ${wild.slotCooldown} / ${wild.slotSpin} / ${wild.slotBust}`);
});

check('П11: the reel symbols the player sees are the outcome\'s own draw — a reel with s skulls shows ☠ with s ÷ (4 + s), each good symbol 1 ÷ (4 + s) (χ², 2 × 150 seeds, 3 pulls each)', () => {
  const SYMBOLS: readonly SlotSymbol[] = ['skull', ...GOOD_SYMBOLS];
  const groups = new Map<number, Record<string, number>>();
  for (const [skulls, from] of [[2, 4000], [0, 4200]] as const) {
    const params = skulls === 2 ? quiet() : quiet({ slotSkulls: skulls });
    for (let k = 1; k <= 150; k++) {
      const sim = field(params, from + k);
      summon(sim);
      for (let n = 0; n < 3; n++) {
        waitReady(sim);
        const { pull } = bareTo(sim);
        // What the reels show is what decides the outcome: one symbol per reel, no other draw for the display.
        assert(pull.reels && pull.reels.length === 3 && pull.outcome === outcomeOf(pull.reels), `the shown reels are the outcome: ${JSON.stringify(pull)}`);
        pull.reels.forEach((sym, i) => {
          const s = pull.skulls![i], tally = groups.get(s) ?? Object.fromEntries(SYMBOLS.map(x => [x, 0]));
          tally[sym]++;
          groups.set(s, tally);
        });
      }
    }
  }
  // χ² critical values at p = 0,001 (a heuristic: the seeds are fixed, so the check is deterministic).
  const critical: Record<number, number> = { 3: 16.27, 4: 18.47 };
  assert([0, 1, 2, 3].every(s => groups.has(s)), `skull counts seen: ${[...groups.keys()]}`);
  for (const [s, tally] of [...groups].sort((a, b) => a[0] - b[0])) {
    const n = SYMBOLS.reduce((a, x) => a + tally[x], 0);
    let chi = 0, cats = 0;
    for (const x of SYMBOLS) {
      const expected = n * (x === 'skull' ? s : 1) / (GOOD_SYMBOLS.length + s);
      if (expected === 0) { assert(tally[x] === 0, `s ${s}: no ${x} on a reel without it`); continue; }
      assert(expected >= 5, `s ${s}: enough symbols for χ² (${expected})`);
      chi += (tally[x] - expected) ** 2 / expected;
      cats++;
    }
    assert(chi < critical[cats - 1], `s ${s}: χ² ${chi.toFixed(2)} over ${n} symbols ${JSON.stringify(tally)}`);
    console.log(`   s ${s}: ${n} symbols ${JSON.stringify(tally)}, χ² ${chi.toFixed(2)}`);
  }
});

check('П11 (view, slotView.ts): the strip of a reel with s skulls has the share s ÷ (4 + s) (s = 0–3)', () => {
  for (let skulls = 0; skulls <= 3; skulls++) {
    const strip = reelStrip(skulls), share = strip.filter(x => x === 'skull').length / strip.length;
    assert(Math.abs(share - skulls / (GOOD_SYMBOLS.length + skulls)) < 1e-9 && strip.length === GOOD_SYMBOLS.length + skulls, `s ${skulls}: ${strip.join()}`);
    for (const g of GOOD_SYMBOLS) assert(strip.filter(x => x === g).length === 1, `s ${skulls}: one ${g}`);
  }
});

check('П11 (view, slotView.ts): the stopped reels show the pull\'s reels only; the spinning strip shows the skull share of the pull, not its outcome', () => {
  // Each symbol is told apart by the first fill colour drawSymbol (exported by the view) gives it, counted per drawing.
  const fills = (g: Graphics): number[] => ((g as unknown as { context: { instructions: { action: string; data: { style: { color: number } } }[] } }).context.instructions)
    .filter(i => i.action === 'fill').map(i => i.data.style.color);
  const SYMBOLS: readonly SlotSymbol[] = ['skull', ...GOOD_SYMBOLS];
  const sig = new Map<SlotSymbol, { color: number; per: number }>();
  for (const sym of SYMBOLS) {
    const g = new Graphics();
    drawSymbol(g, sym, 0, 0, 10);
    const own = fills(g);
    sig.set(sym, { color: own[0], per: own.filter(c => c === own[0]).length });
  }
  assert(new Set([...sig.values()].map(v => v.color)).size === SYMBOLS.length, 'the symbols have distinct key colours');
  const view = new SlotView(40), shownNow = () => ({ ...view.shown });
  const sim = field(quiet(), 7), w = sim.world;
  summon(sim); waitReady(sim);
  const count = (base?: Map<SlotSymbol, number>): Map<SlotSymbol, number> => {
    const all = fills(view.layer), out = new Map<SlotSymbol, number>();
    for (const sym of SYMBOLS) {
      const { color, per } = sig.get(sym)!, raw = all.filter(c => c === color).length - (base?.get(sym) ?? 0) * per;
      out.set(sym, raw / per);
    }
    return out;
  };
  view.draw(w, 0, 0, null);
  { const s = shownNow(); assert(s.idols === 1 && s.spinning === 0 && s.stopped === 0, 'the idol alone'); }
  const idol = count();
  /** Frames of a fresh spin (all three reels spinning) at fixed clocks: the symbols drawn in each. */
  const blur = (): { frames: string[]; skulls: number; symbols: number } => {
    const frames: string[] = [];
    let skulls = 0, symbols = 0;
    for (let j = 0; j < 600; j++) {
      view.draw(w, j * 0.0123, 0, null);
      { const s = shownNow(); assert(s.spinning === 3 && s.stopped === 0, `a fresh spin: ${JSON.stringify(s)}`); }
      const seen = count(idol), total = [...seen.values()].reduce((a, b) => a + b, 0);
      assert(total === 3, `three symbols drawn: ${JSON.stringify([...seen])}`);
      frames.push(SYMBOLS.map(s => seen.get(s)).join());
      skulls += seen.get('skull')!; symbols += total;
    }
    return { frames, skulls, symbols };
  };
  const pulls: { reels: SlotSymbol[]; skulls: number[]; blur: ReturnType<typeof blur> }[] = [];
  for (let n = 0; n < 3; n++) {
    waitReady(sim);
    const { pull } = bareTo(sim);
    view.handle(pull);
    const b = blur();
    // The 3rd reel stops; the result glows: exactly three symbols — the pull's reels, nothing above or below the line.
    ticks(sim, tick(1.25));
    view.draw(w, 0, 0.01, null);
    { const s = shownNow(); assert(s.stopped === 3 && s.spinning === 0, `stopped: ${JSON.stringify(s)}`); }
    const shown = count(idol);
    for (const sym of SYMBOLS) assert(shown.get(sym) === pull.reels!.filter(r => r === sym).length, `pull ${n + 1}: the line shows ${pull.reels} (${JSON.stringify([...shown])})`);
    pulls.push({ reels: pull.reels!, skulls: pull.skulls!, blur: b });
  }
  // The strip reads the pull's skulls, never its reels or outcome: no tuned near-miss in the spin (the pulls' reels differ).
  assert(new Set(pulls.map(q => q.reels.join())).size > 1, `different reels: ${pulls.map(q => q.reels.join()).join(' | ')}`);
  // Each pull's blur ☠ share follows its own skulls (the mean of s ÷ (4 + s) over the reels), greed included.
  const outcomeShare = (skulls: readonly number[]): number => skulls.reduce((a, s) => a + s / (GOOD_SYMBOLS.length + s), 0) / skulls.length;
  for (const [n, q] of pulls.entries()) {
    const share = q.blur.skulls / q.blur.symbols;
    assert(Math.abs(share - outcomeShare(q.skulls)) < 0.05, `pull ${n + 1} (skulls ${q.skulls}): blur ☠ ${share.toFixed(3)} ≈ ${outcomeShare(q.skulls).toFixed(3)}`);
  }
  assert(replays(sim), 'replay');
});

check('П11: a broken oath is no win — the HUD line dims to «×0,5» without ✓, the door records ×0,5 and keeps the line', () => {
  for (let k = 1; k <= 3; k++) {
    const sim = field(quiet({ oathStake: true }), 60 + k, 'slot-field', { oath: 'no-jump' }), w = sim.world;
    assert(oathLine(w) === 'Клятва: без прыжков ✓' && oathMark(w)?.mark === 'holds', `the oath holds: ${oathLine(w)}`);
    sim.command({ t: 'energy', value: 7 });
    sim.command({ t: 'jump', x: 11.5, y: 7 });
    const events = settle(sim);
    assert(of(events, 'oath').some(e => e.action === 'broken'), 'the jump broke it');
    assert(oathMark(w)?.mark === 'broken' && oathLine(w) === 'Клятва: без прыжков ×0,5', `broken: ${oathLine(w)}`);
    sim.command({ t: 'goals' });
    sim.command({ t: 'teleport', x: 16.5, y: 6 });
    sim.command({ t: 'walk', x: 1, y: 0 });
    const end: WorldEvent[] = [];
    for (let i = 0; i < 600 && w.status === 'playing'; i++) ticks(sim, 1, end);
    assert(w.status === 'victory', `the door (${w.status})`);
    const door = of(end, 'oath').find(e => e.action === 'door');
    assert(door && door.kept === false && door.mult === 0.5, `the door records ×0,5: ${JSON.stringify(door)}`);
    assert(oathLine(w) === 'Клятва: без прыжков ×0,5' && !oathLine(w)!.includes('✓'), `after the door: ${oathLine(w)}`);
    assert(replays(sim), 'replay');
  }
});

// ---- «Перебор» (design 12.10.2026, playtest v34; docs/realtime-casino.md, «Перебор») ---------------------------------------
// Pulls after `slotSafePulls` are risky: a bust roll (stream `slot:bust`) in the pull tick; the bust blows the goblin up when
// the reels stop — `slotBustDamage` to the hero through every protection; else a sure triple of a good symbol.

/** The slot with «Перебор» and 6 pulls, no cooldown (the tests pull at once). */
const bustParams = (extra: Partial<Params> = {}): Params => quiet({ slotBust: true, slotPulls: 6, slotCooldown: 0, ...extra });
/** `n` bare pulls in a row, each played out to its effect; the pull events. */
function pullsInARow(sim: Simulation, n: number, out: WorldEvent[] = []): Ev<'slot'>[] {
  const pulls: Ev<'slot'>[] = [];
  for (let i = 0; i < n && goblinOf(sim.world); i++) {
    waitReady(sim, out);
    const { pull, events } = bareTo(sim);
    out.push(...events);
    pulls.push(pull);
    ticks(sim, tick(1.2) + 2, out);
  }
  return pulls;
}
/** Seeds whose first risky roll busts / does not (searched in order). */
function bustSeeds(bust: boolean, count: number, from = 7000): number[] {
  const out: number[] = [];
  for (let k = from; out.length < count && k < from + 400; k++) {
    const sim = field(bustParams({ slotSafePulls: 0 }), k);
    summon(sim); waitReady(sim);
    if (bareTo(sim).pull.bust === bust) out.push(k);
  }
  assert(out.length === count, `seeds with bust ${bust}: ${out.length}`);
  return out;
}

check('«Перебор» off by default; a journal without its keys plays the same world; with it on the first 3 pulls are the old pulls (no bust roll)', () => {
  const d = defaultParams();
  assert(d.slotBust === false && d.slotSafePulls === 3 && d.slotBustChance === 0.55 && d.slotBustDamage === 4, 'the defaults');
  const without = (state: unknown): string => { const s = { ...(state as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };
  for (let k = 1; k <= 3; k++) {
    const off = quiet({ slotPulls: 6, slotCooldown: 0, slotSkulls: 1 }), old = { ...off } as Partial<Params>;
    for (const key of ['slotBust', 'slotSafePulls', 'slotBustChance', 'slotBustDamage'] as const) delete old[key];
    const a = field(off, 600 + k), b = field(old as Params, 600 + k);
    const pa = (summon(a), pullsInARow(a, 6)), pb = (summon(b), pullsInARow(b, 6));
    assert(pa.length === 6 && pb.length === 6 && pa.every(p => p.risky === undefined && p.bust === undefined), 'six old pulls, no «Перебор» fields');
    assert(without(worldState(a.world)) === without(worldState(b.world)), `seed ${k}: the same world without the keys`);
    assert(!a.world.rng.states().some(([name]) => name === 'slot:bust'), 'the bust stream untouched');
    const journal = a.exportJournal()!;
    for (const key of ['slotBust', 'slotSafePulls', 'slotBustChance', 'slotBustDamage'] as const) delete (journal.params as Partial<Params>)[key];
    assert(without(worldState(replay(journal).world)) === without(worldState(a.world)), 'the journal without the keys replays the same world');
    // On: pulls 1–3 draw the same reels as without the rule; the bust stream is first drawn by the 4th.
    const c = field(bustParams({ slotSkulls: 1 }), 600 + k);
    summon(c);
    const pc = pullsInARow(c, 3);
    assert(pc.every((p, i) => p.risky === false && p.bust === false && JSON.stringify(p.reels) === JSON.stringify(pa[i].reels) && p.outcome === pa[i].outcome), `seed ${k}: the safe pulls are the old pulls`);
    assert(!c.world.rng.states().some(([name]) => name === 'slot:bust'), 'no bust roll in pulls 1–3');
    const fourth = pullsInARow(c, 1)[0];
    assert(fourth.risky === true && typeof fourth.bust === 'boolean' && c.world.rng.states().some(([name]) => name === 'slot:bust'), `the 4th pull rolls: ${JSON.stringify(fourth)}`);
    assert(fourth.rain === 0 && fourth.volley === 0, 'a risky pull has no skull odds');
    assert(replays(c) && replays(a), 'replays');
  }
});

check('«Перебор»: the risky pull busts on ≈ 55 % of 1200 seeds; else a sure triple, each good symbol ≈ ¼; after 3 safe pulls the 4th rolls the same', () => {
  let busts = 0, n = 0;
  const triples: Record<string, number> = { heart3: 0, bolt3: 0, gem3: 0, jackpot: 0 };
  for (let k = 1; k <= 1200; k++) {
    const sim = field(bustParams({ slotSafePulls: 0 }), 8000 + k);
    summon(sim); waitReady(sim);
    const { pull } = bareTo(sim);
    assert(pull.risky === true && pull.pull === 1, 'the first pull is risky with 0 safe');
    n++;
    if (pull.bust) { busts++; assert(pull.outcome === 'bust', 'the outcome bust'); continue; }
    assert(pull.outcome! in triples && pull.reels!.every(r => r === pull.reels![0]) && pull.reels![0] !== 'skull', `a sure triple: ${JSON.stringify(pull.reels)} ${pull.outcome}`);
    triples[pull.outcome!]++;
  }
  const share = busts / n, sd = Math.sqrt(0.55 * 0.45 / n);
  assert(Math.abs(share - 0.55) < 4 * sd, `bust share ${share.toFixed(3)} (55 % ± ${(4 * sd).toFixed(3)})`);
  const good = n - busts;
  let chi = 0;
  for (const v of Object.values(triples)) chi += (v - good / 4) ** 2 / (good / 4);
  assert(chi < 16.27, `the triples are equally likely: ${JSON.stringify(triples)}, χ² ${chi.toFixed(2)}`);
  console.log(`   busts ${busts} of ${n} (${(share * 100).toFixed(1)} %), triples ${JSON.stringify(triples)}`);
  // The rule as the run plays it: 3 safe pulls, then the roll — the same draw as the first roll of the stream.
  let fourthBusts = 0;
  for (let k = 1; k <= 200; k++) {
    const sim = field(bustParams(), 8000 + k);
    summon(sim);
    const pulls = pullsInARow(sim, 4);
    assert(pulls.slice(0, 3).every(p => p.risky === false) && pulls[3].risky === true, 'pulls 1–3 safe, the 4th risky');
    if (pulls[3].bust) fourthBusts++;
  }
  assert(fourthBusts > 200 * 0.45 && fourthBusts < 200 * 0.65, `4th pull busts ${fourthBusts} of 200`);
});

check('«Перебор»: the plan\'s line is the pull\'s numbers — «безопасно» 3 → 0, then «взрыв 55 % · −4 HP · иначе тройка»; the panel\'s chance is what rolls', () => {
  const sim = field(bustParams({ slotSafePulls: 3 }), 5);
  summon(sim);
  for (let i = 0; i < 4; i++) {
    waitReady(sim);
    assert(safePullsLeft(sim.world) === Math.max(0, 3 - i), `safe left ${safePullsLeft(sim.world)} before pull ${i + 1}`);
    const L = lever(sim), dir = inward(sim.world, L);
    sim.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
    sim.command({ t: 'begin', x: L.x, y: L.y });
    const odds = slotPlanOdds(sim.world)!;
    if (i < 3) assert(!odds.bust && slotOddsText(odds).startsWith('дождь '), `a safe pull's line: ${slotOddsText(odds)}`);
    else {
      assert(odds.bust && odds.bust.chance === 0.55 && odds.bust.damage === 4 && JSON.stringify(odds.bust) === JSON.stringify(bustOdds(sim.world)), `the risky line's numbers: ${JSON.stringify(odds)}`);
      assert(slotOddsText(odds) === 'взрыв 55 % · −4 HP · иначе тройка' && bustText(odds.bust) === 'взрыв 55 % · −4 HP', `the risky line: ${slotOddsText(odds)}`);
    }
    sim.command({ t: 'release' });
    settle(sim); ticks(sim, tick(1.2) + 2);
    if (!goblinOf(sim.world)) break;
  }
  // The panel's numbers are the roll's: chance 0 never busts, 1 always (and the line says so).
  for (const [chance, word] of [[0, 'взрыв 0 %'], [1, 'взрыв 100 %']] as const) {
    const s = field(bustParams({ slotSafePulls: 0, slotBustChance: chance, slotBustDamage: 2 }), 6);
    summon(s); waitReady(s);
    assert(bustText(bustOdds(s.world)!) === `${word} · −2 HP`, `the line ${bustText(bustOdds(s.world)!)}`);
    const busted = [0, 1, 2].map(() => { const p = pullsInARow(s, 1)[0]; return p?.bust; }).filter(b => b !== undefined);
    assert(chance === 0 ? busted.length === 3 && busted.every(b => !b) : busted.length === 1 && busted[0], `chance ${chance}: ${JSON.stringify(busted)}`);
  }
  assert(slotCharges(field(bustParams(), 1).world).safe === 3 && slotCharges(field(quiet({ slotPulls: 6 }), 1).world).safe === 6, 'without the rule every pull is safe');
});

check('«Перебор»: the bust hits the hero for 4 wherever he is — through the invulnerability, the chain shield, the dash, the jump and «Щит фокуса»; the goblin and its lever are gone', () => {
  const [k] = bustSeeds(true, 1);
  type Guard = 'none' | 'invulnerable' | 'shield' | 'dash' | 'jump' | 'focus';
  const lead: Record<Guard, number> = { none: 0.05, invulnerable: 0.25, shield: 0.45, dash: 0.12, jump: 0.1, focus: 0.3 };
  for (const guard of ['none', 'invulnerable', 'shield', 'dash', 'jump', 'focus'] as const) {
    const sim = field(bustParams({ slotSafePulls: 0, focusGuardLinks: 3 }), k), w = sim.world;
    summon(sim); waitReady(sim);
    const { pull } = bareTo(sim);
    assert(pull.bust === true, `seed ${k} busts`);
    const g = goblinOf(w)!, events: WorldEvent[] = [];
    while (g.spin && g.spin.left > lead[guard] + 1e-9) ticks(sim, 1, events);
    const h = w.hero, d = inward(w, h);
    if (guard === 'invulnerable') { sim.command({ t: 'param', key: 'contactDamage', value: 1 }); place(sim, h.x + 0.3, h.y, 0, { color: 1 }); }
    if (guard === 'shield') { const row = [1, 2, 3].map(i => place(sim, h.x + d.x * 0.9 * i, h.y + d.y * 0.9 * i)); draw(sim, row); sim.command({ t: 'release' }); }
    if (guard === 'dash') { const row = [1, 2, 3, 4, 5, 6].map(i => place(sim, h.x + d.x * 1.0 * i, h.y + d.y * 1.0 * i)); draw(sim, row); sim.command({ t: 'release' }); }
    // «Щит фокуса» (design 12.10.2026): a chain of 3 held while the reels stop.
    if (guard === 'focus') draw(sim, [1, 2, 3].map(i => place(sim, h.x + d.x * 0.9 * i, h.y + d.y * 0.9 * i)));
    if (guard === 'jump') { sim.command({ t: 'energy', value: 7 }); assert(sim.command({ t: 'jump', x: h.x + d.x * 2, y: h.y + d.y * 2 }) === true, 'the jump starts'); }
    // Tick by tick to the effect: the guard stands in the tick before it.
    let before = { hp: h.hp as number, inv: 0, shield: 0, move: null as string | null, focus: false };
    for (let i = 0; i < tick(2) && goblinOf(w); i++) {
      before = { hp: h.hp as number, inv: h.invulnerable, shield: h.chainShield, move: w.move?.kind ?? null, focus: focusGuarded(w) };
      ticks(sim, 1, events);
    }
    const effect = slotEvents(events, 'effect'), hits = of(events, 'hit').filter(e => e.source === 'slot-bust');
    assert(effect.length === 1 && effect[0].outcome === 'bust', `${guard}: the bust came`);
    const guarded = { none: true, invulnerable: before.inv > 0, shield: before.shield > 0, dash: before.move === 'dash', jump: before.move === 'jump', focus: before.focus }[guard];
    assert(guarded, `${guard}: the guard stood in the tick before the bust (${JSON.stringify(before)})`);
    assert(hits.length === 1 && hits[0].damage === 4 && h.hp === before.hp - 4, `${guard}: −4 HP (${before.hp} → ${h.hp}, ${JSON.stringify(hits)})`);
    // Gone: no goblin, no lever object, the lever's spot starts no chain; nothing shows a charge.
    assert(!goblinOf(w) && !leverOf(w) && !w.objects.some(o => o.kind === 'lever') && w.objects.every(o => o.id !== g.id), `${guard}: the goblin is gone`);
    assert(safePullsLeft(w) === null && bustOdds(w) === null, 'no charges left to show');
    if (!w.move) {
      sim.command({ t: 'begin', x: g.x, y: g.y });
      assert(!w.chain.some(l => l.kind === 'object' && l.id === g.id), 'the lever is no target');
    }
    playOut(sim);
    assert(!w.objects.some(o => o.kind === 'lever'), 'it never comes back');
    assert(replays(sim), `${guard}: replay`);
  }
});

check('«Перебор»: the bust may kill (source `slot-bust`, the run-end line «взрыв гоблина»); the second wind works as usual; the door during the spin cancels it', () => {
  const [k] = bustSeeds(true, 1), [safe] = bustSeeds(false, 1);
  const lethal = (extra: Partial<Params>) => {
    const sim = field(bustParams({ slotSafePulls: 0, ...extra }), k, 'slot-field', undefined, { hp: 3, maxHp: 40 });
    summon(sim); waitReady(sim); bareTo(sim);
    const events = playOut(sim);
    return { sim, events };
  };
  const dead = lethal({});
  assert(dead.sim.world.status === 'defeat' && of(dead.events, 'hit').at(-1)?.source === 'slot-bust', `lethal: ${dead.sim.world.status}`);
  assert(RT_DEATH_ABILITY['slot-bust'] === 'взрыв гоблина', 'the run-end line names it');
  const wind = lethal({ secondWind: true });
  assert(wind.sim.world.status === 'playing' && wind.sim.world.hero.hp === 3 && of(wind.events, 'secondWind').length === 1, `the second wind: ${wind.sim.world.status}, hp ${wind.sim.world.hero.hp}`);
  assert(replays(dead.sim) && replays(wind.sim), 'replays');
  // The door during the spin: no bust, no hit; a safe seed the same (no triple either).
  for (const seed of [k, safe]) {
    const sim = field(bustParams({ slotSafePulls: 0 }), seed, 'slot-field', undefined, { hp: 10, maxHp: 40 }), w = sim.world;
    summon(sim); waitReady(sim); bareTo(sim);
    sim.command({ t: 'goals' });
    const door = w.objects.find(o => o.kind === 'door')!;
    sim.command({ t: 'teleport', x: door.x, y: door.y });
    const after = ticks(sim, tick(2));
    assert(w.status === 'victory' && !slotEvents(after, 'effect').length && !of(after, 'hit').length && w.hero.hp === 10, `seed ${seed}: the door cancels (${w.status}, hp ${w.hero.hp})`);
    assert(replays(sim), 'replay');
  }
});

check('«Перебор» in a run battle: the goblin in every battle (task 5: chance 1, was 50 %); a greedy player of bare pulls gets 3 safe pulls, then risky ones ≥ 5 s apart, each reveal ≤ 1,2 s, until a bust or the 6th pull', () => {
  const p = rtRunParams(quiet());
  let rolled = 0, came = 0;
  for (let k = 1; k <= 300; k++) {
    const sim = field(p, 3500 + k, 'slot-field', { slot: true });
    sim.command({ t: 'teleport', x: 10, y: 6 });
    sim.command({ t: 'goals' });
    ticks(sim, tick(3.2));
    if (!sim.world.slot) continue;
    rolled++;
    if (goblinOf(sim.world)) came++;
  }
  assert(rolled === 300 && came === rolled, `the goblin in ${came} of ${rolled} run battles (all: the open field always has a spot)`);
  let fights = 0, busted = 0;
  for (let k = 1; k <= 80 && fights < 8; k++) {
    const sim = field(p, 3000 + k, k % 2 ? 'slot-field' : 'slot-walls', { slot: true }), w = sim.world;
    sim.command({ t: 'teleport', x: 10, y: 6 });
    sim.command({ t: 'goals' });
    ticks(sim, tick(3.2));
    if (!goblinOf(w)) continue;
    for (let attempt = 0; attempt < 8 && goblinOf(w); attempt++) {
      waitReady(sim);
      if (!goblinOf(w) || objectRefusal(w, lever(sim)) === 'lever') break;
      bareTo(sim);
    }
    ticks(sim, tick(3));
    const log = replayLog(sim);
    const pulls = log.filter(e => e.ev.type === 'slot' && e.ev.action === 'pull') as { tick: number; ev: Ev<'slot'> }[];
    const effects = log.filter(e => e.ev.type === 'slot' && e.ev.action === 'effect') as { tick: number; ev: Ev<'slot'> }[];
    const bust = effects.findIndex(e => e.ev.outcome === 'bust');
    assert(pulls.length === effects.length && pulls.length <= 6 && (bust < 0 ? pulls.length === 6 : bust === pulls.length - 1), `seed ${k}: ${pulls.length} pulls, bust at ${bust}`);
    pulls.forEach((e, i) => {
      assert(e.ev.risky === i >= 3, `seed ${k}: pull ${i + 1} risky ${e.ev.risky}`);
      const reveal = (effects[i].tick - e.tick) * SIM_DT;
      assert(reveal > 0 && reveal <= 1.2 + 1e-9, `seed ${k}: reveal ${i + 1} lasts ${reveal.toFixed(3)} s`);
      if (i) assert((e.tick - pulls[i - 1].tick) * SIM_DT >= 5 - 1e-9, `seed ${k}: pulls ${i} and ${i + 1} ${((e.tick - pulls[i - 1].tick) * SIM_DT).toFixed(2)} s apart`);
    });
    if (bust >= 0) {
      busted++;
      const blows = of(log.map(e => e.ev), 'hit').filter(h => h.source === 'slot-bust');
      assert(!goblinOf(w) && blows.length === 1 && blows[0].damage === 4, `seed ${k}: the bust took 4 (${JSON.stringify(blows)})`);
    }
    else assert(objectRefusal(w, lever(sim)) === 'lever', `seed ${k}: dark after the 6th pull`);
    fights++;
  }
  assert(fights === 8 && busted >= 1, `fights ${fights}, busted ${busted}`);
});

check('«Перебор» in telemetry: the fight observer counts risky pulls, busts, their damage and a death by the bust; the luck meter skips risky pulls', () => {
  const [k] = bustSeeds(true, 1);
  // 40 HP: a safe pull, then the bust; 3 HP: the bust first (no heart before it), it kills.
  for (const hp of [40, 3]) {
    const sim = field(bustParams({ slotSafePulls: hp === 40 ? 1 : 0, slotSkulls: 0 }), k, 'slot-field', undefined, { hp, maxHp: 40 });
    summon(sim);
    pullsInARow(sim, 3);
    playOut(sim);
    let observer: ReturnType<typeof createFightObserver> | null = null;
    const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
    replay(journal, r => { observer ??= createFightObserver(r.world); observer.tick(r.world); });
    const events = collectReplayEvents(journal);
    const s = observer!.summary().slot;
    const risky = of(events, 'slot').filter(e => e.action === 'pull' && e.risky).length, busts = of(events, 'slot').filter(e => e.action === 'effect' && e.outcome === 'bust').length;
    assert(s.risky === risky && risky >= 1 && s.busts === busts && busts === 1, `risky ${s.risky}/${risky}, busts ${s.busts}/${busts}`);
    assert(s.bustDamage === 4, `bust damage ${s.bustDamage}`);
    assert(s.bustDeaths === (hp === 3 ? 1 : 0), `hp ${hp}: bust deaths ${s.bustDeaths} (${sim.world.status})`);
    const luck: RtLuckTally = {};
    observeFightLuck(luck, events);
    assert((luck['slot-rain']?.tries ?? 0) === of(events, 'slot').filter(e => e.action === 'pull').length - risky, `luck counts safe pulls only: ${JSON.stringify(luck)}`);
  }
});

check('П11 + «Перебор» (view, review 12.10.2026): a risky pull\'s reels spin the bust strip — ☠ with the bust chance, each good symbol (1 − c) ÷ 4; the safe pulls keep the skulls\' strip', () => {
  for (const c of [0, 0.25, 0.5, 0.55, 0.6, 0.9, 1]) {
    const strip = riskyStrip(c), skulls = strip.filter(s => s === 'skull').length;
    const goods = GOOD_SYMBOLS.map(g => strip.filter(s => s === g).length);
    assert(Math.abs(skulls / strip.length - c) <= 0.01 && goods.every(n => n === goods[0]), `c ${c}: ☠ ${skulls}/${strip.length}, goods ${goods}`);
  }
  // The view: a risky pull's spinning blur over many frames shows ☠ at the bust chance (not the skulls' s ÷ (4 + s)).
  const fills = (g: Graphics): number[] => ((g as unknown as { context: { instructions: { action: string; data: { style: { color: number } } }[] } }).context.instructions)
    .filter(i => i.action === 'fill').map(i => i.data.style.color);
  const skullSig = (() => { const g = new Graphics(); drawSymbol(g, 'skull', 0, 0, 10); const own = fills(g); return { color: own[0], per: own.filter(x => x === own[0]).length }; })();
  const sim = field(bustParams({ slotSafePulls: 1, slotSkulls: 0 }), 11), w = sim.world, view = new SlotView(40);
  summon(sim);
  pullsInARow(sim, 1);
  waitReady(sim);
  const { pull } = bareTo(sim);
  assert(pull.risky === true && goblinOf(w)?.spin, 'a risky pull spins');
  view.handle(pull);
  view.draw(w, 0, 0, null);
  let skulls = 0, symbols = 0;
  for (let j = 0; j < 900; j++) {
    view.draw(w, j * 0.0123, 0, null);
    // The idol has no skull colour; three reels spin, one symbol each.
    skulls += fills(view.layer).filter(x => x === skullSig.color).length / skullSig.per;
    symbols += 3;
  }
  // With 0 skulls on the reels the old strip would show no ☠ at all.
  assert(Math.abs(skulls / symbols - 0.55) < 0.06, `the risky blur: ☠ ${(skulls / symbols).toFixed(3)} (0,55)`);
});

// ---- Task 7 «Взрыв гоблина по площади» and «Гоблин раньше» (design 13.10.2026, playtest v39) -------------------------
// With `slotBustArea` the bust no longer hits the hero wherever he is: the idol lights, 3.5 around it, 1.2 s later the blast
// hits everyone inside — the hero −4 (invulnerability, the dash and the jump spare him; the chain shield and the focus shield
// do not), every enemy −3 (the player's kills, source `slot-bust`). With `slotAppearAt` the battle's one roll comes at that
// fight second or `slotDelay` after the goals, whichever is earlier.

/** «Перебор» with the area blast as the run plays it (radius 3.5, fuse 1.2, enemies 3), every pull risky. */
const areaParams = (extra: Partial<Params> = {}): Params => bustParams({ slotSafePulls: 0, slotBustArea: true, slotBustRadius: 3.5, slotBustFuse: 1.2, slotBustEnemyDamage: 3, ...extra });
/** A busting bare pull played to the lit idol: the hero stands where the dash onto the lever ended (the idol's spot). */
function litBust(k: number, extra: Partial<Params> = {}): { sim: Simulation; events: WorldEvent[]; lit: Ev<'slot'>; idol: { x: number; y: number } } {
  const sim = field(areaParams(extra), k);
  const g = summon(sim);
  waitReady(sim);
  const { pull, events } = bareTo(sim);
  assert(pull.bust === true, `seed ${k} busts`);
  for (let i = 0; i < tick(3) && !slotEvents(events, 'lit').length; i++) ticks(sim, 1, events);
  const lit = slotEvents(events, 'lit')[0];
  assert(lit, 'the idol lit');
  return { sim, events, lit, idol: { x: g.x, y: g.y } };
}
type HeroBefore = { hp: number; inv: number; shield: number; move: string | null; focus: boolean };
/** Ticks until the bust blast went off, collecting the events; the hero's state in the tick before it. */
function toBlast(sim: Simulation, events: WorldEvent[]): { blast: Ev<'slot'>; before: HeroBefore } {
  const w = sim.world, h = w.hero;
  const look = (): HeroBefore => ({ hp: h.hp, inv: h.invulnerable, shield: h.chainShield, move: w.move?.kind ?? null, focus: focusGuarded(w) });
  let before = look();
  for (let i = 0; i < tick(16) && !slotEvents(events, 'blast').length && w.status === 'playing'; i++) { before = look(); ticks(sim, 1, events); }
  const blast = slotEvents(events, 'blast')[0];
  assert(blast, 'the blast went off');
  return { blast, before };
}
const bustHits = (events: readonly WorldEvent[]) => of(events, 'hit').filter(e => e.source === 'slot-bust');

check('«Взрыв по площади» off by default, the run turns it on; a journal without its keys (and without `slotAppearAt`) plays the same world', () => {
  const d = defaultParams(), r = rtRunParams(defaultParams());
  assert(d.slotBustArea === false && d.slotAppearAt === 0 && d.slotBustRadius === 3.5 && d.slotBustFuse === 1.2 && d.slotBustEnemyDamage === 3, 'the defaults');
  assert(r.slotBustArea === true && r.slotAppearAt === 5 && r.slotBustRadius === 3.5 && r.slotBustFuse === 1.2 && r.slotBustEnemyDamage === 3, 'the run');
  const keys = ['slotBustArea', 'slotBustRadius', 'slotBustFuse', 'slotBustEnemyDamage', 'slotAppearAt'] as const;
  assert(keys.every(key => PARAM_DEFS.some(x => x.key === key && x.group === 'Однорукий гоблин')), 'the panel has them');
  const without = (state: unknown): string => { const s = { ...(state as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };
  const [k] = bustSeeds(true, 1);
  // The old bust: the keys off or absent — the same world, the hero hit at the effect (no blast, no `lit`).
  const off = areaParams({ slotBustArea: false, slotAppearAt: 0 }), old = { ...off } as Partial<Params>;
  for (const key of keys) delete old[key];
  const runs = [off, old as Params].map(p => {
    const sim = field(p, k, 'slot-field', { slot: true });
    sim.command({ t: 'goals' });
    ticks(sim, tick(1));
    summon(sim); waitReady(sim); bareTo(sim);
    const events = playOut(sim);
    return { sim, events };
  });
  for (const { events, sim } of runs) {
    assert(!slotEvents(events, 'lit').length && !slotEvents(events, 'blast').length && bustHits(events).length === 1 && !sim.world.blasts.length, 'the old bust: one blow, no blast');
  }
  assert(without(worldState(runs[0].sim.world)) === without(worldState(runs[1].sim.world)), 'the same world without the keys');
  const journal = runs[0].sim.exportJournal()!;
  for (const key of keys) delete (journal.params as Partial<Params>)[key];
  assert(without(worldState(replay(journal).world)) === without(worldState(runs[0].sim.world)), 'the journal without the keys replays the same world');
  assert(replays(runs[0].sim) && replays(runs[1].sim), 'replays');
});

check('«Взрыв по площади»: the bust lights the idol (3.5, 1.2 s, no blow at the effect); the hero who stays takes −4 at the blast, the one who walks out at once takes nothing, a late walker is caught', () => {
  for (const k of bustSeeds(true, 3)) {
    // Stays where the dash onto the lever ended.
    const stay = litBust(k), w = stay.sim.world, hp = w.hero.hp;
    assert(Math.hypot(w.hero.x - stay.idol.x, w.hero.y - stay.idol.y) < 0.05, 'the dash onto the lever ends on the idol');
    const effect = slotEvents(stay.events, 'effect');
    assert(effect.length === 1 && effect[0].outcome === 'bust' && !bustHits(stay.events).length && hp === 40, 'no blow at the effect');
    assert(near(stay.lit.x, stay.idol.x) && near(stay.lit.y, stay.idol.y) && stay.lit.r === 3.5 && stay.lit.fuse === 1.2, `the lit circle ${JSON.stringify(stay.lit)}`);
    const pending = w.blasts.filter(b => b.bust);
    assert(pending.length === 1 && pending[0].id === stay.lit.blastId && near(pending[0].x, stay.idol.x) && pending[0].radius === 3.5 && near(pending[0].total, 1.2) && pending[0].bust!.hero === 4, `the pending blast ${JSON.stringify(pending)}`);
    assert(!goblinOf(w) && !leverOf(w), 'the goblin and its lever are gone at the light');
    const litTick = w.tick, { blast } = toBlast(stay.sim, stay.events);
    assert(Math.abs((w.tick - litTick) * SIM_DT - 1.2) <= SIM_DT + 1e-9, `the fuse ${((w.tick - litTick) * SIM_DT).toFixed(3)} s`);
    assert(blast.inside === true && blast.hurt === true && bustHits(stay.events).length === 1 && bustHits(stay.events)[0].damage === 4 && w.hero.hp === hp - 4, `stays: −4 (${hp} → ${w.hero.hp})`);
    assert(!w.blasts.length && of(stay.events, 'blast').some(b => b.source === 'slot-bust' && b.radius === 3.5), 'the blast event, nothing left lit');
    assert(replays(stay.sim), 'replay');
    // Walks out when the idol lights (at once, 0.15 s or 0.4 s late): the hero's speed 4, the circle's edge 3.5 + his body.
    for (const [late, safe] of [[0, true], [0.15, true], [0.4, false]] as const) {
      const run = litBust(k), rw = run.sim.world, dir = inward(rw, run.idol);
      ticks(run.sim, tick(late), run.events);
      run.sim.command({ t: 'walk', x: dir.x, y: dir.y });
      const { blast: b } = toBlast(run.sim, run.events);
      assert(b.inside === !safe && bustHits(run.events).length === (safe ? 0 : 1) && rw.hero.hp === (safe ? 40 : 36), `seed ${k}, late ${late}: inside ${b.inside}, hp ${rw.hero.hp}`);
      assert(replays(run.sim), 'replay');
    }
  }
});

check('«Взрыв по площади»: invulnerability, the dash and the jump spare the hero inside the circle; the chain shield and «Щит фокуса» do not', () => {
  const [k] = bustSeeds(true, 1);
  type Guard = 'invulnerable' | 'jump' | 'dash' | 'shield' | 'focus';
  const lead: Record<Guard, number> = { invulnerable: 0.25, jump: 0.1, dash: 0.12, shield: 0.45, focus: 0.3 };
  const spares: Record<Guard, boolean> = { invulnerable: true, jump: true, dash: true, shield: false, focus: false };
  for (const guard of ['invulnerable', 'jump', 'dash', 'shield', 'focus'] as const) {
    const { sim, events } = litBust(k, { focusGuardLinks: 3 }), w = sim.world, h = w.hero;
    const b = w.blasts.find(x => x.bust)!;
    while (b.timeLeft > lead[guard] + 1e-9) ticks(sim, 1, events);
    const d = inward(w, h);
    if (guard === 'invulnerable') { sim.command({ t: 'param', key: 'contactDamage', value: 1 }); place(sim, h.x + 0.3, h.y, 0, { color: 1 }); }
    if (guard === 'shield') { const row = [1, 2, 3].map(i => place(sim, h.x + d.x * 0.9 * i, h.y + d.y * 0.9 * i)); draw(sim, row); sim.command({ t: 'release' }); }
    if (guard === 'dash') { const row = [1, 2, 3, 4, 5, 6].map(i => place(sim, h.x + d.x * 1.0 * i, h.y + d.y * 1.0 * i)); draw(sim, row); sim.command({ t: 'release' }); }
    if (guard === 'focus') draw(sim, [1, 2, 3].map(i => place(sim, h.x + d.x * 0.9 * i, h.y + d.y * 0.9 * i)));
    if (guard === 'jump') { sim.command({ t: 'energy', value: 7 }); assert(sim.command({ t: 'jump', x: h.x + d.x * 2, y: h.y + d.y * 2 }) === true, 'the jump starts'); }
    const { blast, before } = toBlast(sim, events);
    const stood = { invulnerable: before.inv > 0, jump: before.move === 'jump', dash: before.move === 'dash', shield: before.shield > 0 && !before.move, focus: before.focus }[guard];
    assert(stood, `${guard}: the guard stood in the tick before the blast (${JSON.stringify(before)})`);
    assert(blast.inside === true, `${guard}: the hero inside the circle`);
    if (spares[guard]) assert(blast.hurt === false && !bustHits(events).length && h.hp === before.hp, `${guard}: spared (${before.hp} → ${h.hp})`);
    else assert(blast.hurt === true && bustHits(events).length === 1 && h.hp === before.hp - 4, `${guard}: −4 through it (${before.hp} → ${h.hp})`);
    assert(replays(sim), `${guard}: replay`);
  }
});

check('«Взрыв по площади»: enemies in the circle take 3 — weak ones (HP ≤ 3) die as the player\'s kills, a tough 4 survives with 1 and is thrown off; one outside is untouched; the observer counts it', () => {
  const [k] = bustSeeds(true, 1);
  const { sim, events, idol } = litBust(k), w = sim.world, d = inward(w, idol), side = { x: -d.y, y: d.x };
  const at = (r: number, s = 0) => ({ x: idol.x + d.x * r + side.x * s, y: idol.y + d.y * r + side.y * s });
  const p1 = at(1.5), p2 = at(2.5, 0.6), p3 = at(3.2, -0.8), p4 = at(5.5);
  const weak = place(sim, p1.x, p1.y, 0), three = place(sim, p2.x, p2.y, 3), tough = place(sim, p3.x, p3.y, 4), far = place(sim, p4.x, p4.y, 0);
  const kills = w.stats.kills;
  toBlast(sim, events);
  const dead = of(events, 'kill').filter(e => e.source === 'slot-bust');
  assert(dead.length === 2 && dead.every(e => e.credited === true) && [weak.id, three.id].every(id => dead.some(e => e.enemyId === id)), `the weak die: ${JSON.stringify(dead)}`);
  assert(w.stats.kills === kills + 2, 'the player\'s kills');
  assert(w.enemies.includes(tough) && tough.hp === 1, `the tough survives with 1 (hp ${tough.hp})`);
  assert(Math.hypot(tough.x - idol.x, tough.y - idol.y) > Math.hypot(p3.x - idol.x, p3.y - idol.y) + 0.5, 'thrown off the blast');
  assert(w.enemies.includes(far) && near(far.x, p4.x) && near(far.y, p4.y), 'outside: untouched');
  assert(of(events, 'enemyHit').filter(e => e.source === 'slot-bust').length === 3, 'three hits of the blast');
  ticks(sim, tick(0.5));
  // The fight observer over the replay: the blast, the hero inside and hurt, its damage and kills.
  let observer: ReturnType<typeof createFightObserver> | null = null;
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  replay(journal, r => { observer ??= createFightObserver(r.world); observer.tick(r.world); });
  const s = observer!.summary();
  assert(s.slot.bustBlasts === 1 && s.slot.bustInside === 1 && s.slot.bustSpared === 0 && s.slot.bustDamage === 4 && s.slot.bustKills === 2 && s.kills.tools['slot-bust'] === 2, `the summary ${JSON.stringify(s.slot)}`);
  assert(s.slot.busts === 1 && s.slot.appearTime !== null, 'the bust and the appearance');
  // A record of an older build (no such fields) reads as «nothing happened».
  const older = withSummaryDefaults({ slot: { appeared: 1, busts: 1, bustDamage: 4 } }).slot;
  assert(older.appearTime === null && older.bustBlasts === 0 && older.bustInside === 0 && older.bustSpared === 0 && older.bustKills === 0 && older.bustDamage === 4, 'an old record');
  assert(replays(sim), 'replay');
});

check('«Взрыв по площади»: a chain into the lever plans what the dash does (the plan untouched); off — nothing is lit', () => {
  const sim = field(areaParams(), 21), w = sim.world;
  summon(sim); waitReady(sim);
  const row = rowTo(sim, 4, i => ({ hp: i === 2 ? 1 : 0 }));
  draw(sim, [...row, lever(sim)]);
  const plan = planChain(w);
  assert(plan.endsOnObject && plan.links.length === 5, 'the plan ends on the lever');
  sim.command({ t: 'release' });
  const events = settle(sim), hits = of(events, 'chainHit');
  const planned = plan.links.filter(l => l.outcome).map(l => ({ id: l.link.kind === 'enemy' ? l.link.id : -1, killed: l.outcome!.killed }));
  assert(JSON.stringify(planned) === JSON.stringify(hits.map(h => ({ id: h.enemyId, killed: h.killed }))), `plan ${JSON.stringify(planned)} vs dash ${JSON.stringify(hits.map(h => [h.enemyId, h.killed]))}`);
  assert(slotEvents(events, 'pull').length === 1, 'the dash pulled');
  // Off: no blast, no `lit` — a world without the rule has no bust blast in `world.blasts`.
  const old = field(bustParams({ slotSafePulls: 0 }), bustSeeds(true, 1)[0]);
  summon(old); waitReady(old); bareTo(old);
  const ev = playOut(old);
  assert(!old.world.blasts.length && !slotEvents(ev, 'lit').length, 'off: nothing lit');
});

check('«Взрыв по площади»: the risky line and the idol\'s caption say «в круге» — «взрыв 55 % · −4 HP в круге · иначе тройка»; without the key the old words', () => {
  for (const area of [true, false]) {
    const sim = field(areaParams({ slotBustArea: area }), 6), w = sim.world;
    summon(sim); waitReady(sim);
    const L = lever(sim), dir = inward(w, L);
    sim.command({ t: 'teleport', x: L.x + dir.x * 1.2, y: L.y + dir.y * 1.2 });
    sim.command({ t: 'begin', x: L.x, y: L.y });
    const odds = slotPlanOdds(w)!, risk = bustOdds(w)!;
    const tail = area ? ' в круге' : '';
    assert(odds.bust && JSON.stringify(odds.bust) === JSON.stringify(risk), `the plan reads the pull's numbers: ${JSON.stringify(odds.bust)}`);
    assert(slotOddsText(odds) === `взрыв 55 % · −4 HP${tail} · иначе тройка`, `area ${area}: the line «${slotOddsText(odds)}»`);
    assert(bustText(risk) === `взрыв 55 % · −4 HP${tail}`, `area ${area}: the caption «${bustText(risk)}»`);
  }
});

check('«Гоблин раньше» in a run battle: the goblin at 5 s of the fight before the goals, once; goals earlier — at goals + 3 s; the spot varies by seed; no roll without the kit or with the key at 0', () => {
  const p = rtRunParams(quiet());
  const appearAt = (sim: Simulation, limit: number, before?: (t: number) => void): number | null => {
    for (let i = 0; i < tick(limit); i++) {
      before?.(sim.world.time);
      if (slotEvents(ticks(sim, 1), 'appear').length) return sim.world.time;
    }
    return null;
  };
  const spots = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const sim = field(p, 4100 + k, 'slot-field', { slot: true }), w = sim.world;
    sim.command({ t: 'teleport', x: 10, y: 6 });
    const t = appearAt(sim, 8);
    assert(t !== null && Math.abs(t - 5) <= SIM_DT + 1e-9 && w.greedStart === null, `seed ${k}: at ${t} s, before the goals`);
    const g = goblinOf(w)!;
    const dh = Math.hypot(g.x - w.hero.x, g.y - w.hero.y);
    assert(dh >= 3 - 1e-6 && dh <= 7 + 1e-6 && lineOfSight(w.hero, g, w.arena, -w.params.sightSlack), `seed ${k}: the spot ${dh.toFixed(2)} from the hero, seen`);
    spots.add(`${g.x.toFixed(2)},${g.y.toFixed(2)}`);
    // The goals later bring no second goblin.
    sim.command({ t: 'goals' });
    const after = ticks(sim, tick(6));
    assert(!slotEvents(after, 'appear').length && w.objects.filter(o => o.kind === 'lever').length === 1 && goblinOf(w)?.id === g.id, `seed ${k}: one goblin a fight`);
    assert(replays(sim), 'replay');
  }
  assert(spots.size >= 6, `spots vary: ${[...spots].join(' ')}`);
  // Goals at 1 s: at 4 s (goals + 3 — earlier than 5); goals at 3 s: at 5 s.
  for (const [goals, want] of [[1, 4], [3, 5]] as const) {
    const sim = field(p, 4200 + goals, 'slot-field', { slot: true });
    let done = false;
    const t = appearAt(sim, 8, now => { if (!done && now + 1e-9 >= goals) { sim.command({ t: 'goals' }); done = true; } });
    assert(t !== null && Math.abs(t - want) <= 2 * SIM_DT, `goals at ${goals}: appeared at ${t} (want ${want})`);
    assert(!slotEvents(ticks(sim, tick(6)), 'appear').length, 'once');
    assert(replays(sim), 'replay');
  }
  // No kit (the sandbox): nothing at 5 s. The key at 0 with the kit: nothing before the goals (the old rule).
  const bare = field(p, 4301);
  assert(appearAt(bare, 7) === null && bare.world.slot === undefined, 'no kit: no roll');
  const zero = field({ ...p, slotAppearAt: 0 }, 4302, 'slot-field', { slot: true });
  assert(appearAt(zero, 7) === null && zero.world.slot === undefined, 'the key at 0: no roll before the goals');
});

console.log(`${checks} checks passed`);
