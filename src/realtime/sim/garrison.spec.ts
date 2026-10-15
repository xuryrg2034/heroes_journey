/**
 * Task 38 «Гарнизон, шаг 1» — the law of tethers, the guard, the dog handler and its hound, the Castellan v0 (sim/tethers.ts,
 * sim/enemies/garrison.ts, sim/arenasGarrison.ts; docs/realtime-elite-behaviors.md, «Гарнизон»). Node only:
 * `npm run test:realtime-garrison`.
 *
 * Every check plays journalled commands (clear, teleport, place, param, begin / drag, release, jump) and looks at what the player
 * meets:
 * - a chain whose dash crosses a leash: the highlight's `cuts` before the release is exactly what the dash cuts, after its end (not
 *   while it runs); the hound runs mad and bites an enemy (not the player's kill: no kills, no score); a jump across the leash cuts
 *   nothing; a chain into the hound itself does not cut its leash (it dies — its leash goes with it); the handler's death frees
 *   every hound; the frenzy ends after `houndFrenzy` s;
 * - the highlight is the dash on a real fight of «Псарня» on several seeds (bodies moving, a greedy bot's chains);
 * - without the law no tether is made; a journal without the keys plays the old world; a fight with cuts replays to its hash;
 * - the guards of «Плац» walk in a line across their way to the hero;
 * - the Castellan: a cut leash and a killed hound take a plate each, after the dash; «Спустить пса» hurts the hero in its lane
 *   (the first windup ×1.5); «Караул!» in phase 2 — three guard markers of one colour, one formation, at the far gate; the core's
 *   death ends the fight.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { nextCandidates, planChain } from './chain';
import { CASTELLAN, CASTELLAN_PHASE2_TIME, FIRST_WINDUP_FACTOR, GUARD, GUARD_STEP, HANDLER, HOUND, LUNGE_WINDUP } from './enemies/garrison';
import type { Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { TETHER_END_GAP, tetherCrossing } from './tethers';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** An open field (no garrison flag: the given values decide the law). */
registerArena({
  id: 'garrison-field', name: 'Поле гарнизона', summary: 'Тест закона связи', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], gates: [{ x: 18, y: 2 }, { x: 18, y: 10 }],
});

/** A fight where nothing comes and the hero cannot fall; enemies walk at `speed` (0 — they stand). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.survivorKnockback = false;
  p.tethers = true; p.guardFormation = true;
  return Object.assign(p, extra);
}
function field(k = 1, params: Params = quiet(), arena = 'garrison-field'): Simulation {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0, elite = false): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Ticks until the hero stands again (the dash over); `during` sees the world while the dash runs. */
function settle(sim: Simulation, out: WorldEvent[] = [], during?: (w: World) => void): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; if (sim.world.move) during?.(sim.world); }
  return out;
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const cutsOf = (events: readonly WorldEvent[]): number[] => of(events, 'tether').filter(e => e.action === 'cut').map(e => e.held).sort((a, b) => a - b);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const sorted = (ids: readonly number[] | undefined): number[] => [...ids ?? []].sort((a, b) => a - b);

/**
 * A handler and its two hounds stretched on their leashes: the hero at (3, 6), the handler placed at (7.5, 6) — it walks up to 4
 * from the hero, the hounds run at the hero to the end of their leashes; then everybody stands (`enemySpeed` 0).
 */
function stretched(k = 1, extra: Partial<Params> = {}): { sim: Simulation; handler: Enemy; hounds: Enemy[] } {
  const sim = field(k, quiet(extra));
  sim.command({ t: 'teleport', x: 3, y: 6 });
  const handler = place(sim, { x: 7.5, y: 6 }, 1, HANDLER, 1);
  ticks(sim, ticksOf(2.5));
  sim.command({ t: 'param', key: 'enemySpeed', value: 0 });
  ticks(sim, 1);
  const hounds = sim.world.enemies.filter(e => e.kind === HOUND);
  return { sim, handler, hounds };
}

/** Two weak enemies of colour 0 on the perpendicular of the leash of `hound` through its middle, `side` apart from it. */
function across(sim: Simulation, handler: Enemy, hound: Enemy, side = 0.9): [Enemy, Enemy] {
  const mx = (handler.x + hound.x) / 2, my = (handler.y + hound.y) / 2, dx = hound.x - handler.x, dy = hound.y - handler.y, d = Math.hypot(dx, dy);
  const px = -dy / d, py = dx / d;
  return [place(sim, { x: mx + px * side, y: my + py * side }, 0), place(sim, { x: mx - px * side, y: my - py * side }, 0)];
}

check('the crossing: only the inner part of a tether is cut (0.35 off each end), a parallel segment never; only + − × ÷', () => {
  const a = { x: 0, y: 0 }, b = { x: 4, y: 0 };
  assert(tetherCrossing({ x: 2, y: -1 }, { x: 2, y: 1 }, a, b) !== null, 'the middle is cut');
  assert(tetherCrossing({ x: TETHER_END_GAP - 0.01, y: -1 }, { x: TETHER_END_GAP - 0.01, y: 1 }, a, b) === null, 'within the gap at the start — not cut');
  assert(tetherCrossing({ x: 4 - TETHER_END_GAP + 0.01, y: -1 }, { x: 4 - TETHER_END_GAP + 0.01, y: 1 }, a, b) === null, 'within the gap at the end — not cut');
  assert(tetherCrossing({ x: 1, y: 0.5 }, { x: 3, y: 0.5 }, a, b) === null, 'a parallel segment — not cut');
  assert(tetherCrossing({ x: 2, y: 0.2 }, { x: 2, y: 1 }, a, b) === null, 'a segment short of the tether — not cut');
});

check('without the law no tether is made: the handler gets its hounds, they run free; the highlight lists no cut', () => {
  const sim = field(1, quiet({ tethers: false }));
  sim.command({ t: 'teleport', x: 3, y: 6 });
  const handler = place(sim, { x: 7.5, y: 6 }, 1, HANDLER, 1);
  ticks(sim, 2);
  const w = sim.world;
  assert(w.enemies.filter(e => e.kind === HOUND).length === 2 && handler.vars.pk === 1, 'two hounds at the handler');
  assert(w.tethers === undefined && !('tethers' in (worldState(w) as object)), 'no tether, none in the hash');
  const [a, b] = [place(sim, { x: 5, y: 5 }, 0), place(sim, { x: 5, y: 7 }, 0)];
  sim.command({ t: 'teleport', x: 4, y: 4.5 });
  draw(sim, [a, b]);
  assert(planChain(w).cuts === undefined, 'no cuts in the highlight');
});

check('a chain across a leash: the highlight\'s cuts before the release = what the dash cuts, after its end; the hound runs mad (several seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const { sim, handler, hounds } = stretched(k), w = sim.world;
    assert(hounds.length === 2 && w.tethers?.length === 2 && w.tethers.every(t => t.holder === handler.id), `seed ${k}: two leashes of the handler`);
    const target = hounds[0], length = dist(handler, target);
    assert(length > 2 * TETHER_END_GAP + 0.5, `seed ${k}: the leash is stretched (${length.toFixed(2)})`);
    const [a, b] = across(sim, handler, target);
    sim.command({ t: 'teleport', x: a.x + (a.x - b.x) * 0.6, y: a.y + (a.y - b.y) * 0.6 });
    draw(sim, [a, b]);
    assert(w.chain.length === 2, `seed ${k}: the chain takes both links (${w.chain.length})`);
    const planned = sorted(planChain(w).cuts);
    assert(planned.includes(target.id), `seed ${k}: the highlight cuts the leash crossed (${planned})`);
    sim.command({ t: 'release' });
    const whileDash: number[] = [];
    const events = settle(sim, [], world => whileDash.push(world.tethers?.length ?? 0));
    assert(whileDash.length > 0 && whileDash.every(n => n === 2), `seed ${k}: the leashes stand while the dash runs (${whileDash})`);
    assert(JSON.stringify(cutsOf(events)) === JSON.stringify(planned), `seed ${k}: the dash cut ${cutsOf(events)}, the highlight ${planned}`);
    assert(!w.tethers?.some(t => planned.includes(t.held)), `seed ${k}: the cut leashes are gone`);
    ticks(sim, 1);
    assert((target.vars.fz ?? 0) > 0 && of(events, 'frenzy').length + 0 >= 0, `seed ${k}: the hound is in its frenzy (${target.vars.fz})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the frenzied hound bites an enemy it touches (−1 HP, an armoured elite loses a plate): not the player\'s kills — no kills, no score', () => {
  const { sim, handler, hounds } = stretched(2, { eliteArmor: true }), w = sim.world, hound = hounds[0];
  const [a, b] = across(sim, handler, hound);
  sim.command({ t: 'teleport', x: a.x + (a.x - b.x) * 0.6, y: a.y + (a.y - b.y) * 0.6 });
  draw(sim, [a, b]);
  sim.command({ t: 'release' });
  settle(sim);
  assert(!w.tethers?.some(t => t.held === hound.id), 'the leash is cut');
  const kills = w.stats.kills, score = w.stats.score;
  // A weak victim and an armoured elite by the mad hound, held by the cold (they stand); the hero far off; the hound runs again.
  sim.command({ t: 'teleport', x: 18, y: 11 });
  const victim = place(sim, { x: hound.x + 0.7, y: hound.y }, 0), elite = place(sim, { x: hound.x - 0.9, y: hound.y }, 2, 'basic', 2, true);
  for (const e of [victim, elite]) sim.command({ t: 'chill', id: e.id, seconds: 10 });
  sim.command({ t: 'param', key: 'enemySpeed', value: 1.5 });
  const plates = elite.armor?.plates ?? 0;
  const events = ticks(sim, ticksOf(2));
  const bites = of(events, 'frenzy').filter(e => e.action === 'bite' && e.id === hound.id);
  assert(bites.length >= 2 && bites[0].target === victim.id && bites.some(e => e.target === elite.id), `bites: ${JSON.stringify(bites)}`);
  const kill = of(events, 'kill').find(e => e.enemyId === victim.id);
  assert(kill && kill.source === 'hound' && kill.credited === false, `the victim died by the hound, not the player's: ${JSON.stringify(kill)}`);
  assert((elite.armor?.plates ?? 0) < plates, `the elite lost a plate (${plates} → ${elite.armor?.plates})`);
  assert(w.stats.kills === kills && w.stats.score === score, `no kills, no score for the player (${kills} → ${w.stats.kills}, ${score} → ${w.stats.score})`);
});

check('the frenzy ends after houndFrenzy s; then a plain hound (no bite)', () => {
  const { sim, handler, hounds } = stretched(3, { houndFrenzy: 1 }), hound = hounds[0];
  const [a, b] = across(sim, handler, hound);
  sim.command({ t: 'teleport', x: a.x + (a.x - b.x) * 0.6, y: a.y + (a.y - b.y) * 0.6 });
  draw(sim, [a, b]);
  sim.command({ t: 'release' });
  settle(sim);
  const events = ticks(sim, ticksOf(1.5));
  const end = of(events, 'frenzy').find(e => e.action === 'end' && e.id === hound.id);
  assert(end && hound.vars.fz === undefined, 'the frenzy ended');
  const victim = place(sim, { x: hound.x + 0.45, y: hound.y }, 0);
  ticks(sim, ticksOf(1));
  assert(sim.world.enemies.includes(victim), 'a plain hound bites nobody');
});

check('a jump across a leash cuts nothing; a chain into the hound itself cuts no leash (it dies, its leash goes with it)', () => {
  const jumped = stretched(4), jw = jumped.sim.world, h = jumped.hounds[0];
  const mx = (jumped.handler.x + h.x) / 2, my = (jumped.handler.y + h.y) / 2;
  jumped.sim.command({ t: 'teleport', x: mx, y: my - 1.5 });
  jumped.sim.command({ t: 'energy', value: 7 });
  assert(jumped.sim.command({ t: 'jump', x: mx, y: my + 1.5 }) === true, 'the jump starts');
  const jumpEvents = settle(jumped.sim);
  assert(!cutsOf(jumpEvents).length && jw.tethers?.length === 2, 'no leash cut by the jump');
  // The chain straight into the hound (the segment ends on it: within the gap).
  const into = stretched(1), iw = into.sim.world, hound = into.hounds[0], other = into.hounds[1];
  into.sim.command({ t: 'teleport', x: hound.x - 1, y: hound.y + 1 });
  draw(into.sim, [hound]);
  assert(iw.chain.length === 1, 'the chain takes the hound');
  const plan = planChain(iw);
  assert(!(plan.cuts ?? []).includes(hound.id), `the highlight cuts no leash of the hound itself (${plan.cuts})`);
  into.sim.command({ t: 'release' });
  const events = settle(into.sim);
  assert(JSON.stringify(cutsOf(events)) === JSON.stringify(sorted(plan.cuts)), `the dash cuts what the highlight showed (${cutsOf(events)} / ${plan.cuts})`);
  const death = of(events, 'tether').find(e => e.held === hound.id);
  assert(death?.action === 'death' && !iw.enemies.includes(hound), `the hound's leash went with its death (${JSON.stringify(death)})`);
  assert(iw.enemies.includes(other) && (other.vars.fz === undefined || plan.cuts?.includes(other.id)), 'the other hound is not loosed by it');
});

check('the handler\'s death frees every hound (as a cut): after the dash both run mad; no tether left (the field absent)', () => {
  const { sim, handler, hounds } = stretched(2), w = sim.world;
  // From behind the handler (away from the hero): the segment does not cross the leashes.
  sim.command({ t: 'teleport', x: handler.x + 1.2, y: handler.y });
  draw(sim, [handler]);
  assert(!(planChain(w).cuts ?? []).length, 'the highlight cuts nothing');
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(!w.enemies.includes(handler) && w.tethers === undefined, 'the handler is dead, no tether');
  assert(of(events, 'tether').filter(e => e.action === 'death' && e.holder === handler.id).length === 2, 'both leashes went with the handler');
  const after = ticks(sim, 1);
  // Both are loose: each runs mad — or the other, mad first, has bitten it to death already (it is the nearest body).
  const bitten = (h: Enemy): boolean => of([...events, ...after], 'kill').some(e => e.enemyId === h.id && e.source === 'hound' && !e.credited);
  assert(hounds.every(h => (h.vars.fz ?? 0) > 0 || bitten(h)) && hounds.some(h => (h.vars.fz ?? 0) > 0), `both hounds run mad (${hounds.map(h => h.vars.fz)})`);
});

/** A greedy bot on «Псарня»: chains of up to 4 of the nearest candidates; every release compares the highlight's cuts with the dash's. */
function kennelBot(k: number): { cuts: number; chains: number; sim: Simulation; checkpoints: string[] } {
  const p = defaultParams(); p.heroHp = 999; p.contactDamage = 0;
  const sim = new Simulation({ arena: 'g-kennel', params: p, seed: seedOf(k), record: true }), w = sim.world, checkpoints: string[] = [];
  let cuts = 0, chains = 0;
  for (let s = 0; s < 60 && w.status === 'playing'; s++) {
    for (let i = 0; i < 20; i++) { sim.tick(); w.events.length = 0; if (sim.world.tick % 300 === 0) checkpoints.push(sim.hash()); }
    if (w.move) continue;
    const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
    if (!first) continue;
    sim.command({ t: 'begin', x: first.x, y: first.y });
    for (let n = 1; n < 4; n++) {
      const last = w.enemies.find(e => e.id === w.chain[w.chain.length - 1]?.id);
      const next = nextCandidates(w).sort((a, b) => dist(a, last ?? w.hero) - dist(b, last ?? w.hero))[0];
      if (!next) break;
      sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    }
    if (!w.chain.length) continue;
    const planned = sorted(planChain(w).cuts);
    sim.command({ t: 'release' });
    const events = settle(sim);
    chains++;
    cuts += cutsOf(events).length;
    assert(JSON.stringify(cutsOf(events)) === JSON.stringify(planned), `seed ${k}, chain ${chains}: the dash cut ${cutsOf(events)}, the highlight ${planned}`);
  }
  return { cuts, chains, sim, checkpoints };
}

check('«Псарня», a real fight on 6 seeds: every chain\'s highlighted cuts are the dash\'s (bodies moving); some chains cut; the fight replays to its hash', () => {
  let cuts = 0;
  const firsts = new Set<string>();
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const run = kennelBot(k);
    cuts += run.cuts;
    assert(run.chains > 10, `seed ${k}: chains drawn (${run.chains})`);
    firsts.add(run.checkpoints[0]);
    const again = replay(JSON.parse(JSON.stringify(run.sim.exportJournal()!)) as Journal);
    assert(again.hash() === run.sim.hash(), `seed ${k}: replay`);
  }
  assert(cuts > 0, `the bot cut some leashes (${cuts})`);
  assert(firsts.size > 1, 'the seeds differ');
});

check('a journal without the new keys plays the old world (a forest fight with chains)', () => {
  for (const k of [1, 2]) {
    const sim = new Simulation({ arena: 'kills', params: defaultParams(), seed: seedOf(k), record: true });
    for (let s = 0; s < 20; s++) {
      ticks(sim, 30);
      const c = nextCandidates(sim.world)[0];
      if (!c || sim.world.move) continue;
      draw(sim, [c]);
      sim.command({ t: 'release' });
    }
    const journal = sim.exportJournal()! as Journal;
    const without = JSON.parse(JSON.stringify(journal)) as Journal;
    for (const key of ['tethers', 'leashLength', 'houndFrenzy', 'houndFrenzyDamage', 'guardFormation'] as const) delete (without.params as Partial<Params>)[key];
    const a = replay(journal), b = replay(without);
    const strip = (x: unknown): string => { const s = x as Record<string, unknown>; const { params: _p, ...rest } = s; void _p; return JSON.stringify(rest); };
    assert(strip(worldState(a.world)) === strip(worldState(b.world)) && a.hash() === sim.hash(), `seed ${k}: the same world without the keys`);
  }
});

check('«Плац»: the guards of a formation walk in a line across their way to the hero (0.9 apart); a guard without the formation key walks plainly', () => {
  const p = defaultParams(); p.heroHp = 999; p.contactDamage = 0; p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0;
  for (const k of [1, 2, 3]) {
    const sim = new Simulation({ arena: 'g-yard', params: p, seed: seedOf(k), record: true }), w = sim.world;
    assert(w.params.guardFormation && w.params.tethers, 'the garrison\'s arena turns its laws on');
    ticks(sim, ticksOf(2));
    for (const fm of [-1, -2]) {
      const line = w.enemies.filter(e => e.vars.fm === fm);
      assert(line.length === 3, `seed ${k}: formation ${fm} of 3`);
      const cx = line.reduce((s, e) => s + e.x, 0) / 3, cy = line.reduce((s, e) => s + e.y, 0) / 3, d = Math.hypot(w.hero.x - cx, w.hero.y - cy);
      const ux = (w.hero.x - cx) / d, uy = (w.hero.y - cy) / d;
      const across = line.map(e => (e.x - cx) * -uy + (e.y - cy) * ux).sort((a, b) => a - b), along = line.map(e => (e.x - cx) * ux + (e.y - cy) * uy);
      assert(Math.abs(across[2] - across[0] - 2 * GUARD_STEP) < 0.45, `seed ${k}: the line spans ${(across[2] - across[0]).toFixed(2)} across the way`);
      assert(Math.max(...along) - Math.min(...along) < 0.6, `seed ${k}: the line keeps level along the way (${along.map(a => a.toFixed(2))})`);
    }
    assert(replays(sim), `seed ${k}: replay`);
  }
  const plain = field(1, quiet({ guardFormation: false, enemySpeed: 1 }));
  plain.command({ t: 'teleport', x: 3, y: 6 });
  const g = place(plain, { x: 10, y: 6 }, 0, GUARD, 0);
  ticks(plain, ticksOf(1));
  assert(g.vars.ox === undefined && g.x < 10, 'a plain guard walks at the hero');
});

/** «Двор кастеляна» in a quiet fight: nothing comes, the hero cannot fall, the enemies stand (`enemySpeed` 0). */
function castellan(k = 1): { sim: Simulation; core: Enemy; hounds: Enemy[] } {
  const sim = new Simulation({ arena: 'g-castellan', params: quiet({ enemySpeed: 0 }), seed: seedOf(k), record: true });
  sim.command({ t: 'teleport', x: 10, y: 11.5 });
  ticks(sim, 1);
  const core = sim.world.enemies.find(e => e.kind === CASTELLAN)!, hounds = sim.world.enemies.filter(e => e.kind === HOUND);
  return { sim, core, hounds };
}

check('the Castellan: colourless core, 4 HP, 4 plates; his two hounds on his leashes, parts of him', () => {
  const { sim, core, hounds } = castellan(), w = sim.world;
  assert(core.hp === 4 && core.armor?.plates === 4 && core.armor.boss, `core HP ${core.hp}, plates ${core.armor?.plates}`);
  assert(hounds.length === 2 && hounds.every(h => h.partOf === core.id && h.hp === 3), 'two hounds of 3 HP, his parts');
  assert(w.tethers?.length === 2 && w.tethers.every(t => t.holder === core.id), 'two leashes to the core');
  assert(w.params.bossFrame && w.params.bossClears && w.params.jailerColorless && w.params.tethers, 'the arena turns the frame and the laws on');
});

check('the Castellan: a cut leash and a killed hound take a plate each — after the dash, not while it runs', () => {
  const { sim, core, hounds } = castellan(2), w = sim.world, hound = hounds[0];
  const [a, b] = across(sim, core, hound, 0.9);
  sim.command({ t: 'teleport', x: a.x + (a.x - b.x) * 0.6, y: a.y + (a.y - b.y) * 0.6 });
  draw(sim, [a, b]);
  const planned = sorted(planChain(w).cuts);
  assert(planned.includes(hound.id), `the highlight cuts the leash (${planned})`);
  sim.command({ t: 'release' });
  const during: number[] = [];
  const events = settle(sim, [], world => during.push(world.enemies.find(e => e.id === core.id)?.armor?.plates ?? -1));
  ticks(sim, 1, events);
  assert(during.every(n => n === 4), `the core keeps its plates while the dash runs (${during})`);
  assert(JSON.stringify(cutsOf(events)) === JSON.stringify(planned) && core.armor?.plates === 4 - planned.length, `−${planned.length} plate after the dash (${core.armor?.plates})`);
  // A hound killed by the chain: three weak links before it give the power (its 3 HP).
  const target = hounds[1], before = core.armor!.plates;
  // Straight down from the hound: the gap between the gallery walls (x 8–12) is open.
  const ux = 0, uy = 1;
  const links = [3, 2.2, 1.2].map(t => place(sim, { x: target.x + ux * t, y: target.y + uy * t }, 0, 'basic', target.color));
  sim.command({ t: 'teleport', x: target.x + ux * 4, y: target.y + uy * 4 });
  draw(sim, [...links, target]);
  assert(w.chain.length === 4, `the chain reaches the hound (${w.chain.length})`);
  const plan = planChain(w);
  assert(plan.links[3].outcome?.killed && plan.links[3].severs, 'the highlight: the hound dies, severed');
  sim.command({ t: 'release' });
  const second = settle(sim);
  ticks(sim, 1, second);
  assert(!w.enemies.includes(target) && of(second, 'partSevered').some(e => e.id === target.id), 'the hound is severed');
  assert(core.armor?.plates === before - 1 - cutsOf(second).length, `−1 plate after the dash (${before} → ${core.armor?.plates})`);
  assert(core.vars.phase === 2, 'a part lost — phase 2');
  assert(replays(sim), 'replay');
});

check('«Спустить пса»: the first windup ×1.5 (1.2 s), the hero in the lane −1 HP; then 0.8 s', () => {
  for (const k of [1, 2]) {
    const { sim, core, hounds } = castellan(k), w = sim.world;
    sim.command({ t: 'teleport', x: hounds[0].x, y: hounds[0].y + 2.5 });
    const hp = w.hero.hp, events = ticks(sim, ticksOf(6));
    const moves = of(events, 'castellanMove').filter(e => e.move === 'lunge');
    const start = moves.find(e => e.stage === 'start'), hitAt = events.indexOf(moves.find(e => e.stage === 'hit')!);
    assert(start && hitAt >= 0, `seed ${k}: a lunge started and struck (${JSON.stringify(moves)})`);
    assert(w.hero.hp < hp, `seed ${k}: the hero in the lane lost HP (${hp} → ${w.hero.hp})`);
    const hits = of(events, 'hit').filter(e => e.source === 'lunge');
    assert(hits.length >= 1 && hits[0].damage >= 1, `seed ${k}: the lunge's hit (${JSON.stringify(hits)})`);
    void core;
  }
  // The windup's length: from the start to the hit — 1.2 s the first time, 0.8 s the next.
  const { sim, hounds } = castellan(3);
  sim.command({ t: 'teleport', x: hounds[0].x, y: hounds[0].y + 2.5 });
  const times: { stage: string; time: number }[] = [];
  for (let i = 0; i < ticksOf(8); i++) {
    sim.tick();
    for (const e of sim.world.events) if (e.type === 'castellanMove' && e.move === 'lunge') times.push({ stage: e.stage, time: sim.world.time });
    sim.world.events.length = 0;
  }
  const windups = times.flatMap((e, i) => e.stage === 'start' && times[i + 1]?.stage === 'hit' ? [times[i + 1].time - e.time] : []);
  assert(windups.length >= 2 && Math.abs(windups[0] - LUNGE_WINDUP * FIRST_WINDUP_FACTOR) < 0.05 && Math.abs(windups[1] - LUNGE_WINDUP) < 0.05, `windups ${windups.map(t => t.toFixed(2))}`);
});

check('«Караул!»: phase 2 by the time (35 s); three guard markers of one colour, one formation, at the gate farthest from the hero', () => {
  for (const k of [1, 2]) {
    const { sim, core } = castellan(k), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 11.5 });
    const events = ticks(sim, ticksOf(CASTELLAN_PHASE2_TIME + 3));
    assert(core.vars.phase === 2, `seed ${k}: phase 2`);
    const call = of(events, 'castellanMove').find(e => e.move === 'guard');
    assert(call, `seed ${k}: «Караул!» was called`);
    const guards = w.enemies.filter(e => e.kind === GUARD);
    assert(guards.length === 3 && new Set(guards.map(e => e.color)).size === 1 && new Set(guards.map(e => e.vars.fm)).size === 1, `seed ${k}: three guards of one colour, one formation (${guards.map(e => `${e.color}/${e.vars.fm}`)})`);
    const gate = { x: 18.8, y: 8 };
    assert(guards.every(e => dist(e, gate) < 1.5), `seed ${k}: at the far gate (${guards.map(e => `${e.x.toFixed(1)},${e.y.toFixed(1)}`)})`);
  }
});

check('the Castellan\'s death ends the fight: the crowd dies with him (not the player\'s), the door opens', () => {
  const { sim, core } = castellan(4), w = sim.world;
  // Each chain through the core takes one of its 4 plates (a plate pass: the chain goes on); then 4 weak links give the power for its 4 HP.
  const below = (dy: number): Vec => ({ x: core.x + 0.2, y: core.y + dy });
  for (let n = 0; n < 4; n++) {
    sim.command({ t: 'teleport', x: core.x, y: core.y + 2.6 });
    draw(sim, [place(sim, below(1.4), 0, 'basic', 2), core]);
    assert(w.chain.length === 2, `chain ${n}: the core is a link (${w.chain.length})`);
    sim.command({ t: 'release' });
    settle(sim);
  }
  assert(core.armor?.plates === 0 && w.enemies.includes(core), `the plates are gone (${core.armor?.plates})`);
  sim.command({ t: 'teleport', x: core.x, y: core.y + 5.6 });
  const line = [4.4, 3.4, 2.4, 1.4].map(dy => place(sim, below(dy), 0, 'basic', 2));
  draw(sim, [...line, core]);
  assert(w.chain.length === 5, `the chain reaches the core (${w.chain.length})`);
  const plan = planChain(w);
  assert(plan.bossClear && plan.links[4].outcome?.killed, 'the highlight: the core dies, the fight ends');
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(!w.enemies.length && w.bossCleared && w.stage === 'greed', `the fight is over (${w.enemies.length}, ${w.bossCleared}, ${w.stage})`);
  assert(of(events, 'kill').filter(e => e.source === 'boss-clear').every(e => e.credited === false), 'the crowd is not the player\'s');
});

check('the hounds\' colours vary across seeds (the stream behavior:hound); the same seed — the same colours', () => {
  const colours = new Set<string>();
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const once = stretched(k).hounds.map(h => h.color).join(), again = stretched(k).hounds.map(h => h.color).join();
    assert(once === again, `seed ${k}: reproducible`);
    colours.add(once);
  }
  assert(colours.size > 1, `variety: ${[...colours]}`);
});

console.log(`garrison: ${checks} checks passed`);
