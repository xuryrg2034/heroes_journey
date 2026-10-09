/**
 * Camera of the real-time arena (view/camera.ts, view/edgeMarkers.ts; docs/realtime-stage3.md, section 11). Node only:
 * `npm run test:realtime-camera`. The camera is a view: these checks read no simulation state except through the edge
 * markers, and the last one proves that a fight played with the camera's pointer mapping replays to the same hash.
 */
import { ARROW_CLASH, CAMERA, Camera, edgeArrow, placeEdgeArrows, type CameraBounds } from './camera';
import { collectEdgeMarkers } from './edgeMarkers';
import { BIG_CLEARING_ARENA } from '../sim/arenasCamera';
import { LYNX_STUN, LYNX_WALK, LYNX_WINDUP } from '../sim/enemies/lynx';
import { defaultParams } from '../sim/params';
import { createWorld, type World } from '../sim/world';

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
  world.enemies.push({ ...base, id: 2, kind: 'basic', boar: 'walk', marked: true, x: 22, y: 2 } as typeof base);
  m = collectEdgeMarkers(world, sees);
  assert(m.length === 1 && m[0].kind === 'goal', 'a marked enemy off screen');
});

/** An enemy of `kind` with the given vars at (x, y), as the signal functions read it. */
function foe(id: number, kind: string, x: number, y: number, vars: Record<string, number>, extra: Record<string, unknown> = {}): World['enemies'][number] {
  return { id, kind, x, y, color: 0, hp: 0, boar: 'walk', dirX: 1, dirY: 0, vars, ...extra } as unknown as World['enemies'][number];
}
const markers = (world: World, cx = 12, cy = 7.5) => collectEdgeMarkers(world, viewAround(cx, cy));

check('edge markers: the archer — only while its line is aimed; the lynx — only in its windup', () => {
  const world = quietWorld();
  world.hero.x = 12; world.hero.y = 7.5;
  const archer = foe(1, 'archer', 2, 7.5, { aim: 0, timer: 1, dx: 1, dy: 0, len: 7 });
  const lynx = foe(2, 'lynx', 22, 13, { st: LYNX_WALK, t: 1, dx: -1, dy: 0, len: 4 });
  world.enemies.push(archer, lynx);
  assert(markers(world).length === 0, 'neither aims: no pointer');
  archer.vars.aim = 1;
  let m = markers(world);
  assert(m.length === 1 && m[0].kind === 'threat' && m[0].x === 2, 'the archer aims from off screen');
  lynx.vars.st = LYNX_WINDUP;
  m = markers(world);
  assert(m.length === 2 && m.every(x => x.kind === 'threat'), 'the lynx in its windup too');
  lynx.vars.st = LYNX_STUN;
  assert(markers(world).length === 1, 'a stunned lynx has no line');
  archer.x = 12; archer.y = 11;
  assert(markers(world).length === 0, 'an aiming archer in view needs no pointer');
});

check('edge markers: the sapper — only a lit fuse whose blast circle reaches the view; not for a far or unlit one', () => {
  const world = quietWorld();
  world.hero.x = 12; world.hero.y = 7.5;
  const R = world.params.sapperRadius;
  const sapper = foe(1, 'sapper', 12 + VIEW.viewW / 2 + R * 0.5, 7.5, { lit: 0, fuse: 1 });
  world.enemies.push(sapper);
  assert(markers(world).length === 0, 'unlit: nothing');
  sapper.vars.lit = 1;
  assert(markers(world).length === 1, 'lit, just outside the view, its circle reaches in: pointer');
  sapper.x = 12 + VIEW.viewW / 2 + R * 1.5;
  assert(markers(world).length === 0, 'lit but its circle does not reach the view: none');
  sapper.vars.exploded = 1; sapper.x = 12 + VIEW.viewW / 2 + R * 0.5;
  assert(markers(world).length === 0, 'already exploded: none');
  world.blasts.push({ x: 12 + VIEW.viewW / 2 + R * 0.5, y: 7.5, timeLeft: 0.5, total: 1 } as unknown as World['blasts'][number]);
  assert(markers(world).length === 1, 'a bomb on the ground whose circle reaches the view');
});

check('edge markers: the shaman beam — a pointer only when its target is in view or near the hero; a far unseen target gives none', () => {
  const world = quietWorld();
  world.hero.x = 12; world.hero.y = 7.5;
  const target = foe(2, 'basic', 1.5, 14, {});
  const shaman = foe(1, 'shaman', 0.8, 10, { beam: 2, t: 1 });
  world.enemies.push(shaman, target);
  assert(markers(world).length === 0, 'shaman and target both far and off screen: no arrow (noise)');
  target.x = 12; target.y = 9;
  let m = markers(world);
  assert(m.length === 1 && m[0].x === 0.8 && m[0].kind === 'threat', 'the target is in view: the pointer sits at the shaman');
  target.x = 12 + VIEW.viewW / 2 + 1; target.y = 7.5;
  world.hero.x = target.x - 3; world.hero.y = target.y;
  m = collectEdgeMarkers(world, viewAround(12, 7.5));
  assert(m.length === 1, 'the target is off screen but within 4 units of the hero: pointer');
  world.hero.x = 12; world.hero.y = 7.5;
  assert(markers(world).length === 0, 'the same target far from the hero and off screen: none');
});

check('arrows: a danger and a goal in the same direction — the goal is drawn first (under) and slides off the danger; dangers last', () => {
  const rect = { left: 40, top: 80, right: 1240, bottom: 640 };
  const out = placeEdgeArrows([
    { dx: 2000, dy: 10, kind: 'threat' },
    { dx: 2000, dy: 12, kind: 'goal' },
    { dx: -3000, dy: 40, kind: 'goal' },
  ], 640, 360, rect);
  assert(out.map(a => a.kind).join() === 'goal,goal,threat', `order ${out.map(a => a.kind)}`);
  const threat = out[2], clashing = out.find(a => a.kind === 'goal' && a.x > 600)!;
  assert(Math.hypot(clashing.x - threat.x, clashing.y - threat.y) >= ARROW_CLASH - 1e-6, 'the goal moved off the danger');
  assert(out.every(a => a.x >= rect.left && a.x <= rect.right && a.y >= rect.top && a.y <= rect.bottom), 'all inside the rectangle');
  // A goal far from the danger stays where it is.
  const lone = out.find(a => a.kind === 'goal' && a.x < 600)!;
  assert(near(lone.x, 40), 'the lone goal stays on the border');
  // A bottom arrow stays above the bottom bound (the action bar): its centre never goes lower than the rectangle.
  const low = placeEdgeArrows([{ dx: 0, dy: 900, kind: 'threat' }], 640, 360, rect)[0];
  assert(near(low.y, 640) && near(low.x, 640), 'bottom arrow at the rectangle bottom');
});

check('edge markers (phase A): a howling or rushing wolf off screen is a danger; a ringing or frozen one is not', () => {
  const world = quietWorld();
  world.hero.x = 12; world.hero.y = 7.5;
  const wolf = foe(1, 'wolf', 1, 7.5, { st: 0 });
  world.enemies.push(wolf);
  assert(markers(world).length === 0, 'a wolf in the ring: no pointer');
  wolf.vars.st = 1; wolf.vars.t = 0.3;
  let m = markers(world);
  assert(m.length === 1 && m[0].kind === 'threat' && m[0].x === 1, 'a howling wolf off screen');
  wolf.vars.st = 2; wolf.vars.dx = 1; wolf.vars.dy = 0; wolf.vars.ran = 1;
  assert(markers(world).length === 1, 'a rushing wolf off screen');
  (wolf as unknown as { chill: number }).chill = 1;
  assert(markers(world).length === 0, 'a frozen wolf: none');
  (wolf as unknown as { chill: number }).chill = 0;
  wolf.x = 12; wolf.y = 9;
  assert(markers(world).length === 0, 'a howling wolf in view: none');
});

check('edge markers (phase A, Т5): spawn markers off screen only with `spawns` on (an arena larger than the view)', () => {
  const world = quietWorld();
  world.hero.x = 12; world.hero.y = 7.5;
  world.markers.push({ x: 1, y: 1, color: 0, timeLeft: 1, total: 1 } as unknown as World['markers'][number]);
  world.markers.push({ x: 12, y: 8, color: 1, timeLeft: 1, total: 1 } as unknown as World['markers'][number]);
  assert(collectEdgeMarkers(world, viewAround(12, 7.5)).length === 0, 'spawns off: no pointer to a marker');
  const m = collectEdgeMarkers(world, viewAround(12, 7.5), true);
  assert(m.length === 1 && m[0].kind === 'spawn' && m[0].x === 1, `spawns on: only the off-screen marker: ${JSON.stringify(m)}`);
});

check('arrows (phase A): spawn arrows are grouped by direction (one per 45° sector, the nearest), give way to dangers, are drawn first', () => {
  const rect = { left: 40, top: 80, right: 1240, bottom: 640 };
  const out = placeEdgeArrows([
    { dx: -2000, dy: 0, kind: 'spawn' },
    { dx: -1500, dy: 200, kind: 'spawn' },
    { dx: -2000, dy: -300, kind: 'spawn' },
    { dx: 0, dy: -2000, kind: 'spawn' },
    { dx: 2000, dy: 0, kind: 'spawn' },
    { dx: 2000, dy: 8, kind: 'threat' },
  ], 640, 360, rect);
  const spawns = out.filter(a => a.kind === 'spawn');
  assert(spawns.length === 2, `left group as one arrow, top one, none on the danger: ${JSON.stringify(out)}`);
  const left = spawns.find(a => a.x < 600)!;
  assert(near(left.x, 40) && left.y > 360, `the left one points at the nearest marker of its sector: ${JSON.stringify(left)}`);
  assert(out[out.length - 1].kind === 'threat' && out[0].kind === 'spawn', `order ${out.map(a => a.kind)}`);
  // A whole wave along the bottom of the view: one arrow per sector it covers, not a fence.
  const wave = placeEdgeArrows(Array.from({ length: 20 }, (_, i) => ({ dx: -1000 + i * 100, dy: 600, kind: 'spawn' as const })), 640, 360, rect);
  assert(wave.length <= 3, `a wave of 20 markers below: ${wave.length} arrows`);
});

console.log(`camera: ${checks} checks passed`);
