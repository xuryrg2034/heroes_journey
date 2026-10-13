/**
 * «Смена цвета» (`colorShiftLinks`; design 12.10.2026, task 4; docs/realtime-prototype.md, «Смена цвета»). Node only:
 * `npm run test:realtime-color-shift`.
 *
 * Every check draws chains with journal commands (`place`, `crystal`, `begin` / `drag`, `release`) and looks at what the
 * player meets: which link the chain takes (the drawn chain grows or not; the refusal at the pointer — `hoverRefusal`),
 * what the dash does (`chainHit`, `colorShift`, energy), and that the highlight (`planChain`) is the dash.
 * - N = 6: the 7th link of another colour is taken, the 6th is not («не тот цвет»); the 13th again; a 7th of the same colour
 *   restarts the count (the 8th of another colour is refused);
 * - an elite's plate hit is a link; a survivor ends the chain as before; a crystal resets the colour and the count; the
 *   goblin's ◆ (crystals off, as the run) still falls and resets the colour;
 * - «Осколок жернова» 5, «Жернов» 4, both 3, never below 2; the crystal step stays the panel's while the shift is on;
 * - «Призма» +1 energy per shift the dash reaches; «Кристалл в цепи» of the oath is met by a shift;
 * - П1 (linkDepth.ts) follows the rule; the plan is the dash on several seeds; every fight replays to its hash; key 0 and no
 *   key play the old path, the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { chainColor, colorShiftIds, colorShiftLeft, colorShiftOf, crystalEveryOf, hoverRefusal, objectRefusal, planChain, type StrikeOutcome } from './chain';
import { COUNTER_TALISMANS, RELICS } from './buildIds';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { linkDepth } from './linkDepth';
import { oathMark } from './oath';
import { defaultParams, type Params } from './params';
import { Rng } from './rng';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { goblinOf, leverOf } from './slot';
import type { Enemy, World, WorldEvent } from './world';
import { rtRunParams } from '../run/rtRun';
import { rtTalisman } from '../run/rtTalismans';
import { prologueParams } from '../run/prologue';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

registerArena({
  id: 'shift-field', name: 'Поле смены цвета', summary: 'Тест смены цвета', goal: 'kills', width: 26, height: 12,
  heroStart: { x: 1.5, y: 6 }, obstacles: [], buttons: [], door: { x: 25.3, y: 6 }, enemies: [], killGoal: 999,
});

const HERO = { x: 1.5, y: 6 };
/** Links along y = 6, this far apart (R 1.875). */
const STEP = 1.2;

/** A quiet fight with the shift on (N = 6, crystals off — as the run): no newcomers, nobody walks or touches, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 0; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.crystals = false; p.colorShiftLinks = 6; p.colorCount = 4;
  return Object.assign(p, extra);
}
function field(params: Params = quiet(), k = 1, loadout?: Loadout): Simulation {
  const sim = new Simulation({ arena: 'shift-field', params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: HERO.x, y: HERO.y });
  return sim;
}
/** A link of the row: a colour (an enemy of HP 0), `{ color, hp, elite }`, or `crystal`. */
type Spec = number | { color: number; hp?: number; elite?: boolean } | 'crystal';
type Laid = { x: number; y: number; enemy?: Enemy };
/** Lays the row from the hero along y = 6, `STEP` apart. */
function lay(sim: Simulation, spec: readonly Spec[], y = 6): Laid[] {
  return spec.map((s, i) => {
    const x = HERO.x + STEP * (i + 1);
    if (s === 'crystal') { sim.command({ t: 'crystal', x, y, value: 0 }); return { x, y }; }
    const o = typeof s === 'number' ? { color: s } : s;
    const id = sim.command({ t: 'place', x, y, color: o.color, hp: o.hp ?? 0, kind: 'basic', ...o.elite ? { elite: true } : {} }) as number;
    return { x, y, enemy: sim.world.enemies.find(e => e.id === id)! };
  });
}
/**
 * Draws the row in order with the pointer (a press on the first, a full drag on each next). Stops at the first point the
 * chain does not take: returns how many links it took and the refusal the pointer showed there.
 */
function drawRow(sim: Simulation, points: readonly Laid[]): { taken: number; refusal: string | null } {
  const w = sim.world;
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  if (w.chain.length !== 1) return { taken: 0, refusal: hoverRefusal(w, points[0]) };
  for (let i = 1; i < points.length; i++) {
    const before: number = w.chain.length;
    sim.command({ t: 'drag', x: points[i].x, y: points[i].y, mode: 'full' });
    if (w.chain.length !== before + 1) return { taken: i, refusal: hoverRefusal(w, points[i]) };
  }
  return { taken: points.length, refusal: null };
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Releases and ticks until the hero stands again, collecting the events. */
function dash(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  sim.world.events.length = 0;
  sim.command({ t: 'release' });
  for (let i = 0; i < 1200 && (sim.world.move || i === 0) && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
/** Replays the journal through JSON: the same hash at the end and at every 300th tick. */
function replays(sim: Simulation, checkpoints?: Map<number, string>): boolean {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  let ok = true;
  const again = replay(journal, s => { const want = checkpoints?.get(s.world.tick); if (want !== undefined && want !== s.hash()) ok = false; });
  return ok && again.hash() === sim.hash();
}
const rep = (color: number, n: number): number[] => Array.from({ length: n }, () => color);
/** Draws the row on a fresh field: links taken and the refusal at the first one not taken. */
function tryRow(spec: readonly Spec[], params: Params = quiet(), loadout?: Loadout, k = 1): { taken: number; refusal: string | null; sim: Simulation } {
  const sim = field(params, k, loadout), points = lay(sim, spec);
  return { ...drawRow(sim, points), sim };
}

check('N = 6: the 7th link of another colour joins, the 6th does not («не тот цвет»); the 13th again; the hint counts down', () => {
  const sixth = tryRow([...rep(0, 5), 1]);
  assert(sixth.taken === 5 && sixth.refusal === 'color', `the 6th of another colour: taken ${sixth.taken}, refusal ${sixth.refusal}`);
  assert(colorShiftLeft(sixth.sim.world) === 1 && chainColor(sixth.sim.world) === 0, 'after 5 links: one left, the colour is still 0');
  const seventh = tryRow([...rep(0, 6), 1]);
  assert(seventh.taken === 7 && seventh.refusal === null, `the 7th of another colour joins: ${seventh.taken}`);
  const w = seventh.sim.world;
  assert(chainColor(w) === 1 && colorShiftLeft(w) === 5, `the 7th set the new colour 1 and the count restarted: ${chainColor(w)}, left ${colorShiftLeft(w)}`);
  // The count down the view reads: 4 links — 2 left, 5 — 1 left, 6 — free (any colour; the chain's colour is null).
  const counts = field(), cw = counts.world, pts = lay(counts, rep(0, 6)), left: (number | null)[] = [];
  counts.command({ t: 'begin', x: pts[0].x, y: pts[0].y });
  left.push(colorShiftLeft(cw));
  for (const p of pts.slice(1)) { counts.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' }); left.push(colorShiftLeft(cw)); }
  assert(left.join(',') === '5,4,3,2,1,0' && chainColor(cw) === null, `left ${left}, colour ${chainColor(cw)}`);
  const twelfth = tryRow([...rep(0, 6), ...rep(1, 5), 2]);
  assert(twelfth.taken === 11 && twelfth.refusal === 'color', `the 12th of a third colour: taken ${twelfth.taken}, ${twelfth.refusal}`);
  const thirteenth = tryRow([...rep(0, 6), ...rep(1, 6), 2]);
  assert(thirteenth.taken === 13, `the 13th of a third colour joins: ${thirteenth.taken}`);
  const back = tryRow([...rep(0, 6), ...rep(1, 6), 0]);
  assert(back.taken === 13, `the 13th may be the first colour again: ${back.taken}`);
  // A 7th of the same colour is the free link too: the count starts again from it — the 8th of another colour is refused.
  const same = tryRow([...rep(0, 7), 1]);
  assert(same.taken === 7 && same.refusal === 'color', `a 7th of the same colour restarts the count: ${same.taken}, ${same.refusal}`);
  assert(replays(seventh.sim) && replays(thirteenth.sim), 'replay');
});

check('the dash: a colourShift event on the 6th and the 12th link (the links that freed the colour); the plan is the dash', () => {
  const { sim, taken } = tryRow([...rep(0, 6), ...rep(1, 6), 2]), w = sim.world;
  assert(taken === 13, `drawn: ${taken}`);
  const ids = w.chain.map(l => l.id), shifts = colorShiftIds(w);
  assert(shifts.length === 2 && shifts[0] === ids[5] && shifts[1] === ids[11], `the shift links: ${shifts} of ${ids}`);
  const plan = planChain(w);
  const events = dash(sim), hits = of(events, 'chainHit'), shifted = of(events, 'colorShift');
  assert(hits.length === 13 && plan.links.every((l, i) => hits[i].enemyId === l.link.id && hits[i].damage === l.outcome!.damage && hits[i].killed === l.outcome!.killed),
    'every hit is the plan\'s');
  assert(shifted.map(e => e.enemyId).join() === shifts.join(), `colourShift events: ${shifted.map(e => e.enemyId)}`);
  assert(w.lastChain?.kills === plan.kills && plan.kills === 13 && !w.move, `kills ${w.lastChain?.kills} = plan ${plan.kills}`);
  assert(replays(sim), 'replay');
});

check('an elite\'s plate hit is a link: a plated elite in the 1st segment still makes the 7th free; the dash takes its plate', () => {
  const spec: Spec[] = [0, 0, { color: 0, elite: true }, 0, 0, 0, 1];
  const { sim, taken } = tryRow(spec, quiet({ eliteArmor: true })), w = sim.world;
  assert(taken === 7, `the 7th of another colour joins after the plated elite: ${taken}`);
  const plan = planChain(w);
  assert(plan.links[2].outcome?.plate === true && !plan.endsOnSurvivor, 'the plan: a plate, no survivor');
  const events = dash(sim), hits = of(events, 'chainHit');
  assert(hits.length === 7 && hits[2].plates === plan.links[2].outcome!.platesAfter && plan.links.every((l, i) => hits[i].damage === l.outcome!.damage && hits[i].killed === l.outcome!.killed), 'the dash is the plan');
  assert(of(events, 'colorShift').length === 1, 'one shift');
  // The plated elite as the 6th link: it frees the colour — the shift event names it.
  const last = tryRow([...rep(0, 5), { color: 0, elite: true }, 1], quiet({ eliteArmor: true }));
  assert(last.taken === 7, `after a plated 6th: ${last.taken}`);
  const elite = last.sim.world.enemies.find(e => e.elite)!;
  const shifted = of(dash(last.sim), 'colorShift');
  assert(shifted.length === 1 && shifted[0].enemyId === elite.id && elite.armor!.plates === 2, `the shift on the elite (${JSON.stringify(shifted)}), a plate off`);
  assert(replays(sim) && replays(last.sim), 'replay');
});

check('a survivor ends the chain as before: nothing joins after it, whatever the colour', () => {
  const survivor = tryRow([...rep(0, 5), { color: 0, hp: 9 }, 1]);
  assert(survivor.taken === 6 && survivor.refusal === 'afterSurvivor', `after a surviving 6th: ${survivor.taken}, ${survivor.refusal}`);
  assert(planChain(survivor.sim.world).endsOnSurvivor, 'the plan ends on the survivor');
  const early = tryRow([0, 0, { color: 0, hp: 9 }, 0]);
  assert(early.taken === 3 && early.refusal === 'afterSurvivor', `after a surviving 3rd: ${early.taken}, ${early.refusal}`);
  // Design answer 12.10.2026: a surviving 6th link ends the chain — the colour never became free, no shift.
  const events = dash(survivor.sim);
  assert(of(events, 'chainHit').length === 6 && of(events, 'colorShift').length === 0, 'the survivor is struck; the 6th survived — no shift');
  assert(replays(survivor.sim), 'replay');
});

check('a crystal resets the colour and the count; the dash breaks it as before', () => {
  const short = tryRow([0, 0, 0, 0, 'crystal', ...rep(1, 5), 2]);
  assert(short.taken === 10 && short.refusal === 'color', `4 + crystal + 5, then another colour: refused (${short.taken}, ${short.refusal})`);
  assert(colorShiftLeft(short.sim.world) === 1, `the count restarted at the crystal: ${colorShiftLeft(short.sim.world)}`);
  const full = tryRow([0, 0, 0, 0, 'crystal', ...rep(1, 6), 2]);
  assert(full.taken === 12, `4 + crystal + 6, then another colour: joins (${full.taken})`);
  const right = tryRow([0, 0, 'crystal', 1]);
  assert(right.taken === 4, `after a crystal any colour: ${right.taken}`);
  const events = dash(full.sim);
  assert(of(events, 'crystalBreak').length === 1 && of(events, 'colorShift').length === 1 && of(events, 'chainHit').length === 11, 'the crystal broken, one shift (the 6th after it)');
  assert(replays(full.sim), 'replay');
});

check('the run: crystals off, the shift at 6; chain kills drop no crystal; the goblin\'s ◆ still falls and resets the colour', () => {
  const run = rtRunParams(defaultParams()), sandbox = defaultParams();
  assert(run.crystals === false && run.colorShiftLinks === 6, `the run: crystals ${run.crystals}, shift ${run.colorShiftLinks}`);
  assert(sandbox.crystals === true && sandbox.colorShiftLinks === 0, 'the sandbox: crystals on, the shift off');
  const off = tryRow(rep(0, 8)), events = dash(off.sim);
  assert(of(events, 'crystal').length === 0 && off.sim.world.stats.crystals === 0, 'no crystal from 8 chain kills');
  const on = tryRow(rep(0, 8), quiet({ crystals: true, colorShiftLinks: 0 }));
  assert(of(dash(on.sim), 'crystal').length === 1, 'the sandbox: a crystal at the 6th kill');
  // The goblin: pulls until ◆ or ◆◆◆ falls (crystals off), then a chain [A, ◆, B]: B joins only through the crystal.
  let found = false;
  for (let k = 1; k < 400 && !found; k++) {
    const sim = field(quiet({ slot: true, slotSkulls: 0, slotBust: false }), k), w = sim.world;
    if (sim.command({ t: 'slot' }) !== true || !goblinOf(w)) continue;
    for (let i = 0; i < Math.round(20 / SIM_DT) && leverOf(w) && objectRefusal(w, leverOf(w)!) === 'lever'; i++) ticks(sim, 1);
    const lever = leverOf(w);
    if (!lever) continue;
    sim.command({ t: 'teleport', x: lever.x + 1.2, y: lever.y });
    const before = w.objects.length;
    if (sim.command({ t: 'begin', x: lever.x, y: lever.y }) !== true) continue;
    sim.command({ t: 'release' });
    ticks(sim, Math.round(2 / SIM_DT));
    const crystal = w.objects.slice(before).find(o => o.kind === 'crystal');
    if (!crystal) continue;
    found = true;
    const hero = w.hero, dx = crystal.x - hero.x, dy = crystal.y - hero.y, d = Math.hypot(dx, dy);
    const a = sim.command({ t: 'place', x: hero.x + dx / 2, y: hero.y + dy / 2, color: 0, hp: 0, kind: 'basic' }) as number;
    const b = sim.command({ t: 'place', x: crystal.x + dx / d, y: crystal.y + dy / d, color: 1, hp: 0, kind: 'basic' }) as number;
    const A = w.enemies.find(e => e.id === a)!, B = w.enemies.find(e => e.id === b)!;
    sim.command({ t: 'begin', x: A.x, y: A.y });
    sim.command({ t: 'drag', x: B.x, y: B.y, mode: 'full' });
    assert(w.chain.length === 1 && hoverRefusal(w, B) === 'color', `B after A without the crystal: refused (${hoverRefusal(w, B)})`);
    sim.command({ t: 'drag', x: crystal.x, y: crystal.y, mode: 'full' });
    sim.command({ t: 'drag', x: B.x, y: B.y, mode: 'full' });
    assert((w.chain.length as number) === 3 && w.chain[1].kind === 'object' && w.chain[2].id === B.id, `A, ◆, B: ${JSON.stringify(w.chain)}`);
    const ev = dash(sim);
    assert(of(ev, 'crystalBreak').length === 1 && !w.enemies.includes(B), 'the dash breaks ◆ and kills B');
    assert(replays(sim), 'replay');
  }
  assert(found, 'some seed drops a ◆');
});

check('«Осколок жернова» 5, «Жернов» 4, both 3, never below 2; the crystal step is the panel\'s while the shift is on', () => {
  const shard: Loadout = { talismans: ['millstone-shard'] }, relic: Loadout = { talismans: [RELICS.millstone] }, both: Loadout = { talismans: ['millstone-shard', RELICS.millstone] };
  const cases: [Loadout | undefined, number][] = [[undefined, 6], [shard, 5], [relic, 4], [both, 3]];
  for (const [loadout, n] of cases) {
    const sim = field(quiet(), 1, loadout);
    assert(colorShiftOf(sim.world) === n && crystalEveryOf(sim.world) === 6, `${JSON.stringify(loadout)}: shift ${colorShiftOf(sim.world)}, crystal ${crystalEveryOf(sim.world)}`);
    const refused = tryRow([...rep(0, n - 1), 1], quiet(), loadout), joined = tryRow([...rep(0, n), 1], quiet(), loadout);
    assert(refused.taken === n - 1 && refused.refusal === 'color', `${n}: the ${n}-th of another colour refused (${refused.taken}, ${refused.refusal})`);
    assert(joined.taken === n + 1, `${n}: the ${n + 1}-th of another colour joins (${joined.taken})`);
  }
  // The floor: a shift of 3 with both — 2; of 2 — stays 2; of 1 — stays 1 (the items never raise it).
  for (const [base, want] of [[3, 2], [2, 2], [1, 1]] as const) {
    const sim = field(quiet({ colorShiftLinks: base }), 1, both);
    assert(colorShiftOf(sim.world) === want, `base ${base} with both: ${colorShiftOf(sim.world)} (want ${want})`);
  }
  // Without the shift (the sandbox) the items act on the crystal as before.
  const old = field(quiet({ colorShiftLinks: 0, crystals: true }), 1, both);
  assert(colorShiftOf(old.world) === 0 && crystalEveryOf(old.world) === 3, `shift off: crystal every ${crystalEveryOf(old.world)}`);
  assert(/раньше/.test(rtTalisman('millstone-shard')!.effect) && /раньше/.test(rtTalisman(RELICS.millstone)!.effect) && /смену цвета/.test(rtTalisman(COUNTER_TALISMANS.prism)!.effect),
    'the run cards say the new effect');
});

check('«Призма»: +1 energy per shift the dash reaches (2 in a chain of 13); a crystal still gives +1; nothing without the shift', () => {
  const prism: Loadout = { talismans: [COUNTER_TALISMANS.prism] }, spec = [...rep(0, 6), ...rep(1, 6), 2];
  const run = (params: Params, loadout: Loadout | undefined, row: Spec[] = spec): { energy: number; fired: number; sim: Simulation } => {
    const sim = field(params, 1, loadout);
    sim.command({ t: 'energy', value: 0 });
    const points = lay(sim, row);
    drawRow(sim, points);
    const events = dash(sim);
    return { energy: sim.world.energy, fired: of(events, 'talismanFired').filter(e => e.id === COUNTER_TALISMANS.prism).length, sim };
  };
  const p = quiet({ energyPerKill: 0 });
  const with2 = run(p, prism), without = run(p, undefined);
  assert(near(with2.energy, 2) && with2.fired === 2 && near(without.energy, 0), `energy ${with2.energy} (fired ${with2.fired}) against ${without.energy}`);
  // Design answer 12.10.2026: a chain released on the 6th killed link — the shift came (unused): +1; a surviving 6th — none.
  const six = run(p, prism, rep(0, 6)), survived = run(p, prism, [...rep(0, 5), { color: 0, hp: 9 }]);
  assert(near(six.energy, 1) && six.fired === 1, `released on the 6th kill: ${six.energy}`);
  assert(near(survived.energy, 0) && survived.fired === 0, `a surviving 6th: ${survived.energy}`);
  const crystal = run(p, prism, [0, 0, 'crystal', 1, 1]);
  assert(near(crystal.energy, 1) && crystal.fired === 1, `a crystal: ${crystal.energy}`);
  const off = run(quiet({ energyPerKill: 0, colorShiftLinks: 0 }), prism, rep(0, 13));
  assert(near(off.energy, 0) && off.fired === 0, `no shift, no crystal: ${off.energy}`);
  assert(replays(with2.sim) && replays(crystal.sim), 'replay');
});

check('the oath «Кристалл в цепи» is met by a colour shift the dash reaches (no crystals in the run)', () => {
  const params = quiet({ purse: true, oathStake: true });
  const met = field(params, 1, { oath: 'crystal-chain' });
  drawRow(met, lay(met, rep(0, 6)));
  assert(oathMark(met.world)!.mark === 'waits', 'waits while drawn');
  dash(met);
  assert(oathMark(met.world)!.mark === 'holds' && met.world.oath!.met !== undefined, `6 links: ${oathMark(met.world)!.mark}`);
  const short = field(params, 1, { oath: 'crystal-chain' });
  drawRow(short, lay(short, rep(0, 5)));
  dash(short);
  assert(oathMark(short.world)!.mark === 'waits', `5 links: ${oathMark(short.world)!.mark}`);
  assert(replays(met), 'replay');
});

check('П1 «Глубина звена» follows the rule: through the free link the path goes on in the new colour', () => {
  const spec: Spec[] = [...rep(0, 6), 1, 1, 1];
  const depthOf = (params: Params): { depth: number; ids: number[]; sim: Simulation; pathIds: number[] } => {
    const sim = field(params), points = lay(sim, spec);
    drawRow(sim, points.slice(0, 3));
    const d = linkDepth(sim.world, points[3].enemy!);
    return { depth: d.depth, ids: points.map(p => p.enemy!.id), sim, pathIds: d.path.map(l => l.id) };
  };
  const on = depthOf(quiet()), off = depthOf(quiet({ colorShiftLinks: 0 }));
  assert(on.depth === 6 && on.pathIds.join() === on.ids.slice(3, 9).join(), `with the shift: ${on.depth} ${on.pathIds}`);
  assert(off.depth === 3, `without: ${off.depth}`);
  // The path is drawn by the pointer and the dash strikes all of it.
  const sim = on.sim, w = sim.world;
  for (const id of on.pathIds) { const e = w.enemies.find(x => x.id === id)!; sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' }); }
  assert(w.chain.length === 9, `drawn: ${w.chain.length}`);
  assert(of(dash(sim), 'chainHit').length === 9, 'struck');
});

check('the plan is the dash on several seeds: random rows through shifts (plates, survivors, crystals), replays every 300 ticks', () => {
  const lengths = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const rng = new Rng(seedOf(k)), spec: Spec[] = [];
    let color = Math.floor(rng.next() * 4), count = 0;
    while (spec.length < 16) {
      if (count >= 6) { color = Math.floor(rng.next() * 4); count = 0; }
      const roll = rng.next();
      if (roll < 0.06 && spec.length > 1) { spec.push('crystal'); color = Math.floor(rng.next() * 4); count = 0; continue; }
      // The first two links weak: the chain gets going (a tough first link would end it at once).
      spec.push(spec.length < 2 ? color : roll < 0.16 ? { color, elite: true } : roll < 0.3 ? { color, hp: 1 + Math.floor(rng.next() * 6) } : color);
      count++;
    }
    const sim = field(quiet({ eliteArmor: true }), k), w = sim.world, points = lay(sim, spec);
    const checkpoints = new Map<number, string>();
    const { taken } = drawRow(sim, points);
    assert(taken >= 2, `seed ${k}: drew ${taken}`);
    const plan = planChain(w), shifts = colorShiftIds(w), enemyLinks = plan.links.filter(l => l.outcome);
    const events = dash(sim), hits = of(events, 'chainHit');
    for (let t = 0; t < 900; t++) { sim.tick(); if (w.tick % 300 === 0) checkpoints.set(w.tick, sim.hash()); }
    assert(hits.length === enemyLinks.length, `seed ${k}: ${hits.length} hits for ${enemyLinks.length} links`);
    enemyLinks.forEach((l, i) => {
      const o = l.outcome as StrikeOutcome, h = hits[i];
      assert(h.enemyId === l.link.id && h.damage === o.damage && h.killed === o.killed && h.plates === o.platesAfter, `seed ${k}, link ${i}: ${JSON.stringify(h)} vs ${JSON.stringify(o)}`);
    });
    assert(w.lastChain!.kills === plan.kills, `seed ${k}: kills ${w.lastChain!.kills} vs ${plan.kills}`);
    assert(of(events, 'colorShift').map(e => e.enemyId).join() === shifts.join(), `seed ${k}: shifts`);
    lengths.add(`${taken}/${shifts.length}/${plan.kills}`);
    assert(replays(sim, checkpoints), `seed ${k}: replay`);
  }
  assert(lengths.size >= 3, `the seeds give different chains: ${[...lengths]}`);
  assert([...lengths].some(x => Number(x.split('/')[1]) >= 1), `some chain goes through a shift: ${[...lengths]}`);
  console.log(`  links/shifts/kills by seed: ${[...lengths].join(' ')}`);
});

check('key 0 and no key: the old path (the 7th of another colour refused), the same world', () => {
  for (let k = 1; k <= 3; k++) {
    const zero = quiet({ colorShiftLinks: 0, crystals: true });
    const a = tryRow([...rep(0, 6), 1, 0], zero, undefined, k);
    assert(a.taken === 6 && a.refusal === 'color', `key 0: ${a.taken}, ${a.refusal}`);
    dash(a.sim);
    ticks(a.sim, 200);
    const journal = JSON.parse(JSON.stringify(a.sim.exportJournal()!)) as Journal;
    delete (journal.params as Partial<Params>).colorShiftLinks;
    assert(!('colorShiftLinks' in journal.params), 'the journal has no key');
    const b = replay(journal);
    const strip = (w: World): string => { const s = worldState(w) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    assert(strip(b.world) === strip(a.sim.world), `seed ${k}: no key — the same world`);
  }
});

// ---- «Свобода цвета держится» (`colorShiftKeep`, design 13.10.2026, task 10) ----
const keep = (extra: Partial<Params> = {}): Params => quiet({ colorShiftKeep: true, ...extra });

check('keep: 8 blue then a red — the red joins with the key and is struck (plan = dash); without the key it is refused; several seeds', () => {
  for (let k = 1; k <= 4; k++) {
    const on = tryRow([...rep(0, 8), 1], keep(), undefined, k), w = on.sim.world;
    assert(on.taken === 9 && on.refusal === null, `seed ${k}: with the key the red 9th joins (${on.taken}, ${on.refusal})`);
    assert(chainColor(w) === 1 && colorShiftLeft(w) === 5, `seed ${k}: the red set the colour, the count restarted (${chainColor(w)}, ${colorShiftLeft(w)})`);
    const plan = planChain(w), red = w.chain[8].id, events = dash(on.sim), hits = of(events, 'chainHit');
    assert(hits.length === 9 && plan.links.every((l, i) => hits[i].enemyId === l.link.id && hits[i].damage === l.outcome!.damage && hits[i].killed === l.outcome!.killed), `seed ${k}: the dash is the plan`);
    assert(hits[8].enemyId === red && hits[8].killed && !w.enemies.some(e => e.id === red), `seed ${k}: the red is struck`);
    assert(of(events, 'colorShift').length === 1 && w.lastChain?.kills === 9, `seed ${k}: one shift, 9 kills`);
    assert(replays(on.sim), `seed ${k}: replay`);
    const off = tryRow([...rep(0, 8), 1], quiet(), undefined, k);
    assert(off.taken === 8 && off.refusal === 'color', `seed ${k}: without the key the red is refused (${off.taken}, ${off.refusal})`);
  }
});

check('keep: the colour stays free over same-colour links («до смены» 0, the rainbow link is the 6th, then the 12th)', () => {
  const sim = field(keep()), w = sim.world, pts = lay(sim, rep(0, 13)), left: (number | null)[] = [], free: boolean[] = [], ring: number[] = [];
  sim.command({ t: 'begin', x: pts[0].x, y: pts[0].y });
  const look = (): void => { left.push(colorShiftLeft(w)); free.push(chainColor(w) === null); ring.push(colorShiftIds(w).at(-1) ?? 0); };
  look();
  for (const p of pts.slice(1)) { sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' }); look(); }
  assert(w.chain.length === 13, `drawn ${w.chain.length}`);
  assert(left.join(',') === '5,4,3,2,1,0,0,0,0,0,0,0,0', `left ${left}`);
  assert(free.map(f => f ? 1 : 0).join('') === '0000011111111', `free ${free}`);
  const ids = w.chain.map(l => l.id);
  assert(ring.slice(5, 11).every(id => id === ids[5]) && ring.slice(11).every(id => id === ids[11]), `the freeing link: ${ring}`);
  // Without the key the 7th starts a new segment: the colour is set again, «до смены» counts down anew.
  const old = field(quiet()), ow = old.world, op = lay(old, rep(0, 8));
  drawRow(old, op);
  assert(colorShiftLeft(ow) === 4 && chainColor(ow) === 0, `old path after 8: ${colorShiftLeft(ow)}, ${chainColor(ow)}`);
});

check('keep: a one-colour chain of 13 and of 19 — the same colourShift ids, «Призма» energy and kills with the key on and off', () => {
  const prism: Loadout = { talismans: [COUNTER_TALISMANS.prism] };
  for (const n of [13, 19]) for (let k = 1; k <= 3; k++) {
    const play = (params: Params): { shifts: string; events: string; energy: number; kills: number; sim: Simulation } => {
      const sim = field(params, k, prism);
      sim.command({ t: 'energy', value: 0 });
      const { taken } = drawRow(sim, lay(sim, rep(2, n)));
      assert(taken === n, `${n}: drawn ${taken}`);
      const order = sim.world.chain.map(l => l.id), shifts = colorShiftIds(sim.world).map(id => order.indexOf(id) + 1).join();
      const events = dash(sim);
      return { shifts, events: of(events, 'colorShift').map(e => order.indexOf(e.enemyId) + 1).join(), energy: sim.world.energy, kills: sim.world.lastChain!.kills, sim };
    };
    const on = play(keep({ energyPerKill: 0 })), off = play(quiet({ energyPerKill: 0 }));
    const want = n === 13 ? '6,12' : '6,12,18';
    assert(on.shifts === want && off.shifts === want, `${n}, seed ${k}: the shift links ${on.shifts} / ${off.shifts}`);
    assert(on.events === want && off.events === want, `${n}, seed ${k}: colourShift events ${on.events} / ${off.events}`);
    assert(near(on.energy, off.energy) && near(on.energy, n === 13 ? 2 : 3) && on.kills === n && off.kills === n, `${n}, seed ${k}: energy ${on.energy} / ${off.energy}`);
    assert(replays(on.sim), `${n}, seed ${k}: replay`);
  }
  // The oath «Кристалл в цепи» is met the same way by a long one-colour chain.
  for (const params of [keep({ purse: true, oathStake: true }), quiet({ purse: true, oathStake: true })]) {
    const sim = field(params, 1, { oath: 'crystal-chain' });
    drawRow(sim, lay(sim, rep(0, 13)));
    dash(sim);
    assert(oathMark(sim.world)!.mark === 'holds', `oath: ${oathMark(sim.world)!.mark}`);
  }
});

check('keep: after 8 blue a red segment frees again at its 6th; a crystal still resets the colour and the count', () => {
  const { sim, taken } = tryRow([...rep(0, 8), ...rep(1, 6), 2], keep()), w = sim.world;
  assert(taken === 15, `8 blue, 6 red, then green: ${taken}`);
  const ids = w.chain.map(l => l.id), shifts = colorShiftIds(w);
  assert(shifts.join() === [ids[5], ids[13]].join(), `shifts at the 6th blue and the 6th red: ${shifts.map(id => ids.indexOf(id) + 1)}`);
  const events = dash(sim);
  assert(of(events, 'colorShift').map(e => e.enemyId).join() === shifts.join() && of(events, 'chainHit').length === 15, 'the dash: the same shifts, all struck');
  const short = tryRow([...rep(0, 8), ...rep(1, 5), 2], keep());
  assert(short.taken === 13 && short.refusal === 'color', `5 red then green: refused (${short.taken}, ${short.refusal})`);
  const crystal = tryRow([...rep(0, 8), 'crystal', ...rep(1, 5), 2], keep());
  assert(crystal.taken === 14 && crystal.refusal === 'color' && colorShiftLeft(crystal.sim.world) === 1, `8 blue, crystal, 5 red, green: refused (${crystal.taken}, ${crystal.refusal})`);
  const after = tryRow([...rep(0, 8), 'crystal', 1], keep());
  assert(after.taken === 10 && chainColor(after.sim.world) === 1, `after a crystal any colour: ${after.taken}`);
  assert(replays(sim) && replays(crystal.sim), 'replay');
});

check('keep: «Осколок жернова» 5, «Жернов» 4, both 3 — the freedom holds over same-colour links; shifts at multiples of the step', () => {
  const cases: [Loadout, number][] = [[{ talismans: ['millstone-shard'] }, 5], [{ talismans: [RELICS.millstone] }, 4], [{ talismans: ['millstone-shard', RELICS.millstone] }, 3]];
  for (const [loadout, n] of cases) {
    const on = tryRow([...rep(0, n + 2), 1], keep(), loadout), off = tryRow([...rep(0, n + 2), 1], quiet(), loadout);
    assert(on.taken === n + 3, `${n}: with the key the other colour after ${n + 2} joins (${on.taken})`);
    assert(off.taken === n + 2 && off.refusal === 'color', `${n}: without the key it is refused (${off.taken}, ${off.refusal})`);
    const before = tryRow([...rep(0, n - 1), 1], keep(), loadout);
    assert(before.taken === n - 1 && before.refusal === 'color', `${n}: not sooner (${before.taken}, ${before.refusal})`);
    const long = 3 * n + 1, a = tryRow(rep(0, long), keep(), loadout), b = tryRow(rep(0, long), quiet(), loadout);
    const pos = (sim: Simulation): string => { const ids = sim.world.chain.map(l => l.id); return colorShiftIds(sim.world).map(id => ids.indexOf(id) + 1).join(); };
    assert(pos(a.sim) === `${n},${2 * n},${3 * n}` && pos(b.sim) === pos(a.sim), `${n}: shifts ${pos(a.sim)} / ${pos(b.sim)}`);
    const plan = planChain(on.sim.world), hits = of(dash(on.sim), 'chainHit');
    assert(hits.length === n + 3 && plan.links.every((l, i) => hits[i].enemyId === l.link.id && hits[i].killed === l.outcome!.killed), `${n}: the dash is the plan`);
  }
});

check('keep: П1 «Глубина звена» (the search, no cap) goes on through same-colour links past the step', () => {
  const spec: Spec[] = [...rep(0, 8), 1, 1, 1];
  const depthOf = (params: Params): { depth: number; ids: number[]; pathIds: number[]; sim: Simulation } => {
    const sim = field(params), points = lay(sim, spec);
    drawRow(sim, points.slice(0, 3));
    const d = linkDepth(sim.world, points[3].enemy!, { max: 20 });
    return { depth: d.depth, ids: points.map(p => p.enemy!.id), pathIds: d.path.map(l => l.id), sim };
  };
  const on = depthOf(keep()), off = depthOf(quiet());
  assert(on.depth === 8 && on.pathIds.join() === on.ids.slice(3).join(), `with the key: ${on.depth}`);
  assert(off.depth === 5, `without: ${off.depth}`);
  const sim = on.sim, w = sim.world;
  for (const id of on.pathIds) { const e = w.enemies.find(x => x.id === id)!; sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' }); }
  assert(w.chain.length === 11 && of(dash(sim), 'chainHit').length === 11, `drawn ${w.chain.length}, struck`);
});

check('keep: the plan is the dash on several seeds — random rows that run on in a free colour (plates, survivors, crystals)', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const rng = new Rng(seedOf(k)), spec: Spec[] = [];
    let color = Math.floor(rng.next() * 4), count = 0;
    while (spec.length < 18) {
      if (count >= 6 && rng.next() < 0.4) { color = Math.floor(rng.next() * 4); count = 0; }
      const roll = rng.next();
      if (roll < 0.05 && spec.length > 1) { spec.push('crystal'); color = Math.floor(rng.next() * 4); count = 0; continue; }
      spec.push(spec.length < 2 ? color : roll < 0.14 ? { color, elite: true } : roll < 0.24 ? { color, hp: 1 + Math.floor(rng.next() * 6) } : color);
      count++;
    }
    const sim = field(keep({ eliteArmor: true }), k), w = sim.world, points = lay(sim, spec), checkpoints = new Map<number, string>();
    const { taken } = drawRow(sim, points);
    assert(taken >= 2, `seed ${k}: drew ${taken}`);
    const plan = planChain(w), shifts = colorShiftIds(w), enemyLinks = plan.links.filter(l => l.outcome);
    const events = dash(sim), hits = of(events, 'chainHit');
    for (let t = 0; t < 900; t++) { sim.tick(); if (w.tick % 300 === 0) checkpoints.set(w.tick, sim.hash()); }
    assert(hits.length === enemyLinks.length, `seed ${k}: ${hits.length} hits for ${enemyLinks.length} links`);
    enemyLinks.forEach((l, i) => {
      const o = l.outcome as StrikeOutcome, h = hits[i];
      assert(h.enemyId === l.link.id && h.damage === o.damage && h.killed === o.killed && h.plates === o.platesAfter, `seed ${k}, link ${i}`);
    });
    assert(w.lastChain!.kills === plan.kills && of(events, 'colorShift').map(e => e.enemyId).join() === shifts.join(), `seed ${k}: kills and shifts`);
    seen.add(`${taken}/${shifts.length}/${plan.kills}`);
    assert(replays(sim, checkpoints), `seed ${k}: replay`);
  }
  assert(seen.size >= 3, `the seeds give different chains: ${[...seen]}`);
  console.log(`  links/shifts/kills by seed: ${[...seen].join(' ')}`);
});

check('keep: the run and the prologue play it on; the sandbox off; a journal without the key plays the old path, the same world', () => {
  assert(rtRunParams(defaultParams()).colorShiftKeep === true && prologueParams(4).colorShiftKeep === true && defaultParams().colorShiftKeep === false, 'run on, prologue on, sandbox off');
  for (let k = 1; k <= 3; k++) {
    const a = tryRow([...rep(0, 8), 1], quiet(), undefined, k);
    assert(a.taken === 8 && a.refusal === 'color', `seed ${k}: key off — refused`);
    dash(a.sim);
    ticks(a.sim, 200);
    const journal = JSON.parse(JSON.stringify(a.sim.exportJournal()!)) as Journal;
    delete (journal.params as Partial<Params>).colorShiftKeep;
    const b = replay(journal);
    const strip = (w: World): string => { const s = worldState(w) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    assert(strip(b.world) === strip(a.sim.world), `seed ${k}: no key — the same world`);
  }
});

console.log(`${checks} checks passed`);
