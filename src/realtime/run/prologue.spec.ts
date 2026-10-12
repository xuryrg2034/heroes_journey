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
 * - room 1 has no return; room 5 returns only when no start enemy is left and the lever was never pulled;
 * - room 5: the lever pulled meets the goal; three pulls, none risky, no bust (several seeds);
 * - rooms 1–4: the hero walking into the enemies loses no HP, the enemies stand; room 5 and 6: the enemies walk and hit;
 * - room 6: the inflow keeps at most 12, varies by seed, the start energy is one jump, the goblin comes after the goals;
 * - every fight replays from its journal to the same hash (checkpoints every 300 ticks), twice.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { canJump, linkPoint, planChain, type ChainPlan } from '../sim/chain';
import { worldState } from '../sim/hash';
import { Simulation, replay, type Journal } from '../sim/simulation';
import { goblinOf } from '../sim/slot';
import { LAMPS_HOLD, RESTORE_DELAY, doorOpen, goalLamps, goalProgress, type ChainLink, type World, type WorldEvent } from '../sim/world';
import { arenaTemplate } from '../sim/arenas';
import { PROLOGUE_FORCED, PROLOGUE_ROOMS, prologueLoadout, prologueParams, prologueRoom, prologueRoute, startEnemyIds } from './prologue';
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
  assert(PROLOGUE_ROOMS.slice(0, 4).every(r => r.arena.calm) && !PROLOGUE_ROOMS[4].arena.calm && !PROLOGUE_ROOMS[5].arena.calm, 'calm rooms 1–4');
  assert(PROLOGUE_ROOMS.map(r => r.arena.restore ?? '-').join(',') === '-,afterDash,afterDash,afterDash,whenGone,-', 'return by room');
});

check('rooms 1–5: the ghost hand\'s chain, drawn by the commands, is the drawn chain; its highlight is the dash; the dash meets the goal and opens the door (seeds 1–3)', () => {
  for (const r of PROLOGUE_ROOMS.slice(0, 5)) for (const k of [1, 2, 3]) {
    const sim = room(r.number, k), w = sim.world, label = `${r.id} seed ${k}`;
    const route = prologueRoute(w, r.number);
    assert(route.length === r.route!.length, `${label}: the route on the arena`);
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
    walkTo(sim, w.arena.heroStart);
    draw(sim, prologueRoute(w, n));
    const events = dash(sim), goals = events.findIndex(e => e.type === 'goals');
    const killsBefore = events.slice(0, goals).filter(e => e.type === 'kill').length;
    assert(goals >= 0 && killsBefore === N && events.findIndex(e => e.type === 'chainEnd') > goals && goalLamps(w).lit === N,
      `room ${n}: the door opens at the N-th kill of the dash (${killsBefore})`);
  }
});

check('rooms 2 and 4: a chain shorter than N keeps the door shut; 1 s of game time after the dash the start enemies stand at their posts with full HP (not before); a chain drawn then waits for its end', () => {
  for (const n of [2, 4]) for (const k of [1, 2]) {
    const sim = room(n, k), w = sim.world, N = prologueRoom(n).arena.killGoal!, label = `room ${n} seed ${k}`;
    const route = prologueRoute(w, n);
    draw(sim, route.slice(0, N - 3));
    dash(sim);
    assert(!doorOpen(w) && w.stats.bestChain === N - 3 && w.enemies.length === w.arena.enemies.length - (N - 3), `${label}: short chain, door shut`);
    const took = awaitReturn(sim, label);
    assert(took >= RESTORE_DELAY - 1e-6 && took <= RESTORE_DELAY + 0.05 && !doorOpen(w), `${label}: the return after ${took.toFixed(3)} s`);
    // A short chain again; a chain drawn before its return is due — the return waits for that chain's end.
    walkTo(sim, w.arena.heroStart);
    draw(sim, prologueRoute(w, n).slice(0, 2));
    dash(sim);
    wait(sim, 0.5);
    const mark = w.events.length, nearest = w.enemies.reduce((a, b) => Math.hypot(b.x - w.hero.x, b.y - w.hero.y) < Math.hypot(a.x - w.hero.x, a.y - w.hero.y) ? b : a);
    draw(sim, [{ kind: 'enemy', id: nearest.id }]);
    wait(sim, RESTORE_DELAY);
    assert(restores(w, mark) === 0 && w.chain.length === 1, `${label}: no return while a chain is drawn`);
    sim.command({ t: 'release' });
    awaitReturn(sim, `${label}, at the end of that chain`, 2);
    // The room is still won by the hand's chain after the returns (walked back to the start).
    walkTo(sim, w.arena.heroStart);
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

check('room 3: the tough one struck first survives (3 → 2) and the return heals it; weak ones killed one by one come back; then weak, weak, weak, tough wins', () => {
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
    assert(t && t.hp === 2 && !doorOpen(w), `${label}: the tough one lives with 2 HP (${t?.hp})`);
    awaitReturn(sim, `${label}: healed and back`);
    assert(w.enemies.find(e => e.id === tough.id)!.hp === 3, `${label}: the same tough one, 3 HP`);
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
    // The hand's chain from where the hero stands now (the weak one's post): walk back to the start first.
    walkTo(sim, w.arena.heroStart);
    const win = draw(sim, prologueRoute(w, 3));
    planIsDash(win, dash(sim), label);
    assert(doorOpen(w) && w.stats.markedKills === 1 && w2, `${label}: the tough one dies last, the door opens`);
    replays(sim, `room 3 ${label}`);
  }
});

check('room 1: no return — a kill stays a kill (3 s later the arena holds 2); three single chains win it too', () => {
  const sim = room(1), w = sim.world;
  assert(!w.restore, 'no return state');
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

check('room 5: the enemies walk to the hero and touch for 1; the lever pulled once meets the goal; three pulls, none risky, no bust (seeds 1–5)', () => {
  for (let k = 1; k <= 5; k++) {
    const sim = room(5, k), w = sim.world, label = `seed ${k}`;
    assert(goblinOf(w) && w.slot?.goblin?.pulls === 0, `${label}: the goblin stands from the start`);
    // The hand's chain: the ring, the lever.
    draw(sim, prologueRoute(w, 5));
    dash(sim);
    assert(doorOpen(w) && goblinOf(w)!.pulls === 1, `${label}: the pull meets the goal`);
    // Two more pulls: the lever alone, after its cooldown and spin (the hero stands at it).
    for (const pull of [2, 3]) {
      until(sim, x => !goblinOf(x)!.spin && x.time >= goblinOf(x)!.ready, 60 * 10);
      const lever = { kind: 'object' as const, id: goblinOf(w)!.id };
      draw(sim, [lever]);
      dash(sim);
      assert(goblinOf(w)!.pulls === pull, `${label}: pull ${pull}`);
    }
    wait(sim, 3);
    const pulls = w.events.filter(e => e.type === 'slot' && e.action === 'pull');
    assert(pulls.length === 3 && pulls.every(e => e.type === 'slot' && e.risky === false && e.bust === false && e.outcome !== 'bust'), `${label}: ${JSON.stringify(pulls.map(e => e.type === 'slot' && [e.risky, e.outcome]))}`);
    assert(goblinOf(w) && !w.events.some(e => e.type === 'hit' && e.source === 'slot-bust'), `${label}: the goblin is whole`);
    replays(sim, `room 5 ${label}`);
  }
  // The touch: standing still, the ring walks in and hits for 1.
  const sim = room(5, 9), w = sim.world, hp = w.hero.hp;
  until(sim, x => x.stats.hitsTaken > 0, 60 * 6);
  assert(w.hero.hp === hp - 1 && w.events.some(e => e.type === 'hit' && e.damage === 1), 'touch 1');
});

check('room 5: the return only when no start enemy is left and the lever was never pulled', () => {
  const sim = room(5, 4), w = sim.world, ring = prologueRoute(w, 5).slice(0, 8);
  // Half the ring: no return (some are left).
  draw(sim, ring.slice(0, 4));
  dash(sim);
  wait(sim, 2);
  assert(restores(w) === 0 && w.enemies.length === 4, 'some left — no return');
  // The rest (where they walked to): none left, no pull — the return after 1 s.
  const rest = starts(w).filter(l => w.enemies.some(e => e.id === l.id));
  for (const link of rest) {
    if (!w.enemies.some(e => e.id === link.id)) continue;
    const at = linkPoint(w, link)!;
    if (Math.hypot(at.x - w.hero.x, at.y - w.hero.y) > 2) continue;
    draw(sim, [link]);
    dash(sim);
  }
  until(sim, x => {
    if (!x.enemies.length || x.move || x.chain.length) return !x.enemies.length;
    const e = x.enemies[0];
    sim.command({ t: 'begin', x: e.x, y: e.y });
    sim.command({ t: 'release' });
    return false;
  }, 60 * 20);
  const took = awaitReturn(sim, 'the ring is back');
  assert(took >= RESTORE_DELAY - 0.05, `the ring is back after ${took.toFixed(3)} s`);
  // A pull, then none left: no return.
  const sim2 = room(5, 4), w2 = sim2.world;
  draw(sim2, prologueRoute(w2, 5));
  dash(sim2);
  wait(sim2, 3);
  assert(w2.enemies.length === 0 && restores(w2) === 0, 'after a pull — no return');
  replays(sim, 'room 5 return');
});

check('room 6: start energy = one jump; the enemies walk and hit; the inflow keeps at most 12 and varies by seed; the goblin comes after the goals', () => {
  const hashes = new Set<string>(), spawns = new Set<string>();
  let hit = 0;
  for (let k = 1; k <= 4; k++) {
    const sim = room(6, k), w = sim.world;
    assert(w.energy === w.params.jumpCost && canJump(w) && !w.arena.calm, `seed ${k}: energy ${w.energy}`);
    // The hero stands: the crowd walks in and hits (he may fall — the room then starts again in the view).
    let max = 0;
    for (let i = 0; i < 60 * 12 && w.status === 'playing'; i++) { sim.tick(); max = Math.max(max, w.enemies.length + w.markers.length); }
    assert(max <= 12 && max > 8, `seed ${k}: the inflow, at most 12 (${max})`);
    hashes.add(sim.hash());
    spawns.add(JSON.stringify(w.events.filter(e => e.type === 'spawn').map(e => e.type === 'spawn' && e.enemyId)));
    if (w.stats.hitsTaken > 0) hit++;
    replays(sim, `room 6 seed ${k}`);
    // The goals (the debug command) — the goblin as in the run: `slotDelay` later, the battle's roll (chance 1 in the run).
    const sim2 = room(6, k), w2 = sim2.world;
    wait(sim2, 1);
    sim2.command({ t: 'goals' });
    wait(sim2, w2.params.slotDelay + 0.1);
    assert(goblinOf(w2) && w2.events.some(e => e.type === 'slot' && e.action === 'appear'), `seed ${k}: the goblin appears`);
  }
  assert(hashes.size === 4 && spawns.size >= 2, `the seeds differ (${hashes.size} worlds, ${spawns.size} inflows)`);
  assert(hit > 0, 'the enemies hit the hero');
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
