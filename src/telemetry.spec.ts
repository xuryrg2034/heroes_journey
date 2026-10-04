/**
 * Playtest telemetry of the exit door (02.10.2026): what an attempt records about the goals, the exit, the chest and
 * the loot, read through real engine commands on spread seeds. The journal lives in a stubbed localStorage; telemetry
 * only observes, so a twin engine without it must end in the identical state, RNG and ID allocator.
 */
import { ForestEngine } from './game/forestEngine';
import { authoredLesson } from './game/lessonBuilder';
import { FOREST_NODE_BATTLES, type NodeBattle } from './game/run/forestBattles';
import type { RunBattleSetup } from './game/run/runBattle';
import { CHEST_RESOURCES } from './game/exitRules';
import { forestFixtureLevel } from './game/testing/fixtures';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;

// Browser stubs: telemetry reads localStorage lazily and listens for `pagehide`.
const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } },
  window: { addEventListener: () => {} },
});
const telemetry = await import('./telemetry');
type AttemptRecord = import('./telemetry').AttemptRecord;
const journal = (): AttemptRecord[] => JSON.parse(storage.get(telemetry.TELEMETRY_KEY) ?? '{"attempts":[]}').attempts;

// The exit door spec's field: door on A1 (0), the marked target on A2 (5), the cat on B5 chains up column A. An armed
// goblin on B1 beside the door strikes a cat that stays on A2.
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
registry['spec-telemetry-exit'] = authoredLesson({ id: 'spec-telemetry-exit', name: 'Выход за целью', description: '', hint: '',
  rows: ['DgGGG', 'TGGGG', 'RGGGG', 'RGGGG', 'RHGGG'], legend: { D: { door: true }, T: { color: 0, target: true } }, seed: 7101 });
// The same field with a 1 HP elite on A4 (15, HP 2 as an elite): killed by the column chain, it may drop frost (open in this node).
registry['spec-telemetry-elite'] = authoredLesson({ id: 'spec-telemetry-elite', name: 'Выход за элитой', description: '', hint: '',
  rows: ['DgGGG', 'TGGGG', 'RGGGG', 'EGGGG', 'RHGGG'], legend: { D: { door: true }, T: { color: 0, target: true }, E: { color: 0, hp: 1, elite: true } }, seed: 7102 });
const COLUMN = [20, 15, 10, 5], DOOR = 0;

function start(seed: number, observed: boolean, id = 'spec-telemetry-exit') {
  const setup: RunBattleSetup = { nodeId: 'spec-telemetry', label: 'spec', seed, template: { kind: 'battle', id }, row: 6,
    player: { hp: 5, maxHp: 5, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: id === 'spec-telemetry-elite' ? ['frost'] : [], allowedAbilities: [] };
  const g = new ForestEngine(); g.animationScale = 0;
  const controller = observed ? telemetry.installTelemetry(g) : null;
  assert(g.startRunBattle(setup), 'the spec battle starts');
  return { g, controller };
}
async function chain(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), `begin ${path[0]}`);
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
  assert(await g.releaseChain(), 'released');
}
const chestAt = (g: ForestEngine) => g.state.board.findIndex(cell => !!cell?.chest);
const snapshot = (g: ForestEngine) => JSON.stringify(g.captureAnalysisSnapshot());

/** The chain that meets the last goal enters the door: goal turn = exit turn, no delay, no chest. */
async function leaveAtOnce() {
  telemetry.clearTelemetry();
  const { g } = start(spread(1), true);
  await chain(g, [...COLUMN, DOOR]);
  assert(g.state.phase === 'WIN', 'the same chain leaves through the door');
  const [record] = journal();
  assert(record && record.outcome === 'win' && record.goalTurn === 1 && record.exitTurn === 1 && record.exitDelay === 0, `goal and exit on turn 1, no delay: ${JSON.stringify(record)}`);
  assert(record.hpAtGoal === 5 && record.damageAfterGoal === 0 && record.chestDropped === false && record.chestOpened === false, 'full HP at the goals, no chest falls');
  console.log('PASS leaving with the chain that meets the goals: goal turn = exit turn, delay 0, no chest');
}

/**
 * Meet the goals, stay (open the chest when a chain reaches it, otherwise rest), then leave: the record keeps the goal
 * turn, the exit turn, the delay, the HP at the goals, the damage after them, the chest and the materials it gave.
 */
async function stayThenLeave() {
  let delayed = 0, opened = 0;
  for (let k = 1; k <= 8; k++) {
    telemetry.clearTelemetry();
    const seed = spread(k), { g } = start(seed, true), twin = start(seed, false).g;
    const both = async (action: (engine: ForestEngine) => Promise<unknown>) => { await action(g); await action(twin); };
    await both(engine => chain(engine, COLUMN));
    assert(g.state.customLevel!.goalCompletedTurn === 1 && g.state.phase === 'PLAYER_INPUT', `seed ${k}: goals met on turn 1, the battle goes on`);
    // Odd seeds leave the chest on the field.
    const at = k % 2 ? -1 : chestAt(g), path = at >= 0 ? g.availableMoves(8).find(candidate => candidate.includes(at) && !candidate.includes(DOOR)) : undefined;
    if (path) await both(engine => chain(engine, path)); else await both(engine => engine.waitTurn());
    // Leave by any chain that ends in the door; rest (up to three times) while none reaches it.
    const exitPath = () => g.state.phase === 'PLAYER_INPUT' ? g.availableMoves(16).find(candidate => candidate.at(-1) === DOOR) : undefined;
    for (let n = 0; n < 3 && g.state.phase === 'PLAYER_INPUT' && !exitPath(); n++) await both(engine => engine.waitTurn());
    assert(snapshot(g) === snapshot(twin), `seed ${k}: telemetry changes neither the state, the RNG nor the ID allocator`);
    const leave = exitPath();
    if (!leave) continue;
    // The leaving chain may pass the chest too: the forecast says so.
    const opensChest = !!path || g.preview(leave).hits.some(hit => hit.chest);
    await both(engine => chain(engine, leave));
    assert((g.state.phase as string) === 'WIN' && snapshot(g) === snapshot(twin), `seed ${k}: the cat leaves later, the twin likewise`);
    const [record] = journal();
    assert(record.outcome === 'win' && record.goalTurn === 1 && record.exitTurn === g.state.turn && record.exitDelay === g.state.turn - 1,
      `seed ${k}: goal turn 1, exit turn ${g.state.turn}: ${JSON.stringify(record)}`);
    assert(record.hpAtGoal === 5 && record.damageAfterGoal === 5 - g.state.player.hp && record.hpEnd === g.state.player.hp,
      `seed ${k}: every HP lost after the goals is counted (${record.damageAfterGoal}, HP ${g.state.player.hp})`);
    assert(record.chestDropped === true && record.chestOpened === opensChest && JSON.stringify(record.lootItems) === '{}', `seed ${k}: the chest fell; opened only by the chain through it`);
    const resources = Object.values(record.materials ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
    assert(resources === (opensChest ? CHEST_RESOURCES : 0), `seed ${k}: the battle's materials at the end (${JSON.stringify(record.materials)})`);
    delayed++; if (opensChest) opened++;
  }
  assert(delayed >= 4 && opened >= 1 && opened < delayed, `stayed and left on most seeds (${delayed}/8), opened the chest on some (${opened})`);
  console.log(`PASS staying after the goals: exit turn, delay, HP at the goals, damage after them, chest and materials (${delayed} seeds, chest opened on ${opened})`);
}

/** A restart reports the attempt it ends, not the fresh battle the engine already holds. */
async function restartKeepsTheChest() {
  for (let k = 1; k <= 10; k++) {
    telemetry.clearTelemetry();
    const { g } = start(spread(k), true);
    await chain(g, COLUMN);
    const at = chestAt(g), path = at >= 0 ? g.availableMoves(8).find(candidate => candidate.includes(at) && !candidate.includes(DOOR)) : undefined;
    if (!path || g.state.phase !== 'PLAYER_INPUT') continue;
    await chain(g, path);
    if (g.state.phase !== 'PLAYER_INPUT') continue;
    g.restartLevel();
    const [record] = journal();
    assert(record.outcome === 'restart' && record.goalTurn === 1 && record.exitTurn === null && record.exitDelay === null && record.chestOpened === true, `seed ${k}: ${JSON.stringify(record)}`);
    assert(Object.values(record.materials ?? {}).reduce((sum, count) => sum + (count ?? 0), 0) === CHEST_RESOURCES, `seed ${k}: the chest's resources stay with the restarted attempt`);
    console.log('PASS a restart after opening the chest records the goals, the chest and its resources, no exit');
    return;
  }
  throw new Error('no seed let a chain open the chest');
}

/** A consumable dropped by the elite and picked up by a chain is counted as loot; resources are not. */
async function eliteLoot() {
  for (let k = 1; k <= 16; k++) {
    telemetry.clearTelemetry();
    const { g } = start(spread(k), true, 'spec-telemetry-elite');
    await chain(g, COLUMN);
    const at = g.state.board.findIndex(cell => cell?.loot === 'frost');
    const path = at >= 0 && g.state.phase === 'PLAYER_INPUT' ? g.availableMoves(8).find(candidate => candidate.includes(at) && !candidate.includes(DOOR)) : undefined;
    if (!path) continue;
    await chain(g, path);
    if (g.state.phase !== 'PLAYER_INPUT') continue;
    assert(g.state.inventory.frost === 1, `seed ${k}: the chain picked up the frost`);
    g.restartLevel();
    const [record] = journal();
    assert(record.lootItems?.frost === 1 && Object.keys(record.lootItems).length === 1, `seed ${k}: the picked-up frost is loot: ${JSON.stringify(record.lootItems)}`);
    console.log('PASS a consumable picked up from the elite counts as loot');
    return;
  }
  throw new Error('no seed dropped frost on a reachable cell');
}

/** Journals written before the exit fields still load, aggregate and render. */
function oldJournal() {
  const old = { key: 'run:spec-telemetry', mode: 'run', id: 'spec-telemetry', seed: 1, startedAt: 0, durationMs: 1000, outcome: 'win', left: false, visit: 1, attemptInVisit: 1,
    turns: 2, hpEnd: 5, maxHp: 5, damageTaken: 0, chains: 2, chainAvg: 3, chainMax: 4, cancelledChains: 0, abilities: {}, items: {}, firstMoveMs: 500 };
  storage.set(telemetry.TELEMETRY_KEY, JSON.stringify({ version: 1, enabled: true, attempts: [old] }));
  let [row] = telemetry.aggregate(journal());
  assert(row.wins === 1 && row.medianGoalTurn === null && row.medianExitTurn === null && row.medianExitDelay === null && row.chestOpenRate === null, `an old record has no exit data: ${JSON.stringify(row)}`);
  assert(telemetry.playtestHtml().includes('Карта леса') || telemetry.playtestHtml().includes('spec-telemetry'), 'the playtest screen renders an old journal');
  const fresh: AttemptRecord = { ...old, mode: 'run', outcome: 'win', visit: 2, goalTurn: 2, exitTurn: 4, exitDelay: 2, hpAtGoal: 5, damageAfterGoal: 1, chestDropped: true, chestOpened: false };
  [row] = telemetry.aggregate([old as AttemptRecord, fresh]);
  assert(row.medianGoalTurn === 2 && row.medianExitTurn === 4 && row.medianExitDelay === 2 && row.chestOpenRate === 0, `old and new records mix: ${JSON.stringify(row)}`);
  console.log('PASS an old journal without the exit fields loads, aggregates and renders');
}

/**
 * A lost map-node battle ends the run (decision of 04.10.2026): the record says so and closes the visit, so leaving
 * afterwards is not an abandonment. An editor level keeps the old meaning: leaving after its defeat is an abandonment.
 */
async function runDefeatEndsTheRun() {
  telemetry.clearTelemetry();
  const { g, controller } = start(spread(3), true);
  await chain(g, [20, 15]);
  g.damagePlayer(g.state.player.hp);
  assert(g.state.phase === 'LOSE', 'the cat falls');
  controller!.leave();
  let [record] = journal();
  assert(journal().length === 1 && record.outcome === 'lose' && record.runEnded === true && record.left === false, `the run defeat ends the run, leaving is not an abandonment: ${JSON.stringify(record)}`);
  let [row] = telemetry.aggregate(journal());
  assert(row.loses === 1 && row.abandonRate === 0 && row.attemptsToWin === null, `aggregates count a lost run, not an abandoned node: ${JSON.stringify(row)}`);

  telemetry.clearTelemetry();
  const editor = new ForestEngine(); editor.animationScale = 0;
  const watch = telemetry.installTelemetry(editor);
  assert(editor.startCustomLevel(forestFixtureLevel(spread(4))), 'the editor level starts');
  editor.damagePlayer(editor.state.player.hp);
  watch.leave();
  [record] = journal();
  assert(record.outcome === 'lose' && record.runEnded === undefined && record.left === true, `an editor defeat then leaving is an abandonment: ${JSON.stringify(record)}`);
  [row] = telemetry.aggregate(journal());
  assert(row.abandonRate === 1, 'the editor visit counts as abandoned');
  console.log('PASS a run defeat marks the end of the run and closes the visit; an editor defeat keeps the abandonment rule');
}

/** A choice at a map event is recorded with its node, option and outcome; exported and aggregated; off when disabled. */
function eventChoices() {
  telemetry.clearTelemetry();
  telemetry.recordRunEvent({ nodeId: 'trail-cache', option: 'break', outcome: 1, text: 'ловушка, −2 HP (не ниже 1)', seed: 7 });
  telemetry.recordRunEvent({ nodeId: 'trail-cache', option: 'break', outcome: 0, text: 'добыча, 2 ресурса крафта: Роса, Смола', seed: 8 });
  telemetry.recordRunEvent({ nodeId: 'trail-brook', option: 'drink', outcome: 0, text: '+2 HP (не выше максимума)', seed: 9 });
  const payload = telemetry.exportPayload();
  assert(payload.runEvents.length === 3 && payload.runEvents[0].nodeId === 'trail-cache' && payload.runEvents[0].option === 'break' && payload.runEvents[0].outcome === 1, 'event choices are exported');
  const cache = payload.eventAggregates.find(row => row.nodeId === 'trail-cache')!;
  assert(cache.count === 2 && cache.label === 'Гоблинский тайник' && Object.keys(cache.outcomes).length === 2, `aggregated by node and option: ${JSON.stringify(cache)}`);
  assert(payload.aggregates.length === 0 && telemetry.playtestHtml().includes('Гоблинский тайник'), 'battle aggregates are untouched; the playtest screen lists the events');
  telemetry.setTelemetryEnabled(false);
  telemetry.recordRunEvent({ nodeId: 'trail-brook', option: 'flask', outcome: 0, text: '+1 «Холод»', seed: 10 });
  assert(telemetry.exportPayload().runEvents.length === 3, 'a disabled journal records no event');
  telemetry.setTelemetryEnabled(true);
  telemetry.clearTelemetry();
  assert(telemetry.exportPayload().runEvents.length === 0, 'clearing removes event choices too');
  console.log('PASS event choices are recorded, exported and aggregated by node and option');
}

/** A completed rest is recorded with its choice, HP healed and crafted items; exported, summed, shown; off when disabled. */
function restChoices() {
  telemetry.clearTelemetry();
  telemetry.recordRunRest({ nodeId: 'trail-rest', choice: 'heal', healed: 2, crafted: [], seed: 7 });
  telemetry.recordRunRest({ nodeId: 'camp-rest', choice: 'craft', healed: 0, crafted: ['frost', 'frost', 'bomb'], seed: 7 });
  const payload = telemetry.exportPayload();
  assert(payload.runRests.length === 2 && payload.runRests[1].choice === 'craft' && payload.runRests[1].crafted.join() === 'frost,frost,bomb', 'rests are exported in order');
  assert(JSON.stringify(payload.restAggregate) === JSON.stringify({ rests: 2, heals: 1, crafts: 1, healed: 2, crafted: { frost: 2, bomb: 1 } }), `rests summed: ${JSON.stringify(payload.restAggregate)}`);
  assert(telemetry.playtestHtml().includes('id="playtest-rests"') && telemetry.playtestHtml().includes('холод ×2'), 'the playtest screen sums the rests');
  telemetry.setTelemetryEnabled(false);
  telemetry.recordRunRest({ nodeId: 'den-rest', choice: 'heal', healed: 1, crafted: [], seed: 8 });
  assert(telemetry.exportPayload().runRests.length === 2, 'a disabled journal records no rest');
  telemetry.setTelemetryEnabled(true);
  // A journal written before 04.10.2026 has no rests: it loads with an empty list.
  storage.set(telemetry.TELEMETRY_KEY, JSON.stringify({ version: 1, enabled: true, attempts: [], runEvents: [] }));
  assert(telemetry.exportPayload().runRests.length === 0 && !telemetry.playtestHtml().includes('playtest-rests'), 'an old journal without rests loads');
  telemetry.recordRunRest({ nodeId: 'trail-rest', choice: 'heal', healed: 2, crafted: [], seed: 9 });
  telemetry.clearTelemetry();
  assert(telemetry.exportPayload().runRests.length === 0, 'clearing removes rests too');
  console.log('PASS rest choices are recorded, exported and summed; old journals load');
}

eventChoices();
restChoices();
await leaveAtOnce();
await runDefeatEndsTheRun();
await stayThenLeave();
await restartKeepsTheChest();
await eliteLoot();
oldJournal();
console.log('Telemetry checks passed.');
