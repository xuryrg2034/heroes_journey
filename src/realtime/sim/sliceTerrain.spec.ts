/**
 * Terrain of the slice arenas 4–10 (stage 3a, step 2; docs/realtime-stage3.md, sections 8 and 9): one feature of the
 * terrain per arena — 4 braziers, 5 a gorge, 6 a cliff, 7 thorns, 8 a river, 9 a cliff and a gorge, 10 a big pond and
 * braziers. Node only: `npm run test:realtime-slice-terrain`.
 *
 * The layout rules of section 8 are measured on the arena data: every gap between two blockers (walls, trees, cliffs,
 * thorns and the arena edges) is either shut (no body fits) or at least 2 units wide; the hero walks from his start to the
 * door, the buttons and every dry spot of the arena without thorns and cliffs; no start enemy stands over a cliff, in
 * thorns or in water. Each feature is then played through journalled commands (walk, teleport, place, begin, drag,
 * release …) on its own arena where the layout puts it: a brazier takes a shieldbearer from the side with +2, a ridge
 * cuts an archer's line, a blast throws a survivor into the ravine and a chain crosses its neck, a walk through a hedge
 * of thorns is pricked and a chain over it is not, a crossing on foot is slow and a dash is not, the outpost's gates and
 * ledge lead the crowd, the final's pond slows and its brazier powers a chain. Last: a bot fight on each arena 4–10 replays
 * from its journal to the same hash; newcomers' markers never stand over a cliff or in water. Seeds are spread
 * (`Math.imul(k, 2654435761) >>> 0`).
 */
import { SLICE_ARENAS, arenaTemplate, type ArenaTemplate } from './arenas';
import { chainAnchor, enemyRefusal, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { type Area, type Vec, areaDistance, blockedAt, cliffAt, dist, inThorns, inWater, overCliff } from './geometry';
import { defaultParams, enemyBodyRadius, heroRadius, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { ArenaObject, Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds: neighbouring small seeds roll alike. */
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A quiet fight: no newcomers, enemies stand (speed 0) unless the test gives them speed, touches do not hurt. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false;
  return Object.assign(p, extra);
}
/** A fight where the hero cannot fall: the arena's pace, no damage to him. */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 40; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0; p.porcupineQuills = 0;
  return Object.assign(p, extra);
}
const fight = (arena: string, params: Params, k = 1): Simulation => {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
};
const place = (sim: Simulation, x: number, y: number, color = 0, hp = 0, kind = 'basic'): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const ticks = (sim: Simulation, n: number, each?: (w: World) => void): void => {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); each?.(sim.world); }
};
function runUntil(sim: Simulation, until: () => boolean, max = 600, each?: (w: World) => void): number {
  let n = 0;
  while (n < max && !until() && sim.world.status === 'playing') { sim.tick(); each?.(sim.world); n++; }
  return n;
}
/** A chain through the points (an enemy or an object under each), then the release. */
function chainThrough(sim: Simulation, points: readonly Vec[], release = true): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(sim.world.chain.length === points.length, `the chain took ${sim.world.chain.length} of ${points.length} links`);
  if (release) sim.command({ t: 'release' });
}
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Collects the world's events tick by tick (the view clears them; here the test does). */
function collect(sim: Simulation, n: number, until?: () => boolean): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < n && sim.world.status === 'playing' && !until?.(); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const kills = (events: WorldEvent[]): Extract<WorldEvent, { type: 'kill' }>[] => events.filter((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill');
/** Walks the hero by `dir` for `n` ticks and returns how far he went. */
function walk(sim: Simulation, from: Vec, dir: Vec, n: number, each?: (w: World) => void): number {
  sim.command({ t: 'teleport', x: from.x, y: from.y });
  sim.command({ t: 'walk', x: dir.x, y: dir.y });
  ticks(sim, n, each);
  sim.command({ t: 'walk', x: 0, y: 0 });
  return dist(sim.world.hero, from);
}
/** Ticks of the dash (or the jump) after the release, with every hero point on the way. */
function flight(sim: Simulation, max = 300): { ticks: number; path: Vec[] } {
  const path: Vec[] = [];
  const n = runUntil(sim, () => !sim.world.move, max, w => path.push({ x: w.hero.x, y: w.hero.y }));
  return { ticks: n, path };
}
const brazierAt = (w: World, x: number, y: number): ArenaObject => w.objects.find(o => o.kind === 'brazier' && o.x === x && o.y === y)!;
const pricks = (events: WorldEvent[]): number => events.filter(e => e.type === 'hit' && e.source === 'thorns').length;
const ARENAS_4_10 = SLICE_ARENAS.map(a => a.id);

// ---- Layout rules of section 8 ----

/**
 * A blocker of walking for the width rule: walls, trees, cliffs, thorns (no dry way through) and the four arena edges.
 * `d` — signed distance from a point to it; `samples` — points of its outline (or spine, center) with the offset of the
 * outline from them, so the gap between two blockers is the least `d` of one over the samples of the other.
 */
interface Blocker { name: string; d: (p: Vec) => number; samples: { p: Vec; off: number }[] }

const STEP = 0.02;
function outline(points: readonly Vec[], closed: boolean): Vec[] {
  const out: Vec[] = [];
  const n = points.length, edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const a = points[i], b = points[(i + 1) % n], len = dist(a, b), k = Math.max(1, Math.ceil(len / STEP));
    for (let j = 0; j <= k; j++) out.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k });
  }
  return out;
}
const rectPoints = (x: number, y: number, w: number, h: number): Vec[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function areaBlocker(name: string, area: Area): Blocker {
  const d = (p: Vec): number => areaDistance(area, p).d;
  switch (area.shape) {
    case 'circle': return { name, d, samples: [{ p: { x: area.x, y: area.y }, off: area.r }] };
    case 'rect': return { name, d, samples: outline(rectPoints(area.x, area.y, area.w, area.h), true).map(p => ({ p, off: 0 })) };
    case 'poly': return { name, d, samples: outline(area.points, true).map(p => ({ p, off: 0 })) };
    case 'band': return { name, d, samples: outline(area.points, false).map(p => ({ p, off: area.width / 2 })) };
  }
}
function blockers(arena: ArenaTemplate): Blocker[] {
  const out: Blocker[] = [];
  for (const o of arena.obstacles) {
    if (o.kind === 'pond') continue;
    if (o.shape === 'circle') out.push({ name: `tree (${o.x}, ${o.y})`, d: p => dist(p, o) - o.r, samples: [{ p: { x: o.x, y: o.y }, off: o.r }] });
    else out.push(areaBlocker(`wall (${o.x}, ${o.y}, ${o.w}×${o.h})`, { shape: 'rect', x: o.x, y: o.y, w: o.w, h: o.h }));
  }
  for (const [i, z] of (arena.terrain ?? []).entries()) if (z.kind !== 'river') out.push(areaBlocker(`${z.kind} #${i + 1}`, z));
  const { width: W, height: H } = arena;
  out.push(
    { name: 'left edge', d: p => p.x, samples: [] }, { name: 'right edge', d: p => W - p.x, samples: [] },
    { name: 'top edge', d: p => p.y, samples: [] }, { name: 'bottom edge', d: p => H - p.y, samples: [] },
  );
  return out;
}
/** The least gap between two blockers (0 when they touch or overlap). */
function gapBetween(a: Blocker, b: Blocker): number {
  let g = Infinity;
  for (const s of a.samples) g = Math.min(g, b.d(s.p) - s.off);
  for (const s of b.samples) g = Math.min(g, a.d(s.p) - s.off);
  return Math.max(0, g);
}
/** A gap narrower than this lets no body through (the hero's circle is 0.56 across, an enemy's 0.64): it is shut. */
const SHUT = 0.5;
/** Section 8: a passage at a cliff and any gorge is at least 2 units wide. */
const MIN_PASSAGE = 2;

check('layout rule (section 8): on arenas 4–10 every gap between walls, trees, cliffs, thorns and the edges is shut (< 0.5) or at least 2 units', () => {
  for (const id of ARENAS_4_10) {
    const arena = arenaTemplate(id), list = blockers(arena), passages: string[] = [];
    let narrowest = Infinity;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (!list[i].samples.length && !list[j].samples.length) continue;
      const g = gapBetween(list[i], list[j]);
      assert(g < SHUT || g >= MIN_PASSAGE - 1e-9, `${arena.name}: ${list[i].name} — ${list[j].name}: a passage of ${g.toFixed(3)} units`);
      if (g >= SHUT) { narrowest = Math.min(narrowest, g); if (g < 2.5) passages.push(`${list[i].name} — ${list[j].name} ${g.toFixed(2)}`); }
    }
    console.log(`   ${arena.name}: narrowest passage ${narrowest.toFixed(2)}${passages.length ? `; under 2.5: ${passages.join('; ')}` : ''}`);
  }
});

/** Cells of a 0.1 grid where the hero's circle stands (walls, trees, cliffs and the edges kept off), with or without thorns. */
function walkGrid(arena: ArenaTemplate, thorns: boolean, water = true): { cols: number; rows: number; free: Uint8Array; at: (p: Vec) => number } {
  const cell = GRID, cols = Math.round(arena.width / cell), rows = Math.round(arena.height / cell), r = heroRadius(defaultParams());
  const free = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const p = { x: (col + 0.5) * cell, y: (row + 0.5) * cell };
    free[row * cols + col] = blockedAt(p, r, arena) || (!thorns && inThorns(p, arena)) || (!water && inWater(p, arena)) ? 0 : 1;
  }
  const at = (p: Vec): number => Math.min(rows - 1, Math.floor(p.y / cell)) * cols + Math.min(cols - 1, Math.floor(p.x / cell));
  return { cols, rows, free, at };
}
const GRID = 0.1;
/**
 * Length of the shortest walk of the hero's circle from `a` to `b` over the grid (8 neighbours, no corner cutting);
 * Infinity — no walk. `thorns` / `water` false keep the walk out of them.
 */
function walkLength(arena: ArenaTemplate, a: Vec, b: Vec, thorns: boolean, water = true): number {
  const grid = walkGrid(arena, thorns, water), { cols, rows, free } = grid, d = new Float64Array(free.length).fill(Infinity);
  const start = grid.at(a), goal = grid.at(b);
  if (!free[start] || !free[goal]) return Infinity;
  d[start] = 0;
  // A plain binary heap of [distance, cell].
  const heap: [number, number][] = [[0, start]];
  const push = (item: [number, number]): void => {
    heap.push(item);
    for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        let c = 2 * k + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[k][0] <= heap[c][0]) break;
        [heap[k], heap[c]] = [heap[c], heap[k]]; k = c;
      }
    }
    return top;
  };
  while (heap.length) {
    const [du, u] = pop();
    if (du > d[u]) continue;
    if (u === goal) return du * GRID;
    const col = u % cols, row = (u - col) / cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const n = r * cols + c;
      if (!free[n] || (dr && dc && (!free[row * cols + c] || !free[r * cols + col]))) continue;
      const nd = du + (dr && dc ? Math.SQRT2 : 1);
      if (nd < d[n]) { d[n] = nd; push([nd, n]); }
    }
  }
  return Infinity;
}
/** Connected parts of the free cells (4 neighbours): a label per cell, 0 — not free. */
function parts(grid: ReturnType<typeof walkGrid>): { label: Int32Array; sizes: number[] } {
  const { cols, rows, free } = grid, label = new Int32Array(cols * rows), sizes: number[] = [0];
  for (let start = 0; start < free.length; start++) {
    if (!free[start] || label[start]) continue;
    const id = sizes.length, stack = [start];
    label[start] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!, col = i % cols, row = (i - col) / cols;
      size++;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = col + dc, r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const n = r * cols + c;
        if (free[n] && !label[n]) { label[n] = id; stack.push(n); }
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

check('layout rule (section 8): no dead end — from the hero\'s start a walk without thorns and cliffs reaches the door, every button and every dry spot; with thorns, every spot', () => {
  for (const id of ARENAS_4_10) {
    const arena = arenaTemplate(id);
    for (const thorns of [false, true]) {
      const grid = walkGrid(arena, thorns), { label, sizes } = parts(grid);
      const home = label[grid.at(arena.heroStart)];
      assert(home > 0, `${arena.name}: the hero's start is not a dry free spot`);
      assert(sizes.length === 2, `${arena.name}: ${sizes.length - 1} separate parts${thorns ? '' : ' without thorns'} (cells ${sizes.slice(1).join(', ')})`);
      for (const [name, p] of [['door', arena.door], ...arena.buttons.map((b, i) => [`button ${i + 1}`, b] as const)] as const) {
        assert(label[grid.at(p)] === home, `${arena.name}: the ${name} is not reached on foot${thorns ? '' : ' without thorns'}`);
      }
    }
  }
});

check('start enemies and the hero\'s start of arenas 4–10: none over a cliff, in thorns or in water; the braziers and buttons stand on ground', () => {
  for (const id of ARENAS_4_10) {
    const arena = arenaTemplate(id), r = enemyBodyRadius(defaultParams());
    for (const p of [arena.heroStart, ...arena.enemies]) {
      assert(!cliffAt(p, r, arena) && !inThorns(p, arena) && !inWater(p, arena) && !blockedAt(p, r * 0.99, arena), `${arena.name}: (${p.x}, ${p.y}) stands on terrain`);
    }
    for (const p of [...arena.braziers ?? [], ...arena.buttons, arena.door]) assert(!overCliff(p, arena) && !inThorns(p, arena), `${arena.name}: object at (${p.x}, ${p.y}) on terrain`);
    // The start enemies are where the template puts them (no push out of an obstacle moved them).
    const sim = new Simulation({ arena: id, params: quiet(), seed: seedOf(1) });
    for (const [i, s] of arena.enemies.entries()) assert(dist(sim.world.enemies[i], s) < 1e-9, `${arena.name}: start enemy ${i + 1} moved`);
  }
});

// ---- 4 «Стена щитов»: М4 braziers ----

check('4 «Стена щитов»: a chain through a brazier takes a shieldbearer from its side — refused from the hero in front of the shield, taken with +2 from the brazier', () => {
  // The sandbox toggle «щит следит за героем» faces the shield to the hero (the check is about the brazier, not the facing).
  const sim = fight('shields', quiet({ shieldFollowsHero: true })), w = sim.world;
  assert(arenaTemplate('shields').braziers?.length === 2, 'two braziers');
  // The west brazier (5, 5); the bearer below it, the hero in front of the bearer and within R of the brazier.
  sim.command({ t: 'teleport', x: 6.4, y: 6.2 });
  const bearer = place(sim, 5, 6.6, 1, 3, 'shield');
  assert(enemyRefusal(w, bearer) === 'guarded' && sim.command({ t: 'begin', x: bearer.x, y: bearer.y }) === false, 'from the hero in front of the shield: «щит»');
  chainThrough(sim, [{ x: 5, y: 5 }, { x: bearer.x, y: bearer.y }], false);
  const plan = planChain(w);
  assert(plan.links[1].outcome?.available === 3 && plan.links[1].outcome.killed, `+2 after the brazier: ${plan.links[1].outcome?.available} against 3 HP`);
  assert(!planChain(w, [w.chain[1]]).links[0].outcome!.killed, 'without the brazier it would survive');
  sim.command({ t: 'release' });
  flight(sim);
  assert(!alive(w, bearer) && w.stats.kills === 1 && brazierAt(w, 5, 5).out !== undefined, 'the dash killed it; the brazier went out');
  assert(replays(sim), 'replay');
});

// ---- 5 «Стрелковая гряда»: М5 gorge ----

check('5 «Стрелковая гряда»: a ridge wall cuts the archer\'s line — behind it the hero is not aimed at; in a gap of the ridge the line is whole and hits; in front of the wall the line ends at it', () => {
  const sim = fight('archers', quiet({ archerFirstDelay: 0.5 }), 2), w = sim.world;
  // The left ridge: walls at x 5–6, y 0–2, 4–6, 8–10; gaps y 2–4 and 6–8. Behind the middle wall for 4 s: no aim, no hit.
  sim.command({ t: 'teleport', x: 4.2, y: 5 });
  const archer = place(sim, 8.5, 5, 0, 0, 'archer');
  let aimed = 0;
  ticks(sim, 240, () => { if (archer.vars.aim === 1) aimed++; });
  assert(aimed === 0 && w.hero.hp === w.hero.maxHp, `behind the wall: aimed ${aimed} ticks, hp ${w.hero.hp}`);
  // In the gap at y 3: the line is whole and the arrow hits.
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.2, y: 3 });
  const gap = place(sim, 8.5, 3, 0, 0, 'archer');
  runUntil(sim, () => gap.vars.aim === 1);
  assert(Math.abs(gap.vars.len - w.params.archerRange) < 1e-9, `through the gap the line is whole: ${gap.vars.len}`);
  runUntil(sim, () => gap.vars.aim !== 1);
  assert(w.hero.hp === w.hero.maxHp - w.params.archerDamage, `in the gap: hp ${w.hero.hp}`);
  // The hero in front of the middle wall: the line ends at the wall — an enemy behind it is safe.
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 6.7, y: 5 });
  const front = place(sim, 9.2, 5, 0, 0, 'archer'), behind = place(sim, 4.4, 5, 1, 0);
  runUntil(sim, () => front.vars.aim === 1);
  assert(front.vars.len < 3.3, `the wall cuts the line: ${front.vars.len.toFixed(2)} of ${w.params.archerRange}`);
  sim.command({ t: 'teleport', x: 6.7, y: 7 });
  runUntil(sim, () => front.vars.aim !== 1);
  assert(alive(w, behind), 'the enemy behind the wall is not hit');
  assert(replays(sim), 'replay');
});

// ---- 6 «Пороховой склад»: М2 cliff ----

check('6 «Пороховой склад»: a blast throws a survivor on the brink into the ravine — the player\'s kill; a chain crosses the ravine at its neck', () => {
  const sim = fight('powder', quiet(), 3), w = sim.world;
  // The east ravine: its west edge at y 1.2 is at x ≈ 10.0. The sapper and a tough enemy walk the brink.
  const sapper = place(sim, 8.6, 1.2, 1, 0, 'sapper'), victim = place(sim, 9.4, 1.2, 2, 5);
  sim.command({ t: 'teleport', x: 7.2, y: 1.2 });
  chainThrough(sim, [{ x: 8.6, y: 1.2 }]);
  const events = collect(sim, 240, () => !alive(w, victim));
  const fell = kills(events).find(k => k.enemyId === victim.id);
  assert(!alive(w, sapper) && fell?.fall === true && fell.source === 'blast' && fell.credited === true, `thrown into the ravine: ${JSON.stringify(fell)}`);
  assert(w.stats.kills === 2, `kills ${w.stats.kills}`);
  assert(replays(sim), 'replay');
  // The neck of the east ravine (y 4.2, x 10.35–11.65): links on both banks, the dash flies over and ends on the far one.
  const bridge = fight('powder', quiet(), 4), bw = bridge.world;
  bridge.command({ t: 'teleport', x: 8.6, y: 4.2 });
  for (const x of [9.95, 12.05]) place(bridge, x, 4.2);
  chainThrough(bridge, [{ x: 9.95, y: 4.2 }, { x: 12.05, y: 4.2 }]);
  const dash = flight(bridge);
  assert(dash.path.some(p => overCliff(p, bw.arena)) && dist(bw.hero, { x: 12.05, y: 4.2 }) < 1e-6 && bw.enemies.length === 0, 'over the ravine to the far bank');
  assert(dash.ticks <= Math.ceil(3.45 / bw.params.dashSpeed * 60) + 2, `the dash: ${dash.ticks} ticks`);
  // On foot the far bank is a long way round (below the ravine).
  const round = walkLength(bw.arena, { x: 8.6, y: 4.2 }, { x: 12.05, y: 4.2 }, true);
  assert(round > 2.2 * 3.45 && Number.isFinite(round), `on foot: ${round.toFixed(1)} units round the ravine`);
  console.log(`   across the neck: the dash ${dash.ticks} ticks over 3.45 units; on foot round the ravine ${round.toFixed(1)} units`);
  assert(replays(bridge), 'replay');
});

// ---- 7 «Колючие заросли»: М3 thorns ----

check('7 «Колючие заросли»: the hedge cuts the walk — the hero walking through it is pricked; a chain over it to the corner of the button is not', () => {
  const sim = fight('thorns', quiet()), w = sim.world, hp0 = w.hero.hp;
  // The west hedge at y 4: x ≈ 3.1–4.2; the corner with the first button is west of it.
  const events: WorldEvent[] = [];
  walk(sim, { x: 5.2, y: 4 }, { x: -1, y: 0 }, 60, x => { events.push(...x.events); x.events.length = 0; });
  assert(w.hero.x < 2.9 && pricks(events) >= 1 && w.hero.hp < hp0, `walked through the hedge: x ${w.hero.x.toFixed(2)}, pricks ${pricks(events)}, hp ${w.hero.hp}`);
  const chain = fight('thorns', quiet({ chainShield: 0 }), 2), cw = chain.world;
  chain.command({ t: 'teleport', x: 5.2, y: 4 });
  const inHedge = place(chain, 3.6, 4), beyond = place(chain, 2, 4);
  assert(inThorns(inHedge, cw.arena), 'a link stands in the hedge');
  chainThrough(chain, [{ x: 3.6, y: 4 }, { x: 2, y: 4 }]);
  const dash = flight(chain);
  const after = collect(chain, 90);
  assert(dash.path.some(p => inThorns(p, cw.arena)) && !alive(cw, beyond) && cw.hero.x < 2.9, 'the dash went over the hedge into the corner');
  assert(cw.hero.hp === cw.hero.maxHp && pricks(after) === 0, `over the hedge unhurt: hp ${cw.hero.hp}`);
  // A chain to the corner's button over the hedge: the button is pressed.
  chain.command({ t: 'teleport', x: 4.9, y: 2.2 });
  place(chain, 3.4, 2.2);
  const button = cw.objects.find(o => o.kind === 'button' && o.x === 1.5)!;
  chainThrough(chain, [{ x: 3.4, y: 2.2 }, { x: 1.5, y: 1.5 }]);
  flight(chain);
  assert(button.pressed && cw.hero.hp === cw.hero.maxHp, 'the button in the corner pressed from over the hedge');
  // The dry walk from the hero's start to each corner button goes round below the hedge — far longer than the straight line.
  const arena = arenaTemplate('thorns');
  for (const b of arena.buttons.filter(b => b.y < 5)) {
    const dry = walkLength(arena, arena.heroStart, b, false), wet = walkLength(arena, arena.heroStart, b, true);
    assert(dry > 1.6 * dist(arena.heroStart, b) && dry > wet * 1.5, `to the button (${b.x}, ${b.y}): ${dry.toFixed(1)} round the hedge, ${wet.toFixed(1)} through it, ${dist(arena.heroStart, b).toFixed(1)} straight`);
    if (b.x < 8) console.log(`   from the start to a corner button: ${dry.toFixed(1)} units round the hedge, ${wet.toFixed(1)} through it`);
  }
  assert(replays(sim) && replays(chain), 'replay');
});

// ---- 8 «Брод»: М1 river ----

check('8 «Брод»: the crossing — walking in the river is ×0.5 (no dry way round), a dash through it keeps its full speed', () => {
  const sim = fight('ford', quiet()), w = sim.world;
  // The river at y 5: x ≈ 6.6–9.6, from the top edge to the bottom one.
  // No dry way to the door: the walk wades the river (the band runs from edge to edge).
  const arena = arenaTemplate('ford');
  assert(walkLength(arena, arena.heroStart, arena.door, true, false) === Infinity && Number.isFinite(walkLength(arena, arena.heroStart, arena.door, true)), 'no dry way round the river');
  const dry = walk(sim, { x: 2.5, y: 4.4 }, { x: 1, y: 0 }, 30), wet = walk(sim, { x: 7.2, y: 5 }, { x: 1, y: 0 }, 30);
  assert(Math.abs(wet / dry - w.params.waterSlow) < 0.03, `hero: ${wet.toFixed(3)} in the river vs ${dry.toFixed(3)} on the bank`);
  // A first group may have stepped out during the walks (the quiet pace sends one at the start): clear it.
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.4, y: 5 });
  const pts =[{ x: 6, y: 5 }, { x: 7.8, y: 5 }, { x: 9.6, y: 5 }, { x: 11, y: 5 }];
  for (const p of pts) place(sim, p.x, p.y);
  chainThrough(sim, pts);
  const dash = flight(sim);
  assert(dash.path.some(p => inWater(p, w.arena)) && dash.ticks <= Math.ceil(6.6 / w.params.dashSpeed * 60) + 2, `the dash: ${dash.ticks} ticks`);
  assert(dist(w.hero, pts[3]) < 1e-6 && w.enemies.length === 0, `on the far bank, all four killed: hero ${w.hero.x.toFixed(2)}, ${w.hero.y.toFixed(2)}, left ${w.enemies.map(e => `${e.kind} ${e.x.toFixed(1)},${e.y.toFixed(1)} hp ${e.hp}`)}`);
  console.log(`   0.5 s of walking: ${dry.toFixed(2)} on the bank, ${wet.toFixed(2)} in the river; the dash over 6.6 units: ${dash.ticks} ticks`);
  assert(replays(sim), 'replay');
});

// ---- 9 «Застава»: М2 cliff + М5 gorge ----

check('9 «Застава»: the yard on the brink — a blast throws a survivor into the ravine; the crowd comes in through a gate and along the ledge', () => {
  const sim = fight('outpost', quiet(), 5), w = sim.world;
  // The ravine's east edge at y 4.5 is x 3.0.
  place(sim, 4.5, 4.5, 1, 0, 'sapper');
  const victim = place(sim, 3.7, 4.5, 2, 5);
  sim.command({ t: 'teleport', x: 5.9, y: 4.5 });
  chainThrough(sim, [{ x: 4.5, y: 4.5 }]);
  const events = collect(sim, 240, () => !alive(w, victim));
  const fell = kills(events).find(k => k.enemyId === victim.id);
  assert(fell?.fall === true && fell.source === 'blast' && fell.credited === true, `thrown into the ravine: ${JSON.stringify(fell)}`);
  assert(replays(sim), 'replay');
  // An enemy below the south palisade walks to the hero in the yard: it goes in through the south gate (x 7–9).
  const walkIn = (from: Vec, hero: Vec, lineY: number): number => {
    const s = fight('outpost', quiet({ enemySpeed: 1.2 }), 6), sw = s.world;
    s.command({ t: 'teleport', x: hero.x, y: hero.y });
    const e = place(s, from.x, from.y);
    let crossedAt = NaN, prev = { x: e.x, y: e.y };
    runUntil(s, () => dist(e, sw.hero) < 0.8, 60 * 30, () => {
      if (Number.isNaN(crossedAt) && (prev.y - lineY) * (e.y - lineY) <= 0 && prev.y !== e.y) crossedAt = e.x;
      prev = { x: e.x, y: e.y };
    });
    assert(dist(e, sw.hero) < 0.8 && sw.enemies.every(x => !overCliff(x, sw.arena)), `the enemy from (${from.x}, ${from.y}) reached the hero`);
    assert(replays(s), 'replay');
    return crossedAt;
  };
  const south = walkIn({ x: 3.6, y: 9 }, { x: 6.2, y: 4.8 }, 6.9);
  assert(south >= 7 && south <= 9, `through the south gate: crossed the palisade at x ${south.toFixed(2)}`);
  // From the north-west corner (above the palisade, by the ravine): along the ledge between the ravine and the palisade.
  const ledge = walkIn({ x: 4.6, y: 0.8 }, { x: 4.6, y: 4.8 }, 2.7);
  assert(ledge > 3.3 && ledge < 5.6, `along the ledge: crossed y 2.7 at x ${ledge.toFixed(2)}`);
});

// ---- 10 «Последний рубеж»: М1 pond + М4 braziers ----

check('10 «Последний рубеж»: the big pond slows walking; a chain through a brazier at its bank gives the rest +2', () => {
  const sim = fight('last-stand', quiet()), w = sim.world;
  const dry = walk(sim, { x: 6, y: 5 }, { x: 0, y: 1 }, 30), wet = walk(sim, { x: 11, y: 4.2 }, { x: 0, y: 1 }, 30);
  assert(inWater({ x: 11, y: 5 }, w.arena) && Math.abs(wet / dry - w.params.waterSlow) < 0.03, `hero: ${wet.toFixed(3)} in the pond vs ${dry.toFixed(3)} on the bank`);
  // The north brazier (8, 2.2); a tough enemy wading at the pond's edge.
  sim.command({ t: 'teleport', x: 8, y: 3.8 });
  const e1 = place(sim, 9.6, 2.4, 2, 0), e2 = place(sim, 10.2, 3.9, 2, 4);
  assert(inWater(e2, w.arena), 'the second one wades');
  chainThrough(sim, [{ x: 8, y: 2.2 }, { x: e1.x, y: e1.y }, { x: e2.x, y: e2.y }], false);
  const plan = planChain(w);
  assert(plan.kills === 2 && plan.links[2].outcome?.available === 4, `with the brazier: ${plan.links[2].outcome?.available} against 4 HP`);
  assert(!planChain(w, [w.chain[1], w.chain[2]]).links[1].outcome!.killed, 'without the brazier the wader would survive');
  sim.command({ t: 'release' });
  flight(sim);
  assert(!alive(w, e1) && !alive(w, e2) && brazierAt(w, 8, 2.2).out !== undefined, 'the dash killed both');
  assert(replays(sim), 'replay');
});

// ---- Spawning and determinism ----

check('arenas 4–10: newcomers\' markers never stand over a cliff or in water, no enemy stands over a cliff (3 seeds × 30 s)', () => {
  for (const id of ARENAS_4_10) {
    let markers = 0;
    for (const k of [1, 2, 3]) {
      const sim = new Simulation({ arena: id, params: harmless(), seed: seedOf(k + 90), record: true }), w = sim.world, r = enemyBodyRadius(w.params) * 0.99;
      const seen = new Set<number>();
      for (let i = 0; i < 60 * 30; i++) {
        sim.command({ t: 'walk', x: Math.round(Math.cos(i / 90)), y: Math.round(Math.sin(i / 70)) });
        sim.tick();
        w.events.length = 0;
        for (const m of w.markers) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          assert(!cliffAt(m, r - 1e-9, w.arena) && !inWater(m, w.arena), `${id}: a marker at (${m.x.toFixed(2)}, ${m.y.toFixed(2)}) on terrain`);
        }
        assert(w.enemies.every(e => !overCliff(e, w.arena)) && !overCliff(w.hero, w.arena), `${id}: a body over the cliff`);
      }
      markers += seen.size;
      if (k === 1) assert(replays(sim), 'replay');
    }
    assert(markers > 40, `${id}: markers ${markers}`);
  }
});

/** Builds the longest chain it greedily can (enemies, braziers, crystals), then releases it — as the bot of terrain.spec.ts. */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind === 'brazier')].sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w)].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}
const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

check('arenas 4–10: a bot fight of 40 s (walk, chains, jumps) replays from its journal to the same hash at every checkpoint; seeds differ', () => {
  for (const [k, id] of ARENAS_4_10.entries()) {
    const finals: string[] = [];
    for (const s of [0, 1]) {
      const p = defaultParams();
      p.heroHp = 40;
      const sim = new Simulation({ arena: id, params: p, seed: seedOf(120 + k * 2 + s), record: true }), w = sim.world;
      const checkpoints: string[] = [];
      let thorny = 0, braziers = 0, falls = 0;
      for (let tick = 0; tick < 2400 && w.status === 'playing'; tick++) {
        if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
        if (tick % 300 === 150) { sim.command({ t: 'energy', value: 2 }); sim.command({ t: 'jump', x: w.hero.x + 2.5, y: w.hero.y - 1 }); }
        if (tick === 1500) sim.command({ t: 'goals' });
        if (tick % 40 === 15) playChain(sim);
        sim.tick();
        for (const ev of w.events) { if (ev.type === 'hit' && ev.source === 'thorns') thorny++; if (ev.type === 'brazier' && !ev.lit) braziers++; if (ev.type === 'kill' && ev.fall) falls++; }
        w.events.length = 0;
        if (w.tick % 300 === 0) checkpoints.push(sim.hash());
      }
      const again: string[] = [];
      const replayed = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), r => { r.world.events.length = 0; if (r.world.tick % 300 === 0) again.push(r.hash()); });
      assert(checkpoints.length >= 1 && checkpoints.length === again.length && checkpoints.every((h, i) => again[i] === h), `${id}: checkpoints ${checkpoints.length} vs ${again.length}, status ${w.status} at ${w.tick}`);
      assert(replayed.hash() === sim.hash(), `${id}: final hash`);
      finals.push(sim.hash());
      if (s === 0) console.log(`   ${id}: ${w.tick} ticks, kills ${w.stats.kills}, hp ${w.hero.hp}, thorn pricks ${thorny}, braziers taken ${braziers}, falls ${falls}`);
    }
    assert(finals[0] !== finals[1], `${id}: two seeds, two fights`);
  }
});

console.log(`realtime-slice-terrain: ${checks} checks passed`);
