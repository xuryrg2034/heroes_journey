/**
 * Loop research, step 1 (docs/realtime-loop-research.md, sections 4.2 and 4.5): the reachability toggles. Node only:
 * `npm run test:realtime-loop-access`.
 *
 * - Off by default: `colorCount` 4, `colorsByRow` off; a world of a journal without the values plays the same fight to the bit
 *   (everything but the params in the hash is equal), and a run's loadout has no `colors`.
 * - The sandbox palette `colorCount`: newcomers take the first N colours and the colours of the arena's start enemies (as the
 *   turn-based palette: a marked target of another colour still gets partners), each of them, and no other; the chameleon
 *   cycles in the palette; the fight replays from its journal to the same hash.
 * - The run's palette by the row (`colorsByRow`): rows 1–2 — 2, 3–4 — 3, from 5 — 4 (no `colors`); the kit takes 2–3 only;
 *   a run arena with it replays to the same hash. A run plays the sandbox `colorCount` at 4.
 * - Mono groups in a run: the run keeps the panel's `groupColor` (not among `RUN_FORCED`).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { worldState } from './hash';
import { kitOf } from './kit';
import { defaultParams, runParams, sanitizeParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import { palette } from './spawn';
import type { Enemy } from './world';
import { createRtRun, rtArenaLoadout, rtColorsByRow, rtMapNodes, rtRunParams, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'loop-open', name: 'Открытое поле', summary: 'Тест петли', goal: 'kills', width: 16, height: 10,
  heroStart: { x: 8, y: 5 }, obstacles: [], buttons: [], door: { x: 15.3, y: 5 }, killGoal: 9999,
  // Two arena enemies of colour 3: the palette keeps it (colour 2 is out with 2 colours).
  enemies: [{ x: 2, y: 2, color: 3, hp: 2 }, { x: 14, y: 8, color: 3, hp: 2 }],
});

/** Harmless params: the hero cannot fall, the fight runs on. */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999;
  return Object.assign(p, extra);
}
/** Plays `seconds`, collecting every enemy that stepped onto the field (by id). */
function play(sim: Simulation, seconds: number): Map<number, Enemy> {
  const seen = new Map<number, Enemy>();
  for (let t = 0; t < seconds * 60; t++) {
    sim.tick();
    for (const e of sim.world.enemies) if (!seen.has(e.id)) seen.set(e.id, { ...e });
    sim.world.events.length = 0;
  }
  return seen;
}
const without = (state: unknown): unknown => { const s = { ...(state as Record<string, unknown>) }; delete s.params; return s; };

check('off by default: colorCount 4, colorsByRow off; a journal without the values plays the same fight to the bit', () => {
  const p = defaultParams();
  assert(p.colorCount === 4 && p.colorsByRow === false, 'the defaults');
  for (let k = 1; k <= 3; k++) {
    const old = harmless() as Partial<Params>;
    delete old.colorCount; delete old.colorsByRow;
    const a = new Simulation({ arena: 'loop-open', params: harmless(), seed: seedOf(k) });
    const b = new Simulation({ arena: 'loop-open', params: old as Params, seed: seedOf(k) });
    play(a, 40); play(b, 40);
    assert(JSON.stringify(without(worldState(a.world))) === JSON.stringify(without(worldState(b.world))), `seed ${k}: the same world`);
    assert(palette(b.world).join() === '0,1,2,3', 'a journal without the value — 4 colours');
  }
  // Sanitising: out of range is clamped, garbage keeps the default.
  // Task 45: the panel's top is 5 (the fifth chain colour, for the view's snapshots).
  assert(sanitizeParams({ colorCount: 1 }).colorCount === 2 && sanitizeParams({ colorCount: 9 }).colorCount === 5 && sanitizeParams({ colorCount: 5 }).colorCount === 5 && sanitizeParams({ colorCount: 'x' }).colorCount === 4, 'clamped');
});

check('sandbox colorCount 2 and 3: newcomers take the first N colours and the arena\'s colour 3, each of them, no other; the journal replays', () => {
  for (const [n, want] of [[2, '0,1,3'], [3, '0,1,2,3']] as const) {
    for (let k = 1; k <= 3; k++) {
      const sim = new Simulation({ arena: 'loop-open', params: harmless({ colorCount: n }), seed: seedOf(10 + k), record: true });
      const start = new Set(sim.world.enemies.map(e => e.id));
      const seen = play(sim, 60);
      const newcomers = [...seen.values()].filter(e => !start.has(e.id) && e.kind !== 'reaper');
      assert(newcomers.length > 15, `n ${n} seed ${k}: newcomers ${newcomers.length}`);
      const colors = [...new Set(newcomers.map(e => e.color))].sort((a, b) => a - b).join();
      assert(colors === want, `n ${n} seed ${k}: colours ${colors}`);
      assert([...start].every(id => seen.get(id)!.color === 3), 'the arena enemies keep colour 3');
      assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `n ${n} seed ${k}: replays`);
    }
  }
});

check('the chameleon cycles in the palette: with 2 colours and the arena\'s 3 it goes 1 → 3 → 0, never 2', () => {
  const sim = new Simulation({ arena: 'loop-open', params: harmless({ colorCount: 2, enemySpeed: 0, baseFloor: 0, baseIntervalMin: 1e6, baseIntervalMax: 1e6, maxEnemies: 1 }), seed: seedOf(30), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  const id = sim.command({ t: 'place', x: 3, y: 3, color: 1, hp: 1, kind: 'basic', elite: true, affixes: ['chameleon'] }) as number;
  const order: number[] = [];
  for (let t = 0; t < 30 * 60; t++) { sim.tick(); sim.world.events.length = 0; const e = sim.world.enemies.find(x => x.id === id); if (e && order[order.length - 1] !== e.color) order.push(e.color); }
  assert(order.length >= 4 && order.slice(0, 4).join() === '1,3,0,1' && !order.includes(2), `colours ${order.join(',')}`);
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'replays');
});

check('the run palette by the row: 1–2 — 2, 3–4 — 3, from 5 — 4; off — no colours in any loadout; the kit takes 2–3 only', () => {
  assert([1, 2, 3, 4, 5, 9].map(rtColorsByRow).join() === '2,2,3,3,4,4', 'the table');
  const base = createRtRun(seedOf(40)), rows = new Set<number>();
  for (const node of rtMapNodes(base)) {
    const row = runRow(node.row);
    if (row < 1 || row > 9 || rows.has(row)) continue;
    rows.add(row);
    const run: RtRunState = { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena: 'loop-open', seed: seedOf(row), battle: 'battle' } };
    assert(!('colors' in rtArenaLoadout(run)) && !('colors' in rtArenaLoadout(run, { colorsByRow: false })), `row ${row}: off — the loadout as before`);
    const on = rtArenaLoadout(run, { colorsByRow: true });
    assert(row <= 4 ? on.colors === rtColorsByRow(row) : !('colors' in on), `row ${row}: colours ${on.colors}`);
  }
  assert(rows.size >= 5, `rows ${[...rows].join(',')}`);
  for (const [colors, want] of [[2, 2], [3, 3], [4, undefined], [1, undefined], [Number.NaN, undefined]] as const) assert(kitOf({ colors }).colors === want, `kit of ${colors}`);
});

check('a run arena with the row palette: newcomers of 2 colours and the arena\'s, the run copy plays sandbox colorCount 4, the journal replays', () => {
  const panel = sanitizeParams({ colorCount: 3, colorsByRow: true, contactDamage: 0, heroHp: 999 });
  const params = rtRunParams(panel);
  assert(params.colorCount === 4 && params.colorsByRow && runParams(panel).colorCount === 4, 'the run plays 4 by the panel; its palette by the row');
  const sim = new Simulation({ arena: 'loop-open', params, seed: seedOf(50), record: true, loadout: { colors: 2 } });
  assert(sim.world.kit?.colors === 2 && palette(sim.world).join() === '0,1,3', 'the kit decides');
  const start = new Set(sim.world.enemies.map(e => e.id));
  const newcomers = [...play(sim, 60).values()].filter(e => !start.has(e.id) && e.kind !== 'reaper');
  assert(newcomers.length > 15 && newcomers.every(e => e.color !== 2), 'two colours and the arena\'s');
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'replays');
});

check('mono groups in a run: the run keeps the panel\'s groupColor', () => {
  assert(rtRunParams(sanitizeParams({ groupColor: 'mono' })).groupColor === 'mono' && rtRunParams(defaultParams()).groupColor === 'mixed', 'kept');
});

console.log(`${checks} checks passed`);
