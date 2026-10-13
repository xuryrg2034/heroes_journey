/**
 * The prologue's view logic (view/prologueFlow.ts), Node only: `npm run test:realtime-prologue-view`. The key store, the ghost
 * hand's state machine on a fake probe (4 s of rest, a press, the arrow and the circle, the hand at once at the circle, walking),
 * the hand's picture over a route, the lamps' places, the labels on real rooms (the first link, the 5th link and the shift, the
 * first pull), the goal lines, the seeds. The end-to-end result is tests/realtime-prologue.spec.ts.
 */
import type { Vec } from '../sim/geometry';
import { Simulation } from '../sim/simulation';
import type { ChainLink } from '../sim/world';
import { PROLOGUE_ROOMS, prologueJumpAim, prologueLoadout, prologueParams, prologueRoute, startEnemyIds } from '../run/prologue';
import {
  HAND_ASK, HAND_IDLE, HandGuide, PROLOGUE_KEY, PROLOGUE_ROOM_COUNT, PrologueStore, SHIELD_HAND_IDLE, handCycle, handFrame, lampPoints, prologueGoalLine, prologueLabel, prologueSeed, roomTitle,
  type PrologueLabelMemo, type PrologueStorage,
} from './prologueFlow';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

const memory = (): { data: Map<string, string>; storage: PrologueStorage } => {
  const data = new Map<string, string>();
  return { data, storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } } };
};

check('the key: a fresh viewer has not passed it; marking survives a reload; clearing starts over; a throwing storage never traps the viewer', () => {
  const { data, storage } = memory();
  const a = new PrologueStore(storage);
  assert(!a.done(), 'fresh');
  a.markDone();
  assert(data.get(PROLOGUE_KEY) === '1' && new PrologueStore(storage).done(), 'kept');
  a.clear();
  assert(!new PrologueStore(storage).done(), 'cleared');
  const broken = new PrologueStore({ getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } });
  assert(!broken.done(), 'unreadable — not done');
  broken.markDone(); broken.clear();
  assert(!new PrologueStore(null).done(), 'no storage');
});

const LINK: ChainLink = { kind: 'enemy', id: 1 };
/** A fake probe: the route and the spot are what the test sets; the calls are counted. */
function fake(): { route: ChainLink[]; spot: Vec | null; routeCalls: number; spotCalls: number; guide: HandGuide; shown: string[] } {
  const f = { route: [] as ChainLink[], spot: null as Vec | null, routeCalls: 0, spotCalls: 0, shown: [] as string[], guide: null as unknown as HandGuide };
  f.guide = new HandGuide({ route: () => { f.routeCalls++; return f.route; }, spot: () => { f.spotCalls++; return f.spot; } }, kind => f.shown.push(kind));
  return f;
}
/** Reads through functions: the guide changes between reads, TypeScript must not narrow its fields. */
const showOf = (g: HandGuide): string => g.show;
const lenOf = (g: HandGuide): number => g.route.length;
const circleX = (g: HandGuide): number | undefined => g.circle?.x;
const run = (g: HandGuide, seconds: number, walking = false, busy = false, step = 1 / 60): void => { for (let t = 0; t < seconds - 1e-9; t += step) g.update(step, walking, busy); };

check('room 9 «Щит» (task 13): the hand after SHIELD_HAND_IDLE (1.5 s) of rest, not 4 s; a press starts the 1.5 s again', () => {
  const route = [LINK];
  const g = new HandGuide({ route: () => route, spot: () => null }, undefined, SHIELD_HAND_IDLE);
  assert(SHIELD_HAND_IDLE === 1.5, '1.5 s');
  run(g, SHIELD_HAND_IDLE - 0.1);
  assert(showOf(g) === 'none', 'not yet');
  run(g, 0.2);
  assert(showOf(g) === 'hand', 'the hand at 1.5 s');
  g.press();
  run(g, 1.3);
  assert(showOf(g) === 'none', 'rest counts again from the press');
  run(g, 0.3);
  assert(showOf(g) === 'hand', 'back after 1.5 s of rest');
});

check('the hand: after 4 s of rest with a chain from here; not before; a press takes it away and the 4 s start again', () => {
  const f = fake();
  f.route = [LINK];
  run(f.guide, HAND_IDLE - 0.1);
  assert(showOf(f.guide) === 'none', 'not yet');
  run(f.guide, 0.2);
  assert(showOf(f.guide) === 'hand' && lenOf(f.guide) === 1 && f.shown.join() === 'hand', 'the hand at 4 s');
  f.guide.press();
  assert(showOf(f.guide) === 'none' && lenOf(f.guide) === 0, 'a press takes it away');
  run(f.guide, 3.5);
  assert(showOf(f.guide) === 'none', 'rest counts again from the press');
  run(f.guide, 0.7);
  assert(showOf(f.guide) === 'hand', 'back after 4 s of rest');
});

check('the hand: a chain drawn or a move going counts as a press every frame; walking resets the rest and hides the hand', () => {
  const f = fake();
  f.route = [LINK];
  run(f.guide, 3, false, true);
  assert(f.guide.rest === 0, 'busy: no rest');
  run(f.guide, 3.9, true);
  assert(showOf(f.guide) === 'none' && f.guide.rest === 0, 'walking: no rest');
  run(f.guide, 4.1);
  assert(showOf(f.guide) === 'hand', 'rest after walking');
  run(f.guide, 0.1, true);
  assert(showOf(f.guide) === 'none', 'a walk key takes an ordinary hand away');
});

check('the arrow: no chain from here — after 4 s the circle and the arrow; null spot — nothing, asked again; walking hides the arrow (the circle stays), rest brings it back', () => {
  const f = fake();
  run(f.guide, HAND_IDLE + 0.3);
  assert(showOf(f.guide) === 'none' && f.guide.circle === null && f.spotCalls >= 1, 'no spot: nothing');
  const calls = f.spotCalls;
  run(f.guide, 1);
  assert(f.spotCalls > calls, 'asked again');
  f.spot = { x: 5, y: 4 };
  run(f.guide, HAND_ASK + 0.05);
  assert(showOf(f.guide) === 'arrow' && f.guide.arrow && circleX(f.guide) === 5 && f.shown.join() === 'arrow', 'the arrow and the circle');
  run(f.guide, 0.5, true);
  assert(!f.guide.arrow && f.guide.circle !== null, 'walking: no arrow, the circle stays');
  run(f.guide, HAND_IDLE + 0.1);
  assert(f.guide.arrow, 'the arrow again after 4 s');
  f.spot = { x: 9, y: 9 };
  run(f.guide, 1);
  assert(circleX(f.guide) === 5, 'the circle stays where it was set');
});

check('the circle reached: the hand at once, no new 4 s, the circle gone; it stays through walking until a press', () => {
  const f = fake();
  f.spot = { x: 5, y: 4 };
  run(f.guide, HAND_IDLE + 0.3);
  assert(f.guide.arrow, 'arrow');
  f.route = [LINK];
  run(f.guide, 0.5, true);
  assert(showOf(f.guide) === 'hand' && f.guide.circle === null && !f.guide.arrow, 'the hand at once, while walking');
  run(f.guide, 1, true);
  assert(showOf(f.guide) === 'hand', 'through walking');
  f.guide.press();
  assert(showOf(f.guide) === 'none', 'a press');
  // The hand goes when the chain from here is gone (the enemies moved), and the arrow may follow at once.
  const g = fake();
  g.route = [LINK];
  run(g.guide, HAND_IDLE + 0.3);
  assert(showOf(g.guide) === 'hand', 'hand');
  g.route = []; g.spot = { x: 2, y: 2 };
  run(g.guide, 0.6);
  assert(showOf(g.guide) === 'arrow', 'chain gone: the arrow');
});

check('the hand draws: it presses on the first link, passes each in order, holds at the end, fades and loops; the picture only reads points', () => {
  const pts: Vec[] = [{ x: 0, y: 0 }, { x: 1.5, y: 0 }, { x: 1.5, y: 1.5 }];
  const cycle = handCycle(pts);
  const f0 = handFrame(pts, 0.1);
  assert(f0.pressed && f0.pos.x === 0 && f0.links === 1, 'press on the first');
  let reached = 0, lastLinks = 0;
  for (let t = 0; t < cycle; t += 0.02) {
    const f = handFrame(pts, t);
    assert(f.links >= lastLinks || t > cycle - 1.3, 'the links passed only grow in the way');
    lastLinks = f.links; reached = Math.max(reached, f.links);
    assert(f.alpha >= 0 && f.alpha <= 1 && f.trail[0].x === 0, 'alpha, trail from the first');
  }
  assert(reached === 3, 'all links passed');
  const end = handFrame(pts, cycle - 1.0);
  assert(end.pos.x === 1.5 && end.pos.y === 1.5, 'held at the last');
  assert(handFrame(pts, cycle - 0.01).alpha < 0.1 && handFrame(pts, cycle + 0.1).pressed, 'faded, then the loop');
  assert(handFrame([{ x: 2, y: 2 }], 1).pos.x === 2, 'a one-link route');
});

check('the lamps: N on an arc on the arena side of the door, each inside the arena, one lamp on the axis, 15 spaced apart', () => {
  for (const room of PROLOGUE_ROOMS) {
    const door = room.arena.door, total = room.arena.goal === 'kills' || room.arena.goal === 'chain' || room.arena.goal === 'strike' ? (room.arena.killGoal ?? 1) : 1;
    const pts = lampPoints(door, room.arena, total);
    assert(pts.length === total, `room ${room.number}: ${total} lamps`);
    for (const p of pts) assert(p.x > 0.2 && p.x < room.arena.width - 0.2 && p.y > 0.2 && p.y < room.arena.height - 0.2, `room ${room.number}: inside the arena (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
    for (let i = 1; i < pts.length; i++) assert(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) > 0.25, `room ${room.number}: spaced`);
  }
  assert(lampPoints({ x: 10, y: 4 }, { width: 12, height: 8 }, 0).length === 0, 'none');
  const one = lampPoints({ x: 10, y: 4 }, { width: 12, height: 8 }, 1)[0];
  assert(one.x < 10 && Math.abs(one.y - 4) < 1e-6, 'one lamp towards the middle');
});

check('room 10 «Толпа»: the lamps keep off the goblin, its lever and its odds line («безопасно: 3» over the idol, the knob at its right, the reels over it)', () => {
  const room6 = PROLOGUE_ROOMS.find(r => r.id === 'prologue-6')!.arena, g = room6.goblin!;
  // The idol with its lever and the text over it: x ±1.5 units, from 1.8 up to 0.8 down (the knob 1.07 radii right, 1.15 up; the odds line and reels over the head).
  const box = { x0: g.x - 1.5, x1: g.x + 1.5, y0: g.y - 1.8, y1: g.y + 0.8 };
  const pts = lampPoints(room6.door, room6, 15), lampRadius = 14 / 72;
  assert(pts.length === 15, '15 lamps');
  for (const p of pts) assert(p.x + lampRadius < box.x0 || p.x - lampRadius > box.x1 || p.y + lampRadius < box.y0 || p.y - lampRadius > box.y1, `a lamp at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is clear of the goblin box`);
  // And off the enemies the room starts with and the hero.
  for (const e of room6.enemies) for (const p of pts) assert(Math.hypot(p.x - e.x, p.y - e.y) > 0.7, 'a lamp is clear of a start enemy');
  assert(pts.every(p => Math.hypot(p.x - room6.heroStart.x, p.y - room6.heroStart.y) > 1.5), 'clear of the hero');
});

const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const room = (n: number, k = 1): Simulation => new Simulation({ arena: PROLOGUE_ROOMS[n - 1].id, params: prologueParams(n), seed: seedOf(k), record: true, ...prologueLoadout(n) ? { loadout: prologueLoadout(n) } : {} });
const draw = (sim: Simulation, links: ChainLink[]): void => {
  const w = sim.world;
  const p = (l: ChainLink) => l.kind === 'enemy' ? w.enemies.find(e => e.id === l.id)! : w.objects.find(o => o.id === l.id)!;
  sim.command({ t: 'begin', x: p(links[0]).x, y: p(links[0]).y });
  for (let i = 1; i < links.length; i++) sim.command({ t: 'drag', x: p(links[i]).x, y: p(links[i]).y, mode: 'full' });
};

check('labels: room 1 at the nearest enemy until the first link; room 4 from the 5th link at the 6th blue until the shift (and not again after it); room 8 «Гоблин» at the lever until the first pull; none elsewhere (task 9 rooms 5–7 too)', () => {
  const sim1 = room(1), w1 = sim1.world, memo1: PrologueLabelMemo = { done: false };
  const l1 = prologueLabel(w1, 1, memo1);
  assert(l1 && l1.text === 'Зажми и веди' && l1.id === 'pl1', 'room 1 label');
  const near = startEnemyIds(w1).map(id => w1.enemies.find(e => e.id === id)!).sort((a, b) => Math.hypot(a.x - w1.hero.x, a.y - w1.hero.y) - Math.hypot(b.x - w1.hero.x, b.y - w1.hero.y))[0];
  assert(l1.at.x === near.x && l1.at.y === near.y, 'at the nearest enemy');
  draw(sim1, prologueRoute(w1, 1).slice(0, 1));
  assert(prologueLabel(w1, 1, memo1) === null && memo1.done, 'gone with the first link');
  sim1.command({ t: 'cancel' });
  assert(prologueLabel(w1, 1, memo1) === null, 'and does not come back');

  const sim4 = room(4), w4 = sim4.world, memo4: PrologueLabelMemo = { done: false };
  const route4 = prologueRoute(w4, 4);
  assert(prologueLabel(w4, 4, memo4) === null, 'room 4: none at the start');
  draw(sim4, route4.slice(0, 4));
  assert(prologueLabel(w4, 4, memo4) === null, 'room 4: none at 4 links');
  sim4.command({ t: 'cancel' });
  draw(sim4, route4.slice(0, 5));
  const l4 = prologueLabel(w4, 4, memo4);
  const sixth = w4.enemies.find(e => e.id === startEnemyIds(w4)[5])!;
  assert(l4 && l4.text === 'Цвет свободен' && l4.at.x === sixth.x && l4.at.y === sixth.y, 'room 4: at the 6th blue from the 5th link');
  sim4.command({ t: 'cancel' });
  draw(sim4, route4.slice(0, 6));
  assert(prologueLabel(w4, 4, memo4) === null && memo4.done, 'room 4: gone with the shift');
  sim4.command({ t: 'cancel' });
  draw(sim4, route4.slice(0, 5));
  assert(prologueLabel(w4, 4, memo4) === null, 'room 4: not again');

  const sim5 = room(8), w5 = sim5.world, memo5: PrologueLabelMemo = { done: false };
  const l5 = prologueLabel(w5, 8, memo5);
  assert(l5 && l5.text === 'Закончи цепь здесь' && l5.place === 'side', 'room 8: at the lever');
  w5.slot!.goblin!.pulls = 1;
  assert(prologueLabel(w5, 8, memo5) === null && memo5.done, 'room 8: gone with the first pull');
  for (const n of [2, 3, 5, 6, 7, 9, 10]) assert(prologueLabel(room(n).world, n, { done: false }) === null, `room ${n}: no label`);
  assert([...['Зажми и веди', 'Цвет свободен', 'Закончи цепь здесь']].every(t => t.split(' ').length <= 3), '≤ 3 words');
});

check('goal lines, titles, seeds', () => {
  assert(prologueGoalLine(room(1).world) === 'Убей: 0 / 3', 'room 1');
  assert(prologueGoalLine(room(2).world) === 'Одной цепью: 0 / 5', 'room 2');
  assert(prologueGoalLine(room(3).world) === 'Крепкий: 0 / 1', 'room 3');
  assert(prologueGoalLine(room(5).world) === 'Дверь: 0 / 1', 'room 5 «Пропасть»');
  assert(prologueGoalLine(room(6).world) === 'Одним ударом: 0 / 6', 'room 6 «Вихрь»');
  assert(prologueGoalLine(room(7).world) === 'Зелье: 0 / 1', 'room 7 «Зелье»');
  assert(prologueGoalLine(room(8).world) === 'Рычаг: 0 / 1', 'room 8');
  assert(prologueGoalLine(room(9).world) === 'Щит: 0 / 3', 'room 9 «Щит» (task 13)');
  assert(prologueGoalLine(room(10).world) === 'Убей: 0 / 15', 'room 10');
  assert(PROLOGUE_ROOM_COUNT === 10, 'ten rooms (task 13)');
  assert(roomTitle(1) === '1/10 · Тропа' && roomTitle(5) === '5/10 · Пропасть' && roomTitle(9) === '9/10 · Щит' && roomTitle(10) === '10/10 · Толпа', 'titles');
  assert(prologueSeed(1, 1) === prologueSeed(1, 1) && prologueSeed(5, 1) !== prologueSeed(5, 2) && prologueSeed(5, 1) !== prologueSeed(6, 1), 'seeds differ by room and attempt');
  assert(prologueSeed(2, 1, 7) !== prologueSeed(2, 1), 'a fixed page seed shifts them');
});

check('room 5 «Пропасть»: the guide shows the arrow to the cliff edge, then (the hero at the edge) the hand clicks beyond the cliff', () => {
  const sim = room(5), w = sim.world, n = 5;
  const guide = new HandGuide({ route: () => [], spot: () => prologueJumpAim(w, n)?.spot ?? null, aim: () => { const a = prologueJumpAim(w, n); return a?.ready ? a.target : null; } });
  const aim0 = prologueJumpAim(w, n)!;
  assert(aim0 && !aim0.ready, 'from the start the jump does not reach the far bank');
  guide.update(HAND_IDLE + 0.01, false, false);
  assert(guide.show === 'arrow' && guide.circle && guide.circle.x === aim0.spot.x, `the arrow to the spot (${guide.show})`);
  sim.command({ t: 'teleport', x: aim0.spot.x, y: aim0.spot.y });
  guide.update(HAND_ASK + 0.01, false, false);
  const aim1 = prologueJumpAim(w, n)!;
  assert(aim1.ready, 'at the edge the jump is ready');
  assert((guide.show as string) === 'hand' && guide.target && guide.target.x === aim1.target.x && guide.route.length === 0, `the hand clicks the target (${guide.show})`);
  // The click is a press and a release on one point (handFrame of one point).
  const f = handFrame([guide.target!], 0.1);
  assert(f.pressed && f.pos.x === aim1.target.x && f.links === 1, 'the hand presses on the target');
  // Space (the jump aim on) is a press: the hand goes.
  guide.update(0.016, false, true);
  assert((guide.show as string) === 'none' && guide.target === null, 'a press takes the hand away');
});

console.log('prologue view: all checks passed');
