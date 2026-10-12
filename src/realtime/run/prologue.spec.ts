/**
 * The prologue «Опушка» (task 6, design 12.10.2026; docs/realtime-onboarding.md, «Пролог «Опушка»: правила комнат»). Node
 * only: `npm run test:realtime-prologue`.
 *
 * Every room is played with journal commands as the player would play it: `begin` on the first link, `sweep` from link to
 * link (the mouse path, with a few ticks of focus between), `release`, `walk`. What is checked is what the player meets:
 * - the ghost hand's chain (`prologueRoute`) is the chain the commands draw, its highlight (`planChain`) is the dash, and the
 *   dash meets the room's goal (the door opens);
 * - rooms 2 and 4: a chain shorter than N leaves the door shut, its lamps go out after the dash, and 1 s of game time later the
 *   start enemies stand at their posts with full HP (event `restore`) — not before; a chain being drawn makes it wait;
 * - room 3: the tough one struck first survives and is healed by the return; weak ones killed one by one come back;
 * - rooms 2–4: the return puts the hero back on his start too, and the hand's chain drawn from there wins; the spin (Q)
 *   starts a return as a dash does;
 * - room 1 has no return; room 5 returns only when no start enemy is left and the lever was never pulled;
 * - room 5: the hand's chain is the lever alone until the far ring walks in, then the enemies and the lever; the lever pulled
 *   meets the goal; three pulls, none risky, no bust (several seeds); standing still 10 s costs at most 3 HP; the skulls of one pull (rain ≤ 3,
 *   volley ≤ 1) cannot kill the hero from his 15 HP — by the numbers and on 60 seeds;
 * - rooms 1–4: the hero walking into the enemies loses no HP, the enemies stand; room 5 and 6: the enemies walk and hit;
 * - room 6: the inflow keeps at most 12, varies by seed, the start energy is one jump, the goblin stands from the start;
 * - every fight replays from its journal to the same hash (checkpoints every 300 ticks), twice.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { canJump, canLink, canLinkObject, linkPoint, planChain, type ChainPlan } from '../sim/chain';
import { worldState } from '../sim/hash';
import { Simulation, replay, type Journal } from '../sim/simulation';
import { goblinOf, leverReady } from '../sim/slot';
import { LAMPS_HOLD, RESTORE_DELAY, doorOpen, goalLamps, goalProgress, type ChainLink, type World, type WorldEvent } from '../sim/world';
import { arenaTemplate } from '../sim/arenas';
import { PROLOGUE_FORCED, PROLOGUE_ROOMS, prologueHandSpot, prologueLoadout, prologueParams, prologueRoom, prologueRoute, startEnemyIds } from './prologue';
import { RT_RUN_FORCED } from './rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** Room `n` on seed `k`, journalled, with its own numbers and loadout (as the view starts it). */
function room(n: number, k = 1): Simulation {
  const loadout = prologueLoadout(n);
  return new Simulation({ arena: prologueRoom(n).id, params: prologueParams(n), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
}

/** Ticks until `done` (at most `max`); returns the ticks run. */
function until(sim: Simulation, done: (w: World) => boolean, max = 60 * 30): number {
  for (let i = 0; i < max; i++) { if (done(sim.world)) return i; sim.tick(); }
  throw new Error(`not reached in ${max} ticks`);
}
/** Runs `seconds` of game time (hit-stop ticks do not count). */
function wait(sim: Simulation, seconds: number): void {
  const end = sim.world.time + seconds - 1e-9;
  until(sim, w => w.time >= end || w.status !== 'playing', Math.ceil(seconds * 60 * 8) + 60);
}

const sameLinks = (a: readonly ChainLink[], b: readonly ChainLink[]): boolean => a.length === b.length && a.every((l, i) => l.kind === b[i].kind && l.id === b[i].id);

/**
 * Draws `links` as the player would: the press on the first, then the pointer moves from link to link (`sweep` — the whole
 * path), with `pause` ticks of focus between moves. Returns the highlight of the drawn chain.
 */
function draw(sim: Simulation, links: readonly ChainLink[], pause = 2): ChainPlan {
  const w = sim.world;
  let at = linkPoint(w, links[0]);
  assert(at && sim.command({ t: 'begin', x: at.x, y: at.y }) === true, `the press on the first link ${JSON.stringify(links[0])}`);
  for (const link of links.slice(1)) {
    for (let i = 0; i < pause; i++) sim.tick();
    const to = linkPoint(w, link)!, from = linkPoint(w, w.chain[w.chain.length - 1]) ?? at!;
    sim.command({ t: 'sweep', fx: from.x, fy: from.y, x: to.x, y: to.y });
    at = to;
  }
  assert(sameLinks(w.chain, links), `drawn ${JSON.stringify(w.chain)}, wanted ${JSON.stringify(links)}`);
  return planChain(w);
}

/** Releases the drawn chain and runs the dash to its end; the events of the dash. */
function dash(sim: Simulation): WorldEvent[] {
  const from = sim.world.events.length;
  assert(sim.command({ t: 'release' }) === true, 'the release starts a dash');
  until(sim, w => !w.move || w.status !== 'playing', 60 * 20);
  return sim.world.events.slice(from);
}

/** The highlight is the dash: every enemy link's kill or survival as planned, the same kills. */
function planIsDash(plan: ChainPlan, events: readonly WorldEvent[], label: string): void {
  const hits = events.flatMap(e => e.type === 'chainHit' ? [e] : []);
  const planned = plan.links.flatMap(l => l.link.kind === 'enemy' && l.outcome ? [{ id: l.link.id, killed: l.outcome.killed }] : []);
  // The dash stops on a survivor: the plan's links after it are not struck (none in these rooms).
  assert(hits.length === planned.length && hits.every((h, i) => h.enemyId === planned[i].id && h.killed === planned[i].killed),
    `${label}: plan ${JSON.stringify(planned)} vs dash ${JSON.stringify(hits.map(h => ({ id: h.enemyId, killed: h.killed })))}`);
  const end = events.find(e => e.type === 'chainEnd');
  assert(end && end.type === 'chainEnd' && end.kills === plan.kills, `${label}: plan kills ${plan.kills}, dash ${JSON.stringify(end)}`);
}

/** The journal replays to the same hash, with the same hashes every 300 ticks — twice. */
function replays(sim: Simulation, label: string): void {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal())) as Journal;
  const marks = (): string[] => { const out: string[] = []; replay(journal, s => { if (s.world.tick % 300 === 0) out.push(s.hash()); }); return out; };
  const a = replay(journal), b = replay(JSON.parse(JSON.stringify(journal)) as Journal);
  assert(a.hash() === sim.hash() && b.hash() === sim.hash(), `${label}: replay ${a.hash()} / ${b.hash()} vs ${sim.hash()}`);
  assert(JSON.stringify(marks()) === JSON.stringify(marks()), `${label}: checkpoints`);
}

/** The start enemies at their posts with full HP (by the template), each once. */
function allAtPosts(w: World): boolean {
  const ids = startEnemyIds(w);
  return w.arena.enemies.every((s, i) => {
    const e = w.enemies.find(x => x.id === ids[i]);
    return !!e && Math.abs(e.x - s.x) < 1e-6 && Math.abs(e.y - s.y) < 1e-6 && e.hp === (s.hp ?? 0);
  }) && w.enemies.length === w.arena.enemies.length;
}
const restores = (w: World, from = 0): number => w.events.slice(from).filter(e => e.type === 'restore').length;

/**
 * Ticks to the next return and checks it in its own tick (a body put back on the hero's spot is parted from him by the next
 * tick): every start enemy at its post with full HP. Returns the game seconds it took.
 */
function awaitReturn(sim: Simulation, label: string, max = 4): number {
  const w = sim.world, mark = w.events.length, t0 = w.time;
  until(sim, x => restores(x, mark) > 0, 60 * max * 4);
  assert(allAtPosts(w), `${label}: all at their posts with full HP`);
  // Rooms 2–4 (`restoreHero`, design answer 12.10.2026): the hero is back on his start in the same return, the event says so.
  const event = w.events.slice(mark).find(e => e.type === 'restore');
  const start = w.arena.heroStart, home = w.hero.x === start.x && w.hero.y === start.y;
  if (w.arena.restoreHero) assert(home && event?.type === 'restore' && event.hero?.x === start.x && event.hero?.y === start.y, `${label}: the hero back on his start`);
  else assert(event?.type === 'restore' && !event.hero, `${label}: the hero stays`);
  return w.time - t0;
}

/** Walks the hero (the `walk` command) to `to`, stopping within `within`. */
function walkTo(sim: Simulation, to: { x: number; y: number }, within = 0.12): void {
  const w = sim.world;
  for (let i = 0; i < 60 * 10; i++) {
    const dx = to.x - w.hero.x, dy = to.y - w.hero.y, d = Math.hypot(dx, dy);
    if (d <= within) break;
    sim.command({ t: 'walk', x: dx / d, y: dy / d });
    sim.tick();
  }
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(Math.hypot(to.x - w.hero.x, to.y - w.hero.y) <= within + 0.1, `walked to ${JSON.stringify(to)}`);
}
/** The start enemies by index now (a dead one — undefined). */
const starts = (w: World): ChainLink[] => startEnemyIds(w).map(id => ({ kind: 'enemy' as const, id }));

// ---------------------------------------------------------------------------------------------------------------------

check('the rooms: six, in order, ids prologue-1 … prologue-6, titles; numbers — the run\'s RT_RUN_FORCED with existing keys over it; rooms 1–5 no inflow; room 5 three safe pulls; room 6 up to 12', () => {
  assert(PROLOGUE_ROOMS.map(r => r.title).join(',') === 'Тропа,Два цвета,Крепкий,Радуга,Гоблин,Толпа', 'titles');
  assert(PROLOGUE_ROOMS.every((r, i) => r.number === i + 1 && r.id === `prologue-${i + 1}` && arenaTemplate(r.id) === r.arena), 'ids, registered');
  for (const r of PROLOGUE_ROOMS) {
    const p = prologueParams(r.number);
    for (const [key, value] of Object.entries(RT_RUN_FORCED)) if (!(key in r.forced)) assert(JSON.stringify(p[key as keyof typeof p]) === JSON.stringify(value), `${r.id}: ${key} is the run's`);
    for (const [key, value] of Object.entries(r.forced)) assert(p[key as keyof typeof p] === value, `${r.id}: ${key}`);
    assert(Object.keys(r.forced).every(key => key in p), `${r.id}: only existing keys`);
  }
  assert(PROLOGUE_FORCED.slice(0, 5).every(f => f.maxEnemies === 0) && PROLOGUE_FORCED[5].maxEnemies === 12, 'inflow');
  const p5 = prologueParams(5);
  assert(p5.slot && p5.slotBust && p5.slotPulls === 3 && p5.slotSafePulls === 3 && p5.slotSafePerLongChain === 0 && p5.contactDamage === 1, 'room 5 numbers');
  assert(Math.abs(p5.enemySpeed - prologueParams(4).enemySpeed * 0.6) < 1e-9 && PROLOGUE_ROOMS[4].arena.enemies.length === 6 && PROLOGUE_ROOMS[4].arena.sleepUntilChain, 'room 5: six enemies, asleep until the first press, ×0.6 the run\'s pace');
  assert(p5.invulnerability === 3.4 && p5.invulnerabilityMode === 'constant', 'room 5: 3.4 s after a hit');
  assert(PROLOGUE_ROOMS.slice(0, 4).every(r => r.arena.calm) && !PROLOGUE_ROOMS[4].arena.calm && !PROLOGUE_ROOMS[5].arena.calm, 'calm rooms 1–4');
  assert(PROLOGUE_ROOMS.map(r => r.arena.restore).join(',') === 'none,afterDash,afterDash,afterDash,whenGone,none', 'return by room');
  // The start enemies' ids are kept by every room (`World.restore`), the same as the enemies standing on the posts at the start.
  for (const r of PROLOGUE_ROOMS) {
    const w = room(r.number).world, ids = startEnemyIds(w);
    assert(ids.length === r.arena.enemies.length && r.arena.enemies.every((s, i) => { const e = w.enemies.find(x => x.id === ids[i]); return e && e.x === s.x && e.y === s.y && e.color === s.color; }), `${r.id}: start ids`);
  }
  // Start energy: the price of one jump in that world, instead of the loadout's.
  const rich = new Simulation({ arena: 'prologue-6', params: { ...prologueParams(6), jumpCost: 3 }, seed: seedOf(1), loadout: { ...prologueLoadout(6), energy: 6 } });
  assert(rich.world.energy === 3, `start energy ${rich.world.energy}`);
});

check('rooms 1–5: the ghost hand\'s chain, drawn by the commands, is the drawn chain; its highlight is the dash; the dash meets the goal and opens the door (seeds 1–3)', () => {
  for (const r of PROLOGUE_ROOMS.slice(0, 5)) for (const k of [1, 2, 3]) {
    const sim = room(r.number, k), w = sim.world, label = `${r.id} seed ${k}`;
    const route = prologueRoute(w, r.number);
    // Room 5: the four blue round the goblin, then the lever (the reds are another colour).
    assert(r.number === 5 ? route.length === 5 && route[4].kind === 'object' : route.length === r.route!.length, `${label}: the route on the arena`);
    const hand = planChain(w, route);
    const plan = draw(sim, route);
    assert(JSON.stringify(plan.links) === JSON.stringify(hand.links) && plan.kills === hand.kills, `${label}: the hand's highlight is the drawn one`);
    assert(!doorOpen(w) && goalLamps(w).lit === 0, `${label}: the door shut before`);
    const events = dash(sim);
    planIsDash(plan, events, label);
    assert(doorOpen(w) && events.some(e => e.type === 'goals'), `${label}: the goal is met, the door opens (${JSON.stringify(goalProgress(w))})`);
    const lamps = goalLamps(w);
    assert(lamps.lit === lamps.total && lamps.total === (r.arena.goal === 'marked' ? 1 : r.arena.killGoal), `${label}: all lamps (${JSON.stringify(lamps)})`);
    if (r.number === 4) assert(events.some(e => e.type === 'colorShift'), `${label}: through the colour shift`);
    if (r.number === 5) assert(events.some(e => e.type === 'slot' && e.action === 'pull'), `${label}: ends on the lever`);
    wait(sim, 2);
    assert(restores(w) === 0, `${label}: no return after the goal`);
    replays(sim, label);
  }
});

check('the hand when it shows (4 s without a press; from the start, or after a short chain — rooms 2–4: the return put the hero on his start, rooms 1 and 5: where the dash left him; seeds 1–4): its chain, drawn by the commands, is the drawn chain, the highlight is the dash; rooms 2–5 meet the goal. A hero standing where no chain can start gets no hand (empty route): the next check', () => {
  let shown = 0, none = 0;
  for (const r of PROLOGUE_ROOMS.slice(0, 5)) for (const k of [1, 2, 3, 4]) for (const before of ['fresh', 'short'] as const) {
    const sim = room(r.number, k), w = sim.world, label = `${r.id} seed ${k} ${before}`;
    if (before === 'short') { draw(sim, prologueRoute(w, r.number).slice(0, r.number === 5 ? 3 : 2)); dash(sim); }
    // The hand shows after 4 s without a press: the enemies of room 5 walked in meanwhile, the return of rooms 2–4 came.
    wait(sim, 4);
    if (w.status !== 'playing' || doorOpen(w)) continue;
    const route = prologueRoute(w, r.number);
    if (!route.length) { none++; assert(r.number === 5, `${label}: rooms 1–4 have a hand in these starts`); continue; }
    shown++;
    const hand = planChain(w, route), plan = draw(sim, route);
    assert(JSON.stringify(plan.links) === JSON.stringify(hand.links), `${label}: the hand's highlight is the drawn one`);
    const events = dash(sim);
    planIsDash(plan, events, label);
    if (r.number >= 2) assert(doorOpen(w), `${label}: the goal is met (${JSON.stringify(goalProgress(w))})`);
    if (r.number === 5) assert(route[route.length - 1].kind === 'object' && events.some(e => e.type === 'slot' && e.action === 'pull'), `${label}: ends on the lever`);
    replays(sim, label);
  }
  console.log(`   ${shown} hands drawn and played, ${none} rooms without a hand`);
});

check('no hand from where the hero walked: the spot the view points to (`prologueHandSpot`) is found, walked to by the commands, and from there the hand\'s chain is drawn by the commands and does what the room needs (rooms 1–5, seeds 1–3); the call changes nothing', () => {
  let tried = 0, slowest = 0, total = 0, calls = 0;
  for (const r of PROLOGUE_ROOMS.slice(0, 5)) for (const k of [1, 2, 3]) {
    const sim = room(r.number, k), w = sim.world, label = `${r.id} seed ${k}`;
    // Walk into a corner the hand has no chain from (the first such corner; room 5's enemies sleep through the walk).
    const corners = [{ x: w.arena.width - 0.9, y: w.arena.height - 0.9 }, { x: w.arena.width - 0.9, y: 0.9 }, { x: 0.9, y: w.arena.height - 0.9 }, { x: 0.9, y: 0.9 }];
    let found = false;
    for (const c of corners) {
      for (let i = 0; i < 60 * 6 && Math.hypot(c.x - w.hero.x, c.y - w.hero.y) > 0.15; i++) {
        const dx = c.x - w.hero.x, dy = c.y - w.hero.y, d = Math.hypot(dx, dy);
        sim.command({ t: 'walk', x: dx / d, y: dy / d });
        sim.tick();
      }
      sim.command({ t: 'walk', x: 0, y: 0 });
      if (!prologueRoute(w, r.number).length) { found = true; break; }
    }
    if (!found) continue;
    tried++;
    const before = sim.hash(), t0 = performance.now();
    const spot = prologueHandSpot(w, r.number)!;
    const ms = performance.now() - t0;
    slowest = Math.max(slowest, ms); total += ms; calls++;
    assert(spot && sim.hash() === before && prologueRoute(w, r.number).length === 0, `${label}: a spot, the world unchanged`);
    walkTo(sim, spot, 0.05);
    const route = prologueRoute(w, r.number);
    assert(route.length > 0 && prologueHandSpot(w, r.number) === null, `${label}: from the spot the hand has a chain`);
    const plan = draw(sim, route), events = dash(sim);
    planIsDash(plan, events, label);
    if (r.number >= 2) assert(doorOpen(w), `${label}: the goal is met from the spot`);
    else assert(plan.kills === route.length, `${label}: the chain kills what it takes`);
    replays(sim, `${label} spot`);
  }
  assert(tried >= 10, `rooms with a hero out of the hand's reach: ${tried}`);
  console.log(`   ${tried} heroes out of reach led back; prologueHandSpot ${(total / calls).toFixed(2)} ms on average, ${slowest.toFixed(2)} ms at most`);
});

check('the lamps of «N by one chain»: they burn by the kills of the dash going now, all at its N-th kill; a short one goes out at its end (rooms 2 and 4)', () => {
  for (const n of [2, 4]) {
    const sim = room(n), w = sim.world, N = prologueRoom(n).arena.killGoal!;
    const route = prologueRoute(w, n);
    draw(sim, route.slice(0, N - 1));
    assert(goalLamps(w).lit === 0, 'out while drawn');
    sim.command({ t: 'release' });
    let max = 0;
    until(sim, x => { max = Math.max(max, goalLamps(x).lit); if (x.move) assert(goalLamps(x).lit === Math.min(N, x.move.kills), 'lit = the dash\'s kills'); return !x.move; });
    // The last kill and the end fall in one tick: the lamps hold the dash's count a moment, then go out.
    assert(goalLamps(w).lit === N - 1 && goalLamps(w).total === N && !doorOpen(w), `room ${n}: ${N - 1} burn at the end (${goalLamps(w).lit}, max ${max})`);
    wait(sim, LAMPS_HOLD);
    assert(goalLamps(w).lit === 0 && !doorOpen(w), `room ${n}: then out`);
    awaitReturn(sim, `room ${n}`);
    // The hand's chain from where the return put the hero.
    draw(sim, prologueRoute(w, n));
    const events = dash(sim), goals = events.findIndex(e => e.type === 'goals');
    const killsBefore = events.slice(0, goals).filter(e => e.type === 'kill').length;
    assert(goals >= 0 && killsBefore === N && events.findIndex(e => e.type === 'chainEnd') > goals && goalLamps(w).lit === N,
      `room ${n}: the door opens at the N-th kill of the dash (${killsBefore})`);
  }
});

check('rooms 2 and 4: a chain shorter than N keeps the door shut; 1 s of game time after the dash the start enemies stand at their posts with full HP and the hero on his start (not before); a chain drawn then waits for its end; the hand\'s chain from there wins', () => {
  for (const n of [2, 4]) for (const k of [1, 2]) {
    const sim = room(n, k), w = sim.world, N = prologueRoom(n).arena.killGoal!, label = `room ${n} seed ${k}`;
    const route = prologueRoute(w, n);
    draw(sim, route.slice(0, N - 3));
    dash(sim);
    assert(!doorOpen(w) && w.stats.bestChain === N - 3 && w.enemies.length === w.arena.enemies.length - (N - 3), `${label}: short chain, door shut`);
    const took = awaitReturn(sim, label);
    assert(took >= RESTORE_DELAY - 1e-6 && took <= RESTORE_DELAY + 0.05 && !doorOpen(w), `${label}: the return after ${took.toFixed(3)} s`);
    // A short chain again (the hero stands on his start); a chain drawn before its return is due — the return waits for that
    // chain, and the count starts anew at the end of its dash: 1 s after the LAST dash.
    draw(sim, prologueRoute(w, n).slice(0, 2));
    dash(sim);
    wait(sim, 0.5);
    const mark = w.events.length, nearest = w.enemies.reduce((a, b) => Math.hypot(b.x - w.hero.x, b.y - w.hero.y) < Math.hypot(a.x - w.hero.x, a.y - w.hero.y) ? b : a);
    draw(sim, [{ kind: 'enemy', id: nearest.id }]);
    wait(sim, RESTORE_DELAY);
    assert(restores(w, mark) === 0 && w.chain.length === 1, `${label}: no return while a chain is drawn`);
    dash(sim);
    const again = awaitReturn(sim, `${label}, after that chain`, 2);
    assert(again >= RESTORE_DELAY - 1e-6 && again <= RESTORE_DELAY + 0.05, `${label}: the count starts anew at the end of the last dash (${again.toFixed(3)} s)`);
    // The room is won by the hand's chain drawn from where the return put the hero (no walk).
    draw(sim, prologueRoute(w, n));
    dash(sim);
    assert(doorOpen(w), `${label}: won after the returns`);
    replays(sim, label);
  }
});

check('room 2: the reds alone (4 by one chain) never meet «5 by one chain»; the return brings them back', () => {
  const sim = room(2), w = sim.world, reds = starts(w).slice(5);
  draw(sim, reds);
  const events = dash(sim);
  assert(events.filter(e => e.type === 'kill').length === 4 && !doorOpen(w), 'four reds die, the door stays shut');
  awaitReturn(sim, 'the reds are back');
});

check('room 3: the tough one struck first survives (4 → 3) and the return heals it; weak ones killed one by one come back; then weak, weak, weak, tough wins', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(3, k), w = sim.world, label = `seed ${k}`;
    const [w0, w1, w2, tough] = starts(w);
    // Walk up to the tough one (it is far from the start), then take it alone.
    sim.command({ t: 'walk', x: 1, y: 0 });
    until(sim, x => x.hero.x >= 6.6, 60 * 5);
    sim.command({ t: 'walk', x: 0, y: 0 });
    const plan = draw(sim, [tough]);
    assert(plan.kills === 0 && plan.endsOnSurvivor, `${label}: the highlight says it survives`);
    const events = dash(sim);
    planIsDash(plan, events, label);
    const t = w.enemies.find(e => e.id === tough.id)!;
    assert(t && t.hp === 3 && !doorOpen(w), `${label}: the tough one lives with 3 HP (${t?.hp})`);
    awaitReturn(sim, `${label}: healed and back`);
    assert(w.enemies.find(e => e.id === tough.id)!.hp === 4, `${label}: the same tough one, 4 HP`);
    // Weak ones one by one (the one nearest the hero each time): each short chain brings the room back.
    for (let i = 0; i < 2; i++) {
      const weak = starts(w).slice(0, 3), at = (l: ChainLink): number => { const p = linkPoint(w, l)!; return Math.hypot(p.x - w.hero.x, p.y - w.hero.y); };
      const link = weak.reduce((a, b) => at(b) < at(a) ? b : a);
      draw(sim, [link]);
      dash(sim);
      assert(w.enemies.length === 3 && !doorOpen(w), `${label}: one weak dead`);
      awaitReturn(sim, `${label}: the weak ones are back`);
    }
    assert(w0 && w1, 'weak ones');
    // The hand's chain from where the return put the hero (his start).
    const win = draw(sim, prologueRoute(w, 3));
    planIsDash(win, dash(sim), label);
    assert(doorOpen(w) && w.stats.markedKills === 1 && w2, `${label}: the tough one dies last, the door opens`);
    replays(sim, `room 3 ${label}`);
  }
});

check('room 3: every chain the player can draw into the tough one — from the start, after a return, and after walking up to its first link — kills it only when it is the full one (three weak, then the tough); a shorter one leaves it alive; the highlight is the dash (seeds 1–3)', () => {
  const weak = [0, 1, 2], orders: number[][] = [[]];
  for (const a of weak) { orders.push([a]); for (const b of weak) if (b !== a) { orders.push([a, b]); for (const c of weak) if (c !== a && c !== b) orders.push([a, b, c]); } }
  let drawable = 0, full = 0;
  for (const k of [1, 2, 3]) for (const from of ['start', 'return', 'walk'] as const) for (const order of orders) {
    const sim = room(3, k), w = sim.world, label = `seed ${k} ${from} ${order.join('-')}→T`;
    if (from === 'return') {
      // A weak one killed alone, the return (the hero back on his start).
      draw(sim, [starts(w)[0]]);
      dash(sim);
      awaitReturn(sim, label);
    }
    const ids = starts(w), links = [...order.map(i => ids[i]), ids[3]];
    // The hero walks up to the chain's first link (from its side away from the rest of the path).
    if (from === 'walk') { const p = linkPoint(w, links[0])!; walkTo(sim, { x: p.x, y: p.y + 1.2 }, 0.05); }
    // Drawn as the player would: the press on the first, the pointer from link to link; not this chain — not drawable here.
    let at = linkPoint(w, links[0])!;
    if (sim.command({ t: 'begin', x: at.x, y: at.y }) !== true) continue;
    for (const link of links.slice(1)) {
      sim.tick(); sim.tick();
      const to = linkPoint(w, link)!;
      sim.command({ t: 'sweep', fx: at.x, fy: at.y, x: to.x, y: to.y });
      at = to;
    }
    if (!sameLinks(w.chain, links)) { sim.command({ t: 'cancel' }); continue; }
    drawable++;
    const plan = planChain(w), last = plan.links[plan.links.length - 1];
    const kills = order.length === 3;
    assert(last.outcome && last.outcome.killed === kills, `${label}: the highlight says the tough one ${kills ? 'dies' : 'survives'}`);
    const events = dash(sim);
    planIsDash(plan, events, label);
    const tough = w.enemies.find(e => e.id === ids[3].id);
    if (kills) { full++; assert(!tough && doorOpen(w), `${label}: the full chain kills it, the door opens`); }
    else assert(tough && tough.hp === 4 - (order.length + 1) && !doorOpen(w), `${label}: it survives (${tough?.hp} HP)`);
  }
  assert(full >= 6 && drawable - full >= 9, `drawable chains into the tough one: ${drawable}, full ones: ${full}`);
  console.log(`   ${drawable} chains into the tough one drawn by the commands, ${full} full ones killed it, the rest left it alive`);
});

check('room 1: no return — a kill stays a kill (3 s later the arena holds 2); three single chains win it too', () => {
  const sim = room(1), w = sim.world;
  assert(w.restore && w.arena.restore === 'none', 'the ids are kept, no return');
  const [a, b, c] = starts(w);
  draw(sim, [a]);
  dash(sim);
  wait(sim, 3);
  assert(w.enemies.length === 2 && restores(w) === 0 && !doorOpen(w), 'one dead, no return');
  for (const link of [b, c]) {
    // Walk next to it (within the reach of a first link), then take it alone.
    walkTo(sim, linkPoint(w, link)!, 1.4);
    draw(sim, [link]);
    dash(sim);
  }
  assert(doorOpen(w) && w.stats.kills === 3, 'kill 3 by any chains');
  replays(sim, 'room 1');
});

check('rooms 1–4 are calm: the hero walking onto every enemy and standing among them loses no HP, takes no hit; the enemies hold their posts', () => {
  for (const n of [1, 2, 3, 4]) {
    const sim = room(n), w = sim.world, hp = w.hero.hp;
    // Onto every enemy in turn (the walk stands on its post a moment), then stand among them.
    for (const e of [...w.enemies]) { walkTo(sim, e, 0.05); wait(sim, 0.5); }
    wait(sim, 2);
    assert(w.hero.hp === hp && w.stats.hitsTaken === 0 && w.stats.damageTaken === 0, `room ${n}: HP ${w.hero.hp} of ${hp}`);
    // The enemies hold their posts: no walk to the hero, no parting by his walk through them.
    assert(allAtPosts(w), `room ${n}: every enemy at its post`);
  }
});

/** Room 5: chains of one enemy (the nearest, once it is in reach), never ending on the lever, until `left` start enemies remain. */
function killDownTo(sim: Simulation, left: number): void {
  until(sim, x => {
    if (x.enemies.length <= left) return !x.move && !x.chain.length;
    if (x.move || x.chain.length) return false;
    // The press only on an enemy the chain takes now (a press on one passing over the lever out of reach would pull the lever).
    const e = x.enemies.reduce((a, b) => Math.hypot(b.x - x.hero.x, b.y - x.hero.y) < Math.hypot(a.x - x.hero.x, a.y - x.hero.y) ? b : a);
    if (!canLink(x, e)) return false;
    sim.command({ t: 'begin', x: e.x, y: e.y });
    assert(x.chain.length === 1 && x.chain[0].kind === 'enemy', 'a chain of one enemy');
    sim.command({ t: 'release' });
    return false;
  }, 60 * 40);
}

/**
 * Room 5: the lever alone once more, as a player would: the enemies left are killed by chains first (they walk in), the hero
 * walks back next to the lever, its cooldown and spin over — the press on it, the release.
 */
function pullAgain(sim: Simulation): void {
  const w = sim.world;
  killDownTo(sim, 0);
  walkTo(sim, goblinOf(w)!, 1.2);
  until(sim, x => !goblinOf(x)!.spin && x.time >= goblinOf(x)!.ready && !x.move, 60 * 10);
  draw(sim, [{ kind: 'object', id: goblinOf(w)!.id }]);
}

check('room 5: the enemies sleep until the first press — 10 s without one: HP 15, everybody on the posts; the hand at that moment is 4 blue → the lever, drawn by the commands (the press wakes them), it meets the goal; three pulls, none risky, no bust (seeds 1–5)', () => {
  for (let k = 1; k <= 5; k++) {
    const sim = room(5, k), w = sim.world, label = `seed ${k}`;
    assert(goblinOf(w) && w.slot?.goblin?.pulls === 0 && w.asleep, `${label}: the goblin stands, the enemies sleep`);
    // Walking about does not wake them either (only a press does).
    walkTo(sim, { x: 2, y: 6.5 }, 0.1);
    walkTo(sim, w.arena.heroStart, 0.05);
    wait(sim, 10);
    assert(w.hero.hp === 15 && w.asleep && allAtPosts(w), `${label}: 10 s asleep — HP ${w.hero.hp}, on the posts`);
    const route = prologueRoute(w, 5);
    assert(route.length === 5 && route.slice(0, 4).every(l => l.kind === 'enemy') && route[4].kind === 'object', `${label}: the hand is 4 enemies → the lever`);
    const plan = draw(sim, route);
    assert(!w.asleep, `${label}: the press woke them`);
    const events = dash(sim);
    planIsDash(plan, events, label);
    assert(doorOpen(w) && goblinOf(w)!.pulls === 1 && plan.kills === 4, `${label}: the pull meets the goal`);
    // Two more pulls: the lever alone (the reds killed first, back to the lever, its cooldown and spin over).
    for (const pull of [2, 3]) {
      pullAgain(sim);
      dash(sim);
      assert(goblinOf(w)!.pulls === pull, `${label}: pull ${pull}`);
    }
    wait(sim, 3);
    const pulls = w.events.filter(e => e.type === 'slot' && e.action === 'pull');
    assert(pulls.length === 3 && pulls.every(e => e.type === 'slot' && e.risky === false && e.bust === false && e.outcome !== 'bust'), `${label}: ${JSON.stringify(pulls.map(e => e.type === 'slot' && [e.risky, e.outcome]))}`);
    assert(goblinOf(w) && !w.events.some(e => e.type === 'hit' && e.source === 'slot-bust'), `${label}: the goblin is whole`);
    replays(sim, `room 5 ${label}`);
  }
});

check('room 5: the hand never shows the lever alone (that chain still pulls it) — with no enemy chain into the lever, no hand', () => {
  const sim = room(5, 2), w = sim.world;
  // Every enemy by single chains: none left (the return comes 1 s later) — no enemy chain into the lever, no hand.
  killDownTo(sim, 0);
  assert(!w.enemies.length && prologueRoute(w, 5).length === 0, 'no hand without enemies');
  // The lever alone is still a chain that pulls it (the return may have come meanwhile: the enemies are awake).
  walkTo(sim, goblinOf(w)!, 1.2);
  const lever = { kind: 'object' as const, id: goblinOf(w)!.id };
  assert(canLinkObject(w, w.objects.find(o => o.id === lever.id)!), 'the lever alone is a chain');
  draw(sim, [lever]);
  dash(sim);
  assert(goblinOf(w)!.pulls === 1 && doorOpen(w), 'the lever alone pulls it, as in the run');
});

check('room 5 (design answer 12.10.2026): from the waking press 10 s without actions cost at most 3 HP of 15 — the enemies walk at ×0.6, touch for 1, 3.4 s after each hit (seeds 1–10)', () => {
  const lost: number[] = [];
  for (let k = 1; k <= 10; k++) {
    const sim = room(5, k), w = sim.world;
    // The press wakes them; the chain is let go without a dash (the right button).
    const first = linkPoint(w, starts(w)[0])!;
    sim.command({ t: 'begin', x: first.x, y: first.y });
    sim.command({ t: 'cancel' });
    assert(!w.asleep && !w.move, `seed ${k}: awake, no dash`);
    wait(sim, 10);
    lost.push(15 - w.hero.hp);
    assert(w.status === 'playing' && 15 - w.hero.hp <= 3 && w.stats.hitsTaken > 0 && w.events.every(e => e.type !== 'hit' || e.damage === 1), `seed ${k}: lost ${15 - w.hero.hp}`);
  }
  console.log(`   HP lost in 10 s from the waking press: ${Math.min(...lost)}…${Math.max(...lost)}`);
});

check('room 5: after a return the enemies stay awake (they sleep once, until the first press)', () => {
  const sim = room(5, 3), w = sim.world, mark = w.events.length;
  killDownTo(sim, 0);
  until(sim, x => restores(x, mark) > 0, 60 * 3);
  assert(!w.asleep && w.enemies.length > 0, 'awake after the return');
  const before = w.enemies.map(e => `${e.x},${e.y}`).join(';');
  wait(sim, 1);
  assert(w.enemies.map(e => `${e.x},${e.y}`).join(';') !== before, 'they walk');
});

check('room 5: the return only when no start enemy is left and the lever was never pulled', () => {
  const sim = room(5, 4), w = sim.world;
  // Half the ring by single chains (none ends on the lever): no return while some are left.
  killDownTo(sim, 3);
  wait(sim, 2);
  assert(restores(w) === 0 && w.enemies.length === 3, 'some left — no return');
  // The rest: none left, no pull — the return after 1 s.
  killDownTo(sim, 0);
  const took = awaitReturn(sim, 'the ring is back');
  assert(took >= RESTORE_DELAY - 0.05, `the ring is back after ${took.toFixed(3)} s`);
  assert(!w.events.some(e => e.type === 'spawn'), 'the return sends no `spawn` events — only `restore`');
  // A pull, then none left: no return.
  const sim2 = room(5, 4), w2 = sim2.world;
  draw(sim2, prologueRoute(w2, 5));
  dash(sim2);
  assert(goblinOf(w2)!.pulls === 1, 'pulled');
  killDownTo(sim2, 0);
  wait(sim2, 3);
  assert(w2.enemies.length === 0 && restores(w2) === 0, 'after a pull — no return');
  replays(sim, 'room 5 return');
});

check('room 5: a post under the hero waits until he steps off it; the others come at once; no `spawn` events (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(5, k), w = sim.world, label = `seed ${k}`;
    // To the ring first (the fight happens by the posts), then the whole ring by chains, not ending on the lever.
    walkTo(sim, w.arena.enemies[0], 1.5);
    killDownTo(sim, 0);
    // Onto the nearest post before the return is due.
    const posts = w.arena.enemies, near = posts.reduce((a, b) => Math.hypot(b.x - w.hero.x, b.y - w.hero.y) < Math.hypot(a.x - w.hero.x, a.y - w.hero.y) ? b : a);
    const mark = w.events.length;
    walkTo(sim, near, 0.05);
    assert(restores(w, mark) === 0, `${label}: on the post before the return`);
    until(sim, x => restores(x, mark) > 0, 60 * 3);
    const first = w.events.slice(mark).find(e => e.type === 'restore');
    assert(first?.type === 'restore' && first.enemies.length === posts.length - 1 && w.restore?.wait?.length === 1, `${label}: five come, one waits`);
    assert(!w.enemies.some(e => Math.hypot(e.x - w.hero.x, e.y - w.hero.y) < 0.6), `${label}: nobody on the hero`);
    wait(sim, 1);
    assert(restores(w, mark) === 1, `${label}: still waits while he stands there`);
    walkTo(sim, { x: w.hero.x, y: w.hero.y - 1.5 }, 0.05);
    until(sim, x => restores(x, mark) > 1, 60);
    assert(!w.restore?.wait && w.enemies.length === posts.length && !w.events.slice(mark).some(e => e.type === 'spawn'), `${label}: the last one comes when he steps off; no spawn events`);
    replays(sim, `room 5 waiting post ${label}`);
  }
});

check('room 5: a late post waits for the end of a dash too — the hero dashes off the post: no return during the dash, the post comes after it (seeds 1–5)', () => {
  for (let k = 1; k <= 5; k++) {
    const sim = room(5, k), w = sim.world, label = `seed ${k}`;
    walkTo(sim, w.arena.enemies[0], 1.5);
    killDownTo(sim, 0);
    const posts = w.arena.enemies, near = posts.reduce((a, b) => Math.hypot(b.x - w.hero.x, b.y - w.hero.y) < Math.hypot(a.x - w.hero.x, a.y - w.hero.y) ? b : a);
    const mark = w.events.length;
    walkTo(sim, near, 0.05);
    until(sim, x => restores(x, mark) > 0, 60 * 3);
    assert(w.restore?.wait?.length === 1, `${label}: one post waits`);
    // A dash off the post: the nearest enemy the chain takes now.
    until(sim, x => x.enemies.some(e => canLink(x, e) && Math.hypot(e.x - x.hero.x, e.y - x.hero.y) > 0.6), 60 * 3);
    const e = w.enemies.filter(x => canLink(w, x) && Math.hypot(x.x - w.hero.x, x.y - w.hero.y) > 0.6)[0];
    draw(sim, [{ kind: 'enemy', id: e.id }]);
    const during = w.events.length;
    sim.command({ t: 'release' });
    let duringDash = 0;
    until(sim, x => { if (x.move) duringDash = restores(x, during); return !x.move; }, 60 * 5);
    assert(duringDash === 0, `${label}: no return during the dash`);
    until(sim, x => restores(x, during) > 0, 60 * 3);
    assert(!w.move && !w.restore?.wait, `${label}: the late post came after the dash`);
    replays(sim, `room 5 late post ${label}`);
  }
});

check('room 6: start energy = one jump; the goblin stands from the start (its lever a target at once); the enemies walk and hit; the inflow keeps at most 12 and varies by seed', () => {
  const hashes = new Set<string>(), spawns = new Set<string>();
  let hit = 0;
  for (let k = 1; k <= 4; k++) {
    const sim = room(6, k), w = sim.world;
    assert(w.energy === w.params.jumpCost && canJump(w) && !w.arena.calm, `seed ${k}: energy ${w.energy}`);
    const g = goblinOf(w);
    assert(g && g.x === w.arena.goblin!.x && g.y === w.arena.goblin!.y && g.pulls === 0 && leverReady(w, w.objects.find(o => o.id === g.id)!), `seed ${k}: the goblin from the start`);
    // The hero stands: the crowd walks in and hits (he may fall — the room then starts again in the view).
    let max = 0;
    for (let i = 0; i < 60 * 12 && w.status === 'playing'; i++) { sim.tick(); max = Math.max(max, w.enemies.length + w.markers.length); }
    assert(max <= 12 && max > 8, `seed ${k}: the inflow, at most 12 (${max})`);
    hashes.add(sim.hash());
    spawns.add(JSON.stringify(w.events.filter(e => e.type === 'spawn').map(e => e.type === 'spawn' && e.enemyId)));
    if (w.stats.hitsTaken > 0) hit++;
    // No second goblin: the battle never rolls (its slot stands from the start).
    assert(goblinOf(w)?.id === g.id && !w.events.some(e => e.type === 'slot' && e.action === 'appear'), `seed ${k}: the same goblin`);
    replays(sim, `room 6 seed ${k}`);
  }
  assert(hashes.size === 4 && spawns.size >= 2, `the seeds differ (${hashes.size} worlds, ${spawns.size} inflows)`);
  assert(hit > 0, 'the enemies hit the hero');
});

check('the spin (Q) starts the return too: energy earned by chains, the spin kills the enemies next to the hero, 1 s later the room is back (room 2)', () => {
  const sim = room(2), w = sim.world, all = starts(w);
  // Energy from the chains (+0.5 per enemy link struck): four reds, then two blues — 3, the spin's price; each comes back.
  draw(sim, all.slice(5));
  dash(sim);
  awaitReturn(sim, 'after the reds');
  draw(sim, starts(w).slice(0, 2));
  dash(sim);
  awaitReturn(sim, 'after two blues');
  assert(w.energy >= w.params.spinCost, `energy ${w.energy}`);
  // A step to the first blue, then Q: no dash at all.
  walkTo(sim, { x: 2.8, y: 4 }, 0.05);
  const mark = w.events.length;
  assert(sim.command({ t: 'spin' }) === true, 'the spin');
  const killed = w.events.slice(mark).filter(e => e.type === 'kill').length;
  assert(killed >= 1 && !w.move && w.chain.length === 0, `the spin killed ${killed}`);
  const took = awaitReturn(sim, 'after the spin');
  assert(took >= RESTORE_DELAY - 1e-6 && took <= RESTORE_DELAY + 0.05 && !doorOpen(w), `the return ${took.toFixed(3)} s after the spin`);
  replays(sim, 'room 2 spin');
});

check('room 5: the skulls (rain, volley) of one pull cannot kill the hero from full HP — numbers (HP 15; the rain ≤ 1 with 3.4 s after a hit, the volley ≤ 1) and real pulls on many seeds', () => {
  const p = prologueParams(5);
  // One wave's marks land in one tick: the first hit's invulnerability spares the rest; the waves come `slotRainStep` apart — a
  // wave hits only when the invulnerability of the last hit is over (room 5: 3.4 s, so one of the 3 waves 0.8 s apart). The volley
  // is one tick of marks — once.
  assert(p.invulnerabilityMode === 'constant', 'constant invulnerability');
  let rainHits = 0, free = -Infinity;
  for (let i = 0; i < p.slotRainWaves; i++) { const t = i * p.slotRainStep; if (t >= free) { rainHits++; free = t + p.invulnerability; } }
  const rainMax = rainHits * p.slotDamage, volleyMax = p.slotDamage;
  assert(p.heroHp === 15 && rainMax === 1 && volleyMax === 1 && Math.max(rainMax, volleyMax) < p.heroHp, `HP ${p.heroHp}, rain ${rainMax}, volley ${volleyMax}`);
  // Real pulls: the hand's chain into the lever, then the lever alone twice; the skulls' hits of each pull summed.
  const seen = { rain: 0, volley: 0 };
  let worst = 0;
  for (let k = 1; k <= 60; k++) {
    const sim = room(5, k), w = sim.world;
    draw(sim, prologueRoute(w, 5));
    for (let pull = 1; pull <= 3; pull++) {
      if (pull > 1) pullAgain(sim);
      const mark = w.events.length;
      dash(sim);
      wait(sim, 5);
      const events = w.events.slice(mark), out = events.find(e => e.type === 'slot' && e.action === 'pull');
      const damage = events.reduce((sum, e) => sum + (e.type === 'hit' && (e.source === 'slot-rain' || e.source === 'slot-volley') ? e.damage : 0), 0);
      if (out?.type === 'slot' && (out.outcome === 'rain' || out.outcome === 'volley')) seen[out.outcome]++;
      assert(damage <= (out?.type === 'slot' && out.outcome === 'rain' ? rainMax : volleyMax) && w.status === 'playing', `seed ${k} pull ${pull}: ${damage} from ${out?.type === 'slot' && out.outcome}`);
      worst = Math.max(worst, damage);
    }
  }
  assert(seen.rain > 0 && seen.volley > 0, `the skulls came: ${JSON.stringify(seen)}`);
  console.log(`   60 seeds × 3 pulls: rain ${seen.rain}, volley ${seen.volley}, the worst pull took ${worst} HP of 15`);
});

check('old worlds are untouched: a run arena hashes without the prologue fields (no `restore`, no calm), the same seed gives the same world twice', () => {
  for (const id of ['glade', 'marked', 'outpost']) {
    const a = new Simulation({ arena: id, params: prologueParams(6), seed: seedOf(5) }), b = new Simulation({ arena: id, params: prologueParams(6), seed: seedOf(5) });
    for (let i = 0; i < 300; i++) { a.tick(); b.tick(); }
    const state = worldState(a.world) as Record<string, unknown>;
    assert(!('restore' in state) && a.hash() === b.hash(), `${id}`);
  }
  // A room with the return hashes its state (the ids and the due return decide the future).
  const sim = room(2), state = worldState(sim.world) as Record<string, unknown>;
  assert(JSON.stringify(state.restore) === JSON.stringify({ ids: startEnemyIds(sim.world) }), 'the return state is hashed');
});

console.log(`\n${checks} checks passed`);
