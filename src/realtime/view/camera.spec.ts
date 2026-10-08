/**
 * Camera of the real-time arena (view/camera.ts, view/edgeMarkers.ts; docs/realtime-stage3.md, section 11). Node only:
 * `npm run test:realtime-camera`. The camera is a view: these checks read no simulation state except through the edge
 * markers, and the last one proves that a fight played with the camera's pointer mapping replays to the same hash.
 */
import { CAMERA, Camera, edgeArrow, type CameraBounds } from './camera';
import { collectEdgeMarkers } from './edgeMarkers';
import { BIG_CLEARING_ARENA } from '../sim/arenasCamera';
import { arenaTemplate } from '../sim/arenas';
import { defaultParams } from '../sim/params';
import { Simulation, replay } from '../sim/simulation';
import { createWorld } from '../sim/world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** The view of 1280×720 at the reference scale: 18.4 × 10.35 units. */
const VIEW = { viewW: 18.4, viewH: 10.35 };
const big: CameraBounds = { ...VIEW, arenaW: 24, arenaH: 15 };
const small: CameraBounds = { ...VIEW, arenaW: 16, arenaH: 10 };
const step = (cam: Camera, seconds: number, hero: { x: number; y: number }, b: CameraBounds, lead: { x: number; y: number } | null = null, frozen = false): void => {
  for (let t = 0; t < seconds; t += 1 / 60) cam.update(1 / 60, hero, lead, frozen, b);
};

check('an arena not larger than the view: the camera stands in its centre whatever the hero does', () => {
  const cam = new Camera();
  cam.snap({ x: 8, y: 5 }, small);
  assert(near(cam.x, 8) && near(cam.y, 5), 'centred');
  step(cam, 2, { x: 14, y: 2 }, small);
  assert(near(cam.x, 8) && near(cam.y, 5), `stays: ${cam.x}, ${cam.y}`);
});

check('the dead zone: a step inside it does not move the camera; a longer one drags it to the zone border', () => {
  const cam = new Camera();
  cam.snap({ x: 12, y: 7.5 }, big);
  step(cam, 1, { x: 12.9, y: 7.5 }, big);
  assert(near(cam.x, 12), `inside the zone: ${cam.x}`);
  step(cam, 3, { x: 15, y: 7.5 }, big);
  assert(near(cam.x, 15 - CAMERA.deadW / 2, 1e-3), `at the zone border: ${cam.x}`);
  step(cam, 3, { x: 15, y: 9.5 }, big);
  assert(near(cam.y, 9.5 - CAMERA.deadH / 2, 1e-3), `y at the zone border: ${cam.y}`);
});

check('smoothing: the camera closes about 63% of the way in the smoothing time and never overshoots', () => {
  const cam = new Camera();
  cam.snap({ x: 12, y: 7.5 }, big);
  const target = 12 + 5;
  const goalX = target - CAMERA.deadW / 2;
  step(cam, CAMERA.smooth, { x: target, y: 7.5 }, big);
  const share = (cam.x - 12) / (goalX - 12);
  assert(share > 0.55 && share < 0.7, `share ${share}`);
  let last = cam.x;
  for (let i = 0; i < 300; i++) { cam.update(1 / 60, { x: target, y: 7.5 }, null, false, big); assert(cam.x >= last - 1e-9 && cam.x <= goalX + 1e-9, 'monotone, no overshoot'); last = cam.x; }
});

check('the edges: the view never shows beyond the arena', () => {
  const cam = new Camera();
  cam.snap({ x: 12, y: 7.5 }, big);
  step(cam, 10, { x: 23.5, y: 14.5 }, big);
  assert(near(cam.x, 24 - VIEW.viewW / 2, 1e-6) && near(cam.y, 15 - VIEW.viewH / 2, 1e-6), `bottom right: ${cam.x}, ${cam.y}`);
  step(cam, 10, { x: 0.5, y: 0.5 }, big);
  assert(near(cam.x, VIEW.viewW / 2, 1e-6) && near(cam.y, VIEW.viewH / 2, 1e-6), `top left: ${cam.x}, ${cam.y}`);
  // The view grows (the panel closes): the camera is put back inside.
  const wide: CameraBounds = { viewW: 22, viewH: 12, arenaW: 24, arenaH: 15 };
  cam.snap({ x: 23, y: 14 }, big);
  cam.clamp(wide);
  assert(cam.x <= 24 - 11 + 1e-9 && cam.y <= 15 - 6 + 1e-9, 'clamped after the view grew');
  // A snap on a hero in the corner stands on the border, not on the hero.
  cam.snap({ x: 0.7, y: 0.7 }, big);
  assert(near(cam.x, VIEW.viewW / 2) && near(cam.y, VIEW.viewH / 2), 'snap respects the edge');
});

check('lead: towards the pointer by a fifth of the distance, at most 2 units across and 1.2 along', () => {
  const cam = new Camera();
  cam.snap({ x: 12, y: 7.5 }, big);
  // Goal = hero + lead; the zone then lets the camera sit hw/hh short of it.
  step(cam, 4, { x: 12, y: 7.5 }, big, { x: 50, y: 50 });
  assert(near(cam.x, 12 + CAMERA.leadMaxX - CAMERA.deadW / 2, 1e-3), `x ${cam.x}`);
  assert(near(cam.y, 7.5 + CAMERA.leadMaxY - CAMERA.deadH / 2, 1e-3), `y ${cam.y}`);
  const c2 = new Camera();
  c2.snap({ x: 12, y: 7.5 }, big);
  step(c2, 4, { x: 12, y: 7.5 }, big, { x: -5, y: 0 });
  assert(near(c2.x, 12), `a small lead stays inside the dead zone: ${c2.x}`);
});

check('frozen (a chain is being drawn) and paused (dt 0): the camera does not move at all', () => {
  const cam = new Camera();
  cam.snap({ x: 12, y: 7.5 }, big);
  step(cam, 2, { x: 20, y: 12 }, big, { x: 30, y: 30 }, true);
  assert(near(cam.x, 12) && near(cam.y, 7.5), 'frozen');
  cam.update(0, { x: 20, y: 12 }, null, false, big);
  assert(near(cam.x, 12) && near(cam.y, 7.5), 'dt 0');
  step(cam, 2, { x: 20, y: 12 }, big);
  assert(cam.x > 12, 'follows again after the freeze');
});

check('edge arrow: on the border of the inset rectangle, pointing outward', () => {
  const a = edgeArrow(640, 360, 2000, 0, 26, 70, 1254, 660);
  assert(near(a.x, 1254) && near(a.y, 360) && near(a.angle, 0), 'right');
  const b = edgeArrow(640, 360, 0, -900, 26, 70, 1254, 660);
  assert(near(b.x, 640) && near(b.y, 70) && near(b.angle, -Math.PI / 2), 'top (the HUD inset)');
  const c = edgeArrow(640, 360, -2000, 1000, 26, 70, 1254, 660);
  assert(c.x >= 26 - 1e-9 && c.y <= 660 + 1e-9 && (near(c.x, 26) || near(c.y, 660)), 'corner stays inside');
});

/** A quiet world on the big clearing to read the markers from. */
function quietWorld() {
  const params = defaultParams();
  params.baseFloor = 0; params.baseIntervalMin = 1e6; params.baseIntervalMax = 1e6;
  const world = createWorld(BIG_CLEARING_ARENA, params, 1);
  world.enemies = []; world.markers = []; world.queue = [];
  return world;
}
const viewAround = (cx: number, cy: number) => (p: { x: number; y: number }, margin: number): boolean => Math.abs(p.x - cx) <= VIEW.viewW / 2 + margin && Math.abs(p.y - cy) <= VIEW.viewH / 2 + margin;

check('edge markers: a danger aimed at the hero from off screen, goals off screen; nothing for what is in view', () => {
  const world = quietWorld();
  world.hero.x = 12; world.hero.y = 7.5;
  const sees = viewAround(12, 7.5);
  // The open door is far off screen only after the goals: shut, no pointer.
  assert(collectEdgeMarkers(world, sees).length === 0, 'quiet and nothing on screen');
  world.stage = 'greed';
  let m = collectEdgeMarkers(world, sees);
  assert(m.length === 1 && m[0].kind === 'goal' && near(m[0].x, 23.2), `open door: ${JSON.stringify(m)}`);
  world.stage = 'goals';
  // A charging boar at the left edge of the arena.
  const base = { id: 1, kind: 'boar', x: 1, y: 7.5, color: 0, hp: 0, boar: 'windup', dirX: 1, dirY: 0 } as unknown as typeof world.enemies[number];
  world.enemies.push(base);
  m = collectEdgeMarkers(world, sees);
  assert(m.length === 1 && m[0].kind === 'threat' && m[0].x === 1, 'a boar off screen');
  base.x = 12; base.y = 9;
  assert(collectEdgeMarkers(world, sees).length === 0, 'the same boar in view needs no pointer');
  base.boar = 'rest';
  base.x = 1;
  assert(collectEdgeMarkers(world, sees).length === 0, 'a boar that is not aiming needs none');
  // A marked enemy far away is a goal.
  world.enemies.push({ ...base, id: 2, kind: 'basic', boar: null, marked: true, x: 22, y: 2 } as typeof base);
  m = collectEdgeMarkers(world, sees);
  assert(m.length === 1 && m[0].kind === 'goal', 'a marked enemy off screen');
});

check('a fight with the pointer mapped through a moving camera replays to the same hash (the camera is not in the journal)', () => {
  const params = defaultParams();
  const sim = new Simulation({ arena: arenaTemplate('big-clearing'), params, seed: 7, record: true });
  const cam = new Camera(), bounds = big;
  cam.snap(sim.world.hero, bounds);
  sim.command({ t: 'walk', x: 1, y: 0.4 });
  for (let f = 0; f < 600; f++) {
    sim.advance(1 / 60);
    cam.update(1 / 60, sim.world.hero, null, false, bounds);
    // The pointer sits on a fixed screen point; its arena point moves with the camera and goes into the journal as such.
    if (f % 90 === 0) {
      const p = { x: cam.x + 3, y: cam.y };
      sim.command({ t: 'begin', x: p.x, y: p.y });
      sim.command({ t: 'cancel' });
    }
  }
  assert(cam.x > 12.5, `the camera followed the hero: ${cam.x}`);
  const journal = sim.exportJournal(), hash = sim.hash();
  const back = replay(journal);
  assert(back.hash() === hash, 'replay hash');
  assert(JSON.stringify(journal).includes('"begin"'), 'journal holds the arena-space commands');
});

console.log(`camera: ${checks} checks passed`);
