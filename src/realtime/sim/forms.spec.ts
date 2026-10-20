/**
 * Task 29 «Формы в песочнице», track A (docs/realtime-prototype.md, section 9ф): the forms of the chain's core in the sandbox.
 * Node only: `npm run test:realtime-forms`. Every check plays journalled commands (place, teleport, begin, drag, release, param)
 * and looks at what the player meets:
 * - «Печать» and «Прямая» as forms in the kit (the sandbox toggles off): the ring closes and strikes inside; the pierce runs;
 *   without the form — the old rules;
 * - the rank of the field «Конец»: a sealed chain has no pierce and no end blast, a pierce that ran leaves no end blast, a chain
 *   whose last link survives gets its blast; the toggles alone keep the old path (pierce and blast both);
 * - «Развилка»: a link is taken within R of a link that is not the last; the dash runs in the order drawn; the hint names the
 *   anchor; no loop with it; with «Якорь у героя» the hero is an anchor too;
 * - «Чужак»: one link of another colour a chain (an elite too); the second is refused; the chain keeps its colour;
 * - «Близнецы»: colours 1 + 3 and 2 + 4 are one colour; an incomplete pair in a row of 3 colours; ranked above «Чужак»;
 * - «Возврат»: the way back and the second pass in `planChain` before the release equal the run — without `returnFixed` on a
 *   scene where nobody walks, with it also while the enemies walk; the first pass killed everyone near the way — an empty run;
 *   «Ударная волна» of the same chain kills and wounds before the run — the plan's marks are struck after it (`returnShadowEnd`,
 *   a journal without the key — the old shadow); with `returnFixed` the release fixes the wave's bodies too (`returnWaveFixed`:
 *   a body that walks out of the circle during the dash is struck, one that walks in is not; without «Возврат» or a key — the
 *   old wave; a journal without the key — the old wave); a closed door is no link (a goal met mid-dash opens it, the fight and the run go
 *   on); a chain into the open door wins — no run in the plan, none made;
 * - the highlight is the dash on random fights of several seeds with the forms (links, pierce, return); every fight replays to
 *   the same hash (checkpoints every 300 ticks); journals without the new ids and without `returnFixed` play the old world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. No bot win or loss is asserted.
 */
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import legacyJournals from '../../../tests/fixtures/realtime-legacy-build-journals.json';
import { registerArena } from './arenas';
import { BUILD_SOURCES, COUNTER_TALISMANS, FORMS, FORM_FIELD, HAMMERS } from './buildIds';
import { chainColor, colorGroups, colorJoin, colorShiftIds, colorShiftLeft, enemyAnchors, forkAnchorOf, enemyRefusal, foreignLeft, hoverRefusal, loopCandidates, nextCandidates, planChain, twinsNextColor, type ChainPlan, type StrikeOutcome } from './chain';
import { platesOf } from './elites';
import { bodyRadiusOf } from './enemies/kinds';
import { returnRunOf } from './hammers';
import { worldState } from './hash';
import { linkDepths } from './linkDepth';
import { defaultParams, runParams, type Params } from './params';
import { sealDamage } from './seal';
import { Simulation, replay, type Journal } from './simulation';
import type { Loadout } from './kit';
import type { Enemy, WorldEvent } from './world';
import type { Vec } from './geometry';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({ goal: 'kills', width: 20, height: 12, heroStart: { x: 4.5, y: 5 }, buttons: [], enemies: [], killGoal: 999, id: 'forms-field', name: 'Поле форм', summary: 'Тест форм', obstacles: [], door: { x: 19.3, y: 6 } });

/** A quiet fight: no newcomers, nobody walks or touches, no hit-stop; the sandbox toggles of the loop and the pierce off. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.loopEnabled = false; p.pierceEnabled = false;
  // Task 52, Р2: these checks play «Развилка»'s rule without the dwell gesture (the run's rule, `forkDwell` 0; the sandbox's default 0,25 —
  // forkDwell.spec.ts).
  p.forkDwell = 0;
  return Object.assign(p, extra);
}
function fight(talismans: string[], extra: Partial<Params> = {}, loadout: Loadout = {}, k = 1): Simulation {
  const sim = new Simulation({ arena: 'forms-field', params: quiet(extra), seed: seedOf(k), record: true, loadout: { talismans, ...loadout } });
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
const ids = (sim: Simulation): number[] => sim.world.chain.map(l => l.id);
/** Ticks until the hero stands (the dash, the pierce, a return run), collecting the events. */
function settle(sim: Simulation): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < 1200 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const killed = (events: readonly WorldEvent[], id: number, source?: string): boolean => events.some(e => e.type === 'kill' && e.enemyId === id && (!source || e.source === source));
const hammerKinds = (events: readonly WorldEvent[]): string[] => events.flatMap(e => (e.type === 'hammer' ? [e.kind] : []));

/** What the plan promises at the end of the dash and the return run: the links up to the stop, the pierce, the return hits. */
function promised(plan: ChainPlan): Map<number, StrikeOutcome> {
  const out = new Map<number, StrikeOutcome>();
  for (const l of plan.links) {
    if (l.link.kind !== 'enemy' || !l.outcome) continue;
    out.set(l.link.id, l.outcome);
    if (!l.outcome.killed && !l.outcome.plate) break;
  }
  for (const b of plan.pierce?.bodies ?? []) out.set(b.id, b.outcome);
  for (const h of plan.back?.hits ?? []) out.set(h.id, h.outcome);
  return out;
}
type Snapshot = { id: number; hp: number; plates: number }[];
const snapshot = (sim: Simulation): Snapshot => sim.world.enemies.map(e => ({ id: e.id, hp: e.hp, plates: platesOf(e) }));
/** The world after the dash is what the plan said: each promised body killed, its plate or HP as planned; nobody else touched. */
function assertPlanIsDash(sim: Simulation, plan: ChainPlan, before: Snapshot, label: string): void {
  const want = promised(plan);
  for (const [id, o] of want) {
    const e = enemy(sim, id);
    if (o.killed) assert(!e, `${label}: ${id} should die`);
    else if (o.plate) assert(e && platesOf(e) === o.platesAfter, `${label}: ${id} plates ${e ? platesOf(e) : '—'}, planned ${o.platesAfter}`);
    else assert(e && e.hp === o.hpAfter, `${label}: ${id} HP ${e?.hp}, planned ${o.hpAfter}`);
  }
  for (const s of before) {
    if (want.has(s.id)) continue;
    const e = enemy(sim, s.id);
    assert(e && e.hp === s.hp && platesOf(e) === s.plates, `${label}: ${s.id} untouched (HP ${s.hp} → ${e?.hp})`);
  }
}

// ---- Old journals ----

check('journals recorded before task 29 replay to their recorded hash (the forms registered, none taken)', () => {
  const legacy = (legacyJournals as unknown as { cases: { name: string; hash: string; journal: Journal }[] }).cases;
  const all = [{ name: 'browser', ...(browserJournal as unknown as { journal: Journal; hash: string }) }, ...legacy];
  for (const f of all) assert(replay(f.journal).hash() === f.hash, `${f.name}: recorded ${f.hash}, now ${replay(f.journal).hash()}`);
  assert(runParams(defaultParams()).returnFixed === false && defaultParams().returnFixed === true, 'returnFixed: on in the sandbox, off in a run');
  assert(defaultParams().returnShadowEnd === true && runParams(defaultParams()).returnShadowEnd === true, 'returnShadowEnd: on in the sandbox and in a run');
  // A run keeps `returnFixed` off (task 30): the wave there strikes who stands in the circle, as before (checked below).
  assert(defaultParams().returnWaveFixed === true && runParams(defaultParams()).returnWaveFixed === true, 'returnWaveFixed: on in the sandbox and in a run');
  assert(FORM_FIELD[FORMS.seal] === 'end' && FORM_FIELD[FORMS.pierce] === 'end' && FORM_FIELD[HAMMERS.blast] === 'end'
    && FORM_FIELD[FORMS.fork] === 'link' && FORM_FIELD[FORMS.alien] === 'link' && FORM_FIELD[FORMS.twins] === 'link'
    && FORM_FIELD[HAMMERS.return] === 'path' && FORM_FIELD[HAMMERS.fire] === 'path' && FORM_FIELD[HAMMERS.cut] === 'path', 'the fields');
});

// ---- «Печать» and «Прямая» as forms ----

/** A square of four colour-0 links 1.2 apart around (6.6, 5), a colour-1 body inside. */
const SQUARE: Vec[] = [{ x: 6, y: 4.4 }, { x: 7.2, y: 4.4 }, { x: 7.2, y: 5.6 }, { x: 6, y: 5.6 }];
function sealScene(talismans: string[], extra: Partial<Params> = {}, loadout: Loadout = {}) {
  const sim = fight(talismans, extra, loadout);
  for (const p of SQUARE) place(sim, p);
  const inside = place(sim, { x: 6.6, y: 5 }, { color: 1, hp: 1 });
  draw(sim, [...SQUARE, SQUARE[0]]);
  return { sim, inside };
}

check('«Печать» as a form: the pointer on the first link closes the ring, the seal strikes inside; without the form — no ring', () => {
  const plain = sealScene([]);
  assert(!plain.sim.world.chainClosed && !planChain(plain.sim.world).seal, 'no form, toggle off: the gesture does not close');
  const { sim, inside } = sealScene([FORMS.seal]);
  assert(sim.world.chainClosed === 'first', 'the form closes the ring on the first link');
  const plan = planChain(sim.world);
  assert(plan.seal && plan.seal.inside.join() === String(inside) && plan.seal.damage === sealDamage(4), 'the plan shows the body inside and the hit');
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(killed(events, inside, 'seal') && !enemy(sim, inside), 'the seal killed the body inside');
  assert(replays(sim), 'replays');
});

/** Three weak colour-0 links in a line from the hero: the axis +x from (8.4, 5). */
const LINE: Vec[] = [{ x: 6, y: 5 }, { x: 7.2, y: 5 }, { x: 8.4, y: 5 }];

check('«Прямая» as a form: a straight chain of 3 pierces the body ahead as planned; without the form — the chain ends at its last link', () => {
  const run = (talismans: string[]) => {
    const sim = fight(talismans);
    for (const p of LINE) place(sim, p);
    const ahead = place(sim, { x: 9.4, y: 5 }, { color: 1, hp: 1 });
    draw(sim, LINE);
    const plan = planChain(sim.world), before = snapshot(sim);
    sim.command({ t: 'release' });
    const events = settle(sim);
    return { sim, ahead, plan, before, events };
  };
  const plain = run([]);
  assert(!plain.plan.pierce && enemy(plain.sim, plain.ahead)?.hp === 1, 'without the form: no pierce');
  const form = run([FORMS.pierce]);
  assert(form.plan.pierce && form.plan.pierce.bodies.map(b => b.id).join() === String(form.ahead), 'the plan pierces the body ahead');
  assert(killed(form.events, form.ahead, 'pierce'), 'the run killed it');
  assertPlanIsDash(form.sim, form.plan, form.before, 'pierce');
  assert(replays(form.sim), 'replays');
});

check('rank of «Конец»: a sealed chain — no pierce, no end blast; a pierce — no blast; a survivor at the end — the blast; toggles alone — both', () => {
  const both = [FORMS.seal, FORMS.pierce];
  const sealed = sealScene(both, {}, { hammer: HAMMERS.blast });
  assert(sealed.sim.world.chainClosed && !planChain(sealed.sim.world).pierce, 'the seal shuts the pierce');
  sealed.sim.command({ t: 'release' });
  const e1 = settle(sealed.sim);
  assert(e1.some(e => e.type === 'seal' && e.phase === 'strike') && !hammerKinds(e1).includes('blast'), 'the seal struck, no end blast');
  const line = (talismans: string[], extra: Partial<Params>, last = 0) => {
    const sim = fight(talismans, extra, { hammer: HAMMERS.blast });
    LINE.forEach((p, i) => place(sim, p, { hp: i === 2 ? last : 0 }));
    place(sim, { x: 9.4, y: 5 }, { color: 1, hp: 1 });
    draw(sim, LINE);
    const plan = planChain(sim.world);
    sim.command({ t: 'release' });
    return { plan, events: settle(sim), sim };
  };
  const pierced = line(both, {});
  assert(pierced.plan.pierce && pierced.events.some(e => e.type === 'pierce' && e.phase === 'end') && !hammerKinds(pierced.events).includes('blast'), 'the pierce ran, no end blast');
  const survivor = line(both, {}, 9);
  assert(!survivor.plan.pierce && hammerKinds(survivor.events).includes('blast'), 'the last link survives: no pierce, the blast');
  const legacy = line([], { pierceEnabled: true });
  assert(legacy.events.some(e => e.type === 'pierce' && e.phase === 'end') && hammerKinds(legacy.events).includes('blast'), 'the toggle alone: the pierce and the blast');
  for (const s of [sealed.sim, pierced.sim, survivor.sim, legacy.sim]) assert(replays(s), 'replays');
});

// ---- «Развилка» ----

/** A at (5.7, 5), B at (6.9, 5); C straight up from A, just within reach of A and beyond reach of B and the hero. */
function forkScene(talismans: string[]) {
  const sim = fight(talismans);
  const a = place(sim, { x: 5.7, y: 5 }), b = place(sim, { x: 6.9, y: 5 });
  draw(sim, [{ x: 5.7, y: 5 }, { x: 6.9, y: 5 }]);
  const reach = sim.world.params.linkRadius + 0.3;
  const c = place(sim, { x: 5.7, y: 5 - reach }, { hp: 1 });
  return { sim, a, b, c, at: { x: 5.7, y: 5 - reach } };
}

check('«Развилка»: a link within R of the first link (not the last) joins; the hint names that anchor; the dash runs in the order drawn', () => {
  const plain = forkScene([]);
  assert(enemyRefusal(plain.sim.world, enemy(plain.sim, plain.c)!) === 'far', 'without the form: too far from the last link');
  plain.sim.command({ t: 'drag', x: plain.at.x, y: plain.at.y, mode: 'full' });
  assert(ids(plain.sim).length === 2, 'without the form the chain stays at 2');
  const { sim, a, b, c, at } = forkScene([FORMS.fork]);
  const anchors = enemyAnchors(sim.world, enemy(sim, c)!);
  assert(anchors.length === 1 && anchors[0].link?.id === a, `the anchor of the candidate is the first link (${anchors.map(x => x.link?.id ?? 'hero').join()})`);
  assert(linkDepths(sim.world).some(d => d.id === c), 'П1 sees the candidate too');
  sim.command({ t: 'drag', x: at.x, y: at.y, mode: 'full' });
  assert(ids(sim).join() === [a, b, c].join(), 'the chain takes it as the third link');
  const plan = planChain(sim.world), before = snapshot(sim);
  sim.command({ t: 'release' });
  const events = settle(sim);
  const order = events.flatMap(e => (e.type === 'chainHit' ? [e.enemyId] : []));
  assert(order.join() === [a, b, c].join(), `the dash in the order drawn (${order.join()})`);
  assertPlanIsDash(sim, plan, before, 'fork');
  assert(replays(sim), 'replays');
});

check('«Развилка»: no loop with it (even with «Печать»); with «Якорь у героя» the hero is an anchor as well', () => {
  const { sim } = sealScene([FORMS.fork, FORMS.seal]);
  assert(!sim.world.chainClosed && !loopCandidates(sim.world).length && !planChain(sim.world).seal, 'the ring does not close');
  const anchor = fight([FORMS.fork, 'hero-anchor']);
  place(anchor, { x: 5.7, y: 5 }); place(anchor, { x: 6.9, y: 5 });
  draw(anchor, [{ x: 5.7, y: 5 }, { x: 6.9, y: 5 }]);
  const near = place(anchor, { x: 3.8, y: 5 });
  const list = enemyAnchors(anchor.world, enemy(anchor, near)!);
  assert(list.some(x => !x.link) && list.some(x => x.link), 'reachable from the hero and from the first link');
  anchor.command({ t: 'drag', x: 3.8, y: 5, mode: 'full' });
  assert(ids(anchor).length === 3, 'it joins');
});

// ---- «Чужак» ----

check('«Чужак»: one link of another colour (an elite too) joins once; the second is refused; the chain keeps its colour', () => {
  const run = (talismans: string[], elite: boolean) => {
    const sim = fight(talismans);
    const a = place(sim, { x: 5.7, y: 5 }), b = place(sim, { x: 6.9, y: 5 }, { color: 1, elite });
    const c = place(sim, { x: 8.1, y: 5 }, { color: 2 }), d = place(sim, { x: 6.9, y: 6.2 });
    draw(sim, [{ x: 5.7, y: 5 }, { x: 6.9, y: 5 }]);
    return { sim, a, b, c, d };
  };
  const plain = run([], false);
  assert(ids(plain.sim).join() === String(plain.a) && hoverRefusal(plain.sim.world, { x: 6.9, y: 5 }) === 'color', 'without the form: «не тот цвет»');
  for (const elite of [false, true]) {
    const { sim, a, b, c, d } = run([FORMS.alien], elite);
    assert(ids(sim).join() === [a, b].join(), `the foreign link joins (elite ${elite})`);
    assert(foreignLeft(sim.world) === 0 && chainColor(sim.world) === 0, 'spent; the chain is still colour 0');
    assert(colorJoin(sim.world, enemy(sim, c)!) === null && hoverRefusal(sim.world, { x: 8.1, y: 5 }) === 'color', 'a second foreign link is refused');
    sim.command({ t: 'drag', x: 8.1, y: 5, mode: 'full' });
    sim.command({ t: 'drag', x: 6.9, y: 6.2, mode: 'full' });
    assert(ids(sim).join() === [a, b, d].join(), 'the next link is of the chain colour again');
    const plan = planChain(sim.world), before = snapshot(sim);
    sim.command({ t: 'release' });
    settle(sim);
    assertPlanIsDash(sim, plan, before, `alien elite ${elite}`);
    assert(replays(sim), 'replays');
  }
  // Before the first link nothing is foreign: the candidate of another colour is just the chain's first.
  const fresh = fight([FORMS.alien]);
  const x = place(fresh, { x: 5.7, y: 5 }, { color: 3 });
  assert(foreignLeft(fresh.world) === 1 && colorJoin(fresh.world, enemy(fresh, x)!) === 'chain', 'the first link sets the colour');
});

// ---- «Близнецы» ----

check('«Близнецы»: colours 1 + 3 and 2 + 4 are one colour; a row of 3 colours keeps an incomplete pair; ranked above «Чужак»', () => {
  const run = (talismans: string[], first: number, loadout: Loadout = {}) => {
    const sim = fight(talismans, {}, loadout);
    place(sim, { x: 5.7, y: 5 }, { color: first });
    const others = [0, 1, 2, 3].map(c => place(sim, { x: 6.9, y: 3.2 + 1.2 * c }, { color: c }));
    sim.command({ t: 'begin', x: 5.7, y: 5 });
    return { sim, ok: nextCandidates(sim.world).map(e => e.color).sort().join() , others };
  };
  assert(run([], 0).ok === '0', 'without the form: only colour 0');
  assert(run([FORMS.twins], 0).ok === '0,2' && run([FORMS.twins], 1).ok === '1,3' && run([FORMS.twins], 2).ok === '0,2', 'the pairs');
  const twins = run([FORMS.twins], 0);
  assert(colorGroups(twins.sim.world)?.map(g => g.join('+')).join(' ') === '0+2 1+3', 'the groups of 4 colours');
  const three = fight([FORMS.twins], {}, { colors: 3 });
  assert(colorGroups(three.world)?.map(g => g.join('+')).join(' ') === '0+2 1', 'a row of 3: a pair and a single colour');
  const ranked = run([FORMS.alien, FORMS.twins], 0);
  assert(ranked.ok === '0,2' && foreignLeft(ranked.sim.world) === null, '«Близнецы» act, «Чужак» does not');
  // The pair joins by a real drag; the plan is the dash.
  const { sim, others } = twins;
  sim.command({ t: 'drag', x: 6.9, y: 3.2 + 2.4, mode: 'full' });
  assert(ids(sim).length === 2 && ids(sim)[1] === others[2], 'colour 2 joins a chain of colour 0');
  const plan = planChain(sim.world), before = snapshot(sim);
  sim.command({ t: 'release' });
  settle(sim);
  assertPlanIsDash(sim, plan, before, 'twins');
  assert(replays(sim), 'replays');
});

// ---- Task 33 «Цена „Близнецов“ и „Развилки“» (`twinsAlternate`, `twinsNoShift`, `forkBranches`) ----

/** «Близнецы»: enemies of `colors` in a row from (5.7, 5), 1.2 apart (a `null` — a crystal there); the chain drawn through all. */
function twinsRow(colors: readonly (number | null)[], extra: Partial<Params> = {}, talismans: string[] = [FORMS.twins]) {
  const sim = fight(talismans, extra);
  const points = colors.map((_, i) => ({ x: 5.7 + 1.2 * i, y: 5 }));
  const placed = colors.map((color, i) => (color === null ? (sim.command({ t: 'crystal', x: points[i].x, y: points[i].y, value: 1 }) as number) : place(sim, points[i], { color })));
  draw(sim, points);
  return { sim, placed, points };
}
const enemyIds = (sim: Simulation): number[] => sim.world.chain.filter(l => l.kind === 'enemy').map(l => l.id);

check('task 33 «Близнецы» alternate: A-A-Б-A joins, the plan is the dash; A-Б-Б is refused at the third («не тот цвет», no candidate ring); a crystal starts it again', () => {
  const ok = twinsRow([0, 0, 2, 0]);
  assert(enemyIds(ok.sim).join() === ok.placed.join(), `A-A-Б-A joins (${enemyIds(ok.sim)})`);
  assert(twinsNextColor(ok.sim.world) === 2, `the next colour is Б (${twinsNextColor(ok.sim.world)})`);
  const plan = planChain(ok.sim.world), before = snapshot(ok.sim);
  ok.sim.command({ t: 'release' });
  settle(ok.sim);
  assertPlanIsDash(ok.sim, plan, before, 'A-A-Б-A');
  assert(replays(ok.sim), 'replays');

  const bad = twinsRow([0, 2, 2]);
  const third = enemy(bad.sim, bad.placed[2])!;
  assert(enemyIds(bad.sim).join() === bad.placed.slice(0, 2).join(), `A-Б-Б stops at Б (${enemyIds(bad.sim)})`);
  assert(enemyRefusal(bad.sim.world, third) === 'color' && hoverRefusal(bad.sim.world, bad.points[2]) === 'color', 'the third: «не тот цвет»');
  assert(!nextCandidates(bad.sim.world).some(e => e.id === third.id), 'no candidate ring at the third');
  // An A after Б joins: the alternation, not a ban of the pair.
  const back = place(bad.sim, { x: 6.9, y: 6.2 }, { color: 0 });
  bad.sim.command({ t: 'drag', x: 6.9, y: 6.2, mode: 'full' });
  assert(enemyIds(bad.sim).at(-1) === back, 'A after Б joins');

  const crystal = twinsRow([0, 2, null, 2, 2]);
  assert(enemyIds(crystal.sim).length === 4 && crystal.sim.world.chain.length === 5, `after a crystal Б-Б joins (${crystal.sim.world.chain.map(l => l.kind[0] + l.id).join()})`);

  const free = twinsRow([0, 2, 2], { twinsAlternate: false });
  assert(enemyIds(free.sim).length === 3 && twinsNextColor(free.sim.world) === null, 'without the key: the free pair (A-Б-Б joins)');
  const plain = twinsRow([0, 0, 2], {}, []);
  assert(enemyIds(plain.sim).length === 2, 'without the form: Б is another colour');
});

check('task 33 «Близнецы» turn «Смена цвета» off: with `colorShiftLinks` 6 no shift on the 6th link (another colour after it is refused); without the key the shift comes', () => {
  const run = (extra: Partial<Params>) => twinsRow([0, 0, 0, 0, 0, 0, 1], { colorShiftLinks: 6, ...extra });
  const off = run({});
  assert(colorShiftLeft(off.sim.world) === null && colorShiftIds(off.sim.world).length === 0, 'no shift with «Близнецы»');
  assert(enemyIds(off.sim).length === 6 && enemyRefusal(off.sim.world, enemy(off.sim, off.placed[6])!) === 'color', 'colour 1 after six links is refused');
  const on = run({ twinsNoShift: false });
  assert(enemyIds(on.sim).length === 7 && colorShiftIds(on.sim.world).length === 1, 'without the key the 6th link frees the colour');
  const form = twinsRow([0, 0, 0, 0, 0, 0, 1], { colorShiftLinks: 6 }, [FORMS.fork]);
  assert(enemyIds(form.sim).length === 7, '«Развилка» does not turn the shift off');
});

check('task 33 «Развилка» once a chain: the first fork joins (`ChainLink.fork`), a second is refused («далеко»), the plan is the dash; 0 — no limit, 2 — two', () => {
  const scene = (extra: Partial<Params>) => {
    const sim = fight([FORMS.fork], extra);
    const a = place(sim, { x: 5.7, y: 5 }), b = place(sim, { x: 6.9, y: 5 });
    draw(sim, [{ x: 5.7, y: 5 }, { x: 6.9, y: 5 }]);
    const reach = sim.world.params.linkRadius + 0.3, at1 = { x: 5.7, y: 5 - reach }, at2 = { x: 6.9, y: 5 + reach };
    const c = place(sim, at1, { hp: 1 }), d = place(sim, at2);
    sim.command({ t: 'drag', x: at1.x, y: at1.y, mode: 'full' });
    return { sim, a, b, c, d, at2 };
  };
  const one = scene({});
  assert(ids(one.sim).join() === [one.a, one.b, one.c].join() && one.sim.world.chain.map(l => !!l.fork).join() === 'false,false,true', `the fork from a (${JSON.stringify(one.sim.world.chain)})`);
  assert(forkAnchorOf(one.sim.world, 2)?.id === one.a && forkAnchorOf(one.sim.world, 1) === null, `the fork's anchor is a (${JSON.stringify(forkAnchorOf(one.sim.world, 2))})`);
  const d = enemy(one.sim, one.d)!;
  assert(enemyRefusal(one.sim.world, d) === 'far' && !nextCandidates(one.sim.world).some(e => e.id === d.id), 'a second fork (from b) is refused');
  assert(enemyAnchors(one.sim.world, d).length === 0, 'no anchor rings for it');
  one.sim.command({ t: 'drag', x: one.at2.x, y: one.at2.y, mode: 'full' });
  assert(ids(one.sim).length === 3, 'the drag does not take it');
  const plan = planChain(one.sim.world), before = snapshot(one.sim);
  one.sim.command({ t: 'release' });
  settle(one.sim);
  assertPlanIsDash(one.sim, plan, before, 'fork once');
  assert(replays(one.sim), 'replays');
  for (const [max, len] of [[0, 4], [2, 4]] as const) {
    const s = scene({ forkBranches: max });
    s.sim.command({ t: 'drag', x: s.at2.x, y: s.at2.y, mode: 'full' });
    assert(ids(s.sim).length === len, `forkBranches ${max}: the second fork joins (${ids(s.sim).length})`);
  }
  // A link the last one reaches is no fork, and the hero with «Якорь» is a plain anchor.
  const line = fight([FORMS.fork]);
  const p = [5.7, 6.9, 8.1].map(x => place(line, { x, y: 5 }));
  draw(line, [5.7, 6.9, 8.1].map(x => ({ x, y: 5 })));
  assert(ids(line).join() === p.join() && line.world.chain.every(l => !l.fork), 'a straight chain has no fork');
});

check('task 33: journals without the keys play the old forms (the free pair, the shift with «Близнецы», forks without a limit); the run keeps them off', () => {
  const p = quiet();
  for (const key of ['twinsAlternate', 'twinsNoShift', 'forkBranches'] as const) delete (p as Partial<Params>)[key];
  const sim = new Simulation({ arena: 'forms-field', params: p, seed: seedOf(3), record: true, loadout: { talismans: [FORMS.twins] } });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  const placed = [0, 2, 2].map((color, i) => place(sim, { x: 5.7 + 1.2 * i, y: 5 }, { color }));
  draw(sim, placed.map((_, i) => ({ x: 5.7 + 1.2 * i, y: 5 })));
  assert(ids(sim).length === 3 && !('twinsAlternate' in sim.world.params), 'A-Б-Б joins without the key');
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'replays');
  const run = runParams(defaultParams());
  assert(!run.twinsAlternate && !run.twinsNoShift && run.forkBranches === 0 && defaultParams().twinsAlternate && defaultParams().twinsNoShift && defaultParams().forkBranches === 1
    && defaultParams().forkDwell === 0.25 && run.forkDwell === 0, 'sandbox on, run off');
});

// ---- «Возврат» in the highlight ----

/** Five weak links in a row from (4, 6) and bodies of other colours near the way back. */
function returnScene(extra: Partial<Params>, k = 1) {
  const sim = fight([], { killGoal: 999, ...extra }, { hammer: HAMMERS.return }, k);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [1, 2, 3, 4, 5].map(i => ({ x: 4 + 1.2 * i, y: 6 }));
  for (const p of links) place(sim, p);
  const off = [place(sim, { x: 6.6, y: 6.7 }, { color: 1, hp: 1 }), place(sim, { x: 5.4, y: 5.3 }, { color: 2, hp: 3 }), place(sim, { x: 4.5, y: 6.7 }, { color: 3, hp: 0 })];
  draw(sim, links);
  return { sim, links, off };
}

check('«Возврат»: the way back and the second pass are in the plan before the release and equal the run (no key: a still scene)', () => {
  const { sim, off } = returnScene({ returnFixed: false });
  const plan = planChain(sim.world), back = plan.back!;
  assert(back && back.power === 2 && back.hits.map(h => h.id).join() === [off[0], off[1]].join(), `the plan: power 2, hits ${back?.hits.map(h => h.id).join()}`);
  assert(back.hits[0].outcome.killed && back.hits[1].outcome.hpAfter === 2 && back.route[back.route.length - 1].x === 4, 'the outcomes and the route to the start');
  const before = snapshot(sim);
  sim.command({ t: 'release' });
  assert(returnRunOf(sim.world) === null, 'no fixation without the key');
  const events = settle(sim);
  assert(hammerKinds(events).includes('return'), 'the run happened');
  assertPlanIsDash(sim, plan, before, 'return, no key');
  assert(replays(sim), 'replays');
});

check('«Возврат» with `returnFixed`: the release fixes the way and the bodies; the plan equals the run while the enemies walk', () => {
  let moved = 0, struck = 0;
  for (let k = 1; k <= 4; k++) {
    const { sim } = returnScene({ returnFixed: true, enemySpeed: defaultParams().enemySpeed, speedSpread: 0 }, k);
    const plan = planChain(sim.world), before = snapshot(sim);
    const at = new Map(sim.world.enemies.map(e => [e.id, { x: e.x, y: e.y }]));
    sim.command({ t: 'release' });
    const fixed = returnRunOf(sim.world);
    assert(fixed && fixed.bodies.join() === plan.back!.hits.map(h => h.id).join(), 'the release fixed the planned bodies');
    const events = settle(sim);
    assert(hammerKinds(events).includes('return'), 'the run happened');
    for (const e of sim.world.enemies) { const p = at.get(e.id); if (p && (p.x !== e.x || p.y !== e.y)) moved++; }
    struck += plan.back!.hits.length;
    assertPlanIsDash(sim, plan, before, `return fixed k${k}`);
    assert(sim.world.build === undefined, 'no state left');
    assert(replays(sim), 'replays');
  }
  assert(moved > 0 && struck > 0, `the enemies walked (${moved}) and the run struck (${struck})`);
});

check('«Возврат»: the first pass killed everyone near the way — an empty run (no marks); a first link that survives — no run', () => {
  for (const fixed of [false, true]) {
    const sim = fight([], { returnFixed: fixed }, { hammer: HAMMERS.return });
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const links = [1, 2, 3].map(i => ({ x: 4 + 1.2 * i, y: 6 }));
    for (const p of links) place(sim, p);
    draw(sim, links);
    const plan = planChain(sim.world);
    assert(plan.back && plan.back.route.length >= 2 && plan.back.hits.length === 0, 'an empty run in the plan');
    sim.command({ t: 'release' });
    const events = settle(sim);
    assert(hammerKinds(events).includes('return') && !events.some(e => e.type === 'kill' && e.source === 'hammer-return'), 'the run is made, nobody struck');
    const lone = fight([], { returnFixed: fixed }, { hammer: HAMMERS.return });
    const s = place(lone, { x: 5.7, y: 5 }, { hp: 9 });
    draw(lone, [{ x: 5.7, y: 5 }]);
    assert(!planChain(lone.world).back, 'a survivor first: no way back in the plan');
    lone.command({ t: 'release' });
    assert(!hammerKinds(settle(lone)).includes('return') && enemy(lone, s)?.hp === 8, 'and no run');
  }
});

check('a journal without `returnFixed` plays the old path: the same world as the key off', () => {
  const play = (journal: Journal) => { const { params: _, ...rest } = worldState(replay(journal).world) as Record<string, unknown>; return JSON.stringify(rest); };
  const { sim } = returnScene({ returnFixed: false, enemySpeed: defaultParams().enemySpeed }, 2);
  sim.command({ t: 'release' });
  settle(sim);
  const journal = JSON.parse(JSON.stringify(sim.exportJournal())) as Journal;
  const stripped = JSON.parse(JSON.stringify(journal)) as Journal;
  delete (stripped.params as Partial<Params>).returnFixed;
  assert(play(journal) === play(stripped), 'the same world');
});

// ---- «Возврат» and the end of the same dash: «Ударная волна», the door ----

/** The bodies the return run struck (a hit or a plate), in order. */
const struckBack = (events: readonly WorldEvent[]): number[] =>
  events.flatMap(e => ((e.type === 'enemyHit' || (e.type === 'elitePlates' && e.action === 'strip')) && e.source === BUILD_SOURCES.hammerReturn ? [e.enemyId] : []));

/**
 * Five weak links in a row from (4, 6) (the dash ends at (10, 6), the run's power 2) and «Ударная волна» of the chain window
 * (from 4 links): `near` stands in the wave (radius 2 around the end) by the way back, `mid` and `far` stand by the way back out
 * of the wave.
 */
function waveScene(returnFixed: boolean, nearHp: number, extra: Partial<Params> = {}) {
  const sim = fight([COUNTER_TALISMANS.shockwave], { killGoal: 999, returnFixed, counterWindow: true, shockwaveLinks: 4, ...extra }, { hammer: HAMMERS.return });
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [1, 2, 3, 4, 5].map(i => ({ x: 4 + 1.2 * i, y: 6 }));
  for (const p of links) place(sim, p);
  const near = place(sim, { x: 9.4, y: 6.7 }, { color: 1, hp: nearHp });
  const mid = place(sim, { x: 7.2, y: 6.7 }, { color: 2, hp: 2 });
  const far = place(sim, { x: 5.6, y: 6.7 }, { color: 3, hp: 3 });
  draw(sim, links);
  return { sim, near, mid, far };
}

check('«Возврат» + «Ударная волна» of the same chain: the second pass in the plan is struck after the wave (killed or wounded by it), with and without `returnFixed`', () => {
  for (const fixed of [false, true]) {
    for (const nearHp of [1, 2]) {
      const label = `returnFixed ${fixed}, near HP ${nearHp}`;
      const { sim, near } = waveScene(fixed, nearHp);
      const plan = planChain(sim.world), before = snapshot(sim);
      assert(plan.back && plan.back.power === 2, `${label}: a run of power 2 in the plan`);
      // The wave kills a 1-HP body before the run: the plan does not strike it.
      if (nearHp === 1) assert(!plan.back.hits.some(h => h.id === near), `${label}: the plan strikes a body the wave kills first`);
      sim.command({ t: 'release' });
      const events = settle(sim);
      assert(events.some(e => e.type === 'wave') && hammerKinds(events).includes('return'), `${label}: the wave and the run happened`);
      // What the player saw before the release is what the run struck, in order, with the planned outcomes.
      assert(struckBack(events).join() === plan.back.hits.map(h => h.id).join(), `${label}: the run struck ${struckBack(events).join()}, the plan showed ${plan.back.hits.map(h => h.id).join()}`);
      for (const h of plan.back.hits) {
        const e = enemy(sim, h.id);
        assert(h.outcome.killed ? !e : e && e.hp === h.outcome.hpAfter, `${label}: ${h.id} planned ${h.outcome.killed ? 'killed' : `HP ${h.outcome.hpAfter}`}, got ${e ? `HP ${e.hp}` : 'dead'}`);
      }
      // Bodies neither the plan nor the wave touched stay as they were.
      const waved = new Set(events.flatMap(e => (e.type === 'enemyHit' || e.type === 'kill') && e.source === BUILD_SOURCES.wave ? [e.enemyId] : []));
      for (const s of before) {
        if (waved.has(s.id) || plan.back.hits.some(h => h.id === s.id) || plan.links.some(l => l.link.id === s.id)) continue;
        assert(enemy(sim, s.id)?.hp === s.hp, `${label}: ${s.id} untouched`);
      }
      assert(replays(sim), `${label}: replays`);
    }
  }
});

check('«Возврат» + «Ударная волна»: a chain shorter than the wave\'s threshold — the plan is the old one (no wave)', () => {
  const sim = fight([COUNTER_TALISMANS.shockwave], { returnFixed: true, counterWindow: true, shockwaveLinks: 6 }, { hammer: HAMMERS.return });
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [1, 2, 3, 4, 5].map(i => ({ x: 4 + 1.2 * i, y: 6 }));
  for (const p of links) place(sim, p);
  const near = place(sim, { x: 9.4, y: 6.7 }, { color: 1, hp: 1 });
  draw(sim, links);
  const plan = planChain(sim.world);
  assert(plan.back && plan.back.hits[0]?.id === near && plan.back.hits[0].outcome.killed, 'the run kills the near body itself');
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(!events.some(e => e.type === 'wave') && struckBack(events).join() === plan.back.hits.map(h => h.id).join(), 'no wave; the run struck as planned');
});

check('a journal without `returnShadowEnd` plays the old shadow: the same world as the key off (with `returnFixed` the key changes the run)', () => {
  const play = (journal: Journal) => { const { params: _, ...rest } = worldState(replay(journal).world) as Record<string, unknown>; return JSON.stringify(rest); };
  const worlds = [false, true].map(on => {
    const { sim } = waveScene(true, 2, { returnShadowEnd: on });
    sim.command({ t: 'release' });
    settle(sim);
    return JSON.parse(JSON.stringify(sim.exportJournal())) as Journal;
  });
  const stripped = JSON.parse(JSON.stringify(worlds[0])) as Journal;
  delete (stripped.params as Partial<Params>).returnShadowEnd;
  assert(play(worlds[0]) === play(stripped), 'without the key — the world of the key off');
  assert(play(worlds[0]) !== play(worlds[1]), 'with `returnFixed` the key changes the run (the wounded body is struck too)');
});

/**
 * Walking bodies and the wave (`returnWaveFixed`, design 15.10.2026): the five links of `waveScene` frozen (the dash ends at
 * (10, 6) as planned), the others walk at 2 u/s. `out` (HP 2) stands in the wave by the way back at the release and walks out
 * of it during the dash; `after` (HP 1) further back on the way; `into` (HP 2) stands out of the wave at the release and walks
 * into it. The run's power 2.
 */
function walkScene(params: Partial<Params>, hammer = true) {
  const sim = fight([COUNTER_TALISMANS.shockwave], { killGoal: 999, returnFixed: true, counterWindow: true, shockwaveLinks: 4, enemySpeed: 2, ...params }, hammer ? { hammer: HAMMERS.return } : {});
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [1, 2, 3, 4, 5].map(i => ({ x: 4 + 1.2 * i, y: 6 }));
  for (const p of links) sim.command({ t: 'chill', id: place(sim, p), seconds: 5 });
  const out = place(sim, { x: 8, y: 6.7 }, { color: 1, hp: 2 });
  const after = place(sim, { x: 5.6, y: 6.7 }, { color: 2, hp: 1 });
  const into = place(sim, { x: 12.9, y: 6.3 }, { color: 3, hp: 2 });
  draw(sim, links);
  return { sim, out, after, into };
}
/** Whether `id`'s body touches the wave's circle (radius 2) around `at`. */
const inWave = (sim: Simulation, id: number, at: Vec): boolean => {
  const e = enemy(sim, id);
  return !!e && Math.hypot(e.x - at.x, e.y - at.y) <= 2 + bodyRadiusOf(sim.world.params, e);
};
/** Releases, ticks to the end of the run; where the wave went off and which bodies stood in it at that moment. */
function releaseWalk(sim: Simulation, watch: readonly number[]): { events: WorldEvent[]; wave?: Vec; inside: number[] } {
  sim.command({ t: 'release' });
  const events: WorldEvent[] = [];
  let wave: Vec | undefined, inside: number[] = [];
  for (let i = 0; i < 1200 && (sim.world.move || i === 0); i++) {
    const before = watch.map(id => ({ id, e: enemy(sim, id) }));
    sim.tick();
    const w = sim.world.events.find(e => e.type === 'wave');
    if (w && w.type === 'wave') {
      wave = { x: w.x, y: w.y };
      // Where the bodies stood in the tick of the wave (a body the wave killed is gone after it: its place before the tick).
      inside = before.filter(({ e }) => e && Math.hypot(e.x - w.x, e.y - w.y) <= 2 + bodyRadiusOf(sim.world.params, e)).map(b => b.id);
    }
    events.push(...sim.world.events);
    sim.world.events.length = 0;
  }
  return { events, wave, inside };
}
const wavedIds = (events: readonly WorldEvent[]): number[] =>
  [...new Set(events.flatMap(e => (e.type === 'enemyHit' || e.type === 'kill') && e.source === BUILD_SOURCES.wave ? [e.enemyId] : []))];

check('«Возврат» + «Ударная волна», walking bodies, `returnFixed`: the release fixes the wave\'s bodies — one that walked out of the circle is still struck, one that walked in is not; the run strikes the marks with the planned outcomes', () => {
  const { sim, out, after, into } = walkScene({});
  const plan = planChain(sim.world);
  assert(inWave(sim, out, { x: 10, y: 6 }) && !inWave(sim, into, { x: 10, y: 6 }), 'at the release: `out` in the wave of the planned end, `into` out of it');
  assert(plan.back && plan.back.hits.map(h => h.id).join() === [out, after].join(), `the plan marks ${out} (wounded by the wave first) and ${after}: ${plan.back?.hits.map(h => h.id).join()}`);
  const { events, wave, inside } = releaseWalk(sim, [out, after, into]);
  // The scene does what it says: the bodies walked across the circle's edge during the dash.
  assert(wave && Math.hypot(wave.x - 10, wave.y - 6) < 1e-6 && !inside.includes(out) && inside.includes(into), `at the wave: \`out\` left the circle, \`into\` walked in (in it: ${inside.join()})`);
  assert(wavedIds(events).join() === String(out), `the wave struck the bodies fixed at the release: ${wavedIds(events).join()}, fixed ${out}`);
  assert(struckBack(events).join() === plan.back.hits.map(h => h.id).join(), `the run struck ${struckBack(events).join()}, the plan marked ${plan.back.hits.map(h => h.id).join()}`);
  for (const h of plan.back.hits) {
    const e = enemy(sim, h.id);
    assert(h.outcome.killed ? !e : e && e.hp === h.outcome.hpAfter, `${h.id} planned ${h.outcome.killed ? 'killed' : `HP ${h.outcome.hpAfter}`}, got ${e ? `HP ${e.hp}` : 'dead'}`);
  }
  assert(enemy(sim, into)?.hp === 2, '`into` untouched');
  assert(replays(sim), 'replays');
});

check('the wave without the fixation: without «Возврат», with `returnFixed`, `returnWaveFixed` or `returnShadowEnd` off — the wave strikes who stands in the circle at the end of the dash; a journal without the key plays the old wave', () => {
  const cases: { label: string; params: Partial<Params>; hammer: boolean }[] = [
    { label: 'no «Возврат»', params: {}, hammer: false },
    { label: 'returnFixed off', params: { returnFixed: false }, hammer: true },
    { label: 'returnWaveFixed off', params: { returnWaveFixed: false }, hammer: true },
    { label: 'returnShadowEnd off', params: { returnShadowEnd: false }, hammer: true },
  ];
  for (const c of cases) {
    const { sim, out, into } = walkScene(c.params, c.hammer);
    const { events, inside } = releaseWalk(sim, [out, into]);
    assert(!inside.includes(out) && inside.includes(into) && wavedIds(events).join() === String(into), `${c.label}: the wave struck ${wavedIds(events).join()}, in the circle ${inside.join()}`);
  }
  const play = (journal: Journal) => { const { params: _, ...rest } = worldState(replay(journal).world) as Record<string, unknown>; return JSON.stringify(rest); };
  const journals = [false, true].map(on => {
    const { sim, out, into } = walkScene({ returnWaveFixed: on });
    releaseWalk(sim, [out, into]);
    return JSON.parse(JSON.stringify(sim.exportJournal())) as Journal;
  });
  const stripped = JSON.parse(JSON.stringify(journals[1])) as Journal;
  delete (stripped.params as Partial<Params>).returnWaveFixed;
  assert(play(journals[0]) === play(stripped), 'without the key — the world of the key off');
  assert(play(journals[0]) !== play(journals[1]), 'the key changes the wave');
});

registerArena({ goal: 'kills', width: 20, height: 12, heroStart: { x: 4, y: 6 }, buttons: [], enemies: [], killGoal: 1, id: 'forms-door', name: 'Дверь форм', summary: 'Тест «Возврата» у двери', obstacles: [], door: { x: 7.6, y: 6 } });

check('«Возврат» and the door: a door closed at the drawing is no link (the goal met mid-dash opens it, the fight goes on, the run is made as planned); a chain into the open door wins — no run in the plan and none made', () => {
  for (const fixed of [false, true]) {
    const sim = new Simulation({ arena: 'forms-door', params: quiet({ returnFixed: fixed }), seed: seedOf(3), record: true, loadout: { talismans: [], hammer: HAMMERS.return } });
    sim.command({ t: 'clear', keepMarked: false });
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const a = place(sim, { x: 5.2, y: 6 }), b = place(sim, { x: 6.4, y: 6 });
    const off = place(sim, { x: 5.8, y: 6.7 }, { color: 1, hp: 2 });
    draw(sim, [{ x: 5.2, y: 6 }, { x: 6.4, y: 6 }, { x: 7.6, y: 6 }]);
    // chain.ts `objectRefusal`: the closed door is refused (`closed`, within R) — the chain cannot end in it before the goals.
    assert(ids(sim).join() === [a, b].join() && sim.world.stage === 'goals' && hoverRefusal(sim.world, { x: 7.6, y: 6 }) === 'closed', `the closed door is no link (chain ${ids(sim).join()}, ${hoverRefusal(sim.world, { x: 7.6, y: 6 })})`);
    const plan = planChain(sim.world);
    assert(plan.back && plan.back.hits.map(h => h.id).join() === String(off), 'the plan shows the run');
    sim.command({ t: 'release' });
    const events = settle(sim);
    assert(String(sim.world.stage) === 'greed' && sim.world.status === 'playing', 'the dash met the goal: the door is open, the fight goes on');
    assert(hammerKinds(events).includes('return') && struckBack(events).join() === String(off) && enemy(sim, off)?.hp === plan.back.hits[0].outcome.hpAfter, 'the run is made as planned');
    // The door is open now: a chain into it wins — the plan shows no run, and none is made.
    sim.command({ t: 'teleport', x: 5.2, y: 6 });
    const c = place(sim, { x: 6.4, y: 6 });
    draw(sim, [{ x: 6.4, y: 6 }, { x: 7.6, y: 6 }]);
    assert(ids(sim).length === 2 && ids(sim)[0] === c && !planChain(sim.world).back, 'a chain into the open door: no run in the plan');
    sim.command({ t: 'release' });
    const won = settle(sim);
    assert(String(sim.world.status) === 'victory' && !hammerKinds(won).includes('return'), 'the dash wins in the door, no run');
    assert(replays(sim), 'replays');
  }
});

// ---- Random fights: the highlight is the dash ----

/** A small LCG for the test's own scene (the simulation's streams are not touched). */
function lcg(seed: number): () => number { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** The bot's next link: the candidate that turns the chain least (straight tails give the pierce a chance). */
function straightest(sim: Simulation): Enemy | undefined {
  const w = sim.world, pts = w.chain.flatMap(l => { const e = enemy(sim, l.id); return e ? [e] : []; });
  const last = pts[pts.length - 1], prev = pts[pts.length - 2] ?? w.hero;
  if (!last) return nextCandidates(w)[0];
  const dx = last.x - prev.x, dy = last.y - prev.y;
  const score = (e: Enemy): number => { const vx = e.x - last.x, vy = e.y - last.y; return (dx * vx + dy * vy) / ((Math.hypot(dx, dy) * Math.hypot(vx, vy)) || 1); };
  return [...nextCandidates(w)].sort((a, b) => score(b) - score(a))[0];
}

check('random fights of 4 seeds with the forms: every chain\'s plan (links, pierce, return) is the dash; replays with checkpoints', () => {
  const kits: { talismans: string[]; extra: Partial<Params>; hammer?: typeof HAMMERS.return }[] = [
    { talismans: [FORMS.fork, FORMS.alien, FORMS.pierce], extra: {}, hammer: HAMMERS.return },
    { talismans: [FORMS.twins, FORMS.pierce], extra: {}, hammer: HAMMERS.return },
    { talismans: [FORMS.fork, FORMS.twins], extra: {} },
    // The old path of «Возврат» (no fixation): its run reads the real path — counted, not asserted (a run's known defect until task 30).
    { talismans: [FORMS.alien], extra: { returnFixed: false }, hammer: HAMMERS.return },
  ];
  let chains = 0, backHits = 0, pierced = 0, oldChains = 0, oldDiverged = 0;
  const hashes = new Set<string>();
  for (let k = 1; k <= 4; k++) {
    for (const kit of kits) {
      const sim = fight(kit.talismans, { enemySpeed: defaultParams().enemySpeed, speedSpread: 0.2, ...kit.extra }, kit.hammer ? { hammer: kit.hammer } : {}, k);
      const rnd = lcg(seedOf(k));
      for (let i = 0; i < 16; i++) place(sim, { x: 5 + rnd() * 9, y: 2 + rnd() * 8 }, { color: Math.floor(rnd() * 4), hp: Math.floor(rnd() * 3) });
      // A straight row from the hero and a body ahead of it: a pierce for the first chain (the rest is random).
      const y = 4 + rnd() * 2;
      for (let i = 1; i <= 3; i++) place(sim, { x: 4.5 + 1.2 * i, y: y + (i - 2) * 0.05 }, { color: 3 });
      place(sim, { x: 9.3, y }, { color: 1, hp: 1 });
      const checkpoints: string[] = [];
      const tick = (): void => { sim.tick(); sim.world.events.length = 0; if (sim.world.tick % 300 === 0) checkpoints.push(sim.hash()); };
      for (let c = 0; c < 6 && sim.world.enemies.length; c++) {
        const first = [...nextCandidates(sim.world)].sort((a, b) => Math.hypot(a.x - sim.world.hero.x, a.y - sim.world.hero.y) - Math.hypot(b.x - sim.world.hero.x, b.y - sim.world.hero.y))[0];
        if (!first) { for (let t = 0; t < 30; t++) tick(); continue; }
        sim.command({ t: 'begin', x: first.x, y: first.y });
        for (let n = 1; n < 5; n++) {
          const next = straightest(sim);
          if (!next) break;
          sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
        }
        if (!sim.world.chain.length) continue;
        const plan = planChain(sim.world), before = snapshot(sim);
        sim.command({ t: 'release' });
        for (let t = 0; t < 1200 && (sim.world.move || t === 0); t++) tick();
        // Without the key the return run reads the real path: equal only while nobody walks — the plan is checked with the key.
        const label = `k${k} ${kit.talismans.join('+')} chain ${c}`;
        if (kit.extra.returnFixed === false) { oldChains++; try { assertPlanIsDash(sim, plan, before, label); } catch { oldDiverged++; } }
        else { assertPlanIsDash(sim, plan, before, label); chains++; backHits += plan.back?.hits.length ?? 0; pierced += plan.pierce?.bodies.length ?? 0; }
        for (let t = 0; t < 20; t++) tick();
      }
      const again: string[] = [];
      const copy = replay(JSON.parse(JSON.stringify(sim.exportJournal())) as Journal, step => { step.world.events.length = 0; if (step.world.tick % 300 === 0) again.push(step.hash()); });
      assert(copy.hash() === sim.hash() && again.join() === checkpoints.join(), `k${k}: replay to the same hash and checkpoints`);
      hashes.add(sim.hash());
    }
  }
  assert(chains >= 30 && hashes.size === 16 && backHits > 0 && pierced > 0, `chains ${chains}, return hits ${backHits}, pierced ${pierced}, distinct fights ${hashes.size}`);
  console.log(`  chains ${chains} (plan = dash), return hits ${backHits}, pierced bodies ${pierced}; old path of «Возврат» while walking: ${oldDiverged} of ${oldChains} chains differ from the plan`);
});

console.log(`realtime-forms: ${checks} checks passed`);
