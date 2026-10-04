import { ForestEngine } from './forestEngine';
import { FOREST_MAP, forestNode, isTrunkNode, validateForestMap } from './run/forestMap';
import { availableNodes, battleSetup, chooseFindItem, chooseTalisman, createForestRun, enterNode, forestRunView, parseForestRun, resolveBattle, serializeForestRun,
  restHeal, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { clearsTrunk, createPlayerProfileStore, PLAYER_PROFILE_KEY } from './run/playerProfile';
import type { RunStorage } from './run/forestRunStorage';

// Trunk only once (decision of 04.10.2026, docs/roguelike-runs.md, section 2): the player profile, a separate storage
// key outside the run, remembers that the trunk was cleared; later runs start at the trail fork. Runs are played
// through the pure run model and the real engine; storage is a stub, a throwing stub, or absent.

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return (step as { run: ForestRunState }).run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const engine = () => { const e = new ForestEngine(); e.animationScale = 0; return e; };
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
/** Enter a node like the map screen does: the run step, then the profile mark on the first entry past the trunk. */
function enter(run: ForestRunState, id: string, profile: ReturnType<typeof createPlayerProfileStore>): ForestRunState {
  const step = enterNode(run, id);
  const next = ok(step, `enter ${id}`);
  if (step.ok && clearsTrunk(step.events)) profile.markTrunkCleared();
  return next;
}
/** Win the open battle with the real engine (debug win; this suite checks the run start, not a bot's victory). */
function win(run: ForestRunState): ForestRunState {
  const setup = battleSetup(run); assert(setup, `setup for ${run.pending?.nodeId}`);
  const e = engine(); assert(e.startRunBattle(setup!), `${setup!.nodeId} starts`);
  e.winLevel(); return ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${setup!.nodeId}`);
}

/** The first run plays the trunk; the mark is set on entering the first trail node (row 5), not earlier. */
function firstRunMarksTheTrunk() {
  const storage = memoryStorage(), profile = createPlayerProfileStore(storage);
  assert(!profile.load().trunkCleared, 'a new player has not cleared the trunk');
  let run = createForestRun(spread(1), { skipTrunk: profile.load().trunkCleared });
  assert(json(availableNodes(run).map(node => node.id)) === json(['trunk-1']), 'the first run starts at the trunk');
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) {
    run = win(enter(run, id, profile));
    assert(!profile.load().trunkCleared, `${id}: the trunk is not cleared yet`);
  }
  // A defeat on the trunk would leave the mark unset; entering row 5 sets it, whatever happens in that battle.
  run = enter(run, 'goblin-archer', profile);
  assert(profile.load().trunkCleared && storage.data.has(PLAYER_PROFILE_KEY), 'entering the first trail node marks the trunk as cleared in the profile');
  assert(json(JSON.parse(storage.data.get(PLAYER_PROFILE_KEY)!)) === json({ version: 1, trunkCleared: true, ladder: 0, giftFull: false, meta: { points: 0, level: 0 } }) && !('trunkCleared' in run),
    'the profile is its own key with only the mark; the run save does not carry it');
  console.log('PASS the first run plays the trunk; entering row 5 marks it cleared in the profile');
}

/**
 * With the mark a new run starts at the trail fork with the same resources and tools as after the trunk: the trunk
 * gives no tools and no items (the map validator holds it), so the start values are the trunk's result. The run is
 * played on to a boss and survives saves; its map shows the trunk as walked earlier.
 */
function markedRunSkipsTheTrunk() {
  const storage = memoryStorage(), profile = createPlayerProfileStore(storage);
  profile.markTrunkCleared();
  assert(createPlayerProfileStore(storage).load().trunkCleared, 'the mark survives a new page load');
  assert(!validateForestMap().length, `the map holds the trunk rule: ${validateForestMap().join(' ')}`);
  assert(FOREST_MAP.filter(isTrunkNode).every(node => !node.grants && !node.rewardGrants), 'the trunk opens no tools and gives no items');
  for (const k of [2, 3, 4]) {
    const seed = spread(k), fresh = createForestRun(seed), skipped = createForestRun(seed, { skipTrunk: profile.load().trunkCleared });
    assert(skipped.skippedTrunk === true && json(skipped.resources) === json(fresh.resources) && json(skipped.tools) === json(fresh.tools),
      `seed ${k}: the skipped run has the resources and tools of a run that just left the trunk`);
    assert(json(availableNodes(skipped).map(node => node.id)) === json(forestNode('trunk-4')!.next), `seed ${k}: the first choice is the trail fork`);
    assert(!enterNode(skipped, 'trunk-1').ok, `seed ${k}: the trunk cannot be entered`);
    const view = forestRunView(skipped);
    assert(view.nodes.filter(entry => isTrunkNode(entry.node)).every(entry => entry.status === 'skipped') && view.battlesWon === 0,
      `seed ${k}: the map shows the trunk as walked earlier; no battle is counted as won`);
    assert(json(parseForestRun(serializeForestRun(skipped))) === json(skipped), `seed ${k}: the skipped run survives a save`);
    // Play the run on: the beast trail (frost), the find (jump), the banners, the Jailer (spin), the den to the Troll.
    let run = skipped;
    for (const id of ['beast-wolf', 'beast-boar', 'trail-find', 'trail-banners', 'jailer', 'den-battle', 'den-rest', 'den-elite', 'den-breakthrough', 'den-troll']) {
      run = enter(run, id, profile);
      if (run.pending?.kind === 'battle') {
        const setup = battleSetup(run)!;
        assert(setup.player.hp === run.resources.player.hp && json(setup.allowedItems) === json(run.tools.items), `${id}: the battle gets the run's resources and tools`);
        run = win(run);
      }
      if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `find at ${id}`);
      if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), `refuse the talismans at ${id}`);
      if (run.pending?.kind === 'rest') run = ok(restHeal(run), `heal at ${id}`);
      assert(json(parseForestRun(serializeForestRun(run))) === json(run), `seed ${k}: ${id} survives a save`);
      if (id === 'beast-wolf') assert(run.tools.items.includes('frost') && run.resources.inventory.frost === 1, 'the first trail node still opens frost');
    }
    assert(run.result?.outcome === 'victory' && forestRunView(run).battlesWon === 8, `seed ${k}: a skipped run reaches a boss; ${forestRunView(run).battlesWon} battles won`);
  }
  // Tampering: a skipped run that visited the trunk, and an ordinary run that starts past it, are both rejected.
  const skipped = ok(enterNode(createForestRun(5, { skipTrunk: true }), 'beast-wolf'), 'enter');
  const forged = JSON.parse(serializeForestRun(skipped)); delete forged.skippedTrunk;
  assert(parseForestRun(JSON.stringify(forged)) === null, 'a run without the mark cannot start past the trunk');
  const trunk = JSON.parse(serializeForestRun(ok(enterNode(createForestRun(5), 'trunk-1'), 'enter trunk'))); trunk.skippedTrunk = true;
  assert(parseForestRun(JSON.stringify(trunk)) === null, 'a skipped run cannot enter the trunk');
  console.log('PASS with the mark a new run starts at the trail fork with the post-trunk resources, plays to a boss and saves');
}

/** Reset (the playtest menu) brings the trunk back; storage failures read as a first-time player. */
function resetAndStorage() {
  const storage = memoryStorage(), profile = createPlayerProfileStore(storage);
  profile.markTrunkCleared();
  assert(profile.resetTrunk() && !profile.load().trunkCleared, 'reset clears the mark');
  assert(json(availableNodes(createForestRun(9, { skipTrunk: profile.load().trunkCleared })).map(node => node.id)) === json(['trunk-1']), 'after the reset a new run starts at the trunk');
  storage.data.set(PLAYER_PROFILE_KEY, '{garbage'); assert(!profile.load().trunkCleared, 'a broken profile reads as a first-time player');
  storage.data.set(PLAYER_PROFILE_KEY, JSON.stringify({ version: 99, trunkCleared: true })); assert(!profile.load().trunkCleared, 'an unknown profile version is ignored');
  const none = createPlayerProfileStore(null);
  assert(!none.markTrunkCleared() && !none.load().trunkCleared, 'without storage the mark is not kept: every run plays the trunk');
  const broken = createPlayerProfileStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } });
  assert(!broken.markTrunkCleared() && !broken.load().trunkCleared && !broken.resetTrunk(), 'a throwing storage never breaks the game');
  // Without storage a whole first run still works: the trunk is played, nothing throws.
  let run = createForestRun(spread(6), { skipTrunk: none.load().trunkCleared });
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) run = win(enter(run, id, none));
  run = enter(run, 'beast-wolf', broken);
  assert(run.pending?.nodeId === 'beast-wolf' && !none.load().trunkCleared, 'the first run goes on past the trunk without storage');
  console.log('PASS reset brings the trunk back; no storage or a throwing one reads as a first-time player');
}

firstRunMarksTheTrunk();
markedRunSkipsTheTrunk();
resetAndStorage();
console.log('Player profile checks passed.');
