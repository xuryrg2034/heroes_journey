/**
 * The score of a run and the bar of openings (docs/roguelike-runs.md, section 7; runScore.ts, unlocks.ts): through real
 * run commands, battles in the engine (ended with its debug win or loss, damage and items through its own commands:
 * this suite checks the run, not a bot) and the player profile store. Seeds are spread with Math.imul(k, 2654435761).
 *
 * - the engine reports a battle's damage, consumables used and the exit chest; the run keeps them;
 * - every line of the score and every style bonus, on runs built for it, and their absence when the condition fails;
 * - the bar: at most one level per run, the surplus cut to «next threshold − 1»; no storage — nothing gathers, no error;
 * - closed talismans, oaths and events never come (offers, the Jailer, the merchant, the gift, the map's events); opened
 *   ones do; an event opened before it exists in the game changes nothing;
 * - saves keep the battle log, the play time and the tally; forged ones are rejected.
 */
import { ForestEngine } from './forestEngine';
import { addPlayTime, availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseGift, chooseGiftPick, chooseTalisman, createForestRun, enterNode, eventView,
  forestRunScore, giftView, parseForestRun, recordTally, resolveBattle, restHeal, serializeForestRun, shopLeave, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { authoredLesson } from './lessonBuilder';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';
import { createPlayerProfileStore } from './run/playerProfile';
import type { RunStorage } from './run/forestRunStorage';
import { applyRunScore, CATALOGUE_EVENTS, UNLOCK_LEVELS, UNLOCK_START, UNLOCK_THRESHOLDS, unlockedAt } from './run/unlocks';
import { FOREST_EVENTS } from './run/forestEvents';
import { STYLE_FAST_MS } from './run/runScore';
import { TALISMANS, type TalismanId } from './talismans';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };
const memory = (): RunStorage => { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }; };
const lines = (run: ForestRunState) => Object.fromEntries(forestRunScore(run).lines.map(line => [line.id, line.points]));
const styles = (run: ForestRunState) => Object.fromEntries(forestRunScore(run).styles.map(line => [line.id, line.points]));

// ---------- The engine's report of a battle ----------

// The exit field of the telemetry spec: door on A1 (0), the marked target on A2 (5), the cat on B5; the chain up column A
// meets the goal on turn 1 and the chest falls.
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
registry['spec-meta-exit'] = authoredLesson({ id: 'spec-meta-exit', name: 'Выход за целью', description: '', hint: '',
  rows: ['DgGGG', 'TGGGG', 'RGGGG', 'RGGGG', 'RHGGG'], legend: { D: { door: true }, T: { color: 0, target: true } }, seed: 7201 });
const COLUMN = [20, 15, 10, 5], DOOR = 0;
async function chain(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), `begin ${path[0]}`);
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
  assert(await g.releaseChain(), 'released');
}

/** Damage, consumables used and the chest come from the battle itself (its events), whatever the HP and stock at the end. */
async function engineReports() {
  let opened = 0, dropped = 0;
  for (let k = 1; k <= 10; k++) {
    const setup: RunBattleSetup = { nodeId: 'spec-meta', label: 'spec', seed: spread(k), template: { kind: 'battle', id: 'spec-meta-exit' }, row: 6,
      player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { frost: 0, bomb: 2, healing: 1, fire: 0 }, allowedItems: ['bomb', 'healing'], allowedAbilities: [] };
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startRunBattle(setup), 'the spec battle starts');
    let damage = 0;
    g.subscribe((state, event) => { if (event.type === 'damage' && event.index === state.player.index) damage += event.amount ?? 0; });
    if (k % 2 === 0) { g.damagePlayer(1); assert(g.useItem('healing'), 'healing used'); }
    const target = g.state.board.findIndex((_cell, index) => index !== 5 && g.previewItem('bomb', index).valid);
    if (k % 3 === 0 && target >= 0) assert(g.useItem('bomb', target), 'bomb used');
    await chain(g, COLUMN);
    assert(g.state.customLevel!.goalCompletedTurn !== null, `seed ${k}: goals met`);
    const chestAt = g.state.board.findIndex(cell => !!cell?.chest);
    const through = k % 2 && chestAt >= 0 ? g.availableMoves(8).find(candidate => candidate.includes(chestAt) && !candidate.includes(DOOR)) : undefined;
    if (through) await chain(g, through);
    const outcome = (g.winLevel(), g.runBattleOutcome()!);
    const used = 3 - outcome.inventory.bomb - outcome.inventory.healing;
    assert(outcome.damageTaken === damage && outcome.itemsUsed === used, `seed ${k}: damage ${outcome.damageTaken} = ${damage}, items ${outcome.itemsUsed} = ${used}`);
    assert(outcome.chest === (through ? 'opened' : chestAt >= 0 ? 'dropped' : undefined), `seed ${k}: the chest ${outcome.chest} (through ${!!through})`);
    if (through) opened++; else if (chestAt >= 0) dropped++;
    // A restart clears the report.
    g.restartLevel();
    assert(json(g.runBattleOutcome()) === 'null' && (g.winLevel(), g.runBattleOutcome()!.damageTaken === 0 && !g.runBattleOutcome()!.chest), `seed ${k}: a restart clears the report`);
  }
  assert(opened >= 2 && dropped >= 2, `chests opened (${opened}) and left (${dropped})`);
  console.log(`PASS the engine reports damage, consumables used and the chest of a battle (10 seeds: ${opened} opened, ${dropped} left); a restart clears it`);
}

// ---------- Score lines and style bonuses on runs built for them (authored graph) ----------

const TRUNK = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4'];
const TO_JAILER = [...TRUNK, 'beast-wolf', 'beast-boar', 'trail-find', 'trail-banners', 'jailer'];
const TO_CHIEF = [...TO_JAILER, 'camp-battle', 'camp-rest', 'camp-elite', 'camp-breakthrough', 'camp-chief'];
interface Plan {
  seed?: number; ladder?: number; gift?: boolean;
  /** Per node id: damage the cat takes, a bomb used, the chest the battle reports, the battle is lost. */
  damage?: Record<string, number>; bomb?: string; chest?: Record<string, 'dropped' | 'opened'>; lose?: string;
  /** Talismans: take the first option of hard battles and the Jailer (else refuse); the gift's oath (else +1 maximum HP). */
  take?: boolean; giftOath?: boolean; playMs?: number;
}
/** Walk `ids` with real engine battles; the plan decides damage, a bomb, the chest, talismans and the gift. */
async function walk(ids: string[], plan: Plan = {}): Promise<ForestRunState> {
  let run = createForestRun(plan.seed ?? spread(1), { ladder: plan.ladder, ...plan.gift ? { gift: 'full' } : {} });
  for (const id of ids) {
    if (run.pending?.kind === 'gift') {
      const options = giftView(run)!.options, oath = options.findIndex(entry => entry.option.kind === 'oath'), hp = options.findIndex(entry => entry.option.kind === 'energy' || entry.option.kind === 'resources' || entry.option.kind === 'calm');
      run = ok(chooseGift(run, plan.giftOath ? oath : hp >= 0 ? hp : 0), 'gift');
      if (run.pending?.kind === 'gift') run = ok(chooseGiftPick(run, giftView(run)!.picks[0]), 'gift pick');
    }
    if (plan.playMs !== undefined && id === ids.at(-1)) run = addPlayTime(run, plan.playMs);
    run = ok(enterNode(run, id), `enter ${id}`);
    if (run.pending?.kind === 'battle') {
      const g = new ForestEngine(); g.animationScale = 0;
      assert(g.startRunBattle(battleSetup(run)!), `${id} starts`);
      if (plan.bomb === id) {
        const target = g.state.board.findIndex((_cell, index) => g.previewItem('bomb', index).valid);
        assert(target >= 0 && g.useItem('bomb', target), `${id}: the bomb is used`);
      }
      if (plan.damage?.[id]) g.damagePlayer(plan.damage[id]);
      if (plan.lose === id) g.damagePlayer(99); else if (g.state.phase !== 'WIN') g.winLevel();
      const outcome = g.runBattleOutcome()!;
      run = ok(resolveBattle(run, plan.chest?.[id] ? { ...outcome, chest: plan.chest[id] } : outcome), `resolve ${id}`);
    }
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, plan.bomb ? 'bomb' : run.pending.options[0]), 'find');
    if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, plan.take ? run.pending.options.find(option => option !== 'blank') ?? null : null), 'talisman');
    if (run.pending?.kind === 'rest') run = ok(restHeal(run), 'rest');
  }
  return run;
}

/** Each line of the score: row, ordinary battles, hard battles, the Jailer, the boss, battle points, the ladder. */
async function scoreLines() {
  // A defeat at the Jailer: the row of the last completed node, seven ordinary battles, no Jailer line.
  const lost = await walk(TO_JAILER, { lose: 'jailer' });
  assert(lost.result?.outcome === 'defeat', 'the run fell at the Jailer');
  assert(json(lines(lost)) === json({ row: 5 * 8, battles: 2 * 7, ...lost.score >= 10 ? { points: Math.floor(lost.score / 10) } : {} }), `defeat at the Jailer: ${json(lines(lost))}`);
  // A victory over the Chief: row 14, nine ordinary battles (trunk, trails, the camp battle, the breakthrough), the hard
  // battle, the Jailer and the boss.
  const won = await walk(TO_CHIEF);
  assert(won.result?.outcome === 'victory', 'the run won');
  const base = 5 * 14 + 2 * 9 + 15 + 30 + 100 + Math.floor(won.score / 10);
  assert(json(lines(won)) === json({ row: 70, battles: 18, hard: 15, jailer: 30, boss: 100, ...won.score >= 10 ? { points: Math.floor(won.score / 10) } : {} }), `victory: ${json(lines(won))}`);
  assert(forestRunScore(won).total === base + Object.values(styles(won)).reduce((sum, points) => sum + points, 0), 'the total is the lines plus the bonuses');
  // Battle points: one per ten, rounded down.
  const scored = { ...won, score: 137 };
  assert(lines(scored).points === 13, '137 battle points give 13');
  // The ladder: +5% of the lines per step, rounded down; the bonuses are not multiplied.
  const laddered = await walk(TO_CHIEF, { ladder: 3 });
  const ladderBase = Object.entries(lines(laddered)).filter(([id]) => id !== 'ladder').reduce((sum, [, points]) => sum + points, 0);
  assert(lines(laddered).ladder === Math.floor(ladderBase * 15 / 100) && forestRunScore(laddered).total === ladderBase + lines(laddered).ladder + Object.values(styles(laddered)).reduce((sum, points) => sum + points, 0),
    `step 3: +15% of ${ladderBase} = ${lines(laddered).ladder}`);
  console.log(`PASS score lines: row, battles, hard, Jailer, boss, points per 10, ladder +5% per step (victory ${forestRunScore(won).total}, defeat at the Jailer ${forestRunScore(lost).total})`);
}

/** Each style bonus when its condition holds, and none when it fails. */
async function styleBonuses() {
  // A clean victory: no damage, no items, fast, no talismans.
  const clean = await walk(TO_CHIEF, { playMs: STYLE_FAST_MS - 60_000 });
  assert(json(styles(clean)) === json({ 'clean-hard': 25, 'clean-boss': 50, 'no-items': 50, fast: 25, ascetic: 50 }), `a clean ascetic fast victory: ${json(styles(clean))}`);
  // Damage in the hard battle and the boss, a bomb used, a slow run, a talisman taken.
  const rough = await walk(TO_CHIEF, { damage: { 'camp-elite': 1, 'camp-chief': 1 }, bomb: 'camp-battle', playMs: STYLE_FAST_MS + 60_000, take: true });
  assert(rough.talismans.length >= 1 && json(styles(rough)) === json({}), `damage, a bomb, slowness and a talisman remove every bonus: ${json(styles(rough))}`);
  // Victory-only bonuses do not come with a defeat; the clean hard battle does.
  const fell = await walk(TO_CHIEF, { lose: 'camp-chief', playMs: 1000 });
  assert(fell.result?.outcome === 'defeat' && json(styles(fell)) === json({ 'clean-hard': 25 }), `a defeat keeps only the clean hard battle: ${json(styles(fell))}`);
  // Greedy: at least three chests, every one opened.
  const greedy = await walk(TO_JAILER, { lose: 'jailer', chest: { 'beast-wolf': 'opened', 'beast-boar': 'opened', 'trail-banners': 'opened' } });
  const short = await walk(TO_JAILER, { lose: 'jailer', chest: { 'beast-wolf': 'opened', 'beast-boar': 'opened' } });
  const missed = await walk(TO_JAILER, { lose: 'jailer', chest: { 'beast-wolf': 'opened', 'beast-boar': 'opened', 'trail-banners': 'opened', 'trunk-4': 'dropped' } });
  assert(styles(greedy).greedy === 25 && !styles(short).greedy && !styles(missed).greedy, 'greedy: three chests all opened, not two, not with one left');
  // Collector: three talismans (oaths count) — the gift's oath, the Jailer's oath, the hard battle's talisman; also in a defeat.
  const collector = await walk(TO_CHIEF, { gift: true, giftOath: true, take: true, lose: 'camp-chief' });
  assert(collector.talismans.length === 3 && styles(collector).collector === 25, `three talismans make a collector (${collector.talismans.join(', ')})`);
  const two = await walk(TO_CHIEF, { gift: true, take: true, lose: 'camp-chief' });
  assert(two.talismans.length === 2 && !styles(two).collector, 'two talismans do not');
  // A save before the battle log and the clock: no bonus that needs them.
  const old = structuredClone(clean); delete old.battleLog; delete old.playMs;
  assert(json(styles(old)) === json({ ascetic: 50 }), `a run without the log and the clock gets only what it can show: ${json(styles(old))}`);
  console.log('PASS style bonuses: clean hard and boss, no items, fast, greedy, collector, ascetic — each given only when its condition holds');
}

// ---------- The bar of openings ----------

function bar() {
  // One level per run, the surplus cut to the next threshold − 1.
  assert(json(applyRunScore({ points: 0, level: 0 }, 1000)) === json({ points: 299, level: 1, opened: 1 }), 'a big run opens one level and keeps 299');
  assert(json(applyRunScore({ points: 299, level: 1 }, 1)) === json({ points: 300, level: 2, opened: 2 }), 'one more point opens the next');
  assert(json(applyRunScore({ points: 0, level: 0 }, 99)) === json({ points: 99, level: 0, opened: null }), '99 opens nothing');
  assert(json(applyRunScore({ points: 699, level: 4 }, 5000)) === json({ points: 5699, level: 5, opened: 5 }), 'the last level keeps the points');
  assert(json(applyRunScore({ points: 950, level: 5 }, 10)) === json({ points: 960, level: 5, opened: null }), 'past the last level the points gather, nothing opens');
  // Through the profile: runs' scores add up, one opening per run; no storage — nothing gathers, no error.
  const profile = createPlayerProfileStore(memory());
  const first = profile.addRunScore(250), second = profile.addRunScore(250), third = profile.addRunScore(0), fourth = profile.addRunScore(1);
  assert(first.opened === 1 && first.after.points === 250 && second.opened === 2 && second.after.points === 449 && third.opened === null && third.after.points === 449
    && fourth.opened === 3 && fourth.after.points === 450 && fourth.saved, `scores gather run by run: ${json([first, second, third, fourth])}`);
  assert(profile.load().meta.level === 3 && profile.resetMeta() && json(profile.load().meta) === json({ points: 0, level: 0 }) && !profile.load().giftFull, 'the playtest reset empties the bar and the gift mark');
  const none = createPlayerProfileStore(null), tally = none.addRunScore(500);
  assert(!tally.saved && tally.opened === null && json(tally.after) === json(tally.before) && none.load().meta.level === 0, 'without storage the bar does not fill');
  // Data: every talisman and oath opens exactly once; the events of the game are in the table.
  const all = [UNLOCK_START, ...UNLOCK_LEVELS].flatMap(set => set.talismans);
  assert(all.length === TALISMANS.length && TALISMANS.every(entry => all.filter(id => id === entry.id).length === 1), 'every talisman opens exactly once');
  const events = [UNLOCK_START, ...UNLOCK_LEVELS].flatMap(set => set.events);
  assert(Object.keys(FOREST_EVENTS).every(id => events.includes(id)) && events.every(id => CATALOGUE_EVENTS[id]) && UNLOCK_THRESHOLDS.length === UNLOCK_LEVELS.length, 'the events of the game are in the table');
  console.log('PASS the bar: one level per run, the surplus cut, points past the last level; the profile gathers, resets, and without storage stays empty');
}

// ---------- Closed content never comes, opened content does ----------

/** Walk a generated run of `seed` at bar level `level` to its end: everything talisman-like it was offered and the events it met. */
function collect(seed: number, level: number) {
  let run = createForestRun(seed, { map: 'generated', skipTrunk: true, gift: 'full', unlocks: level });
  const seen = new Set<string>(), add = (ids: readonly (string | null | undefined)[]) => ids.forEach(id => { if (id) seen.add(id); });
  const gift = run.gift!.options;
  for (const option of gift) {
    if (option.kind === 'oath') add([option.oath]);
    if (option.kind === 'deal') add(option.reward.kind === 'pick-talisman' ? option.reward.talismans : [option.reward.talisman]);
  }
  run = ok(chooseGift(run, 1), 'gift');
  for (let n = 0; !run.result && n < 30; n++) {
    const list = availableNodes(run);
    run = ok(enterNode(run, list[spread(seed ^ (n + 1)) % list.length].id), 'enter');
    for (let guard = 0; run.pending && guard < 10; guard++) {
      const pending = run.pending;
      if (pending.kind === 'battle') { const g = new ForestEngine(); g.animationScale = 0; g.startRunBattle(battleSetup(run)!); g.winLevel(); run = ok(resolveBattle(run, g.runBattleOutcome()!), 'win'); }
      else if (pending.kind === 'talisman') { add(pending.options); run = ok(chooseTalisman(run, null), 'refuse'); }
      else if (pending.kind === 'shop') { add([pending.stock.talisman]); run = ok(shopLeave(run), 'leave'); }
      else if (pending.kind === 'event') run = ok(chooseEventOption(run, eventView(run)!.options.find(option => option.available)!.id), 'event');
      else if (pending.kind === 'find') run = ok(chooseFindItem(run, pending.options[0]), 'find');
      else if (pending.kind === 'rest') run = ok(restHeal(run), 'rest');
    }
  }
  assert(json(roundTrip(run)) === json(run), `seed ${seed}, level ${level}: the run saves`);
  return { talismans: seen, events: new Set(run.picks.flatMap(pick => pick.eventId ? [pick.eventId] : [])) };
}
function gating() {
  const closedAt0 = TALISMANS.map(entry => entry.id).filter(id => !UNLOCK_START.talismans.includes(id));
  const seenAt = (level: number) => {
    const talismans = new Set<string>(), events = new Set<string>();
    for (let k = 1; k <= 40; k++) { const got = collect(spread(k), level); got.talismans.forEach(id => talismans.add(id)); got.events.forEach(id => events.add(id)); }
    return { talismans, events };
  };
  const start = seenAt(0);
  assert(!closedAt0.some(id => start.talismans.has(id)) && !start.events.has('goblin-cache'), `level 0: nothing closed comes (${[...start.talismans].join(', ')}; events ${[...start.events].join(', ')})`);
  assert(start.talismans.size >= 4 && start.events.has('brook'), 'level 0: the start set comes');
  const open = seenAt(5);
  const late: TalismanId[] = ['millstone-shard', 'hourglass', 'oath-wrath'];
  assert(late.every(id => open.talismans.has(id)) && open.events.has('goblin-cache'), `level 5: the opened talismans, oath and event come (${[...open.talismans].join(', ')}; ${[...open.events].join(', ')})`);
  // An opened event that is not in the game yet (levels 4–5) changes nothing: the map meets only events that exist.
  assert(unlockedAt(5).events.some(id => !FOREST_EVENTS[id]) && [...open.events].every(id => FOREST_EVENTS[id]), 'events not in the game wait without breaking the run');
  console.log(`PASS closed talismans, oaths and events never come (level 0, 40 runs); opened ones come (level 5); events still missing in the game wait`);
}

// ---------- Saves ----------

async function saves() {
  const won = await walk(TO_CHIEF, { playMs: 5000, chest: { 'beast-wolf': 'opened' } });
  assert(won.battleLog!.length === 12 && won.battleLog![4].nodeId === 'beast-wolf' && won.battleLog![4].chest === 'opened' && won.playMs === 5000, 'the run keeps every resolved battle and its time');
  assert(json(roundTrip(won)) === json(won), 'the ended run saves');
  const profile = createPlayerProfileStore(memory()), tallied = ok(recordTally(won, profile.addRunScore(forestRunScore(won).total)), 'tally');
  assert(json(roundTrip(tallied)) === json(tallied) && tallied.tally!.score === forestRunScore(won).total && !recordTally(tallied, tallied.tally!).ok, 'the tally saves once');
  assert(addPlayTime(tallied, 1000) === tallied, 'a tallied run keeps its time');
  assert(forge(tallied, value => { value.tally.after.level = 9; }) === null && forge(tallied, value => { value.battleLog[0].nodeId = 'trunk-2'; }) === null
    && forge(tallied, value => { value.battleLog.pop(); }) === null && forge(tallied, value => { value.playMs = -1; }) === null, 'forged tally, log and time are rejected');
  const open = createForestRun(spread(2), { unlocks: 2 });
  assert(!recordTally(open, tallied.tally!).ok && forge(open, value => { value.tally = tallied.tally; }) === null, 'a run without a result has no tally');
  assert(forge(open, value => { value.unlocks = 9; }) === null && roundTrip(open)?.unlocks === 2, 'the open level saves; a wrong one is rejected');
  console.log('PASS the battle log, the play time, the open level and the tally save; forged ones are rejected');
}

await engineReports();
await scoreLines();
await styleBonuses();
bar();
gating();
await saves();
