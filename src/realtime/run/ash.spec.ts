/**
 * Task 18 «Испытание I–V» (design 13–14.10.2026; docs/realtime-slice.md, «Испытание»): the run's level `ash` — each level turns
 * on its own change and keeps the lower ones (cumulative). Read through the run API (`createRtRun`, `rtArenaLoadout`,
 * `rtArenaParams`, the run's own commands) and real fights played by journal commands:
 * I — no start potion, no second wind; II — the row tables and pools before task 17; III — the run of v40 (0.5 s, touch 2 from
 * row 1); IV — 2 affixes from row 6; V — the density floor ×1.15 in every fight, the final's phases 15 % earlier. The profile
 * opens the choice after the first unseeded win and remembers the last level; old saves and profiles stay byte for byte.
 */
import { arenaTemplate, registerArena } from '../sim/arenas';
import { floorWithScale, scaledFloor } from '../sim/spawn';
import { worldState } from '../sim/hash';
import { defaultParams, type Params } from '../sim/params';
import { replay, Simulation, type Journal } from '../sim/simulation';
import { kitOf, type Loadout } from '../sim/kit';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { runRow } from './arenaPools';
import {
  RT_ASH_FINAL_PHASE_SCALE, RT_ASH_FLOOR_SCALE, RT_ASH_MAX, RT_TASK17_OFF, createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtAsh,
  rtAshOptions, rtAshPressure, rtAshTitle, rtAvailableNodes, rtElitePlates, rtRandomElites, rtEnterNode, rtGentle, rtMapNodes, rtNode, rtRunParams, rtRunWon, serializeRtRun,
  type RtAshLevel, type RtBattleKind, type RtRunState,
} from './rtRun';
import { createRtProfileStore, parseRtProfile, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { assert, closeNode, ok, outcomeOf, quiet, same, seedOf, takeGift, toBattle } from './runFight.testkit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

registerArena({
  id: 'ash-open', name: 'Поле испытания', summary: 'Тест испытания', goal: 'kills', width: 16, height: 10,
  heroStart: { x: 8, y: 5 }, obstacles: [], buttons: [], door: { x: 15.3, y: 5 }, enemies: [], killGoal: 9999,
});
const TICKS = (s: number): number => Math.round(s * 60);
const LEVELS: readonly RtAshLevel[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const ORDINARY = ['battle', 'event', 'breakthrough'];
const BATTLE_OF: Record<string, RtBattleKind> = { boss: 'final', hard: 'hard', event: 'event' };

/** Newcomers come, nothing hurts the hero. */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.porcupineQuills = 0; p.lynxDamage = 0;
  return Object.assign(p, extra);
}
/** A run of level `ash` (`v40` — the run of v40: no task-17 flags, no level) whose open battle is a node of run row `row` of one of `types`. */
function rowRun(row: number, ash: RtAshLevel | 'v40', k: number, types: readonly string[] = ORDINARY, arena = 'ash-open'): RtRunState {
  for (let s = 0; s < 30; s++) {
    const base = createRtRun(seedOf(900 + 37 * k + s), ash === 'v40' ? RT_TASK17_OFF : { ash });
    // Row 0 — any row (the boss nodes of the final).
    const node = rtMapNodes(base).find(n => (row === 0 || runRow(n.row) === row) && types.includes(n.type));
    if (node) return { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena, seed: seedOf(k), battle: BATTLE_OF[node.type] ?? 'battle' } };
  }
  throw new Error(`no node of row ${row}`);
}
/** The open battle of `run` on `arena` with the run's params of its row (`rtArenaParams`) over `base`, journalled. */
function arenaOf(run: RtRunState, base: Params, k: number, arena = 'ash-open'): Simulation {
  return new Simulation({ arena, params: rtArenaParams(run, rtRunParams(base)), seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
function elitesIn(sim: Simulation, seconds: number): Enemy[] {
  const seen = new Map<number, Enemy>(), w = sim.world;
  for (let t = 0; t < TICKS(seconds); t++) { sim.tick(); for (const e of w.enemies) if (e.elite && !seen.has(e.id)) seen.set(e.id, e); w.events.length = 0; }
  return [...seen.values()];
}
/** Keys whose values differ between two objects (shallow, by JSON). */
function diffKeys(a: object, b: object): string[] {
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter(key => JSON.stringify(ra[key]) !== JSON.stringify(rb[key])).sort();
}

check('the choice\'s data: levels 0 … VII (task 45, step 1: VIII waits for the fifth colour\'s view) with marks, titles «Испытание I–VII» (none for 0) and a line of at most 6 words; no «Пепел» in the texts', () => {
  const options = rtAshOptions();
  assert(same(options.map(o => o.level), [0, 1, 2, 3, 4, 5, 6, 7]) && same(options.map(o => o.label), ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII']), JSON.stringify(options));
  assert(rtAshTitle(0) === '' && rtAshTitle(3) === 'Испытание III' && rtAshTitle(5) === 'Испытание V' && rtAshTitle(8) === 'Испытание VIII', 'titles');
  assert(same(options.slice(6).map(o => o.text), ['Фокус короче на четверть', 'Враги быстрее на десятую']), 'the lines of VI and VII (design 16.10.2026)');
  for (const o of options) {
    const words = o.text.split(/\s+/).filter(Boolean).length;
    assert(words >= 1 && words <= 6 && !/пеп[её]л/i.test(o.text + o.title), `level ${o.level}: «${o.text}» (${words} words)`);
  }
});

check('task 25 (3): the lines of II and V name their knob with the numbers the level plays (design 15.10.2026)', () => {
  const [, , two, , , five] = rtAshOptions().map(o => o.text);
  assert(two === 'Элиты: ряд 3, броня: ряд 5', two);
  // II plays the tables before task 17 (no gentle tables): random elites from row 3, the armour step (3 plates) from row 5.
  assert(!rtRandomElites(2) && rtRandomElites(3) && rtElitePlates(4) === 2 && rtElitePlates(5) === 3, 'II: the rows the line names');
  assert(five === 'Толпа ×1,15, фазы финала короче', five);
  // V: the floor of every fight ×1.15; the final's phases last less (×0.85).
  const battle = rtAshPressure(5, 'battle'), final = rtAshPressure(5, 'final');
  assert(battle.floorScale === 1.15 && battle.phaseScale === undefined && final.floorScale === 1.15 && final.phaseScale! < 1, JSON.stringify({ battle, final }));
});

check('a new run by level (cumulative): I drops the start potion and the second wind, III the gentle entry; the level is kept (absent at 0); III is the run of v40', () => {
  for (let k = 1; k <= 4; k++) {
    const runs = LEVELS.map(ash => createRtRun(seedOf(k), { gift: 'mini', ash }));
    runs.forEach((run, ash) => {
      assert(rtAsh(run) === ash && (ash === 0 ? !('ash' in run) : run.ash === ash), `level ${ash}: the field`);
      assert(!!run.startPotion === ash < 1 && !!run.secondWind === ash < 1 && run.items.healing === (ash < 1 ? 1 : 0), `level ${ash}: potion and wind`);
      assert(!!run.gentleEntry === ash < 3 && rtGentle(run) === ash < 2, `level ${ash}: gentle entry ${run.gentleEntry}, tables ${rtGentle(run)}`);
    });
    // The default (no option) is level 0; levels III–V are the v40 run with the level on top.
    assert(same(createRtRun(seedOf(k), { gift: 'mini' }), runs[0]), 'no option — level 0');
    const v40 = createRtRun(seedOf(k), { gift: 'mini', ...RT_TASK17_OFF });
    for (const ash of [3, 4, 5]) { const { ash: _level, ...rest } = runs[ash]; assert(same(rest, v40), `level ${ash} without its field = v40`); }
    // The level overrides the task-17 options.
    const forced = createRtRun(seedOf(k), { ash: 3, gentleEntry: true, startPotion: true, secondWind: true });
    assert(!forced.gentleEntry && !forced.startPotion && !forced.secondWind, 'the level wins over the options');
  }
});

/**
 * The loadout and the params of every battle node of the map, the run of each level (and of v40) as its open battle: the
 * differences from the level below are only the level's own keys, and each level's keys do differ somewhere.
 */
check('every battle node of rows 1–10 (8 maps): each level changes the loadout and the params only in its own keys, and every one of them somewhere; III = v40 everywhere', () => {
  const own: Record<number, { loadout: string[]; params: string[] }> = {
    1: { loadout: ['items', 'lootOpens', 'openItems', 'secondWind'], params: [] },
    2: { loadout: ['eliteKinds', 'eliteAffixes', 'elitePlates', 'guaranteedElite', 'randomElites', 'toughHp', 'withoutKinds'], params: [] },
    3: { loadout: [], params: ['invulnerability', 'toughTouch'] },
    4: { loadout: ['eliteAffixes'], params: [] },
    5: { loadout: ['floorScale', 'phaseScale'], params: [] },
    // Task 45: VI — the focus, VII — the walk, VIII — the fifth colour (the panel's palette by the row off: absent below VIII).
    6: { loadout: ['focusScale'], params: [] },
    7: { loadout: ['walkScale'], params: [] },
    8: { loadout: ['colors'], params: [] },
  };
  const seen: Record<number, Set<string>> = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set(), 6: new Set(), 7: new Set(), 8: new Set() };
  const base = rtRunParams(defaultParams());
  let nodes = 0;
  for (let k = 1; k <= 8; k++) {
    const runs = LEVELS.map(ash => createRtRun(seedOf(k + 40), { ash })), v40 = createRtRun(seedOf(k + 40), RT_TASK17_OFF);
    // Rows 1–3 of level 0 met these kinds (Е2 and the final's porcupine rule read them).
    runs[0].metKinds = ['basic', 'wolf']; runs[1].metKinds = ['basic', 'wolf'];
    for (const node of rtMapNodes(runs[0]).filter(n => [...ORDINARY, 'checkpoint', 'hard', 'boss'].includes(n.type))) {
      const open = (run: RtRunState): RtRunState => ({ ...structuredClone(run), pending: { kind: 'battle', nodeId: node.id, arena: 'ash-open', seed: 1, battle: BATTLE_OF[node.type] ?? 'battle' } });
      const looks = [...runs, v40].map(run => { const r = open(run); return { loadout: rtArenaLoadout(r), params: rtArenaParams(r, base) }; });
      for (let ash = 1; ash <= RT_ASH_MAX; ash++) {
        const lo = diffKeys(looks[ash - 1].loadout, looks[ash].loadout), pa = diffKeys(looks[ash - 1].params, looks[ash].params);
        assert(lo.every(key => own[ash].loadout.includes(key)) && pa.every(key => own[ash].params.includes(key)), `level ${ash}, row ${runRow(node.row)} ${node.type}: loadout ${lo}, params ${pa}`);
        for (const key of [...lo, ...pa]) seen[ash].add(key);
      }
      // III — the run of v40: the same loadout and params.
      assert(same(looks[3], looks[LEVELS.length]),`row ${runRow(node.row)} ${node.type}: III ≠ v40`);
      const row = runRow(node.row), battle = BATTLE_OF[node.type] ?? 'battle';
      // IV: 2 affixes from row 6 (III: 1 on rows 5–8); V: the floor everywhere, the phases in the final only.
      assert((looks[4].loadout.eliteAffixes ?? 0) === (row >= 6 ? 2 : row >= 5 ? 1 : 0), `IV row ${row}: affixes ${looks[4].loadout.eliteAffixes}`);
      assert(looks[5].loadout.floorScale === RT_ASH_FLOOR_SCALE && looks[5].loadout.phaseScale === (battle === 'final' ? RT_ASH_FINAL_PHASE_SCALE : undefined), `V row ${row} ${battle}`);
      assert(looks[4].loadout.floorScale === undefined && looks[4].loadout.phaseScale === undefined, 'IV has no V keys');
      nodes++;
    }
  }
  for (let ash = 1; ash <= RT_ASH_MAX; ash++) {
    const want = [...own[ash].loadout, ...own[ash].params];
    assert(want.every(key => seen[ash].has(key)), `level ${ash} changed ${[...seen[ash]]} (want ${want})`);
  }
  console.log(`   battle nodes compared: ${nodes}`);
});

/** The run row and arena of every arena a run meets, its outcomes faked as victories (the run's own commands). */
function arenaPath(seed: number, k: number, options: Parameters<typeof createRtRun>[1]): string[] {
  let run = createRtRun(seed, { gift: 'mini', ...options });
  const out: string[] = [];
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      out.push(`${runRow(rtNode(run, pending.nodeId)!.row)}:${pending.arena}`);
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'resolve');
    } else if (pending) run = pending.kind === 'gift' ? takeGift(run) : closeNode(run);
    else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, next[(k + step) % next.length].id), 'enter'); }
  }
  return out;
}

check('the pools (120 runs, the run\'s own commands): levels II–V meet exactly the arenas of the v40 run; level I keeps the gentle pools (no thorns before row 7, no «Двор кнопок» on row 1), level II brings them back on some seeds', () => {
  let oldThorns = 0, oldButtons = 0, differ = 0;
  for (let k = 1; k <= 120; k++) {
    const v40 = arenaPath(seedOf(k), k, RT_TASK17_OFF);
    for (const ash of [2, 3, 4, 5] as const) assert(same(arenaPath(seedOf(k), k, { ash }), v40), `seed ${k}: level ${ash} ≠ v40`);
    const one = arenaPath(seedOf(k), k, { ash: 1 });
    assert(!one.some(p => /^[56]:thorns$/.test(p) || p === '1:buttons'), `seed ${k}: level I left the gentle pools ${one}`);
    if (v40.some(p => /^[56]:thorns$/.test(p))) oldThorns++;
    if (v40.includes('1:buttons')) oldButtons++;
    if (!same(one, v40)) differ++;
  }
  console.log(`   level II: thorns on rows 5–6 in ${oldThorns}, buttons on row 1 in ${oldButtons} of 120; level I ≠ II in ${differ}`);
  assert(oldThorns > 0 && oldButtons > 0 && differ > 0, 'level II meets the old pools');
});

/** A fight where a ring of touching enemies takes the hero's HP (default touch and speed); the events of every tick. */
function lethalFight(run: RtRunState, k: number): { sim: Simulation; events: WorldEvent[] } {
  const params = rtArenaParams(run, rtRunParams(quiet({ contactDamage: defaultParams().contactDamage, enemySpeed: defaultParams().enemySpeed })));
  const sim = new Simulation({ arena: 'run-fight-field', params, seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
  const w = sim.world, events: WorldEvent[] = [];
  sim.command({ t: 'clear', keepMarked: false });
  for (let i = 0; i < 8; i++) sim.command({ t: 'place', x: w.hero.x + Math.cos(i * Math.PI / 4) * 0.6, y: w.hero.y + Math.sin(i * Math.PI / 4) * 0.6, color: i % 4, hp: 2, kind: 'basic' });
  for (let t = 0; t < TICKS(240) && w.status === 'playing'; t++) { sim.tick(); events.push(...w.events); w.events.length = 0; }
  assert(w.status !== 'playing' && replays(sim), 'the fight ended and replays');
  return { sim, events };
}

check('I (real first battles of real runs, 3 seeds): level 0 starts with a potion more than level I and the lethal ring stands the hero up once; level I has no second wind and the ring ends the fight', () => {
  for (let k = 1; k <= 3; k++) {
    const runs = ([0, 1] as const).map(ash => toBattle(takeGift(createRtRun(seedOf(k + 60), { gift: 'mini', ash }))));
    // The same gift on the same seed: level 0 has the start potion on top of it.
    assert(runs[0].items.healing === runs[1].items.healing + 1 && runs[0].openItems.includes('healing'), `seed ${k}: potions ${runs[0].items.healing} / ${runs[1].items.healing}`);
    const winds = runs.map((run, i) => lethalFight(run, k + i).events.filter(ev => ev.type === 'secondWind').length);
    assert(winds[0] === 1 && winds[1] === 0, `seed ${k}: winds ${winds}`);
  }
});

check('II (real fights): an ordinary battle of row 3 brings the guaranteed elite at level II, none at level I; the Jailer\'s elite (row 5) has 3 plates at II, 2 at I', () => {
  for (let k = 1; k <= 3; k++) {
    const counts = ([1, 2] as const).map(ash => { const sim = arenaOf(rowRun(3, ash, k), harmless(), k); const n = elitesIn(sim, 12).length; assert(replays(sim), 'replay'); return n; });
    assert(counts[0] === 0 && counts[1] >= 1, `seed ${k}: row-3 elites ${counts}`);
  }
  const plates = ([1, 2] as const).map(ash => {
    const sim = arenaOf(rowRun(5, ash, 1, ['checkpoint']), harmless(), 1);
    sim.command({ t: 'clear', keepMarked: false });
    const id = sim.command({ t: 'place', x: 10, y: 5, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
    return sim.world.enemies.find(e => e.id === id)!.armor?.max;
  });
  assert(same(plates, [2, 3]), `row-5 plates ${plates}`);
});

/** The hero touched once by an enemy of `hp` standing on him: the hit's damage and the invulnerability it left. */
function touch(run: RtRunState, hp: number, k: number): { damage: number; invulnerable: number; sim: Simulation } {
  const sim = arenaOf(run, quiet({ contactDamage: 1 }), k), w = sim.world;
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'place', x: w.hero.x + 0.3, y: w.hero.y, color: 0, hp, kind: 'basic' });
  for (let t = 0; t < TICKS(3); t++) {
    sim.tick();
    const hit = w.events.find((ev): ev is Extract<WorldEvent, { type: 'hit' }> => ev.type === 'hit');
    w.events.length = 0;
    if (hit) return { damage: hit.damage, invulnerable: w.hero.invulnerable, sim };
  }
  throw new Error('no touch');
}

check('III (real touches on rows 1 and 3): level II keeps the gentle grace (1 s / 0,8 s) and the tough touch 1 on row 1; level III and the v40 run — 0,5 s and 2 from row 1', () => {
  const tick = 1 / 60 + 1e-9;
  for (const [ash, row, grace, tough] of [[2, 1, 1, 1], [2, 3, 0.8, 2], [3, 1, 0.5, 2], [3, 3, 0.5, 2], [5, 1, 0.5, 2], ['v40', 1, 0.5, 2]] as const) {
    const run = rowRun(row, ash, 1, [...ORDINARY, 'checkpoint']);
    const weak = touch(run, 0, 1), strong = touch(run, 2, 2);
    assert(weak.damage === 1 && Math.abs(weak.invulnerable - grace) <= tick && strong.damage === tough, `level ${ash} row ${row}: ${weak.damage}, ${weak.invulnerable} s, tough ${strong.damage}`);
    assert(replays(strong.sim), 'replay');
  }
});

check('IV (real fights, 2 seeds): the first elite of row 6 has 2 affixes at level IV, 1 at level III; row 5 (the Jailer\'s) — 1 at both', () => {
  for (let k = 1; k <= 2; k++) {
    const affixes = ([3, 4] as const).map(ash => { const sim = arenaOf(rowRun(6, ash, k), harmless(), k), first = elitesIn(sim, 12)[0]; assert(first && replays(sim), 'an elite'); return first.affixes?.length ?? 0; });
    assert(same(affixes, [1, 2]), `seed ${k}: row-6 affixes ${affixes}`);
  }
  assert(([3, 4] as const).every(ash => rtArenaLoadout(rowRun(5, ash, 1, ['checkpoint'])).eliteAffixes === 1), 'row 5: 1 affix');
});

/** Present enemies as the floor counts them (living without the Reaper, markers, the queue). */
const present = (w: World): number => w.enemies.filter(e => e.kind !== 'reaper').length + w.markers.length + w.queue.length;

check('V (real fights): the density floor of an ordinary battle tops up to 23 at level V and to 20 at level IV (floor 20); the arena limit stays the cap; a V journal without its kit fields plays the IV world', () => {
  for (let k = 1; k <= 3; k++) {
    const floorOf = (ash: RtAshLevel, maxEnemies: number): { n: number; sim: Simulation } => {
      const sim = arenaOf(rowRun(2, ash, k), harmless({ baseFloor: 20, baseIntervalMin: 1e6, baseIntervalMax: 1e6, baseWolfShare: 0, maxEnemies }), k);
      for (let t = 0; t < TICKS(1); t++) { sim.tick(); sim.world.events.length = 0; }
      return { n: present(sim.world), sim };
    };
    const four = floorOf(4, 60), five = floorOf(5, 60);
    assert(four.n === 20 && five.n === Math.round(20 * RT_ASH_FLOOR_SCALE), `seed ${k}: floor ${four.n} / ${five.n}`);
    assert(floorOf(5, 21).n === 21, 'the limit caps the floor');
    assert(replays(five.sim), 'replay');
    // The kit of level IV has no V keys (its world hashes as before); a V journal without them replays the IV world.
    const kit4 = (worldState(four.sim.world) as { kit: Record<string, unknown> }).kit;
    assert(!('floorScale' in kit4) && !('phaseScale' in kit4), 'IV kit');
    const ones = kitOf({ floorScale: 1, phaseScale: 1 });
    assert(!('floorScale' in ones) && !('phaseScale' in ones), 'a factor of 1 stays out of the kit (hashes as before)');
    const journal = JSON.parse(JSON.stringify(five.sim.exportJournal()!)) as Journal & { loadout: Loadout };
    delete journal.loadout.floorScale; delete journal.loadout.phaseScale;
    assert(replay(journal).hash() === four.sim.hash(), `seed ${k}: the V journal without its fields = IV`);
  }
});

check('V: the floor is rounded once, `round(floor × s × 1,15)` with the factor in whole percent — 10 → 12, 30 → 35, 50 → 58, 70 → 81, 90 → 104 on 16×10 (50 × 1,15 in binary is 57,49…); on «Последний рубеж» (s 1,1) 28 → 35 and 58 → 73, not the double rounding round(round(floor × s) × 1,15) = 36 and 74; without the factor — the old floor', () => {
  const small = arenaTemplate('ash-open'), big = arenaTemplate('last-stand');
  assert(same([10, 30, 50, 70, 90].map(f => floorWithScale(f, small, RT_ASH_FLOOR_SCALE)), [12, 35, 58, 81, 104]), 'scale 1');
  assert(same([28, 58].map(f => floorWithScale(f, big, RT_ASH_FLOOR_SCALE)), [35, 73]), 'last-stand: one rounding');
  // The old path: no factor — exactly `scaledFloor` (16×10 untouched; the big arena round(floor × s)).
  for (const f of [0, 1, 20, 28, 30, 48, 58]) assert(floorWithScale(f, small) === scaledFloor(f, small) && scaledFloor(f, small) === f && floorWithScale(f, big) === scaledFloor(f, big), `old ${f}`);
});

check('V (real final fights on «Последний рубеж»): after the goals its phases change at 21,25 / 42,5 / 59,5 / 85 s at level V and at 25 / 50 / 70 / 100 s at level IV; an ordinary battle of level V keeps 25 s', () => {
  const changes = (run: RtRunState, arena: string): number[] => {
    const sim = arenaOf(run, harmless(), 1, arena), w = sim.world, out: number[] = [];
    sim.command({ t: 'goals' });
    const start = w.greedStart!;
    let index = w.pressure.phaseIndex;
    for (let t = 0; t < TICKS(110) && w.status === 'playing'; t++) {
      sim.tick(); w.events.length = 0;
      if (w.pressure.phaseIndex !== index) { index = w.pressure.phaseIndex; out.push(w.time - start); }
    }
    assert(replays(sim), 'replay');
    return out;
  };
  const near = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x - b[i] >= -1e-6 && x - b[i] <= 1 / 60 + 1e-6);
  const final4 = changes(rowRun(0, 4, 1, ['boss'], 'last-stand'), 'last-stand'), final5 = changes(rowRun(0, 5, 1, ['boss'], 'last-stand'), 'last-stand');
  assert((rowRun(0, 5, 1, ['boss'], 'last-stand').pending as { battle: string }).battle === 'final', 'the final');
  assert(near(final4.slice(1), [25, 50, 70, 100]) && near(final5.slice(1), [21.25, 42.5, 59.5, 85]), `IV ${final4}, V ${final5}`);
  const ordinary = changes(rowRun(2, 5, 1), 'ash-open');
  assert(near(ordinary.slice(1, 2), [25]), `ordinary V ${ordinary}`);
});

check('saves: a run of each level loads back as saved; a save without `ash` (level 0, and v40) serializes byte for byte as before; malformed levels read as no run', () => {
  for (let k = 1; k <= 3; k++) {
    for (const ash of LEVELS) {
      const run = toBattle(takeGift(createRtRun(seedOf(k + 80), { gift: 'mini', ash })));
      const text = serializeRtRun(run), back = parseRtRun(text);
      assert(back && same(back, run) && serializeRtRun(back) === text, `level ${ash}: the save`);
      assert(ash > 0 ? text.includes('"ash":') : !text.includes('"ash"'), `level ${ash}: the field`);
    }
    const v40 = toBattle(takeGift(createRtRun(seedOf(k + 80), { gift: 'mini', ...RT_TASK17_OFF }))), text = serializeRtRun(v40);
    assert(!text.includes('"ash"') && serializeRtRun(parseRtRun(text)!) === text, 'the v40 save');
  }
  const run = JSON.parse(serializeRtRun(createRtRun(seedOf(5), { gift: 'mini', ash: 1 }))) as Record<string, unknown>;
  const zero = JSON.parse(serializeRtRun(createRtRun(seedOf(5), { gift: 'mini' }))) as Record<string, unknown>;
  const three = JSON.parse(serializeRtRun(createRtRun(seedOf(5), { gift: 'mini', ash: 3 }))) as Record<string, unknown>;
  for (const [value, what] of [[{ ...run, ash: 0 }, 'ash 0'], [{ ...run, ash: 9 }, 'ash 9'], [{ ...run, ash: 1.5 }, 'ash 1.5'], [{ ...run, ash: '1' }, 'ash "1"'],
    [{ ...zero, ash: 1 }, 'level I with the potion'], [{ ...run, secondWind: true }, 'level I with the wind'], [{ ...three, gentleEntry: true }, 'level III with the gentle entry']] as const) {
    assert(parseRtRun(JSON.stringify(value)) === null, `malformed: ${what}`);
  }
});

/** A plain storage object (the Web Storage subset the stores use). */
function memory(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

check('the profile: the choice is closed until an unseeded run is won (a seeded win, a defeat do not open it); then it stays open, remembers the last level (also in a new store) and 0 removes it; a profile before it saves byte for byte as before', () => {
  const storage = memory(), store = createRtProfileStore(storage);
  assert(!store.ashOpen() && store.ashChoice() === 0 && store.chooseAsh(3) === false && store.ashChoice() === 0, 'closed at first');
  // Real runs: a lost one and a won one (the run's own commands; the fights' outcomes as main.ts feeds them).
  const lost = toBattle(takeGift(createRtRun(seedOf(3), { gift: 'mini' })));
  const lostEnd = ok(resolveArena(lost, { ...outcomeOf(lost, lethalFight(lost, 3).sim.world) }), 'lost');
  assert(lostEnd.result?.outcome === 'defeat' && !rtRunWon(lostEnd), 'a lost run');
  store.endRun({ reachedJailer: false, seeded: false, won: rtRunWon(lostEnd) });
  assert(!store.ashOpen(), 'a defeat keeps it closed');
  let won = createRtRun(seedOf(4), { gift: 'mini' });
  for (let step = 0; step < 300 && !won.result; step++) {
    const pending = won.pending;
    if (pending?.kind === 'battle') won = ok(resolveArena(won, { nodeId: pending.nodeId, won: true, hp: won.hp, kills: 0, damage: 0, time: 1 }), 'resolve');
    else if (pending) won = closeNode(won);
    else won = ok(rtEnterNode(won, rtAvailableNodes(won)[0].id), 'enter');
  }
  assert(rtRunWon(won), 'a won run');
  store.endRun({ reachedJailer: true, seeded: true, won: true });
  assert(!store.ashOpen(), 'a seeded win keeps it closed');
  store.endRun({ reachedJailer: true, seeded: false, won: rtRunWon(won) });
  assert(store.ashOpen() && store.ashChoice() === 0, 'open after the first unseeded win');
  assert(store.chooseAsh(3) && store.ashChoice() === 3 && createRtProfileStore(storage).ashChoice() === 3, 'remembered');
  // Task 45, step 1: VII is offered, VIII not yet (the fifth colour's view); a stored VIII reads as the highest offered.
  assert(store.chooseAsh(7) && store.ashChoice() === 7 && !store.chooseAsh(8) && store.ashChoice() === 7, 'VII yes, VIII not yet');
  const eight = memory(); eight.data.set(RT_PROFILE_STORAGE_KEY, '{"version":1,"giftFull":false,"won":true,"ash":8}');
  assert(createRtProfileStore(eight).ashChoice() === 7, 'a stored VIII — VII');
  assert(store.chooseAsh(3) && store.ashChoice() === 3, 'back to III');
  store.endRun({ reachedJailer: false, seeded: false, won: false });
  assert(store.ashOpen() && store.ashChoice() === 3, 'a later defeat keeps it');
  assert(store.chooseAsh(0) && store.ashChoice() === 0 && !storage.data.get(RT_PROFILE_STORAGE_KEY)!.includes('"ash"'), '0 removes the field');
  // A profile saved before task 18 (with task 16's fields): reads, and an ended run without a win writes it as the old code did.
  const before = '{"version":1,"giftFull":true,"jailer":true,"runs":4}';
  const old = memory(); old.data.set(RT_PROFILE_STORAGE_KEY, before);
  assert(JSON.stringify(parseRtProfile(before)) === before, 'reads as before');
  createRtProfileStore(old).endRun({ reachedJailer: true, seeded: false });
  assert(old.data.get(RT_PROFILE_STORAGE_KEY) === before, `saves as before: ${old.data.get(RT_PROFILE_STORAGE_KEY)}`);
  assert(createRtProfileStore(old).ashChoice() === 0 && !createRtProfileStore(old).ashOpen(), 'closed for the old profile');
  // A stored level without the win is ignored (never offered before the unlock).
  const odd = memory(); odd.data.set(RT_PROFILE_STORAGE_KEY, '{"version":1,"giftFull":false,"ash":4}');
  assert(createRtProfileStore(odd).ashChoice() === 0, 'a level without the win');
});

console.log(`${checks} checks passed`);
