/**
 * Task 50 «Сноровка» (docs/design-notes/task-50-levels-archetype.md, sections 3.3 and 11; docs/realtime-prototype.md, «Ранг II»):
 * the eight counters on rank II (`Loadout.honed` → `Kit.honed`, the chain window `counterWindow`). Node only:
 * `npm run test:realtime-honed`.
 *
 * Every check plays real journalled commands (place, teleport, energy, begin, drag, release, jump, ticks) on a quiet open field:
 * - each rule of rank II does its own on a real chain, on 5 seeds (`Math.imul(k, 2654435761) >>> 0` — the layout shifts with the seed);
 *   the same chain without `honed` plays rank I;
 * - the highlight (`planChain`: the links' outcomes and marks, `honed` — far links, the two waves, the shield, the neighbour) is what
 *   the dash does; the plan changes nothing;
 * - a part of a fusion keeps its rank («Ледяная печать» with «Иней на клинке» II freezes the neighbour; «Ледяная волна» with «Ударная
 *   волна» II strikes and freezes round the start too);
 * - random fights with every counter on rank II: every chain's plan is the dash; journals replay to the same hash; a journal without
 *   `honed` and the `hone*` keys plays the old world.
 */
import { registerArena } from './arenas';
import { COUNTER_TALISMANS as T, FUSIONS } from './buildIds';
import { nextCandidates, planChain, type ChainPlan, type StrikeOutcome } from './chain';
import { platesOf } from './elites';
import { dist, type Vec } from './geometry';
import { worldState } from './hash';
import { kitOf, type Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import { FROST_EDGE_TIME, HONE, SHOCKWAVE_RADIUS } from './talismansRt';
import type { Enemy, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const SEEDS = [1, 2, 3, 4, 5];
/** A small generator of the layouts (the test's own; the fight's randomness is the sim's streams). */
function lcg(seed: number): () => number { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

const FIELD = 'honed-field';
registerArena({
  id: FIELD, name: 'Поле ранга II', summary: 'Тест ранга II', goal: 'kills', width: 22, height: 14,
  heroStart: { x: 3, y: 7 }, obstacles: [], buttons: [], door: { x: 21.3, y: 7 }, enemies: [], killGoal: 999,
});

/** A quiet fight with the chain window (a run's forms): no newcomers, enemies stand, touches do not hurt, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.hitstop = false; p.survivorKnockback = false;
  p.counterWindow = true;
  return Object.assign(p, extra);
}
function fight(talismans: string[], honed: string[] | null, extra: Partial<Params> = {}, loadout: Loadout = {}, seed = 11): Simulation {
  const sim = new Simulation({ arena: FIELD, params: quiet(extra), seed: seedOf(seed), record: true, loadout: { ...loadout, talismans, ...honed ? { honed } : {} } });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, opts: { color?: number; elite?: boolean } = {}): number =>
  sim.command({ t: 'place', x: at.x, y: at.y, color: opts.color ?? 0, hp, kind: 'basic', ...opts.elite ? { elite: true } : {} }) as number;
const enemy = (sim: Simulation, id: number): Enemy | undefined => sim.world.enemies.find(e => e.id === id);
function settle(sim: Simulation): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < 1200 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Draws the links `ids` in order (begin on the first, drag to the rest); every one must join. */
function draw(sim: Simulation, ids: readonly number[]): void {
  const at = (id: number): Vec => { const e = enemy(sim, id)!; return { x: e.x, y: e.y }; };
  sim.command({ t: 'begin', x: at(ids[0]).x, y: at(ids[0]).y });
  for (const id of ids.slice(1)) sim.command({ t: 'drag', x: at(id).x, y: at(id).y, mode: 'full' });
  assert(sim.world.chain.map(l => l.id).join() === ids.join(), `the chain took ${sim.world.chain.map(l => l.id)} of ${ids}`);
}
/** Draws, reads the plan (it changes nothing), releases and settles: the plan, the events, the enemies before. */
function release(sim: Simulation, ids: readonly number[]): { plan: ChainPlan; events: WorldEvent[]; before: Snapshot } {
  draw(sim, ids);
  const hash = sim.hash(), plan = planChain(sim.world);
  assert(sim.hash() === hash, 'the plan changes nothing');
  const before = snapshot(sim);
  sim.command({ t: 'release' });
  return { plan, events: settle(sim), before };
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const firedRank2 = (events: readonly WorldEvent[], id: string): number => events.filter(e => e.type === 'talismanFired' && e.id === id && e.rank === 2).length;
type Snapshot = { id: number; hp: number; plates: number; chill: number }[];
const snapshot = (sim: Simulation): Snapshot => sim.world.enemies.map(e => ({ id: e.id, hp: e.hp, plates: platesOf(e), chill: e.chill ?? 0 }));

/** The links' outcomes the plan promises up to the stop. */
function promised(plan: ChainPlan): Map<number, StrikeOutcome> {
  const out = new Map<number, StrikeOutcome>();
  for (const l of plan.links) {
    if (l.link.kind !== 'enemy' || !l.outcome) continue;
    out.set(l.link.id, l.outcome);
    if (!l.outcome.killed && !l.outcome.plate) break;
  }
  return out;
}
/** Each promised link killed, or its plates or HP as planned (bodies the end of the dash strikes are checked by the caller). */
function assertLinks(sim: Simulation, plan: ChainPlan, label: string, endStruck: ReadonlySet<number> = new Set()): void {
  for (const [id, o] of promised(plan)) {
    if (endStruck.has(id)) continue;
    const e = enemy(sim, id);
    if (o.killed) assert(!e, `${label}: ${id} should die`);
    else if (o.plate) assert(e && platesOf(e) === o.platesAfter, `${label}: ${id} plates ${e ? platesOf(e) : '—'}, planned ${o.platesAfter}`);
    else assert(e && e.hp === o.hpAfter, `${label}: ${id} HP ${e?.hp}, planned ${o.hpAfter}`);
  }
}
const killedIds = (plan: ChainPlan): string => [...promised(plan)].filter(([, o]) => o.killed).map(([id]) => id).join();

// ---- The kit ----

check('the kit: `honed` only with counter ids, each once, absent when empty — a loadout without it makes the kit of before; the hone keys are hashed defaults', () => {
  const base: Loadout = { talismans: [T.fifthLink, T.shockwave, FUSIONS.iceSeal], energy: 2 };
  const plain = kitOf(base);
  assert(!('honed' in plain), 'no honed without the loadout\'s');
  assert(JSON.stringify(kitOf({ ...base, honed: [] })) === JSON.stringify(plain), 'an empty list — the kit of before');
  assert(JSON.stringify(kitOf({ ...base, honed: ['whetstone', 'fusion-ice-seal', 'form-seal'] })) === JSON.stringify(plain), 'non-counters are dropped');
  const kit = kitOf({ ...base, honed: [T.shockwave, T.frostEdge, T.shockwave, 'x'] });
  assert(JSON.stringify(kit.honed) === JSON.stringify([T.shockwave, T.frostEdge]), `counters, each once, in order (${kit.honed})`);
  const p = defaultParams();
  assert(p.honeEdgeEvery === HONE.edgeEvery && p.honeCatchPower === HONE.catchPower && p.honePrismEnergy === HONE.prismEnergy && p.honeWaveStart === HONE.waveStart
    && p.honeFinisherKills === HONE.finisherKills && p.honeHunterPlates === HONE.hunterPlates && p.honeArmPower === HONE.armPower
    && p.honeFrostNear === HONE.frostNear && p.honeFrostTime === HONE.frostTime, 'the panel defaults are the module\'s');
});

// ---- «Острие» II ----

check('«Острие» II: every 3rd enemy link (3, 6) +2 — the 6th of 5 HP dies; rank I: only the 3rd, the 6th survives; plan = dash, mark on the 6th (5 seeds)', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k)), hps = [0, 0, 4, 0, 0, 5, 0], y = 6 + rnd();
    const play = (honed: string[] | null) => {
      const sim = fight([T.fifthLink], honed, {}, {}, k);
      sim.command({ t: 'teleport', x: 3, y });
      const ids = hps.map((hp, i) => place(sim, { x: 4.4 + 1.5 * i, y: y + (rnd() - 0.5) * 0.4 }, hp));
      // Rank I: the 6th survives — nothing may follow it.
      return { sim, ids, ...release(sim, honed ? ids : ids.slice(0, 6)) };
    };
    const two = play([T.fifthLink]);
    assert(killedIds(two.plan) === two.ids.join(), `seed ${k}: rank II kills all seven (${killedIds(two.plan)})`);
    assertLinks(two.sim, two.plan, `seed ${k} II`);
    assert(two.plan.links.map(l => (l.honed ?? []).join('+')).join() === ',,,,,fifth-link,', `seed ${k}: the mark on the 6th (${two.plan.links.map(l => l.honed)})`);
    assert(firedRank2(two.events, T.fifthLink) === 1, `seed ${k}: rank II fired once`);
    assert(replays(two.sim), 'replay');
    const one = play(null);
    assert(killedIds(one.plan) === one.ids.slice(0, 5).join() && enemy(one.sim, one.ids[5])?.hp === 1, `seed ${k}: rank I stops on the 6th`);
    assertLinks(one.sim, one.plan, `seed ${k} I`);
    assert(!one.plan.links.some(l => l.honed) && firedRank2(one.events, T.fifthLink) === 0, 'no rank II marks without honed');
  }
});

// ---- «Улов» II ----

check('«Улов» II: the free jump charges the next released chain — its first link +2 (a 2 HP link dies); the charge is spent by that chain; rank I: the link survives', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k));
    const play = (honed: string[] | null) => {
      const sim = fight([T.thirdChain], honed, {}, {}, k), w = sim.world, y = 5 + rnd() * 3;
      sim.command({ t: 'teleport', x: 3, y });
      const three = [0, 1, 2].map(i => place(sim, { x: 4.5 + 1.5 * i, y }, 0));
      release(sim, three);
      sim.command({ t: 'energy', value: 0 });
      assert(sim.command({ t: 'jump', x: w.hero.x + 1.5, y: w.hero.y + 2 }) === true, 'the free jump');
      settle(sim);
      const from = { x: w.hero.x, y: w.hero.y };
      const first = place(sim, { x: from.x + 1.5, y: from.y }, 2), second = place(sim, { x: from.x + 3, y: from.y }, 0);
      // Rank I: the first link survives — nothing may follow it.
      const charged = release(sim, honed ? [first, second] : [first]);
      // The next chain: no charge left.
      const again = place(sim, { x: w.hero.x + 1.5, y: w.hero.y + 1.5 }, 2);
      const plain = release(sim, [again]);
      return { sim, first, again, charged, plain };
    };
    const two = play([T.thirdChain]);
    assert(!enemy(two.sim, two.first) && two.charged.plan.links[0].outcome?.killed && two.charged.plan.links[0].honed?.join() === T.thirdChain, `seed ${k}: the charged first link dies, marked`);
    assertLinks(two.sim, two.charged.plan, `seed ${k} charged`);
    assert(firedRank2(two.charged.events, T.thirdChain) === 1, 'rank II fired');
    assert(enemy(two.sim, two.again)?.hp === 1 && !two.plain.plan.links[0].honed, `seed ${k}: the charge is spent — the next chain's first link survives`);
    assert(replays(two.sim), 'replay');
    const one = play(null);
    assert(enemy(one.sim, one.first)?.hp === 1 && !one.charged.plan.links[0].outcome?.killed, `seed ${k}: rank I — the link survives`);
  }
});

// ---- «Призма» II ----

check('«Призма» II: +1 energy for every colour shift of the dash (the highlight\'s +1 power after it stays); rank I: no energy', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k)), y = 5 + rnd() * 3;
    const play = (honed: string[] | null) => {
      const sim = fight([T.prism], honed, { colorShiftLinks: 3, energyPerKill: 0 }, {}, k);
      sim.command({ t: 'teleport', x: 3, y });
      // Three of colour 0, then the shift: colour 1 is free.
      const ids = [0, 0, 0, 1, 1].map((color, i) => place(sim, { x: 4.5 + 1.4 * i, y }, 0, { color }));
      sim.command({ t: 'energy', value: 0 });
      const out = release(sim, ids);
      return { sim, ids, energy: sim.world.energy, ...out };
    };
    const two = play([T.prism]), one = play(null);
    assert(two.energy === 1 && one.energy === 0, `seed ${k}: energy ${two.energy} with rank II, ${one.energy} without`);
    assert(firedRank2(two.events, T.prism) === 1 && firedRank2(one.events, T.prism) === 0, 'rank II fired once');
    assert(killedIds(two.plan) === two.ids.join() && killedIds(one.plan) === killedIds(two.plan), 'the power of the chain is rank I\'s');
    assertLinks(two.sim, two.plan, `seed ${k}`);
  }
});

// ---- «Ударная волна» II ----

check('«Ударная волна» II: a second wave round the chain\'s start in the same tick — the highlight\'s two circles and their bodies are the dash\'s; rank I: only round the end', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k)), y = 5 + rnd() * 3;
    const play = (honed: string[] | null) => {
      const sim = fight([T.shockwave], honed, {}, {}, k);
      sim.command({ t: 'teleport', x: 3, y });
      const start = { x: 3, y };
      // Bodies near the start (not links), 1 HP: the second wave kills them; one beyond its circle stays.
      const nearStart = [place(sim, { x: 3 - 1.2, y: y + 0.8 * (rnd() - 0.5) }, 1), place(sim, { x: 3 + 0.3, y: y - 1.4 }, 1)];
      const far = place(sim, { x: 3 - 3.5, y }, 1);
      const ids = [0, 1, 2, 3].map(i => place(sim, { x: 5 + 1.6 * i, y }, 0));
      const out = release(sim, ids);
      return { sim, ids, nearStart, far, start, ...out };
    };
    const two = play([T.shockwave]);
    const waves = two.events.filter((e): e is Extract<WorldEvent, { type: 'wave' }> => e.type === 'wave');
    assert(waves.length === 2 && dist(waves[1], two.start) < 1e-9 && waves[1].r === HONE.waveStart, `seed ${k}: two waves, the second round the start (${JSON.stringify(waves)})`);
    const planned = two.plan.honed?.waves;
    assert(planned?.length === 2 && dist(planned[0].at, waves[0]) < 1e-9 && planned[0].radius === SHOCKWAVE_RADIUS && dist(planned[1].at, two.start) < 1e-9, `seed ${k}: the highlight's circles (${JSON.stringify(planned)})`);
    assert(planned[1].ids.slice().sort().join() === two.nearStart.slice().sort().join(), `seed ${k}: the second wave's bodies ${planned[1].ids}`);
    assert(two.nearStart.every(id => !enemy(two.sim, id)) && enemy(two.sim, two.far), `seed ${k}: the second wave killed the bodies at the start, not the far one`);
    assert(firedRank2(two.events, T.shockwave) === 1, 'rank II fired once');
    assertLinks(two.sim, two.plan, `seed ${k}`);
    assert(replays(two.sim), 'replay');
    const one = play(null);
    assert(one.events.filter(e => e.type === 'wave').length === 1 && one.nearStart.every(id => enemy(one.sim, id)) && !one.plan.honed, `seed ${k}: rank I — one wave, the start untouched`);
  }
});

check('«Ледяная волна» with «Ударная волна» II: the second wave strikes and freezes round the start too — the fusion\'s highlight (`wave.second`, `ice`) is the dash', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k)), y = 5 + rnd() * 3;
    const sim = fight([FUSIONS.frostWave], [T.shockwave], {}, {}, k);
    sim.command({ t: 'teleport', x: 3, y });
    const nearStart = [place(sim, { x: 3 - 1.1, y: y + 0.5 * (rnd() - 0.5) }, 3), place(sim, { x: 3, y: y + 1.3 }, 0)];
    const ids = [0, 1, 2, 3].map(i => place(sim, { x: 5 + 1.6 * i, y }, 0));
    const { plan, events } = release(sim, ids);
    const second = plan.wave?.second;
    assert(second && dist(second.at, { x: 3, y }) < 1e-9 && second.bodies.map(b => b.id).sort().join() === nearStart.slice().sort().join(), `seed ${k}: the fusion's second wave (${JSON.stringify(second)})`);
    const tough = enemy(sim, nearStart[0]);
    assert(tough && tough.hp === 2 && (tough.chill ?? 0) > 0 && tough.brittle && !enemy(sim, nearStart[1]), `seed ${k}: the survivor at the start froze, the weak one died`);
    assert(plan.wave!.ice.ids.includes(nearStart[0]) && !plan.wave!.ice.ids.includes(nearStart[1]), 'the highlight\'s ice');
    assert(firedRank2(events, T.shockwave) === 1, 'rank II fired');
    assert(replays(sim), 'replay');
  }
});

// ---- «Добивание» II ----

check('«Добивание» II: a chain of 1 kill whose last link is the toughest and died gets the shield ×2 (the run\'s 3 kills otherwise); the highlight says so; rank I: no shield', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k)), y = 5 + rnd() * 3, hp = Math.floor(rnd() * 2);
    const play = (honed: string[] | null) => {
      const sim = fight([T.finisher], honed, { chainShieldMinKills: 3, chainShield: 0.5 }, {}, k);
      sim.command({ t: 'teleport', x: 3, y });
      const one = place(sim, { x: 4.6, y }, hp);
      const out = release(sim, [one]);
      return { sim, shield: sim.world.hero.chainShield, ...out };
    };
    const two = play([T.finisher]), one = play(null);
    assert(two.plan.honed?.shield === true && two.shield > 0.9 && firedRank2(two.events, T.finisher) === 1, `seed ${k}: rank II shield ${two.shield} (plan ${JSON.stringify(two.plan.honed)})`);
    assert(!one.plan.honed && one.shield === 0, `seed ${k}: rank I — no shield (${one.shield})`);
    // The last link not the toughest: no shield on rank II either (the rule of rank I holds).
    const sim = fight([T.finisher], [T.finisher], { chainShieldMinKills: 3, chainShield: 0.5 }, {}, k);
    sim.command({ t: 'teleport', x: 3, y });
    const out = release(sim, [place(sim, { x: 4.6, y }, 1), place(sim, { x: 6.2, y }, 0)]);
    assert(!out.plan.honed?.shield && sim.world.hero.chainShield === 0, `seed ${k}: the last not the toughest — no shield`);
  }
});

// ---- «Охотник на элит» II ----

check('«Охотник на элит» II: an elite link loses 1 plate before its hit — 2 plates go at one link, 1 plate goes and the hit takes HP; plan = dash; rank I: one plate', () => {
  for (const k of SEEDS) {
    for (const plates of [2, 1]) {
      const rnd = lcg(seedOf(k) + plates), y = 5 + rnd() * 3;
      const play = (honed: string[] | null) => {
        const sim = fight([T.eliteHunter], honed, { eliteArmor: true, elitePlates: plates }, {}, k);
        sim.command({ t: 'teleport', x: 3, y });
        const ids = [place(sim, { x: 4.5, y }, 0), place(sim, { x: 6, y }, 0, { elite: true }), place(sim, { x: 7.5, y }, 0)];
        const start = platesOf(enemy(sim, ids[1])!);
        const out = release(sim, ids);
        return { sim, ids, start, ...out };
      };
      const two = play([T.eliteHunter]), one = play(null);
      assert(two.start === plates && one.start === plates, `seed ${k}: the elite has ${plates} plates (${two.start}, ${one.start})`);
      const link = two.plan.links[1];
      assert(link.honed?.join() === T.eliteHunter, `seed ${k}: the mark on the elite`);
      assertLinks(two.sim, two.plan, `seed ${k} II, ${plates} plates`);
      assertLinks(one.sim, one.plan, `seed ${k} I, ${plates} plates`);
      if (plates === 2) assert(link.outcome?.plate && link.outcome.platesAfter === 0 && one.plan.links[1].outcome?.platesAfter === 1, `seed ${k}: two plates at once (${JSON.stringify(link.outcome)})`);
      else assert(!link.outcome?.plate && link.outcome?.killed && one.plan.links[1].outcome?.plate, `seed ${k}: the plate stripped first, the hit takes HP (${JSON.stringify(link.outcome)})`);
      assert(firedRank2(two.events, T.eliteHunter) === 1 && firedRank2(one.events, T.eliteHunter) === 0, 'rank II fired once');
      assert(two.events.some(e => e.type === 'elitePlates' && e.action === 'strip' && e.enemyId === two.ids[1]), 'the strip is an elite plates event');
      assert(replays(two.sim), 'replay');
    }
  }
});

// ---- «Длинная рука» II ----

check('«Длинная рука» II: a link taken beyond the ordinary R (with R ×1,5 of the 3rd link) gets +1 — a 4 HP link dies; the release fixes it, the dash reads it; rank I: it survives', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k)), y = 5 + rnd() * 3, gap = 2.9 + rnd() * 0.2;
    const play = (honed: string[] | null) => {
      const sim = fight([T.longArm], honed, {}, {}, k);
      sim.command({ t: 'teleport', x: 3, y });
      const ids = [place(sim, { x: 4.6, y }, 0), place(sim, { x: 6.2, y }, 0), place(sim, { x: 6.2 + gap, y }, 4)];
      const out = release(sim, ids);
      return { sim, ids, ...out };
    };
    const two = play([T.longArm]);
    assert(two.plan.honed?.far?.join() === String(two.ids[2]) && two.plan.links[2].honed?.join() === T.longArm, `seed ${k}: the far link (${JSON.stringify(two.plan.honed)})`);
    assert(!enemy(two.sim, two.ids[2]) && two.plan.links[2].outcome?.killed, `seed ${k}: the far link of 4 HP dies`);
    assertLinks(two.sim, two.plan, `seed ${k}`);
    assert(firedRank2(two.events, T.longArm) === 1 && !two.sim.world.build, 'rank II fired; its state left with the chain');
    assert(replays(two.sim), 'replay');
    const one = play(null);
    assert(enemy(one.sim, one.ids[2])?.hp === 1 && !one.plan.honed, `seed ${k}: rank I — it survives`);
  }
});

// ---- «Иней на клинке» II ----

check('«Иней на клинке» II: the nearest enemy within 1,5 of the survivor freezes too (fixed at the release, as the highlight shows); a farther one does not; rank I: only the survivor', () => {
  for (const k of SEEDS) {
    const rnd = lcg(seedOf(k)), y = 5 + rnd() * 3;
    const play = (honed: string[] | null, talismans: string[] = [T.frostEdge]) => {
      const sim = fight(talismans, honed, {}, {}, k);
      sim.command({ t: 'teleport', x: 3, y });
      const ids = [place(sim, { x: 4.6, y }, 0), place(sim, { x: 6.2, y }, 0), place(sim, { x: 7.8, y }, 5)];
      const near = place(sim, { x: 7.8 + 0.4, y: y + 1.0 + rnd() * 0.2 }, 3), farther = place(sim, { x: 7.8 - 0.2, y: y - 1.6 }, 3);
      const out = release(sim, ids);
      return { sim, ids, near, farther, ...out };
    };
    const two = play([T.frostEdge]);
    assert(two.plan.honed?.frost?.survivor === two.ids[2] && two.plan.honed.frost.near === two.near, `seed ${k}: the highlight's neighbour (${JSON.stringify(two.plan.honed)})`);
    assert((enemy(two.sim, two.ids[2])!.chill ?? 0) > 0 && (enemy(two.sim, two.near)!.chill ?? 0) > HONE.frostTime - 0.1, `seed ${k}: the survivor and its neighbour froze`);
    assert(!(enemy(two.sim, two.farther)!.chill ?? 0), `seed ${k}: the farther one did not`);
    assert(firedRank2(two.events, T.frostEdge) === 1 && !two.sim.world.build, 'rank II fired; its state left');
    assert(replays(two.sim), 'replay');
    const one = play(null);
    assert((enemy(one.sim, one.ids[2])!.chill ?? 0) > FROST_EDGE_TIME - 0.1 && !(enemy(one.sim, one.near)!.chill ?? 0), `seed ${k}: rank I — the neighbour stays warm`);
    // A part keeps its rank inside the fusion: «Ледяная печать» (form-seal + frost-edge) with «Иней на клинке» II.
    const fused = play([T.frostEdge], [FUSIONS.iceSeal]);
    assert(fused.plan.honed?.frost?.near === fused.near && (enemy(fused.sim, fused.near)!.chill ?? 0) > 0, `seed ${k}: «Ледяная печать» with «Иней» II freezes the neighbour`);
  }
});

// ---- Random fights: every counter on rank II ----

check('random fights of 5 seeds, every counter on rank II: every chain\'s plan (links, plates, waves, shield, neighbour) is the dash; replays; without honed — the world of rank I', () => {
  const all = [T.fifthLink, T.thirdChain, T.prism, T.shockwave, T.finisher, T.eliteHunter, T.longArm, T.frostEdge];
  let chains = 0, marked = 0, waves = 0, frozen = 0, far = 0;
  const hashes = new Set<string>();
  for (const k of SEEDS) {
    const sim = fight(all, all, { eliteArmor: true, elitePlates: 2, colorShiftLinks: 3, chainShieldMinKills: 3 }, {}, k), w = sim.world;
    const rnd = lcg(seedOf(k));
    for (let i = 0; i < 40; i++) place(sim, { x: 4 + rnd() * 12, y: 2 + rnd() * 9 }, Math.floor(rnd() * 5), { color: Math.floor(rnd() * 2), elite: rnd() < 0.15 });
    for (let c = 0; c < 12 && w.enemies.length; c++) {
      // Nobody within reach: the hero steps next to a random body (a journalled teleport).
      if (!nextCandidates(w).length) { const e = w.enemies[Math.floor(rnd() * w.enemies.length)]; sim.command({ t: 'teleport', x: Math.max(1, e.x - 1.2), y: e.y }); }
      const first = [...nextCandidates(w)].sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
      if (!first) continue;
      sim.command({ t: 'begin', x: first.x, y: first.y });
      for (let n = 1; n < 6; n++) {
        const plan = planChain(w);
        if (plan.endsOnSurvivor) break;
        const from = w.chain.length ? enemy(sim, w.chain[w.chain.length - 1].id) ?? w.hero : w.hero;
        const next = [...nextCandidates(w)].sort((a, b) => dist(b, from) - dist(a, from))[0];
        if (!next) break;
        sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
      }
      if (!w.chain.length) continue;
      const plan = planChain(w), before = snapshot(sim), armoured = new Set(w.enemies.filter(e => e.armor).map(e => e.id));
      sim.command({ t: 'release' });
      const events = settle(sim), label = `seed ${k} chain ${c}`;
      // The bodies the waves strike: their outcome is the waves' (checked by the ids below), not the link's.
      const struck = new Set((plan.honed?.waves ?? []).flatMap(v => v.ids));
      assertLinks(sim, plan, label, struck);
      const waveEvents = events.filter(e => e.type === 'wave').length;
      assert(waveEvents === (plan.honed?.waves?.length ?? 0), `${label}: waves ${waveEvents}, planned ${plan.honed?.waves?.length ?? 0}`);
      for (const id of struck) {
        // An armoured elite's window may close during the dash (a plate regrows, elites.ts `updateArmor`): its wave outcome is time's, not the plan's.
        if (armoured.has(id)) continue;
        const b = before.find(s => s.id === id)!, e = enemy(sim, id), hitsOn = (plan.honed?.waves ?? []).filter(v => v.ids.includes(id)).length;
        const link = promised(plan).get(id), hp = link ? (link.killed ? -1 : link.hpAfter) : b.hp, plates = link?.plate ? link.platesAfter ?? 0 : b.plates;
        if (hp < 0) { assert(!e, `${label}: ${id} died as a link`); continue; }
        // Each wave: a plate, or 1 HP (dead at 0 HP).
        let left = hp, pl = plates;
        for (let n = 0; n < hitsOn; n++) { if (pl > 0) pl--; else left = left <= 1 ? -1 : left - 1; if (left < 0) break; }
        if (left < 0) assert(!e, `${label}: ${id} dies in the waves`); else assert(e && e.hp === left && platesOf(e) === pl, `${label}: ${id} after the waves HP ${e?.hp}/${left}, plates ${e ? platesOf(e) : '—'}/${pl}`);
      }
      if (plan.honed?.frost) { const n = enemy(sim, plan.honed.frost.near); assert(!n || (n.chill ?? 0) > 0, `${label}: the neighbour froze`); frozen++; }
      if (plan.honed?.shield) assert(w.hero.chainShield > 0, `${label}: the promised shield`);
      chains++; marked += plan.links.filter(l => l.honed).length; waves += plan.honed?.waves ? 1 : 0; far += plan.honed?.far?.length ?? 0;
      for (let t = 0; t < 30; t++) { sim.tick(); w.events.length = 0; }
    }
    assert(replays(sim), `seed ${k}: replay`);
    hashes.add(sim.hash());
    // The same journal without `honed`: rank I — another world.
    const journal = JSON.parse(JSON.stringify(sim.exportJournal())) as Journal;
    delete journal.loadout!.honed;
    assert(replay(journal).hash() !== sim.hash(), `seed ${k}: without honed the fight is rank I's`);
  }
  assert(chains >= 25 && marked > 0 && waves > 0 && frozen > 0 && far > 0 && hashes.size === SEEDS.length, `chains ${chains}, marked links ${marked}, waves ${waves}, neighbours ${frozen}, far ${far}, fights ${hashes.size}`);
  console.log(`  chains ${chains} (plan = dash), marked links ${marked}, chains with waves ${waves}, neighbours ${frozen}, far links ${far}`);
});

// ---- Old journals ----

check('a journal without `honed` and the hone keys plays the old world: the kit has no field, the keys are not read', () => {
  for (const k of SEEDS) {
    const sim = fight([T.fifthLink, T.shockwave, T.frostEdge, T.eliteHunter], null, { eliteArmor: true }, {}, k);
    const rnd = lcg(seedOf(k));
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const ids = [0, 0, 4, 0, 1].map((hp, i) => place(sim, { x: 4.5 + 1.4 * i, y: 7 + (rnd() - 0.5) * 0.3 }, hp, { elite: i === 1 }));
    release(sim, ids);
    for (let t = 0; t < 60; t++) sim.tick();
    assert(!('honed' in sim.world.kit!), 'no honed in the kit');
    const journal = JSON.parse(JSON.stringify(sim.exportJournal())) as Journal;
    for (const key of Object.keys(journal.params)) if (key.startsWith('hone')) delete (journal.params as unknown as Record<string, unknown>)[key];
    const strip = (state: unknown): string => { const s = state as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    const again = replay(journal);
    assert(strip(worldState(again.world)) === strip(worldState(sim.world)), `seed ${k}: the same world without the keys`);
  }
});

console.log(`realtime-honed: ${checks} checks passed`);
