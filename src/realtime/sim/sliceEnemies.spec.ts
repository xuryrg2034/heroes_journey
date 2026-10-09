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
import { armedDamage, chainAnchor, hoverRefusal, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { dist, type Vec } from './geometry';
import { defaultParams, runParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { Enemy, World } from './world';
import { archerLine, archerMark, quillsUp, quillsWarning } from './enemies/index';

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

/**
 * The archer's old line (stage 2; phase A, Т6, 09.10.2026: the point shot replaced it, the flag `archerPoint` off brings
 * it back, journals before phase A play it). The checks of the line — and the ones that use its arrow as an enemy's
 * ability killing enemies — play with it explicitly.
 */
const LINE: Partial<Params> = { archerPoint: false };

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

/** A point `d` units from `e` in the direction `angle` (radians). */
const along = (e: Vec, angle: number, d: number): Vec => ({ x: e.x + Math.cos(angle) * d, y: e.y + Math.sin(angle) * d });

/**
 * The link rule against the shield as it faces now (iteration 2.1: the shield wanders): from the front — refused with «щит»,
 * from an enemy in front — refused, from an enemy beside-behind it — taken; the dash kills both. No tick passes between the
 * look at the shield and the commands, so it does not turn meanwhile.
 */
function shieldRule(sim: Simulation, shield: Enemy, color: number): void {
  const w = sim.world, f = shield.vars.facing;
  // The hero straight in front of it, 1.2 away: he is the anchor of the first link and stands in the arc.
  const front = along(shield, f, 1.2);
  sim.command({ t: 'teleport', x: front.x, y: front.y });
  assert(!canStartOn(sim, shield), 'taken from the front');
  assert(hoverRefusal(w, shield) === 'guarded', `hint: ${hoverRefusal(w, shield)}`);
  // An enemy in front of it (20° off its facing): still in the arc — the chain cannot go on to the shieldbearer.
  const inFront = place(sim, along(shield, f + 20 * DEG, 0.9).x, along(shield, f + 20 * DEG, 0.9).y, 'basic', color);
  sim.command({ t: 'begin', x: inFront.x, y: inFront.y });
  sim.command({ t: 'drag', x: shield.x, y: shield.y, mode: 'full' });
  assert(chainLength(w) === 1, 'linked from an anchor in front of the shield');
  assert(hoverRefusal(w, shield, true) === 'guarded', 'hint in a chain');
  sim.command({ t: 'cancel' });
  // An enemy beside and behind it (130° off its facing, out of the 120° arc): the chain hero → it → the shieldbearer.
  const behind = place(sim, along(shield, f + 130 * DEG, 0.9).x, along(shield, f + 130 * DEG, 0.9).y, 'basic', color);
  sim.command({ t: 'begin', x: behind.x, y: behind.y });
  sim.command({ t: 'drag', x: shield.x, y: shield.y, mode: 'full' });
  assert(chainLength(w) === 2, `linked from the side/back: chain ${chainLength(w)}`);
  const kills = w.stats.kills;
  sim.command({ t: 'release' });
  settle(sim);
  assert(!alive(w, shield) && !alive(w, behind) && w.stats.kills === kills + 2, `kills ${w.stats.kills}`);
  sim.command({ t: 'clear', keepMarked: false });
}

check('shieldbearer (iteration 2.1): its shield faces a random direction; no link from the front (hint «щит»), a link from the side or the back — also after it turns to a new direction', () => {
  const facings: number[] = [];
  for (let k = 1; k <= 4; k++) {
    const sim = fight('shields', quiet(), seedOf(k));
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const shield = place(sim, 9.2, 5, 'shield', 1, 1);
    assert(shield.hp === 1 && shield.kind === 'shield', 'placed');
    facings.push(shield.vars.facing);
    shieldRule(sim, shield, 1);
    // A second bearer: wait until it has a new direction and has turned to it, then the rule holds for the new facing.
    const second = place(sim, 9.2, 5, 'shield', 2, 1), first = second.vars.facing;
    sim.command({ t: 'teleport', x: 3, y: 5 });
    let changed = false, prev = second.vars.want;
    runUntil(sim, () => { if (second.vars.want !== prev) changed = true; prev = second.vars.want; return changed && second.vars.facing === second.vars.want; }, 600);
    assert(changed && second.vars.facing === second.vars.want && Math.abs(second.vars.facing - first) > 1e-6, `seed ${k}: a new direction reached`);
    shieldRule(sim, second, 2);
    assert(replays(sim), 'replay');
  }
  // The start direction is random: the four bearers placed at the same point with the hero at the same place differ.
  assert(new Set(facings.map(f => f.toFixed(3))).size === facings.length, `start facings ${facings.map(f => (f / DEG).toFixed(0)).join(', ')}`);
});

check('shieldbearer (iteration 2.1): with no hero near, the shield picks a new random direction every 2–4 s and turns to it no faster than 90°/s', () => {
  const intervals: number[] = [];
  let turns = 0;
  for (let k = 5; k <= 9; k++) {
    const sim = fight('shields', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 1, y: 1 });
    const away = { x: w.hero.x, y: w.hero.y }, shield = place(sim, 9.2, 5, 'shield', 1, 1);
    let last = shield.vars.facing, want = shield.vars.want, since = 0, first = true;
    for (let i = 0; i < 60 * 30; i++) {
      sim.tick();
      since++;
      let d = Math.abs(shield.vars.facing - last); if (d > Math.PI) d = 2 * Math.PI - d;
      assert(d <= 90 * DEG / 60 + 1e-9, `turned ${(d / DEG).toFixed(2)}° in one tick`);
      if (d > 1e-9) turns++;
      last = shield.vars.facing;
      if (shield.vars.want !== want) {
        // The first change comes 2–4 s after it appeared too.
        intervals.push(since / 60);
        since = 0; want = shield.vars.want; first = false;
      }
    }
    assert(!first, 'it changed its direction');
    assert(dist(w.hero, away) < 1e-9 && dist(w.hero, shield) > 8, 'the hero stayed away');
  }
  assert(intervals.length >= 5 * 7 && intervals.every(t => t >= 2 - 1 / 60 - 1e-6 && t <= 4 + 1 / 60 + 1e-6), `intervals ${Math.min(...intervals).toFixed(2)}–${Math.max(...intervals).toFixed(2)} s`);
  // Random within the range (not one fixed period): short and long ones both come.
  assert(Math.min(...intervals) < 2.5 && Math.max(...intervals) > 3.5, `spread ${Math.min(...intervals).toFixed(2)}–${Math.max(...intervals).toFixed(2)} s`);
  assert(turns > 0, 'it turned');
});

check('shieldbearer (iteration 2.1): it does not follow the hero — the hero walking around it does not make it turn to him', () => {
  for (let k = 10; k <= 12; k++) {
    const sim = fight('shields', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 7.7, y: 5 });
    const shield = place(sim, 9.2, 5, 'shield', 1, 1);
    // Let it settle on a direction, then walk around it at 1.5 units for 3 s; between new directions its facing stands.
    runUntil(sim, () => shield.vars.facing === shield.vars.want, 300);
    let still = 0, inArc = 0, steps = 0;
    for (let i = 0; i < 180; i++) {
      const rx = w.hero.x - shield.x, ry = w.hero.y - shield.y, len = Math.hypot(rx, ry), pull = (len - 1.5) * 2;
      sim.command({ t: 'walk', x: -ry / len - rx / len * pull, y: rx / len - ry / len * pull });
      const want = shield.vars.want, facing = shield.vars.facing, settled = facing === want;
      sim.tick();
      if (settled && shield.vars.want === want) { assert(shield.vars.facing === facing, 'turned with no new direction'); still++; }
      if (hoverRefusal(w, shield) === 'guarded') inArc++;
      steps++;
    }
    sim.command({ t: 'walk', x: 0, y: 0 });
    // The hero went around: the shield did not keep him in front (a following shield would, after its first 1.5 s).
    assert(still > 60 && inArc < steps * 0.7, `seed ${k}: still ${still}, hero in the arc ${inArc} of ${steps}`);
    assert(replays(sim), 'replay');
  }
});

check('shieldbearer: the sandbox toggle «щит следит за героем» brings back the old shield — it faces the hero from the start; a run arena gets it off', () => {
  const sim = fight('shields', quiet({ shieldFollowsHero: true }), seedOf(13)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const shield = place(sim, 9.2, 5, 'shield', 1, 1);
  assert(!canStartOn(sim, shield) && hoverRefusal(w, shield) === 'guarded', 'faces the hero from the start');
  assert(runParams({ ...defaultParams(), shieldFollowsHero: true }).shieldFollowsHero === false, 'a run arena: off');
});

check('shieldbearer, toggle «щит следит за героем» (the shield of step 2): it turns to the hero no faster than 90°/s — the hero walking around takes it from behind', () => {
  // Iteration 2.1: the old rule lives on as the sandbox toggle; this check keeps it. Teleported behind it: at once and for ~1.2 s the hero is out of the arc; at 1.5 s the shield has caught up (120°: ±60°).
  const sim = fight('shields', quiet({ shieldFollowsHero: true }), seedOf(4)), w = sim.world;
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
  // The toggle «щит следит за героем» puts the shield in front of the hero (the check is about the cold, not the facing).
  const sim = fight('shields', quiet({ enemySpeed: 1.2, contactDamage: 1, shieldFollowsHero: true }), seedOf(5)), w = sim.world;
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
    // A newcomer killed in the tick it stepped out (an arrow, a blast) is gone before it can be looked at: it is skipped
    // (stage 3a, step 2: on the new layout of «Стрелковая гряда» an arrow met one at its step out).
    for (const ev of sim.world.events) {
      const kind = ev.type === 'spawn' ? sim.world.enemies.find(e => e.id === ev.enemyId)?.kind : undefined;
      if (ev.type === 'spawn' && kind) seen.set(ev.enemyId, kind);
    }
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
  // Stage 3a, step 2: the rows of the left ridge's gap (y 2–4) — the old open row y 5 is a ridge wall now.
  sim.command({ t: 'teleport', x: 4, y: 3 });
  const archer = place(sim, 6, 3.2, 'archer', 1);
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

check('archer, old line (archerPoint off): announces a line for 1 s, then the arrow hurts the hero on it (1 HP); stepping off the line saves him', () => {
  for (let k = 7; k <= 9; k++) {
    const sim = fight('archers', quiet(LINE), seedOf(k)), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    // Stage 3a, step 2: the line runs through the left ridge's gap (y 2–4); the old open row y 5 is a ridge wall now.
    sim.command({ t: 'teleport', x: 3, y: 3 });
    const archer = place(sim, 8, 3, 'archer', 0);
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

check('archer, old line (archerPoint off): the arrow strikes enemies on the line — weak ones die, a tough one loses 1 HP; the kills are not the player\'s', () => {
  const sim = fight('archers', quiet(LINE), seedOf(10)), w = sim.world;
  sim.command({ t: 'clear', keepMarked: false });
  // Stage 3a, step 2: the line runs through the left ridge's gap (y 2–4); the old open row y 5 is a ridge wall now.
  sim.command({ t: 'teleport', x: 2, y: 3 });
  const archer = place(sim, 8.5, 3, 'archer', 0);
  const weak = place(sim, 6.5, 3.3, 'basic', 1, 0);
  const tough = place(sim, 4.5, 2.7, 'basic', 2, 2);
  const off = place(sim, 7, 4.4, 'basic', 3, 0);
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

check('archer, old line (archerPoint off): the arrow respects the hero\'s invulnerability (after a chain), and the cold stops the shot', () => {
  const sim = fight('archers', quiet(LINE), seedOf(11)), w = sim.world;
  sim.command({ t: 'clear', keepMarked: false });
  // Stage 3a, step 2: the line runs through the left ridge's gap (y 2–4); the old open row y 5 is a ridge wall now.
  sim.command({ t: 'teleport', x: 3, y: 3 });
  const archer = place(sim, 8, 3, 'archer', 0);
  const prey = place(sim, 4, 3, 'basic', 1, 0);
  runUntil(sim, () => archer.vars.aim === 1);
  ticks(sim, 50);
  // 10 ticks before the arrow: a chain kill on the line leaves the hero 0.5 s of invulnerability.
  sim.command({ t: 'begin', x: prey.x, y: prey.y });
  sim.command({ t: 'release' });
  runUntil(sim, () => archer.vars.aim !== 1);
  assert(!alive(w, prey) && w.hero.chainShield > 0 && Math.abs(w.hero.y - 3) < 1e-6, 'the hero stands on the line, shielded');
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

check('arena 5 «Стрелковая гряда»: three marked archers are the goal; (old line) an arrow killing a marked one counts for the goal only', () => {
  const t = arenaTemplate('archers');
  assert(t.goal === 'marked' && t.enemies.length === 3 && t.enemies.every(e => e.kind === 'archer' && e.marked), 'three marked archers');
  const { share, kinds, total } = shareOf('archers', 'archer');
  assert(total >= 80 && share > 0.07 && share < 0.25, `archers ${(share * 100).toFixed(0)}% of ${total}`);
  assert([...kinds].every(kind => kind === 'basic' || kind === 'archer'), `kinds ${[...kinds].join(', ')}`);
  // Another archer's arrow kills a marked archer: the goal counts it, the player's kills do not.
  const sim = new Simulation({ arena: 'archers', params: quiet(LINE), seed: seedOf(12), record: true }), w = sim.world;
  sim.command({ t: 'clear', keepMarked: true });
  // The marked archer at the top left (7.8, 1.2); the hero to its right, another archer to its left: the line passes it.
  // Stage 3a, step 2: the hero stands between the ridges (x 9.6) — the right ridge (x 10–11) would hide him at x 11.5.
  const target = w.enemies.find(e => e.marked && e.x < 9)!;
  sim.command({ t: 'teleport', x: 9.6, y: target.y });
  const shooter = place(sim, 6.6, target.y, 'archer', 1);
  runUntil(sim, () => shooter.vars.aim === 1);
  runUntil(sim, () => shooter.vars.aim !== 1);
  assert(!alive(w, target) && w.stats.markedKills === 1 && w.stats.kills === 0, `marked ${w.stats.markedKills}, kills ${w.stats.kills}`);
  assert(replays(sim), 'replay');
});

// ---- Archer: the point shot (phase A, Т6, user decision 09.10.2026; docs/realtime-phase-a.md, section 7) ----

/** The hero's HP now (a function: a value narrowed by an assertion stays readable after more ticks). */
const hpOf = (w: World): number => w.hero.hp;
/** Runs ticks until the archer aims (its mark appears); returns the mark. */
function untilMark(sim: Simulation, archer: Enemy): { at: Vec; r: number; progress: number } {
  runUntil(sim, () => archerMark(sim.world, archer) !== null);
  const mark = archerMark(sim.world, archer);
  assert(mark, 'the archer aims');
  return mark;
}
/** Runs ticks until the archer's aim ends (the arrow fell, or the archer is gone), counting arrow hits on the hero. */
function untilShot(sim: Simulation, archer: Enemy): number {
  const w = sim.world;
  let arrows = 0;
  runUntil(sim, () => { arrows += hits(w, 'arrow'); w.events.length = 0; return archer.vars.aim !== 1 || !alive(w, archer); });
  return arrows + hits(w, 'arrow');
}

check('archer, point: it marks the hero\'s centre (circle 1.0, no line); the hero standing in it loses 1 at the end of the 1 s fill, to an elite archer 2', () => {
  for (const [k, elite, loss] of [[50, false, 1], [51, true, 2], [52, false, 1]] as const) {
    const sim = fight('kills', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const id = sim.command({ t: 'place', x: 8, y: 9.2, color: 0, hp: 0, kind: 'archer', ...elite ? { elite: true } : {} }) as number;
    const archer = w.enemies.find(e => e.id === id)!;
    const before = runUntil(sim, () => archerMark(w, archer) !== null);
    const mark = archerMark(w, archer)!;
    assert(before === 60 && mark.r === 1 && mark.at.x === w.hero.x && mark.at.y === w.hero.y && mark.progress === 0, `marked after ${before} ticks: ${JSON.stringify(mark)}`);
    assert(archerLine(w, archer) === null, 'no line with the point shot');
    let arrows = 0;
    const filled = runUntil(sim, () => { arrows += hits(w, 'arrow'); w.events.length = 0; return archer.vars.aim !== 1; });
    arrows += hits(w, 'arrow');
    assert(filled === 60 && arrows === 1 && hpOf(w) === w.hero.maxHp - loss, `${elite ? 'elite' : 'archer'}: filled ${filled} ticks, ${arrows} arrow, HP ${w.hero.hp} of ${w.hero.maxHp}`);
    assert(archerMark(w, archer) === null, 'the mark is gone after the arrow');
    assert(replays(sim), 'replay');
  }
});

check('archer, point: the hero who steps out of the circle right after the mark appears is not hit; the mark stays where it was', () => {
  for (const [k, x, y] of [[53, 1, 0], [54, -1, 0], [55, 0, -1]] as const) {
    const sim = fight('kills', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const archer = place(sim, 8, 9.2, 'archer', 0);
    const mark = untilMark(sim, archer);
    sim.command({ t: 'walk', x, y });
    ticks(sim, 30);
    sim.command({ t: 'walk', x: 0, y: 0 });
    const still = archerMark(w, archer)!;
    assert(still.at.x === mark.at.x && still.at.y === mark.at.y, 'the mark does not follow the hero');
    const arrows = untilShot(sim, archer);
    assert(arrows === 0 && hpOf(w) === w.hero.maxHp && dist(w.hero, mark.at) > mark.r + 0.5, `stepped out (${dist(w.hero, mark.at).toFixed(2)} from the point): ${arrows} arrows, HP ${w.hero.hp}`);
    assert(replays(sim), 'replay');
  }
});

check('archer, point: enemies in the circle are not touched by the arrow — weak, tough, marked, the archer itself: alive, same HP, no hit events', () => {
  // «Стрелковая гряда»: the marked archer (7.8, 1.2) between the ridges; the hero stands 0.8 below it — its own mark covers it.
  const sim = new Simulation({ arena: 'archers', params: quiet(), seed: seedOf(56), record: true }), w = sim.world;
  sim.command({ t: 'clear', keepMarked: true });
  const marked = w.enemies.find(e => e.marked && e.x < 9)!;
  sim.command({ t: 'teleport', x: marked.x, y: marked.y + 0.8 });
  const weak = place(sim, marked.x + 0.6, marked.y + 1.1, 'basic', 1, 0), tough = place(sim, marked.x - 0.6, marked.y + 1.2, 'basic', 2, 2);
  const others = [marked, weak, tough], hpBefore = others.map(e => e.hp);
  const mark = untilMark(sim, marked);
  assert(others.every(e => dist(e, mark.at) <= mark.r), 'all three stand in the circle');
  let enemyHits = 0, kills = 0;
  const count = (): void => { for (const ev of w.events) { if (ev.type === 'enemyHit') enemyHits++; if (ev.type === 'kill') kills++; } w.events.length = 0; };
  runUntil(sim, () => { count(); return marked.vars.aim !== 1; });
  count();
  assert(hpOf(w) === w.hero.maxHp - 1, `the hero is hit: HP ${w.hero.hp}`);
  assert(others.every((e, i) => alive(w, e) && e.hp === hpBefore[i]) && enemyHits === 0 && kills === 0, `enemies: ${others.map(e => `${alive(w, e)}/${e.hp}`).join(', ')}, hits ${enemyHits}, kills ${kills}`);
  assert(w.stats.markedKills === 0, 'the goal counts nothing');
  assert(replays(sim), 'replay');
});

check('archer, point: killed during the fill (a bomb; also while frozen) — the shot is gone with it; frozen alive — the mark waits, the arrow falls after the thaw', () => {
  for (const frozen of [false, true]) {
    const sim = new Simulation({ arena: 'kills', params: quiet(), seed: seedOf(57), record: true, loadout: { items: { bomb: 1 } } }), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const archer = place(sim, 8, 9.2, 'archer', 0);
    untilMark(sim, archer);
    ticks(sim, 20);
    if (frozen) sim.command({ t: 'chill', id: archer.id, seconds: 3 });
    ticks(sim, 20);
    sim.command({ t: 'item', kind: 'bomb', x: archer.x, y: archer.y });
    assert(!alive(w, archer), 'the bomb killed the archer');
    let arrows = 0;
    for (let i = 0; i < 240; i++) { sim.tick(); arrows += hits(w, 'arrow'); w.events.length = 0; }
    assert(arrows === 0 && hpOf(w) === w.hero.maxHp, `${frozen ? 'frozen, ' : ''}killed: ${arrows} arrows, HP ${w.hero.hp}`);
    assert(replays(sim), 'replay');
  }
  // Frozen and alive: the mark stays (its fill waits), no arrow; after the thaw the fill goes on and the arrow falls.
  const sim = fight('kills', quiet(), seedOf(58)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const archer = place(sim, 8, 9.2, 'archer', 0);
  untilMark(sim, archer);
  ticks(sim, 30);
  sim.command({ t: 'chill', id: archer.id, seconds: 2 });
  const held = archerMark(w, archer)!.progress;
  ticks(sim, 100);
  const waiting = archerMark(w, archer);
  assert(waiting && waiting.progress === held && held > 0.4 && held < 0.6 && hpOf(w) === w.hero.maxHp, `frozen: the mark waits at ${held.toFixed(2)}, HP ${w.hero.hp}`);
  const arrows = untilShot(sim, archer);
  assert(arrows === 1 && hpOf(w) === w.hero.maxHp - 1, `thawed: ${arrows} arrow, HP ${w.hero.hp}`);
  assert(replays(sim), 'replay');
});

check('archer, point: two marks add up — two archers a second apart hit the hero standing in both (−2); at once only the invulnerability after a hit limits them (−1)', () => {
  for (const [k, apart, loss] of [[59, 60, 2], [60, 0, 1]] as const) {
    const sim = fight('kills', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const a = place(sim, 8, 9.2, 'archer', 0);
    ticks(sim, apart);
    const b = place(sim, 11.5, 5.8, 'archer', 1);
    untilMark(sim, b);
    const first = archerMark(w, a);
    assert(apart === 0 ? first !== null : first === null && hpOf(w) === w.hero.maxHp - 1, `the first mark: ${JSON.stringify(first)}, HP ${w.hero.hp}`);
    runUntil(sim, () => a.vars.aim !== 1 && b.vars.aim !== 1);
    assert(hpOf(w) === w.hero.maxHp - loss, `${apart ? 'a second apart' : 'at once'}: HP ${w.hero.hp}`);
    assert(replays(sim), 'replay');
  }
});

check('archer, point: no arrow once the fight is not playing — the hero walks out of the open door while marked: the mark is gone, his HP stays', () => {
  const sim = fight('kills', quiet(), seedOf(61)), w = sim.world;
  sim.command({ t: 'goals' });
  // The door of «Убить 30» at (8, 0.7): the hero stands 1.5 below it, marked; then he steps into it.
  sim.command({ t: 'teleport', x: 8, y: 2.2 });
  const archer = place(sim, 8, 6.5, 'archer', 0);
  untilMark(sim, archer);
  sim.command({ t: 'walk', x: 0, y: -1 });
  runUntil(sim, () => false, 40);
  assert(w.status === 'victory' && archerMark(w, archer) === null, `status ${w.status}`);
  for (let i = 0; i < 120; i++) sim.tick();
  assert(hpOf(w) === w.hero.maxHp, `after the victory: HP ${w.hero.hp}`);
});

check('archer: a journal without `archerPoint` (before phase A) replays with the line; on by default; a run forces the point', () => {
  const old = fight('kills', quiet(LINE), seedOf(62)), ow = old.world;
  old.command({ t: 'teleport', x: 8, y: 5 });
  const archer = place(old, 8, 9.2, 'archer', 0);
  ticks(old, 150);
  assert(ow.hero.hp === ow.hero.maxHp - 1 && archer.vars.pt === undefined && archer.vars.len > 4, `the line hit: HP ${ow.hero.hp}`);
  const journal = JSON.parse(JSON.stringify(old.exportJournal()!));
  delete journal.params.archerPoint;
  delete journal.params.archerMarkRadius;
  const again = replay(journal), aw = again.world;
  const twin = aw.enemies.find(e => e.id === archer.id)!;
  assert(JSON.stringify(twin.vars) === JSON.stringify(archer.vars) && aw.hero.hp === ow.hero.hp && aw.tick === ow.tick, `replayed with the line: ${JSON.stringify(twin.vars)}, HP ${aw.hero.hp}`);
  const p = defaultParams(); p.archerPoint = false;
  assert(defaultParams().archerPoint === true && runParams(p).archerPoint === true, 'on by default; a run plays the point');
});

// ---- Sapper (arena 6 «Пороховой склад») ----

/** Ticks from now until a `blast` event, collecting kill events; -1 when none in `max` ticks. */
function untilBlast(sim: Simulation, kills: { enemyId: number; source?: string; credited?: boolean }[] = [], max = 300): number {
  const w = sim.world;
  for (let n = 1; n <= max && w.status === 'playing'; n++) {
    sim.tick();
    let blast = false;
    for (const ev of w.events) { if (ev.type === 'kill') kills.push(ev); if (ev.type === 'blast') blast = true; }
    w.events.length = 0;
    if (blast) return n;
  }
  return -1;
}

check('sapper killed by the chain: its fuse burns 0.8 s, the blast (radius 1.5) hits enemies around it — the kills are the player\'s', () => {
  for (let k = 13; k <= 15; k++) {
    const sim = fight('powder', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const sapper = place(sim, 9, 5, 'sapper', 0);
    const l1 = place(sim, 10.5, 5.8, 'basic', 0), l2 = place(sim, 11.5, 4.3, 'basic', 0);
    const weak = place(sim, 9, 6.2, 'basic', 1, 0), tough2 = place(sim, 8.3, 4, 'basic', 2, 2), tough3 = place(sim, 9.8, 3.9, 'basic', 3, 3);
    const outside = place(sim, 9, 7.05, 'basic', 1, 0);
    // The chain goes on past the sapper: the hero ends 2.7 units from it, out of the blast.
    sim.command({ t: 'begin', x: sapper.x, y: sapper.y });
    sim.command({ t: 'drag', x: l1.x, y: l1.y, mode: 'full' });
    sim.command({ t: 'drag', x: l2.x, y: l2.y, mode: 'full' });
    assert(w.chain.length === 3, `chain ${w.chain.length}`);
    sim.command({ t: 'release' });
    let killedAt = -1;
    for (let n = 0; n < 60 && killedAt < 0; n++) { sim.tick(); if (w.events.some(ev => ev.type === 'kill' && ev.enemyId === sapper.id)) killedAt = n; w.events.length = 0; }
    assert(killedAt >= 0 && w.blasts.length === 1, 'the sapper died and its fuse burns');
    const kills: { enemyId: number; source?: string; credited?: boolean }[] = [];
    const fuse = untilBlast(sim, kills);
    // The dash kills before the tick's world step, whose fuse step burns the first 1/60 s: 1 + 47 ticks = 0.8 s.
    assert(fuse === 47, `the blast went off ${fuse} ticks after the kill tick (0.8 s)`);
    assert(!alive(w, weak) && !alive(w, tough2) && alive(w, tough3) && tough3.hp === 1 && alive(w, outside), 'weak and HP 2 die, HP 3 → 1, out of the radius untouched');
    const blastKills = kills.filter(ev => ev.source === 'blast');
    assert(blastKills.length === 2 && blastKills.every(ev => ev.credited === true), `blast kills ${JSON.stringify(blastKills)}`);
    assert(w.stats.kills === 5, `kills: 3 by the chain + 2 by the blast = ${w.stats.kills}`);
    assert(w.hero.hp === w.hero.maxHp && dist(w.hero, sapper) > 2.5, 'the hero ended the chain out of the blast');
    assert(replays(sim), 'replay');
  }
});

check('sapper touching the hero lights its own fuse (1.2 s, no touch damage): the blast hurts the hero and enemies near, kills not the player\'s', () => {
  // Standing in it: −2. Walking away right after it lit: unhurt.
  for (const walkAway of [false, true]) {
    const sim = fight('powder', quiet({ contactDamage: 1 }), seedOf(walkAway ? 17 : 16)), w = sim.world;
    sim.command({ t: 'teleport', x: 9, y: 5 });
    const sapper = place(sim, 9.5, 5, 'sapper', 0);
    const weak = place(sim, 10.3, 5.6, 'basic', 1, 0);
    sim.tick();
    assert(sapper.vars.lit === 1 && sapper.vars.fuse === 1.2, `lit by the touch: ${JSON.stringify(sapper.vars)}`);
    if (walkAway) sim.command({ t: 'walk', x: -1, y: 0 });
    const touches: string[] = [];
    let n = 0;
    for (; n < 120 && !w.events.some(ev => ev.type === 'blast'); n++) {
      for (const ev of w.events) if (ev.type === 'hit') touches.push(ev.source);
      w.events.length = 0;
      sim.tick();
    }
    for (const ev of w.events) if (ev.type === 'hit') touches.push(ev.source);
    assert(n === 72, `blast ${n} ticks after lighting (1.2 s)`);
    assert(!alive(w, sapper) && !alive(w, weak), 'the sapper and the weak enemy beside it died in the blast');
    assert(w.stats.kills === 0 && w.stats.score === 0, `not the player's: kills ${w.stats.kills}`);
    if (walkAway) assert(w.hero.hp === w.hero.maxHp && touches.length === 0, `walked away: HP ${w.hero.hp}, hits ${touches.join(',')}`);
    else assert(w.hero.hp === w.hero.maxHp - 2 && touches.join(',') === 'blast', `stood in it: HP ${w.hero.hp}, hits ${touches.join(',')} (the sapper's touch does not hurt)`);
    assert(replays(sim), 'replay');
  }
});

check('sapper: the blast respects the hero\'s invulnerability; a chain reaction of sappers keeps the player\'s credit; the cold holds the fuse', () => {
  // The chain ends on the sapper: the hero stands in its blast. Shield after a chain 1 s (> fuse 0.8 s): unhurt; 0.5 s: −2.
  for (const shield of [1, 0.5]) {
    const sim = fight('powder', quiet({ chainShield: shield }), seedOf(18)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const sapper = place(sim, 9, 5, 'sapper', 0);
    sim.command({ t: 'begin', x: sapper.x, y: sapper.y });
    sim.command({ t: 'release' });
    assert(untilBlast(sim) > 0, 'blast');
    assert(w.hero.hp === w.hero.maxHp - (shield > 0.8 ? 0 : 2), `chain shield ${shield} s: HP ${w.hero.hp}`);
  }
  // Two sappers 1.2 apart: the chain kills the first, its blast kills the second, whose blast kills an enemy beyond — all credited.
  const sim = fight('powder', quiet({ chainShield: 1.5 }), seedOf(19)), w = sim.world;
  sim.command({ t: 'teleport', x: 7, y: 5 });
  const first = place(sim, 8, 5, 'sapper', 0), second = place(sim, 9.2, 5, 'sapper', 1), beyond = place(sim, 10.4, 5.4, 'basic', 2, 1);
  sim.command({ t: 'begin', x: first.x, y: first.y });
  sim.command({ t: 'release' });
  assert(untilBlast(sim) > 0 && !alive(w, second) && w.blasts.length === 1, 'the first blast killed the second sapper and lit its fuse');
  assert(untilBlast(sim) === 48 && !alive(w, beyond), 'its own blast 0.8 s later killed the enemy beyond');
  assert(w.stats.kills === 3, `kills credited along the chain reaction: ${w.stats.kills}`);
  assert(replays(sim), 'replay');
  // The cold stops a fuse burning on a living sapper: lit by touch, frozen 1 s → the blast comes 1 s later.
  const cold = fight('powder', quiet(), seedOf(20));
  cold.command({ t: 'teleport', x: 9, y: 5 });
  const lit = place(cold, 9.5, 5, 'sapper', 0);
  cold.tick();
  cold.command({ t: 'chill', id: lit.id, seconds: 1 });
  const n = untilBlast(cold);
  assert(n === 132, `frozen 1 s: blast after ${n} ticks (1 s cold + 1.2 s fuse)`);
  assert(replays(cold), 'replay');
});

check('arena 6 «Пороховой склад»: kill 25; sappers are about 15% of newcomers', () => {
  const t = arenaTemplate('powder');
  assert(t.goal === 'kills' && t.killGoal === 25, 'kill 25');
  const { share, kinds, total } = shareOf('powder', 'sapper');
  assert(total >= 80 && share > 0.07 && share < 0.25, `sappers ${(share * 100).toFixed(0)}% of ${total}`);
  assert([...kinds].every(kind => kind === 'basic' || kind === 'sapper'), `kinds ${[...kinds].join(', ')}`);
});

// ---- Porcupine (arena 7 «Колючие заросли») ----

/** Draws a chain through `links` from the hero and releases it; runs until the dash ends. Returns the quill hits. */
function dashThrough(sim: Simulation, links: Enemy[]): number {
  const w = sim.world;
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(w.chain.length === links.length, `chain ${w.chain.length} of ${links.length}`);
  sim.command({ t: 'release' });
  let quills = 0;
  for (let i = 0; i < 240 && w.move && w.status === 'playing'; i++) {
    sim.tick();
    quills += hits(w, 'quills');
    w.events.length = 0;
  }
  return quills;
}

check('porcupine, quills always up (slider «иглы опущены» 0): every chain hit on it hurts the hero for 1 — during the dash and through invulnerability', () => {
  for (let k = 21; k <= 23; k++) {
    // Iteration 2.1: the quills go up and down; «опущены 0 с» keeps them up (the quills of step 2) for this check.
    const sim = fight('thorns', quiet({ porcupineDownTime: 0 }), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    // basic → porcupine → porcupine → basic: two quill hits in one dash, the second within the first one's invulnerability.
    const a = place(sim, 9, 4.5, 'basic', 2), p1 = place(sim, 10.1, 4.3, 'porcupine', 2, 1), p2 = place(sim, 11.1, 4, 'porcupine', 2, 1), b = place(sim, 11.6, 3, 'basic', 2);
    const quills = dashThrough(sim, [a, p1, p2, b]);
    assert(quills === 2 && w.hero.hp === w.hero.maxHp - 2, `two porcupines: quills ${quills}, HP ${w.hero.hp}`);
    assert(w.stats.kills === 4 && !alive(w, p1) && !alive(w, p2), 'the porcupines die to the chain as everyone');
    // A wounded porcupine hurts too: HP 3 as the first link survives the strike of 1.
    const tough = place(sim, w.hero.x + 1, w.hero.y, 'porcupine', 1, 3);
    ticks(sim, 40);
    const before = w.hero.hp;
    assert(dashThrough(sim, [tough]) === 1 && alive(w, tough) && tough.hp === 2 && w.hero.hp === before - 1, `wounded: HP ${w.hero.hp}, its HP ${tough.hp}`);
    assert(replays(sim), 'replay');
  }
});

check('porcupine: the quills can kill — the hero falls before the strike lands; the cold takes the quills off', () => {
  const sim = fight('thorns', quiet({ heroHp: 1, porcupineDownTime: 0 }), seedOf(24)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const porcupine = place(sim, 9, 5, 'porcupine', 0, 1), after = place(sim, 10.2, 5, 'basic', 0);
  dashThrough(sim, [porcupine, after]);
  assert(w.status === 'defeat' && w.hero.hp === 0, `defeat by the quills: ${w.status}`);
  assert(alive(w, porcupine) && alive(w, after) && w.stats.kills === 0, 'the strike did not land, the dash stopped');
  assert(replays(sim), 'replay');
  // Frozen: no quills.
  const cold = fight('thorns', quiet({ porcupineDownTime: 0 }), seedOf(25)), cw = cold.world;
  cold.command({ t: 'teleport', x: 8, y: 5 });
  const frozen = place(cold, 9, 5, 'porcupine', 0, 1);
  cold.command({ t: 'chill', id: frozen.id, seconds: 2 });
  assert(dashThrough(cold, [frozen]) === 0 && cw.hero.hp === cw.hero.maxHp && !alive(cw, frozen), 'frozen: killed without quills');
  assert(replays(cold), 'replay');
});

// ---- Iteration 2.1: the quills go up and down (docs/realtime-slice.md, section 12) ----

/** Runs of the quill state of `e` over `seconds`: [up, ticks] for each run, and ticks of trembling seen in each down run. */
function quillRuns(sim: Simulation, e: Enemy, seconds: number): { runs: [boolean, number][]; warn: number[]; warnWhileUp: number } {
  const w = sim.world, runs: [boolean, number][] = [], warn: number[] = [];
  let warnWhileUp = 0;
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick();
    const up = quillsUp(w, e), trembling = quillsWarning(w, e);
    if (!runs.length || runs[runs.length - 1][0] !== up) { runs.push([up, 0]); if (!up) warn.push(0); }
    runs[runs.length - 1][1]++;
    if (trembling) { if (up) warnWhileUp++; else warn[warn.length - 1]++; }
  }
  return { runs, warn, warnWhileUp };
}

check('porcupine (iteration 2.1): the quills are up 2.5 s and down 2.0 s; they tremble the last 0.5 s before going up; the start phase is random', () => {
  const firsts: string[] = [];
  for (let k = 50; k <= 57; k++) {
    const sim = fight('thorns', quiet(), seedOf(k));
    sim.command({ t: 'teleport', x: 3, y: 5 });
    const p = place(sim, 9, 5, 'porcupine', 0, 1);
    const { runs, warn, warnWhileUp } = quillRuns(sim, p, 20);
    firsts.push(`${runs[0][0] ? 'up' : 'down'} ${runs[0][1]}`);
    // Whole runs (not the first and the last, cut by the start and the end): 150 ticks up, 120 down (±1 for the 1/60 s grid).
    const whole = runs.slice(1, -1);
    assert(whole.length >= 6, `runs ${whole.length}`);
    for (const [up, n] of whole) assert(Math.abs(n - (up ? 150 : 120)) <= 1, `seed ${k}: ${up ? 'up' : 'down'} ${n} ticks`);
    // Trembling: 30 ticks (0.5 s) at the end of each whole down run, never while up.
    const wholeDownWarn = warn.slice(runs[0][0] ? 0 : 1, runs[runs.length - 1][0] ? undefined : -1);
    assert(warnWhileUp === 0 && wholeDownWarn.every(n => Math.abs(n - 30) <= 1), `seed ${k}: trembling ${wholeDownWarn.join(',')}, while up ${warnWhileUp}`);
  }
  // Each porcupine starts at its own point of the cycle: up and down both come first, and the first runs differ.
  assert(firsts.some(f => f.startsWith('up')) && firsts.some(f => f.startsWith('down')) && new Set(firsts).size >= 6, `first runs: ${firsts.join('; ')}`);
});

/**
 * Waits until the quills of `p` are in the state `up` with at most `left` game seconds of it left, then draws a chain from
 * the hero to `p` and releases it. Returns the quill hits of the dash and whether the quills were up when the strike landed.
 */
function releaseAtEdge(sim: Simulation, p: Enemy, up: boolean, left: number): { quills: number; upAtHit: boolean; upAtRelease: boolean } {
  const w = sim.world;
  runUntil(sim, () => quillsUp(w, p) === up && p.vars.timer <= left + 1e-9, 600);
  sim.command({ t: 'begin', x: p.x, y: p.y });
  assert(w.chain.length === 1, 'linked');
  const upAtRelease = quillsUp(w, p);
  sim.command({ t: 'release' });
  let quills = 0, upAtHit = false;
  for (let i = 0; i < 240 && w.move && w.status === 'playing'; i++) {
    // The state just before the tick in which the strike lands (the dash runs before the enemies step).
    const now = quillsUp(w, p);
    sim.tick();
    if (w.events.some(ev => ev.type === 'chainHit' && ev.enemyId === p.id)) upAtHit = now;
    quills += hits(w, 'quills');
    w.events.length = 0;
  }
  return { quills, upAtHit, upAtRelease };
}

check('porcupine (iteration 2.1): down at the release — no quills, even if they go up on the way; up at the release — 1 HP, even if they go down on the way', () => {
  for (let k = 60; k <= 62; k++) {
    // Down at the release, up 2 ticks later; the porcupine 1.8 away — the dash (0.2 a tick) gets there after they rose.
    const sim = fight('thorns', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 7.2, y: 5 });
    const a = place(sim, 9, 5, 'porcupine', 0, 1);
    const down = releaseAtEdge(sim, a, false, 2 / 60);
    assert(!down.upAtRelease && down.upAtHit, `seed ${k}: down at the release, up at the hit (${down.upAtRelease}, ${down.upAtHit})`);
    assert(down.quills === 0 && w.hero.hp === w.hero.maxHp && !alive(w, a), `seed ${k}: no quills, HP ${w.hero.hp}`);
    assert(replays(sim), 'replay');
    // Up at the release, down 2 ticks later.
    const sim2 = fight('thorns', quiet(), seedOf(k + 10)), w2 = sim2.world;
    sim2.command({ t: 'teleport', x: 7.2, y: 5 });
    const b = place(sim2, 9, 5, 'porcupine', 0, 1);
    const upRes = releaseAtEdge(sim2, b, true, 2 / 60);
    assert(upRes.upAtRelease && !upRes.upAtHit, `seed ${k}: up at the release, down at the hit (${upRes.upAtRelease}, ${upRes.upAtHit})`);
    assert(upRes.quills === 1 && w2.hero.hp === w2.hero.maxHp - 1 && !alive(w2, b), `seed ${k}: quills ${upRes.quills}, HP ${w2.hero.hp}`);
    assert(replays(sim2), 'replay');
  }
});

check('porcupine (iteration 2.1): in one chain only the porcupines with the quills up at the release hurt; the cold takes the quills off', () => {
  // Two porcupines, each at its own random point of the cycle: wait until one is up and the other down for a while (the
  // first of the seeds where their phases are far enough apart; the dash takes about 0.2 s).
  let sim: Simulation | undefined, p1: Enemy | undefined, p2: Enemy | undefined;
  for (let k = 63; k < 73 && !sim; k++) {
    const s = fight('thorns', quiet(), seedOf(k)), sw = s.world;
    s.command({ t: 'teleport', x: 8, y: 5 });
    const a = place(s, 9, 4.2, 'porcupine', 0, 1), b = place(s, 10.1, 4.2, 'porcupine', 0, 1);
    runUntil(s, () => quillsUp(sw, a) !== quillsUp(sw, b) && a.vars.timer > 0.3 && b.vars.timer > 0.3, 600);
    if (quillsUp(sw, a) !== quillsUp(sw, b)) { sim = s; p1 = a; p2 = b; }
  }
  assert(sim && p1 && p2, 'one up, one down');
  const w = sim.world;
  const raised = quillsUp(w, p1) ? p1 : p2;
  sim.command({ t: 'begin', x: p1.x, y: p1.y });
  sim.command({ t: 'drag', x: p2.x, y: p2.y, mode: 'full' });
  assert(chainLength(w) === 2, `chain ${chainLength(w)}`);
  sim.command({ t: 'release' });
  let quills = 0;
  for (let i = 0; i < 120 && w.move; i++) { sim.tick(); quills += hits(w, 'quills'); w.events.length = 0; }
  assert(quills === 1 && w.hero.hp === w.hero.maxHp - 1 && !alive(w, raised), `only the raised one: quills ${quills}, HP ${w.hero.hp}`);
  assert(replays(sim), 'replay');
  // Frozen with the quills up: no quills.
  const cold = fight('thorns', quiet(), seedOf(64)), cw = cold.world;
  cold.command({ t: 'teleport', x: 8, y: 5 });
  const frozen = place(cold, 9, 5, 'porcupine', 0, 1);
  runUntil(cold, () => quillsUp(cw, frozen) && frozen.vars.timer > 1, 600);
  cold.command({ t: 'chill', id: frozen.id, seconds: 2 });
  assert(!quillsUp(cw, frozen), 'frozen: the quills are off');
  cold.command({ t: 'begin', x: frozen.x, y: frozen.y });
  cold.command({ t: 'release' });
  let coldQuills = 0;
  for (let i = 0; i < 120 && cw.move; i++) { cold.tick(); coldQuills += hits(cw, 'quills'); cw.events.length = 0; }
  assert(coldQuills === 0 && cw.hero.hp === cw.hero.maxHp && !alive(cw, frozen), 'frozen: killed without quills');
  assert(replays(cold), 'replay');
});

check('porcupine: the «−N HP» badge shows the damage the quills really do (armedDamage — 1, an elite 2, down or frozen 0); the dash takes exactly that', () => {
  for (const [k, elite] of [[80, false], [81, true], [82, true]] as const) {
    const sim = fight('thorns', quiet({ contactDamage: 0 }), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const id = sim.command({ t: 'place', x: 9, y: 5, color: 0, hp: 1, kind: 'porcupine', ...elite ? { elite: 'random' as const } : {} }) as number;
    const p = w.enemies.find(e => e.id === id)!;
    runUntil(sim, () => !quillsUp(w, p), 600);
    assert(armedDamage(w, p) === 0, 'down: no badge');
    runUntil(sim, () => quillsUp(w, p) && p.vars.timer > 1, 600);
    const shown = armedDamage(w, p);
    assert(shown === (elite ? 2 : 1), `badge −${shown} for ${elite ? 'an elite' : 'a porcupine'}`);
    const hp = w.hero.hp;
    sim.command({ t: 'begin', x: p.x, y: p.y });
    sim.command({ t: 'release' });
    for (let i = 0; i < 120 && w.move; i++) sim.tick();
    assert(hp - w.hero.hp === shown, `the dash took ${hp - w.hero.hp}, the badge said ${shown}`);
    const q = place(sim, w.hero.x + 1, w.hero.y, 'porcupine', 0, 1);
    runUntil(sim, () => quillsUp(w, q), 600);
    sim.command({ t: 'chill', id: q.id, seconds: 1 });
    assert(armedDamage(w, q) === 0, 'frozen: no badge');
    assert(replays(sim), 'replay');
  }
});

check('arena 7 «Колючие заросли»: three buttons; porcupines are about 20% of newcomers', () => {
  const t = arenaTemplate('thorns');
  assert(t.goal === 'buttons' && t.buttons.length === 3, 'three buttons');
  const { share, kinds, total } = shareOf('thorns', 'porcupine');
  assert(total >= 80 && share > 0.1 && share < 0.3, `porcupines ${(share * 100).toFixed(0)}% of ${total}`);
  assert([...kinds].every(kind => kind === 'basic' || kind === 'porcupine'), `kinds ${[...kinds].join(', ')}`);
});

// ---- Design answers and review of step 2 ----

check('Поляна of the run: only basic enemies come (no wolf packs, no boars); the sandbox arena 1 keeps the prototype composition', () => {
  const { kinds, total } = shareOf('glade', 'basic');
  assert(total >= 80 && [...kinds].every(kind => kind === 'basic'), `Поляна: ${[...kinds].join(', ')} of ${total}`);
  const sandbox = shareOf('kills', 'basic');
  assert(sandbox.kinds.has('wolf'), `the sandbox arena 1 still brings wolves: ${[...sandbox.kinds].join(', ')}`);
});

check('archer, old line (archerPoint off): a pond does not cut its line (the arrow flies over the water), a tree does; the first delay is the slider', () => {
  // Stage 3a, step 2: arena 5 has no pond and no tree any more (its ridges are walls) — the check plays on arena 1
  // «Убить 30»: the pond at (12.6, 4.6), r 0.95. The archer east of it, the hero west: the line crosses the water.
  const sim = fight('kills', quiet({ ...LINE, archerFirstDelay: 0.5 }), seedOf(30)), w = sim.world;
  sim.command({ t: 'teleport', x: 9.6, y: 4.6 });
  const archer = place(sim, 15, 4.6, 'archer', 0);
  const first = runUntil(sim, () => archer.vars.aim === 1);
  assert(first === 30, `first line after ${first} ticks (slider 0.5 s)`);
  assert(Math.abs(archer.vars.len - 7) < 1e-9, `over the pond the line is whole: ${archer.vars.len}`);
  runUntil(sim, () => archer.vars.aim !== 1);
  assert(w.hero.hp === w.hero.maxHp - 1, 'the arrow over the water hits the hero');
  // Arena 1: a tree (5.5, 7.5) behind the hero: the line stops at its trunk (len ≈ 9.6 − 5.5 − 0.42), the hero in front of it is hit.
  const tree = fight('kills', quiet(LINE), seedOf(31)), tw = tree.world;
  tree.command({ t: 'teleport', x: 7.5, y: 7.5 });
  const behind = place(tree, 9.6, 7.5, 'archer', 0);
  runUntil(tree, () => behind.vars.aim === 1);
  assert(Math.abs(behind.vars.len - 3.68) < 0.06, `the trunk cuts the line: ${behind.vars.len.toFixed(2)}`);
  runUntil(tree, () => behind.vars.aim !== 1);
  assert(tw.hero.hp === tw.hero.maxHp - 1, 'the hero in front of the tree is hit');
});

check('review (old line): an enemy killed by an arrow in the walk loop does not make the next enemy skip its step', () => {
  const sim = fight('archers', quiet({ ...LINE, enemySpeed: 1.2 }), seedOf(32)), w = sim.world;
  // Stage 3a, step 2: the line runs through the left ridge's gap (y 2–4); the old open row y 5 is a ridge wall now.
  sim.command({ t: 'teleport', x: 2, y: 3 });
  // The order of the list: the victim on the line, the archer, a walker off the line (index after the victim).
  const victim = place(sim, 6, 3, 'basic', 1, 0), archer = place(sim, 8, 3, 'archer', 0), walker = place(sim, 4, 8.5, 'basic', 2, 5);
  let shot = false, guard = 0, prev = 0;
  while (!shot && guard++ < 300) {
    const before = { x: walker.x, y: walker.y }, aiming = archer.vars.aim === 1;
    sim.tick();
    const moved = dist(walker, before);
    if (aiming && archer.vars.aim !== 1) {
      shot = true;
      assert(!alive(w, victim), 'the arrow killed the victim');
      assert(moved > prev * 0.9 && moved > 0.01, `the walker moved ${moved.toFixed(4)} on the shot tick (before ${prev.toFixed(4)})`);
    }
    prev = moved;
  }
  assert(shot && replays(sim), 'shot and replay');
});

check('review: the marked archers of arena 5 take their HP from the slider «HP лучника»', () => {
  const sim = new Simulation({ arena: 'archers', params: quiet({ archerHp: 2 }), seed: seedOf(33) });
  const marked = sim.world.enemies.filter(e => e.marked);
  assert(marked.length === 3 && marked.every(e => e.hp === 2), `HP ${marked.map(e => e.hp).join(', ')}`);
  const plain = new Simulation({ arena: 'archers', params: quiet(), seed: seedOf(33) });
  assert(plain.world.enemies.every(e => e.hp === 0), 'default HP 0');
});

check('(old line) a sapper killed by an arrow blows up, but its blast kills are not the player\'s', () => {
  const sim = fight('powder', quiet(LINE), seedOf(34)), w = sim.world;
  sim.command({ t: 'teleport', x: 2, y: 4.5 });
  const archer = place(sim, 13.5, 5, 'archer', 0);
  const sapper = place(sim, 9.5, 5.2, 'sapper', 1), near = place(sim, 9.5, 6.3, 'basic', 2, 0);
  sim.command({ t: 'teleport', x: 7, y: 5 });
  runUntil(sim, () => archer.vars.aim === 1);
  sim.command({ t: 'teleport', x: 2, y: 4.5 });
  runUntil(sim, () => archer.vars.aim !== 1);
  assert(!alive(w, sapper) && w.blasts.length === 1 && w.blasts[0].credited === false, 'the arrow lit the dead sapper\'s fuse, not credited');
  untilBlast(sim);
  assert(!alive(w, near) && w.stats.kills === 0 && w.stats.score === 0, `the blast killed the enemy beside it, not the player's: kills ${w.stats.kills}`);
  assert(replays(sim), 'replay');
});

check('shieldbearer: a crystal as the previous link is the anchor — in front of the shield it refuses, behind it takes', () => {
  for (const [cx, ok] of [[8.3, false], [10.1, true]] as const) {
    // The toggle «щит следит за героем» turns the shield west (the check is about the anchor, not the facing).
    const sim = fight('shields', quiet({ shieldFollowsHero: true }), seedOf(35)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 6.3 });
    const shield = place(sim, 9.2, 5, 'shield', 1, 1);
    // The shield faces the hero (south-west); a crystal on its west (front) or east (back) side.
    sim.command({ t: 'teleport', x: 7.4, y: 5 });
    ticks(sim, 150);
    const crystal = sim.command({ t: 'crystal', x: cx, y: 5, value: 1 }) as number;
    sim.command({ t: 'teleport', x: cx, y: 6.1 });
    assert(sim.command({ t: 'begin', x: cx, y: 5 }) && w.chain[0].id === crystal, 'the chain starts on the crystal');
    sim.command({ t: 'drag', x: shield.x, y: shield.y, mode: 'full' });
    assert((w.chain.length === 2) === ok, `crystal at ${cx}: chain ${w.chain.length}`);
    if (!ok) assert(hoverRefusal(w, shield, true) === 'guarded', 'hint «щит»');
  }
});

// ---- Design answers A–C (08.10.2026) ----

/** The polyline of the hero's tick positions passes within 0.05 of `p` (the dash moves 0.2 a tick). */
function passes(path: Vec[], p: Vec): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    if (Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y) < 0.05) return true;
  }
  return false;
}

/** Draws a chain through `links`, releases it and runs until the dash ends and no fuse burns; returns the dash. */
function dashAll(sim: Simulation, links: Enemy[], kills: { enemyId: number; source?: string; credited?: boolean }[] = []) {
  const w = sim.world;
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(w.chain.length === links.length, `chain ${w.chain.length} of ${links.length}`);
  const plan = planChain(w);
  sim.command({ t: 'release' });
  const move = w.move!;
  const path: Vec[] = [{ x: w.hero.x, y: w.hero.y }];
  for (let i = 0; i < 300 && (w.move || w.blasts.length) && w.status === 'playing'; i++) {
    sim.tick();
    path.push({ x: w.hero.x, y: w.hero.y });
    for (const ev of w.events) if (ev.type === 'kill') kills.push(ev);
    w.events.length = 0;
  }
  return { plan, move, path };
}

check('A: links of the released chain killed on the way by the chain\'s own sapper blast stay links: +1 power, kills of the chain', () => {
  // The reviewer's scenario: a sapper, 8 weak enemies in a loop, the last one HP 9. Planned: the last one dies.
  const sim = fight('shields', quiet(), seedOf(40)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const pts = [[8.8, 5, 'sapper', 0], [10.3, 5.6, 'basic', 0], [11.5, 4.5, 'basic', 0], [10.5, 3.3, 'basic', 0], [9, 3.0, 'basic', 0], [7.5, 3.5, 'basic', 0], [7.0, 4.9, 'basic', 0], [7.6, 6.2, 'basic', 0], [8.6, 6.4, 'basic', 0], [9.6, 7.6, 'basic', 9]] as const;
  const links = pts.map(([x, y, kind, hp]) => place(sim, x, y, kind, 0, hp));
  const kills: { enemyId: number; source?: string; credited?: boolean }[] = [];
  const { plan, move, path } = dashAll(sim, links, kills);
  const blastKills = kills.filter(ev => ev.source === 'blast');
  assert(blastKills.length >= 1 && blastKills.every(ev => ev.credited === true), `links killed by the blast on the way: ${blastKills.length}`);
  assert(plan.links[plan.links.length - 1].outcome?.killed, 'planned: the last link dies');
  assert(!alive(w, links[links.length - 1]) && move.power === plan.power, `the last link died; power ${move.power} = planned ${plan.power}`);
  assert(move.kills === 10 && w.lastChain?.kills === 10 && w.stats.kills === 10, `chain kills ${move.kills}, last chain ${w.lastChain?.kills}, counter ${w.stats.kills}`);
  assert(w.stats.crystals === 1, `the 6th kill of the chain dropped a crystal: ${w.stats.crystals}`);
  // The hero passed the last point of every link killed on the way.
  for (const ev of blastKills) {
    const at = links.find(e => e.id === ev.enemyId)!;
    assert(passes(path, at), `the hero passed link ${ev.enemyId}`);
  }
  assert(replays(sim), 'replay');
});

check('A (old line): links killed on the way by an arrow give power but are not the player\'s; the chain shield counts the chain\'s own kills', () => {
  const sim = fight('powder', quiet({ ...LINE, chainShieldMinKills: 4 }), seedOf(41)), w = sim.world;
  // Stage 3a, step 2: the scenario runs along the top of «Пороховой склад» (y 1.6–3.8) — the old row y 5–7 crosses its west ravine now.
  sim.command({ t: 'teleport', x: 3, y: 1.6 });
  const archer = place(sim, 9.6, 1.6, 'archer', 1);
  const a = place(sim, 4.2, 2.6, 'basic', 0), b = place(sim, 5.5, 1.6, 'basic', 0), c = place(sim, 6.8, 1.6, 'basic', 0), d = place(sim, 8, 2.8, 'basic', 0), e = place(sim, 9, 3.8, 'basic', 0, 4);
  runUntil(sim, () => archer.vars.aim === 1);
  runUntil(sim, () => archer.vars.timer <= 3 / 60 + 1e-9);
  const kills: { enemyId: number; source?: string; credited?: boolean }[] = [];
  const { plan, move, path } = dashAll(sim, [a, b, c, d, e], kills);
  const arrowKills = kills.filter(ev => ev.source === 'arrow').map(ev => ev.enemyId).sort();
  assert(JSON.stringify(arrowKills) === JSON.stringify([b.id, c.id].sort()), `the arrow killed b and c on the way: ${arrowKills.join(',')}`);
  assert(!alive(w, e) && move.power === plan.power, `power with the fallen links: ${move.power} = planned ${plan.power}; e dead`);
  assert(move.kills === 3 && w.stats.kills === 3, `only the chain's own kills: ${move.kills}, counter ${w.stats.kills}`);
  assert(passes(path, b) && passes(path, c), 'the hero passed b and c');
  // Shield after a chain needs 4 kills of the chain: 3 — none.
  assert(w.hero.chainShield === 0, `chain shield ${w.hero.chainShield}`);
  assert(replays(sim), 'replay');
});

check('A (old line): a porcupine link killed on the way gives no quills; links lost while the chain is drawn drop out', () => {
  // Quills always up (slider «иглы опущены» 0): the porcupine would hurt if it were struck.
  const sim = fight('powder', quiet({ ...LINE, porcupineDownTime: 0 }), seedOf(42)), w = sim.world;
  // Stage 3a, step 2: the scenario runs along the top of «Пороховой склад» (y 1.6–3.8) — the old row y 5–7 crosses its west ravine now.
  sim.command({ t: 'teleport', x: 3, y: 1.6 });
  const archer = place(sim, 9.6, 1.6, 'archer', 1);
  const a = place(sim, 4.2, 2.6, 'basic', 0), quill = place(sim, 5.5, 1.6, 'porcupine', 0, 0), d = place(sim, 6.6, 2.8, 'basic', 0);
  runUntil(sim, () => archer.vars.aim === 1);
  runUntil(sim, () => archer.vars.timer <= 3 / 60 + 1e-9);
  dashAll(sim, [a, quill, d]);
  assert(!alive(w, quill) && hits(w, 'quills') === 0 && w.hero.hp === w.hero.maxHp, 'no quills from a porcupine killed by the arrow');
  // While drawing: a link killed by the arrow drops out of the drawn chain (it is not released yet).
  const sim2 = fight('powder', quiet(LINE), seedOf(43)), w2 = sim2.world;
  sim2.command({ t: 'teleport', x: 3, y: 1.6 });
  const archer2 = place(sim2, 9.6, 1.6, 'archer', 1);
  const x1 = place(sim2, 4.2, 2.6, 'basic', 0), x2 = place(sim2, 5.5, 1.6, 'basic', 0);
  runUntil(sim2, () => archer2.vars.aim === 1);
  sim2.command({ t: 'begin', x: x1.x, y: x1.y });
  sim2.command({ t: 'drag', x: x2.x, y: x2.y, mode: 'full' });
  assert(w2.chain.length === 2, 'drawn');
  runUntil(sim2, () => !alive(w2, x2));
  sim2.tick();
  assert(chainLength(w2) === 1 && w2.chain[0].id === x1.id, `the dead link dropped out: ${JSON.stringify(w2.chain)}`);
});

check('B: the panel\'s phase table reaches arenas 4–7 and Поляна; their wolf and boar shares stay 0', () => {
  for (const arena of ['glade', 'shields', 'archers', 'powder', 'thorns']) {
    const sim = new Simulation({ arena, params: quiet(), seed: seedOf(44) }), w = sim.world;
    const table = defaultParams().phases.map(phase => ({ ...phase, floor: 7, wolfShare: 0.5, boarShare: 0.5 }));
    sim.command({ t: 'phases', phases: table });
    sim.command({ t: 'goals' });
    sim.tick();
    assert(w.pressure.phase.floor === 7 && w.pressure.phase.wolfShare === 0 && w.pressure.phase.boarShare === 0, `${arena}: ${JSON.stringify(w.pressure.phase)}`);
    assert(arenaTemplate(arena).phases === undefined, `${arena}: no copy of the table`);
  }
  const sandbox = new Simulation({ arena: 'kills', params: defaultParams(), seed: seedOf(44) });
  assert(sandbox.world.pressure.phase.wolfShare === defaultParams().baseWolfShare, 'the sandbox arena keeps the panel shares');
});

check('C: the shield is checked from the previous link even with «Якорь у героя» — the hero anchor widens the reach only', () => {
  // The shield faces west (the toggle «щит следит за героем» turns it there). The previous link west of it (in front), the
  // hero east of it (behind) and within R: refused.
  const sim = fight('shields', quiet({ heroAnchor: true, shieldFollowsHero: true }), seedOf(45)), w = sim.world;
  sim.command({ t: 'teleport', x: 7.4, y: 5 });
  const shield = place(sim, 9.2, 5, 'shield', 1, 1);
  ticks(sim, 150);
  const front = place(sim, 8.3, 5.4, 'basic', 1);
  sim.command({ t: 'teleport', x: 10.4, y: 5.3 });
  sim.command({ t: 'begin', x: front.x, y: front.y });
  sim.command({ t: 'drag', x: shield.x, y: shield.y, mode: 'full' });
  assert(chainLength(w) === 1 && hoverRefusal(w, shield, true) === 'guarded', `from the front with the hero behind: ${chainLength(w)}, ${hoverRefusal(w, shield, true)}`);
  sim.command({ t: 'cancel' });
  // The previous link behind it, the hero in front: taken (the strike comes from behind).
  const back = place(sim, 10.2, 4.6, 'basic', 1);
  sim.command({ t: 'teleport', x: 8.7, y: 3.6 });
  ticks(sim, 1);
  sim.command({ t: 'begin', x: back.x, y: back.y });
  sim.command({ t: 'drag', x: shield.x, y: shield.y, mode: 'full' });
  assert(chainLength(w) === 2, `from behind: chain ${chainLength(w)}`);
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
    // Not the door: the fight must last its 50 s (phase A, 09.10.2026: with speed classes the bot of «Стена щитов» met its goal
    // and walked out at 12.6 s — two checkpoints instead of ten).
    const next = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind !== 'door')].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}

const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

check('each new arena: a bot fight of 50 s replays from its journal to the same hash at every checkpoint', () => {
  for (const [k, arena] of ['shields', 'archers', 'powder', 'thorns'].entries()) {
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
