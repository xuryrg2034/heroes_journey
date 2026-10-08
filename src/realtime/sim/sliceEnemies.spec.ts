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
  for (const [k, arena] of ['shields'].entries()) {
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
