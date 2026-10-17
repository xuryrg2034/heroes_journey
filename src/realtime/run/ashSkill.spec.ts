/**
 * Task 45 «Испытание VI–VIII» (design 16.10.2026, docs/design-notes/task-45-trial-skill.md; docs/realtime-slice.md, «Испытание»):
 * the levels of chain skill, cumulative over I–V, in every fight of the run (forest, garrison, bosses, events):
 * VI — the focus reserve ×0.75 (the slowdown and the refill stay; stacks with «Тяжёлый клинок»);
 * VII — the enemies' walk ×1.1 (the scope of the build's walk factor);
 * VIII — the fifth chain colour on every row (hand-placed start enemies keep theirs; the rolled first wave, top-ups and waves
 * bring colour 4).
 * Real fights played by journal commands and walked runs (the run's own commands); journals replay to the same hash, and a
 * journal without the level's kit fields plays the world of the level below.
 */
import { registerArena } from '../sim/arenas';
import { focusMaxOf } from '../sim/build';
import { FORMS, RELICS } from '../sim/buildIds';
import { colorGroups } from '../sim/chain';
import { HEAVY_BLADE_FOCUS } from '../sim/relics';
import { worldState } from '../sim/hash';
import { kitOf, MAX_COLORS, type Loadout } from '../sim/kit';
import { defaultParams, type Params } from '../sim/params';
import { replay, Simulation, type Journal } from '../sim/simulation';
import type { World } from '../sim/world';
import { runRow } from './arenaPools';
import { rtGarrisonNodeId } from './garrison';
import { walkRun } from './metaWalk.testkit';
import {
  RT_ASH_COLOR_COUNT, RT_ASH_FOCUS_SCALE, RT_ASH_WALK_SCALE, createRtRun, rtArenaLoadout, rtArenaParams, rtArenaRules, rtMapNodes, rtNode, rtRunParams,
  type RtAshLevel, type RtRunState,
} from './rtRun';
import { rtRunXp } from './rtMeta';
import { assert, same, seedOf } from './runFight.testkit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const OPEN = 'ash-skill-open';
registerArena({
  id: OPEN, name: 'Поле навыка', summary: 'Тест испытания VI–VIII', goal: 'kills', width: 16, height: 10,
  heroStart: { x: 8, y: 5 }, obstacles: [], buttons: [], door: { x: 15.3, y: 5 }, enemies: [], killGoal: 9999,
});
const TICKS = (s: number): number => Math.round(s * 60);

/** Nothing hurts the hero; `still` — no newcomers either. */
function harmless(still: boolean, extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.porcupineQuills = 0; p.lynxDamage = 0;
  if (still) { p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.reaperEnabled = false; }
  return Object.assign(p, extra);
}
/** A run of level `ash` whose open battle is an ordinary node of run row `row`, played on the bare test arena. */
function rowRun(row: number, ash: RtAshLevel, k: number, extra: Partial<RtRunState> = {}): RtRunState {
  for (let s = 0; s < 30; s++) {
    const base = createRtRun(seedOf(700 + 31 * k + s), { ash });
    const node = rtMapNodes(base).find(n => runRow(n.row) === row && n.type === 'battle');
    if (node) return { ...structuredClone(base), ...extra, pending: { kind: 'battle', nodeId: node.id, arena: OPEN, seed: seedOf(k), battle: 'battle' } };
  }
  throw new Error(`no node of row ${row}`);
}
/** The open battle of `run` with the run's params over `base` and its loadout, journalled (as main.ts starts it). */
function fightOf(run: RtRunState, base: Params): Simulation {
  const pending = run.pending;
  assert(pending?.kind === 'battle', 'an open battle');
  return new Simulation({
    arena: pending.arena, params: rtArenaParams(rtArenaRules(run), rtRunParams(base)), seed: pending.seed, record: true, loadout: rtArenaLoadout(run),
    hero: { hp: 999, maxHp: 999 }, ...pending.roster !== undefined ? { roster: pending.roster } : {},
  });
}
const journalOf = (sim: Simulation): Journal & { loadout: Loadout } => JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal & { loadout: Loadout };
const replays = (sim: Simulation): boolean => replay(journalOf(sim)).hash() === sim.hash();
/** The world without its params (the journal's params are hashed too; the rest must be the same). */
const stateOf = (w: World): string => { const { params: _p, ...rest } = worldState(w) as Record<string, unknown>; return JSON.stringify(rest); };
function tick(sim: Simulation, n: number, seen?: (w: World) => void): void {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); seen?.(sim.world); sim.world.events.length = 0; }
}

/**
 * VI: a held chain keeps the time slowed while the focus lasts. Real seconds of slowdown — focusing ticks × the real length of a
 * tick in focus; the refill after the cancel — ticks at 1 s/s until full.
 */
function focusRun(ash: RtAshLevel, k: number, talismans: string[] = []): { start: number; max: number; held: number; refill: number; sim: Simulation } {
  const run = rowRun(2, ash, k, talismans.length ? { talismans } : {});
  const sim = fightOf(run, harmless(true, { enemySpeed: 0, speedSpread: 0 })), w = sim.world;
  const start = w.focus, max = focusMaxOf(w), realTick = (1 / 60) / w.params.focusSlow;
  sim.command({ t: 'place', x: 9, y: 5, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: 9, y: 5 });
  assert(w.chain.length === 1, 'the chain started');
  let held = 0;
  tick(sim, TICKS(10), world => { if (world.focusing) held++; });
  // Not the whole hold: the ticks focused stop once the focus is out.
  assert(!w.focusing && w.focus === 0, `the focus ran out (${w.focus})`);
  sim.command({ t: 'cancel' });
  let refill = 0;
  tick(sim, TICKS(10), world => { if (world.focus < focusMaxOf(world) - 1e-9) refill++; });
  return { start, max, held: held * realTick, refill: (refill + 1) / 60, sim };
}

check('VI (real held chains, 3 seeds): the focus starts at 2,25 s and keeps the time slowed for 2,25 real seconds at VI (3 s at V); the refill is still 1 s per second (2,25 s from empty); the HUD bar reads 75 %; with «Тяжёлый клинок» 3 × 0,5 × 0,75', () => {
  for (let k = 1; k <= 3; k++) {
    const five = focusRun(5, k), six = focusRun(6, k);
    assert(five.start === 3 && five.max === 3 && six.start === 3 * RT_ASH_FOCUS_SCALE && six.max === 2.25, `seed ${k}: start ${five.start} / ${six.start}`);
    // One tick of focus is 1/15 real s (×0,25): 3 s — 45 ticks, 2,25 s — 34 (the last one partly).
    const near = (a: number, b: number): boolean => a >= b - 1e-9 && a <= b + 1 / 15 + 1e-9;
    assert(near(five.held, 3) && near(six.held, 2.25), `seed ${k}: held ${five.held} / ${six.held}`);
    assert(Math.abs(five.refill - 3) <= 1 / 60 + 1e-9 && Math.abs(six.refill - 2.25) <= 1 / 60 + 1e-9, `seed ${k}: refill ${five.refill} / ${six.refill}`);
    // The view's bar: `focusMaxOf` ÷ the panel's `focusMax` (view/main.ts).
    assert(six.max / six.sim.world.params.focusMax === 0.75, 'the bar 75 %');
    assert(replays(six.sim), `seed ${k}: replay`);
    // A VI journal without its kit field plays the V world.
    const journal = journalOf(six.sim);
    delete journal.loadout.focusScale;
    assert(stateOf(replay(journal).world) === stateOf(five.sim.world), `seed ${k}: the VI journal without focusScale = V`);
  }
  const blade = focusRun(6, 1, [RELICS.heavyBlade]);
  assert(blade.max === 3 * HEAVY_BLADE_FOCUS * RT_ASH_FOCUS_SCALE && blade.start === blade.max, `with the relic: ${blade.max}`);
});

/** VII: how far a lone enemy of `kind` walks toward the hero in `seconds` (no newcomers). */
function walked(ash: RtAshLevel, k: number, kind: string, seconds: number): { d: number; sim: Simulation } {
  const sim = fightOf(rowRun(2, ash, k), harmless(true)), w = sim.world;
  sim.command({ t: 'place', x: 1, y: 5, color: 1, hp: 1, kind });
  const e = w.enemies[w.enemies.length - 1], x0 = e.x, y0 = e.y;
  tick(sim, TICKS(seconds));
  return { d: Math.hypot(e.x - x0, e.y - y0), sim };
}

check('VII (real walks, 3 seeds, a normal, a slow and a fast kind): the enemies walk 1,1 times as far at VII as at VI; the VII journal without walkScale plays the VI world', () => {
  for (let k = 1; k <= 3; k++) {
    for (const kind of ['basic', 'shield', 'lynx']) {
      const six = walked(6, k, kind, 1), seven = walked(7, k, kind, 1);
      assert(six.d > 0.3 && Math.abs(seven.d / six.d - RT_ASH_WALK_SCALE) < 1e-6, `seed ${k} ${kind}: ${six.d} → ${seven.d}`);
      assert(replays(seven.sim), `seed ${k} ${kind}: replay`);
      const journal = journalOf(seven.sim);
      delete journal.loadout.walkScale;
      assert(stateOf(replay(journal).world) === stateOf(six.sim.world), `seed ${k} ${kind}: the VII journal without walkScale = VI`);
    }
  }
});

/** The colours of a fight's start enemies (the template's, hand-placed) and of everything that came after, in `seconds`. */
function colorsOf(sim: Simulation, seconds: number): { start: number[]; after: Set<number> } {
  const w = sim.world, start = new Set(w.enemies.map(e => e.id)), after = new Set<number>();
  const startColors = w.enemies.map(e => e.color);
  tick(sim, TICKS(seconds), world => {
    for (const e of world.enemies) if (!start.has(e.id) && e.kind !== 'reaper') after.add(e.color);
    for (const m of world.markers) after.add(m.color);
  });
  return { start: startColors, after };
}

/**
 * VIII: walked runs (the run's own commands; the walk loses no fight and goes on into the garrison) — the open battles of forest
 * row 1, rows 2–4, the Jailer's (row 5), rows 6+, the final, a garrison battle, «Псарня» and the Castellan's, each played for real at
 * VIII and at VII.
 */
check('VIII (walked runs, 3 seeds; forest row 1, rows 2–4, the Jailer (row 5), rows 6+, the final; the garrison, its kennel (hounds) and the Castellan): colour 4 comes with the newcomers at VIII and never at VII; the hand-placed start enemies keep their colours (0–3); the journal replays and without `colors` plays the VII world', () => {
  const played: string[] = [];
  for (const k of [1, 4, 7]) {
    const want = new Map<string, RtRunState>();
    walkRun({ k, create: { gift: 'mini', ash: 8, garrison: true }, each: state => {
      const pending = state.pending;
      if (pending?.kind !== 'battle') return;
      const node = rtNode(state, pending.nodeId)!, row = runRow(node.row), garrison = !!rtGarrisonNodeId(node.id);
      const key = garrison ? (node.type === 'boss' ? 'castellan' : pending.arena === 'g-kennel' ? 'kennel' : node.type === 'battle' ? 'garrison' : '') : node.type === 'checkpoint' ? 'jailer' : node.type === 'boss' ? 'final' : node.type === 'battle' && row === 1 ? 'row 1' : node.type === 'battle' && row <= 4 ? 'row 2–4' : ['battle', 'event', 'hard'].includes(node.type) && row >= 6 ? 'row 6+' : '';
      if (key && !want.has(key)) want.set(key, structuredClone(state));
    } });
    assert(['row 1', 'row 2–4', 'jailer', 'row 6+', 'final', 'garrison', 'kennel', 'castellan'].every(key => want.has(key)), `seed ${k}: fights met ${[...want.keys()]}`);
    for (const [key, run] of want) {
      const kit8 = rtArenaLoadout(run), seven = { ...structuredClone(run), ash: 7 as const };
      assert(kit8.colors === RT_ASH_COLOR_COUNT && rtArenaLoadout(seven).colors === undefined, `seed ${k} ${key}: the loadout's palette`);
      const sim8 = fightOf(run, harmless(false)), sim7 = fightOf(seven, harmless(false));
      const c8 = colorsOf(sim8, 30), c7 = colorsOf(sim7, 30);
      assert(c8.after.has(4) && [...c8.after].every(c => c >= 0 && c < MAX_COLORS), `seed ${k} ${key}: VIII newcomers ${[...c8.after]}`);
      assert(!c7.after.has(4), `seed ${k} ${key}: VII newcomers ${[...c7.after]}`);
      // Task 48: the Troll's parts take three colours of the fight's palette by the seed (spec 5: at VIII three of five) — not hand-placed.
      if (sim8.world.arena.id === 'troll') assert(c8.start.every(c => c >= 0 && c < MAX_COLORS) && c7.start.every(c => c >= 0 && c <= 3), `seed ${k} ${key}: the Troll's start ${c8.start} / ${c7.start}`);
      else assert(same(c8.start, c7.start) && c8.start.every(c => c >= 0 && c <= 3), `seed ${k} ${key}: start ${c8.start} / ${c7.start}`);
      assert(replays(sim8), `seed ${k} ${key}: replay`);
      const journal = journalOf(sim8);
      delete journal.loadout.colors;
      const back = replay(journal);
      assert(stateOf(back.world) === stateOf(sim7.world), `seed ${k} ${key}: the VIII journal without colors = VII`);
      played.push(`${k}:${key}:${sim8.world.arena.id}`);
    }
  }
  console.log(`   fights: ${played.join(', ')}`);
});

check('VIII, the colour mechanics (real commands): a chain of colour 4 takes its own colour and refuses colour 0; «Близнецы» pair 0–2 and 1–3, colour 4 has no twin; the chameleon turns 3 → 4 → 0', () => {
  const run = rowRun(2, 8, 1);
  // A chain of three enemies of colour 4 in a row (the panel's step: 1,4 apart), one of colour 0 after them.
  const sim = fightOf(run, harmless(true, { enemySpeed: 0, speedSpread: 0 })), w = sim.world;
  const points = [9.4, 10.8, 12.2].map(x => ({ x, y: 5 }));
  for (const p of points) sim.command({ t: 'place', x: p.x, y: p.y, color: 4, hp: 0, kind: 'basic' });
  const placed = w.enemies.slice(-3).map(e => e.id);
  sim.command({ t: 'place', x: 13.6, y: 5, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === 3, `colour 4 links: ${w.chain.length}`);
  sim.command({ t: 'drag', x: 13.6, y: 5, mode: 'full' });
  assert(w.chain.length === 3, 'colour 0 refused after colour 4');
  sim.command({ t: 'release' });
  tick(sim, TICKS(3));
  assert(placed.every(id => !w.enemies.some(e => e.id === id)) && w.stats.kills >= 3, `the chain of colour 4 killed its links (${w.stats.kills})`);
  assert(replays(sim), 'replay');
  // «Близнецы» (a run with the form): the groups of the five.
  const twins = fightOf({ ...structuredClone(run), talismans: [FORMS.twins] }, harmless(true));
  assert(same(colorGroups(twins.world), [[0, 2], [1, 3], [4]]), `twins: ${JSON.stringify(colorGroups(twins.world))}`);
  // The chameleon cycles through the five.
  const cham = fightOf(run, harmless(true, { enemySpeed: 0, speedSpread: 0 }));
  cham.command({ t: 'place', x: 3, y: 5, color: 3, hp: 1, kind: 'basic', elite: true, affixes: ['chameleon'] });
  const e = cham.world.enemies[cham.world.enemies.length - 1], turns: number[] = [];
  tick(cham, TICKS(cham.world.params.chameleonPeriod * 2 + 0.5), () => { if (turns[turns.length - 1] !== e.color) turns.push(e.color); });
  assert(same(turns.slice(0, 3), [3, 4, 0]), `chameleon: ${turns}`);
});

check('the old paths: a kit with factors 1 and 4 colours has none of the new fields; levels 0–V keep their loadouts free of them; the sandbox palette (`colorCount` 5) brings colour 4, the default 4 does not', () => {
  const ones = kitOf({ focusScale: 1, walkScale: 1, colors: 4 });
  assert(!('focusScale' in ones) && !('walkScale' in ones) && !('colors' in ones), 'the old kit');
  for (const ash of [0, 1, 2, 3, 4, 5] as const) {
    const kit = rtArenaLoadout(rowRun(3, ash, 2));
    assert(kit.focusScale === undefined && kit.walkScale === undefined && kit.colors === undefined, `level ${ash}: ${JSON.stringify(kit)}`);
  }
  const sandbox = (colorCount: number): Set<number> => {
    const sim = new Simulation({ arena: OPEN, params: harmless(false, { colorCount }), seed: seedOf(3) });
    return colorsOf(sim, 20).after;
  };
  assert(sandbox(5).has(4) && !sandbox(4).has(4), 'the sandbox palette');
});

check('XP (the existing formula): a won run of VI, VII, VIII earns ×1,6, ×1,7, ×1,8 of its base (rounded down)', () => {
  const walked8 = walkRun({ k: 2, create: { gift: 'mini', ash: 8, garrison: false } }).run;
  const base = rtRunXp({ ...walked8, ash: undefined }).total;
  for (const ash of [6, 7, 8] as const) {
    const got = rtRunXp({ ...walked8, ash }).total;
    assert(got === Math.floor(base * (10 + ash) / 10), `level ${ash}: ${got} of base ${base}`);
  }
});

console.log(`${checks} checks passed`);
