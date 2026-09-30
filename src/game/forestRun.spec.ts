import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';
import { authoredRefillPalette, battle, FOREST_MAP, FOREST_MAP_START, FOREST_REST_HEAL, forestMapPaths, forestNode, forestRowPalette, isBattleNode, lessonIndex, nodeRefillPalette,
  validateForestMap, type ForestMapNode } from './run/forestMap';
import { availableNodes, battleSetup, chooseFindItem, createForestRun, enterNode, forestNodeSeed, forestRunView, nodeRunTemplate, parseForestRun,
  resolveBattle, serializeForestRun, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { buildNodeBattleRegistry, FOREST_NODE_BATTLES, forestBattle, validateForestBattles, validateNodeBattle, type NodeBattle } from './run/forestBattles';
import { createForestRunStore, FOREST_RUN_STORAGE_KEY, type RunStorage } from './run/forestRunStorage';
import type { ItemKind } from './forestTypes';

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
  assert(e.state.player.hp === player.hp && e.state.player.maxHp === player.maxHp && e.state.player.energy === player.energy,
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
    assert(next.resources.player.hp === e.state.player.hp && next.resources.player.energy === e.state.player.energy,
      `${outcome!.nodeId}: HP and energy carried out of the battle`);
    assert(json(next.resources.inventory) === json(e.state.inventory), `${outcome!.nodeId}: items carried out of the battle`);
    assert(json(next.resources.player.damageEffects ?? null) === json(e.state.player.damageEffects ?? null), `${outcome!.nodeId}: effects carried out`);
  }
  return next;
}

function mapStructure() {
  assert(!validateForestMap().length, `map is valid: ${validateForestMap().join(' ')}`);
  const paths = forestMapPaths();
  assert(paths.length > 1 && paths.every(path => path[0] === FOREST_MAP_START), 'all routes start at the trunk');
  for (const path of paths) {
    const nodes = path.map(id => forestNode(id)!), battles = nodes.filter(isBattleNode).length;
    assert(battles >= 12 && battles <= 15, `${path.join('>')}: 12–15 battles, got ${battles}`);
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
  assert(chief.content.kind === 'forest-trial', 'the Chief is the existing forest trial');
  assert(forestNode('jailer')!.content.kind === 'lesson' && FOREST_MAP.some(node => node.type === 'breakthrough'), 'Jailer checkpoint and breakthrough nodes exist');
  assert(FOREST_MAP.some(node => node.placeholder), 'temporary template nodes are marked');
  for (const path of paths) path.forEach((id, n) => {
    if (forestNode(id)!.type === 'elite') assert(forestNode(path[n - 1])!.type === 'rest', `${path.join('>')}: a rest right before the elite ${id}`);
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
      assert(run.resources.player.hp === Math.min(run.resources.player.maxHp, hpBefore + FOREST_REST_HEAL), `${id}: rest heals up to the maximum`);
      assert(run.currentNodeId === id && !run.pending, `${id}: rest completes at once`);
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
      const entry = json(e.captureAnalysisSnapshot().entry);
      e.damagePlayer(10); assert(e.state.phase === 'LOSE', 'the cat can fall in a node');
      const lost = settle(e, run);
      assert(lost.pending?.kind === 'battle' && lost.pending.defeats === 1 && json(lost.resources) === json(run.resources), 'a defeat keeps the node and the entry resources');
      assert(!availableNodes(lost).length, 'no transition while the node is unfinished');
      e.restartLevel();
      assert(json(e.state) === json(JSON.parse(entry).state), 'retry restores the node entry snapshot');
      const reloaded = engine(); launch(reloaded, parseForestRun(serializeForestRun(lost))!);
      assert(json(reloaded.captureAnalysisSnapshot()) === json(e.captureAnalysisSnapshot()), 'relaunch after reload equals the retry snapshot');
      run = lost; await realMove(e);
    }
    if (e.state.phase === 'LOSE') {
      // A real chain killed the cat: the node is lost and retried from its entry snapshot.
      run = settle(e, run); assert(run.pending?.kind === 'battle' && run.pending.defeats > 0, `${id}: real death is a defeat`);
      e.restartLevel(); assert((e.state.phase as string) === 'PLAYER_INPUT' && e.state.player.hp === run.resources.player.hp, `${id}: retry after a real death`);
    }
    if (id === 'jailer') assert(!e.state.tutorial!.allowedAbilities.includes('spin'), 'spin is closed during the Jailer battle');
    if (id === 'camp-chief') assert(e.state.room.kind === 'forest' && e.state.runNode?.allowedAbilities.includes('spin'), 'the Chief node is the forest trial with the spin open');
    e.winLevel();
    assert(!e.nextTutorial() && !e.continueCampaign(), `${id}: a won map battle leaves the run neither to a lesson nor to the castle`);
    run = settle(e, run); log(run); saved(run);
    if (id === 'jailer') {
      assert(json(availableNodes(run).map(node => node.id)) === json(['den-battle', 'camp-battle']), 'after the Jailer the player chooses a branch');
      assert(run.tools.abilities.includes('spin'), 'the Jailer victory opens the spin for later battles');
    }
    if (id === 'camp-elite') {
      const options = run.pending?.kind === 'find' ? run.pending.options : [];
      assert(options.length === 3 && run.pending?.nodeId === id && !availableNodes(run).length, 'an elite victory offers a find before moving on');
      const count = run.resources.inventory[options[0]];
      run = ok(chooseFindItem(run, options[0]), 'elite reward'); log(run); saved(run);
      assert(run.resources.inventory[options[0]] === count + 1 && run.currentNodeId === id && availableNodes(run)[0]?.id === 'camp-breakthrough', 'the reward completes the elite node');
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
  assert(options.includes('bomb'), 'castle rewards include a bomb');
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
  for (const id of ['jailer', 'den-battle']) { run = ok(enterNode(run, id), `enter ${id}`); launch(e, run); e.winLevel(); run = settle(e, run); }
  run = ok(enterNode(run, 'den-rest'), 'den rest');
  run = ok(enterNode(run, 'den-elite'), 'enter den-elite'); launch(e, run); e.winLevel(); run = settle(e, run);
  assert(run.pending?.kind === 'find' && json(parseForestRun(serializeForestRun(run))) === json(run), 'the elite reward survives serialization');
  run = ok(chooseFindItem(run, (run.pending as { options: ItemKind[] }).options[1]), 'den elite reward');
  run = ok(enterNode(run, 'den-breakthrough'), 'enter breakthrough'); launch(e, run);
  assert(e.state.customLevel?.definition.completion === 'exit', 'the breakthrough node is won through the exit');
  e.winLevel(); run = settle(e, run);
  run = ok(enterNode(run, 'den-troll'), 'enter the Troll'); launch(e, run);
  assert(e.state.board.some(cell => cell?.variant === 'troll') && e.state.level.objectives.some(goal => goal.key === 'bossKills'), 'the Troll node starts the troll arena');
  assert(e.state.runNode?.allowedAbilities.includes('spin') && e.state.runNode.allowedAbilities.includes('jump'), 'the Troll fight has the tools of the run');
  await realMove(e);
  if (e.state.phase === 'LOSE') { run = settle(e, run); e.restartLevel(); }
  e.winLevel(); run = settle(e, run);
  assert(run.result?.outcome === 'victory' && run.result.nodeId === 'den-troll' && !availableNodes(run).length, 'beating the Troll wins the run');
  assert(json(parseForestRun(serializeForestRun(run))) === json(run), 'the Troll victory survives serialization');
  const stubResult = JSON.parse(serializeForestRun(run)); stubResult.result = { outcome: 'boss-in-development', nodeId: 'den-troll' };
  assert(parseForestRun(JSON.stringify(stubResult)) === null, 'an in-development result on a real boss is rejected');
}

/** Forest-trial boss: carried tools replace the trial's free abilities. */
function chiefToolLock() {
  const run = createForestRun(5), e = engine();
  assert(e.startRunBattle({ nodeId: 'camp-chief', label: 'Главарь', seed: 9, template: { kind: 'forest-trial' }, row: 14,
    player: { hp: 3, maxHp: 5, energy: 7 }, inventory: { ...run.resources.inventory, frost: 2 }, allowedItems: ['frost'], allowedAbilities: ['jump'] }), 'chief node starts');
  assert(e.state.player.hp === 3 && e.state.inventory.frost === 2, 'the Chief node keeps carried HP and items');
  assert(!e.setAbility('spin') && !e.previewAbility('spin').valid && e.setAbility('jump'), 'spin stays locked, jump is open');
  e.damagePlayer(1); e.restartLevel();
  assert(e.state.player.hp === 3 && e.state.runNode?.nodeId === 'camp-chief', 'retrying the Chief restores the node entry, not a fresh trial');
  const free = engine(); free.startLevel(0, 701); free.state.player.energy = 7;
  assert(!free.state.runNode && free.setAbility('spin'), 'the standalone forest trial keeps all abilities');
}

function restCap() {
  for (const [hp, expected] of [[1, 3], [4, 5], [5, 5]]) {
    const run = createForestRun(3);
    run.visited = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4', 'goblin-archer']; run.currentNodeId = 'goblin-archer'; run.resources.player.hp = hp;
    run.resources.player.damageEffects = { burning: 2, burningTurns: 1, poison: 1, bleeding: 1, bleedingSteps: 2 };
    const step = enterNode(run, 'trail-rest'), rested = ok(step, 'rest');
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
  // Trunk node 3 reuses a two-color lesson; on the map (row 3) its refill already brings in a third color.
  const lesson = TUTORIAL_LESSONS[lessonIndex(forestNode('trunk-3')!)], authored = new Set(lesson.definition.enemies.map(enemy => enemy.color));
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
  const standalone = engine(); standalone.startTutorial(lessonIndex(forestNode('trunk-3')!));
  assert(json(standalone.state.customLevel!.paletteWeights) === json(lesson.definition.paletteWeights), 'the standalone lesson keeps its own palette');
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
  const step = enterNode(run, 'trail-rest'), rested = ok(step, 'rest');
  assert(!rested.resources.player.damageEffects && step.ok && step.events.some(event => event.type === 'effects-cleared'), 'the rest clears the carried poison');
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
  assert(parseForestRun('{') === null && tamper(v => { v.version = 2; }) === null, 'garbage and other versions are rejected');
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

function lessonsUnchanged() {
  TUTORIAL_LESSONS.forEach((lesson, index) => {
    const e = engine(); assert(e.startTutorial(index), `lesson ${index + 1} starts`);
    const { state } = e, definition = lesson.definition;
    assert(!state.runNode && state.level.seed === definition.seed && state.waveLabel === `Урок ${index + 1} / ${TUTORIAL_LESSONS.length}`, `${lesson.id}: ordinary lesson launch`);
    assert(state.player.hp === 5 && state.player.maxHp === 5 && state.player.energy === (lesson.initialEnergy ?? 0), `${lesson.id}: lesson HP and energy`);
    assert(json(state.inventory) === json({ frost: 0, bomb: 0, healing: 0, fire: 0, ...definition.inventory }), `${lesson.id}: lesson inventory`);
    assert(json(state.tutorial!.allowedItems) === json(lesson.allowedItems ?? []) && json(state.tutorial!.allowedAbilities) === json(lesson.allowedAbilities ?? []), `${lesson.id}: lesson permissions`);
    // The node battle uses the same authored layout with a different refill seed.
    const node = FOREST_MAP.find(entry => entry.content.kind === 'lesson' && entry.content.lessonId === lesson.id);
    if (!node) return;
    const mapped = engine(), run = ok(enterNode(createForestRun(1), FOREST_MAP_START), 'start');
    const setup = { ...battleSetup(run)!, nodeId: node.id, template: { kind: 'lesson' as const, index }, paletteWeights: nodeRefillPalette(node)! };
    assert(mapped.startRunBattle(setup), `${lesson.id}: template loads as a node`);
    const layout = (engineState: typeof state) => json(definition.enemies.map(enemy => { const cell = engineState.board[enemy.index]; return [cell?.color, cell?.hp, cell?.variant, cell?.behavior.passive]; }));
    assert(layout(mapped.state) === layout(state), `${lesson.id}: node keeps the authored opening layout`);
    assert(definition.paletteWeights.every((weight, color) => !weight || mapped.state.customLevel!.paletteWeights[color] > 0), `${lesson.id}: node palette keeps the template colors`);
  });
  const e = engine(); e.startTutorial(0); e.winLevel();
  assert(e.nextTutorial() && e.state.tutorial?.index === 1, 'ordinary lessons still continue linearly');
  const forest = engine(); forest.startLevel(0, 701); forest.winLevel();
  assert(!forest.state.runNode && forest.continueCampaign() && forest.state.room.kind === 'gate', 'the forest trial still leads to the castle run');
}

/**
 * Authored node battles (src/game/run/forestBattles.ts): every registry battle passes the validator and starts as a
 * node with an opening chain and its lesson metadata; a map node bound to a registry battle is played through the
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
  const misuse: NodeBattle = { ...sample, allowedItems: ['frost'], initialEnergy: 2, nextLessonIndices: [1] };
  assert(validateNodeBattle(misuse).length === 3, 'permissions, energy and branches of a node battle belong to the run');
  for (const entry of battles) {
    const bound = FOREST_MAP.filter(node => node.content.kind === 'battle' && node.content.battleId === entry.id).map(node => node.row);
    for (const row of bound.length ? bound : [1, 5, 10, 14]) {
      const e = engine(), paletteWeights = authoredRefillPalette(entry, row);
      assert(e.startRunBattle({ nodeId: `check-${entry.id}`, label: entry.name, seed: forestNodeSeed(7, entry.id), template: { kind: 'battle', id: entry.id }, row,
        player: { hp: 4, maxHp: 5, energy: 1 }, inventory: { frost: 1, bomb: 0, healing: 0, fire: 0 }, allowedItems: ['frost'], allowedAbilities: ['jump'], paletteWeights }),
      `${entry.id}: starts as a node battle on row ${row}`);
      const { state } = e, definition = entry.definition;
      assert(state.phase === 'PLAYER_INPUT' && e.availableMoves(6).length > 0, `${entry.id}: the opening has an ordinary chain`);
      assert(state.runNode?.nodeId === `check-${entry.id}` && state.tutorial?.index === -1, `${entry.id}: a node battle, not an opening lesson`);
      assert(state.player.hp === 4 && state.player.energy === 1 && state.inventory.frost === 1, `${entry.id}: run resources replace the battle's own`);
      assert(json(state.tutorial!.allowedItems) === json(['frost']) && json(state.tutorial!.allowedAbilities) === json(['jump']), `${entry.id}: run tools replace permissions`);
      assert(state.tutorial!.targetIds.length === entry.targetIndices.length
        && entry.targetIndices.every(index => state.tutorial!.targetIds.includes(state.board[index]!.id)), `${entry.id}: marked targets are registered`);
      for (const enemy of definition.enemies) {
        const cell = state.board[enemy.index]!;
        assert(cell.color === enemy.color && cell.hp === enemy.hp && cell.variant === enemy.variant, `${entry.id}: authored layout kept at ${enemy.index}`);
        // Lesson passivity holds on the trunk (rows 1–4) only; from row 5 every enemy follows the growing anger.
        if (enemy.variant !== 'jailer' && enemy.variant !== 'beacon') assert(!!cell.behavior.passive === (!enemy.aggressive && row < 5), `${entry.id}: passivity on row ${row} at ${enemy.index}`);
      }
      assert(json(state.devices.map(device => device.index)) === json((definition.devices ?? []).map(device => device.index))
        && json(state.customLevel!.definition.spikedEdges ?? []) === json(definition.spikedEdges ?? []), `${entry.id}: devices and spiked edges kept`);
      assert(json(state.customLevel!.paletteWeights) === json(paletteWeights), `${entry.id}: row ${row} refill palette plus authored colors`);
      assert(state.level.name === entry.name && state.level.tutorial === entry.hint && state.level.description === entry.description, `${entry.id}: battle texts shown`);
      e.winLevel();
      assert(!e.nextTutorial() && !e.startTutorialChoice(0) && e.runBattleOutcome()?.won === true, `${entry.id}: lesson transitions are rejected in a node battle`);
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
    assert(e.state.turn === 0 && e.state.runNode?.nodeId === 'trunk-2' && e.state.tutorial?.index === -1, 'retry restores the node entry');
    e.damagePlayer(e.state.player.hp);
    run = settle(e, run);
    assert(run.pending?.kind === 'battle' && run.pending.defeats === 1, 'a lost registry battle stays the current node');
  } finally { node.content = original; }
  assert(!validateForestMap().length, 'map restored after the binding check');
}

mapStructure();
restCap();
chiefToolLock();
serialization();
lessonsUnchanged();
await paletteByRow();
await registryBattles();
await realEffects();
await denRoute();
await determinism();
console.log('forest run: map, carry-over, rest, find, both bosses, retry, determinism and storage passed');
