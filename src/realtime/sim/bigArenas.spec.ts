/**
 * Phase A, Т5 (docs/realtime-phase-a.md, section 6): big arenas of the run. Node only: `npm run test:realtime-big-arenas`.
 *
 * - An arena not bigger than the view (all 16×10 arenas) spawns as before Т5: both journals recorded in the browser
 *   replay to their hashes, and the group anchors of the spawn are the points of the pre-Т5 code (copied here verbatim)
 *   with the same draws of the `spawnPlace` stream — on every such arena, several seeds, both spawn modes.
 * - On a bigger arena («Брод» 24×14, «Последний рубеж» 24×15, «Большая поляна» 24×15) every anchor lies in the arena
 *   and in the rectangle 16×9 round the hero shifted inside the arena; in a fight the markers come round the hero.
 * - The pressure: the density floor and the arena limit grow with the area (`s`), 16×10 keeps its numbers — checked by
 *   who stands on the arena after the goals and how many the limit lets out, not by the formula alone.
 * Seeds are spread (`Math.imul(k, 2654435761) >>> 0`).
 */
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import shieldsWolvesJournal from '../../../tests/fixtures/realtime-browser-journal-shields-wolves.json';
import { arenaTemplate, registeredArenas } from './arenas';
import { blockedAt, dist, inWater, type Vec } from './geometry';
import { defaultParams, enemyBodyRadius, type Params } from './params';
import { Rng } from './rng';
import { Simulation, replay, type Journal } from './simulation';
import { AREA_SCALE_MAX, BIG_MAX_ENEMIES, SPAWN_RECT_H, SPAWN_RECT_W, VIEW_H, VIEW_W, areaScale, enemyLimit, findAnchor, inRect, isBigArena, scaledFloor, spawnRect } from './spawn';
import { createWorld, type World } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

const BIG = ['ford', 'last-stand', 'big-clearing'];
/** The camera's centre on one axis when it stands on the hero (view/camera.ts, `clampAxis`). */
const clampAxis = (c: number, view: number, arena: number): number => (arena <= view ? arena / 2 : Math.max(view / 2, Math.min(arena - view / 2, c)));

// ---- The spawn of 16×10 is the old one ----

check('the journals recorded in the browser (arena «Убить 30»; «Стена щитов» with the wolves\' ring) replay to their hashes', () => {
  for (const fixture of [browserJournal, shieldsWolvesJournal] as unknown as { journal: Journal; hash: string }[]) {
    const sim = replay(fixture.journal);
    assert(sim.hash() === fixture.hash, `${fixture.journal.arena}: browser ${fixture.hash}, Node ${sim.hash()}`);
  }
});

/** The anchor search before Т5, verbatim (spawn.ts at 7b6f624): the whole arena's edge, or anywhere inside it. */
function oldFindAnchor(world: World): Vec | null {
  const placeRng = world.rng.stream('spawnPlace');
  const randomEdgePoint = (): Vec => {
    const { width: w, height: h } = world.arena;
    const inset = enemyBodyRadius(world.params) + 0.05;
    let t = placeRng.next() * (2 * (w + h));
    if (t < w) return { x: t, y: inset };
    t -= w;
    if (t < h) return { x: w - inset, y: t };
    t -= h;
    if (t < w) return { x: w - t, y: h - inset };
    t -= w;
    return { x: inset, y: h - t };
  };
  const randomInsidePoint = (): Vec => {
    const r = enemyBodyRadius(world.params);
    const x = r + placeRng.next() * (world.arena.width - 2 * r);
    return { x, y: r + placeRng.next() * (world.arena.height - 2 * r) };
  };
  const anchorValid = (p: Vec): boolean => !blockedAt(p, enemyBodyRadius(world.params) * 0.99, world.arena) && !inWater(p, world.arena) && dist(p, world.hero) >= world.params.spawnMinDistance;
  const inside = world.params.spawnPlace === 'edgesAndInside';
  for (let i = 0; i < 24; i++) {
    const p = inside && placeRng.next() < 0.5 ? randomInsidePoint() : randomEdgePoint();
    const r = enemyBodyRadius(world.params);
    p.x = Math.max(r, Math.min(world.arena.width - r, p.x));
    p.y = Math.max(r, Math.min(world.arena.height - r, p.y));
    if (anchorValid(p)) return p;
  }
  return null;
}

check('arenas not bigger than the view: the anchors are the old ones, bit for bit, with the same draws of `spawnPlace` (every such arena, 3 seeds, both spawn modes, the hero anywhere)', () => {
  const small = registeredArenas().filter(a => !isBigArena(a));
  assert(small.length >= 15 && small.every(a => a.width <= VIEW_W && a.height <= VIEW_H), `${small.length} arenas not bigger than the view`);
  let anchors = 0, none = 0;
  for (const arena of small) for (const mode of ['edges', 'edgesAndInside'] as const) for (const k of [1, 2, 3]) {
    const params: Params = { ...defaultParams(), spawnPlace: mode };
    const a = createWorld(arena, params, seedOf(k)), b = createWorld(arena, params, seedOf(k)), heroes = new Rng(seedOf(k + 50));
    for (let i = 0; i < 120; i++) {
      const hero = { x: heroes.next() * arena.width, y: heroes.next() * arena.height };
      a.hero.x = b.hero.x = hero.x; a.hero.y = b.hero.y = hero.y;
      const p = findAnchor(a), q = oldFindAnchor(b);
      assert((p === null && q === null) || (p !== null && q !== null && p.x === q.x && p.y === q.y), `${arena.id} ${mode} #${i}: ${JSON.stringify(p)} vs ${JSON.stringify(q)}`);
      assert(JSON.stringify(a.rng.states()) === JSON.stringify(b.rng.states()), `${arena.id} ${mode} #${i}: the streams differ`);
      if (p) anchors++; else none++;
    }
  }
  console.log(`   ${small.length} arenas: ${anchors} anchors equal, ${none} searches found none on both`);
});

// ---- Big arenas: the spawn round the hero ----

check('big arenas («Брод» 24×14, «Последний рубеж» 24×15, «Большая поляна»): 100% of the anchors lie in the arena and in the rectangle 16×9 round the hero, shifted inside the arena', () => {
  for (const id of BIG) {
    const arena = arenaTemplate(id);
    assert(isBigArena(arena) && Math.max(arena.width, arena.height) <= 28, `${id}: ${arena.width}×${arena.height}`);
    let anchors = 0, none = 0;
    for (const mode of ['edges', 'edgesAndInside'] as const) {
      const w = createWorld(arena, { ...defaultParams(), spawnPlace: mode }, seedOf(7)), r = enemyBodyRadius(w.params);
      // The hero on a grid of the arena, its corners and edges included.
      for (let hx = 0.5; hx <= arena.width - 0.5; hx += 1.5) for (let hy = 0.5; hy <= arena.height - 0.5; hy += 1.5) {
        w.hero.x = hx; w.hero.y = hy;
        const box = spawnRect(arena, w.hero);
        assert(box.w === SPAWN_RECT_W && box.h === SPAWN_RECT_H && box.x >= 0 && box.y >= 0 && box.x + box.w <= arena.width && box.y + box.h <= arena.height && inRect(w.hero, box), `${id}: rectangle ${JSON.stringify(box)} round (${hx}, ${hy})`);
        for (let i = 0; i < 6; i++) {
          const p = findAnchor(w);
          if (!p) { none++; continue; }
          anchors++;
          assert(p.x >= r && p.x <= arena.width - r && p.y >= r && p.y <= arena.height - r, `${id}: anchor (${p.x}, ${p.y}) outside the arena`);
          assert(inRect(p, box), `${id} ${mode}: anchor (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) outside ${JSON.stringify(box)} of the hero (${hx}, ${hy})`);
        }
      }
    }
    assert(anchors > 20 * none, `${id}: ${anchors} anchors, ${none} searches found none`);
    console.log(`   ${id}: ${anchors} anchors in the rectangle, ${none} searches found none`);
  }
});

check('big arenas in a fight: the markers come round the walking hero — in the arena, in his rectangle (grown by the spread of a group), none in the water; the fight replays from its journal', () => {
  for (const [n, id] of BIG.entries()) {
    const p = defaultParams();
    p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0;
    const sim = new Simulation({ arena: id, params: p, seed: seedOf(30 + n), record: true }), w = sim.world, seen = new Set<number>();
    const spread = enemyBodyRadius(w.params) * 2.6 + 1e-9;
    const walk = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1]];
    let far = 0;
    for (let tick = 0; tick < 60 * 45; tick++) {
      if (tick % 90 === 0) { const [x, y] = walk[(tick / 90) % walk.length]; sim.command({ t: 'walk', x, y }); }
      if (tick === 60 * 15) sim.command({ t: 'goals' });
      sim.tick();
      w.events.length = 0;
      const box = spawnRect(w.arena, w.hero), grown = { x: box.x - spread, y: box.y - spread, w: box.w + 2 * spread, h: box.h + 2 * spread };
      for (const m of w.markers) {
        if (seen.has(m.id) || m.kind === 'reaper') continue;
        seen.add(m.id);
        assert(m.x > 0 && m.x < w.arena.width && m.y > 0 && m.y < w.arena.height && !inWater(m, w.arena), `${id}: a marker at (${m.x.toFixed(2)}, ${m.y.toFixed(2)})`);
        assert(inRect(m, grown), `${id}: a marker at (${m.x.toFixed(2)}, ${m.y.toFixed(2)}) far from the hero (${w.hero.x.toFixed(2)}, ${w.hero.y.toFixed(2)})`);
        // The view put on the hero as the camera does (clamped to the arena); a marker of a group may stand up to its
        // spread (0.83) off the rectangle, which is 0.65 inside the view at the top and bottom: 0.2 of slack.
        const cx = clampAxis(w.hero.x, VIEW_W, w.arena.width), cy = clampAxis(w.hero.y, VIEW_H, w.arena.height);
        if (Math.abs(m.x - cx) > VIEW_W / 2 + 0.2 || Math.abs(m.y - cy) > VIEW_H / 2 + 0.2) far++;
      }
    }
    assert(seen.size > 60 && far === 0, `${id}: ${seen.size} markers, ${far} outside the view round the hero`);
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `${id}: replay`);
    console.log(`   ${id}: ${seen.size} markers in 45 s, all within the view round the hero`);
  }
});

// ---- The pressure grows with the area ----

check(`the area factor: s = A > 160 ? min(${AREA_SCALE_MAX}; √(A/160)) : 1 — 16×10 keeps its floors and limit, the big arenas scale them (limit at most ${BIG_MAX_ENEMIES}, never under the panel value)`, () => {
  const p = defaultParams();
  for (const a of registeredArenas().filter(x => x.width * x.height <= 160)) {
    assert(areaScale(a) === 1 && enemyLimit(p, a) === p.maxEnemies && [0, 7, 28, 36, 58].every(f => scaledFloor(f, a) === f), `${a.id}: s ${areaScale(a)}`);
  }
  for (const id of BIG) {
    const a = arenaTemplate(id), s = areaScale(a);
    assert(s === Math.min(AREA_SCALE_MAX, Math.sqrt(a.width * a.height / 160)) && s > 1, `${id}: s ${s}`);
    assert(scaledFloor(36, a) === Math.round(36 * s) && enemyLimit(p, a) === Math.min(BIG_MAX_ENEMIES, Math.round(60 * s)), `${id}: floor ${scaledFloor(36, a)}, limit ${enemyLimit(p, a)}`);
    assert(enemyLimit({ ...p, maxEnemies: 150 }, a) === 150, `${id}: a slider above the cap stays`);
    console.log(`   ${id} ${a.width}×${a.height}: s ${s.toFixed(3)}, floor 36 → ${scaledFloor(36, a)}, 58 → ${scaledFloor(58, a)}, limit ${enemyLimit(p, a)}`);
  }
});

/** Who waits or stands on the arena (the floor counts them; the reaper is apart). */
const present = (w: World): number => w.enemies.filter(e => e.kind !== 'reaper').length + w.markers.length + w.queue.length;

check('the pressure in a fight: after the goals the floor of the first phase tops the arena up at once — 16×10 to its number, the big arena to the scaled one; with no kills 16×10 never holds more than 60, the big arena more than 60 but never over its scaled limit', () => {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.boarDamage = 0;
  const floor0 = p.phases[0].floor;
  for (const [id, k] of [['kills', 1], ['big-clearing', 1], ['kills', 2], ['big-clearing', 2]] as const) {
    const sim = new Simulation({ arena: id, params: { ...p }, seed: seedOf(70 + k) }), w = sim.world, arena = w.arena;
    const floor = scaledFloor(floor0, arena), limit = enemyLimit(w.params, arena);
    for (let i = 0; i < 60 * 5; i++) sim.tick();
    const before = present(w);
    sim.command({ t: 'goals' });
    sim.tick();
    // The top-up queues whole groups (2–4) or packs: at most a group over the floor, unless the arena held more already.
    const after = present(w);
    assert(after >= floor && after <= Math.max(before, floor) + 4, `${id}: after the goals ${after} (before ${before}), floor ${floor}`);
    assert(isBigArena(arena) ? floor > floor0 : floor === floor0, `${id}: floor ${floor} against ${floor0}`);
    let most = 0;
    for (let i = 0; i < 60 * 150; i++) { sim.tick(); w.events.length = 0; most = Math.max(most, w.enemies.filter(e => e.kind !== 'reaper').length + w.markers.length); }
    // Never over the limit; on the big arena more than 16×10 lets out (a crowded 16×10 may stop short of its 60: no free point).
    assert(most <= limit && (!isBigArena(arena) || most > p.maxEnemies), `${id}: at most ${most} enemies and markers, limit ${limit}`);
    console.log(`   ${id} (${arena.width}×${arena.height}): before the goals ${before}, after ${after} (floor ${floor}, the table's ${floor0}); most on the arena ${most} of ${limit}`);
  }
});

console.log(`realtime-big-arenas: ${checks} checks passed`);
