/**
 * Т1. Counter talismans (track Д1; docs/realtime-phase-b.md, sections 3, 8 and 9 «Д1»). Node only:
 * `npm run test:realtime-talismans`.
 *
 * Every check plays real journalled commands (place, draw, release, jump, ticks) on the arena «Убить 30» with a quiet panel:
 * - the trigger fires on its own count and not before (the chain/link number, the killing chains, the cycle of four);
 * - the same fight without the talisman behaves as before (control);
 * - the highlight (`planChain`) shows the same power the dash strikes with; the plan changes nothing;
 * - the wave is the player's: the kill goal and the score count it;
 * - every fight replays from its journal to the same hash.
 */
import { buildModules, counterOf, linkRadiusOf, registerBuildModule, setBuildState } from './build';
import { BUILD_SOURCES, COUNTER_TALISMANS as T, RELICS } from './buildIds';
import { buildHit } from './buildHits';
import { chainScore, planChain } from './chain';
import { bodyRadiusOf } from './enemies/kinds';
import { defaultParams, type Params } from './params';
import { SIM_DT, Simulation, replay } from './simulation';
import type { Loadout } from './kit';
import type { Enemy, World, WorldEvent } from './world';
import { SHOCKWAVE_RADIUS, THIRD_CHAIN_WINDOW } from './talismansRt';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** A quiet fight: no newcomers, enemies stand, touches do not hurt, no hit-stop, no knockback of a survivor. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function fight(talismans: string[], extra: Partial<Params> = {}, seed = 11, loadout: Loadout = {}): Simulation {
  const sim = new Simulation({ arena: 'kills', params: quiet(extra), seed, record: true, loadout: { ...loadout, talismans } });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp: number, extra: { elite?: boolean; color?: number } = {}): Enemy => {
  const id = sim.command({ t: 'place', x, y, color: extra.color ?? 0, hp, kind: 'basic', ...extra.elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** Enemies in a row from (x0, y), 1 unit apart. */
const row = (sim: Simulation, x0: number, y: number, hps: readonly number[], elites: readonly number[] = []): Enemy[] =>
  hps.map((hp, i) => place(sim, x0 + i, y, hp, elites.includes(i) ? { elite: true } : {}));
/** Draws a chain through the points in order (the first press, then drags). */
function draw(sim: Simulation, points: readonly { x: number; y: number }[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the hero stands, collecting the events. */
function settle(sim: Simulation, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 600 && (sim.world.move || i === 0); i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
function ticks(sim: Simulation, n: number, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
/** Draws, releases and settles: the events of the dash. */
function chain(sim: Simulation, points: readonly { x: number; y: number }[]): WorldEvent[] {
  draw(sim, points);
  sim.command({ t: 'release' });
  return settle(sim);
}
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const fired = (events: readonly WorldEvent[], id: string): number => events.filter(e => e.type === 'talismanFired' && e.id === id).length;
type Hit = Extract<WorldEvent, { type: 'chainHit' }>;
const hits = (events: readonly WorldEvent[]): Hit[] => events.filter((e): e is Hit => e.type === 'chainHit');
const progressOf = (w: World, id: string) => buildModules().find(m => m.id === id)!.progress?.(w) ?? null;

/** Test module: on the first tick of a dash a build hit kills the chain's enemy link number `CUT_AT` (1-based) ahead of the hero. */
const CUT = 'test-talismans-cut-ahead', CUT_AT = 3;
registerBuildModule({
  id: CUT,
  onDashStep: (w, step) => {
    const b = step.move.build;
    if (step.kind !== 'dash' || !b || w.build?.[CUT]) return;
    // The enemy links still ahead: the k-th of them is the chain's link number `b.links + k`.
    const ahead = step.move.links.filter(l => l.kind === 'enemy');
    const target = ahead[CUT_AT - b.links - 1];
    const e = target && w.enemies.find(x => x.id === target.id);
    setBuildState(w, CUT, 1);
    if (e) buildHit(w, e, 99, BUILD_SOURCES.hammerCut);
  },
});

// ---- «Пятое звено» ----

check('«Пятое звено»: +2 before the hit on the 5th and 10th enemy links, not before; the highlight shows the same; control without it', () => {
  const hps = [0, 0, 0, 0, 7, 0, 0, 0, 0, 7];
  const play = (talismans: string[]) => {
    const sim = fight(talismans);
    sim.command({ t: 'teleport', x: 1, y: 6 });
    const links = row(sim, 2, 6, hps);
    const progress: (number | null)[] = [];
    sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    progress.push(progressOf(sim.world, T.fifthLink)?.value ?? null);
    for (const e of links.slice(1)) { sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' }); progress.push(progressOf(sim.world, T.fifthLink)?.value ?? null); }
    const before = sim.hash();
    const plan = planChain(sim.world);
    assert(sim.hash() === before, 'the plan changes nothing');
    sim.command({ t: 'release' });
    return { sim, links, plan, progress, events: settle(sim) };
  };
  const mod = play([T.fifthLink]);
  const damages = hits(mod.events).map(h => h.damage);
  assert(damages.join() === '1,2,3,4,7,1,2,3,4,7', `dash damages ${damages}`);
  assert(mod.plan.links.map(l => l.outcome!.damage).join() === damages.join() && mod.plan.kills === 10, `plan ${mod.plan.links.map(l => l.outcome?.damage)}`);
  assert(mod.links.every(e => !alive(mod.sim.world, e)), 'all ten dead');
  // The signal comes right after the 5th and the 10th hits, never before.
  const order = mod.events.filter(e => e.type === 'chainHit' || e.type === 'talismanFired').map(e => (e.type === 'chainHit' ? 'h' : 'F')).join('');
  assert(order === 'hhhhhFhhhhhF', `hits and signals ${order}`);
  assert(mod.progress.join() === '1,2,3,4,5,1,2,3,4,5', `HUD while drawing ${mod.progress}`);
  assert(progressOf(mod.sim.world, T.fifthLink) === null, 'nothing to show at rest');
  assert(replays(mod.sim), 'replay');
  // Control: the 5th link (7 HP) survives power 4 + 1 and ends the chain.
  const plain = play([]);
  assert(hits(plain.events).map(h => h.damage).join() === '1,2,3,4,5' && alive(plain.sim.world, plain.links[4]), `control ${hits(plain.events).map(h => h.damage)}`);
  assert(plain.plan.endsOnSurvivor && plain.plan.links.length === 5, 'control plan stops on the 5th');
});

check('«Пятое звено»: a link killed ahead of the dash (a fallen link) counts — the 5th still gets +2', () => {
  const sim = fight([T.fifthLink, CUT]), w = sim.world;
  sim.command({ t: 'teleport', x: 1, y: 6 });
  // The 3rd link is cut ahead on the first tick of the dash; the 5th (7 HP) dies only as the 5th: 4 + 2 + 1.
  const links = row(sim, 2, 6, [0, 0, 0, 0, 7, 0]);
  const events = chain(sim, links);
  const cut = events.find((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill' && e.enemyId === links[CUT_AT - 1].id);
  assert(cut?.source === BUILD_SOURCES.hammerCut, `the 3rd link was cut ahead (${JSON.stringify(cut)})`);
  assert(hits(events).map(h => h.damage).join() === '1,2,4,7,1', `dash damages ${hits(events).map(h => h.damage)}`);
  assert(!alive(w, links[4]) && fired(events, T.fifthLink) === 1, 'the 5th died and the talisman fired once');
  assert(replays(sim), 'replay');
});

// ---- «Третья цепь» ----

check('«Третья цепь»: the 3rd chain that killed makes the next jump free for 5 s; chains without a kill and cancelled ones do not count; free jumps do not stack', () => {
  const sim = fight([T.thirdChain]), w = sim.world;
  const kill = () => { sim.command({ t: 'teleport', x: 4, y: 6 }); return chain(sim, [place(sim, 5, 6, 0)]); };
  const miss = () => { sim.command({ t: 'teleport', x: 4, y: 6 }); const ev = chain(sim, [place(sim, 5, 6, 5)]); sim.command({ t: 'clear', keepMarked: false }); return ev; };
  const jumpFree = (): boolean => { sim.command({ t: 'teleport', x: 4, y: 6 }); sim.command({ t: 'energy', value: 0 }); const ok = sim.command({ t: 'jump', x: 5.5, y: 6 }) === true; settle(sim); return ok; };
  const events: WorldEvent[] = [];
  events.push(...kill(), ...miss(), ...kill());
  sim.command({ t: 'teleport', x: 4, y: 6 });
  draw(sim, [place(sim, 5, 6, 0)]);
  sim.command({ t: 'cancel' });
  sim.command({ t: 'clear', keepMarked: false });
  assert(fired(events, T.thirdChain) === 0 && !jumpFree(), 'two killing chains: no free jump yet');
  assert(progressOf(w, T.thirdChain)?.value === 2, `HUD ${JSON.stringify(progressOf(w, T.thirdChain))}`);
  const third = kill();
  assert(fired(third, T.thirdChain) === 1 && progressOf(w, T.thirdChain)?.value === 3, 'the 3rd killing chain fires; HUD shows it armed');
  // Not taken yet: three more killing chains — still one free jump.
  const more = [...kill(), ...kill(), ...kill()];
  assert(fired(more, T.thirdChain) === 1, 'the 6th fires again');
  assert(jumpFree() && w.energy === 0, 'the jump is free');
  assert(!jumpFree(), 'only one free jump');
  assert(progressOf(w, T.thirdChain)?.value === 0, 'HUD back to 0');
  // The 9th: the window lasts 5 s of game time.
  kill(); kill(); kill();
  ticks(sim, Math.floor((THIRD_CHAIN_WINDOW - 0.2) / SIM_DT));
  assert(jumpFree(), 'still free just before 5 s');
  kill(); kill(); kill();
  ticks(sim, Math.ceil((THIRD_CHAIN_WINDOW + 0.1) / SIM_DT));
  assert(!jumpFree() && counterOf(w, 'third-chain-until') === 0, 'the window closed after 5 s');
  assert(replays(sim), 'replay');
  // Control: three killing chains, the jump at 0 energy is refused.
  const plain = fight([]);
  for (let i = 0; i < 3; i++) { plain.command({ t: 'teleport', x: 4, y: 6 }); chain(plain, [place(plain, 5, 6, 0)]); }
  plain.command({ t: 'energy', value: 0 });
  assert(plain.command({ t: 'jump', x: 5.5, y: 6 }) === false, 'control: no free jump');
});

// ---- «Ударная волна» ----

check('«Ударная волна»: 8 enemy links — a wave of 2 at the end (touching the body), 1 damage, credited to the kill goal and the score; 7 links — none; control without it', () => {
  const play = (talismans: string[], links: number) => {
    const sim = fight(talismans, { killGoal: links + 1 }), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 6 });
    const chainLinks = row(sim, 4, 6, new Array(links).fill(0));
    const end = chainLinks[links - 1], body = bodyRadiusOf(w.params, end);
    // Other colours around the end: one well inside, one that only its body touches (3 HP), one out of reach.
    const inside = place(sim, end.x - 0.5, end.y - 1.4, 0, { color: 1 });
    const touching = place(sim, end.x, end.y - (SHOCKWAVE_RADIUS + body * 0.5), 3, { color: 2 });
    const outside = place(sim, end.x - 3, end.y - 1.6, 0, { color: 1 });
    const plan = planChain(w, chainLinks.map(e => ({ kind: 'enemy' as const, id: e.id })));
    assert(plan.kills === links, `plan kills ${plan.kills}`);
    const events = chain(sim, chainLinks);
    return { sim, w, events, inside, touching, outside, chainLinks };
  };
  const mod = play([T.shockwave], 8);
  const wave = mod.events.find((e): e is Extract<WorldEvent, { type: 'wave' }> => e.type === 'wave');
  assert(wave && wave.r === SHOCKWAVE_RADIUS && near(wave.x, mod.chainLinks[7].x, 1e-6) && near(wave.y, 6, 1e-6), `wave ${JSON.stringify(wave)}`);
  assert(fired(mod.events, T.shockwave) === 1, 'the talisman fired');
  const kill = mod.events.find((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill' && e.enemyId === mod.inside.id);
  assert(kill?.source === BUILD_SOURCES.wave && kill.credited === true, `wave kill ${JSON.stringify(kill)}`);
  assert(alive(mod.w, mod.touching) && mod.touching.hp === 2, `touching body hit for 1 (HP ${mod.touching.hp})`);
  assert(alive(mod.w, mod.outside), 'out of reach untouched');
  // The kill goal (9) is met by the wave's kill; the score has the chain's and one kill more.
  assert(mod.w.stats.kills === 9 && mod.w.stage === 'greed', `kills ${mod.w.stats.kills}, stage ${mod.w.stage}`);
  assert(mod.w.stats.score === chainScore(mod.w.params, 8) + mod.w.params.scorePerKill, `score ${mod.w.stats.score}`);
  assert(replays(mod.sim), 'replay');
  // 7 links: no wave.
  const seven = play([T.shockwave], 7);
  assert(!seven.events.some(e => e.type === 'wave') && alive(seven.w, seven.inside) && fired(seven.events, T.shockwave) === 0, '7 links: no wave');
  // Control: 8 links without the talisman.
  const plain = play([], 8);
  assert(!plain.events.some(e => e.type === 'wave') && alive(plain.w, plain.inside) && plain.w.stats.kills === 8 && plain.w.stage === 'goals', 'control: no wave');
  assert(plain.w.stats.score === chainScore(plain.w.params, 8), 'control score');
});

// ---- «Призма» ----

check('«Призма»: +1 energy for every crystal broken by the dash, up to the cap; control without it', () => {
  const play = (talismans: string[], energy: number) => {
    const sim = fight(talismans), w = sim.world;
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const a = place(sim, 5, 6, 0, { color: 0 });
    const c1 = { x: 6, y: 6 }; sim.command({ t: 'crystal', ...c1, value: 0 });
    const b = place(sim, 7, 6, 0, { color: 1 });
    const c2 = { x: 8, y: 6 }; sim.command({ t: 'crystal', ...c2, value: 0 });
    const c = place(sim, 9, 6, 0, { color: 2 });
    sim.command({ t: 'energy', value: energy });
    const events = chain(sim, [a, c1, b, c2, c]);
    assert(events.filter(e => e.type === 'crystalBreak').length === 2 && [a, b, c].every(e => !alive(w, e)), 'two crystals broken, three kills');
    return { sim, w, events };
  };
  const per = defaultParams().energyPerKill;
  const mod = play([T.prism], 0), plain = play([], 0);
  assert(near(plain.w.energy, 3 * per) && near(mod.w.energy, 3 * per + 2), `energy ${plain.w.energy} → ${mod.w.energy}`);
  assert(fired(mod.events, T.prism) === 2 && fired(plain.events, T.prism) === 0, 'two signals');
  const capped = play([T.prism], 6);
  assert(capped.w.energy === 7, `capped at 7 (${capped.w.energy})`);
  assert(replays(mod.sim) && replays(capped.sim), 'replay');
});

// ---- «Добивание» ----

check('«Добивание»: the last enemy link died — the after-chain invulnerability ×2; a surviving last link — as before; not with «Быстрые ноги»', () => {
  const play = (talismans: string[], lastHp: number) => {
    const sim = fight(talismans);
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const events = chain(sim, row(sim, 5, 6, [0, lastHp]));
    return { sim, w: sim.world, events };
  };
  const base = defaultParams().chainShield;
  const killedMod = play([T.finisher], 0), killedPlain = play([], 0);
  // Read on the tick the dash ended: one tick of it is already spent.
  assert(near(killedPlain.w.hero.chainShield, base - SIM_DT, 1e-9) && near(killedMod.w.hero.chainShield, 2 * base - SIM_DT, 1e-9), `shield ${killedPlain.w.hero.chainShield} → ${killedMod.w.hero.chainShield}`);
  assert(fired(killedMod.events, T.finisher) === 1, 'the talisman fired');
  const survivor = play([T.finisher], 5);
  assert(near(survivor.w.hero.chainShield, base - SIM_DT, 1e-9) && fired(survivor.events, T.finisher) === 0, `a surviving last link: ${survivor.w.hero.chainShield}`);
  const swift = play([T.finisher, RELICS.swiftFeet], 0);
  assert(swift.w.hero.chainShield <= base - SIM_DT + 1e-9 && fired(swift.events, T.finisher) === 0, `with «Быстрые ноги»: ${swift.w.hero.chainShield}`);
  assert(replays(killedMod.sim) && replays(survivor.sim), 'replay');
});

// ---- «Охотник на элит» ----

check('«Охотник на элит»: after an elite link the chain carries +3 once (not to every link); the highlight shows it; control without it', () => {
  const play = (talismans: string[]) => {
    const sim = fight(talismans);
    sim.command({ t: 'teleport', x: 4, y: 6 });
    // Basic 0 HP, elite (1 HP), 5 HP, 4 HP: the 5 HP link dies only with the +3; the 4 HP one survives power 0 + 1.
    const links = row(sim, 5, 6, [0, 0, 5, 4], [1]);
    draw(sim, links);
    const plan = planChain(sim.world);
    sim.command({ t: 'release' });
    return { sim, links, plan, events: settle(sim) };
  };
  const mod = play([T.eliteHunter]);
  const damages = hits(mod.events).map(h => `${h.damage}${h.killed ? '' : '!'}`);
  assert(damages.join() === '1,2,5,1!', `dash ${damages}`);
  assert(mod.plan.links.map(l => `${l.outcome!.damage}${l.outcome!.killed ? '' : '!'}`).join() === damages.join(), `plan ${mod.plan.links.map(l => l.outcome?.damage)}`);
  assert(fired(mod.events, T.eliteHunter) === 1 && alive(mod.sim.world, mod.links[3]), 'one signal; the link after the next one gets no +3');
  assert(replays(mod.sim), 'replay');
  const plain = play([]);
  assert(plain.plan.links.length === 3 && plain.plan.endsOnSurvivor && hits(plain.events).map(h => h.damage).join() === '1,2,2', `control ${hits(plain.events).map(h => h.damage)}`);
  // Every elite link gives its own +3 (as every brazier gives its power): two elites (1 HP each), then 7 HP — power 6 + 1.
  const sim = fight([T.eliteHunter]);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const two = row(sim, 5, 6, [0, 0, 7], [0, 1]);
  const events = chain(sim, two);
  assert(hits(events).map(h => h.damage).join() === '1,4,7' && two.every(e => !alive(sim.world, e)) && fired(events, T.eliteHunter) === 2, `two elites ${hits(events).map(h => h.damage)}`);
});

// ---- «Длинная рука» ----

check('«Длинная рука»: every 4th released chain of the arena has R ×1.5 for the whole chain; cancelled chains do not count; a new arena starts again', () => {
  const far = 2.6;
  const play = (talismans: string[]) => {
    const sim = fight(talismans), w = sim.world, base = linkRadiusOf(w), log: { far: boolean; r: number; hud: number | null }[] = [];
    const events: WorldEvent[] = [];
    for (let n = 1; n <= 5; n++) {
      sim.command({ t: 'teleport', x: 4, y: 6 });
      if (n === 2) { draw(sim, [place(sim, 5, 6, 0)]); sim.command({ t: 'cancel' }); sim.command({ t: 'clear', keepMarked: false }); }
      const a = place(sim, 4 + far, 6, 0), b = place(sim, 4 + 2 * far, 6, 0);
      const r = linkRadiusOf(w), hud = progressOf(w, T.longArm)?.value ?? null;
      const reach = sim.command({ t: 'begin', x: a.x, y: a.y }) === true;
      if (reach) {
        sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
        assert(w.chain.length === 2 && planChain(w).kills === 2, `chain ${n}: the 2nd link (${far} from the 1st) joins too`);
        sim.command({ t: 'release' });
        events.push(...settle(sim));
      } else {
        sim.command({ t: 'clear', keepMarked: false });
        sim.command({ t: 'teleport', x: 4, y: 6 });
        events.push(...chain(sim, [place(sim, 5, 6, 0)]));
      }
      sim.command({ t: 'clear', keepMarked: false });
      log.push({ far: reach, r: r / base, hud });
    }
    return { sim, log, events, base };
  };
  const mod = play([T.longArm]);
  assert(mod.log.map(l => (l.far ? 'W' : '.')).join('') === '...W.', `far link reachable on chains ${mod.log.map(l => (l.far ? 'W' : '.')).join('')}`);
  assert(mod.log.map(l => l.r).join() === '1,1,1,1.5,1', `R factors ${mod.log.map(l => l.r)}`);
  assert(mod.log.map(l => l.hud).join() === '0,1,2,4,0', `HUD ${mod.log.map(l => l.hud)}`);
  assert(fired(mod.events, T.longArm) === 1 && mod.sim.world.kit!.chains === 5, 'one signal, five released chains (the cancelled one not counted)');
  assert(replays(mod.sim), 'replay');
  const plain = play([]);
  assert(plain.log.every(l => !l.far && l.r === 1), 'control: never reachable');
  // A new arena: the count starts again (the kit is made anew).
  const next = fight([T.longArm]);
  assert(next.world.kit!.chains === undefined && linkRadiusOf(next.world) === mod.base, 'a new arena: R as usual, no chains counted');
});

// ---- «Иней на клинке» ----

check('«Иней на клинке»: every 4th chain freezes its surviving last link for 2 s without the ×2; with no survivor the charge waits for one; control without it', () => {
  const play = (talismans: string[], plan: readonly ('s' | 'k')[]) => {
    const sim = fight(talismans), w = sim.world, out: { frozen: boolean; chill: number; brittle: boolean; hud: number | null; enemy: Enemy }[] = [];
    const events: WorldEvent[] = [];
    for (const kind of plan) {
      sim.command({ t: 'clear', keepMarked: false });
      sim.command({ t: 'teleport', x: 4, y: 6 });
      const links = row(sim, 5, 6, kind === 's' ? [0, 5] : [0, 0]);
      events.push(...chain(sim, links));
      const last = links[1];
      out.push({ frozen: (last.chill ?? 0) > 0 && alive(w, last), chill: last.chill ?? 0, brittle: !!last.brittle, hud: progressOf(w, T.frostEdge)?.value ?? null, enemy: last });
    }
    return { sim, w, out, events };
  };
  const mod = play([T.frostEdge], ['s', 's', 's', 's', 's', 's', 's', 'k', 's', 's']);
  assert(mod.out.map(o => (o.frozen ? 'F' : '.')).join('') === '...F....F.', `frozen after chains ${mod.out.map(o => (o.frozen ? 'F' : '.')).join('')}`);
  const frozen = mod.out[3];
  assert(frozen.chill > 2 - 2 * SIM_DT && frozen.chill <= 2 && !frozen.brittle, `2 s, not brittle (chill ${frozen.chill})`);
  assert(mod.out.map(o => o.hud).join() === '1,2,4,0,1,2,4,4,1,2', `HUD ${mod.out.map(o => o.hud)}`);
  assert(fired(mod.events, T.frostEdge) === 2, 'two signals');
  assert(replays(mod.sim), 'replay');
  // The frozen survivor stands 2 s, and the next chain hit on it is plain (no ×2).
  const s = fight([T.frostEdge]), w = s.world;
  let survivor: Enemy | null = null;
  for (let i = 0; i < 4; i++) { s.command({ t: 'clear', keepMarked: false }); s.command({ t: 'teleport', x: 4, y: 6 }); const links = row(s, 5, 6, [0, 5]); chain(s, links); survivor = links[1]; }
  assert(survivor && (survivor.chill ?? 0) > 0 && survivor.hp === 3, `frozen survivor with 3 HP (${survivor?.hp})`);
  s.command({ t: 'teleport', x: survivor.x - 1, y: survivor.y });
  draw(s, [survivor]);
  assert(planChain(w).links[0].outcome!.damage === 1, 'no ×2 on the frozen survivor');
  s.command({ t: 'cancel' });
  ticks(s, Math.ceil(2 / SIM_DT));
  assert(survivor.chill === undefined, 'thawed after 2 s');
  const plain = play([], ['s', 's', 's', 's']);
  assert(plain.out.every(o => !o.frozen), 'control: nothing freezes');
});

console.log(`realtime-talismans: ${checks} checks passed`);
