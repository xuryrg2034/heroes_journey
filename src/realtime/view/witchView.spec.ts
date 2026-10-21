/**
 * Task 62 «Ведунья v2», stage A, the view (view/witchView.ts, view/camera.ts `hold`; docs/design-notes/task-62-witch-v2.md, 2.1–2.3, 3.1, 3.7;
 * design decisions 21.10.2026). Node only: `npm run test:realtime-witch-view`. The view is driven against a real world (journalled commands with
 * `Loadout.hero` 'toad' and `witchV2`: place, begin / drag, teleport, release) and writes to real PixiJS `Graphics` and `Text` without a
 * renderer; nothing here counts a rule — the answers are the sim's (`loopKindAt`, `loopRefusal`, `planChain`, the `chainHit` events). What the player
 * sees by real mouse input — tests/realtime-witch.spec.ts.
 * - the runes: a dot at the point each enemy link was taken; the line to the body only after the body left its point farther than its radius;
 * - the first rune: a dim ring once the contour has 3 runes; bright, with the dashed contour and the word «Кольцо», while the pointer is on it and
 *   the sim lets the ring close; a square of 4 — the same contour grey, no word (the reason is the pointer's old hint, `hoverRefusal`);
 * - «Показать фигуру»: the class word at the centre of any contour of runes («Квадрат», «Треугольник», «Кольцо», or the refusal's old text);
 * - the discharge: the thread is laid along the runes and one white flash per body the sim struck, one after another; a link that left the circle
 *   before the release has no strike and so no flash;
 * - the camera hold glides to the hero in about 0.2 s with no lead, no dead zone and no overshoot.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Container, Graphics } from 'pixi.js';
import { registerArena } from '../sim/arenas';
import { hoverRefusal, inCast, planChain, REFUSAL_TEXT } from '../sim/chain';
import { wall, type Vec } from '../sim/geometry';
import type { Loadout } from '../sim/kit';
import { defaultParams, type Params } from '../sim/params';
import { Simulation } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { Camera, CAMERA } from './camera';
import { CAST_STEP, GLYPH_WORD, WitchView, glyphCaption, polylinePrefix, type WitchShown } from './witchView';

// Node's file system, loaded by name: the project's typecheck has no Node types under src/ (the spec runs in Node only).
const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);
const { readFileSync } = await nodeModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string };

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const U = 72;
/** A copy of what the view drew (the assertions read it fresh each time). */
const kids = (c: Container): number => c.children.length;
const sh = (v: WitchView): WitchShown => ({ ...v.shown });

registerArena({
  id: 'witch-view-field', name: 'Поле Ведуньи (вид)', summary: 'Тест вида Ведуньи v2', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 5, y: 6 }, obstacles: [wall(14, 3, 0.5, 6)], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 99,
});

function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false; p.enemySpeed = 0;
  p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false; p.finisher = false; p.witchV2 = true;
  return Object.assign(p, extra);
}
const TOAD: Loadout = { hero: 'toad' };
function fight(params: Params = quiet(), k = 1): { sim: Simulation; w: World } {
  const sim = new Simulation({ arena: 'witch-view-field', params, seed: seedOf(k), record: true, loadout: TOAD });
  sim.command({ t: 'clear', keepMarked: false });
  return { sim, w: sim.world };
}
const place = (sim: Simulation, at: Vec, hp = 0, color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind: 'basic' }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** A regular pentagon of radius 1.3 round (10, 6) (no body overlaps), the first corner on top. */
const PENTAGON: readonly Vec[] = [{ x: 10, y: 7.3 }, { x: 8.764, y: 6.402 }, { x: 9.236, y: 4.948 }, { x: 10.764, y: 4.948 }, { x: 11.236, y: 6.402 }];
const SQUARE: readonly Vec[] = [{ x: 9.2, y: 5.2 }, { x: 10.8, y: 5.2 }, { x: 10.8, y: 6.8 }, { x: 9.2, y: 6.8 }];

/** One frame of the highlight the way the renderer calls it. */
function highlight(view: WitchView, w: World, pointer: Vec | null): Graphics {
  const g = new Graphics();
  view.draw(g, w, planChain(w), 0xff5050, pointer);
  return g;
}
const newView = (): { view: WitchView; labels: Container; fx: Container } => {
  const labels = new Container(), fx = new Container();
  return { view: new WitchView(U, labels, fx), labels, fx };
};

check('polylinePrefix lays a thread to a length; the class words are the figures\' and the refusals\' old texts', () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert(polylinePrefix(line, 5).length === 2 && polylinePrefix(line, 5)[1].x === 5, 'half of the first stretch');
  const part = polylinePrefix(line, 15);
  assert(part.length === 3 && part[2].x === 10 && part[2].y === 5, 'into the second stretch');
  assert(polylinePrefix(line, 99).length === 3, 'the whole line');
  assert(glyphCaption({ kind: 'ring', corners: [] }) === 'Кольцо' && glyphCaption({ kind: 'square', corners: [] }) === 'Квадрат' && glyphCaption({ kind: 'triangle', corners: [] }) === 'Треугольник', 'the figures');
  assert(glyphCaption({ refusal: 'notFigure' }) === REFUSAL_TEXT.notFigure && glyphCaption({ refusal: 'small' }) === 'мала' && glyphCaption({ refusal: 'crossed' }) === 'нить пересеклась', 'the refusals');
  assert(Object.values(GLYPH_WORD).every(w => w.length > 0 && !w.includes(' ')), 'one word each');
});

check('the camera hold: about 63 % of the way in 0.2 s, no overshoot, lands on the hero; it ignores the pointer; a pause (dt 0) only clamps', () => {
  const b = { viewW: 16, viewH: 10, arenaW: 30, arenaH: 20 };
  const cam = new Camera();
  cam.x = 8; cam.y = 8;
  const hero = { x: 14, y: 12 };
  for (let i = 0; i < 12; i++) cam.hold(1 / 60, hero, b);
  const k = (cam.x - 8) / (hero.x - 8);
  assert(Math.abs(k - (1 - Math.exp(-0.2 / CAMERA.hold))) < 1e-9, `0.2 s: ${k}`);
  assert(CAMERA.hold >= 0.15 && CAMERA.hold <= 0.25, 'about 0.2 s');
  let last = cam.x;
  for (let i = 0; i < 240; i++) { cam.hold(1 / 60, hero, b); assert(cam.x >= last - 1e-12 && cam.x <= hero.x + 1e-9, 'no overshoot'); last = cam.x; }
  assert(Math.abs(cam.x - hero.x) < 1e-3 && Math.abs(cam.y - hero.y) < 1e-3, 'on the hero');
  const still = new Camera();
  still.x = 8; still.y = 8;
  still.hold(0, hero, b);
  assert(still.x === 8 && still.y === 8, 'a pause moves nothing');
  const edge = new Camera();
  edge.hold(1, { x: 1, y: 1 }, b);
  for (let i = 0; i < 300; i++) edge.hold(1 / 60, { x: 1, y: 1 }, b);
  assert(Math.abs(edge.x - 8) < 1e-3 && Math.abs(edge.y - 5) < 1e-3, 'at the arena\'s edge the view stays inside it');
});

check('runes: a dot per enemy link at the point it was taken; the line to the body only after the body left its point by more than its radius', () => {
  const { view } = newView();
  const f = fight(quiet({ enemySpeed: 1.2 }));
  f.sim.command({ t: 'teleport', x: 10, y: 6 });
  const es = PENTAGON.map(p => place(f.sim, p));
  draw(f.sim, PENTAGON);
  assert(f.w.chain.length === 5, 'five links');
  highlight(view, f.w, null);
  assert(sh(view).runes === 5 && sh(view).ties === 0, `bodies on their points: ${sh(view).runes} runes, ${sh(view).ties} lines`);
  for (let i = 0; i < 60; i++) f.sim.tick();
  const moved = es.filter(e => Math.hypot(e.x - f.w.chain.find(l => l.id === e.id)!.rune!.x, e.y - f.w.chain.find(l => l.id === e.id)!.rune!.y) > 0.4).length;
  assert(moved > 0, 'the enemies walked off their points');
  highlight(view, f.w, null);
  assert(sh(view).runes === 5 && sh(view).ties === moved, `${sh(view).ties} lines for ${moved} bodies that left their points`);
});

check('muting: a body out of the circle and one behind a wall are out of the cast, one in the circle is in (the renderer mutes by inCast)', () => {
  const f = fight();
  f.sim.command({ t: 'teleport', x: 12.4, y: 6 });
  const inside = place(f.sim, { x: 11, y: 6 }), outside = place(f.sim, { x: 12.4, y: 10.5 }), behind = place(f.sim, { x: 15.2, y: 6 });
  assert(inCast(f.w, inside), 'in the circle: not muted');
  assert(!inCast(f.w, outside), 'out of the circle: muted');
  assert(!inCast(f.w, behind), 'inside the circle but behind the wall: muted');
  const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
  assert(source.includes('view.root.visible && !inCast(world, e)'), 'the renderer asks inCast');
});

check('layers: the circle of casting is floor marking — under the bodies, the runes and the thread (the order of the layers of the root in render.ts)', () => {
  const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
  const line = source.split(String.fromCharCode(10)).find(l => l.includes("this.root.addChild(this.staticLayer"))!;
  const at = (name: string): number => line.indexOf(`this.${name},`);
  assert(at('castLayer') > 0 && at('castLayer') < at('enemyLayer') && at('enemyLayer') < at('chainLayer'), 'castLayer < enemyLayer < chainLayer');
  assert(at('castLayer') < at('eliteLayer') && at('castLayer') < at('fxLayer'), 'under the elites and the effects');
});

check('the first rune: dim ring from 3 runes; the pointer on it with a ring that can close — bright, the dashed contour and «Кольцо»; elsewhere — dim, no contour', () => {
  const { view, labels } = newView();
  const f = fight();
  f.sim.command({ t: 'teleport', x: 10, y: 6 });
  PENTAGON.forEach(p => place(f.sim, p));
  f.sim.command({ t: 'begin', x: PENTAGON[0].x, y: PENTAGON[0].y });
  f.sim.command({ t: 'drag', x: PENTAGON[1].x, y: PENTAGON[1].y, mode: 'full' });
  highlight(view, f.w, PENTAGON[0]);
  assert(sh(view).firstRing === 0 && sh(view).contour === '', 'two runes: no contour yet, no ring');
  for (const p of PENTAGON.slice(2)) f.sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  highlight(view, f.w, { x: 10, y: 3 });
  assert(sh(view).firstRing === 1 && sh(view).contour === '' && sh(view).word === '', 'five runes, the pointer elsewhere: the dim ring only');
  highlight(view, f.w, PENTAGON[0]);
  assert(sh(view).firstRing === 2 && sh(view).contour === 'figure' && sh(view).word === 'Кольцо', `on the first rune: ${JSON.stringify(sh(view))}`);
  assert(hoverRefusal(f.w, PENTAGON[0], true) === null, 'the sim agrees: it closes');
  assert(labels.children.some(c => 'text' in c && (c as { text: string }).text === 'Кольцо' && c.visible), 'the word is on the screen');
  f.sim.command({ t: 'drag', x: PENTAGON[0].x, y: PENTAGON[0].y, mode: 'full' });
  assert(f.w.chainClosed === 'first', 'the pointer event on the first rune closes the ring');
  highlight(view, f.w, PENTAGON[0]);
  assert(sh(view).word === 'Кольцо' && sh(view).contour === 'figure' && sh(view).contourInk === 0xff5050 && sh(view).firstRing === 2, 'closed: the word, the lit ring and the dashed contour in the chain colour');
  assert(planChain(f.w).seal !== undefined && planChain(f.w).seal!.ring.length === 5, 'the seal prognosis (the marks of the bodies inside) is the plan, drawn by the loop view');
});

check('a square of 4: the same contour grey at the pointer, no word, and the sim\'s old reason «не фигура» is the hint', () => {
  const { view } = newView();
  const f = fight();
  f.sim.command({ t: 'teleport', x: 10, y: 6 });
  SQUARE.forEach(p => place(f.sim, p));
  draw(f.sim, SQUARE);
  highlight(view, f.w, SQUARE[0]);
  assert(sh(view).contour === 'refused' && sh(view).contourInk === 0x8c93a0 && sh(view).word === '' && sh(view).firstRing === 1, `${JSON.stringify(sh(view))}`);
  assert(hoverRefusal(f.w, SQUARE[0], true) === 'notFigure', 'the pointer\'s hint');
  f.sim.command({ t: 'drag', x: SQUARE[0].x, y: SQUARE[0].y, mode: 'full' });
  assert(f.w.chainClosed === undefined, 'the sim refused the closing');
});

check('«Показать фигуру»: the class word at the contour\'s centre for any contour — a square and a triangle too; off — none', () => {
  const { view, labels } = newView();
  const f = fight();
  f.sim.command({ t: 'teleport', x: 10, y: 6 });
  SQUARE.forEach(p => place(f.sim, p));
  draw(f.sim, SQUARE);
  highlight(view, f.w, null);
  assert(sh(view).classWord === '', 'off by default');
  view.showFigure = true;
  highlight(view, f.w, null);
  assert(sh(view).classWord === 'Квадрат', `the square: ${sh(view).classWord}`);
  const shown = labels.children.filter(c => c.visible && 'text' in c).map(c => (c as unknown as { text: string }).text);
  assert(shown.includes('Квадрат'), 'on the screen');
  const g = fight(quiet(), 2);
  g.sim.command({ t: 'teleport', x: 10, y: 6 });
  const tri: Vec[] = [{ x: 10, y: 4.6 }, { x: 11.6, y: 7.2 }, { x: 8.4, y: 7.2 }];
  tri.forEach(p => place(g.sim, p));
  draw(g.sim, tri);
  highlight(view, g.w, null);
  assert(sh(view).classWord === 'Треугольник', `the triangle: ${sh(view).classWord}`);
  const h = fight(quiet(), 3);
  h.sim.command({ t: 'teleport', x: 10, y: 6 });
  PENTAGON.forEach(p => place(h.sim, p));
  draw(h.sim, PENTAGON);
  highlight(view, h.w, null);
  assert(sh(view).classWord === 'Кольцо', `the ring: ${sh(view).classWord}`);
  const none = fight(quiet(), 4);
  none.sim.command({ t: 'teleport', x: 10, y: 6 });
  place(none.sim, { x: 10, y: 6.5 }); place(none.sim, { x: 11.2, y: 6.5 });
  draw(none.sim, [{ x: 10, y: 6.5 }, { x: 11.2, y: 6.5 }]);
  highlight(view, none.w, null);
  assert(sh(view).classWord === '', 'two runes: no contour, no word');
});

check('the discharge: the thread is laid along the runes, one flash per struck body in order with a small step; a link out of the circle gets none', () => {
  const { view, fx } = newView();
  const f = fight();
  f.sim.command({ t: 'teleport', x: 10, y: 6 });
  const es = PENTAGON.map(p => place(f.sim, p));
  draw(f.sim, PENTAGON);
  assert(f.w.chain.length === 5, 'five links');
  // The hero is carried off while the chain is in her hand (a test command): the first link is out of her circle at the release.
  f.sim.command({ t: 'teleport', x: 10, y: 6 + 3.3 });
  view.capture(f.w, 0xff5050);
  assert(f.sim.command({ t: 'release' }) === true, 'released');
  const events: WorldEvent[] = f.w.events.splice(0);
  const hits = events.filter((e): e is Extract<WorldEvent, { type: 'chainHit' }> => e.type === 'chainHit');
  assert(hits.length > 0 && hits.length < 5, `some links were struck, some left the circle: ${hits.length}`);
  f.w.events.push(...events);
  view.onEvents(f.w);
  assert(sh(view).casts === 1 && sh(view).running === 1, 'one discharge running');
  assert(kids(fx) === 1, 'the thread');
  view.update(CAST_STEP * 0.5);
  assert(sh(view).flashes === 1, `the first flash starts at once, the next ones one step later: ${sh(view).flashes}`);
  for (let i = 0; i < hits.length + 2; i++) view.update(CAST_STEP);
  assert(sh(view).flashes === hits.length, `one flash per struck body, none for the skipped: ${sh(view).flashes} of ${hits.length}`);
  const struck = new Set(hits.map(h => h.enemyId));
  assert(es.some(e => !struck.has(e.id)), 'a body was skipped by the sim');
  for (let i = 0; i < 200; i++) view.update(1 / 60);
  assert(sh(view).running === 0 && kids(fx) === 0, 'the discharge fades out and leaves nothing');
});

check('a release the sim refused, or a cat\'s dash, starts no discharge; a new fight clears the running ones', () => {
  const { view, fx } = newView();
  const f = fight();
  f.sim.command({ t: 'teleport', x: 10, y: 6 });
  place(f.sim, PENTAGON[0]);
  draw(f.sim, [PENTAGON[0]]);
  view.capture(f.w, 0xffffff);
  view.drop();
  f.w.events.push({ type: 'chainEnd', kills: 0, score: 0 });
  view.onEvents(f.w);
  assert(sh(view).casts === 0 && kids(fx) === 0, 'nothing pending: no discharge');
  view.capture(f.w, 0xffffff);
  f.sim.command({ t: 'release' });
  view.onEvents(f.w);
  assert(sh(view).casts === 1, 'one');
  view.reset();
  assert(sh(view).running === 0 && kids(fx) === 0, 'reset');
  const cat = new Simulation({ arena: 'witch-view-field', params: quiet(), seed: seedOf(1), loadout: {} });
  cat.command({ t: 'clear', keepMarked: false });
  cat.command({ t: 'teleport', x: 10, y: 6 });
  place(cat, PENTAGON[0]);
  cat.command({ t: 'begin', x: PENTAGON[0].x, y: PENTAGON[0].y });
  view.capture(cat.world, 0xffffff);
  cat.command({ t: 'release' });
  view.onEvents(cat.world);
  assert(sh(view).casts === 1, 'the cat\'s release is not noted (still the one of before)');
});

console.log('witch view: done');
