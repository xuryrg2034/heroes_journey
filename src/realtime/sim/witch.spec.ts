/**
 * Task 62 «Ведунья v2: радиус и фигуры», stage A (sim/glyphs.ts, chain.ts with `witchV2`; spec docs/design-notes/task-62-witch-v2.md,
 * section 6, «Этап А»; docs/realtime-prototype.md, «Ведунья v2»). Node only: `npm run test:realtime-witch`.
 *
 * Every check plays journalled commands (place, teleport, walk, begin / drag, release, crystal, chill, param) with `Loadout.hero` 'toad' and
 * `witchV2` on, and reads what the player meets — the highlight (`planChain`) and the release:
 * - without the key: Ведунья v1 replays her fixture (recorded before v2) to its hash; the cat with the key plays the world of before;
 * - the circle: an enemy in it but 3.5 from the link before is taken; one out of it — «далеко»; behind a wall from her — «нет видимости»;
 *   a crystal in the circle, a button only in the ordinary R;
 * - she does not walk while a chain is in her hand, she walks after the release;
 * - the discharge: every strike in the release's command, she stays, no move is left; a survivor stops nothing — the next link is
 *   struck; a link that left the circle is skipped (its rune stays where it was taken);
 * - the figures: a ring of 5 enemies drawn with the mouse's commands and closed on its first rune — the seal inside (the hit and the hold),
 *   the shield after it; a square of 4 — refused «не фигура», the release an open chain, no shield (a touch hurts); the classifier's corpus;
 * - the focus: a link adds 0.5 s, not the full reserve; energy 0 — the ring as well; the pause after a release;
 * - a thing of the castle (task 55а, design 21.10.2026): the chain ends on it unstruck, no figure, no shield; the discharge shoves it along
 *   the chain's last segment (a lone thing — from Ведунья) exactly as the highlight planned: where it slides, whom it crushes, whom it
 *   strikes;
 * - the items of the path (the pierce, «Возврат», the fire) do nothing and show nothing; «Ледяная печать», ranks II and the windows of the
 *   Troll and the Chief: the highlight is the discharge;
 * - the highlight is the discharge on 8 seeds with walking enemies and newcomers; every fight replays to the hash every 300 ticks.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { COUNTER_TALISMANS, HAMMERS } from './buildIds';
import { castCircle, castFirstRune, enemyRefusal, inCast, objectRefusal, planChain, witchGlyphClass, witchStands, type ChainPlan } from './chain';
import { CHIEF } from './enemies/chief';
import { BARREL } from './enemies/castle';
import { TROLL, TROLL_ROCK } from './enemies/troll';
import { wall, type Vec } from './geometry';
import { classifyGlyph, glyphClass } from './glyphs';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { replay, Simulation, SIM_DT, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { RUN_ARENAS } from '../run/arenaPools';
import toadV1 from '../../../tests/fixtures/realtime-toad-v1.json';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];

registerArena({
  id: 'witch-castle', name: 'Замок Ведуньи', summary: 'Тест Ведуньи v2 с вещами', goal: 'kills', width: 30, height: 14,
  heroStart: { x: 6, y: 7 }, obstacles: [wall(29, 0, 1, 14)], buttons: [], door: { x: 1, y: 0.7 }, enemies: [], killGoal: 99, castle: true,
});
registerArena({
  id: 'witch-field', name: 'Поле Ведуньи', summary: 'Тест Ведуньи v2', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 5, y: 6 }, obstacles: [wall(14, 3, 0.5, 6)], buttons: [{ x: 8, y: 2 }], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 99,
});

/** Nothing comes, nobody walks (unless `walk`), no touch damage (unless set), no hit-stop; Ведунья v2 on. */
function quiet(extra: Partial<Params> = {}, walk = false): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  if (!walk) p.enemySpeed = 0;
  p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false; p.finisher = false; p.witchV2 = true;
  return Object.assign(p, extra);
}
const TOAD: Loadout = { hero: 'toad' };
interface Fight { sim: Simulation; w: World; events: WorldEvent[]; hashes: Map<number, string> }
function fight(params: Params = quiet(), k = 1, loadout: Loadout = TOAD, arena = 'witch-field'): Fight {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  return { sim, w: sim.world, events: [], hashes: new Map() };
}
function tick(f: Fight, n = 1): void {
  for (let i = 0; i < n && f.w.status === 'playing'; i++) {
    f.sim.tick();
    f.events.push(...f.w.events.splice(0));
    if (f.w.tick % 300 === 0) f.hashes.set(f.w.tick, f.sim.hash());
  }
}
const place = (f: Fight, at: Vec, hp = 0, color = 0, kind = 'basic'): Enemy => {
  const id = f.sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return f.w.enemies.find(e => e.id === id)!;
};
function draw(f: Fight, points: readonly Vec[]): void {
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) f.sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
/** Releases the drawn chain: the plan before it, the events of the release's command (before any tick). */
function release(f: Fight): { plan: ChainPlan; events: WorldEvent[] } {
  const before = f.sim.hash(), plan = planChain(f.w);
  assert(f.sim.hash() === before, 'the highlight leaves the world as it was');
  f.sim.command({ t: 'release' });
  const events = f.w.events.splice(0);
  f.events.push(...events);
  return { plan, events };
}
/** The plan's strikes are the discharge's: per link — the damage and whether it died (links with no outcome — none). */
function sameAsPlan(what: string, plan: ChainPlan, events: readonly WorldEvent[]): void {
  // A thing (task 55а) is no strike: the plan marks it, the discharge strikes nothing there.
  const planned = plan.links.flatMap(l => (l.outcome && l.link.kind === 'enemy' && !l.outcome.thing ? [`${l.link.id}:${l.outcome.damage}:${l.outcome.killed}`] : []));
  const struck = of(events, 'chainHit').map(h => `${h.enemyId}:${h.damage}:${h.killed}`);
  assert(JSON.stringify(planned) === JSON.stringify(struck), `${what}: the plan ${planned} vs the discharge ${struck}`);
}
const replays = (f: Fight): boolean => {
  const seen = new Map<number, string>();
  const again = replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, s => { if (s.world.tick % 300 === 0) seen.set(s.world.tick, s.hash()); });
  return again.hash() === f.sim.hash() && [...f.hashes].every(([t, h]) => seen.get(t) === h);
};
const withoutParams = (w: World): string => { const s = { ...(worldState(w) as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };

/** A regular pentagon of radius 1.3 round (10, 6) (sides 1.53: no body overlaps), the first corner on top. */
const PENTAGON: readonly Vec[] = [{ x: 10, y: 7.3 }, { x: 8.764, y: 6.402 }, { x: 9.236, y: 4.948 }, { x: 10.764, y: 4.948 }, { x: 11.236, y: 6.402 }];
const SQUARE: readonly Vec[] = [{ x: 9.2, y: 5.2 }, { x: 10.8, y: 5.2 }, { x: 10.8, y: 6.8 }, { x: 9.2, y: 6.8 }];

// ---- Off: the path of before ----

check('off: Ведунья v1\'s journals (recorded before v2) replay to their hash; the cat with `witchV2` plays the world of before (3 run arenas)', () => {
  const fixture = toadV1 as unknown as { cases: { name: string; hash: string; journal: Journal }[] };
  assert(fixture.cases.length >= 2, 'the fixture has its cases');
  for (const c of fixture.cases) assert(replay(c.journal).hash() === c.hash, `${c.name}: the hash of before`);
  for (const [i, arena] of RUN_ARENAS.slice(0, 3).entries()) {
    const on = defaultParams(), off = defaultParams();
    on.witchV2 = true;
    const a = new Simulation({ arena, params: on, seed: seedOf(i + 1) }), b = new Simulation({ arena, params: off, seed: seedOf(i + 1) });
    for (let t = 0; t < 900; t++) {
      for (const s of [a, b]) {
        const w = s.world;
        if (t % 45 === 20 && !w.move && w.status === 'playing') { const e = w.enemies.find(x => enemyRefusal(w, x) === null); if (e) { s.command({ t: 'begin', x: e.x, y: e.y }); s.command({ t: 'release' }); } }
        s.tick();
      }
    }
    assert(withoutParams(a.world) === withoutParams(b.world), `${arena}: the cat with the key — the world of before`);
  }
});

// ---- The circle ----

check('the circle: an enemy in it 3.5 from the link before is taken; out of it — «далеко»; behind a wall — «нет видимости»; a crystal in it, a button only in R', () => {
  for (const k of SEEDS) {
    const f = fight(quiet(), k), w = f.w;
    const circle = castCircle(w);
    assert(Math.abs(circle.r - 2 * 1.875) < 1e-9 && circle.x === 5 && circle.y === 6, `seed ${k}: the circle 2 × R round her (${JSON.stringify(circle)})`);
    const a = place(f, { x: 6.5, y: 6 }), b = place(f, { x: 5, y: 9.2 }), far = place(f, { x: 9.6, y: 6 });
    draw(f, [a, b]);
    assert(w.chain.length === 2, `seed ${k}: the link 3.5 from the one before is taken (${w.chain.length})`);
    assert(enemyRefusal(w, far) === 'far', `seed ${k}: out of the circle — far (${enemyRefusal(w, far)})`);
    f.sim.command({ t: 'drag', x: far.x, y: far.y, mode: 'full' });
    assert(w.chain.length === 2, `seed ${k}: the far one not taken`);
    f.sim.command({ t: 'cancel' });
    // A wall between her and an enemy 3 away.
    f.sim.command({ t: 'teleport', x: 12.5, y: 6 });
    const behind = place(f, { x: 15.5, y: 6 });
    assert(enemyRefusal(w, behind) === 'sight', `seed ${k}: behind the wall — sight (${enemyRefusal(w, behind)})`);
    // Objects: the crystal 3 away in the circle; the button 3 away — out of R, 1.5 away — in.
    f.sim.command({ t: 'teleport', x: 5, y: 6 });
    const crystalId = f.sim.command({ t: 'crystal', x: 5, y: 3, value: 1 }) as number;
    const crystal = w.objects.find(o => o.id === crystalId)!, button = w.objects.find(o => o.kind === 'button')!;
    assert(objectRefusal(w, crystal) === null, `seed ${k}: the crystal in the circle (${objectRefusal(w, crystal)})`);
    assert(objectRefusal(w, button) === 'far', `seed ${k}: the button 3.6 away — out of R (${objectRefusal(w, button)})`);
    f.sim.command({ t: 'teleport', x: 7.2, y: 3 });
    assert(objectRefusal(w, button) === null, `seed ${k}: the button in R`);
  }
});

// ---- Walking ----

check('she stands while a chain is in her hand (the walk command does nothing), and walks after the release', () => {
  for (const k of SEEDS) {
    const f = fight(quiet(), k), w = f.w;
    const a = place(f, { x: 7, y: 6 }, 2);
    f.sim.command({ t: 'begin', x: a.x, y: a.y });
    f.sim.command({ t: 'walk', x: 1, y: 0 });
    tick(f, 30);
    assert(w.hero.x === 5 && w.hero.y === 6 && w.chain.length === 1, `seed ${k}: she stood (${w.hero.x})`);
    release(f);
    tick(f, 30);
    assert(w.hero.x > 5.5, `seed ${k}: she walks after the release (${w.hero.x})`);
  }
});

// ---- The discharge ----

check('the discharge: every strike in the release\'s command, she stays, no move left; a survivor stops nothing — the link after it is struck', () => {
  for (const k of SEEDS) {
    const f = fight(quiet(), k), w = f.w;
    const a = place(f, { x: 6.5, y: 6 }), tough = place(f, { x: 7.5, y: 8 }, 3), c = place(f, { x: 4, y: 3.5 });
    draw(f, [a, tough, c]);
    assert(w.chain.length === 3, `seed ${k}: three links (after a survivor too)`);
    const { plan, events } = release(f);
    assert(plan.links.every(l => l.outcome) && !plan.endsOnSurvivor, `seed ${k}: the plan strikes all three`);
    sameAsPlan(`seed ${k}`, plan, events);
    assert(!w.move && w.hero.x === 5 && w.hero.y === 6, `seed ${k}: no move, she stands`);
    assert(!w.enemies.includes(a) && w.enemies.includes(tough) && tough.hp === 1 && !w.enemies.includes(c), `seed ${k}: the first and the third dead, the tough one at 1 HP (${tough.hp})`);
    assert(w.castAt === w.time && of(events, 'chainEnd').length === 1, `seed ${k}: the chain ended in the release`);
    tick(f, 60);
    assert(replays(f), `seed ${k}: replay`);
  }
});

check('the rune keeps the point where the enemy was taken; a link that left the circle by the release gets no strike, the highlight says so first', () => {
  for (const k of SEEDS) {
    const f = fight(quiet({}, true), k), w = f.w;
    const a = place(f, { x: 8, y: 6 }), b = place(f, { x: 8.2, y: 8.5 });
    draw(f, [a, b]);
    const rune = { ...w.chain[0].rune! };
    tick(f, 20);
    assert(rune.x === 8 && rune.y === 6 && (a.x !== 8 || a.y !== 6) && w.chain[0].rune!.x === 8, `seed ${k}: the rune stays where it was taken (${JSON.stringify(rune)}, the enemy at ${a.x.toFixed(2)})`);
    // Ведунья is put away (a test command): the second link is out of her circle at the release.
    f.sim.command({ t: 'teleport', x: 5, y: 2 });
    const { plan, events } = release(f);
    const planB = plan.links.find(l => l.link.id === b.id)!;
    assert(planB.outcome === null, `seed ${k}: the highlight gives the far link no strike`);
    sameAsPlan(`seed ${k}`, plan, events);
    assert(w.enemies.includes(b) && !of(events, 'chainHit').some(h => h.enemyId === b.id), `seed ${k}: the link out of the circle not struck`);
  }
});

// ---- The figures ----

check('a ring of 5 drawn and closed on its first rune: «Печать» inside (the hit and the hold), the shield 0.5 s; energy 0 — the same', () => {
  for (const k of SEEDS) {
    const f = fight(quiet({ contactDamage: 1 }), k), w = f.w;
    f.sim.command({ t: 'teleport', x: 8.2, y: 6 });
    const ring = PENTAGON.map(p => place(f, p)), inner = place(f, { x: 10, y: 6 }, 3, 1);
    draw(f, [...ring, ring[0]]);
    assert(w.chainClosed === 'first' && w.energy === 0, `seed ${k}: the ring closed (${w.chainClosed})`);
    const { plan, events } = release(f);
    assert(plan.glyph && 'kind' in plan.glyph && plan.glyph.kind === 'ring' && plan.seal && JSON.stringify(plan.seal.inside) === JSON.stringify([inner.id]), `seed ${k}: the highlight — a ring, the seal over the inner one (${JSON.stringify(plan.glyph)}, ${JSON.stringify(plan.seal?.inside)})`);
    sameAsPlan(`seed ${k}`, plan, events);
    const seal = of(events, 'seal').filter(e => e.phase === 'strike');
    assert(seal.length === 1 && JSON.stringify(seal[0].inside) === JSON.stringify([inner.id]), `seed ${k}: the seal struck inside in the release`);
    assert(inner.hp === 2 && (inner.chill ?? 0) >= 1.5 - 1e-9 && ring.every(e => !w.enemies.includes(e)), `seed ${k}: the inner one hit and held (${inner.hp}, ${inner.chill})`);
    assert(Math.abs(w.hero.chainShield - 0.5) < 1e-9, `seed ${k}: the figure's shield 0.5 (${w.hero.chainShield})`);
    place(f, { x: w.hero.x, y: w.hero.y }, 0, 2);
    tick(f, ticksOf(0.4));
    assert(!of(f.events, 'hit').length, `seed ${k}: a touch under the shield does not hurt`);
  }
});

check('a square of 4 closed on its first rune — refused «не фигура», the chain stays open; the release strikes it, no seal, no shield — a touch hurts', () => {
  for (const k of SEEDS) {
    const f = fight(quiet({ contactDamage: 1 }), k), w = f.w;
    f.sim.command({ t: 'teleport', x: 8, y: 6 });
    const sq = SQUARE.map(p => place(f, p));
    draw(f, [...sq, sq[0]]);
    const refused = of(w.events, 'loop').filter(e => e.action === 'refused');
    assert(!w.chainClosed && refused.length === 1 && refused[0].refusal === 'notFigure' && w.chain.length === 4, `seed ${k}: refused «не фигура» (${JSON.stringify(refused)})`);
    const { plan, events } = release(f);
    assert(plan.noShield && !plan.seal && plan.glyph && 'refusal' in plan.glyph, `seed ${k}: an open chain in the highlight`);
    sameAsPlan(`seed ${k}`, plan, events);
    assert(w.hero.chainShield === 0 && !of(events, 'seal').length, `seed ${k}: no shield, no seal`);
    place(f, { x: w.hero.x, y: w.hero.y }, 0, 2);
    tick(f, ticksOf(0.5));
    assert(of(f.events, 'hit').length === 1, `seed ${k}: the touch hurts`);
  }
});

check('the classifier\'s corpus: rings, squares, triangles, the refusals «нить пересеклась», «не фигура», «мала»; a rune on a side is no corner; stage A acts on the ring only', () => {
  const p = defaultParams(), poly = (...xy: number[]): Vec[] => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i], y: xy[2 * i + 1] }));
  const kind = (pts: Vec[]): string => { const r = glyphClass(p, pts); return 'kind' in r ? r.kind : r.refusal; };
  assert(kind([...PENTAGON]) === 'ring', 'a pentagon — a ring');
  assert(kind(poly(11.3, 6, 10.65, 7.13, 9.35, 7.13, 8.7, 6, 9.35, 4.87, 10.65, 4.87)) === 'ring', 'a hexagon — a ring');
  assert(kind(poly(10, 7.3, 9.382, 6.851, 8.764, 6.402, 9.236, 4.948, 10.764, 4.948, 11.236, 6.402)) === 'ring', 'a pentagon with a rune on a side — a ring');
  assert(kind([...SQUARE]) === 'square' && kind(poly(10, 4.9, 11.1, 6, 10, 7.1, 8.9, 6)) === 'square', 'a square and a turned one');
  assert(kind(poly(8, 5, 12, 5, 12, 6.5, 8, 6.5)) === 'notFigure', 'a long rectangle — no figure');
  assert(kind(poly(8, 5, 11, 5, 9.5, 7.6)) === 'triangle', 'a triangle');
  assert(kind(poly(8, 5, 11, 7, 11, 5, 8, 7)) === 'crossed', 'a bow — crossed');
  assert(kind(poly(10, 6.5, 9.7, 6.2, 9.8, 5.8, 10.2, 5.8, 10.3, 6.2)) === 'small', 'a tiny ring — small');
  assert(kind(poly(8, 5, 12, 5, 12, 8, 10, 6, 8, 8)) === 'notFigure', 'a hollow contour — no figure');
  assert(kind(poly(8, 6, 10, 5, 14, 5.6, 14, 6.4, 10, 7)) === 'notFigure', 'a pentagon with a sharp corner — no ring');
  // Design 21.10.2026: a ring may have a dent (star-shaped from its area's centre), its corners up to 45°.
  assert(kind(poly(10, 7.3, 8.764, 6.402, 9.238, 5.752, 9.236, 4.948, 10.764, 4.948, 11.236, 6.402)) === 'ring', 'a pentagon with one dent — a ring');
  assert(kind(poly(10, 11, 8.764, 6.402, 9.236, 4.948, 10.764, 4.948, 11.236, 6.402)) === 'notFigure', 'a star with a 30° spike — no figure');
  assert(kind(poly(10, 7.9, 8.764, 6.402, 9.236, 4.948, 10.764, 4.948, 11.236, 6.402)) === 'ring', 'a pentagon with an 80° corner — a ring (to 45° allowed)');
  assert(glyphClass({ ...p, glyphRingCorner: 0 }, poly(10, 7.9, 8.764, 6.402, 9.236, 4.948, 10.764, 4.948, 11.236, 6.402)).hasOwnProperty('refusal'), 'with `glyphRingCorner` 0 (the rule of 90°) the 80° corner is refused');
  const s = classifyGlyph(p, [...SQUARE]), t = classifyGlyph(p, poly(8, 5, 11, 5, 9.5, 7.6)), r = classifyGlyph(p, [...PENTAGON]);
  assert('refusal' in s && s.refusal === 'notFigure' && 'refusal' in t && t.refusal === 'notFigure' && 'kind' in r && r.kind === 'ring', 'stage A: the square and the triangle refused, the ring');
});

// ---- The view's API (task 62, the contract core → ui) ----

check('the closing target is the first rune, not its enemy: the enemy walked off — the pointer on its body does not close, on the rune it does', () => {
  for (const k of SEEDS) {
    const f = fight(quiet({}, true), k), w = f.w;
    f.sim.command({ t: 'teleport', x: 7.5, y: 6 });
    const ring = PENTAGON.map(q => place(f, q));
    draw(f, ring);
    const target = castFirstRune(w)!;
    assert(target && target.x === PENTAGON[0].x && target.y === PENTAGON[0].y && target.r > 0, `seed ${k}: the target is the first rune (${JSON.stringify(target)})`);
    tick(f, 40);
    const first = ring[0];
    const off = Math.sqrt((first.x - target.x) ** 2 + (first.y - target.y) ** 2);
    assert(off > target.r, `seed ${k}: the first enemy walked off its rune (${off.toFixed(2)} > ${target.r.toFixed(2)})`);
    f.sim.command({ t: 'drag', x: first.x, y: first.y, mode: 'full' });
    assert(!w.chainClosed, `seed ${k}: the pointer on the enemy's body does not close`);
    f.sim.command({ t: 'drag', x: target.x, y: target.y, mode: 'full' });
    const closed = w.chainClosed === 'first' || of(w.events, 'loop').some(e => e.action === 'refused');
    assert(closed, `seed ${k}: the pointer on the rune closes (or is refused as a figure) (${w.chainClosed})`);
  }
});

check('on the first rune the closing beats a link of the chain (design 21.10.2026, (б)): the ring closes, the chain\'s length stays; a new enemy nearer the pointer joins the chain; the cat — the old path', () => {
  for (const k of SEEDS) {
    // A ring of 6: the 6th rune on the line from the 5th to the 1st, 0.66 from the 1st (no corner: the contour is the pentagon).
    const f = fight(quiet(), k), w = f.w;
    f.sim.command({ t: 'teleport', x: 7.5, y: 6 });
    const p0 = PENTAGON[0], p4 = PENTAGON[4], l = Math.sqrt((p4.x - p0.x) ** 2 + (p4.y - p0.y) ** 2), ux = (p4.x - p0.x) / l, uy = (p4.y - p0.y) / l;
    const sixth = { x: p0.x + 0.66 * ux, y: p0.y + 0.66 * uy }, pointer = { x: p0.x + 0.4 * ux, y: p0.y + 0.4 * uy };
    const ring = [...PENTAGON.map(q => place(f, q)), place(f, sixth)];
    draw(f, ring);
    assert(w.chain.length === 6 && planChain(w).glyph && 'kind' in planChain(w).glyph!, `seed ${k}: six links, a figure if closed`);
    f.sim.command({ t: 'drag', x: pointer.x, y: pointer.y, mode: 'full' });
    assert(w.chainClosed === 'first' && w.chain.length === 6, `seed ${k}: the ring closed over the 6th link nearer the pointer (${w.chainClosed}, ${w.chain.length})`);
    // A new enemy nearer the pointer than the rune joins the chain instead (a fresh fight, the same five and a newcomer by the rune).
    const g = fight(quiet(), k), v = g.w;
    g.sim.command({ t: 'teleport', x: 7.5, y: 6 });
    const five = PENTAGON.map(q => place(g, q)), out = { x: p0.x - 0.66 * ux, y: p0.y - 0.66 * uy }, near = { x: p0.x - 0.4 * ux, y: p0.y - 0.4 * uy };
    const fresh = place(g, out);
    draw(g, five);
    g.sim.command({ t: 'drag', x: near.x, y: near.y, mode: 'full' });
    assert(!v.chainClosed && v.chain.length === 6 && v.chain[5].id === fresh.id, `seed ${k}: the newcomer joined (${v.chainClosed}, ${v.chain.length})`);
    // Ведунья v1 (no key): the link of the chain nearer the pointer keeps the old path — no closing there.
    const h = fight(quiet({ witchV2: false }), k), u = h.w;
    h.sim.command({ t: 'teleport', x: 7.5, y: 6 });
    draw(h, [...PENTAGON.map(q => place(h, q)), place(h, sixth)]);
    const drawn = u.chain.length;
    h.sim.command({ t: 'drag', x: pointer.x, y: pointer.y, mode: 'full' });
    assert(!u.chainClosed && u.chain.length === drawn, `seed ${k}: v1 — no closing over the link (${u.chainClosed})`);
  }
});

check('the event `cast` of a discharge: her place and circle, the links in the order drawn at their runes, `struck` — the skipped one out of the circle', () => {
  for (const k of SEEDS) {
    const f = fight(quiet({}, true), k), w = f.w;
    const a = place(f, { x: 7.5, y: 6 }), b = place(f, { x: 8, y: 8.6 }), c = place(f, { x: 4, y: 3.5 });
    draw(f, [a, b, c]);
    assert(witchStands(w) && inCast(w, b), `seed ${k}: she stands with a chain, the second link in her circle`);
    const runes = w.chain.map(l => ({ ...l.rune! }));
    f.sim.command({ t: 'teleport', x: 5, y: 3 });
    assert(!inCast(w, b), `seed ${k}: the second link out of her circle now`);
    const { events } = release(f);
    const cast = of(events, 'cast');
    assert(cast.length === 1 && cast[0].x === 5 && cast[0].y === 3 && Math.abs(cast[0].r - castCircle(w).r) < 1e-9, `seed ${k}: one cast event at her place (${JSON.stringify(cast[0])})`);
    const links = cast[0].links;
    assert(links.map(l => l.id).join() === [a.id, b.id, c.id].join() && links.every((l, i) => l.x === runes[i].x && l.y === runes[i].y), `seed ${k}: the links in order at their runes`);
    assert(links.map(l => l.struck).join() === 'true,false,true', `seed ${k}: struck ${links.map(l => l.struck)}`);
    assert(of(events, 'chainHit').map(h => h.enemyId).join() === [a.id, c.id].join() && !witchStands(w), `seed ${k}: the hits are the struck ones; she walks again`);
  }
});

check('«Показать фигуру»: the class of any contour (a square too), while the game refuses it «не фигура»; no v2 — nothing', () => {
  const f = fight(quiet(), 1), w = f.w;
  f.sim.command({ t: 'teleport', x: 8, y: 6 });
  const sq = SQUARE.map(q => place(f, q));
  draw(f, sq);
  const shown = witchGlyphClass(w), plan = planChain(w);
  assert(shown && 'kind' in shown && shown.kind === 'square' && plan.glyph && 'refusal' in plan.glyph && plan.glyph.refusal === 'notFigure', `the class «Квадрат», the game «не фигура» (${JSON.stringify(shown)})`);
  const g = fight(quiet({ witchV2: false }), 1);
  g.sim.command({ t: 'teleport', x: 8, y: 6 });
  draw(g, SQUARE.map(q => place(g, q)));
  assert(witchGlyphClass(g.w) === null && castFirstRune(g.w) === null && !witchStands(g.w) && !planChain(g.w).cast, 'v1: no class, no target, no stand, no circle');
});

// ---- The focus and the pause ----

check('the focus: a link adds 0.5 s, not the full reserve (v1 — the full one); the pause after a release: no chain for 0.25 s', () => {
  for (const witch of [true, false]) {
    const f = fight(quiet({ witchV2: witch }), 1), w = f.w;
    const a = place(f, { x: 6.5, y: 6 }), b = place(f, { x: 6.5, y: 7.8 });
    f.sim.command({ t: 'begin', x: a.x, y: a.y });
    tick(f, 30);
    const before = w.focus;
    f.sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
    const want = witch ? Math.min(w.params.focusMax, before + 0.5) : w.params.focusMax;
    assert(Math.abs(w.focus - want) < 1e-9 && before < w.params.focusMax - 1, `witch ${witch}: the focus ${before.toFixed(2)} → ${w.focus.toFixed(2)} (want ${want.toFixed(2)})`);
  }
  const f = fight(quiet(), 2), w = f.w;
  const a = place(f, { x: 6.5, y: 6 }, 3), b = place(f, { x: 6.5, y: 7.8 });
  f.sim.command({ t: 'begin', x: a.x, y: a.y });
  release(f);
  assert(f.sim.command({ t: 'begin', x: b.x, y: b.y }) === false && !w.chain.length, 'no chain in the pause');
  tick(f, ticksOf(0.25));
  assert(f.sim.command({ t: 'begin', x: b.x, y: b.y }) === true, 'a chain after the pause');
});

// ---- A thing of the castle (task 55а; design 21.10.2026) ----

check('a thing of the castle: the chain ends on the barrel unstruck; the discharge shoves it as the highlight planned (its stop, the crushed, the struck); a lone barrel — from her; no shield', () => {
  let crushedAll = 0;
  for (let k = 1; k <= 6; k++) {
    for (const lone of [false, true]) {
      const f = fight(quiet({ shove: true }), k, TOAD, 'witch-castle'), w = f.w;
      // The seed turns the line: the barrel 2.6 from her, the weak link before it (not lone), weak bodies on the lane beyond and a tough
      // one where the barrel may stop.
      const dy = ((k * 37) % 9 - 4) / 10, len = Math.sqrt(1 + dy * dy), ux = 1 / len, uy = dy / len, at = (d: number): Vec => ({ x: 6 + ux * d, y: 7 + uy * d });
      const a = lone ? null : place(f, at(1.3)), barrel = place(f, at(2.6), 0, 0, BARREL);
      const weak = [place(f, at(4.4 + (k % 3) * 0.3)), place(f, at(6 + (k % 2) * 0.5))], tough = place(f, at(8.2 + (k % 4) * 0.4), 3, 1);
      draw(f, a ? [a, barrel] : [barrel]);
      assert(w.chain.length === (a ? 2 : 1), `seed ${k}: the barrel taken (${w.chain.length})`);
      const { plan, events } = release(f);
      const shove = plan.shove!;
      assert(shove && shove.thing === barrel.id && !plan.seal && plan.noShield && plan.endsOnThing, `seed ${k} lone ${lone}: the highlight's shove, no figure, no shield`);
      const dirWant = a ? { x: barrel.x - a.x, y: barrel.y - a.y } : { x: barrel.x - 6, y: barrel.y - 7 }, dl = Math.sqrt(dirWant.x ** 2 + dirWant.y ** 2);
      assert(Math.abs(shove.dir.x - dirWant.x / dl) < 1e-6 && Math.abs(shove.dir.y - dirWant.y / dl) < 1e-6, `seed ${k} lone ${lone}: the direction — the last segment (${JSON.stringify(shove.dir)})`);
      sameAsPlan(`seed ${k} lone ${lone}`, plan, events);
      assert(!of(events, 'chainHit').some(h => h.enemyId === barrel.id) && w.hero.chainShield === 0 && !w.move, `seed ${k}: the barrel unstruck, no shield, no move`);
      tick(f, ticksOf(4));
      const crushed = shove.crushed.map(c => c.id);
      assert(crushed.every(id => !w.enemies.some(e => e.id === id)) && weak.filter(e => !crushed.includes(e.id)).every(e => w.enemies.includes(e)), `seed ${k} lone ${lone}: the crushed as planned (${crushed})`);
      const struck = shove.impact ? (shove.impact.killed ? !w.enemies.includes(tough) : tough.hp === 3 - shove.impact.damage) : tough.hp === 3;
      assert(struck, `seed ${k} lone ${lone}: the tough one as planned (${JSON.stringify(shove.impact)}, HP ${tough.hp})`);
      const thing = w.enemies.find(e => e.id === barrel.id);
      assert(shove.breaks.includes(barrel.id) ? !thing : !!thing && Math.abs(thing.x - shove.to.x) < 1e-6 && Math.abs(thing.y - shove.to.y) < 1e-6, `seed ${k} lone ${lone}: the barrel stopped where planned`);
      assert(of(f.events, 'shove').some(e => e.action === 'start'), `seed ${k}: the shove ran`);
      crushedAll += crushed.length;
      assert(replays(f), `seed ${k}: replay`);
    }
  }
  assert(crushedAll > 0, 'some shove crushed somebody');
});

// ---- The items of the path ----

check('the items of the path — «Копьё» (the pierce), «Возврат», «Огненный проход» — do nothing and show nothing for Ведунья v2', () => {
  for (const [name, loadout] of [['«Копьё»', { hero: 'toad', talismans: ['fusion-spear'] }], ['«Возврат»', { hero: 'toad', hammer: HAMMERS.return }], ['«Огненный проход»', { hero: 'toad', hammer: HAMMERS.fire }]] as const) {
    const f = fight(quiet({ pierceEnabled: true, returnFixed: true }), 1, loadout as Loadout), w = f.w;
    const pts = [{ x: 6.5, y: 6 }, { x: 7.8, y: 6 }];
    for (const q of pts) place(f, q);
    place(f, { x: 9.5, y: 6 }, 2);
    draw(f, pts);
    const { plan, events } = release(f);
    assert(!plan.pierce && !plan.back && !plan.fire, `${name}: nothing in the highlight (${Object.keys(plan)})`);
    assert(!w.move && !of(events, 'pierce').length && !w.build, `${name}: nothing after the release (${JSON.stringify(w.build)})`);
    tick(f, 60);
    assert(!w.move && w.hero.x === 5, `${name}: no run`);
  }
});

// ---- Combos: «Ледяная печать», ranks II, the bosses' windows ----

check('«Ледяная печать»: the ring\'s survivors inside freeze 3 s, brittle — the highlight\'s `seal.ice` is the release\'s', () => {
  for (const k of SEEDS) {
    const f = fight(quiet(), k, { hero: 'toad', talismans: ['fusion-ice-seal'] });
    f.sim.command({ t: 'teleport', x: 8.2, y: 6 });
    const ring = PENTAGON.map(p => place(f, p)), inner = place(f, { x: 10, y: 6 }, 3, 1);
    draw(f, [...ring, ring[0]]);
    const { plan, events } = release(f);
    assert(plan.seal?.ice && JSON.stringify(plan.seal.ice.ids) === JSON.stringify([inner.id]), `seed ${k}: the highlight's frost (${JSON.stringify(plan.seal?.ice)})`);
    sameAsPlan(`seed ${k}`, plan, events);
    assert((inner.chill ?? 0) >= 3 - 1e-9 && inner.brittle === true, `seed ${k}: frozen 3 s, brittle (${inner.chill}, ${inner.brittle})`);
  }
});

check('ranks II and the counters in the discharge: the highlight is the discharge (`Пятое звено`, «Охотник на элит», «Призма», «Добивание» on rank II, the chain window)', () => {
  const honed = [COUNTER_TALISMANS.fifthLink, COUNTER_TALISMANS.eliteHunter, COUNTER_TALISMANS.finisher];
  for (const k of [1, 2, 3, 4]) {
    const f = fight(quiet({ counterWindow: true, eliteArmor: true }), k, { hero: 'toad', talismans: [...honed, COUNTER_TALISMANS.prism], honed }), w = f.w;
    const pts = Array.from({ length: 7 }, (_, i) => ({ x: 5 + 3.3 * Math.round(100 * Math.cos(0.9 * i)) / 100, y: 6 + 3.3 * Math.round(100 * Math.sin(0.9 * i)) / 100 }));
    pts.forEach((q, i) => { if (i === 2) f.sim.command({ t: 'place', x: q.x, y: q.y, color: 0, hp: 0, kind: 'basic', elite: true }); else place(f, q, (k + i) % 3); });
    draw(f, pts);
    const drawn = w.chain.length;
    const { plan, events } = release(f);
    assert(drawn === pts.length && plan.links.filter(l => l.outcome).length === drawn, `seed ${k}: every link drawn and struck in the plan (${drawn})`);
    sameAsPlan(`seed ${k}`, plan, events);
  }
});

check('the Troll\'s window and the Chief\'s: outside it the core is refused («вне окна»); in the club\'s window the discharge takes its one hit as the highlight said, the links after the core are struck', () => {
  let struck = 0;
  for (const k of SEEDS) {
    const params = quiet({ heroHp: 999 });
    params.trollHp = 4; params.trollPlates = 5;
    const sim = new Simulation({ arena: 'troll', params, seed: seedOf(k), record: true, loadout: TOAD }), w = sim.world;
    sim.command({ t: 'teleport', x: 12, y: 12 });
    sim.tick();
    const core = w.enemies.find(e => e.kind === TROLL)!, rock = w.enemies.find(e => e.kind === TROLL_ROCK)!;
    assert(enemyRefusal(w, core) === 'outOfWindow', `seed ${k}: the core refused (${enemyRefusal(w, core)})`);
    sim.command({ t: 'chill', id: rock.id, seconds: 600 });
    sim.command({ t: 'teleport', x: 12, y: 6.5 });
    let opened = false;
    for (let i = 0; i < ticksOf(12) && !opened; i++) { sim.tick(); opened = w.events.splice(0).some(e => e.type === 'trollWindow' && e.action === 'open'); }
    assert(opened, `seed ${k}: the club opened the window`);
    const f: Fight = { sim, w, events: [], hashes: new Map() };
    // Ведунья 2.4 below the core (her circle holds it), a link between them and one beside her — of the core's colour.
    sim.command({ t: 'teleport', x: core.x, y: core.y + 2.4 });
    const a = place(f, { x: core.x - 0.9, y: core.y + 1.4 }, 0, core.color), b = place(f, { x: w.hero.x + 1.2, y: w.hero.y }, 0, core.color);
    assert(enemyRefusal(w, core) !== 'outOfWindow', `seed ${k}: the core open`);
    draw(f, [a, core, b]);
    if (w.chain.length !== 3) continue;
    const plates = core.armor?.plates ?? 0;
    const { plan, events } = release(f);
    sameAsPlan(`seed ${k}`, plan, events);
    const hits = events.filter(e => e.type === 'trollWindow' && e.action === 'hit');
    assert(hits.length === 1 && core.armor?.plates === plates - 1 && !w.enemies.includes(b), `seed ${k}: one hit of the window, a plate off, the link after the core struck`);
    struck++;
  }
  assert(struck >= 2, `the core struck in its window on ${struck} seeds`);
  for (const k of SEEDS) {
    const params = quiet({ heroHp: 999 });
    const sim = new Simulation({ arena: 'chief', params, seed: seedOf(k), record: true, loadout: TOAD }), w = sim.world;
    sim.tick();
    const core = w.enemies.find(e => e.kind === CHIEF)!;
    sim.command({ t: 'teleport', x: core.x - 2, y: core.y + 1 });
    sim.tick();
    assert(enemyRefusal(w, core) === 'outOfWindow', `seed ${k}: the Chief's core refused outside his window (${enemyRefusal(w, core)})`);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    assert(!w.chain.length, `seed ${k}: a click takes nothing`);
  }
});

// ---- The highlight is the discharge (8 seeds, walking enemies, newcomers) ----

check('the highlight is the discharge on 8 seeds: walking enemies and newcomers on the run arenas, chains through the circle round the crowd, closing tried from 5 runes; every fight replays every 300 ticks', () => {
  let rings = 0, discharges = 0;
  const refused: Record<string, number> = {};
  for (let k = 1; k <= 8; k++) {
    const p = defaultParams();
    p.witchV2 = true; p.hitstop = false; p.heroHp = 999;
    const f = fight(p, k, TOAD, RUN_ARENAS[k % RUN_ARENAS.length]), w = f.w;
    for (let t = 0; t < 2400 && w.status === 'playing'; t++) {
      if (t % 40 === 15 && !w.chain.length && !w.move) {
        const free = w.enemies.filter(e => enemyRefusal(w, e) === null).sort((a, b) => a.id - b.id);
        if (free.length) {
          // Round the bodies' middle by angle (the test's own order, not the game's): a ring where they stand round.
          const color = free[0].color, same = free.filter(e => e.color === color);
          const mid = { x: same.reduce((s, e) => s + e.x, 0) / same.length, y: same.reduce((s, e) => s + e.y, 0) / same.length };
          const round = [...same].sort((a, b) => Math.atan2(a.y - mid.y, a.x - mid.x) - Math.atan2(b.y - mid.y, b.x - mid.x)).slice(0, 7);
          f.sim.command({ t: 'begin', x: round[0].x, y: round[0].y });
          for (const next of round.slice(1)) f.sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
          tick(f, 10);
          const first = w.chain[0] && w.enemies.find(e => e.id === w.chain[0].id);
          if (first && w.chain.length >= 5) {
            f.sim.command({ t: 'drag', x: first.x, y: first.y, mode: 'full' });
            for (const e of w.events) if (e.type === 'loop' && e.action === 'refused') refused[e.refusal ?? '?'] = (refused[e.refusal ?? '?'] ?? 0) + 1;
          }
          if (w.chainClosed) rings++;
          if (w.chain.length) {
            const { plan, events } = release(f);
            sameAsPlan(`seed ${k} tick ${w.tick}`, plan, events);
            const strike = of(events, 'seal').find(e => e.phase === 'strike');
            assert(!!plan.seal === !!strike && (!plan.seal || JSON.stringify(plan.seal.inside.filter(id => w.enemies.some(e => e.id === id) || events.some(e => e.type === 'kill' && e.enemyId === id))) === JSON.stringify(strike!.inside)), `seed ${k}: the seal as planned`);
            assert(!w.move, `seed ${k}: no move after the release`);
            discharges++;
          }
        }
      }
      if (t % 90 === 0) f.sim.command({ t: 'walk', x: (k + t) % 3 - 1, y: (k * t) % 3 - 1 });
      tick(f);
    }
    assert(replays(f), `seed ${k}: replay`);
  }
  assert(discharges >= 40, `discharges ${discharges}, rings ${rings}`);
  // A heuristic of this test's own bot, not a measure of the game: how often a crowd round her makes a ring (design's bot — stage A, spec 6).
  console.log(`   ${discharges} discharges, ${rings} rings closed, closings refused ${JSON.stringify(refused)}`);
});

console.log(`witch: ${checks} checks passed`);
