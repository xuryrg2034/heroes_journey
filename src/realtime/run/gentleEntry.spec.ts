/**
 * Task 17 «Пологий вход» (design 13.10.2026; docs/realtime-slice.md, section 7, «Пологий вход»): a run with the flag
 * `gentleEntry` and a run without it (a save before the task) — what the player meets, read from real fights played by
 * journal commands and from the run's own commands: elites from row 4, 3 plates and tough HP 3 from row 6, an affix from row 7
 * (design answer 13.10.2026), «Колючие заросли» on rows 6–8, the row's invulnerability after a hit and the raised tough touch from row 3, a healing potion
 * at the start with the first elite loot opening another kind, the second wind once on rows 1–4; the saves; the run's params
 * do not depend on the sandbox panel.
 */
import { registerArena } from '../sim/arenas';
import { worldState } from '../sim/hash';
import { defaultParams, type Params } from '../sim/params';
import { replay, Simulation } from '../sim/simulation';
import { SLOT_ITEMS } from '../sim/kit';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { SECOND_WIND_HP, SECOND_WIND_INVULNERABLE } from '../sim/world';
import { arenaNewKinds, runRow } from './arenaPools';
import {
  createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtChooseGift, rtChooseGiftPick, rtGiftView, rtArenaParams, rtArenaRules, rtAvailableNodes, rtEnterNode, rtMapNodes, rtNode, rtPageParams,
  rtRunParams, serializeRtRun, type RtBattleKind, type RtRunState,
} from './rtRun';
import { assert, closeNode, ok, outcomeOf, quiet, same, seedOf, takeGift, toBattle } from './runFight.testkit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

registerArena({
  id: 'gentle-open', name: 'Поле новичков', summary: 'Тест пологого входа', goal: 'kills', width: 16, height: 10,
  heroStart: { x: 8, y: 5 }, obstacles: [], buttons: [], door: { x: 15.3, y: 5 }, enemies: [], killGoal: 9999,
});
const TICKS = (s: number): number => Math.round(s * 60);

/** Newcomers come, nothing hurts the hero (the elites and the tough are counted, not fought). */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.porcupineQuills = 0; p.lynxDamage = 0;
  return Object.assign(p, extra);
}

/**
 * A run (`gentle` — with the flag) whose open battle is a node of run row `row` (`battle` kind) of one of `types`; null — the
 * map has none. Run row 5 is the Jailer's (`checkpoint`) on every map, row 9 the breakthrough.
 */
const ORDINARY = ['battle', 'event', 'breakthrough'];
function rowRun(row: number, gentle: boolean, k: number, battle: RtBattleKind = 'battle', arena = 'gentle-open', types: readonly string[] = ['battle', 'event', 'breakthrough', 'checkpoint', 'hard']): RtRunState | null {
  for (let s = 0; s < 20; s++) {
    const base = createRtRun(seedOf(400 + 37 * k + s), { gentleEntry: gentle });
    const node = rtMapNodes(base).find(n => runRow(n.row) === row && types.includes(n.type));
    if (node) return { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena, seed: seedOf(k), battle } };
  }
  return null;
}
/** The open battle of `run` on the newcomers' field with the run's params of its row (`rtArenaParams`) over `base`. */
function arenaOf(run: RtRunState, base: Params, k: number): Simulation {
  return new Simulation({ arena: 'gentle-open', params: rtArenaParams(run, rtRunParams(base)), seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** The elites that came in the first `seconds` of the fight (the guaranteed one comes in the first 10 s). */
function elitesIn(sim: Simulation, seconds: number): Enemy[] {
  const seen = new Map<number, Enemy>(), w = sim.world;
  for (let t = 0; t < TICKS(seconds); t++) { sim.tick(); for (const e of w.enemies) if (e.elite && !seen.has(e.id)) seen.set(e.id, e); w.events.length = 0; }
  return [...seen.values()];
}

check('elites by the row: a gentle run meets none on rows 1–3 and the guaranteed one from row 4; a run without the flag — from row 3 (real fights of ordinary battles, 3 seeds each)', () => {
  for (const [gentle, row, want] of [[true, 1, false], [true, 2, false], [true, 3, false], [true, 4, true], [true, 6, true], [false, 2, false], [false, 3, true], [false, 4, true]] as const) {
    for (let k = 1; k <= 3; k++) {
      const run = rowRun(row, gentle, k, 'battle', 'gentle-open', ORDINARY);
      assert(run, `a node of row ${row}`);
      const sim = arenaOf(run, harmless(), k), elites = elitesIn(sim, 12);
      assert(want ? elites.length >= 1 : elites.length === 0, `${gentle ? 'gentle' : 'old'} row ${row} seed ${k}: elites ${elites.length}`);
      assert(rtArenaLoadout(run).randomElites === want, `${gentle ? 'gentle' : 'old'} row ${row}: random elites ${rtArenaLoadout(run).randomElites}`);
      assert(replays(sim), 'replay');
    }
  }
});

check('the elite of a gentle run: row 4 — 2 plates, no affix; row 6 — 3 plates, no affix; rows 7–8 — 3 plates and 1 affix; row 9 — 4 plates and 2 affixes; a run without the flag — 3 plates and an affix on row 6 too (real fights)', () => {
  const plateOf = (e: Enemy): number => (e.armor?.max ?? 0) - (e.affixes?.includes('fat') ? 1 : 0) + (e.affixes?.includes('swift') ? 1 : 0);
  for (const [gentle, row, plates, affixes] of [[true, 4, 2, 0], [true, 6, 3, 0], [true, 7, 3, 1], [true, 8, 3, 1], [true, 9, 4, 2], [false, 4, 2, 0], [false, 6, 3, 1]] as const) {
    for (let k = 1; k <= 2; k++) {
      const run = rowRun(row, gentle, k, 'battle', 'gentle-open', ORDINARY);
      assert(run, `a node of row ${row}`);
      const sim = arenaOf(run, harmless(), k), first = elitesIn(sim, 12)[0];
      assert(first && plateOf(first) === plates && (first.affixes?.length ?? 0) === affixes, `${gentle ? 'gentle' : 'old'} row ${row} seed ${k}: plates ${first ? plateOf(first) : '—'}, affixes ${first?.affixes ?? []}`);
    }
  }
});

check('the Jailer\'s row 5: an elite of a gentle run has 2 plates and the row gives no affix (was 3 plates and 1 affix — the run without the flag)', () => {
  for (const [gentle, plates, affixes] of [[true, 2, 0], [false, 3, 1]] as const) {
    const run = rowRun(5, gentle, 1, 'battle', 'gentle-open', ['checkpoint'])!;
    const sim = arenaOf(run, harmless(), 1);
    sim.command({ t: 'clear', keepMarked: false });
    const id = sim.command({ t: 'place', x: 10, y: 5, color: 0, hp: 0, kind: 'basic', elite: true }) as number, e = sim.world.enemies.find(en => en.id === id)!;
    assert(e.armor?.max === plates, `${gentle ? 'gentle' : 'old'}: plates ${e.armor?.max}`);
    assert((rtArenaLoadout(run).eliteAffixes ?? 0) === affixes, `${gentle ? 'gentle' : 'old'}: affixes of the row's elites ${rtArenaLoadout(run).eliteAffixes}`);
  }
});

check('tough newcomers: a gentle run keeps 1–2 HP on row 5 and gets 3 HP from row 6; a run without the flag — 3 HP on row 5', () => {
  const hps = (run: RtRunState): Set<number> => {
    const out = new Set<number>();
    for (let k = 1; k <= 3; k++) {
      const sim = arenaOf(run, harmless({ baseToughShare: 1 }), k);
      for (let t = 0; t < TICKS(40); t++) { sim.tick(); for (const e of sim.world.enemies) if (!e.elite && (e.kind === 'basic' || e.kind === 'wolf')) out.add(e.hp); sim.world.events.length = 0; }
    }
    return out;
  };
  const top = (s: Set<number>): number => Math.max(...s);
  assert(top(hps(rowRun(5, true, 1)!)) === 2, 'gentle row 5: up to 2');
  assert(top(hps(rowRun(6, true, 1)!)) === 3, 'gentle row 6: 3');
  assert(top(hps(rowRun(5, false, 1)!)) === 3, 'old row 5: 3');
});

/** The run row and arena of every arena a run meets, its outcomes faked as victories (the run's own commands, no simulation). */
function arenaRows(seed: number, k: number, gentle: boolean): [number, string][] {
  let run = createRtRun(seed, { gift: 'mini', gentleEntry: gentle });
  const out: [number, string][] = [];
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      out.push([runRow(rtNode(run, pending.nodeId)!.row), pending.arena]);
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'resolve');
    } else if (pending) run = pending.kind === 'gift' ? takeGift(run) : closeNode(run);
    else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, next[(k + step) % next.length].id), 'enter'); }
  }
  return out;
}

check('«Колючие заросли» (300 runs each): a gentle run plays them on rows 6–8 by the pool — never before row 6; on row 9 only as the overdue own arena of an unmet porcupine (the rule of before); a run without the flag still meets them on row 5', () => {
  const rows = { gentle: new Map<number, number>(), old: new Map<number, number>() };
  let overdue = 0;
  for (let k = 1; k <= 300; k++) {
    for (const gentle of [true, false]) {
      const map = gentle ? rows.gentle : rows.old, path = arenaRows(seedOf(k), k, gentle);
      path.forEach(([row, arena], i) => {
        if (arena !== 'thorns') return;
        map.set(row, (map.get(row) ?? 0) + 1);
        if (gentle && row === 9) { assert(!path.slice(0, i).some(([, a]) => arenaNewKinds(a).includes('porcupine')), `seed ${k}: row 9 thorns with the porcupine met`); overdue++; }
      });
    }
  }
  const text = (m: Map<number, number>): string => [...m].sort((a, b) => a[0] - b[0]).map(([r, n]) => `${r}: ${n}`).join(', ');
  console.log(`   thorns by row (heuristic walk, 13.10.2026) — gentle ${text(rows.gentle)}; old ${text(rows.old)}`);
  assert([...rows.gentle.keys()].every(row => row >= 6) && [6, 7, 8].every(row => (rows.gentle.get(row) ?? 0) > 0), `gentle: ${text(rows.gentle)}`);
  assert(overdue === (rows.gentle.get(9) ?? 0), 'row 9: overdue only');
  assert((rows.old.get(5) ?? 0) > 0, `old: ${text(rows.old)}`);
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

check('a touch: a gentle run leaves 1 / 1 / 0,8 / 0,65 s of invulnerability on rows 1–4 and 0,5 from row 5; the tough touch hurts 1 on rows 1–2 and 2 from row 3; a run without the flag — 0,5 s and 2 everywhere', () => {
  const tick = 1 / 60 + 1e-9;
  for (const [gentle, row, grace, tough] of [[true, 1, 1, 1], [true, 2, 1, 1], [true, 3, 0.8, 2], [true, 4, 0.65, 2], [true, 5, 0.5, 2], [true, 9, 0.5, 2], [false, 1, 0.5, 2], [false, 4, 0.5, 2]] as const) {
    const run = rowRun(row, gentle, 1)!;
    const weak = touch(run, 0, 1), strong = touch(run, 2, 2);
    assert(weak.damage === 1 && Math.abs(weak.invulnerable - grace) <= tick, `${gentle ? 'gentle' : 'old'} row ${row}: a touch ${weak.damage}, invulnerable ${weak.invulnerable}`);
    assert(strong.damage === tough, `${gentle ? 'gentle' : 'old'} row ${row}: the tough touch ${strong.damage}`);
    assert(replays(strong.sim), 'replay');
  }
});

check('a new gentle run starts with 1 healing potion, the kind open; a run without the flag — none', () => {
  for (let k = 1; k <= 5; k++) {
    const run = createRtRun(seedOf(k), { gift: 'mini' }), old = createRtRun(seedOf(k), { gift: 'mini', gentleEntry: false });
    assert(run.gentleEntry === true && run.items.healing === 1 && same(run.openItems, ['healing']), `seed ${k}: ${JSON.stringify(run.items)} ${run.openItems}`);
    assert(old.gentleEntry === undefined && Object.values(old.items).every(n => n === 0) && !old.openItems.length, 'the old start');
    // The same map, gift and streams: the potion draws nothing.
    assert(same(run.map, old.map) && same(run.gift, old.gift) && same(run.streams, old.streams), 'nothing else differs');
  }
});

/** The first battle of a gentle run whose gift opened nothing more than the start's healing. */
function firstBattle(k: number): RtRunState | null {
  let run = createRtRun(seedOf(k), { gift: 'mini' });
  // The gift's button without consumables (as a player who took the HP).
  const view = rtGiftView(run)!, option = view.options.find(o => o.available && o.option.kind !== 'items') ?? view.options.find(o => o.available)!;
  run = ok(rtChooseGift(run, option.index), 'gift');
  const open = rtGiftView(run);
  if (open && open.chosen !== null) run = ok(rtChooseGiftPick(run, open.picks[0]), 'gift pick');
  for (let step = 0; step < 40 && run.pending?.kind !== 'battle'; step++) run = run.pending ? closeNode(run) : ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  return run.pending?.kind === 'battle' && run.openItems.every(item => item === 'healing') ? run : null;
}

check('the first armoured elite loot of a gentle run opens another kind (not healing) and drops it; the run opens it; a second elite of the fight and the next arena play the old rule', () => {
  const kinds = new Set<string>();
  let runs = 0;
  for (let k = 1; k <= 30 && runs < 6; k++) {
    const run = firstBattle(k);
    if (!run) continue;
    const sim = new Simulation({ arena: 'run-fight-field', params: rtArenaParams(run, rtRunParams(quiet())), seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
    const w = sim.world, events: WorldEvent[] = [];
    const tickAll = (n: number, until: (world: World) => boolean = () => false): void => { for (let i = 0; i < n && !until(w); i++) { sim.tick(); events.push(...w.events); w.events.length = 0; } };
    sim.command({ t: 'clear', keepMarked: false });
    const id = sim.command({ t: 'place', x: 8, y: 6, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
    for (let i = 0; i < 8 && w.enemies.some(e => e.id === id); i++) {
      const e = w.enemies.find(en => en.id === id)!;
      sim.command({ t: 'teleport', x: e.x - 2, y: 6 }); sim.command({ t: 'begin', x: e.x, y: e.y }); sim.command({ t: 'release' });
      events.push(...w.events); w.events.length = 0;
      tickAll(900, world => !world.move);
    }
    const dropped = events.flatMap(ev => ev.type === 'loot' && !ev.picked ? [ev.loot] : []);
    assert(dropped.length >= 1 && dropped.every(l => l === dropped[0]) && dropped[0] !== 'healing' && (SLOT_ITEMS as readonly string[]).includes(dropped[0]), `seed ${k}: dropped ${dropped}`);
    assert(same(w.kit!.openItems, ['healing', dropped[0]]) && w.kit!.lootOpens === undefined, `seed ${k}: open ${w.kit!.openItems}`);
    // A second elite of the same fight: the rule of before — one of the open kinds, nothing new opened.
    const second = sim.command({ t: 'place', x: 8, y: 6, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
    for (let i = 0; i < 8 && w.enemies.some(e => e.id === second); i++) {
      const e = w.enemies.find(en => en.id === second)!;
      sim.command({ t: 'teleport', x: e.x - 2, y: 6 }); sim.command({ t: 'begin', x: e.x, y: e.y }); sim.command({ t: 'release' });
      events.push(...w.events); w.events.length = 0;
      tickAll(900, world => !world.move);
    }
    assert(w.kit!.openItems.length === 2, `seed ${k}: no second kind (${w.kit!.openItems})`);
    sim.command({ t: 'goals' }); sim.command({ t: 'teleport', x: 16.5, y: 6 }); sim.command({ t: 'walk', x: 1, y: 0 });
    tickAll(600, world => world.status !== 'playing');
    assert(w.status === 'victory' && replays(sim), `seed ${k}: won, replays`);
    const after = ok(resolveArena(run, outcomeOf(run, w)), 'resolve');
    assert(same(after.openItems, ['healing', dropped[0]]) && !rtArenaLoadout({ ...after, pending: run.pending }).lootOpens, `seed ${k}: the run opened ${after.openItems}`);
    kinds.add(dropped[0]);
    runs++;
  }
  console.log(`   kinds the first loot opened: ${[...kinds].join(', ')}`);
  assert(runs >= 4 && kinds.size >= 2, `runs ${runs}, kinds ${[...kinds]}`);
});

/**
 * A fight of the open battle of `run` where a ring of touching enemies takes the hero's HP (default touch and speed); `win` —
 * once the second wind stood him up, the ring is cleared and he walks into the door. The events of every tick in order.
 */
function lethalFight(run: RtRunState, k: number, win: boolean): { sim: Simulation; events: { tick: number; time: number; ev: WorldEvent; hp: number; invulnerable: number }[] } {
  const params = rtArenaParams(run, rtRunParams(quiet({ contactDamage: defaultParams().contactDamage, enemySpeed: defaultParams().enemySpeed })));
  const sim = new Simulation({ arena: 'run-fight-field', params, seed: seedOf(k), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
  const w = sim.world, events: { tick: number; time: number; ev: WorldEvent; hp: number; invulnerable: number }[] = [];
  sim.command({ t: 'clear', keepMarked: false });
  for (let i = 0; i < 8; i++) sim.command({ t: 'place', x: w.hero.x + Math.cos(i * Math.PI / 4) * 0.6, y: w.hero.y + Math.sin(i * Math.PI / 4) * 0.6, color: i % 4, hp: 2, kind: 'basic' });
  for (let t = 0; t < TICKS(240) && w.status === 'playing'; t++) {
    sim.tick();
    for (const ev of w.events) events.push({ tick: w.tick, time: w.time, ev, hp: w.hero.hp, invulnerable: w.hero.invulnerable });
    const stood = w.events.some(ev => ev.type === 'secondWind');
    w.events.length = 0;
    if (stood && win) {
      sim.command({ t: 'clear', keepMarked: false }); sim.command({ t: 'goals' });
      sim.command({ t: 'teleport', x: 16.5, y: 6 }); sim.command({ t: 'walk', x: 1, y: 0 });
    }
  }
  assert(w.status !== 'playing', 'the fight ended');
  assert(replays(sim), 'the fight replays from its journal');
  return { sim, events };
}

check('the second wind of a gentle run: on row 1 the lethal touch stands the hero up with 3 HP and 2 s of invulnerability; once a fight; spent for the run — the next battle of rows 1–4 has none', () => {
  let stood = 0;
  for (let k = 1; k <= 3; k++) {
    // A real run at its first battle (run row 1), the hero at the run's 15 HP.
    const run = toBattle(takeGift(createRtRun(seedOf(k + 50), { gift: 'mini' })));
    assert(runRow(rtNode(run, (run.pending as { nodeId: string }).nodeId)!.row) === 1 && rtArenaLoadout(run).secondWind === true, 'the loadout has it');
    // A lost fight: the wind once, then the next lethal hit ends it.
    const lost = lethalFight(run, k, false), winds = lost.events.filter(e => e.ev.type === 'secondWind');
    assert(winds.length === 1 && lost.sim.world.status === 'defeat', `seed ${k}: winds ${winds.length}, ${lost.sim.world.status}`);
    const wind = winds[0];
    assert(wind.hp === SECOND_WIND_HP && wind.invulnerable >= SECOND_WIND_INVULNERABLE - 1 / 60 - 1e-9, `seed ${k}: stood with ${wind.hp} HP, invulnerable ${wind.invulnerable}`);
    assert(!lost.events.some(e => e.ev.type === 'hit' && e.time > wind.time && e.time < wind.time + SECOND_WIND_INVULNERABLE - 1e-6), `seed ${k}: no hit in the 2 s`);
    const lostRun = ok(resolveArena(run, outcomeOf(run, lost.sim.world)), 'resolve lost');
    assert(lostRun.result?.outcome === 'defeat' && lostRun.secondWindSpent === true, `seed ${k}: the lost run spent it`);
    // A won fight: the run goes on without it.
    const won = lethalFight(run, k, true);
    assert(won.sim.world.status === 'victory' && won.events.filter(e => e.ev.type === 'secondWind').length === 1, `seed ${k}: won after the wind`);
    const after = ok(resolveArena(run, outcomeOf(run, won.sim.world)), 'resolve won');
    assert(after.secondWindSpent === true && !after.result, `seed ${k}: spent`);
    const back = parseRtRun(serializeRtRun(after));
    assert(back && same(back, after), 'the save keeps it');
    // The next battle of rows 1–4 (setup: the spent flag on a run whose open battle is on row 2): no wind in its loadout.
    const next = rowRun(2, true, k, 'battle', 'run-fight-field')!, spent: RtRunState = { ...structuredClone(next), secondWindSpent: true, battles: after.battles };
    assert(rtArenaLoadout(next).secondWind === true && !rtArenaLoadout(spent).secondWind, 'none in the next battle');
    const again = lethalFight(spent, k, false);
    assert(!again.events.some(e => e.ev.type === 'secondWind') && again.sim.world.status === 'defeat', `seed ${k}: the next lethal hit ends the fight`);
    stood++;
  }
  assert(stood === 3, 'three seeds');
});

check('the second wind: not on row 5 or later of a gentle run, not in a run without the flag', () => {
  for (const [gentle, row] of [[true, 5], [true, 7], [false, 1], [false, 3]] as const) {
    const run = rowRun(row, gentle, 1, 'battle', 'run-fight-field')!;
    assert(!rtArenaLoadout(run).secondWind, `${gentle ? 'gentle' : 'old'} row ${row}: no wind in the loadout`);
    const fight = lethalFight(run, 1, false);
    assert(!fight.events.some(e => e.ev.type === 'secondWind') && fight.sim.world.status === 'defeat', `${gentle ? 'gentle' : 'old'} row ${row}: the lethal hit ends the fight`);
    // A run without the flag ignores an outcome that says so (nothing to spend).
    if (!gentle) {
      const after = ok(resolveArena(run, { ...outcomeOf(run, fight.sim.world), secondWind: true }), 'resolve');
      assert(after.secondWindSpent === undefined, 'nothing spent');
    }
  }
});

check('saves: a gentle run keeps its flag and `secondWindSpent`; a save without the flag (before task 17) loads and plays the old tables; malformed flags read as no run', () => {
  let run = takeGift(createRtRun(seedOf(77), { gift: 'mini' }));
  const back = parseRtRun(serializeRtRun(run));
  assert(back && back.gentleEntry === true && same(back, run), 'the flag loads back');
  const old = JSON.parse(serializeRtRun(run)) as Record<string, unknown>;
  delete old.gentleEntry;
  const oldRun = parseRtRun(JSON.stringify(old));
  assert(oldRun && oldRun.gentleEntry === undefined, 'a save without the flag loads');
  const battle = rowRun(3, true, 1)!, oldBattle: RtRunState = { ...structuredClone(battle) };
  delete oldBattle.gentleEntry;
  assert(rtArenaLoadout(battle).randomElites === false && rtArenaLoadout(oldBattle).randomElites === true, 'the old save plays the old row 3');
  assert(same(rtArenaRules(oldBattle), {}) || same(rtArenaRules(oldBattle), { markedGoals: true }), 'no row params for the old save');
  for (const bad of [{ gentleEntry: false }, { gentleEntry: 1 }, { secondWindSpent: true }, { secondWindSpent: false }]) {
    const value = { ...JSON.parse(serializeRtRun(run)), ...bad };
    if ('secondWindSpent' in bad && bad.secondWindSpent === true) value.battles = [];
    assert(parseRtRun(JSON.stringify(value)) === null, `malformed ${JSON.stringify(bad)}`);
  }
  run = { ...run, battles: [{ nodeId: run.visited[0] ?? 'x', arena: 'glade', won: true, kills: 0, damage: 0, time: 1 }] };
  const noFlag = { ...JSON.parse(serializeRtRun(run)), secondWindSpent: true };
  delete noFlag.gentleEntry;
  assert(parseRtRun(JSON.stringify(noFlag)) === null, 'the second wind without the flag reads as no run');
});

check('the run ignores the sandbox panel: its params are the defaults with the run\'s numbers, whatever the panel saved; the same fight plays the same world', () => {
  const panel = defaultParams();
  Object.assign(panel, { invulnerability: 2, toughTouch: false, eliteChance: 0.5, contactDamage: 9, heroAnchor: true, eliteSandbox: true, crystals: true, colorsByRow: true });
  const fromPanel = rtPageParams(false, () => panel), fromDefaults = rtPageParams(false, defaultParams);
  assert(same(fromPanel, fromDefaults) && same(fromDefaults, rtRunParams(defaultParams())), 'the run params do not depend on the panel');
  assert(rtPageParams(true, () => panel) === panel, 'the sandbox plays its panel');
  const run = rowRun(2, true, 1)!;
  const play = (params: Params): string => {
    const sim = new Simulation({ arena: 'gentle-open', params: rtArenaParams(run, params), seed: seedOf(5), loadout: rtArenaLoadout(run) });
    for (let t = 0; t < TICKS(10); t++) { sim.tick(); sim.world.events.length = 0; }
    return JSON.stringify(worldState(sim.world));
  };
  assert(play(fromPanel) === play(fromDefaults), 'the same world');
});

check('a run journal without the new kit fields plays the old path: a row-1 battle of a run without the flag is the world of before', () => {
  // The old run's loadout carries neither `secondWind` nor `lootOpens`; its kit hashes as before (no new keys).
  const run = rowRun(1, false, 3, 'battle', 'run-fight-field')!, loadout = rtArenaLoadout(run);
  assert(!('secondWind' in loadout) && !('lootOpens' in loadout), 'no new loadout fields');
  const sim = new Simulation({ arena: 'run-fight-field', params: rtArenaParams(run, rtRunParams(quiet())), seed: seedOf(3), record: true, loadout });
  assert(!('secondWind' in sim.world.kit!) && !('lootOpens' in sim.world.kit!), 'no new kit fields');
  const gentle = rowRun(1, true, 3, 'battle', 'run-fight-field')!, kit = new Simulation({ arena: 'run-fight-field', params: rtRunParams(quiet()), seed: seedOf(3), loadout: rtArenaLoadout(gentle) }).world.kit!;
  assert(kit.secondWind === true && kit.lootOpens === true, 'the gentle run carries them');
});

console.log(`realtime-gentle-entry: ${checks} checks passed`);
