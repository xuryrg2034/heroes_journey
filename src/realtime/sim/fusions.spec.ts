/**
 * Task 44 «Сплавы» (docs/design-notes/task-44-fusions.md; docs/realtime-prototype.md, section 9ц): the three fusions in a fight.
 * Node only: `npm run test:realtime-fusions`. Every check plays journalled commands (place, teleport, items, item, begin, drag,
 * release) with the fusion in the arena's loadout, as a run or the sandbox gives it, and looks at what the player meets:
 * - «Копьё»: the pierce of «Прямая» reaches twice as far (a body beyond the plain pierce's end is struck) and takes 2 plates off an
 *   armoured elite instead of one;
 * - «Ледяная печать»: the survivors inside the closed ring freeze for 3 s and are brittle — the next chain hit on them is ×2 (the
 *   plain «Печать»: 1.5 s, no ×2); an elite inside freezes too;
 * - «Бумеранг»: the second pass of «Возврат» goes with the dash's full power when the last link died, with the half when the chain
 *   ends on a survivor (the plain «Возврат»: always the half);
 * - the parts keep their own rules (the kit holds them);
 * - the highlight is the dash: what `planChain` shows before the release (the pierce's length, bodies and plates; the frozen set
 *   and its cold; the second pass's power and hits) is what the fight does, on scenes of several seeds;
 * - every fight replays to the same hash, checkpoints every 300 ticks; a journal without the fusion keys plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain, type ChainPlan } from './chain';
import { COUNTER_TALISMANS as CT, FORMS, FUSIONS, HAMMERS } from './buildIds';
import { worldState } from './hash';
import { kitOf, type Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { PIERCE_SOURCE } from './pierce';
import { Simulation, replay, type Journal } from './simulation';
import type { Vec } from './geometry';
import type { Enemy, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

registerArena({ goal: 'kills', width: 20, height: 12, heroStart: { x: 4.5, y: 5 }, buttons: [], enemies: [], killGoal: 999, id: 'fusions-field', name: 'Поле сплавов', summary: 'Тест сплавов', obstacles: [], door: { x: 19.3, y: 6 } });

/** A quiet fight: no newcomers, nobody walks or touches, no hit-stop; the sandbox toggles of the loop and the pierce off (the kit decides). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.loopEnabled = false; p.pierceEnabled = false;
  return Object.assign(p, extra);
}
function fight(talismans: string[], extra: Partial<Params> = {}, k = 1, loadout: Loadout = {}): Simulation {
  const sim = new Simulation({ arena: 'fusions-field', params: quiet(extra), seed: seedOf(k), record: true, loadout: { talismans, ...loadout } });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
const place = (sim: Simulation, at: Vec, opts: { color?: number; hp?: number; elite?: boolean } = {}): number =>
  sim.command({ t: 'place', x: at.x, y: at.y, color: opts.color ?? 0, hp: opts.hp ?? 0, kind: 'basic', ...opts.elite ? { elite: true } : {} }) as number;
const enemy = (sim: Simulation, id: number): Enemy | undefined => sim.world.enemies.find(e => e.id === id);
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the hero stands (the dash, the pierce, a return run), collecting the events; `seen` looks at every tick. */
function settle(sim: Simulation, seen?: (events: readonly WorldEvent[]) => void): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < 1500 && (sim.world.move || i === 0); i++) {
    sim.tick();
    const now = [...sim.world.events];
    seen?.(now);
    out.push(...now); sim.world.events.length = 0;
  }
  return out;
}
/** The journal replays to the same hash at every 300th tick and at the end (the fight goes on 400 ticks more first). */
function replaysWithCheckpoints(sim: Simulation): boolean {
  const marks = new Map<number, string>();
  for (let i = 0; i < 400; i++) { sim.tick(); if (sim.world.tick % 300 === 0) marks.set(sim.world.tick, sim.hash()); }
  let okMarks = true;
  const again = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal, s => { const want = marks.get(s.world.tick); if (want !== undefined && want !== s.hash()) okMarks = false; });
  return okMarks && again.hash() === sim.hash();
}
const fired = (events: readonly WorldEvent[], id: string): boolean => events.some(e => e.type === 'talismanFired' && e.id === id);

/** Three weak colour-0 links on y = 5 from the hero at (4.5, 5): the axis +x from (8.4, 5). */
const LINE: Vec[] = [{ x: 6, y: 5 }, { x: 7.2, y: 5 }, { x: 8.4, y: 5 }];

/** The pierce of the plan is what the dash did: each body killed by the pierce, stripped to the planned plates, or wounded to the planned HP. */
function assertPierceIsPlan(sim: Simulation, plan: ChainPlan, events: readonly WorldEvent[], label: string): void {
  const pierce = plan.pierce!;
  for (const b of pierce.bodies) {
    const e = enemy(sim, b.id);
    if (b.outcome.killed) assert(!e && events.some(x => x.type === 'kill' && x.enemyId === b.id && x.source === PIERCE_SOURCE), `${label}: body ${b.id} killed by the pierce`);
    else if (b.outcome.plate) assert(e?.armor?.plates === b.outcome.platesAfter, `${label}: body ${b.id} plates ${e?.armor?.plates}, planned ${b.outcome.platesAfter}`);
    else assert(e?.hp === b.outcome.hpAfter, `${label}: body ${b.id} hp ${e?.hp}, planned ${b.outcome.hpAfter}`);
  }
  assert(near(sim.world.hero.x, pierce.to.x) && near(sim.world.hero.y, pierce.to.y), `${label}: the hero ends at the planned end`);
}

check('the kit: a fusion brings its parts (their rules stay); «Бумеранг» takes the hammer slot with «Возврат»; a loadout without a fusion makes the same kit', () => {
  const ice = kitOf({ talismans: [FUSIONS.iceSeal] }), spear = kitOf({ talismans: [FUSIONS.spear, 'whetstone'] }), boom = kitOf({ talismans: [FUSIONS.boomerang] });
  assert(ice.talismans.join() === [FUSIONS.iceSeal, FORMS.seal, CT.frostEdge].join() && ice.hammer === undefined, `ice ${ice.talismans}`);
  assert(spear.talismans.join() === [FUSIONS.spear, FORMS.pierce, CT.longArm, 'whetstone'].join(), `spear ${spear.talismans}`);
  assert(boom.talismans.join() === [FUSIONS.boomerang, CT.finisher].join() && boom.hammer === HAMMERS.return, `boomerang ${boom.talismans} ${boom.hammer}`);
  const plain = { talismans: [FORMS.pierce, CT.longArm], hammer: HAMMERS.fire } as Loadout;
  assert(JSON.stringify(kitOf(plain)) === JSON.stringify(kitOf(JSON.parse(JSON.stringify(plain)))) && kitOf(plain).talismans.join() === plain.talismans!.join() && kitOf(plain).hammer === HAMMERS.fire, 'no fusion — the kit as given');
});

check('«Копьё»: the pierce reaches twice as far — a body beyond the plain end is struck; the highlight shows the length; the parts\' rules stay', () => {
  for (const [talismans, factor] of [[[FORMS.pierce], 1], [[FUSIONS.spear], 2]] as const) {
    const sim = fight([...talismans]);
    for (const p of LINE) place(sim, p);
    const close = place(sim, { x: 9.6, y: 5 }, { color: 2, hp: 1 }), far = place(sim, { x: 11.4, y: 5 }, { color: 2, hp: 1 });
    const farHp = enemy(sim, far)!.hp;
    draw(sim, LINE);
    const plan = planChain(sim.world);
    assert(plan.pierce && near(plan.pierce.length, 1.875 * factor), `×${factor}: the planned length ${plan.pierce?.length}`);
    const ids = plan.pierce.bodies.map(b => b.id);
    assert(ids.includes(close) && ids.includes(far) === (factor === 2), `×${factor}: the planned bodies ${ids}`);
    sim.command({ t: 'release' });
    const events = settle(sim);
    assertPierceIsPlan(sim, plan, events, `×${factor}`);
    assert(factor === 2 ? !enemy(sim, far) || enemy(sim, far)!.hp < farHp : enemy(sim, far)!.hp === farHp, `×${factor}: the far body`);
    assert(fired(events, FUSIONS.spear) === (factor === 2), `×${factor}: the fusion's signal`);
    assert(replaysWithCheckpoints(sim), `×${factor}: replays`);
  }
  // «Длинная рука» inside «Копьё» (the sandbox's window «every 4th chain»; the run's — from the 3rd link): R ×1.5 on its chain.
  const window = fight([FUSIONS.spear], { counterWindow: true });
  const r = window.world.params.linkRadius;
  for (const p of LINE) place(window, p);
  draw(window, LINE.slice(0, 2));
  const reach = { x: LINE[1].x + r * 1.3, y: 5 };
  place(window, reach);
  window.command({ t: 'drag', x: reach.x, y: reach.y, mode: 'full' });
  assert(window.world.chain.length === 3, `«Длинная рука» kept: the 3rd link taken at ${(r * 1.3).toFixed(2)} (R ${r})`);
});

check('«Копьё»: an armoured elite in the corridor loses 2 plates instead of one; the highlight shows the plates left', () => {
  for (const [talismans, strip] of [[[FORMS.pierce], 1], [[FUSIONS.spear], 2]] as const) {
    const sim = fight([...talismans], { eliteArmor: true });
    for (const p of LINE) place(sim, p);
    const elite = place(sim, { x: 9.6, y: 5 }, { color: 2, elite: true });
    const plates = enemy(sim, elite)!.armor!.plates;
    assert(plates >= 2, `the elite has ${plates} plates`);
    draw(sim, LINE);
    const plan = planChain(sim.world), body = plan.pierce!.bodies.find(b => b.id === elite)!;
    assert(body.outcome.plate && body.outcome.platesAfter === plates - strip && (plan.pierce!.plates ?? 1) === strip, `−${strip}: planned ${body.outcome.platesAfter}`);
    sim.command({ t: 'release' });
    const events = settle(sim);
    assertPierceIsPlan(sim, plan, events, `−${strip}`);
    assert(events.some(e => e.type === 'elitePlates' && e.action === 'strip' && e.enemyId === elite && e.removed === strip && e.source === PIERCE_SOURCE), `−${strip}: the strip event`);
    assert(replaysWithCheckpoints(sim), `−${strip}: replays`);
  }
});

/** A ring of 4 colour-0 links around (7, 5); inside — a colour-2 body and a colour-3 elite. */
const SQUARE: Vec[] = [{ x: 6, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 6 }, { x: 6, y: 6 }];
function sealScene(talismans: string[], k = 1, hp = 3) {
  const sim = fight(talismans, {}, k);
  for (const p of SQUARE) place(sim, p);
  const inner = place(sim, { x: 7, y: 5 }, { color: 2, hp }), elite = place(sim, { x: 7.3, y: 5.4 }, { color: 3, hp: 3, elite: true });
  draw(sim, SQUARE);
  sim.command({ t: 'drag', x: SQUARE[0].x, y: SQUARE[0].y, mode: 'full' });
  assert(sim.world.chainClosed === 'first', 'the ring closed');
  return { sim, inner, elite };
}

check('«Ледяная печать»: the survivors inside freeze for 3 s and are brittle (the next chain hit ×2); the plain «Печать» holds 1.5 s without ×2; the highlight shows the frozen set', () => {
  for (const [talismans, ice] of [[[FORMS.seal], false], [[FUSIONS.iceSeal], true]] as const) {
    const { sim, inner, elite } = sealScene([...talismans]);
    const plan = planChain(sim.world), seal = plan.seal!;
    assert(seal.inside.includes(inner) && seal.inside.includes(elite), 'both inside');
    assert(near(seal.hold, ice ? 3 : 1.5) && !!seal.ice === ice, `${ice ? 'ice' : 'plain'}: the planned hold ${seal.hold}, ice ${JSON.stringify(seal.ice)}`);
    if (ice) assert(seal.ice!.brittle && seal.ice!.ids.join() === [inner, elite].join(), `the planned frozen set ${seal.ice!.ids}`);
    sim.command({ t: 'release' });
    let at: { chill: number; brittle: boolean }[] | null = null, strikes = 0;
    const events = settle(sim, now => {
      if (!now.some(e => e.type === 'seal' && e.phase === 'strike')) return;
      strikes++;
      at = [inner, elite].map(id => ({ chill: enemy(sim, id)?.chill ?? 0, brittle: !!enemy(sim, id)?.brittle }));
    });
    assert(strikes === 1 && at, 'the seal struck once');
    const cold = at as { chill: number; brittle: boolean }[];
    for (const c of cold) assert(near(c.chill, ice ? 3 : 1.5, 1 / 60 + 1e-9) && c.brittle === ice, `${ice ? 'ice' : 'plain'}: chill ${c.chill}, brittle ${c.brittle}`);
    assert(fired(events, FUSIONS.iceSeal) === ice, 'the fusion\'s signal');
    // The next chain: one link on the frozen inner body — ×2 with the ice (the highlight says so).
    const before = enemy(sim, inner)!;
    draw(sim, [{ x: before.x, y: before.y }]);
    const hit = planChain(sim.world).links[0].outcome!;
    assert(hit.damage === hit.available * (ice ? 2 : 1), `${ice ? 'ice' : 'plain'}: the next hit ${hit.damage} of ${hit.available}`);
    sim.command({ t: 'release' });
    settle(sim);
    const after = enemy(sim, inner);
    assert(hit.killed ? !after : after?.hp === hit.hpAfter, 'the hit is the highlight\'s');
    assert(replaysWithCheckpoints(sim), 'replays');
  }
});

/** Five links in a row from (4, 6) (the last one's HP `lastHp`), bodies of other colours near the way back. */
function returnScene(talismans: string[], lastHp: number, extra: Partial<Params> = {}, k = 1, hammer?: string) {
  const sim = fight(talismans, { returnFixed: true, ...extra }, k, hammer ? { hammer: hammer as Loadout['hammer'] } : {});
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [1, 2, 3, 4, 5].map(i => ({ x: 4 + 1.2 * i, y: 6 }));
  links.forEach((p, i) => place(sim, p, { hp: i === 4 ? lastHp : 0 }));
  const off = [place(sim, { x: 6.6, y: 6.7 }, { color: 1, hp: 6 }), place(sim, { x: 5.4, y: 5.3 }, { color: 2, hp: 6 }), place(sim, { x: 4.5, y: 6.7 }, { color: 3, hp: 6 })];
  draw(sim, links);
  return { sim, off };
}
/** The return run's power when it starts and its hits (the bodies' HP after it). */
function runBack(sim: Simulation, plan: ChainPlan): { power: number; events: WorldEvent[] } {
  sim.command({ t: 'release' });
  let power = -1;
  const events = settle(sim, () => { if (power < 0 && sim.world.move?.kind === 'return') power = sim.world.move.power; });
  for (const h of plan.back!.hits) {
    const e = enemy(sim, h.id);
    assert(h.outcome.killed ? !e : e?.hp === h.outcome.hpAfter, `the return hit on ${h.id}: hp ${e?.hp}, planned ${h.outcome.hpAfter}`);
  }
  return { power, events };
}

check('«Бумеранг»: the last link died — the second pass with the dash\'s full power; the chain ends on a survivor — the half; the plain «Возврат» — the half; the highlight shows the power', () => {
  for (const [talismans, hammer, full] of [[[], HAMMERS.return, false], [[FUSIONS.boomerang], undefined, true]] as const) {
    const { sim } = returnScene([...talismans], 0, {}, 1, hammer);
    const plan = planChain(sim.world);
    assert(plan.back && !plan.endsOnSurvivor, 'a return run after a chain that killed its last link');
    const want = full ? Math.max(1, plan.power) : Math.max(1, Math.floor(plan.power / 2));
    assert(plan.back.power === want && !!plan.back.full === full, `${full ? 'full' : 'half'}: planned ${plan.back.power} of ${plan.power}`);
    const { power, events } = runBack(sim, plan);
    assert(power === plan.back.power, `${full ? 'full' : 'half'}: the run's power ${power}, planned ${plan.back.power}`);
    assert(fired(events, FUSIONS.boomerang) === full, 'the fusion\'s signal');
    assert(replaysWithCheckpoints(sim), 'replays');
  }
  const { sim } = returnScene([FUSIONS.boomerang], 20);
  const plan = planChain(sim.world);
  assert(plan.endsOnSurvivor && plan.back && !plan.back.full, 'a survivor at the end: no full power');

  const { power, events } = runBack(sim, plan);
  assert(power === plan.back.power && !fired(events, FUSIONS.boomerang), `the half: ${power} = ${plan.back.power}`);
  assert(replaysWithCheckpoints(sim), 'replays');
  // The last link an armoured elite: the chain takes its plate and goes on with power left, the last link did not die — the half.
  const plated = fight([FUSIONS.boomerang], { returnFixed: true, eliteArmor: true });
  plated.command({ t: 'teleport', x: 4, y: 6 });
  const row = [1, 2, 3, 4, 5].map(i => ({ x: 4 + 1.2 * i, y: 6 }));
  row.forEach((p, i) => place(plated, p, i === 4 ? { elite: true } : {}));
  draw(plated, row);
  const pp = planChain(plated.world);
  assert(pp.links[4].outcome?.plate && !pp.endsOnSurvivor && pp.power >= 2 && pp.back && !pp.back.full && pp.back.power === Math.max(1, Math.floor(pp.power / 2)), `a plate on the last link: the half ${pp.back?.power} of ${pp.power}`);
  const back = runBack(plated, pp);
  assert(back.power === pp.back.power && !fired(back.events, FUSIONS.boomerang), `the run's half ${back.power}`);
  assert(replaysWithCheckpoints(plated), 'replays');
});

/** A tiny seeded generator for the scenes (not the simulation's: the scenes only place bodies). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

check('the highlight is the fight on scenes of 6 seeds for each fusion (HP and places by the seed); outcomes vary; every fight replays', () => {
  const outcomes = new Set<string>();
  for (let k = 1; k <= 6; k++) {
    const rnd = rngOf(seedOf(k));
    // «Копьё»: bodies along a longer corridor, some elites.
    const spear = fight([FUSIONS.spear], { eliteArmor: true }, k);
    for (const p of LINE) place(spear, p);
    for (let i = 0; i < 4; i++) place(spear, { x: 8.9 + i * 0.85 + rnd() * 0.3, y: 5 + (rnd() - 0.5) * 0.6 }, { color: 1 + Math.floor(rnd() * 3), hp: Math.floor(rnd() * 4), elite: rnd() < 0.25 });
    draw(spear, LINE);
    const sp = planChain(spear.world);
    assert(sp.pierce, `seed ${k}: a pierce`);
    spear.command({ t: 'release' });
    assertPierceIsPlan(spear, sp, settle(spear), `seed ${k} spear`);
    for (const b of sp.pierce.bodies) outcomes.add(`spear:${b.outcome.killed ? 'kill' : b.outcome.plate ? 'plate' : 'wound'}`);
    assert(replaysWithCheckpoints(spear), `seed ${k}: spear replays`);
    // «Ледяная печать»: the inner body's HP by the seed — killed by the seal or frozen.
    const { sim: ice, inner, elite } = sealScene([FUSIONS.iceSeal], k, Math.floor(rnd() * 3));
    const frozen = planChain(ice.world).seal!.ice!.ids;
    ice.command({ t: 'release' });
    let after: number[] | null = null;
    settle(ice, now => { if (now.some(e => e.type === 'seal' && e.phase === 'strike')) after = [inner, elite].filter(id => (enemy(ice, id)?.chill ?? 0) > 0 && enemy(ice, id)?.brittle); });
    assert(after && (after as number[]).join() === frozen.join(), `seed ${k}: frozen ${after}, planned ${frozen}`);
    outcomes.add(`ice:${frozen.length}`);
    assert(replaysWithCheckpoints(ice), `seed ${k}: ice replays`);
    // «Бумеранг»: the last link's HP by the seed — dies (full) or survives (half).
    const lastHp = rnd() < 0.5 ? 0 : 9;
    const { sim: boom } = returnScene([FUSIONS.boomerang], lastHp, { enemySpeed: 0 }, k);
    const bp = planChain(boom.world);
    const { power } = runBack(boom, bp);
    assert(power === bp.back!.power, `seed ${k}: the run's power ${power} = ${bp.back!.power}`);
    outcomes.add(`boomerang:${bp.back!.full ? 'full' : 'half'}`);
    assert(replaysWithCheckpoints(boom), `seed ${k}: boomerang replays`);
  }
  assert(outcomes.size >= 5, `outcomes vary: ${[...outcomes].join(', ')}`);
});

check('a journal without the fusion keys plays the same world (a fight without a fusion never reads them)', () => {
  const sim = fight([FORMS.pierce, CT.longArm]);
  for (const p of LINE) place(sim, p);
  place(sim, { x: 9.6, y: 5 }, { color: 2, hp: 1 });
  draw(sim, LINE);
  sim.command({ t: 'release' });
  settle(sim);
  for (let i = 0; i < 300; i++) sim.tick();
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal & { params: Record<string, unknown> };
  for (const key of ['fusionSpearFactor', 'fusionSpearPlates', 'fusionIceTime', 'fusionIceBrittle']) {
    assert(key in journal.params, `${key} is in the journal`);
    delete journal.params[key];
  }
  const { params: _a, ...a } = worldState(sim.world) as Record<string, unknown>, { params: _b, ...b } = worldState(replay(journal).world) as Record<string, unknown>;
  assert(JSON.stringify(a) === JSON.stringify(b), 'the same world without the keys');
});

console.log(`\n${checks} checks passed`);
