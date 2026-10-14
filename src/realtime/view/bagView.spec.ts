/**
 * Task 14 «Котомка у двери», the view (view/bagView.ts): the number over the sack, the three marks, the arc of the step being
 * filled, the result line and the sack's place by the door — read from the sim's own `bagProgress` after real journalled chains
 * and a real touch. Node only: `npm run test:realtime-bag-view`. The drawing at 1280×720 by real input is
 * tests/realtime-bag.spec.ts.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { registerArena } from '../sim/arenas';
import { bagProgress } from '../sim/bag';
import { defaultParams } from '../sim/params';
import { Simulation } from '../sim/simulation';
import { BAG_OFFSET, bagFraction, bagLabel, bagMarks, bagResultLine, BagView } from './bagView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'bag-view-field', name: 'Поле котомки (вид)', summary: 'Тест вида котомки', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 3,
});

function fight(): Simulation {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 1; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.doorBag = true;
  const sim = new Simulation({ arena: 'bag-view-field', params: p, seed: seedOf(1) });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
/** A chain of `n` weak enemies in a row from the hero at (3, 6), released and played out. */
function chain(sim: Simulation, n: number): void {
  sim.command({ t: 'teleport', x: 3, y: 6 });
  const points = Array.from({ length: n }, (_, i) => ({ x: 3 + 1.4 * (i + 1), y: 6 }));
  for (const p of points) sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  sim.command({ t: 'release' });
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) sim.tick();
}
/** A touch: an enemy on the hero until the hero loses HP; then the field is cleared. */
function touch(sim: Simulation): void {
  const hp = sim.world.hero.hp;
  sim.command({ t: 'place', x: sim.world.hero.x, y: sim.world.hero.y, color: 1, hp: 0, kind: 'basic' });
  for (let i = 0; i < 1200 && sim.world.hero.hp === hp; i++) sim.tick();
  sim.command({ t: 'clear', keepMarked: false });
}

check('before the goals: no bag to draw', () => {
  const sim = fight();
  assert(bagProgress(sim.world) === null, 'no bag');
});

check('the goals: «0/10 · +1», the first mark filling (empty arc), the others dark', () => {
  const sim = fight();
  chain(sim, 3);
  const p = bagProgress(sim.world)!;
  assert(bagLabel(p) === '0/10 · +1', bagLabel(p));
  assert(bagMarks(p).join() === 'filling,empty,empty', bagMarks(p).join());
  assert(bagFraction(p) === 0, String(bagFraction(p)));
});

check('kills fill: 4 — «4/10 · +1», arc 0.4; 12 — step 1 filled, «12/20 · +2», arc 0.2', () => {
  const sim = fight();
  chain(sim, 3); chain(sim, 4);
  let p = bagProgress(sim.world)!;
  assert(bagLabel(p) === '4/10 · +1' && Math.abs(bagFraction(p) - 0.4) < 1e-9, `${bagLabel(p)} ${bagFraction(p)}`);
  chain(sim, 4); chain(sim, 4);
  p = bagProgress(sim.world)!;
  assert(bagLabel(p) === '12/20 · +2', bagLabel(p));
  assert(bagMarks(p).join() === 'full,filling,empty', bagMarks(p).join());
  assert(Math.abs(bagFraction(p) - 0.2) < 1e-9, String(bagFraction(p)));
});

check('a touch: back to the step\'s start — «10/20 · +2», the filled mark stays', () => {
  const sim = fight();
  chain(sim, 3); chain(sim, 6); chain(sim, 6);
  assert(bagLabel(bagProgress(sim.world)!) === '12/20 · +2', bagLabel(bagProgress(sim.world)!));
  touch(sim);
  const p = bagProgress(sim.world)!;
  assert(bagLabel(p) === '10/20 · +2', bagLabel(p));
  assert(bagMarks(p).join() === 'full,filling,empty', bagMarks(p).join());
});

check('every step filled: «✓ +6», three gold marks', () => {
  const sim = fight();
  chain(sim, 3);
  for (let i = 0; i < 6; i++) chain(sim, 6);
  const p = bagProgress(sim.world)!;
  assert(bagLabel(p) === '✓ +6', bagLabel(p));
  assert(bagMarks(p).join() === 'full,full,full', bagMarks(p).join());
  assert(bagFraction(p) === 1, 'full');
});

check('the result line: the paid kinds in order, «0» with no step, «0 (поражение)» for a lost bag', () => {
  assert(bagResultLine({ resin: 1, dew: 2 }, 3, true) === '+3 — 2 Роса, 1 Смола', bagResultLine({ resin: 1, dew: 2 }, 3, true));
  assert(bagResultLine({ herbs: 1 }, 1, true) === '+1 — 1 Травы', 'one kind');
  assert(bagResultLine(null, 0, true) === '0', 'no step');
  assert(bagResultLine(null, 3, false) === '0 (поражение)', 'a defeat');
  assert(bagResultLine(null, 0, false) === '0', 'a defeat with no step');
});

check('the sack stands beside the door on the arena\'s side', () => {
  const sim = fight();
  const door = sim.world.objects.find(o => o.kind === 'door')!;
  const at = BagView.spot(sim.world)!;
  assert(at.x === door.x - BAG_OFFSET && at.y === door.y, `door on the right: ${JSON.stringify(at)}`);
  const left = { ...sim.world, objects: [{ ...door, x: 1.5 }] } as typeof sim.world;
  assert(BagView.spot(left)!.x === 1.5 + BAG_OFFSET, 'door on the left');
  // The number goes under the sack only by the top edge (the HUD covers the strip above it there).
  assert(!BagView.under(sim.world), 'a door in the middle row: the number over the sack');
  const top = { ...sim.world, objects: [{ ...door, y: 1 }] } as typeof sim.world;
  assert(BagView.under(top), 'a door by the top edge: the number under it');
});

console.log('\nbag view: all checks passed');
