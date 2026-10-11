/**
 * П5 «Журнал удачи» (run/rtLuck.ts; docs/realtime-slice.md, section 9; docs/realtime-engagement-research.md, П5). Node only:
 * `npm run test:realtime-luck`.
 *
 * Run fights are real fights (journalled commands on a quiet field with the run's params and loadout); their chance is read
 * from every tick's events as main.ts reads them every frame, the outcome goes into the run by its commands:
 * - the goblin: bare pulls show skulls [2,2,2] then [3,2,2] — rain 1/27 and 1/21, volley 2/9 and 16/63 (hand-counted); the
 *   tally keeps the pulls, what came and the sum of the shown odds, over fights and seeds; a lost fight's pulls count;
 * - the elites' loot: armoured elites killed by the player (a bomb opens the plates, a chain kills) — every loot fell, 1 each;
 * - the die: only «Бросить» counts, faces 4–6 against ½ a roll;
 * - event outcomes with odds: read from the save's choices as the event screen showed them (odds and outcome);
 * - the block's lines (hand-counted texts), an empty run says so;
 * - the save: version 7, the optional field; a save written before it (fixture) loads unchanged, its events show, it plays on;
 *   malformed tallies are no run;
 * - the run's outputs for the seed do not depend on the tally.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { createRtRun, parseRtRun, resolveArena, rtAvailableNodes, rtChooseEventOption, rtDieChoose, rtEnterNode, rtEventLuck, rtEventView, rtLuckReport, serializeRtRun,
  type RtRunState } from './rtRun';
import { createRtRunStore, RT_RUN_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { luckNumber, rtLuckLines, type RtLuckTally } from './rtLuck';
import { assert, closeNode, ok, playFight, pullBare, same, seedOf, summonGoblin, takeGift, ticks, toBattle } from './runFight.testkit';
import type { Simulation } from '../sim/simulation';
import type { World, WorldEvent } from '../sim/world';
import saveBefore from '../../../tests/fixtures/rt-run-save-before-record.json';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const newRun = (k: number): RtRunState => toBattle(takeGift(createRtRun(seedOf(k), { gift: 'mini' })));
const next = (run: RtRunState): RtRunState => toBattle(closeNode(run));
const strip = (run: RtRunState): RtRunState => { const copy = { ...run }; delete copy.luck; return copy; };

/** Hand-counted odds of a bare pull: a skull on a reel with s skulls — s ÷ (4 + s). */
const RAIN_1 = 1 / 27, VOLLEY_1 = 2 / 9;        // skulls [2,2,2]: q = 1/3
const RAIN_2 = 1 / 21, VOLLEY_2 = 16 / 63;      // skulls [3,2,2]: q = 3/7, 1/3, 1/3
/** A fight with two bare pulls of the goblin; returns the pulls seen. */
const twoPulls = (pulls: Extract<WorldEvent, { type: 'slot' }>[]) => (sim: Simulation, seen: (w: World) => void): void => {
  summonGoblin(sim);
  pulls.push(pullBare(sim, seen), pullBare(sim, seen));
};

check('the goblin: two bare pulls — the odds shown 1/27 · 2/9, then 1/21 · 16/63; the tally keeps what came against their sum', () => {
  const outcomes = new Set<string>();
  for (let k = 1; k <= 6; k++) {
    const run = newRun(k), pulls: Extract<WorldEvent, { type: 'slot' }>[] = [];
    const { outcome } = playFight(run, { chains: [], play: twoPulls(pulls), k });
    assert(near(pulls[0].rain!, RAIN_1) && near(pulls[0].volley!, VOLLEY_1) && near(pulls[1].rain!, RAIN_2) && near(pulls[1].volley!, VOLLEY_2), `seed ${k}: the shown odds ${pulls.map(p => `${p.rain} ${p.volley}`).join(' / ')}`);
    const rain = pulls.filter(p => p.outcome === 'rain').length, volley = pulls.filter(p => p.outcome === 'volley').length;
    for (const p of pulls) outcomes.add(p.outcome!);
    const after = ok(resolveArena(run, outcome), 'resolve');
    assert(same(after.luck, { 'slot-rain': { tries: 2, hits: rain, expected: RAIN_1 + RAIN_2 }, 'slot-volley': { tries: 2, hits: volley, expected: VOLLEY_1 + VOLLEY_2 } }), `seed ${k}: ${JSON.stringify(after.luck)}`);
    const line = rtLuckReport(after).find(entry => entry.id === 'slot')!;
    // 16/189 ≈ 0,08 → «0,1»; 30/63 ≈ 0,48 → «0,5»; per pull 4,2 % and 23,8 %.
    assert(line.label === 'Гоблин' && line.text === `2 рывка · на рычаге в среднем дождь 4,2 % · залп 23,8 % · выпало: дождь ${rain} (ожидание 0,1), залп ${volley} (ожидание 0,5)`, line.text);
  }
  assert(outcomes.size >= 3, `the pulls vary over seeds: ${[...outcomes].join(', ')}`);
});

check('the tally adds up over the run\'s fights; a lost fight\'s pulls count; the save keeps it', () => {
  let run = newRun(7);
  const first: Extract<WorldEvent, { type: 'slot' }>[] = [], second: Extract<WorldEvent, { type: 'slot' }>[] = [];
  run = ok(resolveArena(run, playFight(run, { chains: [3], play: twoPulls(first) }).outcome), 'fight 1');
  run = next(run);
  // The second fight is lost after its pulls.
  run = ok(resolveArena(run, playFight(run, { chains: [], play: twoPulls(second), lose: true, k: 2 }).outcome), 'fight 2');
  assert(run.result?.outcome === 'defeat', 'lost');
  const all = [...first, ...second];
  assert(run.luck?.['slot-rain']?.tries === 4 && near(run.luck['slot-rain'].expected, 2 * (RAIN_1 + RAIN_2)) && near(run.luck['slot-volley']!.expected, 2 * (VOLLEY_1 + VOLLEY_2))
    && run.luck['slot-volley']!.hits === all.filter(p => p.outcome === 'volley').length && run.luck['slot-rain'].hits === all.filter(p => p.outcome === 'rain').length, JSON.stringify(run.luck));
  const back = parseRtRun(serializeRtRun(run))!;
  assert(back && same(back.luck, run.luck) && same(rtLuckReport(back), rtLuckReport(run)), 'a reload keeps the tally and the block');
  // A fight without chance adds nothing (no field in the outcome).
  const plain = newRun(8), { outcome } = playFight(plain, { chains: [4] });
  assert(outcome.luck === undefined && ok(resolveArena(plain, outcome), 'plain').luck === undefined, 'no chance — no tally');
});

check('the elites\' loot: armoured elites killed by the player — every loot fell; armour leaves loot always (expected 1 each)', () => {
  for (let k = 1; k <= 3; k++) {
    const run = newRun(10 + k);
    const { outcome, events } = playFight(run, { chains: [], k, play: (sim, seen) => {
      sim.command({ t: 'items', kind: 'bomb', count: 2 });
      for (const y of [4, 8]) {
        const id = sim.command({ t: 'place', x: 9, y, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
        const elite = sim.world.enemies.find(e => e.id === id)!;
        assert(elite.armor && elite.armor.plates === 2, 'an armoured elite of row 1 (2 plates)');
        sim.command({ t: 'teleport', x: 7, y });
        sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
        ticks(sim, 1, seen);
        assert((elite.armor.plates as number) === 0, 'the bomb opened it');
        sim.command({ t: 'begin', x: elite.x, y: elite.y });
        sim.command({ t: 'release' });
        seen(sim.world); sim.world.events.length = 0;
        ticks(sim, 900, seen, w => !w.move);
        assert(!sim.world.enemies.includes(elite), 'the chain killed it');
      }
    } });
    const downs = events.filter(ev => ev.type === 'eliteDown' && ev.credited).length, dropped = events.filter(ev => ev.type === 'loot' && !ev.picked).length;
    assert(downs === 2 && dropped >= 2, `seed ${k}: two kills, loot fell (${downs}, ${dropped})`);
    const after = ok(resolveArena(run, outcome), 'resolve');
    assert(same(after.luck, { 'elite-loot': { tries: 2, hits: 2, expected: 2 } }), JSON.stringify(after.luck));
    // Design 12.10.2026: the loot without a chance has no line (the tally keeps counting it).
    assert(same(rtLuckReport(after), []), JSON.stringify(rtLuckReport(after)));
  }
});

check('the die: «Бросить» counts (faces 4–6 against ½ a roll), «Забрать» does not', () => {
  let rolls = 0, takes = 0, highs = 0;
  for (let k = 1; k <= 8 && (rolls < 4 || takes < 1 || highs < 1); k++) {
    let run = newRun(20 + k), runRolls = 0, runHigh = 0;
    for (let fight = 0; fight < 4 && !run.result; fight++) {
      run = ok(resolveArena(run, playFight(run, { chains: [5, 5, 5], k: fight + 1 }).outcome), 'win');
      if (run.pending?.kind === 'die') {
        const roll = (rolls + takes) % 3 !== 2, step = rtDieChoose(run, roll);
        assert(step.ok, 'the die');
        const resolved = step.events.find(ev => ev.type === 'die-resolved');
        assert(resolved?.type === 'die-resolved', 'resolved');
        if (roll) { rolls++; runRolls++; if (resolved.face >= 4) { runHigh++; highs++; } } else takes++;
        run = step.run;
      }
      run = next(run);
    }
    assert(same(run.luck?.die, runRolls ? { tries: runRolls, hits: runHigh, expected: runRolls / 2 } : undefined), `seed ${k}: ${runRolls} rolls, ${runHigh} high — ${JSON.stringify(run.luck)}`);
    if (runRolls) assert(rtLuckReport(run).find(line => line.id === 'die')!.text === `${runRolls} брос${runRolls === 1 ? 'ок' : runRolls < 5 ? 'ка' : 'ков'} · 4–6 выпало ${runHigh} (ожидание ${luckNumber(runRolls / 2)})`, 'the line');
  }
  assert(rolls >= 4 && takes >= 1 && highs >= 1 && highs < rolls, `rolls ${rolls} (high ${highs}), takes ${takes}`);
  // Hand-counted: two rolls, one high → «2 броска · 4–6 выпало 1 (ожидание 1)».
  assert(same(rtLuckLines({ die: { tries: 2, hits: 1, expected: 1 } }), [{ id: 'die', label: 'Кость у двери', text: '2 броска · 4–6 выпало 1 (ожидание 1)' }]), 'the die line');
});

check('event outcomes with odds: the line says the outcome and the odds the event screen showed', () => {
  let seen = 0;
  for (let k = 1; k <= 40 && seen < 4; k++) {
    let run: RtRunState = takeGift(createRtRun(seedOf(30 + k), { gift: 'mini' }));
    for (let step = 0; step < 40 && !run.result; step++) {
      const pending = run.pending;
      if (pending?.kind === 'battle') { run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'win'); continue; }
      if (pending?.kind === 'event') {
        const view = rtEventView(run)!;
        const risky = view.options.find(option => option.available && !option.battle && option.outcomes.filter(o => o.odds !== '0%').length >= 2 && !option.attempts);
        if (!risky) { run = closeNode(run); continue; }
        const stepped = rtChooseEventOption(run, risky.id);
        assert(stepped.ok, 'the choice');
        const resolved = stepped.events.find(ev => ev.type === 'event-resolved');
        assert(resolved?.type === 'event-resolved', 'resolved');
        const before = rtEventLuck(run).length;
        run = stepped.run;
        const lines = rtEventLuck(run);
        assert(lines.length === before + 1, 'one more line');
        const line = lines[lines.length - 1], shown = risky.outcomes[resolved.outcome];
        assert(line.title === view.event.title && line.option === risky.label && line.odds === shown.odds && shown.text.startsWith(line.outcome), `${JSON.stringify(line)} vs ${JSON.stringify(shown)}`);
        const report = rtLuckReport(run).at(-1)!;
        assert(report.label === `«${view.event.title}»` && report.text === `${risky.label}: ${line.outcome} — шанс ${shown.odds}`, report.text);
        seen++;
        continue;
      }
      if (pending) { run = closeNode(run); continue; }
      const nodes = rtAvailableNodes(run);
      run = ok(rtEnterNode(run, (nodes.find(node => node.type === 'event') ?? nodes[0]).id), 'enter');
    }
  }
  assert(seen >= 4, `events with odds met: ${seen}`);
});

check('the block\'s lines in order (hand-counted texts); numbers; an empty run has none', () => {
  const tally: RtLuckTally = {
    'slot-rain': { tries: 4, hits: 1, expected: 0.2 }, 'slot-volley': { tries: 4, hits: 0, expected: 1 },
    'elite-loot': { tries: 4, hits: 2, expected: 2 }, die: { tries: 3, hits: 3, expected: 1.5 },
  };
  assert(same(rtLuckLines(tally, [{ title: 'Кости у логова', option: 'Обыскать', outcome: 'находка', odds: '50%' }]), [
    { id: 'slot', label: 'Гоблин', text: '4 рывка · на рычаге в среднем дождь 5,0 % · залп 25,0 % · выпало: дождь 1 (ожидание 0,2), залп 0 (ожидание 1)' },
    { id: 'die', label: 'Кость у двери', text: '3 броска · 4–6 выпало 3 (ожидание 1,5)' },
    { id: 'elite-loot', label: 'Добыча элит', text: '2 из 4 (ожидание 2)' },
    { id: 'event-0', label: '«Кости у логова»', text: 'Обыскать: находка — шанс 50%' },
  ]), JSON.stringify(rtLuckLines(tally)));
  assert(luckNumber(0.04) === '0' && luckNumber(0.05) === '0,1' && luckNumber(2) === '2' && luckNumber(1.25) === '1,3', 'numbers');
  assert(rtLuckLines({ die: { tries: 1, hits: 0, expected: 0.5 } })[0].text === '1 бросок · 4–6 выпало 0 (ожидание 0,5)' && rtLuckLines({ die: { tries: 5, hits: 2, expected: 2.5 } })[0].text === '5 бросков · 4–6 выпало 2 (ожидание 2,5)', 'word forms');
  assert(rtLuckReport(createRtRun(seedOf(1), { gift: 'mini' })).length === 0, 'a new run: no lines');
});

check('the save: version 7, the optional field; malformed tallies are no run', () => {
  let run = newRun(40);
  const pulls: Extract<WorldEvent, { type: 'slot' }>[] = [];
  run = ok(resolveArena(run, playFight(run, { chains: [], play: twoPulls(pulls) }).outcome), 'fight');
  const storage: RunStorage & { data: Record<string, string> } = (() => { const data: Record<string, string> = {}; return { data, getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => { data[key] = value; }, removeItem: (key: string) => { delete data[key]; } }; })();
  const store = createRtRunStore(storage);
  assert(store.save(run) && same(store.load(), run) && JSON.parse(storage.data[RT_RUN_STORAGE_KEY]).luck['slot-rain'].tries === 2, 'stored under -v7 and loaded the same');
  const forge = (edit: (luck: Record<string, any>) => void): string => { const value = JSON.parse(serializeRtRun(run)); edit(value.luck); return JSON.stringify(value); };
  const bad: [string, (luck: Record<string, any>) => void][] = [
    ['an unknown source', luck => { luck.coin = { tries: 1, hits: 0, expected: 0.5 }; }],
    ['hits above tries', luck => { luck['slot-rain'].hits = 3; }],
    ['expected above tries', luck => { luck['slot-rain'].expected = 2.5; }],
    ['negative expected', luck => { luck['slot-rain'].expected = -0.1; }],
    ['no tries', luck => { luck['slot-rain'] = { tries: 0, hits: 0, expected: 0 }; }],
    ['a fraction of a try', luck => { luck['slot-rain'].tries = 1.5; }],
    ['a string', luck => { luck['slot-rain'].hits = '1'; }],
    ['an extra field', luck => { luck['slot-rain'].odds = 0.1; }],
    ['a die never shown', luck => { luck.die = { tries: 1, hits: 1, expected: 0.5 }; }],
  ];
  for (const [what, edit] of bad) assert(parseRtRun(forge(edit)) === null, `${what} is no run`);
  for (const value of [null, [], {}, 3, 'x']) { const v = JSON.parse(serializeRtRun(run)); v.luck = value; assert(parseRtRun(JSON.stringify(v)) === null, `luck ${JSON.stringify(value)} is no run`); }
  // A malformed outcome's tally is not taken (a fight's keys only, valid counts only).
  const at = newRun(41), { outcome } = playFight(at, { chains: [2] });
  const taken = ok(resolveArena(at, { ...outcome, luck: { die: { tries: 1, hits: 1, expected: 0.5 }, 'slot-rain': { tries: 1, hits: 2, expected: 0 } } as RtLuckTally }), 'odd outcome');
  assert(taken.luck === undefined && parseRtRun(serializeRtRun(taken)) !== null, 'nothing taken from a malformed outcome');
});

check('a save written before П5 (fixture, code of 223f54f) loads unchanged; its events show; it plays on and tallies', () => {
  const old = parseRtRun(saveBefore.save)!;
  assert(old && serializeRtRun(old) === saveBefore.save && old.luck === undefined, 'loaded unchanged, no tally');
  // Its die rolled before the tally is not counted; its event outcome with odds is read from its choices.
  assert(same(rtLuckReport(old), [{ id: 'event-0', label: '«Кости у логова»', text: 'Обыскать: разбудил, ничего не меняется; Следующая арена: одна случайная элита в первой волне — шанс 50%' }]), JSON.stringify(rtLuckReport(old)));
  const pulls: Extract<WorldEvent, { type: 'slot' }>[] = [];
  const after = ok(resolveArena(old, playFight(old, { chains: [3], play: twoPulls(pulls) }).outcome), 'plays on');
  assert(after.luck?.['slot-rain']?.tries === 2 && rtLuckReport(after).map(line => line.id).join() === 'slot,event-0', JSON.stringify(rtLuckReport(after)));
  assert(same(strip(after).battles.slice(0, 3), old.battles) && parseRtRun(serializeRtRun(after)) !== null, 'the save after it loads');
});

check('the run\'s outputs do not depend on the tally: the same walk without it differs only in the field', () => {
  for (let k = 1; k <= 3; k++) {
    let a = newRun(50 + k), b = a;
    for (let fight = 0; fight < 3 && !a.result; fight++) {
      const pulls: Extract<WorldEvent, { type: 'slot' }>[] = [];
      const { outcome } = playFight(a, { chains: [5, 5, 5], play: twoPulls(pulls), k: fight + 1 });
      const plain = { ...outcome };
      delete plain.luck;
      a = ok(resolveArena(a, outcome), 'with'); b = ok(resolveArena(b, plain), 'without');
      if (a.pending?.kind === 'die') { a = ok(rtDieChoose(a, true), 'roll'); b = ok(rtDieChoose(b, true), 'roll'); }
      assert(same(strip(a), strip(b)) && b.luck?.['slot-rain'] === undefined, `seed ${k}, fight ${fight}`);
      if (a.result) break;
      a = next(a); b = next(b);
      assert(same(strip(a), strip(b)), 'the walks agree');
    }
  }
});

console.log(`\n${checks} checks passed`);
