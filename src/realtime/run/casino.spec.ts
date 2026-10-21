/**
 * B7 К9 «Игорный круг гоблинов» (run/rtRun.ts `rtCasinoDue`, `rtCasinoPlay`, `rtCasinoLeave`; docs/realtime-casino.md,
 * «Игорный круг (К9)»). Node only: `npm run test:realtime-casino`.
 *
 * Runs walk by the run's own commands (`rtEnterNode` with or without the run's key `goblinCircle`, the screens' choices).
 * Most walks feed their fights back as finished arenas (`resolveArena` with an outcome: a victory, the HP left, the
 * resources picked up); the byte-for-byte walks against the code before the circle play their arenas as real fights
 * (journalled commands on the quiet test field of runFight.testkit.ts), as reroll.spec.ts does.
 * - the circle stands on an event node from run row 3 with a resource to stake, about 30 % of such nodes (a heuristic,
 *   printed; only loose bounds asserted), never twice in a run, never with 0 resources, never without the key;
 * - entering it spends no run stream: the `events` draw and every other stream stay as they were, no event is met;
 * - runs without the key, and runs with it where the circle never stands, save byte for byte as the code before it
 *   (the 8 whole runs of the reroll fixture `walks`, code of 7ae55fc re-recorded at the calibration and at task 5 of 12.10.2026, and 300 runs against the same walk without the key);
 * - at most 3 games a visit over both tables; «Уйти» completes the node;
 * - «Кости»: a stake of 1, a sum of 8 or more pays 3 resources (the faces shown are the game's), about 15/36 of the games;
 * - «Колесо костей» in the circle: the event's outcomes, its talisman drawn without the `talismans` stream, «кость в лоб» at
 *   1 HP leaves 1 HP (the event's rule; the wheel is open at any HP);
 * - a reload shows the same last game and plays on the same; a reload at the open circle plays the same first game;
 * - old saves (fixtures) load unchanged and play on; malformed circle fields are no run;
 * - «Журнал удачи»: «Кости» against 15/36, the wheel's spins with their odds; telemetry: the circle's choices.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { RT_TASK17_OFF,
  createRtRun, parseRtRun, resolveArena, rtAvailableNodes, rtCasinoLeave, rtCasinoNode, rtCasinoPlay, rtCasinoRoll, rtCasinoView, rtChooseEventOption, rtChooseTalisman,
  rtEnterNode, rtEventView, rtLuckReport, rtNode, rtNodeTitle, serializeRtRun, CASINO_WHEEL_EVENT, RT_CASINO_CHANCE, RT_CASINO_GAMES, RT_CASINO_TITLE, RT_DICE_WIN_CHANCE,
  type RtCasinoGame, type RtRunState, type RtRunStep,
} from './rtRun';
import { createRtRunStore, RT_RUN_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { RESOURCE_KINDS } from '../forest/resources';
import { stockTotal } from '../forest/merchant';
import { eventOption, forestEvent } from '../forest/forestEvents';
import { rtTalisman, RT_COUNTER_WINDOW } from './rtTalismans';
import { rtHp } from './hpScale';
import { runRow } from './arenaPools';
import { stepChoices, mergeChoice } from '../telemetry/recorder';
import type { RunChoice } from '../telemetry/schema';
import { assert, closeNode, ok, playFight, same, seedOf, takeGift } from './runFight.testkit';
import before from '../../../tests/fixtures/rt-run-save-before-reroll.json';
import beforeMix from '../../../tests/fixtures/rt-run-save-before-mix.json';
import beforeRecord from '../../../tests/fixtures/rt-run-save-before-record.json';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const ON = { goblinCircle: true } as const;
const reload = (run: RtRunState): RtRunState => { const back = parseRtRun(serializeRtRun(run)); assert(back, 'the save loads'); return back; };
const total = (run: RtRunState): number => stockTotal(run.materials);
const wheel = eventOption(forestEvent(CASINO_WHEEL_EVENT)!, 'spin')!;
const BONE_IN_FOREHEAD = wheel.outcomes.findIndex(outcome => (outcome.effect.hp ?? 0) < 0);
const TALISMAN = wheel.outcomes.findIndex(outcome => !!outcome.effect.talisman);
const lastGame = (run: RtRunState): RtCasinoGame => run.casino!.games[run.casino!.games.length - 1];

interface WalkPlan {
  /** The run's key `goblinCircle` on entering nodes. */
  circle: boolean;
  /** Resources a won fight picks up (absent — 1). */
  materials?: number;
  /** HP a won fight ends with (absent — as it came in). */
  hp?: number;
  /** What to do at the open circle (absent — «Уйти»). */
  atCircle?: (run: RtRunState) => RtRunState;
  /** Stop the walk when the circle opens. */
  stopAtCircle?: boolean;
}
interface Walk {
  saves: string[]; run: RtRunState; circles: number; eligible: number; eligibleNoStock: number;
  /** The index in `saves` of the save right after the circle stood (−1 — none). */
  circleAt: number;
}
/** A fight fed back as finished: a victory with `plan.hp` HP and `plan.materials` resources picked up (kinds by the step). */
function winFight(run: RtRunState, plan: WalkPlan, step: number): RtRunState {
  const pending = run.pending;
  assert(pending?.kind === 'battle', 'an open battle');
  const n = plan.materials ?? 1, materials: Partial<Record<(typeof RESOURCE_KINDS)[number], number>> = {};
  for (let i = 0; i < n; i++) { const kind = RESOURCE_KINDS[(step + i) % RESOURCE_KINDS.length]; materials[kind] = (materials[kind] ?? 0) + 1; }
  return ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: Math.max(1, Math.min(run.maxHp, plan.hp ?? run.hp)), kills: 5, damage: 0, time: 60, materials }), 'fight');
}
/**
 * A whole run of seed `k`: event nodes first (then the first available), the start gift's first button, fights won and fed
 * back, other screens closed simply (an event's safe option, talismans refused, the die taken). Every save on the way.
 */
function walk(k: number, plan: WalkPlan): Walk {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini', garrison: false }));
  const saves = [serializeRtRun(run)];
  let circles = 0, eligible = 0, eligibleNoStock = 0, circleAt = -1;
  for (let step = 0; step < 200 && !run.result; step++) {
    const p = run.pending;
    if (p?.kind === 'battle') run = winFight(run, plan, step);
    else if (p?.kind === 'casino') run = plan.atCircle ? plan.atCircle(run) : ok(rtCasinoLeave(run), 'leave');
    else if (p?.kind === 'talisman') run = ok(rtChooseTalisman(run, null), 'talisman');
    else if (p) run = closeNode(run);
    else {
      const next = rtAvailableNodes(run), node = next.find(n => n.type === 'event') ?? next[0];
      if (plan.circle && rtCasinoNode(node) && !run.casino) { if (total(run) >= 1) eligible++; else eligibleNoStock++; }
      const entered = ok(rtEnterNode(run, node.id, null, plan.circle ? ON : {}), 'enter');
      if (entered.pending?.kind === 'casino') { circles++; circleAt = saves.length; }
      run = entered;
      saves.push(serializeRtRun(run));
      if (plan.stopAtCircle && run.pending?.kind === 'casino') break;
      continue;
    }
    saves.push(serializeRtRun(run));
  }
  return { saves, run, circles, eligible, eligibleNoStock, circleAt };
}
/** Walks seeds from `from` until the circle stands (stopping there); its walk. */
function toCircle(from: number, plan: Omit<WalkPlan, 'circle' | 'stopAtCircle'> = {}, accept: (run: RtRunState, k: number) => boolean = () => true): { run: RtRunState; k: number } {
  for (let k = from; k < from + 400; k++) {
    const w = walk(k, { ...plan, circle: true, stopAtCircle: true });
    if (w.run.pending?.kind === 'casino' && accept(w.run, k)) return { run: w.run, k };
  }
  throw new Error('no circle on 400 seeds');
}

// ---------------------------------------------------------------------------------------------------------------------

const SEEDS = 300;
const walksOn = Array.from({ length: SEEDS }, (_, i) => walk(i + 1, { circle: true }));
const walksOff = Array.from({ length: SEEDS }, (_, i) => walk(i + 1, { circle: false }));

check(`the circle stands on about ${RT_CASINO_CHANCE} % of the eligible event nodes (${SEEDS} runs; heuristic), never twice in a run`, () => {
  const eligible = walksOn.reduce((sum, w) => sum + w.eligible, 0), circles = walksOn.reduce((sum, w) => sum + w.circles, 0);
  const runsEligible = walksOn.filter(w => w.eligible > 0).length, runsCircle = walksOn.filter(w => w.circles > 0).length;
  // Eligible nodes counted until the circle stands (none after it): circles ÷ eligible is the chance per node.
  const perNode = circles / eligible;
  console.log(`  eligible event nodes ${eligible}, circles ${circles} (${(100 * perNode).toFixed(1)} % a node); runs with an eligible node ${runsEligible}, with a circle ${runsCircle} (${(100 * runsCircle / Math.max(1, runsEligible)).toFixed(1)} % of them)`);
  assert(eligible >= 200, `enough eligible nodes: ${eligible}`);
  assert(perNode > 0.2 && perNode < 0.4, `the chance a node: ${perNode}`);
  assert(walksOn.every(w => w.circles <= 1), 'at most one circle a run');
  assert(walksOn.every(w => w.saves.filter(text => text.includes('"kind":"casino"')).length <= 1 + RT_CASINO_GAMES), 'one circle screen a run');
  // Every circle on an event node of run row 3 or later.
  for (const w of walksOn) if (w.run.casino) {
    const node = rtNode(w.run, w.run.casino.nodeId)!;
    assert(node.type === 'event' && runRow(node.row) >= 3 && rtCasinoRoll(w.run.seed, node.id) < RT_CASINO_CHANCE, `seed ${w.run.seed}: the circle's node`);
  }
});

check('without the key, and with it where the circle never stands, a run saves byte for byte as before (300 runs)', () => {
  let without = 0, prefixes = 0;
  for (let i = 0; i < SEEDS; i++) {
    const on = walksOn[i], off = walksOff[i];
    assert(off.saves.every(text => !text.includes('casino')), `seed ${i + 1}: no circle field without the key`);
    if (on.circles === 0) { assert(same(on.saves, off.saves), `seed ${i + 1}: the same saves`); without++; continue; }
    // With a circle: the same saves up to the node it stands on.
    assert(same(on.saves.slice(0, on.circleAt), off.saves.slice(0, on.circleAt)), `seed ${i + 1}: the same saves before the circle`);
    prefixes++;
  }
  console.log(`  runs without a circle ${without} (byte for byte), with one ${prefixes} (the same up to it)`);
  assert(without >= 50 && prefixes >= 50, 'both kinds of runs');
});

check('the 8 whole runs of the reroll fixture (real fights, code of 7ae55fc, re-recorded at the calibration and at task 5 of 12.10.2026): byte for byte without the key; with it, those the circle never meets too', () => {
  const fnv = (text: string): string => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };
  const walkSaves = (k: number, circle: boolean): string[] => {
    // Task 12 (13.10.2026): the fixture's saves predate the run flag `markedGoals` (it adds one field to every save; the fights
    // here play the test field, not the marked arenas) — the walk keeps a run without it, so the bytes compare as before.
    // Task 15 (14.10.2026): the same for the flag `healMap` (one more field; the walk buys no map heal).
    // Task 28 (15.10.2026): the same for the flag `jailer` (one more field, and the Jailer's node plays its pool as the fixture's).
    let run: RtRunState = takeGift(createRtRun(seedOf(k), { gift: 'mini', markedGoals: false, ...RT_TASK17_OFF, healMap: false, shortFuse: false, jailer: false, troll: false, markerSeek: false, chronicle: false, bossHoles: false, corePickFirst: false, forms: false, garrison: false, potionCap: 0 }));
    const saves = [serializeRtRun(run)];
    for (let step = 0; step < 160 && !run.result; step++) {
      const p = run.pending;
      if (p?.kind === 'battle') run = ok(resolveArena(run, playFight(run, { chains: [6, 6, 6, 6], k }).outcome), 'fight');
      else if (p?.kind === 'talisman') run = ok(rtChooseTalisman(run, p.options[0] ?? null), 'talisman');
      else if (p?.kind === 'casino') run = ok(rtCasinoLeave(run), 'leave');
      else if (p?.kind === 'event') {
        const fight = rtEventView(run)!.options.find(option => option.battle && option.available);
        run = fight ? ok(rtChooseEventOption(run, fight.id), 'event battle') : closeNode(run);
      } else if (p) run = closeNode(run);
      else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, (next.find(n => n.type === 'hard') ?? next.find(n => n.type === 'event') ?? next[0]).id, null, circle ? ON : {}), 'enter'); }
      saves.push(serializeRtRun(run));
    }
    return saves;
  };
  const walks = before.walks as Record<string, { steps: number; hash: string }>;
  let met = 0;
  for (const [k, want] of Object.entries(walks)) {
    const off = walkSaves(Number(k), false);
    assert(off.length === want.steps && fnv(off.join('\n')) === want.hash, `seed ${k}: without the key — ${fnv(off.join('\n'))} (was ${want.hash})`);
    const on = walkSaves(Number(k), true), at = on.findIndex(text => text.includes('"kind":"casino"'));
    if (at < 0) assert(same(on, off), `seed ${k}: with the key and no circle — the same saves`);
    else { assert(same(on.slice(0, at), off.slice(0, at)), `seed ${k}: the same saves before the circle`); met++; }
  }
  console.log(`  the circle met in ${met} of 8 fixture runs`);
});

check('entering the circle spends no run stream (the `events` draw comes after its roll and is not taken), no event is met; without the key the node is its event', () => {
  let n = 0;
  for (const w of walksOn) {
    if (!w.run.casino) continue;
    const at = w.circleAt, beforeIt = JSON.parse(w.saves[at - 1]) as RtRunState, after = JSON.parse(w.saves[at]) as RtRunState;
    assert(same(after.streams, beforeIt.streams) && same(after.picks, beforeIt.picks) && after.oathDraws === beforeIt.oathDraws, `seed ${w.run.seed}: no stream moved, no pick`);
    assert(after.casinoDraws === 1 && same(after.casino, { nodeId: after.casino!.nodeId, games: [] }) && same(after.pending, { kind: 'casino', nodeId: after.casino!.nodeId }), 'the circle is open');
    assert(rtNodeTitle(after, rtNode(after, after.casino!.nodeId)!) === RT_CASINO_TITLE, 'the map names it');
    const plain = ok(rtEnterNode(beforeIt, after.casino!.nodeId), 'without the key');
    assert(plain.pending?.kind === 'event' || plain.pending?.kind === 'find', 'without the key — the event (or a find)');
    assert(plain.streams.events === beforeIt.streams.events + 1 && !('casinoDraws' in plain), 'the event takes its draw; no circle field');
    n++;
  }
  assert(n >= 50, `circles checked: ${n}`);
});

check('0 resources: no circle on a node whose roll would stand it — the ordinary event, as without the key', () => {
  let n = 0;
  for (let k = 1; k <= 120; k++) {
    // Fights pick up nothing; the start gift's resource buttons are not taken (the walk passes it by when it can).
    let run = createRtRun(seedOf(k), { gift: 'mini', garrison: false });
    run = takeGift(run);
    for (let step = 0; step < 200 && !run.result; step++) {
      const p = run.pending;
      if (p?.kind === 'battle') { run = winFight(run, { circle: true, materials: 0 }, step); continue; }
      if (p) { run = p.kind === 'talisman' ? ok(rtChooseTalisman(run, null), 'talisman') : closeNode(run); continue; }
      const next = rtAvailableNodes(run), node = next.find(entry => entry.type === 'event') ?? next[0];
      if (rtCasinoNode(node) && total(run) === 0 && rtCasinoRoll(run.seed, node.id) < RT_CASINO_CHANCE) {
        const on = ok(rtEnterNode(run, node.id, null, ON), 'enter'), off = ok(rtEnterNode(run, node.id), 'enter');
        assert(same(on, off) && on.pending?.kind !== 'casino', `seed ${k}: the ordinary event`);
        n++;
      }
      run = ok(rtEnterNode(run, node.id, null, ON), 'enter');
      // Spend what an event gave, so the stock stays 0 where it can (a shop would sell; a rest crafts nothing).
    }
  }
  console.log(`  nodes with the roll and 0 resources: ${n}`);
  assert(n >= 5, `such nodes met: ${n}`);
});

check(`at most ${RT_CASINO_GAMES} games a visit over both tables; then both are off with the reason; «Уйти» completes the node`, () => {
  for (let i = 0; i < 6; i++) {
    const { run: open } = toCircle(1 + i * 37, { materials: 4 });
    let run = open;
    for (const table of ['dice', 'wheel', i % 2 ? 'dice' : 'wheel'] as const) {
      const before = run.casinoDraws!;
      run = ok(rtCasinoPlay(run, table), table);
      assert(run.casinoDraws === before + 1 && lastGame(run).table === table, 'one draw a game');
    }
    const view = rtCasinoView(run)!;
    assert(view.played === 3 && view.tables.every(t => !t.available && t.reason === `Игр больше нет (${RT_CASINO_GAMES} из ${RT_CASINO_GAMES})`), 'both tables off');
    for (const table of ['dice', 'wheel'] as const) { const refused = rtCasinoPlay(run, table); assert(!refused.ok && refused.reason.startsWith('Игр больше нет'), 'the 4th game refused'); }
    const left = rtCasinoLeave(run);
    assert(left.ok && left.run.pending === null && left.run.visited.includes(run.casino!.nodeId) && left.run.currentNodeId === run.casino!.nodeId, '«Уйти» completes the node');
    assert(reload(left.run).casino!.games.length === 3, 'the games stay in the save');
  }
});

check('«Кости»: stake 1, a sum of 8+ pays 3 resources, the faces are the game\'s; about 15/36 of the games win (heuristic); the stake is needed', () => {
  let games = 0, wins = 0;
  const faces = new Set<string>();
  for (let k = 1; games < 600 && k < 3000; k += 1) {
    let w: Walk;
    try { w = walk(k, { circle: true, stopAtCircle: true, materials: 3 }); } catch { continue; }
    let run = w.run;
    if (run.pending?.kind !== 'casino') continue;
    for (let g = 0; g < RT_CASINO_GAMES && total(run) >= 1; g++) {
      const beforeTotal = total(run), step = rtCasinoPlay(run, 'dice');
      assert(step.ok, 'dice');
      const game = lastGame(step.run);
      assert(game.table === 'dice', 'a dice game');
      const sum = game.faces[0] + game.faces[1], win = sum >= 8;
      assert(game.faces.every(face => face >= 1 && face <= 6), 'faces 1–6');
      assert(total(step.run) === beforeTotal - 1 + (win ? 3 : 0) && game.gain.length === (win ? 3 : 0), `the payout: ${beforeTotal} → ${total(step.run)} with ${sum}`);
      const played = step.events.find(e => e.type === 'casino-played');
      assert(played?.type === 'casino-played' && played.win === win && played.text.startsWith(`Кости: ${game.faces[0]} и ${game.faces[1]} = ${sum} → `), `the line: ${played?.type === 'casino-played' ? played.text : ''}`);
      faces.add(game.faces.join('+'));
      games++; if (win) wins++;
      run = step.run;
    }
  }
  const share = wins / games;
  console.log(`  ${games} games of «Кости»: ${wins} wins (${(100 * share).toFixed(1)} %, expected ${(100 * RT_DICE_WIN_CHANCE).toFixed(1)} %), ${faces.size} of 36 face pairs`);
  assert(Math.abs(RT_DICE_WIN_CHANCE - 15 / 36) < 1e-12, 'the chance shown is 15/36');
  assert(games >= 300 && share > 0.33 && share < 0.5 && faces.size >= 30, 'the dice vary and win about 15/36');
  // No stake — no game: a circle whose games of «Кости» lose every resource before the 3rd game.
  const lose = (run: RtRunState): RtRunState => { while (total(run) >= 1 && run.casino!.games.length < RT_CASINO_GAMES) run = ok(rtCasinoPlay(run, 'dice'), 'dice'); return run; };
  const { run: open } = toCircle(1, { materials: 0 }, run => { const end = lose(run); return total(end) === 0 && end.casino!.games.length < RT_CASINO_GAMES; });
  const broke = lose(open), view = rtCasinoView(broke)!;
  assert(total(broke) === 0 && view.tables.every(t => !t.available && t.reason === 'Нужно ресурсов: 1, есть 0'), `no stake: ${view.tables.map(t => t.reason)}`);
  const refused = rtCasinoPlay(broke, 'dice');
  assert(!refused.ok && refused.reason === 'Нужно ресурсов: 1, есть 0', 'the game is refused');
});

check('«Колесо костей» in the circle: the event\'s outcomes and HP threshold (design 12.10.2026: HP ≥ 6, as the event); a talisman without the `talismans` stream', () => {
  // A fight won with 5 HP left, then the circle: the wheel is off with the event's reason, «Кости» stay open.
  const { run: low } = toCircle(1, { hp: 5, materials: 2 }, () => true);
  assert(low.hp === 5, `the hero comes with 5 HP (${low.hp})`);
  const lowView = rtCasinoView(low)!, wheelView = lowView.tables.find(t => t.table === 'wheel')!;
  assert(!wheelView.available && wheelView.reason === 'Нужно HP ≥ 6 (сейчас 5)', `the wheel is off at 5 HP: ${wheelView.reason}`);
  assert(wheelView.outcomes.length === 6 && wheelView.outcomes.every(o => o.odds === '1 из 6'), 'six outcomes 1 из 6');
  assert(lowView.tables.find(t => t.table === 'dice')!.available, '«Кости» are open at any HP');
  const refused = rtCasinoPlay(low, 'wheel');
  assert(!refused.ok && refused.reason === 'Нужно HP ≥ 6 (сейчас 5)', 'the spin is refused');
  // At 6 HP the wheel opens.
  const { run: six } = toCircle(1, { hp: 6, materials: 2 }, () => true);
  assert(six.hp === 6 && rtCasinoView(six)!.tables.find(t => t.table === 'wheel')!.available, 'the wheel is open at 6 HP');
  // The same outcome from more HP takes rtHp(1) = 3.
  const { run: full } = toCircle(1, { materials: 2 }, run => {
    const step = rtCasinoPlay(run, 'wheel');
    return step.ok && (lastGame(step.run) as { outcome: number }).outcome === BONE_IN_FOREHEAD && run.hp > 3;
  });
  assert(ok(rtCasinoPlay(full, 'wheel'), 'wheel').hp === full.hp - rtHp(1), '−3 HP otherwise');
  // A talisman: drawn inside the game's draw — the `talismans` stream does not move.
  const { run: lucky } = toCircle(1, { materials: 2 }, run => {
    const step = rtCasinoPlay(run, 'wheel');
    return step.ok && (lastGame(step.run) as { outcome: number }).outcome === TALISMAN;
  });
  const got = ok(rtCasinoPlay(lucky, 'wheel'), 'wheel'), game = lastGame(got);
  assert(game.table === 'wheel' && !!game.talisman && got.talismans.includes(game.talisman) && got.talismans.length === lucky.talismans.length + 1, 'a talisman taken');
  assert(same(got.streams, lucky.streams), 'no run stream moved (the `talismans` stream too)');
  // Outcomes vary over seeds (every one of the six comes).
  const seen = new Set<number>();
  for (let k = 1; k < 200 && seen.size < 6; k++) {
    const w = walk(k, { circle: true, stopAtCircle: true, materials: 2 });
    if (w.run.pending?.kind !== 'casino') continue;
    const step = rtCasinoPlay(w.run, 'wheel');
    if (step.ok) seen.add((lastGame(step.run) as { outcome: number }).outcome);
  }
  assert(seen.size === 6, `all six outcomes come: ${[...seen]}`);
});

check('a run with forms names the counters by their chain window in the outcome lines: the wheel\'s talisman, an event fight\'s reward («Острие», «Улов», not «Пятое звено», «Третья цепь»)', () => {
  // The counters the window renames; the line must carry the run's name, not the catalogue's (design 17.10.2026).
  const renamed = Object.keys(RT_COUNTER_WINDOW).filter(id => RT_COUNTER_WINDOW[id].name);
  const shownRight = (text: string, id: string): boolean => text.includes(`«${RT_COUNTER_WINDOW[id].name}»`) && !text.includes(rtTalisman(id)!.name);
  // The wheel: real walks to the circle, one spin; every renamed counter it gives is shown by its window name.
  const wheelSeen = new Set<string>();
  for (let k = 1; k < 400 && wheelSeen.size < renamed.length; k++) {
    const w = walk(k, { circle: true, stopAtCircle: true, materials: 2 });
    if (w.run.pending?.kind !== 'casino') continue;
    const step = rtCasinoPlay(w.run, 'wheel');
    if (!step.ok) continue;
    const game = lastGame(step.run);
    if (game.table !== 'wheel' || !game.talisman || !renamed.includes(game.talisman)) continue;
    assert(step.run.forms === true, `seed ${k}: a new run plays forms`);
    const played = step.events.find(ev => ev.type === 'casino-played');
    assert(played?.type === 'casino-played' && shownRight(played.text, game.talisman), `seed ${k}: the game's line ${played?.type === 'casino-played' ? played.text : '—'}`);
    assert(shownRight(rtCasinoView(step.run)!.last!.text, game.talisman), `seed ${k}: the circle's last line ${rtCasinoView(step.run)!.last!.text}`);
    wheelSeen.add(game.talisman);
  }
  assert(wheelSeen.size === renamed.length, `the wheel gave every renamed counter on 400 seeds: ${[...wheelSeen]}`);
  // An event's fight: the battle option taken, the fight won, a renamed counter of the reward chosen — the event's line.
  const eventSeen = new Set<string>();
  for (let k = 1; k < 400 && eventSeen.size < renamed.length; k++) {
    let run = takeGift(createRtRun(seedOf(k), { gift: 'mini', garrison: false }));
    for (let step = 0; step < 200 && !run.result; step++) {
      const p = run.pending;
      if (p?.kind === 'event') {
        const option = rtEventView(run)!.options.find(o => o.battle && o.available);
        run = option ? ok(rtChooseEventOption(run, option.id), 'battle option') : closeNode(run);
      } else if (p?.kind === 'battle') run = winFight(run, {} as WalkPlan, step);
      else if (p?.kind === 'talisman' && p.source === 'event') {
        const pick = p.options.find(id => renamed.includes(id)) ?? null;
        const chosen = rtChooseTalisman(run, pick);
        assert(chosen.ok, 'the reward');
        if (pick) {
          assert(chosen.run.forms === true, `seed ${k}: a new run plays forms`);
          const resolved = chosen.events.find(ev => ev.type === 'event-resolved');
          assert(resolved?.type === 'event-resolved' && shownRight(resolved.text, pick), `seed ${k}: the event's line ${resolved?.type === 'event-resolved' ? resolved.text : '—'}`);
          eventSeen.add(pick);
        }
        run = chosen.run;
      } else if (p?.kind === 'talisman') run = ok(rtChooseTalisman(run, null), 'talisman');
      else if (p) run = closeNode(run);
      else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, (next.find(n => n.type === 'event') ?? next[0]).id, null), 'enter'); }
    }
  }
  assert(eventSeen.size === renamed.length, `an event's fight gave every renamed counter on 400 seeds: ${[...eventSeen]}`);
});

check('a reload keeps the outcome: the same last game shown, the next game the same as without the reload; a reload at the open circle plays the same first game', () => {
  const store = (): { storage: RunStorage; data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } } };
  };
  for (const from of [1, 41, 81, 121]) {
    const { run: open, k } = toCircle(from, { materials: 4 });
    const page = store(), runs = createRtRunStore(page.storage);
    runs.save(open);
    const back = createRtRunStore(page.storage).load()!;
    assert(same(back, open) && page.data.has(RT_RUN_STORAGE_KEY), `seed ${k}: the open circle loads as it was`);
    const first = ok(rtCasinoPlay(open, 'dice'), 'dice'), again = ok(rtCasinoPlay(back, 'dice'), 'dice');
    assert(same(first, again), `seed ${k}: the same first game after a reload`);
    runs.save(first);
    const shown = createRtRunStore(page.storage).load()!;
    assert(same(rtCasinoView(shown)!.last, rtCasinoView(first)!.last), `seed ${k}: the same last game shown`);
    assert(same(ok(rtCasinoPlay(shown, 'wheel'), 'wheel'), ok(rtCasinoPlay(first, 'wheel'), 'wheel')), `seed ${k}: the next game the same`);
  }
  // Different seeds — different games.
  const firsts = new Set<string>();
  for (const from of [1, 41, 81, 121, 161, 201]) { const { run } = toCircle(from, { materials: 4 }); firsts.add(JSON.stringify(lastGame(ok(rtCasinoPlay(run, 'dice'), 'dice')))); }
  assert(firsts.size >= 3, `the first games vary: ${firsts.size}`);
});

check('old saves (fixtures before the circle) load unchanged and play on; malformed circle fields are no run', () => {
  for (const [name, text] of [['reroll hard', before.hard], ['reroll event', before.event], ['mix', beforeMix.save], ['record', beforeRecord.save]] as const) {
    const run = parseRtRun(text);
    assert(run && serializeRtRun(run) === JSON.stringify(JSON.parse(text)) && !('casino' in run) && !('casinoDraws' in run), `${name}: loads unchanged, no circle fields`);
    // Plays on to its end with the key, every save loading again.
    let next: RtRunState = run;
    for (let step = 0; step < 200 && !next.result; step++) {
      const p = next.pending;
      if (p?.kind === 'battle') next = winFight(next, { circle: true }, step);
      else if (p?.kind === 'casino') next = ok(rtCasinoPlay(next, 'dice').ok ? rtCasinoPlay(next, 'dice') : rtCasinoLeave(next), 'circle');
      else if (p?.kind === 'talisman') next = ok(rtChooseTalisman(next, null), 'talisman');
      else if (p) next = closeNode(next);
      else { const nodes = rtAvailableNodes(next); next = ok(rtEnterNode(next, (nodes.find(n => n.type === 'event') ?? nodes[0]).id, null, ON), 'enter'); }
      assert(same(reload(next), next), `${name}: step ${step} reloads`);
    }
    assert(next.result, `${name}: the run ends`);
  }
  // A run with a circle and games, then forged.
  const { run: open } = toCircle(1, { materials: 4 });
  const played = ok(rtCasinoPlay(ok(rtCasinoPlay(open, 'dice'), 'dice'), 'wheel'), 'wheel');
  assert(same(reload(played), played), 'the circle with games reloads');
  const forged: [string, (r: any) => void][] = [
    ['the counter without the circle', r => { delete r.casino; delete r.pending; r.pending = null; }],
    ['the circle without the counter', r => { delete r.casinoDraws; }],
    ['the counter off by one', r => { r.casinoDraws++; }],
    ['another face', r => { const g = r.casino.games[0]; g.faces = [g.faces[0] % 6 + 1, g.faces[1]]; }],
    ['another wheel outcome', r => { const g = r.casino.games[1]; g.outcome = (g.outcome + 1) % 6; }],
    ['a gain added', r => { r.casino.games[0].gain.push('herbs'); }],
    ['four games', r => { r.casino.games.push(r.casino.games[0], r.casino.games[0]); r.casinoDraws += 2; }],
    ['a node it may not stand on', r => { r.casino.nodeId = r.visited[0]; }],
    ['an unknown table', r => { r.casino.games[0].table = 'slots'; }],
    ['more «Кости» in the tally than played', r => { r.luck['casino-dice'].tries = 5; r.luck['casino-dice'].hits = 0; r.luck['casino-dice'].expected = 1; }],
    ['an extra field on the open circle', r => { r.pending.games = 2; }],
  ];
  for (const [name, forge] of forged) {
    const copy = JSON.parse(serializeRtRun(played));
    forge(copy);
    assert(parseRtRun(JSON.stringify(copy)) === null, `forged (${name}) is no run`);
  }
});

check('«Журнал удачи»: «Кости» against 15/36 a game; the wheel\'s spins with their odds; the circle writes no other line', () => {
  const { run: open } = toCircle(7, { materials: 4 });
  let run = ok(rtCasinoPlay(open, 'dice'), 'dice');
  run = ok(rtCasinoPlay(run, 'dice'), 'dice');
  run = ok(rtCasinoPlay(run, 'wheel'), 'wheel');
  const dice = run.casino!.games.filter(g => g.table === 'dice') as Extract<RtCasinoGame, { table: 'dice' }>[], wins = dice.filter(g => g.faces[0] + g.faces[1] >= 8).length;
  assert(same(run.luck?.['casino-dice'], { tries: 2, hits: wins, expected: 2 * 15 / 36 }), `the tally: ${JSON.stringify(run.luck)}`);
  const lines = rtLuckReport(run), diceLine = lines.find(line => line.id === 'casino-dice'), wheelLines = lines.filter(line => line.label === `«${RT_CASINO_TITLE}»`);
  assert(diceLine && diceLine.label === 'Кости (игорный круг)' && diceLine.text === `2 игры · 8+ выпало ${wins} (ожидание 0,8)`, `the dice line: ${diceLine?.text}`);
  assert(wheelLines.length === 1 && wheelLines[0].text.startsWith('Колесо костей: ') && wheelLines[0].text.endsWith('— шанс 1 из 6'), `the wheel line: ${wheelLines.map(l => l.text)}`);
  // A circle left without a game adds no line.
  const quiet = ok(rtCasinoLeave(open), 'leave');
  assert(!rtLuckReport(quiet).some(line => line.id === 'casino-dice' || line.label === `«${RT_CASINO_TITLE}»`), 'no line without a game');
});

check('telemetry: the circle\'s games and «Уйти» are one choice of the visit (source `casino`)', () => {
  const { run: open } = toCircle(3, { materials: 4 });
  const list: RunChoice[] = [];
  let run = open;
  for (const act of ['dice', 'wheel', 'leave'] as const) {
    const step: RtRunStep = act === 'leave' ? rtCasinoLeave(run) : rtCasinoPlay(run, act);
    assert(step.ok, act);
    for (const c of stepChoices(run, step)) mergeChoice(list, c);
    run = step.run;
  }
  assert(list.length === 1 && list[0].source === 'casino' && same(list[0].offered, ['dice', 'wheel', 'leave']) && same(list[0].taken, ['dice', 'wheel', 'leave']), `choices: ${JSON.stringify(list)}`);
});

console.log(`casino: ${checks} checks ok`);
