import { ForestEngine } from './forestEngine';
import { authoredRefillPalette, battle, FOREST_MAP, FOREST_MAP_START, FOREST_REST_HEAL, forestMapPaths, forestNode, forestRowPalette, isBattleNode, nodeRefillPalette,
  validateForestMap, type ForestMapNode } from './run/forestMap';
import { availableNodes, battleSetup, chooseFindItem, chooseTalisman, createForestRun, enterNode, forestNodeSeed, forestRunView, nodeRunTemplate, parseForestRun,
  resolveBattle, restHeal, serializeForestRun, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { buildNodeBattleRegistry, FOREST_NODE_BATTLES, forestBattle, validateForestBattles, validateNodeBattle, type NodeBattle } from './run/forestBattles';
import { createForestRunStore, FOREST_RUN_STORAGE_KEY, type RunStorage } from './run/forestRunStorage';
import type { ItemKind } from './forestTypes';
import { ELITE_HP_FACTOR } from './elite';
import { isOath, OATH_ENERGY } from './talismans';
import type { TalismanOption } from './run/talismanOffers';

// Forest-map run (docs/biomes/forest-map.md). Battles are loaded by the real engine from the run's setup,
// real chains and items are played, and the finished battle is fed back to the pure run model.
// `winLevel()` / `damagePlayer()` are the engine's debug commands used to finish or lose a battle quickly:
// this suite checks the run, not whether a bot can win each template.

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return (step as { run: ForestRunState }).run; }
const engine = () => { const e = new ForestEngine(); e.animationScale = 0; return e; };
const json = (value: unknown) => JSON.stringify(value);

/** One real ordinary chain (the first listed move), or a rest when no chain exists. */
async function realMove(e: ForestEngine, pick: (move: number[]) => boolean = () => true) {
  if (e.state.phase !== 'PLAYER_INPUT') return;
  const moves = e.availableMoves(6), move = moves.find(pick) ?? moves[0];
  if (!move) { await e.waitTurn(); return; }
  const before = json(e.captureAnalysisSnapshot());
  e.preview(move);
  assert(json(e.captureAnalysisSnapshot()) === before, 'preview in a map battle changes neither state nor RNG');
  assert(e.beginChain(move[0]), 'real chain starts');
  for (const index of move.slice(1)) assert(e.extendChain(index), 'real chain extends');
  assert(await e.releaseChain(), 'real chain resolves');
}

/** Start the pending battle and check the carried resources arrived in the engine. */
function launch(e: ForestEngine, run: ForestRunState) {
  const setup = battleSetup(run); assert(setup, `battle setup for ${run.pending?.nodeId}`);
  assert(e.startRunBattle(setup!), `engine starts ${setup!.nodeId}`);
  const { player, inventory } = run.resources;
  assert(e.state.runNode?.nodeId === setup!.nodeId && e.state.phase === 'PLAYER_INPUT', `${setup!.nodeId} is a live map battle`);
  // Oaths add their energy at the start of every battle (docs/talismans.md).
  const energy = Math.min(7, player.energy + OATH_ENERGY * run.talismans.filter(isOath).length);
  assert(e.state.player.hp === player.hp && e.state.player.maxHp === player.maxHp && e.state.player.energy === energy,
    `${setup!.nodeId}: HP and energy carried into the battle`);
  assert(json(e.state.inventory) === json(inventory), `${setup!.nodeId}: items carried into the battle`);
  assert(json(e.state.player.damageEffects ?? null) === json(player.damageEffects ?? null), `${setup!.nodeId}: effect stacks carried`);
  return setup!;
}

/** Feed the finished battle back and check the run took the engine's final resources. */
function settle(e: ForestEngine, run: ForestRunState): ForestRunState {
  const outcome = e.runBattleOutcome(); assert(outcome, 'finished map battle reports an outcome');
  const next = ok(resolveBattle(run, outcome!), `resolve ${outcome!.nodeId}`);
  if (outcome!.won) {
    // A hard-battle victory adds its heart (+1 HP up to the maximum) on top of the carried HP.
    const heart = forestNode(outcome!.nodeId)!.type === 'hard' ? Math.min(1, e.state.player.maxHp - e.state.player.hp) : 0;
    assert(next.resources.player.hp === e.state.player.hp + heart && next.resources.player.energy === e.state.player.energy,
      `${outcome!.nodeId}: HP and energy carried out of the battle`);
    assert(json(next.resources.inventory) === json(e.state.inventory), `${outcome!.nodeId}: items carried out of the battle`);
    assert(json(next.resources.player.damageEffects ?? null) === json(e.state.player.damageEffects ?? null), `${outcome!.nodeId}: effects carried out`);
  }
  return next;
}

/**
 * A defeat ends the run (decision of 04.10.2026): the lost node is the result, the resources stay the living entry
 * snapshot, nothing can be entered, resolved or replayed, and the ended run survives a save. `before` is the run with
 * the battle open; `lost` is the run after resolveBattle with the engine's real defeat outcome.
 */
function assertRunLost(lost: ForestRunState, before: ForestRunState, battleScore: number) {
  const id = before.pending!.nodeId!;
  assert(lost.result?.outcome === 'defeat' && lost.result.nodeId === id && lost.pending === null, `${id}: the defeat ends the run at this node`);
  assert(json(lost.resources) === json(before.resources) && lost.currentNodeId === before.currentNodeId && json(lost.visited) === json(before.visited),
    `${id}: the ended run keeps the entry resources and the route`);
  assert(lost.score === before.score + battleScore, `${id}: the lost battle's points are counted`);
  assert(!availableNodes(lost).length && !battleSetup(lost), `${id}: no transition and no battle to replay`);
  const next = forestNode(id)!.next[0] ?? id;
  assert(!enterNode(lost, next).ok && !enterNode(lost, id).ok, `${id}: nothing can be entered after the defeat`);
  assert(!resolveBattle(lost, { nodeId: id, won: true, player: { ...before.resources.player }, inventory: { ...before.resources.inventory } }).ok, `${id}: the lost battle cannot be won afterwards`);
  assert(json(parseForestRun(serializeForestRun(lost))) === json(lost), `${id}: the ended run survives a save and reload unchanged`);
  assert(forestRunView(lost).nodes.find(entry => entry.node.id === id)?.status === 'lost' && !forestRunView(lost).available.length, `${id}: the map shows where the run ended`);
}

function mapStructure() {
  assert(!validateForestMap().length, `map is valid: ${validateForestMap().join(' ')}`);
  const paths = forestMapPaths();
  assert(paths.length > 1 && paths.every(path => path[0] === FOREST_MAP_START), 'all routes start at the trunk');
  for (const path of paths) {
    const nodes = path.map(id => forestNode(id)!), battles = nodes.filter(isBattleNode).length;
    // Changed 04.10.2026: a row-8 event may replace «Три знамени», so a route has 11–13 battles (was 12–13), and
    // the find followed by an event gives two nodes without a battle in a row (accepted with the test events).
    assert(battles >= 11 && battles <= 15, `${path.join('>')}: 11–15 battles, got ${battles}`);
    const row8 = forestNode(path[path.indexOf('jailer') - 1])!, row7 = forestNode(path[path.indexOf('jailer') - 2])!;
    assert(row8.row === 8 && row7.next.some(id => forestNode(id)!.type === 'event') && row7.next.some(id => isBattleNode(forestNode(id)!)),
      `${path.join('>')}: before row 8 the route chooses between a battle and an event`);
    assert(nodes.slice(0, 4).every(node => node.lane === 'trunk' && node.type === 'battle'), 'every route opens with the four trunk battles');
    assert(nodes.filter(node => node.id === 'jailer').length === 1 && forestNode('jailer')!.type === 'checkpoint', 'every route passes the Jailer checkpoint');
    const last = nodes[nodes.length - 1], half = nodes.slice(nodes.findIndex(node => node.id === 'jailer') + 1);
    assert(last.type === 'boss' && half.every(node => node.lane === half[0].lane), 'second half stays in one branch and ends at its boss');
    assert(half[0].lane === 'den' ? last.id === 'den-troll' : last.id === 'camp-chief', 'den leads to the Troll, camp to the Chief');
  }
  assert(json(forestNode('trunk-4')!.next) === json(['beast-wolf', 'goblin-archer']), 'the trunk forks into the beast trail and the goblin barricade');
  assert(paths.some(path => path.includes('beast-wolf') && path.includes('goblin-shaman')), 'the shared rest lets a route cross between trails');
  assert(forestNode('trail-rest')!.type === 'rest' && forestNode('trail-find')!.type === 'find', 'shared rest and find nodes exist');
  const troll = forestNode('den-troll')!, chief = forestNode('camp-chief')!;
  assert(troll.content.kind === 'battle' && troll.content.battleId === 'troll-lair' && !!nodeRunTemplate(troll), 'the Troll is the registry battle troll-lair');
  assert(FOREST_MAP.every(node => node.content.kind !== 'in-development'), 'no map node is an in-development stub any more');
  assert(chief.content.kind === 'battle' && chief.content.battleId === 'chief-breakfast' && !!nodeRunTemplate(chief), 'the Chief is the registry battle chief-breakfast');
  const jailer = forestNode('jailer')!.content;
  assert(jailer.kind === 'battle' && jailer.battleId === 'jailer-gate' && FOREST_MAP.some(node => node.type === 'breakthrough'), 'Jailer checkpoint and breakthrough nodes exist');
  // Every map battle is a registry battle: the former lessons and the forest trial are registry battles now.
  const played = new Map([['trunk-1', 'trunk-wake'], ['trunk-2', 'trunk-axe'], ['trunk-3', 'trunk-last-step'], ['trunk-4', 'trunk-arrows'],
    ['trail-banners', 'three-banners'], ['jailer', 'jailer-gate'], ['camp-chief', 'chief-breakfast']]);
  for (const [id, battleId] of played) { const content = forestNode(id)!.content; assert(content.kind === 'battle' && content.battleId === battleId, `${id} plays ${battleId}`); }
  assert(FOREST_MAP.filter(isBattleNode).every(node => node.content.kind === 'battle' && !!forestBattle(node.content.battleId)), 'every battle node plays a registry battle');
  assert(FOREST_MAP.some(node => node.placeholder), 'temporary template nodes are marked');
  for (const path of paths) path.forEach((id, n) => {
    if (forestNode(id)!.type === 'hard') assert(forestNode(path[n - 1])!.type === 'rest', `${path.join('>')}: a rest right before the hard battle ${id}`);
  });
  for (const node of FOREST_MAP) {
    const battle = node.content.kind === 'battle' ? forestBattle(node.content.battleId) : undefined; if (!battle) continue;
    const row = forestRowPalette(node.row);
    for (const enemy of battle.definition.enemies) if (enemy.color !== null)
      assert(row.includes(enemy.color), `${node.id}: opening color ${enemy.color} of ${battle.id} fits the row ${node.row} palette`);
  }
}

/** Real run along the goblin barricade to the Chief, with losses, rest, tools and a boss victory. */
async function campRoute(seed: number, trace?: string[]) {
  const e = engine(), log = (value: unknown) => trace?.push(json(value));
  // Every state the model really produces must survive a save and reload unchanged.
  const saved = (state: ForestRunState) => assert(json(parseForestRun(serializeForestRun(state))) === json(state), `${state.pending?.nodeId ?? state.currentNodeId}: real state round-trips`);
  let run = createForestRun(seed);
  assert(json(availableNodes(run).map(node => node.id)) === json(['trunk-1']), 'a new run offers only the first trunk battle');
  const route = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4', 'goblin-archer', 'trail-rest', 'goblin-shaman', 'trail-banners', 'jailer',
    'camp-battle', 'camp-rest', 'camp-elite', 'camp-breakthrough', 'camp-chief'];
  for (const id of route) {
    assert(availableNodes(run).some(node => node.id === id), `${id} is an available transition`);
    const hpBefore = run.resources.player.hp;
    run = ok(enterNode(run, id), `enter ${id}`); log(run); saved(run);
    const node = forestNode(id)!;
    if (node.type === 'rest') {
      assert(run.pending?.kind === 'rest' && run.resources.player.hp === hpBefore, `${id}: the rest waits for its choice`);
      run = ok(restHeal(run), `heal at ${id}`); log(run); saved(run);
      assert(run.resources.player.hp === Math.min(run.resources.player.maxHp, hpBefore + FOREST_REST_HEAL), `${id}: rest heals up to the maximum`);
      assert(run.currentNodeId === id && !run.pending, `${id}: healing completes the rest`);
      continue;
    }
    const setup = launch(e, run); log(e.captureAnalysisSnapshot());
    assert(setup.seed === forestNodeSeed(seed, id) && e.captureAnalysisSnapshot().seed === setup.seed, `${id}: battle seed comes from the run seed and node id`);
    if (id.startsWith('trunk')) {
      assert(!e.state.tutorial!.allowedItems.length && !e.state.tutorial!.allowedAbilities.length, `${id}: trunk battles have no tools`);
      e.state.player.energy = 7; // Only to prove the lock is not an energy shortage.
      assert(!e.setAbility('jump') && e.previewItem('frost', 0).reason === 'Этот расходник ещё не открыт.', `${id}: jump and frost are locked`);
      e.restartLevel(); assert(e.state.player.energy === run.resources.player.energy, 'restart restores the entry energy');
    }
    if (id === 'goblin-archer') {
      assert(run.tools.items.includes('frost') && e.state.inventory.frost === 1 && e.state.tutorial!.allowedItems.includes('frost'), 'the barricade opens frost with one flask');
      assert(!e.state.tutorial!.allowedAbilities.includes('jump'), 'jump is not open yet');
    }
    if (id === 'goblin-shaman') assert(e.state.tutorial!.allowedAbilities.includes('jump'), 'the row before the banners opens jump');
    await realMove(e); log(e.captureAnalysisSnapshot());
    if (id === 'trunk-3') {
      const hp = e.state.player.hp, wound = Math.min(3, hp - 1);
      e.damagePlayer(wound); assert(e.state.player.hp === hp - wound && e.state.phase === 'PLAYER_INPUT', 'the cat is wounded but fighting');
    }
    if (id === 'trunk-4') {
      // A reload in the middle of a node battle starts it again from the entry snapshot (the battle is not saved).
      const reloaded = engine(); launch(reloaded, parseForestRun(serializeForestRun(run))!);
      assert(json(reloaded.captureAnalysisSnapshot().entry) === json(e.captureAnalysisSnapshot().entry), 'a reload relaunches the open battle from the same entry');
      e.damagePlayer(10); assert(e.state.phase === 'LOSE', 'the cat can fall in a node');
      assertRunLost(settle(e, run), run, e.state.score);
      // The model is pure: the route goes on from the run before that defeat (a test shortcut, not a game action).
      e.restartLevel(); await realMove(e);
    }
    if (e.state.phase === 'LOSE') {
      // A real chain killed the cat: the run ends here. The route goes on from the run before the defeat (test shortcut).
      assertRunLost(settle(e, run), run, e.state.score);
      e.restartLevel();
    }
    if (id === 'jailer') assert(!e.state.tutorial!.allowedAbilities.includes('spin'), 'spin is closed during the Jailer battle');
    if (id === 'camp-chief') assert(e.state.board.some(cell => cell?.kind === 'boss' && cell.hp === 20 && !cell.variant) && e.state.runNode?.allowedAbilities.includes('spin'),
      'the Chief node starts the Chief battle with the spin open');
    e.winLevel();
    assert(e.runBattleOutcome()?.won === true && e.runBattleOutcome()?.nodeId === id, `${id}: a won map battle reports its outcome to the run`);
    run = settle(e, run); log(run); saved(run);
    if (id === 'jailer') {
      // The Jailer offers oaths (docs/talismans.md); the spin opens with the victory, before the choice.
      const options = run.pending?.kind === 'talisman' && run.pending.source === 'oath' ? run.pending.options : [];
      assert(options.length === 3 && options.every(option => option !== 'blank' && isOath(option)) && !availableNodes(run).length, 'the Jailer victory offers three oaths before moving on');
      assert(run.tools.abilities.includes('spin'), 'the Jailer victory opens the spin for later battles');
      run = ok(chooseTalisman(run, null), 'refuse the oaths'); log(run); saved(run);
      assert(json(availableNodes(run).map(node => node.id)) === json(['den-battle', 'camp-battle']), 'after the Jailer the player chooses a branch');
    }
    if (id === 'camp-elite') {
      const options = run.pending?.kind === 'talisman' && run.pending.source === 'hard' ? run.pending.options : [];
      assert(options.length === 3 && run.pending?.nodeId === id && !availableNodes(run).length, 'a hard-battle victory offers a talisman before moving on');
      run = ok(chooseTalisman(run, options[0]), 'hard-battle reward'); log(run); saved(run);
      assert(run.talismans.includes(options[0] as never) && run.currentNodeId === id && availableNodes(run)[0]?.id === 'camp-breakthrough', 'the reward completes the elite node');
    }
  }
  assert(run.result?.outcome === 'victory' && run.result.nodeId === 'camp-chief' && !availableNodes(run).length, 'the Chief ends the run in victory');
  assert(forestRunView(run).battlesWon === route.filter(id => isBattleNode(forestNode(id)!)).length, 'view counts won battles');
  return run;
}

/** Beast trail through the find, then the den to the Troll stub. */
async function denRoute() {
  const e = engine();
  let run = createForestRun(83);
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4', 'beast-wolf', 'beast-boar']) {
    run = ok(enterNode(run, id), `enter ${id}`); launch(e, run); e.winLevel(); run = settle(e, run);
  }
  assert(!run.tools.abilities.includes('jump'), 'jump is closed before the find');
  run = ok(enterNode(run, 'trail-find'), 'enter find');
  const options = (run.pending as { options: ItemKind[] }).options;
  assert(run.tools.abilities.includes('jump'), 'the find opens jump');
  assert(run.pending?.kind === 'find' && options.length === 3 && new Set(options).size === 3, 'the find offers three items');
  assert(forestRunView(run).nodes.find(entry => entry.node.id === 'trail-find')?.status === 'in-progress' && !forestRunView(run).available.length,
    'the map view shows the open find and no transitions');
  assert(!chooseFindItem(run, options.includes('fire') ? 'frost' : 'fire').ok, 'only offered items can be taken');
  assert(options.includes('bomb'), 'the find table includes a bomb');
  const bombs = run.resources.inventory.bomb;
  run = ok(chooseFindItem(run, 'bomb'), 'take bomb');
  assert(run.resources.inventory.bomb === bombs + 1 && run.tools.items.includes('bomb') && run.tools.abilities.includes('jump'), 'the chosen item is added and opened');
  const notOffered = (['frost', 'fire'] as ItemKind[]).find(item => !options.includes(item))!;
  const forged = JSON.parse(serializeForestRun(run)); forged.finds[0].item = notOffered; forged.tools.items = [...new Set(forged.tools.items.map((item: ItemKind) => item === 'bomb' ? notOffered : item))]; forged.resources.inventory.bomb--; forged.resources.inventory[notOffered]++;
  assert(parseForestRun(JSON.stringify(forged)) === null && json(parseForestRun(serializeForestRun(run))) === json(run), 'a find choice outside the offered items is rejected');
  run = ok(enterNode(run, 'trail-banners'), 'enter banners'); launch(e, run);
  const target = e.state.board.findIndex(cell => !!cell && cell.kind !== 'prism' && cell.kind !== 'door');
  assert(e.previewItem('bomb', target).valid, 'the found bomb is usable in the next battle');
  assert(e.useItem('bomb', target) && e.state.inventory.bomb === bombs, 'real bomb use spends it');
  e.winLevel(); run = settle(e, run);
  assert(run.resources.inventory.bomb === bombs, 'the spent bomb stays spent');
  for (const id of ['jailer', 'den-battle']) {
    run = ok(enterNode(run, id), `enter ${id}`); launch(e, run); e.winLevel(); run = settle(e, run);
    if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), `refuse at ${id}`);
  }
  run = ok(restHeal(ok(enterNode(run, 'den-rest'), 'den rest')), 'heal at den rest');
  run = ok(enterNode(run, 'den-elite'), 'enter den-elite'); launch(e, run); e.winLevel(); run = settle(e, run);
  assert(run.pending?.kind === 'talisman' && json(parseForestRun(serializeForestRun(run))) === json(run), 'the hard-battle reward survives serialization');
  run = ok(chooseTalisman(run, (run.pending as { options: TalismanOption[] }).options[1]), 'den hard-battle reward');
  run = ok(enterNode(run, 'den-breakthrough'), 'enter breakthrough'); launch(e, run);
  assert(e.state.customLevel?.definition.completion === 'exit', 'the breakthrough node is won through the exit');
  e.winLevel(); run = settle(e, run);
  run = ok(enterNode(run, 'den-troll'), 'enter the Troll'); launch(e, run);
  assert(e.state.board.some(cell => cell?.variant === 'troll') && e.state.level.objectives.some(goal => goal.key === 'bossKills'), 'the Troll node starts the troll arena');
  assert(e.state.runNode?.allowedAbilities.includes('spin') && e.state.runNode.allowedAbilities.includes('jump'), 'the Troll fight has the tools of the run');
  await realMove(e);
  if (e.state.phase === 'LOSE') { assertRunLost(settle(e, run), run, e.state.score); e.restartLevel(); }
  e.winLevel(); run = settle(e, run);
  assert(run.result?.outcome === 'victory' && run.result.nodeId === 'den-troll' && !availableNodes(run).length, 'beating the Troll wins the run');
  assert(json(parseForestRun(serializeForestRun(run))) === json(run), 'the Troll victory survives serialization');
  const stubResult = JSON.parse(serializeForestRun(run)); stubResult.result = { outcome: 'boss-in-development', nodeId: 'den-troll' };
  assert(parseForestRun(JSON.stringify(stubResult)) === null, 'an in-development result on a real boss is rejected');
}

/** The Chief's node: carried HP, items and tools replace the battle's own. */
function chiefToolLock() {
  const run = createForestRun(5), e = engine();
  assert(e.startRunBattle({ nodeId: 'camp-chief', label: 'Главарь', seed: 9, template: { kind: 'battle', id: 'chief-breakfast' }, row: 14,
    player: { hp: 3, maxHp: 5, energy: 7 }, inventory: { ...run.resources.inventory, frost: 2 }, allowedItems: ['frost'], allowedAbilities: ['jump'] }), 'chief node starts');
  assert(e.state.player.hp === 3 && e.state.inventory.frost === 2, 'the Chief node keeps carried HP and items');
  assert(!e.setAbility('spin') && !e.previewAbility('spin').valid && e.setAbility('jump'), 'spin stays locked, jump is open');
  e.damagePlayer(1); e.restartLevel();
  assert(e.state.player.hp === 3 && e.state.runNode?.nodeId === 'camp-chief', 'retrying the Chief restores the node entry');
}

function restCap() {
  for (const [hp, expected] of [[1, 3], [4, 5], [5, 5]]) {
    const run = createForestRun(3);
    run.visited = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4', 'goblin-archer']; run.currentNodeId = 'goblin-archer'; run.resources.player.hp = hp;
    run.resources.player.damageEffects = { burning: 2, burningTurns: 1, poison: 1, bleeding: 1, bleedingSteps: 2 };
    const step = restHeal(ok(enterNode(run, 'trail-rest'), 'rest')), rested = ok(step, 'heal');
    assert(rested.resources.player.hp === expected, `rest from ${hp} HP gives ${expected}, not above the maximum`);
    assert(!rested.resources.player.damageEffects && step.ok && step.events.some(event => event.type === 'effects-cleared'), 'rest removes burning, poison and bleeding');
  }
}

/** Refill palette by map row, launched through the engine for every battle node. */
async function paletteByRow() {
  const colorsAt = new Map<string, Set<number>>();
  for (const node of FOREST_MAP) {
    if (!isBattleNode(node)) continue;
    const e = engine(), template = nodeRunTemplate(node); assert(template, `${node.id} has a battle template`);
    assert(e.startRunBattle({ nodeId: node.id, label: node.name, seed: forestNodeSeed(1, node.id), row: node.row, player: { hp: 5, maxHp: 5, energy: 0 },
      template: template!, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [], ...(nodeRefillPalette(node) ? { paletteWeights: nodeRefillPalette(node)! } : {}) }), `${node.id} starts`);
    const colors = new Set(e.state.customLevel ? e.state.customLevel.paletteWeights.flatMap((weight, color) => weight > 0 ? [color] : []) : [0, 1, 2, 3, 4]);
    for (const color of forestRowPalette(node.row)) assert(colors.has(color), `${node.id}: row ${node.row} palette is available in the refill`);
    colorsAt.set(node.id, colors);
  }
  for (const path of forestMapPaths()) {
    let previous = new Set<number>();
    for (const id of path) {
      const colors = colorsAt.get(id); if (!colors) continue;
      assert([...previous].every(color => colors.has(color)), `${path.join('>')}: refill palette never narrows (at ${id})`);
      previous = colors;
    }
  }
  // Trunk node 3 has a two-color authored opening; on the map (row 3) its refill already brings in a third color.
  const authored = new Set(forestBattle('trunk-last-step')!.definition.enemies.map(enemy => enemy.color));
  let fresh = 0;
  for (const seed of [1, 2, 3, 4]) {
    let run = createForestRun(seed);
    run.visited = ['trunk-1', 'trunk-2']; run.currentNodeId = 'trunk-2';
    run = ok(enterNode(run, 'trunk-3'), 'enter trunk-3');
    const e = engine(); launch(e, run);
    const start = new Map(e.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
    for (let turn = 0; turn < 3; turn++) await realMove(e);
    for (const cell of e.state.board) {
      if (!cell) continue;
      if (start.has(cell.id)) assert(cell.color === start.get(cell.id), 'survivors keep their colors');
      else if (cell.color !== null && !authored.has(cell.color)) fresh++;
    }
  }
  assert(fresh > 0, 'refill in a map node uses the row palette beyond the template colors');
}

/**
 * Effect stacks from a real node battle. No authored template has an enemy with an attack effect yet (forest enemies
 * are in progress), so the wolf node's enemies get a poison strike, as an editor level may define (the chosen chain ends under a strike); the hit itself is
 * the engine's ordinary enemy phase after a real chain.
 */
async function realEffects() {
  let run = createForestRun(1);
  const e = engine();
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) { run = ok(enterNode(run, id), `enter ${id}`); launch(e, run); e.winLevel(); run = settle(e, run); }
  run = ok(enterNode(run, 'beast-wolf'), 'enter wolf'); launch(e, run);
  for (const cell of e.state.board) if (cell && cell.kind !== 'door' && cell.kind !== 'prism') cell.attackEffect = 'poison';
  // A chain that ends under an enemy strike without killing the cat: the poison comes from the real enemy phase.
  const hurts = (path: number[]) => { const p = e.preview(path); return p.valid && !p.completesRoom && !p.playerDies && p.damage > 0; };
  const move = e.availableMoves(6).find(hurts);
  assert(move, 'the wolf node offers a chain that ends under a strike');
  const forecast = e.preview(move!);
  await realMove(e, path => json(path) === json(move));
  assert(e.state.phase === 'PLAYER_INPUT' && (e.state.player.damageEffects?.poison ?? 0) > 0, 'a real enemy strike poisons the cat');
  assert(forecast.endEffects?.poison === e.state.player.damageEffects!.poison, 'the chain forecast showed the poison that was applied');
  e.winLevel(); run = settle(e, run);
  const poison = run.resources.player.damageEffects?.poison ?? 0;
  assert(poison > 0 && json(parseForestRun(serializeForestRun(run))) === json(run), 'poison is carried into the run and saved');
  const next = ok(enterNode(run, 'beast-boar'), 'enter boar'), boar = engine(); launch(boar, next);
  const hp = boar.state.player.hp; await boar.waitTurn();
  assert(boar.state.player.hp < hp, 'carried poison keeps ticking in the next battle');
  const step = restHeal(ok(enterNode(run, 'trail-rest'), 'rest')), rested = ok(step, 'heal');
  assert(!rested.resources.player.damageEffects && step.ok && step.events.some(event => event.type === 'effects-cleared'), 'healing at the rest clears the carried poison');
}

/** A hard-battle victory gives +1 HP (up to the maximum) together with the talisman choice; the saved run keeps it. */
async function hardHeart() {
  let run = createForestRun(77);
  const e = engine();
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4', 'goblin-archer', 'goblin-shield', 'trail-find', 'trail-banners', 'jailer', 'camp-battle', 'camp-rest']) {
    run = ok(enterNode(run, id), `enter ${id}`);
    if (run.pending?.kind === 'battle') { launch(e, run); e.winLevel(); run = settle(e, run); }
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `find at ${id}`);
    if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), `refuse at ${id}`);
    if (run.pending?.kind === 'rest') run = ok(restHeal(run), `heal at ${id}`);
  }
  run = ok(enterNode(run, 'camp-elite'), 'enter the hard battle');
  for (const wound of [2, 0]) {
    const fight = engine(); launch(fight, run);
    assert(fight.state.runNode?.nodeId === 'camp-elite', 'the hard battle really starts');
    await realMove(fight);
    if (fight.state.phase !== 'PLAYER_INPUT') fight.restartLevel();
    // Only to set up both cases: wounded, and already at full HP.
    fight.state.player.hp = wound ? Math.max(1, fight.state.player.maxHp - wound) : fight.state.player.maxHp;
    fight.winLevel();
    const before = fight.state.player.hp, step = resolveBattle(run, fight.runBattleOutcome()!), won = ok(step, 'hard-battle victory');
    const expected = Math.min(won.resources.player.maxHp, before + 1);
    assert(won.resources.player.hp === expected, `hard-battle victory from ${before} HP gives ${expected} HP, never above the maximum`);
    assert(step.ok && step.events.some(event => event.type === 'healed' && event.nodeId === 'camp-elite' && event.amount === expected - before), 'the heal is reported to the map screen');
    assert(won.pending?.kind === 'talisman', 'the talisman choice follows the hard-battle victory');
    assert(json(parseForestRun(serializeForestRun(won))) === json(won), 'the healed run round-trips through the save');
    const picked = ok(chooseTalisman(won, null), 'refuse the talismans');
    assert(picked.resources.player.hp === expected && json(parseForestRun(serializeForestRun(picked))) === json(picked), 'the heal stays after the choice and in the save');
  }
}

async function determinism() {
  const a: string[] = [], b: string[] = [];
  const first = await campRoute(701, a), second = await campRoute(701, b);
  assert(a.length === b.length && a.every((entry, n) => entry === b[n]) && json(first) === json(second), 'same seed and choices replay identically');
  assert(json(parseForestRun(serializeForestRun(first))) === json(first) && parseForestRun(serializeForestRun({ ...first, result: null })) === null,
    'a completed boss without a result (stuck run) is rejected');
  const after = await Promise.all([1, 83, 987654321].map(async seed => {
    const e = engine(), run = ok(enterNode(createForestRun(seed), 'trunk-1'), 'enter'); launch(e, run); await realMove(e); return json(e.state.board.map(cell => cell?.color ?? null));
  }));
  assert(new Set(after).size > 1, 'different run seeds give different refills in the same node');
  for (const seed of [1, 701]) assert(new Set(FOREST_MAP.map(node => forestNodeSeed(seed, node.id))).size === FOREST_MAP.length,
    'every node of a run gets its own seed, so nodes sharing a template do not replay the same battle');
}

function serialization() {
  let run = createForestRun(4242);
  assert(json(parseForestRun(serializeForestRun(run))) === json(run), 'fresh run round-trips');
  run = ok(enterNode(run, 'trunk-1'), 'enter');
  const parsed = parseForestRun(serializeForestRun(run))!;
  assert(json(parsed) === json(run) && json(battleSetup(parsed)) === json(battleSetup(run)), 'pending battle round-trips to the same setup');
  const tamper = (edit: (value: Record<string, any>) => void) => { const value = JSON.parse(serializeForestRun(run)); edit(value); return parseForestRun(JSON.stringify(value)); };
  assert(parseForestRun('{') === null && tamper(v => { v.version = 3; }) === null, 'garbage and other versions are rejected');
  // Version 1 (before the generated map, 04.10.2026) has no map and no picks: it walks the authored graph.
  assert(json(tamper(v => { v.version = 1; delete v.map; delete v.picks; })) === json(run), 'a version 1 save loads on the authored graph');
  assert(tamper(v => { v.version = 1; }) === null, 'a version 1 save never carries a map');
  assert(tamper(v => { v.visited = ['trunk-2']; v.currentNodeId = 'trunk-2'; v.pending = null; }) === null, 'a route that skips nodes is rejected');
  assert(tamper(v => { v.pending.seed++; }) === null, 'a battle seed not derived from the run is rejected');
  assert(tamper(v => { v.resources.player.hp = 9; }) === null, 'HP above the maximum is rejected');
  assert(tamper(v => { v.resources.player.hp = 0; v.pending.entry.player.hp = 0; }) === null, 'a cat at 0 HP is rejected');
  assert(tamper(v => { v.tools.abilities = ['spin', 'jump']; v.pending.tools.abilities = ['spin', 'jump']; }) === null, 'tools not opened by the path are rejected');
  assert(tamper(v => { v.pending.tools.abilities = ['spin']; }) === null, 'battle tools that differ from the run are rejected');
  assert(tamper(v => { v.pending.entry.inventory.bomb = 50; v.resources.inventory.bomb = 50; }) === null, 'items the path could not give are rejected');
  assert(tamper(v => { v.pending.entry.inventory.bomb = 1; }) === null, 'an entry snapshot that differs from the run is rejected');
  const outcome = { nodeId: 'trunk-1', won: true, player: { hp: 0, maxHp: 5, energy: 0 }, inventory: run.resources.inventory };
  assert(!resolveBattle(run, outcome).ok, 'a victory at 0 HP is not accepted');

  const data = new Map<string, string>();
  const storage: RunStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
  const store = createForestRunStore(storage);
  assert(store.save(run) && data.has(FOREST_RUN_STORAGE_KEY), 'run is saved under the v1 key');
  assert(json(createForestRunStore(storage).load()) === json(run), 'a new page load continues the saved run');
  store.clear(); assert(createForestRunStore(storage).load() === null, 'clear removes the saved run');
  const broken: RunStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
  const memory = createForestRunStore(broken);
  assert(!memory.save(run) && json(memory.load()) === json(run), 'without working storage the run lives in memory');
  const none = createForestRunStore(null);
  assert(!none.save(run) && json(none.load()) === json(run), 'without storage the run lives in memory');
  memory.clear(); assert(memory.load() === null, 'memory copy can be cleared');
}

/**
 * Authored node battles (src/game/run/forestBattles.ts): every registry battle passes the validator and starts as a
 * node with an opening chain and its authored metadata; a map node bound to a registry battle is played through the
 * real run model and engine commands.
 */
async function registryBattles() {
  const battles = Object.values(FOREST_NODE_BATTLES);
  assert(battles.length > 0, 'the node battle registry is not empty');
  assert(!validateForestBattles().length, `registry battles are valid: ${validateForestBattles().join(' ')}`);
  const sample = battles[0];
  let duplicate = '';
  try { buildNodeBattleRegistry({ beasts: [sample], goblins: [sample] }); } catch (error) { duplicate = String(error); }
  assert(duplicate.includes(sample.id), 'a repeated battle id is rejected when the registry is built');
  const misuse: NodeBattle = { ...sample, definition: { ...sample.definition, inventory: { frost: 1, bomb: 0, healing: 0, fire: 0 } } };
  assert(validateNodeBattle(misuse).length === 1, 'items of a node battle belong to the run');
  for (const entry of battles) {
    const bound = FOREST_MAP.filter(node => node.content.kind === 'battle' && node.content.battleId === entry.id).map(node => node.row);
    for (const row of bound.length ? bound : [1, 5, 10, 14]) {
      const e = engine(), paletteWeights = authoredRefillPalette(entry, row);
      assert(e.startRunBattle({ nodeId: `check-${entry.id}`, label: entry.name, seed: forestNodeSeed(7, entry.id), template: { kind: 'battle', id: entry.id }, row,
        player: { hp: 4, maxHp: 5, energy: 1 }, inventory: { frost: 1, bomb: 0, healing: 0, fire: 0 }, allowedItems: ['frost'], allowedAbilities: ['jump'], paletteWeights }),
      `${entry.id}: starts as a node battle on row ${row}`);
      const { state } = e, definition = entry.definition;
      assert(state.phase === 'PLAYER_INPUT' && e.availableMoves(6).length > 0, `${entry.id}: the opening has an ordinary chain`);
      assert(state.runNode?.nodeId === `check-${entry.id}` && state.runNode.row === row, `${entry.id}: a node battle on row ${row}`);
      assert(state.player.hp === 4 && state.player.energy === 1 && state.inventory.frost === 1, `${entry.id}: run resources replace the battle's own`);
      assert(json(state.tutorial!.allowedItems) === json(['frost']) && json(state.tutorial!.allowedAbilities) === json(['jump']), `${entry.id}: run tools replace permissions`);
      assert(state.tutorial!.targetIds.length === entry.targetIndices.length
        && entry.targetIndices.every(index => state.tutorial!.targetIds.includes(state.board[index]!.id)), `${entry.id}: marked targets are registered`);
      for (const enemy of definition.enemies) {
        const cell = state.board[enemy.index]!;
        // An elite enemy loads with its authored HP multiplied by ELITE_HP_FACTOR (elite.ts).
        assert(cell.color === enemy.color && cell.hp === enemy.hp * (enemy.elite ? ELITE_HP_FACTOR : 1) && cell.variant === enemy.variant, `${entry.id}: authored layout kept at ${enemy.index}`);
        // Authored passivity holds on the trunk (rows 1–4) only; from row 5 every enemy follows the growing anger.
        if (enemy.variant !== 'jailer') assert(!!cell.behavior.passive === (!enemy.aggressive && row < 5), `${entry.id}: passivity on row ${row} at ${enemy.index}`);
      }
      assert(json(state.devices.map(device => device.index)) === json((definition.devices ?? []).map(device => device.index))
        && json(state.customLevel!.definition.spikedEdges ?? []) === json(definition.spikedEdges ?? []), `${entry.id}: devices and spiked edges kept`);
      assert(json(state.customLevel!.paletteWeights) === json(paletteWeights), `${entry.id}: row ${row} refill palette plus authored colors`);
      assert(state.level.name === entry.name && state.level.tutorial === entry.hint && state.level.description === entry.description, `${entry.id}: battle texts shown`);
      e.winLevel();
      assert(e.runBattleOutcome()?.won === true && e.runBattleOutcome()?.nodeId === `check-${entry.id}`, `${entry.id}: a won node battle reports its outcome`);
    }
  }
  assert(!engine().startRunBattle({ ...battleSetup(ok(enterNode(createForestRun(1), FOREST_MAP_START), 'start'))!, template: { kind: 'battle', id: 'no-such-battle' } }),
    'an unknown registry id is rejected by the engine');

  // Bind a map node to a registry battle for this check only: the validator, the run model and the engine agree.
  const node: ForestMapNode = forestNode('trunk-2')!, original = node.content;
  try {
    node.content = battle('no-such-battle');
    assert(validateForestMap().some(error => error.includes('no-such-battle')), 'a node referring to a missing battle id is invalid');
    node.content = battle(sample.id);
    assert(!validateForestMap().length, 'a node bound to a registry battle is valid');
    assert(json(nodeRefillPalette(node)) === json(authoredRefillPalette(sample, node.row)), 'node palette: row palette plus the authored colors');
    let run = ok(enterNode(createForestRun(5), 'trunk-1'), 'enter trunk-1');
    const first = engine(); launch(first, run); first.winLevel(); run = settle(first, run);
    run = ok(enterNode(run, 'trunk-2'), 'enter bound node');
    const setup = battleSetup(run)!;
    assert(json(setup.template) === json({ kind: 'battle', id: sample.id }), 'the bound node plays the registry battle');
    const e = engine(); launch(e, run);
    const replay = engine(); launch(replay, run);
    for (let turn = 0; turn < 2; turn++) { await realMove(e); await realMove(replay); }
    assert(json(e.captureAnalysisSnapshot()) === json(replay.captureAnalysisSnapshot()), 'the same run replays the node battle identically');
    e.restartLevel();
    assert(e.state.turn === 0 && e.state.runNode?.nodeId === 'trunk-2', 'retry restores the node entry');
    e.damagePlayer(e.state.player.hp);
    assertRunLost(settle(e, run), run, e.state.score);
  } finally { node.content = original; }
  assert(!validateForestMap().length, 'map restored after the binding check');
}

const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;

/**
 * A defeat by real play ends the run (decision of 04.10.2026). The cat reaches the beast trail at 1 HP (trunk battles
 * won after a wound), then fights with real chains: a chain the forecast marks as deadly when one exists, otherwise a
 * rest, until the enemies kill it. Spread seeds; the forecast and the outcome agree.
 */
async function defeatEndsRun() {
  let lost = 0;
  for (let k = 1; k <= 4; k++) {
    let run = createForestRun(spread(k));
    const e = engine();
    for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) {
      run = ok(enterNode(run, id), `enter ${id}`); launch(e, run);
      if (id === 'trunk-4') e.damagePlayer(e.state.player.hp - 1);
      e.winLevel(); run = settle(e, run);
    }
    assert(run.resources.player.hp === 1, 'the cat leaves the trunk at 1 HP');
    run = ok(enterNode(run, 'beast-wolf'), 'enter wolf'); launch(e, run);
    for (let turn = 0; turn < 40 && e.state.phase === 'PLAYER_INPUT'; turn++) {
      const deadly = e.availableMoves(6).find(path => e.preview(path).playerDies);
      if (deadly) { await realMove(e, path => json(path) === json(deadly)); assert((e.state.phase as string) === 'LOSE', `seed ${k}: the chain forecast as deadly kills the cat`); }
      else await e.waitTurn();
    }
    if (e.state.phase !== 'LOSE') continue;
    lost++;
    const before = run, after = settle(e, run);
    assertRunLost(after, before, e.state.score);
    assert(forestNode(after.result!.nodeId)!.row === 5 && forestRunView(after).battlesWon === 4, `seed ${k}: the result knows the row and the won battles`);
  }
  assert(lost >= 2, `real play lost the wolf node on most seeds (${lost}/4)`);
  console.log(`PASS a real defeat ends the run (${lost}/4 seeds lost the wolf node at 1 HP)`);
}

/** Saves made before 04.10.2026 (an open battle with `defeats`, no `score`) load and play by the new rules. */
function oldSaves() {
  let run = createForestRun(spread(7));
  for (const id of ['trunk-1', 'trunk-2']) { run = ok(enterNode(run, id), `enter ${id}`); if (run.pending?.kind === 'battle') { const e = engine(); launch(e, run); e.winLevel(); run = settle(e, run); } }
  run = ok(enterNode(run, 'trunk-3'), 'enter trunk-3');
  const old = JSON.parse(serializeForestRun(run)); old.pending.defeats = 3; delete old.score;
  const parsed = parseForestRun(JSON.stringify(old));
  assert(parsed && parsed.score === 0 && parsed.pending?.kind === 'battle' && !('defeats' in parsed.pending), 'an old save with defeats loads; the counter is dropped, the score starts at 0');
  assert(json(battleSetup(parsed!)) === json(battleSetup(run)), 'the old open battle starts from the same entry');
  const e = engine(); launch(e, parsed!); e.damagePlayer(9);
  assertRunLost(settle(e, parsed!), parsed!, e.state.score);
  const finished = JSON.parse(serializeForestRun(ok(enterNode(createForestRun(spread(8)), 'trunk-1'), 'enter')));
  finished.pending.defeats = 1; delete finished.score; delete finished.loot;
  assert(parseForestRun(JSON.stringify(finished))?.pending?.kind === 'battle', 'an old save without loot and score loads');
  const bad = JSON.parse(JSON.stringify(old)); bad.pending.defeats = -1;
  assert(parseForestRun(JSON.stringify(bad)) === null, 'a malformed old counter is still rejected');
  const ended = JSON.parse(serializeForestRun(run)); ended.pending = null; ended.result = { outcome: 'defeat', nodeId: 'trunk-4' };
  assert(parseForestRun(JSON.stringify(ended)) === null, 'a defeat in a node that was not entered is rejected');
  ended.result.nodeId = 'trunk-3'; ended.score = 10;
  assert(parseForestRun(JSON.stringify(ended))?.result?.outcome === 'defeat', 'a defeat in the entered node loads');
  ended.pending = run.pending;
  assert(parseForestRun(JSON.stringify(ended)) === null, 'a defeat with an open battle is rejected');
}

mapStructure();
oldSaves();
restCap();
chiefToolLock();
serialization();
await paletteByRow();
await registryBattles();
await realEffects();
await hardHeart();
await denRoute();
await defeatEndsRun();
await determinism();
console.log('forest run: map, carry-over, rest, find, both bosses, defeat ends the run, old saves, determinism and storage passed');
