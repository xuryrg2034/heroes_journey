/**
 * Task 55а «Замок, шаг 1а», part ui (view/castleView.ts, worldLabels.ts, newSeen.ts): the view of the castle's things reads the sim.
 * Node only: `npm run test:realtime-castle-view`. The view is driven frame by frame against real worlds of the castle's arenas
 * (journalled commands: clear, place, teleport; the sim's own timers); it writes to real PixiJS `Graphics` without a renderer. What the
 * player sees in a browser by real input — tests/realtime-castle.spec.ts. The shove itself starts at a dash's end (chain.ts, the last
 * step of 55а, after 54а): until then its run is started here by `startShove` with the plan `shovePath` gives — the way sim/castle.spec.ts does.
 * - the three arenas: a whole fight of each is drawn frame by frame (signs, notches, floor, walls) without a fall;
 * - a running shove: the streak and the path ahead, the crush's slash, the impact (the camera's kick), the stop's dust, the splinters;
 * - «Падение шкафа»: the strip fills with the windup, the wardrobe leans, the hit flashes the lane and kicks the camera, it lies, it rises;
 * - «Удар ладьи»: the line both ways fills with the windup, the strike flashes it; a wardrobe on the axis shelters;
 * - the shove's preview: a chain drawn (journal commands) that ends on a thing — the view draws the plan's path, a cross per crushed body, the strike's mark,
 *   the ghost's notches, the break; nothing is drawn for a chain that does not end on a thing; the first barrel's label
 * - the names at the first windup, once in the fight; the bestiary lines.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import '../sim/world';
import { Graphics, GraphicsContext } from 'pixi.js';
import { CASTLE_ARENAS } from '../sim/arenasCastle';
import { registerArena } from '../sim/arenas';
import { BARREL, ROOK, TOPPLE_LENGTH, WARDROBE, wardrobeTopple } from '../sim/enemies/castle';
import { wall, type Vec } from '../sim/geometry';
import { defaultParams, type Params } from '../sim/params';
import { durabilityOf, shovePath, startShove } from '../sim/shove';
import { planChain } from '../sim/chain';
import { Simulation, SIM_DT } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { KIND_CAPTIONS } from './newSeen';
import { barrelLabel, BARREL_LABEL_TEXT, bossMoveLabels, CASTLE_MOVE_TEXT } from './worldLabels';
import { CastleView, IMPACT_KICK, TOPPLE_KICK, barrelMarks, drawHanger, drawParquet, isThingKind, rookMarks, wardrobeMarks, type Posable } from './castleView';
import type { SignTools } from './trollView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const U = 72, R = 28.8;
const unit = (x: number, y: number): Vec => { const l = Math.hypot(x, y); return { x: x / l, y: y / l }; };

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест вида замка' };
registerArena({ ...base, id: 'castle-view-field', name: 'Поле замка (вид)', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [wall(22, 0, 2, 14)], door: { x: 1, y: 0.7 }, castle: true });

/** Nothing comes, nobody walks, touches do not hurt; the hero has 99 HP and no grace window to blur the count. */
function quiet(): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return p;
}
function field(k: number): Simulation {
  const sim = new Simulation({ arena: 'castle-view-field', params: quiet(), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp: 0, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};

/** The counts of the tools the signs draw with. */
function tools(): SignTools & { calls: { strip: number; head: number } } {
  const calls = { strip: 0, head: 0 };
  return { calls, strip: () => { calls.strip++; }, head: () => { calls.head++; }, hatchCircle: () => {} };
}

/** A tiny rig: one frame of the view over the tick just played (what render.ts does, in its order). */
interface Rig { view: CastleView; g: Graphics; tl: ReturnType<typeof tools>; clock: number; kicks: number[]; events: WorldEvent[] }
const rig = (): Rig => ({ view: new CastleView(U), g: new Graphics(), tl: tools(), clock: 0, kicks: [], events: [] });
function frame(rg: Rig, sim: Simulation, events: readonly WorldEvent[]): void {
  const w = sim.world;
  rg.clock += SIM_DT;
  for (const ev of events) { rg.events.push(ev); const kick = rg.view.onEvent(ev, rg.clock, R); if (kick > 0) rg.kicks.push(kick); }
  rg.view.beginFrame();
  rg.g.clear();
  rg.view.drawLanes(rg.g, w, rg.tl, () => true);
  rg.view.drawOver(rg.g, w, rg.clock, 1, R, () => true);
  rg.view.note(w);
}
/** Plays `n` ticks (or until `until`), a frame each; returns the events. */
function play(rg: Rig, sim: Simulation, n: number, until: (w: World) => boolean = () => false, onFrame?: () => void): WorldEvent[] {
  const all: WorldEvent[] = [];
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) {
    sim.tick();
    const ev = [...sim.world.events]; sim.world.events.length = 0; all.push(...ev);
    frame(rg, sim, ev);
    onFrame?.();
  }
  return all;
}
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

check('the three arenas open and play a whole fight in the view without a fall; their things wear their notches (barrel 1, wardrobe 2) and the floor and walls draw', () => {
  const want: Record<string, number> = { 'c-hall': 3, 'c-enfilade': 5, 'c-ballroom': 8 };
  for (const arena of CASTLE_ARENAS) {
    for (const k of [1, 2]) {
      const p = defaultParams(); p.heroHp = 999;
      const sim = new Simulation({ arena: arena.id, params: p, seed: seedOf(k), record: true }), rg = rig();
      assert(sim.world.params.shove, `${arena.id}: the law is on`);
      frame(rg, sim, []);
      const things = sim.world.enemies.filter(e => isThingKind(e.kind)), notches = things.reduce((n, e) => n + durabilityOf(e), 0);
      assert(rg.view.shown.notches === notches && notches > 0, `${arena.id}/${k}: notches ${rg.view.shown.notches} vs durability ${notches}`);
      assert(notches === want[arena.id], `${arena.id}: notches ${notches}, expected ${want[arena.id]} (barrels 1, wardrobes 2)`);
      play(rg, sim, ticksOf(25));
      const f = new Graphics(), t = new Graphics();
      drawParquet(f, arena.width, arena.height, U);
      for (const o of arena.obstacles) if (o.shape === 'rect') drawHanger(t, o.x, o.y, o.w, o.h, U);
    }
  }
});

check('the stand-in drawings: the barrel, the wardrobe, the rook draw into a context (bounds inside the body\'s box); a wardrobe is taller than a barrel', () => {
  const bounds = (draw: (c: GraphicsContext, r: number) => void): { w: number; h: number } => { const c = new GraphicsContext(); draw(c, R); const b = new Graphics(c).getLocalBounds(); return { w: b.width, h: b.height }; };
  const barrel = bounds(barrelMarks), wardrobe = bounds(wardrobeMarks), rook = bounds(rookMarks);
  assert(barrel.h > R && barrel.h < R * 2.4 && wardrobe.h > barrel.h && rook.w > R && rook.h > R, `sizes ${JSON.stringify({ barrel, wardrobe, rook })}`);
});

check('a running shove: the streak behind and the path ahead while it slides; the crush slashes, the impact flashes and kicks the camera, the stop raises dust, the barrel breaks in splinters (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    const sim = field(k), w = sim.world, rg = rig();
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const barrel = place(sim, { x: 5, y: 7 }, BARREL);
    place(sim, { x: 8, y: 7 }); place(sim, { x: 10, y: 7.2 }, 'basic', 1);
    place(sim, { x: 14, y: 7 }, 'basic', 2); w.enemies[w.enemies.length - 1].hp = 3;
    const plan = shovePath(w, barrel, unit(1, 0));
    assert(plan.crushed.length === 2 && plan.stop === 'body' && plan.impact, `seed ${k}: a plan with 2 crushed and a strike`);
    frame(rg, sim, []);
    startShove(w, plan);
    let midRuns = 0, midTrails = 0;
    const events = play(rg, sim, ticksOf(3), x => !x.shoves, () => { if (w.shoves?.length && rg.view.shown.runs > 0) { midRuns++; midTrails += rg.view.shown.trails; } });
    assert(midRuns > 5 && midTrails > 5, `seed ${k}: the run was drawn on ${midRuns} frames`);
    const shown = rg.view.shown;
    assert(shown.starts === 1 && shown.crushes === 2 && shown.impacts === 1 && shown.stops === 1 && shown.breaks === 1, `seed ${k}: events ${JSON.stringify(shown)}`);
    assert(rg.kicks.length === 1 && rg.kicks[0] === IMPACT_KICK, `seed ${k}: one kick, ${rg.kicks}`);
    assert(events.some(e => e.type === 'thing') && rg.view.shown.notches === 0, `seed ${k}: the barrel is gone, no notches (${rg.view.shown.notches})`);
    // The effects live a while after the event and then are gone.
    rg.g.clear(); rg.view.drawOver(rg.g, w, rg.clock + 0.2, 1, R, () => true);
    assert(rg.g.context.instructions.length > 0, `seed ${k}: the effects are drawn`);
    rg.g.clear(); rg.view.drawOver(rg.g, w, rg.clock + 5, 1, R, () => true);
    assert(rg.g.context.instructions.length === 0, `seed ${k}: and gone after their life`);
  }
});

check('a wardrobe shoved into a wall wears one notch (2 → 1), a cancelled shove and a fall are marked; the wardrobe of a shove stands up from its pose', () => {
  const sim = field(1), w = sim.world, rg = rig();
  sim.command({ t: 'teleport', x: 2, y: 2 });
  const wr = place(sim, { x: 20, y: 5 }, WARDROBE);
  frame(rg, sim, []);
  assert((rg.view.shown.notches as number) === 2, 'two notches');
  const plan = shovePath(w, wr, unit(1, 0));
  assert(plan.stop === 'wall', 'into the wall');
  startShove(w, plan);
  play(rg, sim, ticksOf(2), x => !x.shoves);
  assert(rg.view.shown.notches === 1 && durabilityOf(wr) === 1 && rg.view.shown.impacts === 1 && rg.view.shown.breaks === 0, `one notch left (${rg.view.shown.notches})`);
  // The events a chain will bring (chain.ts): a cancelled shove, a fall.
  frame(rg, sim, [{ type: 'shove', action: 'cancel', thingId: wr.id, x: 20, y: 5 }, { type: 'shove', action: 'fall', thingId: wr.id, x: 20, y: 5 }]);
  assert(rg.view.shown.cancels === 1 && rg.view.shown.falls === 1, 'a cancel and a fall');
});

check('«Падение шкафа»: the strip stands from the windup and fills; the wardrobe leans towards the lane, the hit flashes the lane and kicks the camera and costs the hero 2; it lies flat on the lane, rises and stands upright (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    const sim = field(k), w = sim.world, rg = rig();
    sim.command({ t: 'teleport', x: 8.5, y: 7 });
    const wr = place(sim, { x: 11, y: 7 }, WARDROBE);
    const stub: Posable & { sy: number } = { rotation: 0, sy: 1, pivot: { set: () => {} }, position: { set: () => {} }, scale: { set: (_x: number, y: number) => { stub.sy = y; } } };
    let strips = 0, lastProgress = 0, leaned = 0, hpBefore = w.hero.hp;
    const pose = (): void => {
      view.poseWardrobe(w, wr, stub, R * 0.9, SIM_DT);
      const t = wardrobeTopple(w, wr);
      if (t) { strips += rg.view.shown.topples; assert(t.progress >= lastProgress - 1e-9, `seed ${k}: the windup only fills`); lastProgress = t.progress; leaned = Math.max(leaned, Math.abs(stub.rotation)); }
    };
    const view = rg.view;
    // The windup (the first of a fight 1.8 s); the hero stays in the lane.
    const events = play(rg, sim, ticksOf(3), x => x.hero.hp < hpBefore, pose);
    assert(events.some(e => e.type === 'wardrobe' && e.action === 'windup'), `seed ${k}: a windup`);
    assert(strips > ticksOf(1.2) && leaned > 0.2 && rg.tl.calls.strip === strips && rg.tl.calls.head === strips, `seed ${k}: the strip drew on ${strips} frames, leaned ${leaned.toFixed(2)}`);
    assert(w.hero.hp === hpBefore - 2 && rg.view.shown.hits === 1 && rg.kicks.includes(TOPPLE_KICK), `seed ${k}: the hit cost ${hpBefore - w.hero.hp}, kicks ${rg.kicks}`);
    const lane = rg.view.laneOf(wr.id);
    assert(lane && Math.abs(Math.hypot(lane.to.x - lane.from.x, lane.to.y - lane.from.y) - TOPPLE_LENGTH) < 1e-9, `seed ${k}: the lane the view drew is the sim's (3 long)`);
    // It lies flat on the lane (towards the hero: west), 2 s; then rises.
    play(rg, sim, ticksOf(1), () => false, pose);
    assert(stub.rotation < -1.3, `seed ${k}: it lies towards the lane (rotation ${stub.rotation.toFixed(2)})`);
    const rose = play(rg, sim, ticksOf(2), () => false, pose);
    assert(rose.some(e => e.type === 'wardrobe' && e.action === 'rise') && rg.view.shown.rises === 1, `seed ${k}: it rose`);
    play(rg, sim, ticksOf(0.6), () => false, pose);
    assert(Math.abs(stub.rotation) < 0.05 && Math.abs(stub.sy - 1) < 0.05, `seed ${k}: upright again (${stub.rotation.toFixed(2)}, ${stub.sy.toFixed(2)})`);
  }
});

check('a wardrobe that falls up or down the screen is flattened, not turned', () => {
  const sim = field(1), w = sim.world, rg = rig();
  sim.command({ t: 'teleport', x: 12, y: 4 });
  const wr = place(sim, { x: 12, y: 7 }, WARDROBE);
  const stub: Posable & { sy: number } = { rotation: 0, sy: 1, pivot: { set: () => {} }, position: { set: () => {} }, scale: { set: (_x: number, y: number) => { stub.sy = y; } } };
  let flattest = 1;
  play(rg, sim, ticksOf(5), () => false, () => { rg.view.poseWardrobe(w, wr, stub, R * 0.9, SIM_DT); flattest = Math.min(flattest, stub.sy); });
  assert(Math.abs(stub.rotation) < 1e-9 && flattest < 0.6, `flat ${flattest.toFixed(2)}, rotation ${stub.rotation}`);
});

check('«Удар ладьи»: the line both ways stands from the windup and fills (the first 1.5 s); the strike flashes it and costs the hero 2; a wardrobe on the axis shelters the hero (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    const sim = field(k), w = sim.world, rg = rig();
    sim.command({ t: 'teleport', x: 12, y: 7.3 });
    const rook = place(sim, { x: 6, y: 7 }, ROOK, 1);
    let lines = 0;
    const hpBefore = w.hero.hp;
    const events = play(rg, sim, ticksOf(3), x => x.hero.hp < hpBefore, () => { lines += rg.view.shown.rookLines; });
    assert(events.some(e => e.type === 'rook' && e.action === 'aim') && lines >= ticksOf(1.4), `seed ${k}: the line drew on ${lines} frames`);
    const shot = events.find(e => e.type === 'rook' && e.action === 'shot');
    assert(shot && shot.type === 'rook' && shot.plus === 'hero' && w.hero.hp === hpBefore - 2, `seed ${k}: the hero was struck (${w.hero.hp})`);
    assert(rg.view.shown.shots === 1 && rg.view.shown.aims === 1, `seed ${k}: counted`);
    // Sheltered: a new fight — a wardrobe between the rook and the hero.
    const sim2 = field(k), w2 = sim2.world, rg2 = rig();
    sim2.command({ t: 'teleport', x: 15, y: 7.1 });
    place(sim2, { x: 6, y: 7 }, ROOK, 1); place(sim2, { x: 9, y: 7 }, WARDROBE);
    const hp2 = w2.hero.hp, events2 = play(rg2, sim2, ticksOf(3.2));
    const shot2 = events2.find(e => e.type === 'rook' && e.action === 'shot');
    assert(shot2 && shot2.type === 'rook' && shot2.plus === 'thing' && w2.hero.hp === hp2, `seed ${k}: the wardrobe sheltered the hero (${shot2 && shot2.type === 'rook' ? shot2.plus : '-'})`);
    void rook;
  }
});

check('the names: «Падение шкафа» at the first windup, «Удар ладьи» at the first aim — once each in a fight; the bestiary lines of the two kinds', () => {
  const sim = field(1), w = sim.world, named = new Set<string>();
  sim.command({ t: 'teleport', x: 8.5, y: 7 });
  place(sim, { x: 11, y: 7 }, WARDROBE); place(sim, { x: 5, y: 7.2 }, ROOK, 2);
  const labels: string[] = [];
  for (let i = 0; i < ticksOf(14) && w.status === 'playing'; i++) { sim.tick(); for (const s of bossMoveLabels(w, named)) labels.push(s.text); w.events.length = 0; }
  assert(labels.filter(t => t === CASTLE_MOVE_TEXT.topple).length === 1 && labels.filter(t => t === CASTLE_MOVE_TEXT.strike).length === 1, `labels ${labels}`);
  assert(CASTLE_MOVE_TEXT.topple === 'Падение шкафа' && CASTLE_MOVE_TEXT.strike === 'Удар ладьи', 'the names');
  assert(KIND_CAPTIONS.wardrobe === 'Шкаф — кончи цепь на нём: толкнёшь' && KIND_CAPTIONS.rook === 'Ладья — бьёт по прямой первое тело' && !('barrel' in KIND_CAPTIONS), 'bestiary: the wardrobe and the rook; the barrel is no kind');
});

check("the shove's preview: a chain that ends on a thing — the plan's path, a cross per crushed body, the strike's mark, the ghost's notches, the break; a chain that ends on a body — nothing (4 seeds)", () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = field(k), w = sim.world, off = (k % 3) * 0.2;
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const link = place(sim, { x: 4.6, y: 7 }), barrel = place(sim, { x: 6.2, y: 7 }, BARREL);
    const weak = [place(sim, { x: 8.4, y: 7 }, 'basic', 1), place(sim, { x: 10.2, y: 7.2 + off }, 'basic', 2)];
    const tid = sim.command({ t: 'place', x: 12.6, y: 7, color: 1, hp: 3, kind: 'basic' }) as number;
    // A body alone in the chain: no shove, no preview.
    sim.command({ t: 'begin', x: link.x, y: link.y });
    let rg = rig();
    const say: string[] = [];
    frame(rg, sim, []);
    assert(!planChain(w).shove, `seed ${k}: a chain on a body has no shove`);
    assert(rg.view.shown.preview === 0, `seed ${k}: nothing drawn`);
    sim.command({ t: 'drag', x: barrel.x, y: barrel.y, mode: 'full' });
    const plan = planChain(w).shove!;
    assert(!!plan && plan.thing === barrel.id, `seed ${k}: the chain ends on the barrel`);
    rg = rig();
    rg.view.beginPreview();
    rg.view.drawPreview(rg.g, w, plan, 1, R, (text, x, y) => { say.push(`${text}@${Math.round(x)},${Math.round(y)}`); });
    const s = rg.view.shown;
    assert(s.preview === 1 && s.previewCrushed === plan.crushed.length && plan.crushed.length === weak.filter(e => Math.abs(e.y - 7) <= 0.64).length, `seed ${k}: a cross per crushed body (${s.previewCrushed} of ${plan.crushed.length})`);
    assert(plan.target === tid && plan.impact?.damage === 2 && s.previewImpact === 'hit' && say.some(t => t.startsWith('−2 HP')), `seed ${k}: the strike on the tough one, «−2 HP» (${say})`);
    assert(plan.breaks.includes(barrel.id) && s.previewBreaks === 1, `seed ${k}: the barrel breaks`);
    const b = rg.g.getLocalBounds();
    assert(b.maxX >= plan.to.x * U - 1 && b.minX <= (plan.from.x + 0.5) * U, `seed ${k}: the drawing spans the path (${b.minX.toFixed(0)}…${b.maxX.toFixed(0)} for ${(plan.from.x * U).toFixed(0)}…${(plan.to.x * U).toFixed(0)})`);
    // The same chain with no tough body and no wall in reach: a wardrobe slides to the end, a ghost with its notches, no strike.
  }
  const sim = field(1), w = sim.world;
  sim.command({ t: 'teleport', x: 3, y: 7 });
  const link = place(sim, { x: 4.6, y: 7 }), wr = place(sim, { x: 6.2, y: 7 }, WARDROBE);
  sim.command({ t: 'begin', x: link.x, y: link.y });
  sim.command({ t: 'drag', x: wr.x, y: wr.y, mode: 'full' });
  const plan = planChain(w).shove!, rg = rig(), say: string[] = [];
  rg.view.drawPreview(rg.g, w, plan, 1, R, t => { say.push(t); });
  assert(plan.stop === 'end' && !plan.impact && rg.view.shown.previewImpact === '' && rg.view.shown.previewNotches === 2 && rg.view.shown.previewBreaks === 0 && say.length === 0, 'a wardrobe slides to the end: the ghost keeps 2 notches, no strike, no break');
});

check("the first barrel's label: over the barrel in view, only with a barrel; the text is the design's", () => {
  const sim = field(1), w = sim.world;
  assert(barrelLabel(w, () => true) === null, 'no barrel — no label');
  const barrel = place(sim, { x: 14, y: 7 }, BARREL);
  const spec = barrelLabel(w, () => true);
  assert(spec?.text === BARREL_LABEL_TEXT && BARREL_LABEL_TEXT === 'Кончи цепь на бочке — покатится' && spec.at.x === barrel.x && spec.at.y === barrel.y, 'the label stands over the barrel');
  assert(barrelLabel(w, () => false) === null, 'not in view — none');
});

console.log(`${checks} checks passed`);
