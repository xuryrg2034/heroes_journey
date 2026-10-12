/**
 * Loop research, step 3 (docs/realtime-loop-research.md, К1; design decisions 12.10.2026): «Прямая», the barbarian's pierce,
 * in the sandbox. Node only: `npm run test:realtime-pierce`.
 *
 * Every check plays journalled commands (place, teleport, begin, drag, release, item, param, goals) and looks at what the
 * player meets:
 * - off (the default, and in a run): a straight chain ends at its last link as before; a journal without the keys plays the
 *   same world;
 * - the highlight is the dash: what `planChain(world).pierce` shows before the release (the end, the bodies and their
 *   outcomes, the cheque) is what the dash does — on hand-made scenes and on random scenes of several seeds with walking
 *   enemies, shields, armoured elites, the cold's ×2 and the hit-stop;
 * - no pierce: a bent tail, a survivor or a plate at the end, P 0, a closed loop; a bend early in the chain keeps it;
 * - the end is cut by a wall and before a cliff; water does not stop it; bodies beyond the cut are not hit;
 * - P is not spent; kills are the player's (source `pierce`) but not the chain's; the door does not win; the cauldron gets
 *   the bodies' embers (no heat, no `purseKill`); «Режущий проход» acts along the run;
 * - telemetry: `chain.pierces`, `chain.pierceHits`, `kills.tools.pierce`; every fight replays to the same hash.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain, type ChainPlan } from './chain';
import { pond, polygon, wall, zone, type Vec } from './geometry';
import { defaultParams, runParams, type Params } from './params';
import { PIERCE_SOURCE } from './pierce';
import { Simulation, replay } from './simulation';
import { worldState } from './hash';
import { HAMMERS } from './buildIds';
import type { Loadout } from './kit';
import type { WorldEvent } from './world';
import { analyzeJournal } from '../telemetry/report';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const near = (a: Vec, b: Vec, eps = 1e-6): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

const base = { goal: 'kills' as const, width: 20, height: 12, heroStart: { x: 4.5, y: 5 }, buttons: [], enemies: [], killGoal: 999 };
registerArena({ ...base, id: 'pierce-field', name: 'Поле прямой', summary: 'Тест прямой', obstacles: [], door: { x: 19.3, y: 6 } });
registerArena({ ...base, id: 'pierce-wall', name: 'Поле прямой со стеной', summary: 'Тест прямой', obstacles: [wall(9.4, 3.5, 0.6, 3)], door: { x: 19.3, y: 6 } });
registerArena({ ...base, id: 'pierce-pond', name: 'Поле прямой с прудом', summary: 'Тест прямой', obstacles: [pond(9.4, 5, 0.8)], door: { x: 19.3, y: 6 } });
registerArena({
  ...base, id: 'pierce-cliff', name: 'Поле прямой с обрывом', summary: 'Тест прямой', obstacles: [], door: { x: 19.3, y: 6 },
  terrain: [zone('cliff', polygon(9.6, 3, 10.8, 3, 10.8, 7, 9.6, 7))],
});
registerArena({ ...base, id: 'pierce-door', name: 'Поле прямой с дверью', summary: 'Тест прямой', obstacles: [], door: { x: 9.3, y: 5 } });

/** A quiet fight: nobody walks or touches, no newcomers; the pierce on. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false;
  p.pierceEnabled = true;
  return Object.assign(p, extra);
}
function field(extra: Partial<Params> = {}, arena = 'pierce-field', k = 1, loadout?: Loadout): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
const place = (sim: Simulation, at: Vec, opts: { color?: number; hp?: number; kind?: string; elite?: boolean } = {}): number =>
  sim.command({ t: 'place', x: at.x, y: at.y, color: opts.color ?? 0, hp: opts.hp ?? 0, kind: opts.kind ?? 'basic', ...opts.elite ? { elite: true } : {} }) as number;
/** Draws the chain through `points` (the first by a press, the rest by drags). */
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the dash is over (and `extra` more), collecting the events. */
function runDash(sim: Simulation, extra = 2): WorldEvent[] {
  const out: WorldEvent[] = [];
  let left = extra;
  for (let t = 0; t < 900 && left > 0; t++) {
    sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0;
    if (!sim.world.move) left--;
  }
  return out;
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const enemy = (sim: Simulation, id: number) => sim.world.enemies.find(e => e.id === id);
const pierceEvents = (events: WorldEvent[]) => events.filter((e): e is Extract<WorldEvent, { type: 'pierce' }> => e.type === 'pierce');

/** Three weak colour-0 links on y = 5 from the hero at (4.5, 5): P 3 after them, the axis +x from (8.4, 5). */
const LINE: Vec[] = [{ x: 6, y: 5 }, { x: 7.2, y: 5 }, { x: 8.4, y: 5 }];

/**
 * The plan before the release equals what the dash did (rule 3: the set is fixed at the release; outcomes by HP): each
 * planned body killed (a `pierce` kill, credited), lost a plate, or wounded to the planned HP; the run's end; the cheque.
 * `before` — the plan read just before the release.
 */
function assertPlanIsDash(sim: Simulation, before: ChainPlan, events: WorldEvent[], label: string): void {
  const plan = before.pierce!;
  const pe = pierceEvents(events);
  const release = pe.find(e => e.phase === 'release'), end = pe.find(e => e.phase === 'end');
  assert(release && release.phase === 'release' && release.bodies.join() === plan.bodies.map(b => b.id).join(), `${label}: the release fixed the planned bodies`);
  assert(end && end.phase === 'end' && end.hits === plan.bodies.length && end.kills === plan.kills, `${label}: the run struck ${end && end.phase === 'end' ? `${end.hits}/${end.kills}` : '—'}, planned ${plan.bodies.length}/${plan.kills}`);
  for (const b of plan.bodies) {
    const e = enemy(sim, b.id);
    if (b.outcome.killed) {
      assert(!e && events.some(x => x.type === 'kill' && x.enemyId === b.id && x.source === PIERCE_SOURCE && x.credited), `${label}: body ${b.id} killed by the pierce`);
    } else if (b.outcome.plate) {
      assert(e && e.armor?.plates === b.outcome.platesAfter, `${label}: body ${b.id} plates ${e?.armor?.plates}, planned ${b.outcome.platesAfter}`);
    } else {
      assert(e && e.hp === b.outcome.hpAfter, `${label}: body ${b.id} hp ${e?.hp}, planned ${b.outcome.hpAfter}`);
    }
  }
  const hero = sim.world.hero;
  assert(near(hero, plan.to, 1e-6), `${label}: the hero ends at the planned end (${hero.x.toFixed(3)}, ${hero.y.toFixed(3)}) vs (${plan.to.x.toFixed(3)}, ${plan.to.y.toFixed(3)})`);
  const chainEnd = events.find(e => e.type === 'chainEnd');
  assert(chainEnd && chainEnd.type === 'chainEnd' && chainEnd.kills === before.kills, `${label}: the chain's kills are its links' only`);
  if (before.cheque) {
    const cheque = events.find(e => e.type === 'cheque');
    assert(cheque && cheque.type === 'cheque' && cheque.embers === before.cheque.embers && cheque.heat === before.cheque.heat && cheque.total === before.cheque.total,
      `${label}: the cheque ${cheque && cheque.type === 'cheque' ? `${cheque.embers}×${cheque.heat}` : '—'} = planned ${before.cheque.embers}×${before.cheque.heat}`);
  }
}

check('off (the default; a run forces it off): a straight chain of 3 ends at its last link, the body ahead is untouched', () => {
  assert(defaultParams().pierceEnabled === false, 'off by default');
  assert(runParams({ ...defaultParams(), pierceEnabled: true }).pierceEnabled === false, 'a run forces it off');
  const sim = field({ pierceEnabled: false });
  for (const p of LINE) place(sim, p);
  const ahead = place(sim, { x: 9.4, y: 5 }, { color: 1, hp: 1 });
  draw(sim, LINE);
  assert(!planChain(sim.world).pierce, 'no pierce in the plan');
  sim.command({ t: 'release' });
  const events = runDash(sim);
  assert(!pierceEvents(events).length && enemy(sim, ahead)?.hp === 1, 'nothing pierced');
  assert(near(sim.world.hero, LINE[2]), 'the hero stops at the last link');
  assert(replays(sim), 'replays');
});

check('a straight chain of 3: the plan shows the arrow and the corridor; the dash runs on, the bodies take P, the plan is the dash', () => {
  const sim = field();
  for (const p of LINE) place(sim, p);
  const weak = place(sim, { x: 9.0, y: 5.3 }, { color: 1, hp: 0 });
  const tough = place(sim, { x: 9.6, y: 4.7 }, { color: 2, hp: 3 });
  const survivor = place(sim, { x: 10.0, y: 5.1 }, { color: 3, hp: 5 });
  const beside = place(sim, { x: 9.5, y: 5.8 }, { color: 1, hp: 1 });
  const beyond = place(sim, { x: 10.6, y: 5 }, { color: 1, hp: 1 });
  draw(sim, LINE);
  const plan = planChain(sim.world);
  const p = plan.pierce!;
  assert(p && p.power === 3 && Math.abs(p.length - 1.875) < 1e-9 && near(p.to, { x: 8.4 + 1.875, y: 5 }), `the pierce ${JSON.stringify(p && { power: p.power, length: p.length, to: p.to })}`);
  assert(p.bodies.map(b => b.id).join() === [weak, tough, survivor].join(), `the corridor by t: ${p.bodies.map(b => b.id)}`);
  assert(p.bodies.map(b => b.outcome.killed).join() === 'true,true,false' && p.bodies[2].outcome.hpAfter === 2 && p.kills === 2, 'outcomes: P 3 kills 0 and 3 HP, wounds 5 to 2');
  const score = sim.world.stats.score, kills = sim.world.stats.kills, energy = sim.world.energy;
  sim.command({ t: 'release' });
  const events = runDash(sim);
  assertPlanIsDash(sim, plan, events, 'basic');
  assert(enemy(sim, beside)?.hp === 1 && enemy(sim, beyond)?.hp === 1, 'off the corridor and beyond its end untouched');
  // Credited as the player's, not the chain's: kills and score per kill count, combo and energy only from the links.
  assert(sim.world.stats.kills === kills + 3 + 2, `kill counter ${sim.world.stats.kills}`);
  const chainScore = events.find(e => e.type === 'chainEnd');
  assert(chainScore?.type === 'chainEnd' && sim.world.stats.score === score + chainScore.score + 2 * sim.world.params.scorePerKill, 'score: the chain\'s + per pierce kill');
  assert(events.filter(e => e.type === 'chainHit').length === 3 && sim.world.stats.bestChain === 3, 'combo and best chain are the links\'');
  assert(Math.abs(sim.world.energy - Math.min(7, energy + 3 * sim.world.params.energyPerKill)) < 1e-9, 'energy from the links only');
  assert(replays(sim), 'replays');
});

check('the set is fixed at the release: a walker that comes into the corridor after it is not hit; one fixed is hit wherever it walked', () => {
  const sim = field({ enemySpeed: 3 });
  for (const p of LINE) place(sim, p);
  const fixed = place(sim, { x: 10.0, y: 5.3 }, { color: 1, hp: 1 });
  const late = place(sim, { x: 10.4, y: 5.62 }, { color: 2, hp: 1 });
  draw(sim, LINE);
  const plan = planChain(sim.world);
  assert(plan.pierce?.bodies.map(b => b.id).join() === String(fixed), 'only the body in the corridor at the release');
  sim.command({ t: 'release' });
  let inside = false;
  const events: WorldEvent[] = [];
  for (let t = 0; t < 600 && (sim.world.move || !events.length); t++) {
    sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0;
    const e = enemy(sim, late);
    if (sim.world.move?.pierce && e && e.x > plan.pierce!.from.x && e.x <= plan.pierce!.to.x && Math.abs(e.y - 5) <= 0.5) inside = true;
  }
  assert(inside, 'the walker came into the corridor before the run passed it');
  assert(enemy(sim, late)?.hp === 1 && !enemy(sim, fixed), 'the walker untouched, the fixed body killed');
  assertPlanIsDash(sim, plan, events, 'fixed set');
});

check('a shaman\'s beam ending mid-run waits for the run: the weak body the plan kills with P 1 dies (the empower holds, as for a link)', () => {
  const sim = field({ shamanFirstMin: 0.05, shamanFirstMax: 0.05 } as Partial<Params>);
  place(sim, LINE[0]); place(sim, LINE[1]); place(sim, LINE[2], { hp: 2 });
  const body = place(sim, { x: 10.0, y: 5 }, { color: 1, hp: 0 });
  const shaman = place(sim, { x: 11.5, y: 7 }, { color: 2, kind: 'shaman' });
  for (let t = 0; t < 400; t++) { sim.tick(); const s = enemy(sim, shaman); if (s?.vars.beam !== undefined && s.vars.t < 0.2) break; }
  const s = enemy(sim, shaman)!;
  assert(s.vars.beam === body && s.vars.t > 0 && s.vars.t < 0.2, `the beam on the body ends soon (${s.vars.beam}, ${s.vars.t})`);
  sim.world.events.length = 0;
  draw(sim, LINE);
  const plan = planChain(sim.world);
  assert(plan.pierce?.power === 1 && plan.pierce.bodies.length === 1 && plan.pierce.bodies[0].id === body && plan.pierce.bodies[0].outcome.killed, 'the plan: P 1 kills the weak body');
  sim.command({ t: 'release' });
  const events = runDash(sim);
  assertPlanIsDash(sim, plan, events, 'shaman');
  assert(!events.some(e => e.type === 'enemySignal' && e.signal === 'empower' && e.enemyId === body), 'no empower before the hit');
  assert(replays(sim), 'replays');
});

check('P is not spent: two 3-HP bodies in a row both die from P 3', () => {
  const sim = field();
  for (const p of LINE) place(sim, p);
  const a = place(sim, { x: 9.2, y: 5 }, { color: 1, hp: 3 }), b = place(sim, { x: 10.0, y: 5.2 }, { color: 2, hp: 3 });
  draw(sim, LINE);
  const plan = planChain(sim.world);
  assert(plan.pierce?.bodies.every(x => x.outcome.killed && x.outcome.available === 3) && plan.pierce.kills === 2, 'both planned dead');
  sim.command({ t: 'release' });
  const events = runDash(sim);
  assertPlanIsDash(sim, plan, events, 'not spent');
  assert(!enemy(sim, a) && !enemy(sim, b), 'both dead');
});

check('the tail decides: a 35° turn in the last 3 links — no pierce; a bend early in a chain of 4 — the pierce stays; the hero → first link segment does not count', () => {
  const bent = field();
  const pts = [{ x: 6, y: 5 }, { x: 7.2, y: 5 }, { x: 7.2 + 1.2 * Math.cos(35 * Math.PI / 180), y: 5 + 1.2 * Math.sin(35 * Math.PI / 180) }];
  for (const p of pts) place(bent, p);
  draw(bent, pts);
  assert(bent.world.chain.length === 3 && !planChain(bent.world).pierce, 'a bent tail: no pierce');
  // 20° is within the limit.
  const ok = field();
  const pts20 = [{ x: 6, y: 5 }, { x: 7.2, y: 5 }, { x: 7.2 + 1.2 * Math.cos(20 * Math.PI / 180), y: 5 + 1.2 * Math.sin(20 * Math.PI / 180) }];
  for (const p of pts20) place(ok, p);
  draw(ok, pts20);
  assert(planChain(ok.world).pierce, 'a 20° turn: a pierce');
  // A chain of 4: the first link off the line (a 90° bend there), the last three straight upward.
  const early = field();
  const four = [{ x: 6, y: 5 }, { x: 6.2, y: 6.2 }, { x: 6.2, y: 7.4 }, { x: 6.2, y: 8.6 }];
  for (const p of four) place(early, p);
  const up = place(early, { x: 6.3, y: 9.6 }, { color: 1, hp: 1 });
  draw(early, four);
  const plan = planChain(early.world);
  assert(plan.pierce && plan.pierce.bodies.length === 1 && plan.pierce.bodies[0].id === up, 'the bend before the tail keeps the pierce');
  early.command({ t: 'release' });
  assertPlanIsDash(early, plan, runDash(early), 'early bend');
  assert(replays(early) && replays(bent), 'replays');
});

check('no pierce: the last link survives (the honest «tough at the end»), takes only a plate, or leaves P 0; the corridor stays untouched', () => {
  // A survivor at the end.
  const s1 = field();
  place(s1, LINE[0]); place(s1, LINE[1]); place(s1, LINE[2], { hp: 5 });
  const a1 = place(s1, { x: 9.4, y: 5 }, { color: 1, hp: 1 });
  draw(s1, LINE);
  assert(planChain(s1.world).endsOnSurvivor && !planChain(s1.world).pierce, 'a survivor: no pierce');
  s1.command({ t: 'release' });
  let events = runDash(s1);
  assert(!pierceEvents(events).length && enemy(s1, a1)?.hp === 1, 'the survivor ends it');
  // P 0: the last link has 3 HP — power 2 + 1 kills it and spends all 3.
  const s2 = field();
  place(s2, LINE[0]); place(s2, LINE[1]); place(s2, LINE[2], { hp: 3 });
  const a2 = place(s2, { x: 9.4, y: 5 }, { color: 1, hp: 0 });
  draw(s2, LINE);
  const p2 = planChain(s2.world);
  assert(p2.links[2].outcome?.killed && p2.power === 0 && !p2.pierce, 'P 0: no pierce, no arrow');
  s2.command({ t: 'release' });
  events = runDash(s2);
  assert(!pierceEvents(events).length && enemy(s2, a2), 'P 0: nothing pierced');
  // A plate taken off an armoured elite at the end is no kill.
  const s3 = field({ eliteArmor: true });
  place(s3, LINE[0]); place(s3, LINE[1]); place(s3, LINE[2], { elite: true });
  const a3 = place(s3, { x: 9.6, y: 5 }, { color: 1, hp: 0 });
  draw(s3, LINE);
  const p3 = planChain(s3.world);
  assert(p3.links[2].outcome?.plate && !p3.pierce, 'a plate at the end: no pierce');
  s3.command({ t: 'release' });
  events = runDash(s3);
  assert(!pierceEvents(events).length && enemy(s3, a3), 'a plate: nothing pierced');
  assert(replays(s1) && replays(s2) && replays(s3), 'replays');
});

check('a closed loop — the seal wins: a straight tail closed on the hero shows the seal, not the pierce', () => {
  const sim = field({ loopEnabled: true });
  const pts = [{ x: 5.8, y: 4 }, { x: 5.8, y: 5 }, { x: 5.8, y: 6 }];
  for (const p of pts) place(sim, p);
  draw(sim, pts);
  assert(planChain(sim.world).pierce, 'open: the pierce');
  sim.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' });
  const plan = planChain(sim.world);
  assert(sim.world.chainClosed === 'hero' && plan.seal && !plan.pierce, 'closed: the seal only');
  sim.command({ t: 'release' });
  assert(!pierceEvents(runDash(sim)).length, 'no pierce at the dash');
});

check('the cut: a wall stops the end before it (the body behind is not hit), a cliff too (no flight over it); water does not', () => {
  const walled = field({}, 'pierce-wall');
  for (const p of LINE) place(walled, p);
  const front = place(walled, { x: 8.9, y: 5 }, { color: 1, hp: 0 }), behind = place(walled, { x: 10.3, y: 5 }, { color: 1, hp: 0 });
  draw(walled, LINE);
  let plan = planChain(walled.world);
  const r = walled.world.params.bodyRadius * walled.world.params.heroHitFactor;
  assert(plan.pierce && plan.pierce.to.x <= 9.4 - r + 1e-9 && plan.pierce.to.x > 9.4 - r - 0.05 - 1e-9, `cut before the wall at ${plan.pierce?.to.x}`);
  assert(plan.pierce.bodies.map(b => b.id).join() === String(front), 'only the body before the wall');
  walled.command({ t: 'release' });
  assertPlanIsDash(walled, plan, runDash(walled), 'wall');
  assert(enemy(walled, behind), 'behind the wall: untouched');

  const cliff = field({}, 'pierce-cliff');
  for (const p of LINE) place(cliff, p);
  const over = place(cliff, { x: 11.2, y: 5 }, { color: 1, hp: 0 });
  draw(cliff, LINE);
  plan = planChain(cliff.world);
  assert(plan.pierce && plan.pierce.to.x <= 9.6 - r + 1e-9 && plan.pierce.bodies.length === 0, `cut before the cliff at ${plan.pierce?.to.x}`);
  cliff.command({ t: 'release' });
  assertPlanIsDash(cliff, plan, runDash(cliff), 'cliff');
  assert(enemy(cliff, over) && cliff.world.hero.x < 9.6, 'the hero stops before the cliff; the body beyond it untouched');

  const wet = field({}, 'pierce-pond');
  for (const p of LINE) place(wet, p);
  draw(wet, LINE);
  assert(Math.abs((planChain(wet.world).pierce?.length ?? 0) - 1.875) < 1e-9, 'water does not cut it');
  assert(replays(walled) && replays(cliff) && replays(wet), 'replays');
});

check('any body: a shield (whatever its facing), an armoured elite (a plate, one per pierce), a frozen brittle body (×2 fixed at the release, spent)', () => {
  const sim = field({ eliteArmor: true, frostRadius: 0.5 } as Partial<Params>);
  for (const p of LINE) place(sim, p);
  const shield = place(sim, { x: 9.0, y: 5 }, { color: 1, hp: 2, kind: 'shield' });
  const elite = place(sim, { x: 9.6, y: 5.2 }, { color: 2, elite: true });
  const cold = place(sim, { x: 10.1, y: 4.8 }, { color: 3, hp: 5 });
  sim.command({ t: 'items', kind: 'frost', count: 1 });
  sim.command({ t: 'item', kind: 'frost', x: 10.1, y: 4.8 });
  assert(enemy(sim, cold)?.brittle && !enemy(sim, shield)?.brittle, 'only the third body is frozen');
  draw(sim, LINE);
  const plan = planChain(sim.world);
  const byId = new Map(plan.pierce!.bodies.map(b => [b.id, b.outcome]));
  assert(byId.get(shield)?.killed && byId.get(elite)?.plate && byId.get(cold)?.killed && byId.get(cold)?.damage === 6, `outcomes ${JSON.stringify([...byId])}`);
  const plates = enemy(sim, elite)!.armor!.plates;
  sim.command({ t: 'release' });
  const events = runDash(sim);
  assertPlanIsDash(sim, plan, events, 'shield/elite/cold');
  assert(enemy(sim, elite)!.armor!.plates === plates - 1 && events.some(e => e.type === 'elitePlates' && e.action === 'strip' && e.source === PIERCE_SOURCE && e.removed === 1), 'one plate, source pierce');
  assert(replays(sim), 'replays');
});

check('the cauldron: the bodies\' embers join the chain\'s cheque (no heat, no `purseKill`); the plan\'s cheque is the dash\'s', () => {
  const sim = field({ purse: true });
  for (const p of LINE) place(sim, p);
  place(sim, { x: 9.2, y: 5 }, { color: 1, hp: 2 }); place(sim, { x: 9.8, y: 5.1 }, { color: 2, hp: 0 });
  draw(sim, LINE);
  const plan = planChain(sim.world);
  // Links: 3 weak — 1 ember each; bodies: 2 HP removed — 2, a weak one — 1; heat 1 + 1 (3 links), no «Добивание» (< 4 links).
  assert(plan.cheque && plan.cheque.embers === 3 + 2 + 1 && plan.cheque.heat === 2 && plan.cheque.links === 3, `the plan's cheque ${JSON.stringify(plan.cheque)}`);
  sim.command({ t: 'release' });
  const events = runDash(sim);
  assertPlanIsDash(sim, plan, events, 'purse');
  assert(!events.some(e => e.type === 'purseKill'), 'no separate embers for pierce kills');
  assert(replays(sim), 'replays');
});

check('the open door is not entered by the pierce: the run crosses it and the fight goes on', () => {
  const sim = field({ purse: true, doorFinale: true }, 'pierce-door');
  sim.command({ t: 'goals' });
  for (const p of LINE) place(sim, p);
  draw(sim, LINE);
  assert(planChain(sim.world).pierce && !planChain(sim.world).cheque?.door, 'the plan: a pierce, no door heat');
  sim.command({ t: 'release' });
  const events = runDash(sim, 30);
  assert(sim.world.status === 'playing' && !events.some(e => e.type === 'purseDoor'), 'no victory');
  assert(replays(sim), 'replays');
});

check('«Режущий проход» acts along the run: a body beside the pierce, out of its corridor, is cut', () => {
  const sim = field({}, 'pierce-field', 1, { hammer: HAMMERS.cut });
  for (const p of LINE) place(sim, p);
  const beside = place(sim, { x: 9.6, y: 5.7 }, { color: 1, hp: 3 });
  draw(sim, LINE);
  assert(planChain(sim.world).pierce?.bodies.length === 0, 'not in the corridor');
  sim.command({ t: 'release' });
  runDash(sim);
  assert(enemy(sim, beside)?.hp === 2, `cut along the run (hp ${enemy(sim, beside)?.hp})`);
});

/** A small deterministic generator for the random scenes (test-side only). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

check('the highlight is the dash on random scenes of 8 seeds: walking enemies, shields, elites, the cold, the hit-stop; each replays to the same hash every 300 ticks', () => {
  let pierced = 0, bodies = 0, killed = 0, plates = 0, wounded = 0;
  const outcomes = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const rnd = rngOf(seedOf(k));
    const sim = field({ enemySpeed: 0.8, eliteArmor: true, hitstop: k % 2 === 0, frostRadius: 0.45 } as Partial<Params>, 'pierce-field', k);
    const hero = { x: 4.5, y: 6 };
    sim.command({ t: 'teleport', x: hero.x, y: hero.y });
    let angle = (rnd() - 0.5) * 0.8;
    const links: Vec[] = [];
    let at = { x: hero.x + 1.3 * Math.cos(angle), y: hero.y + 1.3 * Math.sin(angle) };
    for (let i = 0; i < 3; i++) {
      links.push(at);
      angle += (rnd() - 0.5) * 0.3;
      const d = 1.0 + rnd() * 0.4;
      at = { x: at.x + d * Math.cos(angle), y: at.y + d * Math.sin(angle) };
    }
    for (const p of links) place(sim, p, { hp: rnd() < 0.3 ? 1 : 0 });
    // The corridor ahead of the last link, along the last segment's direction.
    const last = links[2], prev = links[1], len = Math.hypot(last.x - prev.x, last.y - prev.y), ux = (last.x - prev.x) / len, uy = (last.y - prev.y) / len;
    const n = 2 + Math.floor(rnd() * 3);
    let frozen: Vec | null = null;
    for (let i = 0; i < n; i++) {
      const t = 0.35 + (1.5 * (i + rnd() * 0.8)) / n, off = (rnd() - 0.5) * 0.8;
      const p = { x: last.x + ux * t - uy * off, y: last.y + uy * t + ux * off };
      const roll = rnd();
      const kind = roll < 0.2 ? 'shield' : 'basic', elite = roll > 0.85;
      place(sim, p, { color: 1 + Math.floor(rnd() * 3), hp: Math.floor(rnd() * 5), kind, elite });
      if (i === n - 1 && rnd() < 0.5) frozen = p;
    }
    if (frozen) { sim.command({ t: 'items', kind: 'frost', count: 1 }); sim.command({ t: 'item', kind: 'frost', x: frozen.x, y: frozen.y }); }
    // A few walkers around: they keep moving while the chain is drawn and during the dash.
    for (let i = 0; i < 4; i++) place(sim, { x: 13 + rnd() * 5, y: 1.5 + rnd() * 9 }, { color: Math.floor(rnd() * 4), hp: 1 });
    for (let t = 0; t < 10; t++) sim.tick();
    draw(sim, links.map((_, i) => { const e = sim.world.enemies[i]; return { x: e.x, y: e.y }; }));
    assert(sim.world.chain.length === 3, `seed ${k}: the chain is drawn (${sim.world.chain.length})`);
    const plan = planChain(sim.world);
    sim.command({ t: 'release' });
    const events = runDash(sim);
    if (plan.pierce) {
      pierced++;
      assertPlanIsDash(sim, plan, events, `seed ${k}`);
      for (const b of plan.pierce.bodies) {
        bodies++;
        if (b.outcome.killed) killed++; else if (b.outcome.plate) plates++; else wounded++;
        outcomes.add(b.outcome.killed ? 'kill' : b.outcome.plate ? 'plate' : 'wound');
      }
    } else assert(!pierceEvents(events).some(e => e.phase === 'release'), `seed ${k}: no plan, no pierce`);
    // Replay: the same hash at the end and every 300 ticks.
    for (let t = 0; t < 600; t++) sim.tick();
    const again = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)));
    assert(again.hash() === sim.hash(), `seed ${k}: replays`);
  }
  console.log(`   ${pierced}/8 seeds pierced; bodies ${bodies}: killed ${killed}, a plate ${plates}, wounded ${wounded}`);
  assert(pierced >= 6 && outcomes.size >= 3, 'the scenes pierce and meet every outcome');
});

check('replay checkpoints: a pierce fight replays to the same hash every 300 ticks; a journal without the keys plays the old world', () => {
  const sim = field({ enemySpeed: 0.8 });
  for (const p of LINE) place(sim, p);
  for (let i = 0; i < 5; i++) place(sim, { x: 9 + i * 0.4, y: 4.8 + (i % 2) * 0.3 }, { color: 1 + (i % 3), hp: i % 3 });
  draw(sim, LINE);
  sim.command({ t: 'release' });
  const hashes: string[] = [];
  for (let t = 1; t <= 900; t++) { sim.tick(); if (t % 300 === 0) hashes.push(sim.hash()); }
  const seen: string[] = [];
  const again = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), r => { if (r.world.tick % 300 === 0) seen.push(r.hash()); });
  assert(again.hash() === sim.hash() && seen.join() === hashes.join(), `checkpoints ${seen.length}/${hashes.length}`);
  // Off: the keys removed from the journal, the same world (params aside).
  const off = field({ pierceEnabled: false, enemySpeed: 0.8 });
  for (const p of LINE) place(off, p);
  place(off, { x: 9.4, y: 5 }, { color: 1, hp: 1 });
  draw(off, LINE);
  off.command({ t: 'release' });
  for (let t = 0; t < 400; t++) off.tick();
  const old = JSON.parse(JSON.stringify(off.exportJournal()!));
  for (const key of ['pierceEnabled', 'pierceTurn', 'pierceLength', 'pierceCorridor']) delete old.params[key];
  const played = replay(old);
  const strip = (s: unknown): string => { const { params: _p, ...rest } = s as Record<string, unknown>; void _p; return JSON.stringify(rest); };
  assert(strip(worldState(played.world)) === strip(worldState(off.world)), 'the old journal plays the same world');
});

check('telemetry: `chain.pierces` from the release, `chain.pierceHits` per run (an empty one too), `kills.tools.pierce`', () => {
  const sim = field();
  for (const p of LINE) place(sim, p);
  place(sim, { x: 9.2, y: 5 }, { color: 1, hp: 0 }); place(sim, { x: 9.8, y: 4.9 }, { color: 2, hp: 9 });
  draw(sim, LINE);
  sim.command({ t: 'release' });
  runDash(sim, 10);
  // A second, empty pierce: a straight chain with nothing ahead.
  const second = [{ x: 9.6, y: 7 }, { x: 10.8, y: 7 }, { x: 12, y: 7 }];
  sim.command({ t: 'teleport', x: 8.3, y: 7 });
  for (const p of second) place(sim, p);
  draw(sim, second);
  assert(planChain(sim.world).pierce?.bodies.length === 0, 'an empty pierce is still a pierce');
  sim.command({ t: 'release' });
  runDash(sim, 10);
  const summary = analyzeJournal(JSON.parse(JSON.stringify(sim.exportJournal()!))).summary;
  assert(summary.chain.pierces === 2 && summary.chain.pierceHits.join() === '2,0' && summary.kills.tools.pierce === 1, `summary ${JSON.stringify({ p: summary.chain.pierces, h: summary.chain.pierceHits, t: summary.kills.tools })}`);
});

console.log(`realtime-pierce: ${checks} checks passed`);
