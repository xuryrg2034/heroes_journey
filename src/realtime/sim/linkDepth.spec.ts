/**
 * П1 «Глубина звена» (sim/linkDepth.ts; docs/realtime-prototype.md, «Глубина звена»). Node only:
 * `npm run test:realtime-link-depth`.
 *
 * The test does not repeat the search. For a candidate with number N it
 * - draws the found path with journal commands (`begin` / `drag`), releases it and runs the dash: the dash strikes all N
 *   enemy links, and only the last one may survive;
 * - in small scenes enumerates every chain from that candidate through the game's own input (`drag` commands on the
 *   world, the chain redrawn from scratch for each try) and finds none longer than N.
 * Also: N is 1 (no number) for a lone or a surviving candidate; crystals carry the path and are not counted; computing the
 * numbers leaves the world hash unchanged; the cost of one search of all candidates on a dense crowd is printed.
 */
import { hashWorld } from './hash';
import { LINK_DEPTH_MAX, LINK_DEPTH_SHOWN, linkDepth, linkDepths, type LinkDepth } from './linkDepth';
import { nextCandidates } from './chain';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import { Rng } from './rng';
import type { Vec } from './geometry';
import type { ChainLink, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  console.log(`ok - ${name}`);
}

const HERO = { x: 8, y: 5 };

/** Nothing moves or comes: only what the scene places acts, and nothing hurts the hero. */
function quietParams(): Params {
  const p = defaultParams();
  Object.assign(p, { enemySpeed: 0, speedSpread: 0, baseIntervalMin: 1000, baseIntervalMax: 1000, baseFloor: 0, contactDamage: 0, loopEnabled: false, killGoal: 500 });
  return p;
}

interface Body { x: number; y: number; color: number; hp: number; kind?: 'basic' | 'shield' }
interface Scene { enemies: Body[]; crystals?: Vec[]; params?: Partial<Params> }

/** A recorded simulation with the scene placed by journal commands at tick 0 (the arena «Убить 30»). */
function build(scene: Scene, seed = 1): Simulation {
  const params = { ...quietParams(), ...scene.params ?? {} };
  const sim = new Simulation({ arena: 'kills', params, seed, record: true });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: HERO.x, y: HERO.y });
  for (const b of scene.enemies) sim.command({ t: 'place', x: b.x, y: b.y, color: b.color, hp: b.hp, kind: b.kind ?? 'basic' });
  for (const c of scene.crystals ?? []) sim.command({ t: 'crystal', x: c.x, y: c.y, value: 0 });
  return sim;
}

const pointOf = (w: World, l: ChainLink): Vec => {
  const at = l.kind === 'enemy' ? w.enemies.find(e => e.id === l.id) : w.objects.find(o => o.id === l.id);
  assert(at, `link ${l.kind} ${l.id} is on the arena`);
  return { x: at.x, y: at.y };
};
const sameLinks = (a: readonly ChainLink[], b: readonly ChainLink[]): boolean => a.length === b.length && a.every((l, i) => l.kind === b[i].kind && l.id === b[i].id);

/** Draws `links` from an empty chain with journal commands, as the pointer would: begin on the first, drag over the rest. */
function draw(sim: Simulation, links: readonly ChainLink[]): boolean {
  const w = sim.world;
  sim.command({ t: 'cancel' });
  if (!links.length) return true;
  const first = pointOf(w, links[0]);
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (const l of links.slice(1)) { const p = pointOf(w, l); sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' }); }
  return sameLinks(w.chain, links);
}

/**
 * Every chain from `first` (after `base`) through the game's input: each enemy and passable object is tried as the next
 * link by a `drag` on its point, the chain redrawn from scratch for each try. Returns the most enemy links after `base`.
 */
function bruteForce(sim: Simulation, base: readonly ChainLink[], first: ChainLink): number {
  const w = sim.world;
  const targets = (): ChainLink[] => [
    ...w.enemies.map(e => ({ kind: 'enemy' as const, id: e.id })),
    ...w.objects.filter(o => o.kind === 'crystal' || o.kind === 'loot' || o.kind === 'brazier').map(o => ({ kind: 'object' as const, id: o.id })),
  ];
  let best = 0;
  const visit = (links: ChainLink[], count: number): void => {
    best = Math.max(best, count);
    if (count >= LINK_DEPTH_MAX) return;
    for (const t of targets()) {
      if (links.some(l => l.kind === t.kind && l.id === t.id)) continue;
      const next = [...links, t];
      if (!draw(sim, next)) continue;
      visit(next, count + (t.kind === 'enemy' ? 1 : 0));
    }
  };
  if (draw(sim, [...base, first])) visit([...base, first], 1);
  sim.command({ t: 'cancel' });
  return best;
}

/** From the journal of `sim` (the scene and the base chain), a fresh world: draws base + path, releases, runs the dash. */
function dashThrough(journal: Journal, base: readonly ChainLink[], d: LinkDepth): { hits: Extract<WorldEvent, { type: 'chainHit' }>[]; drawn: boolean } {
  const sim = replay(journal), w = sim.world;
  const drawn = draw(sim, [...base, ...d.path]);
  const hits: Extract<WorldEvent, { type: 'chainHit' }>[] = [];
  if (!drawn) return { hits, drawn };
  w.events.length = 0;
  sim.command({ t: 'release' });
  for (let t = 0; t < 600 && (w.move || t === 0); t++) {
    sim.tick();
    for (const ev of w.events) if (ev.type === 'chainHit') hits.push(ev);
    w.events.length = 0;
  }
  return { hits, drawn };
}

/** The dash strikes every enemy link of the path; a survivor (no plate) only as the last one. */
function assertDashPasses(journal: Journal, base: readonly ChainLink[], d: LinkDepth, label: string): void {
  const { hits, drawn } = dashThrough(journal, base, d);
  assert(drawn, `${label}: the path ${JSON.stringify(d.path)} is drawn by begin/drag`);
  const ids = d.path.filter(l => l.kind === 'enemy').map(l => l.id);
  assert(ids.length === d.depth, `${label}: the path has ${ids.length} enemy links for N ${d.depth}`);
  const struck = hits.filter(h => ids.includes(h.enemyId));
  assert(struck.length === ids.length && ids.every((id, i) => struck[i]?.enemyId === id),
    `${label}: the dash strikes all ${ids.length} links in order (${struck.map(h => h.enemyId).join(',')} of ${ids.join(',')})`);
  struck.forEach((h, i) => assert(h.killed || h.plates !== undefined || i === struck.length - 1, `${label}: link ${i + 1} of ${struck.length} survives before the end`));
}

// ---- Fixed scenes ----

/** A line of weak red enemies to the right of the hero, 1.2 apart. */
const line = (n: number, color = 0, hp = 0): Body[] => Array.from({ length: n }, (_, i) => ({ x: HERO.x + 1.2 * (i + 1), y: HERO.y, color, hp }));

check('a line of 4 weak enemies: the first gives N 4, the dash strikes all 4; a line of 9 is capped at 6', () => {
  const sim = build({ enemies: line(4) });
  const [d] = linkDepths(sim.world);
  assert(d && d.depth === 4 && !d.cut, `N ${d?.depth}`);
  assertDashPasses(sim.exportJournal()!, [], d, 'line 4');
  const long = build({ enemies: [...line(5), ...line(4).map(b => ({ ...b, y: b.y + 1.2 }))].map((b, i) => (i < 5 ? b : { ...b, x: HERO.x + 6 - 1.2 * (i - 5) })) });
  const depths = linkDepths(long.world);
  const top = depths.reduce((a, b) => (b.depth > a.depth ? b : a));
  assert(top.depth === LINK_DEPTH_MAX, `the long line is capped at ${LINK_DEPTH_MAX}, got ${top.depth}`);
  assertDashPasses(long.exportJournal()!, [], top, 'line capped');
});

check('a lone candidate and a candidate that survives give N 1 (no number); a survivor ends the path and still counts', () => {
  const lone = build({ enemies: [{ x: 9.2, y: 5, color: 0, hp: 0 }, { x: 12.5, y: 5, color: 0, hp: 0 }] });
  const ds = linkDepths(lone.world);
  assert(ds.length === 1 && ds[0].depth === 1 && ds[0].depth < LINK_DEPTH_SHOWN, `lone: ${JSON.stringify(ds)}`);
  // The tough one first: power 1 against HP 4 — it survives, nothing may follow.
  const tough = build({ enemies: [{ x: 9.2, y: 5, color: 0, hp: 4 }, { x: 10.4, y: 5, color: 0, hp: 0 }] });
  const [t] = linkDepths(tough.world);
  assert(t.depth === 1, `a surviving candidate: N ${t.depth}`);
  // Weak, weak, then HP 5 (power 3 wounds it): N 3, the third survives at the end; the fourth after it is not counted.
  const stop = build({ enemies: [...line(2), { x: HERO.x + 3.6, y: HERO.y, color: 0, hp: 5 }, { x: HERO.x + 4.8, y: HERO.y, color: 0, hp: 0 }] });
  const s = linkDepths(stop.world).find(d => d.id === stop.world.enemies[0].id)!;
  assert(s.depth === 3, `a survivor ends the path: N ${s.depth}`);
  assertDashPasses(stop.exportJournal()!, [], s, 'survivor at the end');
});

check('a crystal carries the path to another colour and is not counted', () => {
  const scene: Scene = {
    enemies: [{ x: 9.2, y: 5, color: 0, hp: 0 }, { x: 10.4, y: 5, color: 0, hp: 0 }, { x: 12.8, y: 5, color: 1, hp: 0 }, { x: 14.0, y: 5, color: 1, hp: 0 }, { x: 14.0, y: 6.2, color: 1, hp: 0 }],
    crystals: [{ x: 11.6, y: 5 }],
  };
  const sim = build(scene), w = sim.world;
  const d = linkDepth(w, w.enemies[0]);
  assert(d.depth === 5, `two red + three blue through the crystal: N ${d.depth}`);
  assert(d.path.some(l => l.kind === 'object'), 'the path goes through the crystal');
  assertDashPasses(sim.exportJournal()!, [], d, 'crystal');
  const without = build({ enemies: scene.enemies });
  assert(linkDepth(without.world, without.world.enemies[0]).depth === 2, 'without the crystal: N 2');
});

check('with a chain drawn: the numbers are for the next links of that chain, and the dash of chain + path passes', () => {
  const sim = build({ enemies: [{ x: 9.2, y: 5, color: 0, hp: 0 }, { x: 10.1, y: 6.1, color: 0, hp: 0 }, { x: 9.4, y: 3.5, color: 0, hp: 0 }, { x: 11.3, y: 6.3, color: 0, hp: 0 }, { x: 12.5, y: 6.3, color: 0, hp: 0 }] });
  const w = sim.world, base: ChainLink[] = [{ kind: 'enemy', id: w.enemies[0].id }];
  assert(draw(sim, base), 'the first link is drawn');
  const ds = linkDepths(w);
  const down = ds.find(d => d.id === w.enemies[1].id), up = ds.find(d => d.id === w.enemies[2].id);
  assert(down && up && down.depth === 3 && up.depth === 1, `down ${down?.depth}, up ${up?.depth}`);
  assertDashPasses(sim.exportJournal()!, base, down, 'drawn chain');
});

check('computing the numbers changes nothing: the world hash and the drawn chain stay', () => {
  const sim = build({ enemies: [...line(4), ...line(3, 1).map(b => ({ ...b, y: 6.2 }))], crystals: [{ x: 12, y: 6.2 }] });
  const w = sim.world;
  const h0 = hashWorld(w);
  linkDepths(w);
  assert(hashWorld(w) === h0, 'the hash with no chain drawn');
  draw(sim, [{ kind: 'enemy', id: w.enemies[0].id }]);
  const h1 = hashWorld(w), chain = JSON.stringify(w.chain), colors = JSON.stringify(w.enemies.map(e => [e.id, e.color, e.hp, e.x, e.y]));
  for (let i = 0; i < 3; i++) linkDepths(w);
  assert(hashWorld(w) === h1 && JSON.stringify(w.chain) === chain && JSON.stringify(w.enemies.map(e => [e.id, e.color, e.hp, e.x, e.y])) === colors, 'the hash with a chain drawn');
  // The ticks after give the same hash as a world nobody searched.
  const twin = replay(sim.exportJournal()!);
  for (let t = 0; t < 30; t++) { sim.tick(); twin.tick(); }
  assert(sim.hash() === twin.hash(), 'the run after the search plays as without it');
});

// ---- Random small scenes: the dash and the exhaustive enumeration ----

check('random small scenes on 12 seeds: every number ≥ 2 is a path the dash passes, and no chain from the candidate is longer', () => {
  let shown = 0, compared = 0, deep = 0, withBase = 0;
  for (let k = 1; k <= 12; k++) {
    const seed = Math.imul(k, 2654435761) >>> 0, rng = new Rng(seed);
    const enemies: Body[] = [];
    while (enemies.length < 7) {
      const a = rng.next() * Math.PI * 2, r = 0.9 + rng.next() * 2.6;
      const p = { x: HERO.x + r * Math.cos(a), y: HERO.y + r * Math.sin(a) };
      if (enemies.some(b => Math.hypot(b.x - p.x, b.y - p.y) < 0.75)) continue;
      enemies.push({ ...p, color: rng.next() < 0.65 ? 0 : 1, hp: [0, 0, 0, 1, 2, 3][Math.floor(rng.next() * 6)], kind: rng.next() < 0.15 ? 'shield' : 'basic' });
    }
    const crystals = rng.next() < 0.5 ? [{ x: HERO.x + (rng.next() - 0.5) * 4, y: HERO.y + (rng.next() - 0.5) * 4 }] : [];
    const sim = build({ enemies, crystals }, seed);
    // Every other seed: one link already drawn (the nearest candidate), the numbers are for its next links.
    let base: ChainLink[] = [];
    if (k % 2 === 0) {
      const first = nextCandidates(sim.world)[0];
      if (first) { base = [{ kind: 'enemy', id: first.id }]; draw(sim, base); withBase++; }
    }
    const journal = sim.exportJournal()!;
    const h = sim.hash();
    for (const d of linkDepths(sim.world)) {
      const label = `seed ${seed} candidate ${d.id}`;
      assert(!d.cut, `${label}: a small scene is searched whole`);
      const brute = bruteForce(replay(journal), base, { kind: 'enemy', id: d.id });
      assert(brute === d.depth, `${label}: the search says N ${d.depth}, the enumeration finds ${brute}`);
      compared++;
      if (d.depth < LINK_DEPTH_SHOWN) continue;
      shown++;
      if (d.depth >= 3) deep++;
      assertDashPasses(journal, base, d, label);
    }
    assert(sim.hash() === h, `seed ${seed}: the search left the world as it was`);
  }
  assert(shown >= 12 && deep >= 4 && withBase >= 4, `enough numbers checked: shown ${shown}, N ≥ 3 ${deep}, with a drawn chain ${withBase}`);
  console.log(`   compared ${compared} candidates with the enumeration, ${shown} numbers ≥ 2 dashed through (${deep} of N ≥ 3)`);
});

// ---- Cost on a dense crowd ----

check('cost: one search of all candidates on a dense crowd of 48 (printed; the budget bounds it)', () => {
  const enemies: Body[] = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) enemies.push({ x: 4 + i * 1.05 + (j % 2) * 0.5, y: 2.4 + j * 1.0, color: (i + j) % 3 === 0 ? 1 : 0, hp: (i * 7 + j * 3) % 5 === 0 ? 2 : 0 });
  const sim = build({ enemies: enemies.filter(b => Math.hypot(b.x - HERO.x, b.y - HERO.y) > 0.7) });
  const w = sim.world;
  const first = nextCandidates(w)[0];
  assert(first, 'a candidate near the hero');
  draw(sim, [{ kind: 'enemy', id: first.id }]);
  const times: number[] = [];
  let result: LinkDepth[] = [];
  for (let i = 0; i < 20; i++) { const t0 = performance.now(); result = linkDepths(w); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  const expanded = result.reduce((a, d) => a + d.expanded, 0);
  assert(result.every(d => d.expanded <= 200), 'no candidate expands more than the budget');
  console.log(`   ${w.enemies.length} enemies, ${result.length} candidates, depths ${result.map(d => d.depth).join(',')}, cut ${result.filter(d => d.cut).length}, expanded ${expanded}; median ${times[10].toFixed(2)} ms, max ${times[19].toFixed(2)} ms`);
});

console.log(`${checks} checks passed`);
