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
 * - room 1 has no return; room 8 returns only when no start enemy is left and the lever was never pulled;
 * - room 8: the hand's chain is the lever alone until the far ring walks in, then the enemies and the lever; the lever pulled
 *   meets the goal; three pulls, none risky, no bust (several seeds); standing still 10 s costs at most 3 HP; task 11: each
 *   pull is a sure triple (no rain, volley or pair — so no slot hit), the goblin rolls no safe count whatever the panel, the
 *   room shows no bust (`slotMayBust`) — on 40 seeds;
 * - rooms 1–4: the hero walking into the enemies loses no HP, the enemies stand; rooms 8–10: the enemies walk and hit;
 * - room 10 «Толпа» (softened by design 13.10.2026): the hero kills with real chains; enemies and markers never exceed 8, the inflow
 *   comes as he kills and varies by seed, every hit on him costs 1 HP, the start energy is one jump, the goblin stands from the start;
 * - task 9 (design 13.10.2026; the rooms are numbered anew: «Гоблин» 8, «Толпа» 9): room 5 «Пропасть» — the walk cannot cross
 *   the cliff, a jump onto it is refused with no energy spent, the jump hand's spot and click land the hero on the far bank, the
 *   walk into the open door wins, a spent jump comes back 1 s later; room 6 «Вихрь» — one spin kills the six and opens the door,
 *   a chain takes at most two, chains one by one and a spin off the middle (or into nothing) bring the ring, the hero and the
 *   spin's energy back 1 s later; two partial spins, or a chain and a spin in one return window, never add up to the goal;
 *   room 7 «Зелье» — 5 HP of 15 whatever the view gives, one potion, drinking it opens the door; rooms 5–7 stay solvable with
 *   hostile panel values (review 13.10.2026);
 * - task 13 (design 13.10.2026; «Щит» is room 9, «Толпа» room 10): room 9 — the hand's chain of 3+ of one colour
 *   (`prologueShieldChain`), drawn by the commands, is the dash; its shield absorbs the crowd's touches (`shieldBlock` once per
 *   enemy, no hit) and lights exactly one lamp per chain, three chains open the door; a chain of 1–2 gives no shield and the
 *   touch after it hurts (−1) with no lamp; the invulnerability after a hit and «Щит фокуса» spare the hero but light nothing;
 *   the shield over the hit's invulnerability counts; `shieldGoal` only in room 9, a run arena's shield as before;
 * - every fight replays from its journal to the same hash (checkpoints every 300 ticks), twice.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { canJump, canLink, canLinkObject, jumpRefusal, linkPoint, nextCandidates, planChain, type ChainPlan } from '../sim/chain';
import { worldState } from '../sim/hash';
import { Simulation, replay, type Journal } from '../sim/simulation';
import { goblinOf, leverReady, slotMayBust } from '../sim/slot';
import { CONTACT_SLACK, LAMPS_HOLD, RESTORE_DELAY, doorOpen, focusGuarded, goalLamps, goalProgress, touchDistanceOf, type ChainLink, type World, type WorldEvent } from '../sim/world';
import { PROLOGUE_CLIFF } from '../sim/arenasPrologue';
import { arenaTemplate } from '../sim/arenas';
import { defaultParams, heroRadius } from '../sim/params';
import { PROLOGUE_FORCED, PROLOGUE_ROOM_COUNT, PROLOGUE_ROOMS, prologueHandSpot, prologueJumpAim, prologueLoadout, prologueParams, prologueRoom, prologueRoute, prologueShieldChain, prologueShieldLinks, prologueSpinReady, prologueTitle, startEnemyIds } from './prologue';
import { RT_RUN_FORCED, rtRunParams } from './rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
/** The rooms by their number (task 9, design 13.10.2026: «Гоблин» is room 8; task 13: «Щит» room 9, «Толпа» room 10). */
const JUMP = 5, SPIN = 6, POTION = 7, GOBLIN = 8, SHIELD = 9, CROWD = 10;
/** Colour 0 (art.ts `COLORS`). */
const RED_COLOUR = 0;
/** The rooms with a hand route (1–4 and 8). */
const HAND_ROOMS = PROLOGUE_ROOMS.filter(r => r.route);

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

/** Ticks to the next return (any arena; no check of the posts). */
function awaitReturnAny(sim: Simulation): void {
  const mark = sim.world.events.length;
  until(sim, x => restores(x, mark) > 0, 60 * 4);
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

check('the rooms: ten, in order (task 9; task 13: «Щит» between «Гоблин» and «Толпа»), ids — the six of task 6 kept, four new; titles «N/10 · …»; numbers — the run\'s RT_RUN_FORCED with existing keys over it; rooms 1–9 no inflow; room 5 jump radius 3; room 6 the spin\'s defaults; room 8 three safe pulls; room 9 the shield of the run, touch 1; room 10 up to 8, touch 1; the tiles', () => {
  assert(PROLOGUE_ROOM_COUNT === 10 && PROLOGUE_ROOMS.length === 10, 'ten rooms');
  assert(PROLOGUE_ROOMS.map(r => r.title).join(',') === 'Тропа,Два цвета,Крепкий,Радуга,Пропасть,Вихрь,Зелье,Гоблин,Щит,Толпа', 'titles');
  assert(PROLOGUE_ROOMS.map(r => r.id).join(',') === 'prologue-1,prologue-2,prologue-3,prologue-4,prologue-jump,prologue-spin,prologue-potion,prologue-5,prologue-shield,prologue-6', 'ids');
  assert(PROLOGUE_ROOMS.every((r, i) => r.number === i + 1 && arenaTemplate(r.id) === r.arena), 'numbers, registered');
  assert(prologueTitle(1) === '1/10 · Тропа' && prologueTitle(SPIN) === '6/10 · Вихрь' && prologueTitle(SHIELD) === '9/10 · Щит' && prologueTitle(CROWD) === '10/10 · Толпа', 'titles on the screen');
  for (const r of PROLOGUE_ROOMS) {
    const p = prologueParams(r.number);
    for (const [key, value] of Object.entries(RT_RUN_FORCED)) if (!(key in r.forced)) assert(JSON.stringify(p[key as keyof typeof p]) === JSON.stringify(value), `${r.id}: ${key} is the run's`);
    for (const [key, value] of Object.entries(r.forced)) assert(p[key as keyof typeof p] === value, `${r.id}: ${key}`);
    assert(Object.keys(r.forced).every(key => key in p), `${r.id}: only existing keys`);
  }
  assert(PROLOGUE_FORCED.slice(0, 9).every(f => f.maxEnemies === 0) && PROLOGUE_FORCED[CROWD - 1].maxEnemies === 8, 'inflow');
  // Rooms 5 and 6 (task 9): their numbers do not follow the panel (a panel jump radius or spin circle would break the room).
  const panel = { ...defaultParams(), jumpRadius: 1, spinRadius: 0.5, spinDamage: 1, spinCost: 6 };
  const pj = prologueParams(JUMP, panel), ps = prologueParams(SPIN, panel);
  assert(pj.jumpRadius === 3 && pj.doorWalkIn && ps.spinRadius === 1.2 && ps.spinDamage === 4 && ps.spinCost === 3, 'rooms 5 and 6: their own numbers over the panel');
  // Room 10 (design 13.10.2026): every touch 1 (no raised touch of the tough ones); the invulnerability and the shields are the run's.
  const p10 = prologueParams(CROWD), run = rtRunParams(defaultParams());
  assert(p10.contactDamage === 1 && !p10.toughTouch, 'room 10: touch 1');
  assert(p10.invulnerability === run.invulnerability && p10.invulnerabilityMode === run.invulnerabilityMode && p10.chainShield === run.chainShield && p10.chainShieldMinKills === run.chainShieldMinKills && p10.focusGuardLinks === run.focusGuardLinks, 'room 10: invulnerability and shields of the run');
  // Room 9 «Щит» (task 13): the run's shield (0.5 s after 3+ kills), «Щит фокуса» from the 3rd link, touch 1, HP 15 — even over a
  // hostile panel (the view builds the prologue from the sandbox panel).
  const hostile = { ...defaultParams(), chainShield: 0, chainShieldMinKills: 1, contactDamage: 3, heroHp: 2, enemySpeed: 0.1, invulnerability: 2, focusGuardLinks: 0, maxEnemies: 40 };
  for (const p9 of [prologueParams(SHIELD), prologueParams(SHIELD, hostile)]) {
    assert(p9.chainShield === 0.5 && p9.chainShieldMinKills === run.chainShieldMinKills && p9.chainShieldMinKills === 3 && p9.focusGuardLinks === run.focusGuardLinks, 'room 9: the shields of the run');
    assert(p9.contactDamage === 1 && !p9.toughTouch && p9.heroHp === 15 && p9.maxEnemies === 0 && p9.enemySpeed === 1.2 && p9.invulnerability === 0.5 && p9.invulnerabilityMode === 'constant', 'room 9: touch 1, HP 15, no inflow, the run\'s pace, 0.5 s after a hit');
  }
  const p8 = prologueParams(GOBLIN), goblinRoom = prologueRoom(GOBLIN).arena;
  assert(p8.slot && p8.slotBust && p8.slotPulls === 3 && p8.slotSafePulls === 3 && p8.slotSafePerLongChain === 0 && p8.contactDamage === 1, 'room 8 numbers');
  assert(Math.abs(p8.enemySpeed - prologueParams(4).enemySpeed * 0.6) < 1e-9 && goblinRoom.enemies.length === 6 && goblinRoom.sleepUntilChain, 'room 8: six enemies, asleep until the first press, ×0.6 the run\'s pace');
  assert(p8.invulnerability === 3.4 && p8.invulnerabilityMode === 'constant', 'room 8: 3.4 s after a hit');
  assert(PROLOGUE_ROOMS.map(r => r.arena.calm ? 'calm' : '-').join(',') === 'calm,calm,calm,calm,calm,calm,calm,-,-,-', 'calm rooms 1–7');
  assert(PROLOGUE_ROOMS.map(r => r.arena.restore ?? '-').join(',') === 'none,afterDash,afterDash,afterDash,afterDash,afterDash,-,whenGone,afterDash,none', 'return by room');
  assert(PROLOGUE_ROOMS.map(r => r.arena.goal).join(',') === 'kills,chain,marked,chain,door,strike,item,pull,shield,kills', 'goals by room');
  assert(JSON.stringify(PROLOGUE_ROOMS.map(r => r.tiles)) === JSON.stringify([[], [], [], [], ['jump'], ['spin'], ['healing'], [], [], 'all']), 'tiles by room');
  // The start enemies' ids are kept by every room with a return (`World.restore`), the same as the enemies standing on the posts.
  for (const r of PROLOGUE_ROOMS) {
    const w = room(r.number).world, ids = startEnemyIds(w);
    assert(ids.length === r.arena.enemies.length && r.arena.enemies.every((s, i) => { const e = w.enemies.find(x => x.id === ids[i]); return e && e.x === s.x && e.y === s.y && e.color === s.color; }), `${r.id}: start ids`);
  }
  // Start energy: the price of one jump (or one spin) in that world, instead of the loadout's.
  const rich = new Simulation({ arena: 'prologue-6', params: { ...prologueParams(CROWD), jumpCost: 3 }, seed: seedOf(1), loadout: { ...prologueLoadout(CROWD), energy: 6 } });
  assert(rich.world.energy === 3, `start energy ${rich.world.energy}`);
  assert(room(JUMP).world.energy === 2 && room(SPIN).world.energy === 3 && room(POTION).world.energy === 0 && room(SHIELD).world.energy === 0, 'rooms 5–7 and 9: one jump, one spin, none, none');
});

check('rooms 1–4 and 8: the ghost hand\'s chain, drawn by the commands, is the drawn chain; its highlight is the dash; the dash meets the goal and opens the door (seeds 1–3)', () => {
  for (const r of HAND_ROOMS) for (const k of [1, 2, 3]) {
    const sim = room(r.number, k), w = sim.world, label = `${r.id} seed ${k}`;
    const route = prologueRoute(w, r.number);
    // Room 8: the four blue round the goblin, then the lever (the reds are another colour).
    assert(r.number === GOBLIN ? route.length === 5 && route[4].kind === 'object' : route.length === r.route!.length, `${label}: the route on the arena`);
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
    if (r.number === GOBLIN) assert(events.some(e => e.type === 'slot' && e.action === 'pull'), `${label}: ends on the lever`);
    wait(sim, 2);
    assert(restores(w) === 0, `${label}: no return after the goal`);
    replays(sim, label);
  }
});

check('the hand when it shows (4 s without a press; from the start, or after a short chain — rooms 2–4: the return put the hero on his start, rooms 1 and 8: where the dash left him; seeds 1–4): its chain, drawn by the commands, is the drawn chain, the highlight is the dash; rooms 2–4 and 8 meet the goal. A hero standing where no chain can start gets no hand (empty route): the next check', () => {
  let shown = 0, none = 0;
  for (const r of HAND_ROOMS) for (const k of [1, 2, 3, 4]) for (const before of ['fresh', 'short'] as const) {
    const sim = room(r.number, k), w = sim.world, label = `${r.id} seed ${k} ${before}`;
    if (before === 'short') { draw(sim, prologueRoute(w, r.number).slice(0, r.number === GOBLIN ? 3 : 2)); dash(sim); }
    // The hand shows after 4 s without a press: the enemies of room 8 walked in meanwhile, the return of rooms 2–4 came.
    wait(sim, 4);
    if (w.status !== 'playing' || doorOpen(w)) continue;
    const route = prologueRoute(w, r.number);
    if (!route.length) { none++; assert(r.number === GOBLIN, `${label}: rooms 1–4 have a hand in these starts`); continue; }
    shown++;
    const hand = planChain(w, route), plan = draw(sim, route);
    assert(JSON.stringify(plan.links) === JSON.stringify(hand.links), `${label}: the hand's highlight is the drawn one`);
    const events = dash(sim);
    planIsDash(plan, events, label);
    if (r.number >= 2) assert(doorOpen(w), `${label}: the goal is met (${JSON.stringify(goalProgress(w))})`);
    if (r.number === GOBLIN) assert(route[route.length - 1].kind === 'object' && events.some(e => e.type === 'slot' && e.action === 'pull'), `${label}: ends on the lever`);
    replays(sim, label);
  }
  console.log(`   ${shown} hands drawn and played, ${none} rooms without a hand`);
});

check('no hand from where the hero walked: the spot the view points to (`prologueHandSpot`) is found, walked to by the commands, and from there the hand\'s chain is drawn by the commands and does what the room needs (rooms 1–4 and 8, seeds 1–3); the call changes nothing', () => {
  let tried = 0, slowest = 0, total = 0, calls = 0;
  for (const r of HAND_ROOMS) for (const k of [1, 2, 3]) {
    const sim = room(r.number, k), w = sim.world, label = `${r.id} seed ${k}`;
    // Walk into a corner the hand has no chain from (the first such corner; room 8's enemies sleep through the walk).
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

/** Room 8: chains of one enemy (the nearest, once it is in reach), never ending on the lever, until `left` start enemies remain. */
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
 * Room 8: the lever alone once more, as a player would: the enemies left are killed by chains first (they walk in), the hero
 * walks back next to the lever, its cooldown and spin over — the press on it, the release.
 */
function pullAgain(sim: Simulation): void {
  const w = sim.world;
  killDownTo(sim, 0);
  walkTo(sim, goblinOf(w)!, 1.2);
  until(sim, x => !goblinOf(x)!.spin && x.time >= goblinOf(x)!.ready && !x.move, 60 * 10);
  draw(sim, [{ kind: 'object', id: goblinOf(w)!.id }]);
}

check('room 8: the enemies sleep until the first press — 10 s without one: HP 15, everybody on the posts; the hand at that moment is 4 blue → the lever, drawn by the commands (the press wakes them), it meets the goal; three pulls, none risky, no bust (seeds 1–5)', () => {
  for (let k = 1; k <= 5; k++) {
    const sim = room(GOBLIN, k), w = sim.world, label = `seed ${k}`;
    assert(goblinOf(w) && w.slot?.goblin?.pulls === 0 && w.asleep, `${label}: the goblin stands, the enemies sleep`);
    // Walking about does not wake them either (only a press does).
    walkTo(sim, { x: 2, y: 6.5 }, 0.1);
    walkTo(sim, w.arena.heroStart, 0.05);
    wait(sim, 10);
    assert(w.hero.hp === 15 && w.asleep && allAtPosts(w), `${label}: 10 s asleep — HP ${w.hero.hp}, on the posts`);
    const route = prologueRoute(w, GOBLIN);
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
    replays(sim, `room 8 ${label}`);
  }
});

check('room 8: the hand never shows the lever alone (that chain still pulls it) — with no enemy chain into the lever, no hand', () => {
  const sim = room(GOBLIN, 2), w = sim.world;
  // Every enemy by single chains: none left (the return comes 1 s later) — no enemy chain into the lever, no hand.
  killDownTo(sim, 0);
  assert(!w.enemies.length && prologueRoute(w, GOBLIN).length === 0, 'no hand without enemies');
  // The lever alone is still a chain that pulls it (the return may have come meanwhile: the enemies are awake).
  walkTo(sim, goblinOf(w)!, 1.2);
  const lever = { kind: 'object' as const, id: goblinOf(w)!.id };
  assert(canLinkObject(w, w.objects.find(o => o.id === lever.id)!), 'the lever alone is a chain');
  draw(sim, [lever]);
  dash(sim);
  assert(goblinOf(w)!.pulls === 1 && doorOpen(w), 'the lever alone pulls it, as in the run');
});

check('room 8 (design answer 12.10.2026): from the waking press 10 s without actions cost at most 3 HP of 15 — the enemies walk at ×0.6, touch for 1, 3.4 s after each hit (seeds 1–10)', () => {
  const lost: number[] = [];
  for (let k = 1; k <= 10; k++) {
    const sim = room(GOBLIN, k), w = sim.world;
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

check('room 8: sleeping enemies are not parted by the hero walking through them, do not touch him standing in their bodies, and any press wakes them — an empty one too; the journal replays awake (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(GOBLIN, k), w = sim.world, label = `seed ${k}`;
    // Through every sleeping body and back to the start: nobody moved.
    for (const e of [...w.enemies]) walkTo(sim, e, 0.05);
    walkTo(sim, w.arena.heroStart, 0.05);
    assert(w.asleep && allAtPosts(w), `${label}: walked through — everybody on the posts`);
    // Standing in a sleeping body 5 s: no touch.
    walkTo(sim, w.enemies[0], 0.02);
    wait(sim, 5);
    assert(w.asleep && w.hero.hp === 15 && w.stats.hitsTaken === 0, `${label}: 5 s in a body — HP ${w.hero.hp}`);
    // A press on an empty spot (no link taken) wakes them.
    walkTo(sim, w.arena.heroStart, 0.05);
    assert(sim.command({ t: 'begin', x: w.arena.width - 0.5, y: 0.5 }) === false && w.chain.length === 0, `${label}: the press took nothing`);
    assert(!w.asleep, `${label}: the empty press woke them`);
    wait(sim, 1);
    assert(!allAtPosts(w), `${label}: awake, they walk`);
    const again = replay(JSON.parse(JSON.stringify(sim.exportJournal())) as Journal);
    assert(again.hash() === sim.hash() && !again.world.asleep, `${label}: the journal replays to the same awake world`);
  }
});

check('room 8: no spot for the hand when no chain «enemies → lever» can be drawn from anywhere — null, no arrow (none left, the return not come yet)', () => {
  const sim = room(GOBLIN, 2), w = sim.world;
  killDownTo(sim, 0);
  assert(!w.enemies.length && prologueRoute(w, GOBLIN).length === 0 && prologueHandSpot(w, GOBLIN) === null, 'no enemies — no hand anywhere, no spot');
  // The return brings them back: a spot (or the hand itself) again.
  awaitReturnAny(sim);
  assert(prologueRoute(w, GOBLIN).length > 0 || prologueHandSpot(w, GOBLIN) !== null, 'after the return: a hand or a spot');
});

check('room 8: after a return the enemies stay awake (they sleep once, until the first press)', () => {
  const sim = room(GOBLIN, 3), w = sim.world, mark = w.events.length;
  killDownTo(sim, 0);
  until(sim, x => restores(x, mark) > 0, 60 * 3);
  assert(!w.asleep && w.enemies.length > 0, 'awake after the return');
  const before = w.enemies.map(e => `${e.x},${e.y}`).join(';');
  wait(sim, 1);
  assert(w.enemies.map(e => `${e.x},${e.y}`).join(';') !== before, 'they walk');
});

check('room 8: the return only when no start enemy is left and the lever was never pulled', () => {
  const sim = room(GOBLIN, 4), w = sim.world;
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
  const sim2 = room(GOBLIN, 4), w2 = sim2.world;
  draw(sim2, prologueRoute(w2, GOBLIN));
  dash(sim2);
  assert(goblinOf(w2)!.pulls === 1, 'pulled');
  killDownTo(sim2, 0);
  wait(sim2, 3);
  assert(w2.enemies.length === 0 && restores(w2) === 0, 'after a pull — no return');
  replays(sim, 'room 8 return');
});

check('room 8: a post under the hero waits until he steps off it; the others come at once; no `spawn` events (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(GOBLIN, k), w = sim.world, label = `seed ${k}`;
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
    assert(first?.type === 'restore' && first.enemies.length === posts.length - 1 && !first.late && w.restore?.wait?.length === 1, `${label}: five come, one waits`);
    assert(!w.enemies.some(e => Math.hypot(e.x - w.hero.x, e.y - w.hero.y) < 0.6), `${label}: nobody on the hero`);
    wait(sim, 1);
    assert(restores(w, mark) === 1, `${label}: still waits while he stands there`);
    walkTo(sim, { x: w.hero.x, y: w.hero.y - 1.5 }, 0.05);
    until(sim, x => restores(x, mark) > 1, 60);
    assert(!w.restore?.wait && w.enemies.length === posts.length && !w.events.slice(mark).some(e => e.type === 'spawn'), `${label}: the last one comes when he steps off; no spawn events`);
    // The late batch is the same return (the view's telemetry counts one): only it is marked `late`.
    const batches = w.events.slice(mark).filter(e => e.type === 'restore');
    assert(batches.length === 2 && batches.map(e => e.type === 'restore' && !!e.late).join() === 'false,true', `${label}: one return, its late batch marked`);
    replays(sim, `room 8 waiting post ${label}`);
  }
});

check('room 8: a late post waits for the end of a dash too — the hero dashes off the post: no return during the dash, the post comes after it (seeds 1–5)', () => {
  for (let k = 1; k <= 5; k++) {
    const sim = room(GOBLIN, k), w = sim.world, label = `seed ${k}`;
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
    replays(sim, `room 8 late post ${label}`);
  }
});

/**
 * Room 9, played as a player plays it: the hero stands where he started; each chain is the press on the enemy nearest him,
 * then the pointer sweeps to the nearest enemy the chain may take next (up to 6 enemy links; it stops on a planned survivor),
 * with 2 ticks of focus between moves; its highlight is the dash. `tick` runs one tick with the test's watch.
 */
function crowdChain(sim: Simulation, tick: () => void, label: string): boolean {
  const w = sim.world, hero = w.hero, near = (p: { x: number; y: number }) => (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y);
  const first = w.enemies.filter(e => canLink(w, e)).sort(near(hero))[0];
  if (!first || sim.command({ t: 'begin', x: first.x, y: first.y }) !== true || !w.chain.length) return false;
  for (let n = 1; n < 6 && !planChain(w).endsOnSurvivor; n++) {
    tick(); tick();
    if (!w.chain.length || w.status !== 'playing') return false;
    const from = linkPoint(w, w.chain[w.chain.length - 1])!;
    const next = nextCandidates(w).sort(near(from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'sweep', fx: from.x, fy: from.y, x: next.x, y: next.y });
    if (w.chain.length === before) break;
  }
  if (!w.chain.length) return false;
  const plan = planChain(w), mark = w.events.length;
  assert(sim.command({ t: 'release' }) === true, `${label}: the release starts a dash`);
  for (let i = 0; i < 60 * 20 && w.move && w.status === 'playing'; i++) tick();
  if (w.status === 'playing') planIsDash(plan, w.events.slice(mark), label);
  return true;
}

check('room 10 «Толпа» (design 13.10.2026): start energy = one jump; the goblin stands from the start; the hero kills with real chains — enemies and markers never more than 8, the inflow comes and varies by seed, every hit on the hero costs 1 HP (seeds 1–6)', () => {
  const hashes = new Set<string>(), inflows = new Set<string>();
  let hits = 0;
  for (let k = 1; k <= 6; k++) {
    const sim = room(CROWD, k), w = sim.world, label = `seed ${k}`;
    assert(w.energy === w.params.jumpCost && canJump(w) && !w.arena.calm, `${label}: energy ${w.energy}`);
    const g = goblinOf(w);
    assert(g && g.x === w.arena.goblin!.x && g.y === w.arena.goblin!.y && g.pulls === 0 && leverReady(w, w.objects.find(o => o.id === g.id)!), `${label}: the goblin from the start`);
    const hp0 = w.hero.hp, newcomers: string[] = [];
    let max = w.enemies.length + w.markers.length, seen = w.events.length, hitsHere = 0;
    // Every tick: the crowd and its markers within 8; each hit on the hero costs exactly 1 HP (the HP falls by the hits).
    const tick = (): void => {
      const hp = w.hero.hp;
      sim.tick();
      max = Math.max(max, w.enemies.length + w.markers.length);
      const fresh = w.events.slice(seen), struck = fresh.flatMap(e => e.type === 'hit' ? [e] : []);
      seen = w.events.length;
      assert(struck.every(h => h.damage === 1), `${label}: hits ${JSON.stringify(struck.map(h => [h.source, h.damage]))}`);
      if (w.status === 'playing') assert(hp - w.hero.hp === struck.length, `${label}: HP ${hp} → ${w.hero.hp} for ${struck.length} hits`);
      hitsHere += struck.length;
      for (const e of fresh) if (e.type === 'spawn') { const x = w.enemies.find(en => en.id === e.enemyId); newcomers.push(x ? `${x.color}@${x.x.toFixed(1)},${x.y.toFixed(1)}` : `#${e.enemyId}`); }
    };
    // Between chains the crowd walks in. The hero may fall (the view then starts the room again): the fight stops at 15
    // kills, a defeat or 40 s of game time — the outcome is not checked.
    while (w.status === 'playing' && w.stats.kills < 15 && w.time < 40) {
      crowdChain(sim, tick, `${label} chain`);
      for (let i = 0; i < 6 && w.status === 'playing'; i++) tick();
    }
    // Then he stands still 6 s among the crowd (newcomers, the tough ones among them, walk in and touch).
    for (let i = 0; i < 60 * 6 && w.status === 'playing'; i++) tick();
    assert(max <= 8, `${label}: at most 8 enemies and markers (${max})`);
    assert(newcomers.length > 0, `${label}: the inflow comes as the hero kills`);
    assert(w.stats.hitsTaken === hitsHere && w.stats.damageTaken === hitsHere && (w.status !== 'playing' || w.hero.hp === hp0 - hitsHere), `${label}: ${hitsHere} hits, ${w.stats.damageTaken} damage, HP ${w.hero.hp} of ${hp0}`);
    hits += hitsHere;
    hashes.add(sim.hash());
    inflows.add(newcomers.join(' '));
    // No second goblin: the battle never rolls (its slot stands from the start).
    assert(goblinOf(w)?.id === g.id && !w.events.some(e => e.type === 'slot' && e.action === 'appear'), `${label}: the same goblin`);
    replays(sim, `room 10 ${label}`);
    console.log(`   ${label}: ${w.stats.kills} kills, ${newcomers.length} newcomers, ${hitsHere} hits, ${w.status} at ${w.time.toFixed(1)} s`);
  }
  assert(hashes.size === 6 && inflows.size >= 3, `the seeds differ (${hashes.size} worlds, ${inflows.size} inflows)`);
  assert(hits > 0, 'the enemies hit the hero');
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

check('room 8 (task 11, design 13.10.2026): three fixed safe pulls, each a sure triple — no skull (rain, volley, pair, nothing), no bust, no hit of the goblin; the goblin rolls no safe count, the panel cannot turn the run\'s random count on; the room shows no bust (`slotMayBust` false) — real pulls on 40 seeds', () => {
  const p = prologueParams(GOBLIN), wild = prologueParams(GOBLIN, { ...defaultParams(), slotSafeRandom: true, slotSafeTriple: false, slotSafePulls: 0, slotSafePerLongChain: 2 });
  for (const q of [p, wild]) assert(q.slotSafeTriple && !q.slotSafeRandom && q.slotSafePulls === 3 && q.slotPulls === 3 && q.slotSafePerLongChain === 0, `room 8 numbers over any panel: ${JSON.stringify([q.slotSafeTriple, q.slotSafeRandom, q.slotSafePulls])}`);
  const outcomes: Record<string, number> = {};
  for (let k = 1; k <= 40; k++) {
    const sim = room(GOBLIN, k), w = sim.world;
    assert(!slotMayBust(w) && goblinOf(w) && goblinOf(w)!.safe === undefined, `seed ${k}: no bust shown, no rolled count`);
    draw(sim, prologueRoute(w, GOBLIN));
    for (let pull = 1; pull <= 3; pull++) {
      if (pull > 1) pullAgain(sim);
      const mark = w.events.length;
      dash(sim);
      wait(sim, 2);
      const events = w.events.slice(mark), out = events.find(e => e.type === 'slot' && e.action === 'pull');
      assert(out?.type === 'slot' && out.triple === true && out.risky === false && /^(heart3|bolt3|gem3|jackpot)$/.test(out.outcome!) && out.reels!.every(r => r === out.reels![0]), `seed ${k} pull ${pull}: ${JSON.stringify(out)}`);
      assert(!events.some(e => e.type === 'hit' && (e.source === 'slot-rain' || e.source === 'slot-volley' || e.source === 'slot-bust')), `seed ${k} pull ${pull}: no slot hit`);
      outcomes[out.outcome!] = (outcomes[out.outcome!] ?? 0) + 1;
    }
    assert(goblinOf(w) && !w.rng.states().some(([name]) => name === 'slot:reels' || name === 'slot:safe'), `seed ${k}: no reels drawn, no safe roll`);
    if (k <= 3) replays(sim, `room 8 triples ${k}`);
  }
  assert(Object.keys(outcomes).length === 4, `the four triples came: ${JSON.stringify(outcomes)}`);
  console.log(`   40 seeds × 3 pulls: ${JSON.stringify(outcomes)}`);
});

// ---- Task 9 (design 13.10.2026): rooms 5 «Пропасть», 6 «Вихрь», 7 «Зелье» --------------------------------------------------

/** Walks the hero by `walk` commands in direction (dx, dy) for `seconds` of game time, then stops. */
function walkFor(sim: Simulation, dx: number, dy: number, seconds: number): void {
  const d = Math.hypot(dx, dy);
  sim.command({ t: 'walk', x: dx / d, y: dy / d });
  wait(sim, seconds);
  sim.command({ t: 'walk', x: 0, y: 0 });
}
/** Runs the jump to its landing. */
function land(sim: Simulation): void { until(sim, x => !x.move, 60 * 5); }
/** The hero's body is past the cliff's far edge / short of its near edge. */
const farBank = (w: World): boolean => w.hero.x - heroRadius(w.params) > PROLOGUE_CLIFF.far;
const nearBank = (w: World): boolean => w.hero.x + heroRadius(w.params) < PROLOGUE_CLIFF.near + 1e-6;

check('room 5 «Пропасть»: the door is open from the start, but walking cannot cross the cliff (along the middle and both edges of the room); a jump aimed over the cliff does not start and spends nothing; the hand\'s spot and aim, walked to and clicked by the commands, land the hero on the far bank; then the walk into the door wins (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(JUMP, k), w = sim.world, label = `seed ${k}`, cost = w.params.jumpCost;
    assert(doorOpen(w) && w.enemies.length === 0 && w.energy === cost && canJump(w) && w.arena.calm, `${label}: door open, no enemies, one jump of energy`);
    assert(goalLamps(w).total === 1 && goalLamps(w).lit === 0, `${label}: one lamp`);
    // Walking: straight at the door, and along the room's top and bottom edges — the body stops at the cliff.
    for (const y of [4, 0.35, w.arena.height - 0.35]) {
      walkTo(sim, { x: 3, y }, 0.1);
      walkFor(sim, 1, 0, 4);
      assert(nearBank(w) && w.status === 'playing', `${label}: the walk at y ${y} stops at the edge (x ${w.hero.x.toFixed(2)})`);
    }
    // A jump from the start towards the door lands on the cliff: refused, «обрыв», no energy spent.
    walkTo(sim, w.arena.heroStart, 0.05);
    const aim0 = prologueJumpAim(w, JUMP)!;
    assert(aim0 && !aim0.ready, `${label}: from the start the hand is not ready (walk to the spot first)`);
    assert(jumpRefusal(w, w.arena.door) === 'cliff' && sim.command({ t: 'jump', x: w.arena.door.x, y: w.arena.door.y }) === false && w.energy === cost && !w.move, `${label}: the jump over the cliff is refused`);
    // The hand's spot (the arrow), walked to; there the hand is ready.
    walkTo(sim, aim0.spot, 0.03);
    const aim = prologueJumpAim(w, JUMP)!, before = sim.hash();
    assert(aim.ready && sim.hash() === before && nearBank(w), `${label}: at the spot the hand is ready, the world unchanged`);
    // From the spot, a target on the cliff itself is refused too.
    assert(sim.command({ t: 'jump', x: (PROLOGUE_CLIFF.near + PROLOGUE_CLIFF.far) / 2, y: w.hero.y }) === false && w.energy === cost, `${label}: a landing on the cliff is refused from the spot`);
    // The hand's click: the jump lands on the far bank.
    assert(sim.command({ t: 'jump', x: aim.target.x, y: aim.target.y }) === true && w.energy === 0, `${label}: the jump starts`);
    land(sim);
    assert(farBank(w) && prologueJumpAim(w, JUMP) === null, `${label}: on the far bank (x ${w.hero.x.toFixed(2)}), no more hand`);
    walkTo(sim, { x: w.arena.door.x - 1.2, y: w.arena.door.y }, 0.1);
    walkFor(sim, 1, 0, 1.5);
    assert(w.status === 'victory' && goalProgress(w).done === 1, `${label}: the walk into the door wins (${w.status})`);
    replays(sim, `room 5 ${label}`);
  }
});

check('room 5: a jump spent on the near bank comes back 1 s later (the hero stays, no enemies to return — no `restore` event); a jump into the door wins too', () => {
  const sim = room(JUMP), w = sim.world, cost = w.params.jumpCost;
  assert(sim.command({ t: 'jump', x: 0.8, y: 4 }) === true, 'a jump back, away from the cliff');
  land(sim);
  const at = { x: w.hero.x, y: w.hero.y }, mark = w.events.length;
  assert(w.energy === 0 && nearBank(w), 'spent, still on the near bank');
  wait(sim, RESTORE_DELAY - 0.1);
  assert(w.energy === 0, 'not before 1 s');
  wait(sim, 0.2);
  assert(w.energy === cost && w.hero.x === at.x && w.hero.y === at.y && restores(w, mark) === 0, `the energy is back (${w.energy}), the hero where he was`);
  const aim = prologueJumpAim(w, JUMP)!;
  walkTo(sim, aim.spot, 0.03);
  sim.command({ t: 'jump', x: aim.target.x, y: aim.target.y });
  land(sim);
  assert(farBank(w), 'over');
  // The energy comes back on the far bank too (harmless); a jump that lands in the door enters it.
  wait(sim, RESTORE_DELAY + 0.1);
  assert(w.energy === cost, 'the energy is back on the far bank');
  walkTo(sim, { x: w.arena.door.x - 2.2, y: w.arena.door.y }, 0.05);
  assert(sim.command({ t: 'jump', x: w.arena.door.x, y: w.arena.door.y }) === true, 'the jump at the door');
  land(sim);
  assert(w.status === 'victory', `the jump into the door wins (${w.status})`);
  replays(sim, 'room 5 jumps');
});

check('room 6 «Вихрь»: six enemies of three colours in a ring round the hero, the energy of one spin; one spin (Q) kills all six — «Одним ударом: 6», all lamps, the door opens; the walk into it wins (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(SPIN, k), w = sim.world, label = `seed ${k}`;
    assert(w.enemies.length === 6 && new Set(w.enemies.map(e => e.color)).size === 3 && w.energy === w.params.spinCost && w.arena.calm, `${label}: the ring, one spin of energy`);
    assert(prologueSpinReady(w, SPIN) && !doorOpen(w) && goalLamps(w).total === 6 && goalLamps(w).lit === 0, `${label}: ready, the door shut`);
    // Standing a few seconds changes nothing (calm).
    wait(sim, 3);
    assert(allAtPosts(w) && w.hero.hp === 15, `${label}: they stand`);
    const mark = w.events.length;
    assert(sim.command({ t: 'spin' }) === true, `${label}: the spin`);
    const kills = w.events.slice(mark).filter(e => e.type === 'kill' && e.source === 'spin' && e.credited).length;
    assert(kills === 6 && (w.enemies.length as number) === 0 && doorOpen(w) && w.events.slice(mark).some(e => e.type === 'goals'), `${label}: six by one spin, the door opens (${kills})`);
    assert(goalProgress(w).done === 6 && goalLamps(w).lit === 6 && w.strike?.best === 6, `${label}: «Одним ударом: 6»`);
    wait(sim, 2);
    assert(restores(w) === 0, `${label}: no return after the goal`);
    walkTo(sim, { x: w.arena.door.x - 1.3, y: w.arena.door.y }, 0.1);
    walkFor(sim, 1, 0, 1.5);
    assert(w.status === 'victory', `${label}: the walk into the door wins`);
    replays(sim, `room 6 ${label}`);
  }
});

check('room 6: chains cannot meet «6 by one strike» — every chain the commands can draw from the start takes at most two (one colour, opposite); a chain of one kills one, the door stays shut, and 1 s later the ring, the hero on his start and the energy of one spin come back; then the spin wins (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(SPIN, k), w = sim.world, label = `seed ${k}`;
    // Every press on a ring enemy, then the pointer to every other one: the longest drawn chain and its highlight.
    let longest = 0;
    for (const a of starts(w)) for (const b of starts(w)) {
      if (a.id === b.id) continue;
      const pa = linkPoint(w, a)!, pb = linkPoint(w, b)!;
      if (sim.command({ t: 'begin', x: pa.x, y: pa.y }) !== true) continue;
      sim.command({ t: 'sweep', fx: pa.x, fy: pa.y, x: pb.x, y: pb.y });
      longest = Math.max(longest, w.chain.length);
      assert(planChain(w).kills <= 2, `${label}: a drawn chain kills at most two`);
      sim.command({ t: 'cancel' });
    }
    assert(longest >= 1 && longest <= 2, `${label}: the longest chain drawn ${longest}`);
    // Chains one by one: each kill brings the room back.
    for (let i = 0; i < 3; i++) {
      const link = starts(w)[i * 2];
      const plan = draw(sim, [link]), events = dash(sim);
      planIsDash(plan, events, `${label} chain ${i}`);
      assert(w.enemies.length === 5 && !doorOpen(w) && goalProgress(w).done === 1, `${label}: one dead, the door shut`);
      const took = awaitReturn(sim, `${label} after chain ${i}`);
      assert(took >= RESTORE_DELAY - 1e-6 && took <= RESTORE_DELAY + 0.05 && w.energy >= w.params.spinCost && !doorOpen(w), `${label}: back after ${took.toFixed(3)} s, energy ${w.energy}`);
      assert(prologueSpinReady(w, SPIN), `${label}: ready again`);
    }
    assert(sim.command({ t: 'spin' }) === true && doorOpen(w) && w.strike?.best === 6, `${label}: then the spin wins`);
    replays(sim, `room 6 chains ${label}`);
  }
});

check('room 6: a spin off the middle kills fewer — the lamps hold its kills, then go out; a spin that kills nothing spends the energy too; each time 1 s later the ring, the hero and the energy come back, and the spin from the middle wins (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(SPIN, k), w = sim.world, label = `seed ${k}`, start = w.arena.heroStart;
    // Off the middle, by the red on the right: the spin takes some, not all.
    walkTo(sim, { x: start.x + 1.6, y: start.y + 0.9 }, 0.05);
    assert(!prologueSpinReady(w, SPIN), `${label}: off the middle — not ready`);
    let mark = w.events.length;
    assert(sim.command({ t: 'spin' }) === true, `${label}: the spin`);
    const some = w.events.slice(mark).filter(e => e.type === 'kill').length;
    assert(some >= 1 && some < 6 && !doorOpen(w) && w.energy === 0, `${label}: ${some} by the spin, the door shut`);
    assert(goalLamps(w).lit === some && goalLamps(w).total === 6, `${label}: the lamps hold the spin's ${some}`);
    wait(sim, LAMPS_HOLD);
    assert(goalLamps(w).lit === 0, `${label}: then out`);
    let took = awaitReturn(sim, `${label} after the short spin`);
    assert(took <= RESTORE_DELAY + 0.05 && w.energy === w.params.spinCost, `${label}: ring, hero and energy back`);
    // Far from the ring: the spin kills nothing, but the energy is gone — the room gives it back.
    walkTo(sim, { x: 10, y: 6.6 }, 0.1);
    mark = w.events.length;
    assert(sim.command({ t: 'spin' }) === true && w.events.slice(mark).filter(e => e.type === 'kill').length === 0 && w.energy === 0, `${label}: an empty spin`);
    took = awaitReturn(sim, `${label} after the empty spin`);
    assert(took <= RESTORE_DELAY + 0.05 && w.energy === w.params.spinCost && w.hero.x === start.x && w.hero.y === start.y, `${label}: the energy and the hero back`);
    assert(sim.command({ t: 'spin' }) === true && doorOpen(w), `${label}: the spin from the middle wins`);
    replays(sim, `room 6 spins ${label}`);
  }
});

/** Room 6: the hero `d` units off the middle towards `deg` (0 — the red on the right, 30 — between it and the green below it). */
function offMiddle(w: World, deg: 30 | 210, d = 0.8): { x: number; y: number } {
  const s = w.arena.heroStart, k = deg === 30 ? 1 : -1;
  return { x: s.x + k * d * 0.866, y: s.y + k * d * 0.5 };
}

check('room 6: the goal is ONE action — two partial spins (4 + 4 by two spins with a return between) and a chain then a spin inside one return window (1 + 5: a chain takes one here — the two of a colour stand opposite, out of a link\'s reach) never add up: the door stays shut, the lamps never above one action\'s kills (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const sim = room(SPIN, k), w = sim.world, label = `seed ${k}`;
    let maxLit = 0;
    const watch = (seconds: number): void => { const end = w.time + seconds - 1e-9; until(sim, x => { maxLit = Math.max(maxLit, goalLamps(x).lit); return x.time >= end; }, Math.ceil(seconds * 60 * 8) + 60); };
    // Two spins of four, each off the middle on another side (the two opposite never struck), the return between.
    for (const deg of [30, 210] as const) {
      walkTo(sim, offMiddle(w, deg), 0.03);
      const mark = w.events.length;
      assert(sim.command({ t: 'spin' }) === true, `${label}: the spin at ${deg}°`);
      const kills = w.events.slice(mark).filter(e => e.type === 'kill').length;
      maxLit = Math.max(maxLit, goalLamps(w).lit);
      assert(kills === 4 && !doorOpen(w) && goalProgress(w).done === 4, `${label}: four by the spin at ${deg}° (${kills}), the door shut (${JSON.stringify(goalProgress(w))})`);
      awaitReturn(sim, `${label} after the spin at ${deg}°`);
      watch(0.2);
    }
    assert(!doorOpen(w) && w.strike?.best === 4 && maxLit <= 4, `${label}: two spins of four — shut, lamps at most ${maxLit}`);
    // A chain, then — before its return is due — a walk back to the middle and a spin of the rest.
    const reds = starts(w).filter((_, i) => w.arena.enemies[i].color === RED_COLOUR);
    // Two of a colour, if the commands can draw them (they stand opposite: in this ring they cannot) — else one.
    let chain: ChainLink[] = reds;
    const a = linkPoint(w, reds[0])!, b = linkPoint(w, reds[1])!;
    sim.command({ t: 'begin', x: a.x, y: a.y });
    sim.command({ t: 'sweep', fx: a.x, fy: a.y, x: b.x, y: b.y });
    if (w.chain.length !== 2) { sim.command({ t: 'cancel' }); chain = [reds[0]]; } else sim.command({ t: 'cancel' });
    const plan = draw(sim, chain), events = dash(sim);
    planIsDash(plan, events, `${label} chain`);
    assert(plan.kills === chain.length && !doorOpen(w), `${label}: a chain of ${chain.length}`);
    const dashed = w.events.length;
    walkTo(sim, w.arena.heroStart, 0.03);
    assert(restores(w, dashed) === 0 && w.enemies.length === 6 - chain.length && w.energy >= w.params.spinCost, `${label}: back in the middle before the return`);
    const mark = w.events.length;
    assert(sim.command({ t: 'spin' }) === true, `${label}: the spin after the chain`);
    const kills = w.events.slice(mark).filter(e => e.type === 'kill').length;
    maxLit = Math.max(maxLit, goalLamps(w).lit);
    assert(kills === 6 - chain.length && w.enemies.length === 0 && !doorOpen(w) && goalProgress(w).done === 6 - chain.length, `${label}: ${chain.length} + ${kills} by two actions — the door shut (${JSON.stringify(goalProgress(w))})`);
    watch(0.5);
    assert(maxLit <= 6 - chain.length && !doorOpen(w), `${label}: the lamps at most ${maxLit}`);
    awaitReturn(sim, `${label} after the chain and the spin`);
    assert(sim.command({ t: 'spin' }) === true && doorOpen(w), `${label}: then one spin from the middle wins`);
    replays(sim, `room 6 one action ${label}`);
    console.log(`   ${label}: spins 4 + 4, then a chain of ${chain.length} + a spin of ${6 - chain.length} — shut each time`);
  }
});

check('rooms 5–7 do not follow a hostile panel (the view builds them from the sandbox panel): with jump price 8, jump radius 1, body 0.5, hero circle ×1.6, enemies ×1.5, touch ×1.2, hero speed 0.5, spin 6 / 1 / 0.5, hero HP 3, no walk into the door — the helpers still solve them by the commands', () => {
  const hostile = { ...defaultParams(), jumpCost: 8, jumpRadius: 1, bodyRadius: 0.5, heroHitFactor: 1.6, enemyScale: 1.5, touchFactor: 1.2, heroSpeed: 0.5, spinCost: 6, spinDamage: 1, spinRadius: 0.5, heroHp: 3, doorWalkIn: false };
  const hostileRoom = (n: number, k: number): Simulation => {
    const loadout = prologueLoadout(n);
    return new Simulation({ arena: prologueRoom(n).id, params: prologueParams(n, hostile), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  };
  for (const k of [1, 2]) {
    const label = `seed ${k}`;
    // Room 5: the jump hand's spot and click, then the walk into the door.
    const s5 = hostileRoom(JUMP, k), w5 = s5.world;
    assert(canJump(w5) && w5.energy === 2, `${label} room 5: one jump of energy (${w5.energy})`);
    const aim = prologueJumpAim(w5, JUMP)!;
    walkTo(s5, aim.spot, 0.03);
    assert(prologueJumpAim(w5, JUMP)!.ready && s5.command({ t: 'jump', x: aim.target.x, y: aim.target.y }) === true, `${label} room 5: the hand's jump`);
    land(s5);
    assert(farBank(w5), `${label} room 5: the far bank`);
    walkTo(s5, { x: w5.arena.door.x - 1.2, y: w5.arena.door.y }, 0.1);
    walkFor(s5, 1, 0, 1.5);
    assert(w5.status === 'victory', `${label} room 5: won (${w5.status})`);
    // Room 6: ready from the start; a chain of one, the return (no post waits on the hero), then the spin wins.
    const s6 = hostileRoom(SPIN, k), w6 = s6.world;
    assert(prologueSpinReady(w6, SPIN), `${label} room 6: ready`);
    draw(s6, [starts(w6)[0]]);
    dash(s6);
    awaitReturn(s6, `${label} room 6`);
    assert(!w6.restore?.wait && s6.command({ t: 'spin' }) === true && doorOpen(w6), `${label} room 6: the spin wins`);
    // Room 7 (without the view's hero: the panel's HP would be 3): 5 of 15, the drink heals and opens the door.
    const s7 = hostileRoom(POTION, k), w7 = s7.world;
    assert(w7.hero.hp === 5 && w7.hero.maxHp === 15, `${label} room 7: HP ${w7.hero.hp}/${w7.hero.maxHp}`);
    assert(s7.command({ t: 'item', kind: 'healing', x: 0, y: 0 }) === true && (w7.hero.hp as number) === 14 && doorOpen(w7), `${label} room 7: healed to ${w7.hero.hp}`);
  }
});

check('room 7 «Зелье»: the hero starts with 5 HP of 15 even when the view gives 15 of 15, with one healing potion and nothing else; standing changes nothing; drinking it heals him (+itemHeal) and opens the door; a second drink is refused; the walk into the door wins (seeds 1–3)', () => {
  for (const k of [1, 2, 3]) {
    const loadout = prologueLoadout(POTION)!;
    // As the view starts it: the run's HP 15/15 given, the arena's start HP over it.
    const sim = new Simulation({ arena: prologueRoom(POTION).id, params: prologueParams(POTION), seed: seedOf(k), record: true, hero: { hp: 15, maxHp: 15 }, loadout });
    const w = sim.world, label = `seed ${k}`;
    const items = Object.entries(w.kit!.items).filter(([, n]) => n > 0);
    assert(w.hero.hp === 5 && w.hero.maxHp === 15 && JSON.stringify(items) === JSON.stringify([['healing', 1]]) && w.energy === 0 && w.enemies.length === 0, `${label}: HP ${w.hero.hp}/${w.hero.maxHp}, items ${JSON.stringify(items)}`);
    assert(!doorOpen(w) && goalLamps(w).total === 1 && goalLamps(w).lit === 0, `${label}: the door shut, one lamp`);
    wait(sim, 3);
    assert(w.hero.hp === 5 && !doorOpen(w), `${label}: standing — nothing`);
    // The door does not let him in while shut.
    walkTo(sim, { x: w.arena.door.x - 1.2, y: w.arena.door.y }, 0.1);
    walkFor(sim, 1, 0, 1.5);
    assert(w.status === 'playing', `${label}: the shut door does not win`);
    const mark = w.events.length;
    assert(sim.command({ t: 'item', kind: 'healing', x: w.hero.x, y: w.hero.y }) === true, `${label}: the drink`);
    assert(w.hero.hp === Math.min(15, 5 + w.params.itemHeal) && w.hero.hp > 5 && w.kit!.items.healing === 0, `${label}: healed to ${w.hero.hp}`);
    assert(doorOpen(w) && w.events.slice(mark).some(e => e.type === 'goals') && goalLamps(w).lit === 1, `${label}: the goal, the door opens`);
    assert(sim.command({ t: 'item', kind: 'healing', x: w.hero.x, y: w.hero.y }) === false, `${label}: no second potion`);
    walkFor(sim, -1, 0, 0.6);
    walkFor(sim, 1, 0, 1.5);
    assert((w.status as string) === 'victory', `${label}: the walk into the door wins (${w.status})`);
    replays(sim, `room 7 ${label}`);
  }
});

check('task 9 fields stay in their rooms: `strike` only in room 6, the return state of room 5 holds no enemies; a run arena has neither, and its spin and heal act as before', () => {
  const spinRoom = worldState(room(SPIN).world) as Record<string, unknown>, jumpRoom = worldState(room(JUMP).world) as Record<string, unknown>;
  assert(JSON.stringify(spinRoom.strike) === JSON.stringify({ best: 0 }) && !('strike' in jumpRoom) && JSON.stringify(jumpRoom.restore) === JSON.stringify({ ids: [] }), 'the rooms\' state');
  const sim = new Simulation({ arena: 'glade', params: rtRunParams(defaultParams()), seed: seedOf(3), loadout: { items: { healing: 1 }, energy: 7 }, hero: { hp: 10, maxHp: 15 } });
  const w = sim.world;
  wait(sim, 3);
  sim.command({ t: 'spin' });
  sim.command({ t: 'item', kind: 'healing', x: 0, y: 0 });
  const state = worldState(w) as Record<string, unknown>;
  assert(!('strike' in state) && !('restore' in state) && w.stage === 'goals' && !doorOpen(w) && w.hero.hp === 15, `the run arena: no prologue state, the heal does not open the door (${w.stage})`);
});

check('old worlds are untouched: a run arena hashes without the prologue fields (no `restore`, no calm), the same seed gives the same world twice', () => {
  for (const id of ['glade', 'marked', 'outpost']) {
    const a = new Simulation({ arena: id, params: prologueParams(CROWD), seed: seedOf(5) }), b = new Simulation({ arena: id, params: prologueParams(CROWD), seed: seedOf(5) });
    for (let i = 0; i < 300; i++) { a.tick(); b.tick(); }
    const state = worldState(a.world) as Record<string, unknown>;
    assert(!('restore' in state) && a.hash() === b.hash(), `${id}`);
  }
  // A room with the return hashes its state (the ids and the due return decide the future).
  const sim = room(2), state = worldState(sim.world) as Record<string, unknown>;
  assert(JSON.stringify(state.restore) === JSON.stringify({ ids: startEnemyIds(sim.world) }), 'the return state is hashed');
});

// --- Task 13: room 9 «Щит» -------------------------------------------------------------------------------------------

const shieldBlocks = (events: readonly WorldEvent[]): Extract<WorldEvent, { type: 'shieldBlock' }>[] => events.flatMap(e => e.type === 'shieldBlock' ? [e] : []);
const hits = (events: readonly WorldEvent[]): Extract<WorldEvent, { type: 'hit' }>[] => events.flatMap(e => e.type === 'hit' ? [e] : []);
/** Some enemy is in touch reach of the hero now (a touch would land). */
const touched = (w: World): boolean => w.enemies.some(e => dist(e, w.hero) <= touchDistanceOf(w.params, e) + CONTACT_SLACK);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The hand's chain of room 9 (`prologueShieldLinks`), checked against its points (`prologueShieldChain`) and the world left as it
 * was (no random draw, the drawn chain put back); drawn by the commands with `pause` ticks between links.
 */
function drawShieldChain(sim: Simulation, pause = 2): { links: ChainLink[]; plan: ChainPlan } {
  const w = sim.world, before = sim.hash();
  const links = prologueShieldLinks(w), points = prologueShieldChain(w);
  assert(links && points && links.length >= 3, `the hand has a chain of 3+ (${JSON.stringify(links)})`);
  assert(points.length === links.length && points.every((p, i) => { const q = linkPoint(w, links[i])!; return p.x === q.x && p.y === q.y; }), 'the points are the links\'');
  assert(sim.hash() === before && w.chain.length === 0, 'the helper changes nothing');
  return { links, plan: draw(sim, links, pause) };
}

/** Room 9: an empty press (no link taken) wakes the sleepers of the start, as the first press of a player would. */
function wake(sim: Simulation): void {
  const w = sim.world;
  assert(sim.command({ t: 'begin', x: w.arena.width - 0.5, y: 0.5 }) === false && w.chain.length === 0 && !w.asleep, 'the empty press woke them');
}

check('room 9 (design 13.10.2026): the enemies sleep until the first press, as in room 8 — 4 s standing: HP 15, nobody moves, no lamp; walking among them changes nothing; the first press wakes them for good (the room then plays as before: a return does not put them to sleep), the hand\'s chain from the start meets a shield; replay (seeds 1–6)', () => {
  for (let k = 1; k <= 6; k++) {
    const sim = room(SHIELD, k), w = sim.world, label = `seed ${k}`;
    assert(w.asleep === true, `${label}: asleep at the start`);
    wait(sim, 4);
    assert(w.hero.hp === 15 && w.stats.hitsTaken === 0 && allAtPosts(w) && goalProgress(w).done === 0 && w.asleep === true, `${label}: 4 s standing — HP ${w.hero.hp}, at posts ${allAtPosts(w)}`);
    // A walk (not a press) does not wake them.
    walkTo(sim, { x: w.arena.heroStart.x + 0.6, y: w.arena.heroStart.y }, 0.05);
    wait(sim, 1);
    assert(w.asleep === true && w.hero.hp === 15 && allAtPosts(w), `${label}: a walk wakes nobody`);
    walkTo(sim, w.arena.heroStart, 0.05);
    // The first press: the hand's chain of 3+ (from the start ring) — it wakes them, the dash gives the shield, a touch lights lamp 1.
    drawShieldChain(sim);
    assert(!w.asleep, `${label}: the first press woke them`);
    const dashMark = w.events.length;
    dash(sim);
    until(sim, x => x.hero.chainShield <= 0, 60);
    assert(!w.asleep && goalProgress(w).done <= 1, `${label}: awake after the first chain`);
    // After the return they stay awake and walk.
    if (w.stage === 'goals') {
      until(sim, x => x.events.slice(dashMark).some(e => e.type === 'restore') || x.stage === 'greed', 60 * 2);
      wait(sim, 0.5);
      assert(!w.asleep && !allAtPosts(w), `${label}: a return does not put them to sleep, they walk`);
    }
    replays(sim, `room 9 asleep ${label}`);
  }
});

check('room 9 «Щит»: the hand\'s chain of 3+ (`prologueShieldChain`), drawn by the commands, is the drawn chain, its highlight is the dash; the shield (0.5 s) follows and absorbs the crowd\'s touches — `shieldBlock` once per enemy, the HP kept, exactly ONE lamp per chain even when several touch; the ring and the hero come back in the tick the shield ends, before a touch can hurt (design answer 13.10.2026); three such chains open the door; the walk in wins; the journal replays (seeds 1–6)', () => {
  let several = 0;
  for (let k = 1; k <= 6; k++) {
    const sim = room(SHIELD, k), w = sim.world, label = `seed ${k}`;
    assert(w.hero.hp === 15 && w.hero.maxHp === 15 && w.enemies.length === 9 && w.asleep === true && !w.arena.calm && JSON.stringify((worldState(w) as Record<string, unknown>).shieldGoal) === JSON.stringify({ lit: 0 }), `${label}: full HP, nine asleep until the first press, no lamp`);
    for (let chain = 1; chain <= 3; chain++) {
      // The second chain waits for the crowd to close in (its dash ends among several); the others go at once.
      if (chain === 2) until(sim, x => x.enemies.filter(e => dist(e, x.hero) <= touchDistanceOf(x.params, e) + 0.25).length >= 3, 60 * 3);
      const { links, plan } = drawShieldChain(sim);
      const colour = w.enemies.find(e => e.id === links[0].id)!.color;
      assert(plan.kills >= 3 && links.every(l => w.enemies.find(e => e.id === l.id)?.color === colour), `${label}: 3+ kills of one colour`);
      const events = dash(sim);
      planIsDash(plan, events, `${label} chain ${chain}`);
      assert(w.hero.chainShield > 0.5 - 1e-9 - 1 / 60 && goalProgress(w).done === chain - 1, `${label}: the shield is up, no lamp yet (${w.hero.chainShield})`);
      // The window: every touch the shield takes is a block; the HP stays.
      const mark = w.events.length, hp: number = w.hero.hp, t0 = w.time;
      // Ticks while the shield is still up after them (on its last tick it is gone, and a touch then hurts as usual).
      let hurt = 0, upTo = w.time, last: WorldEvent[] = [];
      while (w.hero.chainShield > 0 && w.status === 'playing') {
        const n = w.events.length;
        sim.tick();
        if (w.hero.chainShield > 0) { hurt += hits(w.events.slice(n)).length + (w.hero.hp !== hp ? 1 : 0); upTo = w.time; } else last = w.events.slice(n);
      }
      const blocks = shieldBlocks(w.events.slice(mark));
      assert(blocks.length >= 1 && new Set(blocks.map(b => b.enemyId)).size === blocks.length, `${label} chain ${chain}: blocked ${JSON.stringify(blocks)}`);
      assert(blocks.every(b => w.enemies.some(e => e.id === b.enemyId)) && hurt === 0, `${label}: no hit inside the shield`);
      assert(goalProgress(w).done === chain && goalLamps(w).lit === chain && goalLamps(w).total === 3, `${label} chain ${chain}: one lamp for ${blocks.length} blocks (${goalProgress(w).done})`);
      assert(upTo - t0 < 0.5 + 1e-9, `${label}: the window is 0.5 s`);
      if (blocks.length > 1) several++;
      // The return (design answer 13.10.2026: room 9 only): in the tick the shield ends — the ring at its posts with full HP, the
      // hero on his start, no hit in that tick; the goal met by the third — no return.
      if (chain < 3) {
        const back = last.find(e => e.type === 'restore');
        assert(back?.type === 'restore' && back.hero?.x === w.arena.heroStart.x && allAtPosts(w) && hits(last).length === 0 && w.hero.hp === hp, `${label} chain ${chain}: the return in the tick the shield ends (${JSON.stringify(last.map(e => e.type))})`);
      } else assert(!last.some(e => e.type === 'restore'), `${label}: no return after the goal`);
    }
    assert(w.stage === 'greed' && doorOpen(w), `${label}: three shields open the door`);
    assert(prologueShieldLinks(w) === null && prologueShieldChain(w) === null, `${label}: no hand after the goal`);
    // The walk into the door (the enemies sleep since the door opened: `sleepOnDoor`).
    until(sim, x => {
      const dx = x.arena.door.x - x.hero.x, dy = x.arena.door.y - x.hero.y, d = Math.hypot(dx, dy) || 1;
      sim.command({ t: 'walk', x: dx / d, y: dy / d });
      return x.status !== 'playing';
    }, 60 * 10);
    assert(w.status === 'victory', `${label}: the walk into the door wins (${w.status})`);
    replays(sim, `room 9 ${label}`);
  }
  assert(several >= 3, `several enemies blocked in one window, one lamp (${several} windows)`);
});

check('room 9: a chain of 1 or 2 gives no shield — the touch after it hurts (−1, no lamp, no block) inside the half second a shield would hold; the room comes back 1 s after the dash, as in the other rooms (seeds 1–6)', () => {
  for (const length of [1, 2]) for (let k = 1; k <= 6; k++) {
    const sim = room(SHIELD, k), w = sim.world, label = `${length} link(s), seed ${k}`;
    const { links } = drawShieldChain(sim, 0);
    sim.command({ t: 'cancel' });
    const plan = draw(sim, links.slice(0, length), 0);
    assert(plan.kills === length, `${label}: kills ${plan.kills}`);
    const events = dash(sim);
    planIsDash(plan, events, label);
    assert(w.hero.chainShield === 0, `${label}: no shield`);
    const mark = w.events.length, hp = w.hero.hp, t0 = w.time, dashEnd = w.time;
    until(sim, x => hits(x.events.slice(mark)).length > 0, 60);
    const [hit] = hits(w.events.slice(mark));
    assert(hit.damage === 1 && w.hero.hp === hp - 1 && w.time - t0 <= 0.5 + 1e-9, `${label}: −1 inside 0.5 s (${hit.damage}, ${w.time - t0})`);
    wait(sim, 0.3);
    assert(shieldBlocks(w.events.slice(mark)).length === 0 && goalProgress(w).done === 0 && goalLamps(w).lit === 0, `${label}: no block, no lamp`);
    awaitReturn(sim, label);
    const after = w.time - dashEnd;
    assert(after >= RESTORE_DELAY - 1e-9 && after <= RESTORE_DELAY + 1 / 60 + 1e-9, `${label}: the return ${after.toFixed(3)} s after the dash`);
    replays(sim, `room 9 ${label}`);
  }
});

check('room 9 (design answer 13.10.2026): a hero standing in the crowd after a chain of 3+ takes no hit between the shield\'s end and the return — it comes in that very tick, and the crowd reaches him again only from the posts; a new chain of 3+ inside the window moves the return to the new window\'s end (seeds 1–8)', () => {
  let refreshed = 0;
  for (let k = 1; k <= 8; k++) {
    const sim = room(SHIELD, k), w = sim.world, label = `seed ${k}`;
    drawShieldChain(sim);
    dash(sim);
    const hp = w.hero.hp, mark = w.events.length;
    // Inside the window: if the hand has another chain of 3+, it is drawn at once (one tick) and released — a new window.
    let again = false;
    while (w.hero.chainShield > 0.15 && !again) {
      if (prologueShieldLinks(w)) {
        drawShieldChain(sim, 0);
        dash(sim);
        again = w.hero.chainShield > 0.5 - 1e-9 - 1 / 60;
        assert(again, `${label}: the second chain gives a new shield`);
      } else sim.tick();
    }
    if (again) refreshed++;
    // Stand: no return while the shield is up, then the return in the tick it ends; no hit from the dash to 0.3 s after it.
    let shieldEnd = -1;
    while (w.status === 'playing') {
      const up = w.hero.chainShield > 0, n = w.events.length;
      sim.tick();
      const back = w.events.slice(n).some(e => e.type === 'restore');
      if (w.hero.chainShield > 0) assert(!back, `${label}: no return while the shield is up`);
      else if (up) { shieldEnd = w.time; assert(back || w.stage === 'greed', `${label}: the return in the tick the shield ends`); }
      if (shieldEnd >= 0 && w.time - shieldEnd >= 0.3 - 1e-9) break;
    }
    assert(shieldEnd >= 0 && hits(w.events.slice(mark)).length === 0 && w.hero.hp === hp, `${label}: no hit from the dash to 0.3 s after the shield (${JSON.stringify(hits(w.events.slice(mark)))})`);
    replays(sim, `room 9 ${label}`);
  }
  assert(refreshed >= 2, `a second chain inside the window on several seeds (${refreshed} of 8)`);
});

check('room 9 (design answer 13.10.2026): with the third lamp the door opens and the enemies fall asleep in that tick — a hero standing in the ring takes no hit for 2 s, the enemies do not move; a press does not wake them; the walk into the door wins (seeds 1–6)', () => {
  for (let k = 1; k <= 6; k++) {
    const sim = room(SHIELD, k), w = sim.world, label = `seed ${k}`;
    for (let chain = 1; chain <= 3; chain++) {
      assert(chain === 1 ? w.asleep === true : !w.asleep, `${label}: asleep until the first press, then awake until the goal (chain ${chain})`);
      drawShieldChain(sim);
      dash(sim);
      const mark = w.events.length;
      until(sim, x => x.stage === 'greed' || (x.hero.chainShield <= 0 && x.events.slice(mark).some(e => e.type === 'restore')), 60 * 2);
      if (chain < 3) assert(w.stage === 'goals', `${label}: not yet`);
    }
    assert(w.stage === 'greed' && w.asleep === true, `${label}: the door open, the enemies asleep`);
    const goalsTick = w.events.findIndex(e => e.type === 'goals');
    assert(goalsTick >= 0, `${label}: the goals event`);
    // Stand 2 s among them: no hit, nobody moves.
    const hp = w.hero.hp, mark = w.events.length, at = w.enemies.map(e => ({ id: e.id, x: e.x, y: e.y }));
    assert(w.enemies.some(e => dist(e, w.hero) <= touchDistanceOf(w.params, e) + 0.6), `${label}: the ring is near the hero`);
    wait(sim, 2);
    assert(hits(w.events.slice(mark)).length === 0 && w.hero.hp === hp, `${label}: no hit for 2 s (${JSON.stringify(hits(w.events.slice(mark)))})`);
    assert(w.enemies.every(e => { const a = at.find(p => p.id === e.id); return a && a.x === e.x && a.y === e.y; }), `${label}: the sleepers stand`);
    // A press on a sleeper (a chain started, then cancelled) does not wake them in this room.
    const e0 = w.enemies[0];
    sim.command({ t: 'begin', x: e0.x, y: e0.y });
    sim.command({ t: 'cancel' });
    wait(sim, 0.5);
    assert(w.asleep === true && hits(w.events.slice(mark)).length === 0, `${label}: still asleep after a press`);
    until(sim, x => {
      const dx = x.arena.door.x - x.hero.x, dy = x.arena.door.y - x.hero.y, d = Math.hypot(dx, dy) || 1;
      sim.command({ t: 'walk', x: dx / d, y: dy / d });
      return x.status !== 'playing';
    }, 60 * 10);
    assert(w.status === 'victory' && hits(w.events.slice(mark)).length === 0, `${label}: the walk into the door wins, untouched (${w.status})`);
    replays(sim, `room 9 sleep ${label}`);
  }
});

check('room 9: the invulnerability after a hit absorbs the touches that follow — no lamp, no block; «Щит фокуса» (3 links drawn, the focus on) spares the hero in the crowd — no lamp, no block; the chain released then gives the shield and its lamp (seeds 1–6)', () => {
  for (let k = 1; k <= 6; k++) {
    const sim = room(SHIELD, k), w = sim.world, label = `seed ${k}`;
    // Standing: the crowd walks in and hits; inside the 0.5 s after the hit the touches go on, nothing lights (the ticks while the
    // invulnerability outlasts them; on its last tick the next touch hurts as usual).
    wake(sim);
    until(sim, x => x.stats.hitsTaken > 0, 60 * 3);
    let pressed = 0;
    const mark = w.events.length;
    while (w.hero.invulnerable > 1 / 60 + 1e-9 && w.status === 'playing') { if (touched(w)) pressed++; sim.tick(); }
    assert(pressed > 0, `${label}: the crowd touched him inside the invulnerability`);
    assert(shieldBlocks(w.events.slice(mark)).length === 0 && goalProgress(w).done === 0 && hits(w.events.slice(mark)).length === 0, `${label}: absorbed by the invulnerability, no lamp`);
    // The crowd presses: the hand's chain drawn at once (three links in one tick) — «Щит фокуса» while the focus lasts.
    const mark2 = w.events.length;
    drawShieldChain(sim, 0);
    let guarded = 0, hurtGuarded = 0;
    // The focus starts with the next tick (`stepHero` before the touches): tick, then look.
    do {
      const n = w.events.length;
      if (touched(w) && w.hero.invulnerable <= 1 / 60 + 1e-9) guarded++;
      sim.tick();
      if (focusGuarded(w) && w.events.slice(n).some(e => e.type === 'hit')) hurtGuarded++;
    } while (focusGuarded(w) && w.status === 'playing');
    assert(guarded > 0, `${label}: the crowd touched him under «Щит фокуса» alone`);
    assert(hurtGuarded === 0 && shieldBlocks(w.events.slice(mark2)).length === 0 && goalProgress(w).done === 0, `${label}: spared by the focus, no lamp`);
    // The release: the shield after the dash lights the lamp.
    const mark3 = w.events.length;
    dash(sim);
    until(sim, x => x.hero.chainShield <= 0, 60);
    assert(goalProgress(w).done === 1 && shieldBlocks(w.events.slice(mark3)).length >= 1, `${label}: the shield after the dash lights one lamp`);
    replays(sim, `room 9 ${label}`);
  }
});

check('room 9: the shield over the invulnerability after a hit still counts (the chain shield up — deterministic); a block of a window never lights twice, a new chain is a new window', () => {
  let overlapped = 0;
  for (let k = 1; k <= 10; k++) {
    const sim = room(SHIELD, k), w = sim.world;
    // Hit first, then the hand's chain at once: the dash ends while the hit's invulnerability may still run.
    wake(sim);
    until(sim, x => x.stats.hitsTaken > 0, 60 * 3);
    drawShieldChain(sim, 0);
    dash(sim);
    const mark = w.events.length;
    let both = false;
    while (w.hero.chainShield > 0 && w.status === 'playing') {
      const before = shieldBlocks(w.events.slice(mark)).length;
      sim.tick();
      if (shieldBlocks(w.events.slice(mark)).length > before && w.hero.invulnerable > 0) both = true;
    }
    if (shieldBlocks(w.events.slice(mark)).length) assert(goalProgress(w).done === 1, `seed ${k}: one lamp`);
    if (both) overlapped++;
  }
  assert(overlapped > 0, `a block while both protect (${overlapped} of 10 seeds)`);
});

check('room 9 (review 13.10.2026): a second chain of 3+ started while the first shield window is still open (its lamp already lit) opens a NEW window — a touch in it is blocked again and lights the second lamp (seeds 1–20)', () => {
  let checked = 0;
  for (let k = 1; k <= 20; k++) {
    const sim = room(SHIELD, k), w = sim.world, label = `seed ${k}`;
    drawShieldChain(sim);
    dash(sim);
    // Wait inside the first window for its block (lamp 1), then draw the hand's next chain of 3+ at once while the shield holds.
    until(sim, x => goalProgress(x).done === 1 || x.hero.chainShield <= 0, 60);
    if (goalProgress(w).done !== 1 || w.hero.chainShield <= 0.1) continue;
    while (w.hero.chainShield > 0.1 && !prologueShieldLinks(w)) sim.tick();
    if (!(w.hero.chainShield > 0.1) || !prologueShieldLinks(w)) continue;
    assert(w.shieldGoal?.window?.lit === true, `${label}: the first window lit its lamp`);
    drawShieldChain(sim, 0);
    dash(sim);
    assert(w.hero.chainShield > 0.5 - 1e-9 - 1 / 60, `${label}: the second chain gives a new shield`);
    // The new window: a touch in reach (read from the bodies, not from the events) must be blocked and light lamp 2.
    const mark = w.events.length;
    let touch = false;
    while (w.hero.chainShield > 0 && w.status === 'playing') { if (touched(w)) touch = true; sim.tick(); }
    if (!touch) continue;
    checked++;
    assert(shieldBlocks(w.events.slice(mark)).length >= 1, `${label}: the new window blocks a touch`);
    assert(goalProgress(w).done === 2 && goalLamps(w).lit === 2, `${label}: the new window lights the second lamp (${goalProgress(w).done})`);
    replays(sim, `room 9 new window ${label}`);
  }
  assert(checked >= 3, `a second window with a touch on several seeds (${checked} of 20)`);
});

check('task 13 fields stay in their room: `shieldGoal` only in room 9 (hashed there), `restoreAfterShield` and `sleepOnDoor` only on its arena; on a run arena a chain of 3 kills gives the run\'s shield as before, the touch inside it is spared — with no shield state and no `shieldBlock` event', () => {
  for (const r of PROLOGUE_ROOMS) {
    const state = worldState(room(r.number).world) as Record<string, unknown>;
    assert(('shieldGoal' in state) === (r.number === SHIELD), `${r.id}: shieldGoal`);
    assert(!!r.arena.restoreAfterShield === (r.number === SHIELD) && !!r.arena.sleepOnDoor === (r.number === SHIELD), `${r.id}: room 9 fields`);
  }
  for (let k = 1; k <= 3; k++) {
    const sim = new Simulation({ arena: 'glade', params: { ...rtRunParams(defaultParams()), maxEnemies: 0 }, seed: seedOf(k), record: true }), w = sim.world;
    const h = { x: w.hero.x, y: w.hero.y };
    // Three reds in a line from the hero, two greens next to where the dash ends (they walk in and touch inside the shield).
    const ids = [1, 2, 3].map(i => sim.command({ t: 'place', x: h.x + i * 1.1, y: h.y, color: 0, hp: 1, kind: 'basic' }) as number);
    sim.command({ t: 'place', x: h.x + 3.3 + 0.9, y: h.y + 0.5, color: 1, hp: 1, kind: 'basic' });
    sim.command({ t: 'place', x: h.x + 3.3 + 0.9, y: h.y - 0.5, color: 1, hp: 1, kind: 'basic' });
    const plan = draw(sim, ids.map(id => ({ kind: 'enemy' as const, id })), 0);
    assert(plan.kills === 3, `seed ${k}: three kills planned`);
    const mark = w.events.length;
    dash(sim);
    assert(w.hero.chainShield > 0, `seed ${k}: the run's shield after 3 kills`);
    let touchedInShield = false;
    while (w.hero.chainShield > 1 / 60 + 1e-9 && w.status === 'playing') { sim.tick(); if (touched(w)) touchedInShield = true; }
    const state = worldState(w) as Record<string, unknown>;
    assert(touchedInShield && hits(w.events.slice(mark)).length === 0, `seed ${k}: touched inside the shield, not hurt`);
    assert(!('shieldGoal' in state) && shieldBlocks(w.events).length === 0, `seed ${k}: no shield state, no block events`);
  }
});

console.log(`\n${checks} checks passed`);
