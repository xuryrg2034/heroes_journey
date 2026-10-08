/**
 * The new enemies of the slice and their arenas (stage 2 of the transition, step 2; docs/realtime-slice.md, sections 4–5
 * and 11). Node only: `npm run test:realtime-enemies`.
 *
 * Every check plays the simulation through journalled commands (walk, begin, drag, release, place, teleport, chill) and
 * looks at what the player sees: whether a link is taken, the hero's HP, who dies, the kill counter. Seeds are spread
 * (`Math.imul(k, 2654435761) >>> 0`). The last checks replay a bot's fight on each new arena from its journal to the
 * same hash.
 */
import { arenaTemplate } from './arenas';
import { chainAnchor, hoverRefusal, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { dist, type Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { Enemy, World } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds: neighbouring small seeds roll alike. */
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const DEG = Math.PI / 180;

/** A quiet fight: no newcomers, enemies stand (speed 0), touches do not hurt — only what the test places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  // The first group of the fight is rolled at once: the arena limit 1 keeps it waiting (placed enemies are over it).
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false;
  return Object.assign(p, extra);
}

function fight(arena: string, params: Params, seed: number): Simulation {
  const sim = new Simulation({ arena, params, seed, record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}

const place = (sim: Simulation, x: number, y: number, kind: string, color = 0, hp = 0): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const ticks = (sim: Simulation, n: number): void => { for (let i = 0; i < n && sim.world.status === 'playing'; i++) sim.tick(); };
/** Runs ticks until the dash (or jump) ends. */
const settle = (sim: Simulation): void => { for (let i = 0; i < 240 && sim.world.move; i++) sim.tick(); };
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
/** Chain length (a function: a literal narrowed by an assertion stays readable after a command changes it). */
const chainLength = (w: World): number => w.chain.length;

/** Tries to start a chain on `e` from the hero; cancels it again. True — the link was taken. */
function canStartOn(sim: Simulation, e: Enemy): boolean {
  const ok = sim.command({ t: 'begin', x: e.x, y: e.y }) as boolean;
  sim.command({ t: 'cancel' });
  return ok;
}

/** The journal of the fight so far replays to the same hash. */
function replays(sim: Simulation): boolean {
  const journal = sim.exportJournal()!;
  return replay(JSON.parse(JSON.stringify(journal))).hash() === sim.hash();
}

// ---- Shieldbearer (arena 4 «Стена щитов») ----

check('shieldbearer: no link from the front (the hint says «щит»), a link from the side or the back; the dash kills it', () => {
  for (let k = 1; k <= 3; k++) {
    const sim = fight('shields', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const shield = place(sim, 9.2, 5, 'shield', 1, 1);
    assert(shield.hp === 1 && shield.kind === 'shield', 'placed');
    // The shield faces the hero from the start: the hero is the anchor of the first link and stands in the arc.
    assert(!canStartOn(sim, shield), 'taken from the front');
    assert(hoverRefusal(w, shield) === 'guarded', `hint: ${hoverRefusal(w, shield)}`);
    // Another enemy in front of it: still in the arc — the chain cannot go on to the shieldbearer.
    const front = place(sim, 8.3, 5.6, 'basic', 1);
    sim.command({ t: 'begin', x: front.x, y: front.y });
    sim.command({ t: 'drag', x: shield.x, y: shield.y, mode: 'full' });
    assert(w.chain.length === 1, 'linked from an anchor in front of the shield');
    assert(hoverRefusal(w, shield, true) === 'guarded', 'hint in a chain');
    sim.command({ t: 'cancel' });
    // An enemy beside and behind it (52° off the back): the chain hero → it → the shieldbearer kills both.
    const behind = place(sim, 9.9, 5.9, 'basic', 1);
    sim.command({ t: 'begin', x: behind.x, y: behind.y });
    sim.command({ t: 'drag', x: shield.x, y: shield.y, mode: 'full' });
    assert(chainLength(w) === 2, `linked from the side/back: chain ${chainLength(w)}`);
    sim.command({ t: 'release' });
    settle(sim);
    assert(!alive(w, shield) && !alive(w, behind) && w.stats.kills === 2, `kills ${w.stats.kills}`);
    assert(replays(sim), 'replay');
  }
});

check('shieldbearer: the shield turns to the hero no faster than 90°/s — the hero walking around takes it from behind', () => {
  // Teleported behind it: at once and for ~1.2 s the hero is out of the arc; at 1.5 s the shield has caught up (120°: ±60°).
  const sim = fight('shields', quiet(), seedOf(4)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const shield = place(sim, 9.2, 5, 'shield', 2, 1);
  sim.command({ t: 'teleport', x: 10.6, y: 5 });
  let last = shield.vars.facing, turned = 0;
  for (let i = 0; i < 72; i++) {
    sim.tick();
    let d = Math.abs(shield.vars.facing - last); if (d > Math.PI) d = 2 * Math.PI - d;
    assert(d <= 90 * DEG / 60 + 1e-9, `turned ${d / DEG}° in one tick`);
    turned += d; last = shield.vars.facing;
  }
  assert(Math.abs(turned - 108 * DEG) < 1e-6, `turned ${turned / DEG}° in 1.2 s`);
  assert(canStartOn(sim, shield), 'behind it after 1.2 s: still out of the arc');
  ticks(sim, 18);
  assert(!canStartOn(sim, shield) && hoverRefusal(w, shield) === 'guarded', 'after 1.5 s the shield faces the hero');
  // Walking around it at 4 u/s: from the front (1.5 units away) along the circle for 1.1 s — the hero gets behind the arc.
  sim.command({ t: 'teleport', x: 7.7, y: 5 });
  ticks(sim, 150);
  assert(!canStartOn(sim, shield), 'in front again');
  for (let i = 0; i < 66; i++) {
    const rx = w.hero.x - shield.x, ry = w.hero.y - shield.y, len = Math.hypot(rx, ry);
    // Tangent with a little pull back onto the circle of radius 1.5.
    const pull = (len - 1.5) * 2;
    sim.command({ t: 'walk', x: -ry / len - rx / len * pull, y: rx / len - ry / len * pull });
    sim.tick();
  }
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(canStartOn(sim, shield), `walked around (hero ${w.hero.x.toFixed(2)}, ${w.hero.y.toFixed(2)}): taken from behind`);
  assert(replays(sim), 'replay');
});

check('shieldbearer: frozen (the cold state of step 3) — no shield, it stands and its shield does not turn', () => {
  const sim = fight('shields', quiet({ enemySpeed: 1.2, contactDamage: 1 }), seedOf(5)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const shield = place(sim, 9.2, 5, 'shield', 3, 1);
  assert(!canStartOn(sim, shield), 'shield up');
  sim.command({ t: 'chill', id: shield.id, seconds: 1 });
  const facing = shield.vars.facing, at = { x: shield.x, y: shield.y };
  sim.command({ t: 'teleport', x: 8, y: 6.2 });
  ticks(sim, 30);
  assert(shield.vars.facing === facing && dist(shield, at) < 1e-9, 'frozen: stands, the shield does not turn');
  assert(canStartOn(sim, shield), 'frozen: taken from the front');
  ticks(sim, 40);
  assert(shield.chill === undefined && shield.vars.facing !== facing, 'thawed: turns again');
  assert(!canStartOn(sim, shield), 'thawed: the shield is back');
  assert(w.hero.hp === w.hero.maxHp, 'no touch yet');
  assert(replays(sim), 'replay');
});

/** Kinds of the newcomers that stepped out in `seconds` on `arena` (default pace and floor). */
function newcomerKinds(arena: string, seed: number, seconds: number): string[] {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 40;
  const sim = new Simulation({ arena, params: p, seed }), seen = new Map<number, string>();
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick();
    for (const ev of sim.world.events) if (ev.type === 'spawn') seen.set(ev.enemyId, sim.world.enemies.find(e => e.id === ev.enemyId)?.kind ?? '?');
    sim.world.events.length = 0;
  }
  return [...seen.values()];
}

/** Share of `kind` among the newcomers of an arena over several seeds, and the other kinds that came. */
function shareOf(arena: string, kind: string): { share: number; kinds: Set<string>; total: number } {
  const all = [1, 2, 3, 4].flatMap(k => newcomerKinds(arena, seedOf(k + 10), 20));
  return { share: all.filter(x => x === kind).length / all.length, kinds: new Set(all), total: all.length };
}

check('arena 4 «Стена щитов»: kill 25; about a quarter of newcomers are shieldbearers, no wolves or boars', () => {
  const t = arenaTemplate('shields');
  assert(t.goal === 'kills' && t.killGoal === 25, 'kill 25');
  const { share, kinds, total } = shareOf('shields', 'shield');
  assert(total >= 80 && share > 0.15 && share < 0.35, `shieldbearers ${(share * 100).toFixed(0)}% of ${total}`);
  assert([...kinds].every(kind => kind === 'basic' || kind === 'shield'), `kinds ${[...kinds].join(', ')}`);
});

// ---- Archer (arena 5 «Стрелковая гряда») ----

/** Ticks until `until` holds (at most `max`); returns the ticks run. */
function runUntil(sim: Simulation, until: () => boolean, max = 600): number {
  let n = 0;
  while (n < max && !until() && sim.world.status === 'playing') { sim.tick(); n++; }
  return n;
}
const hits = (w: World, source: string) => w.events.filter(ev => ev.type === 'hit' && ev.source === source).length;

check('archer: keeps 4–6 units from the hero — backs away when he comes nearer, walks up when he is farther', () => {
  const sim = fight('archers', quiet({ enemySpeed: 1.2, heroHp: 40, archerCooldown: 10 }), seedOf(6)), w = sim.world;
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4, y: 5 });
  const archer = place(sim, 6, 5.2, 'archer', 1);
  ticks(sim, 300);
  const near = dist(archer, w.hero);
  assert(near >= 3.95 && near <= 4.3, `backed away to ${near.toFixed(2)}`);
  ticks(sim, 60);
  assert(Math.abs(dist(archer, w.hero) - near) < 1e-9, 'then holds its place');
  sim.command({ t: 'teleport', x: 1.2, y: 1.2 });
  ticks(sim, 420);
  const far = dist(archer, w.hero);
  assert(far >= 5.85 && far <= 6.01, `walked up to ${far.toFixed(2)}`);
  assert(replays(sim), 'replay');
});

check('archer: announces a line for 1 s, then the arrow hurts the hero on it (1 HP); stepping off the line saves him', () => {
  for (let k = 7; k <= 9; k++) {
    const sim = fight('archers', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    sim.command({ t: 'teleport', x: 3, y: 5 });
    const archer = place(sim, 8, 5, 'archer', 0);
    const before = runUntil(sim, () => archer.vars.aim === 1);
    assert(before === 60, `announced after ${before} ticks (first delay 1 s)`);
    const len = archer.vars.len;
    assert(Math.abs(len - 7) < 1e-9 && archer.vars.dx === -1, `line length ${len}, direction ${archer.vars.dx}`);
    let hpEvents = 0;
    const windup = runUntil(sim, () => { hpEvents += hits(w, 'arrow'); w.events.length = 0; return archer.vars.aim !== 1; });
    hpEvents += hits(w, 'arrow');
    assert(windup === 60, `the line stood ${windup} ticks`);
    assert(w.hero.hp === w.hero.maxHp - 1 && hpEvents === 1, `the arrow hit for 1: HP ${w.hero.hp}, hits ${hpEvents}`);
    // The next line (3 s after the last announcement): the hero steps off it sideways and the arrow misses.
    w.events.length = 0;
    const next = runUntil(sim, () => archer.vars.aim === 1);
    assert(next === 120, `next announcement after ${next} ticks (3 s period)`);
    sim.command({ t: 'walk', x: 0, y: 1 });
    runUntil(sim, () => archer.vars.aim !== 1);
    sim.command({ t: 'walk', x: 0, y: 0 });
    assert(w.hero.hp === w.hero.maxHp - 1, 'off the line: no hit');
    assert(replays(sim), 'replay');
  }
});

check('archer: the arrow strikes enemies on the line — weak ones die, a tough one loses 1 HP; the kills are not the player\'s', () => {
  const sim = fight('archers', quiet(), seedOf(10)), w = sim.world;
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 2, y: 5 });
  const archer = place(sim, 8.5, 5, 'archer', 0);
  const weak = place(sim, 6.5, 5.3, 'basic', 1, 0);
  const tough = place(sim, 4.5, 4.7, 'basic', 2, 2);
  const off = place(sim, 5.5, 6.4, 'basic', 3, 0);
  const kills: { credited?: boolean; source?: string }[] = [];
  runUntil(sim, () => { for (const ev of w.events) if (ev.type === 'kill') kills.push(ev); w.events.length = 0; return archer.vars.aim === 1; });
  runUntil(sim, () => { for (const ev of w.events) if (ev.type === 'kill') kills.push(ev); w.events.length = 0; return archer.vars.aim !== 1; });
  for (const ev of w.events) if (ev.type === 'kill') kills.push(ev);
  assert(!alive(w, weak), 'the weak enemy on the line died');
  assert(alive(w, tough) && tough.hp === 1, `the tough one: HP ${tough.hp}`);
  assert(alive(w, off) && off.hp === 0, 'the one off the line is untouched');
  assert(kills.length === 1 && kills[0].source === 'arrow' && kills[0].credited === false, `kill events ${JSON.stringify(kills)}`);
  assert(w.stats.kills === 0 && w.stats.score === 0, `not the player's: kills ${w.stats.kills}, score ${w.stats.score}`);
  assert(w.hero.hp === w.hero.maxHp - 1, 'the hero behind them is hit too (the arrow pierces)');
  assert(replays(sim), 'replay');
});

check('archer: the arrow respects the hero\'s invulnerability (after a chain), and the cold stops the shot', () => {
  const sim = fight('archers', quiet(), seedOf(11)), w = sim.world;
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 3, y: 5 });
  const archer = place(sim, 8, 5, 'archer', 0);
  const prey = place(sim, 4, 5, 'basic', 1, 0);
  runUntil(sim, () => archer.vars.aim === 1);
  ticks(sim, 50);
  // 10 ticks before the arrow: a chain kill on the line leaves the hero 0.5 s of invulnerability.
  sim.command({ t: 'begin', x: prey.x, y: prey.y });
  sim.command({ t: 'release' });
  runUntil(sim, () => archer.vars.aim !== 1);
  assert(!alive(w, prey) && w.hero.chainShield > 0 && Math.abs(w.hero.y - 5) < 1e-6, 'the hero stands on the line, shielded');
  assert(w.hero.hp === w.hero.maxHp, `invulnerable: HP ${w.hero.hp}`);
  // The next line: frozen in the middle of the announcement, the archer does not shoot until it thaws.
  runUntil(sim, () => archer.vars.aim === 1);
  ticks(sim, 30);
  sim.command({ t: 'chill', id: archer.id, seconds: 2 });
  ticks(sim, 100);
  assert(archer.vars.aim === 1 && w.hero.hp === w.hero.maxHp, 'frozen: the line waits, no arrow');
  runUntil(sim, () => archer.vars.aim !== 1);
  assert(w.hero.hp === w.hero.maxHp - 1, `thawed: the arrow flies (HP ${w.hero.hp})`);
  assert(replays(sim), 'replay');
});

check('arena 5 «Стрелковая гряда»: three marked archers are the goal; an arrow killing a marked one counts for the goal only', () => {
  const t = arenaTemplate('archers');
  assert(t.goal === 'marked' && t.enemies.length === 3 && t.enemies.every(e => e.kind === 'archer' && e.marked), 'three marked archers');
  const { share, kinds, total } = shareOf('archers', 'archer');
  assert(total >= 80 && share > 0.07 && share < 0.25, `archers ${(share * 100).toFixed(0)}% of ${total}`);
  assert([...kinds].every(kind => kind === 'basic' || kind === 'archer'), `kinds ${[...kinds].join(', ')}`);
  // Another archer's arrow kills a marked archer: the goal counts it, the player's kills do not.
  const sim = new Simulation({ arena: 'archers', params: quiet(), seed: seedOf(12), record: true }), w = sim.world;
  sim.command({ t: 'clear', keepMarked: true });
  // The marked archer at the top left (7.8, 1.2); the hero to its right, another archer to its left: the line passes it.
  const target = w.enemies.find(e => e.marked && e.x < 9)!;
  sim.command({ t: 'teleport', x: 11.5, y: target.y });
  const shooter = place(sim, 6.6, target.y, 'archer', 1);
  runUntil(sim, () => shooter.vars.aim === 1);
  runUntil(sim, () => shooter.vars.aim !== 1);
  assert(!alive(w, target) && w.stats.markedKills === 1 && w.stats.kills === 0, `marked ${w.stats.markedKills}, kills ${w.stats.kills}`);
  assert(replays(sim), 'replay');
});

// ---- Determinism of the new arenas ----

/** Builds the longest chain it greedily can (enemies and crystals), then releases it — as the bot of realtimeSim.spec.ts. */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w)].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}

const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

check('each new arena: a bot fight of 50 s replays from its journal to the same hash at every checkpoint', () => {
  for (const [k, arena] of ['shields', 'archers'].entries()) {
    const p = defaultParams();
    p.heroHp = 40;
    const sim = new Simulation({ arena, params: p, seed: seedOf(20 + k), record: true });
    const checkpoints: string[] = [];
    for (let tick = 0; tick < 3000 && sim.world.status === 'playing'; tick++) {
      if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
      if (tick === 1500) sim.command({ t: 'goals' });
      if (tick % 40 === 15) playChain(sim);
      sim.tick();
      sim.world.events.length = 0;
      if (sim.world.tick % 300 === 0) checkpoints.push(sim.hash());
    }
    const again: string[] = [];
    const replayed = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), s => { s.world.events.length = 0; if (s.world.tick % 300 === 0) again.push(s.hash()); });
    assert(checkpoints.length >= 5 && checkpoints.every((h, i) => again[i] === h), `${arena}: checkpoints`);
    assert(replayed.hash() === sim.hash(), `${arena}: final hash`);
    console.log(`   ${arena}: ${sim.world.tick} ticks, kills ${sim.world.stats.kills}, hp ${sim.world.hero.hp}, hash ${sim.hash()}`);
  }
});

console.log(`realtime-enemies: ${checks} checks passed`);
