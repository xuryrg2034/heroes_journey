import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { chainAdjacent, isWalkable } from './forestSystems';
import { hasOrdinaryChain } from './boardGeneration';
import { forestBattle } from './run/forestBattles';
import { authoredRefillPalette, forestNode, forestRowPalette } from './run/forestMap';
import { forestNodeSeed } from './run/forestRun';
import { startNodeBattle } from './testing/fixtures';
import type { ChainPreview, ItemKind } from './forestTypes';

// Trunk battles (map rows 1–4, src/game/run/battles/trunk.ts; former opening lessons 1–4). Every battle is started
// exactly as its map node (startNodeBattle: 5/5 HP, 0 energy, no items, the node's tools — none on the trunk — and the
// row palette plus the authored colors). Every route below is played through the real engine commands on the battle's
// authored seed; refills after the first move are the seeded random ones. Analyzer metrics are recorded in
// docs/levels/*.md, not asserted here.

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TRUNK = [
  { id: 'trunk-wake', node: 'trunk-1' },
  { id: 'trunk-axe', node: 'trunk-2' },
  { id: 'trunk-last-step', node: 'trunk-3' },
  { id: 'trunk-arrows', node: 'trunk-4' },
] as const;
type TrunkId = typeof TRUNK[number]['id'];

function start(id: TrunkId, seed?: number): ForestEngine {
  return startNodeBattle(id, seed === undefined ? {} : { seed });
}

const at = (engine: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * engine.state.cols + label.charCodeAt(0) - 65;
const path = (engine: ForestEngine, route: string) => route.split('-').map(label => at(engine, label));
const preview = (engine: ForestEngine, route: string) => engine.preview(path(engine, route));
const hitOn = (engine: ForestEngine, forecast: ChainPreview, label: string) => forecast.hits.find(hit => hit.index === at(engine, label));
const label = (engine: ForestEngine, index: number) => String.fromCharCode(65 + index % engine.state.cols) + (Math.floor(index / engine.state.cols) + 1);

async function commit(engine: ForestEngine, route: string): Promise<ChainPreview> {
  const steps = path(engine, route);
  const before = JSON.stringify(engine.captureAnalysisSnapshot());
  const colors = new Map(engine.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const forecast = engine.preview(steps);
  assert(JSON.stringify(engine.captureAnalysisSnapshot()) === before, `preview of ${route} preserves state, refill RNG and IDs`);
  assert(forecast.valid, `route ${route} valid: ${forecast.reason}`);
  const hp = engine.state.player.hp;
  assert(engine.beginChain(steps[0]), `route ${route} starts`);
  for (const step of steps.slice(1)) assert(engine.extendChain(step), `route ${route} extends to ${step}`);
  assert(await engine.releaseChain(), `route ${route} resolves`);
  assert(engine.state.lastDamage === forecast.damage && hp - engine.state.player.hp === forecast.damage,
    `route ${route}: forecast damage ${forecast.damage} matches execution ${hp - engine.state.player.hp}`);
  assert(!!forecast.playerDies === (engine.state.phase === 'LOSE'), `route ${route}: forecast death matches execution`);
  if (forecast.completesRoom) assert(engine.state.phase === 'WIN', `route ${route}: forecast victory is executed`);
  for (const cell of engine.state.board) {
    if (!cell) continue;
    if (colors.has(cell.id)) assert(cell.color === colors.get(cell.id), 'survivors keep their colors');
    // A long chain leaves colour-change crystals: colourless, not enemies.
    else if (cell.crystalChain) assert(cell.kind === 'prism' && cell.color === null, 'a new crystal is a colourless prism');
    else assert(cell.behavior.passive && cell.color !== null && engine.state.customLevel!.paletteWeights[cell.color] > 0,
      'new trunk enemies remain passive and use the node palette');
  }
  if (engine.state.phase === 'PLAYER_INPUT') assert(hasOrdinaryChain(engine.state), `route ${route} leaves an ordinary chain`);
  return forecast;
}

function authoredLayouts() {
  for (const { id, node } of TRUNK) {
    const battle = forestBattle(id)!, mapNode = forestNode(node)!;
    assert(!!battle && mapNode.content.kind === 'battle' && mapNode.content.battleId === id, `${node} plays ${id}`);
    const { definition } = battle;
    const validation = validateCustomLevel(definition);
    assert(validation.valid, `${id} uses a valid custom-level definition: ${validation.errors.join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${id} is between 5×5 and 7×7`);
    assert(definition.enemies.every(enemy => enemy.color === 0 || enemy.color === 2), `${id} starts with red and blue enemies only`);
    assert(new Set(definition.enemies.map(enemy => enemy.color)).size === 2, `${id} starts with both colors`);
    assert(definition.turnLimit === 0 && (definition.playerHp ?? 5) === 5, `${id} has no turn limit`);
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...(definition.devices ?? []).map(device => device.index)]);
    definition.terrain.forEach((terrain, cell) => {
      if (terrain !== 'wall') assert(cell === definition.heroIndex || occupied.has(cell), `${id} floor ${cell} is authored`);
      else assert(!occupied.has(cell), `${id} wall ${cell} is clear`);
    });
    const engine = start(id);
    const { state } = engine;
    assert(state.runNode?.nodeId === node && state.runNode.row === mapNode.row, `${id} starts as the map node ${node} on row ${mapNode.row}`);
    assert(state.player.hp === 5 && state.player.maxHp === 5 && state.player.energy === 0, `${id} starts at 5 HP without energy`);
    assert(Object.values(state.inventory).every(amount => amount === 0), `${id} starts without consumables`);
    assert(!state.runNode!.allowedItems.length && !state.runNode!.allowedAbilities.length, `${id}: no tool is open on the trunk`);
    // Refill palette of a map node: the row palette plus the authored colors (rows 1–2 → red/blue, rows 3–4 → + green).
    const refill = state.customLevel!.paletteWeights.flatMap((weight, color) => weight > 0 ? [color] : []);
    assert(JSON.stringify(state.customLevel!.paletteWeights) === JSON.stringify(authoredRefillPalette(battle, mapNode.row))
      && forestRowPalette(mapNode.row).every(color => refill.includes(color)) && refill.length === (mapNode.row <= 2 ? 2 : 3),
    `${id}: row ${mapNode.row} refill palette ${refill}`);
    // Authored enemies are loaded untouched, marked targets keep their initial IDs.
    for (const enemy of definition.enemies) {
      const cell = state.board[enemy.index]!;
      assert(cell.color === enemy.color && cell.hp === enemy.hp && cell.kind === enemy.kind, `${id}: authored enemy at ${enemy.index} kept`);
      assert(cell.behavior.passive === !enemy.aggressive, `${id}: trunk passivity follows the authored weapon at ${enemy.index}`);
    }
    assert(state.tutorial!.targetIds.join() === battle.targetIndices.map(index => state.board[index]!.id).join(), `${id}: marked targets keep their IDs`);
    assert(state.board.every((cell, index) => !isWalkable(state, index) || index === state.player.index || !!cell
      || state.devices.some(device => device.index === index)), `${id} starts dense`);
    // Colors form connected groups: every colored enemy touches a chain-adjacent enemy of its own color.
    state.board.forEach((cell, index) => {
      if (!cell || cell.color === null) return;
      assert(state.board.some((other, near) => near !== index && other?.color === cell.color && chainAdjacent(state, index, near)),
        `${id} enemy at ${index} belongs to a same-color group`);
    });
    assert(hasOrdinaryChain(state), `${id} opens with an ordinary chain`);
  }
}

async function battleWake() {
  const g = start('trunk-wake');
  const diagonal = 'D2-D3-C4-B3-A2-A3-B4-C5';
  const forecast = preview(g, diagonal);
  assert(forecast.hits.map(hit => hit.availablePower).join() === '1,2,3,4,5,6,7,8', 'every weak goblin adds one power');
  assert(forecast.completesRoom, 'the diagonal red chain reaches eight defeats at once');
  assert(!preview(g, 'D2-D3-D4').valid, 'crossing from red to blue is rejected without spending a turn');
  const orthogonalOnly = g.availableMoves(16).filter(steps => steps.every((cell, n) => n === 0
    || cell % 5 === steps[n - 1] % 5 || Math.floor(cell / 5) === Math.floor(steps[n - 1] / 5)));
  assert(orthogonalOnly.every(steps => !g.preview(steps).completesRoom), 'no orthogonal-only chain wins: the battle needs a diagonal step');
  await commit(g, diagonal);
  assert(g.state.phase === 'WIN' && g.state.objective.kills === 8 && g.state.player.hp === 5, 'battle 1 won in one turn');

  const twoTurns = start('trunk-wake');
  await commit(twoTurns, 'E2-E3-E4');
  assert(twoTurns.state.phase === 'PLAYER_INPUT' && twoTurns.state.objective.kills === 3, 'a short blue chain keeps the battle going');
  await commit(twoTurns, 'D3-C4-B3-A2-A3');
  assert(twoTurns.state.phase === 'WIN', 'a second red chain with diagonals completes the goal');
}

async function battleAxe() {
  const g = start('trunk-axe');
  assert(g.state.board[at(g, 'C2')]?.hp === 3 && g.state.board[at(g, 'E2')]?.hp === 4, 'marked guards have authored HP');
  assert(g.state.board.every(cell => !cell || cell.behavior.passive), 'nobody is armed in battle 2');
  const red = preview(g, 'B3-B2-C2');
  assert(red.hits.map(hit => hit.availablePower).join() === '1,2,3' && hitOn(g, red, 'C2')?.killed
    && red.hits.at(-1)?.remainingPower === 0, 'two weak goblins give exactly the 3 power the red guard needs');
  await commit(g, 'B3-B2-C2');
  assert(g.state.objective.tutorialTargets === 1 && g.state.player.index === at(g, 'C2'), 'red guard falls, cat stands in its place');
  const short = preview(g, 'D1-E1-E2');
  assert(short.endsOnSurvivor && hitOn(g, short, 'E2')?.hpAfter === 1 && short.endIndex === at(g, 'E1'),
    'the short blue lane is one power short: the guard survives and the cat stops before it');
  const detour = preview(g, 'C3-D4-E3-E2');
  assert(detour.completesRoom, 'the longer blue detour brings enough power');
  await commit(g, 'C3-D4-E3-E2');
  assert(g.state.phase === 'WIN' && g.state.turn === 2, 'battle 2 won in two turns');

  const wound = start('trunk-axe');
  await commit(wound, 'B3-B2-C2');
  await commit(wound, 'D1-E1-E2');
  assert(wound.state.board[at(wound, 'E2')]?.hp === 1 && wound.state.objective.tutorialTargets === 1, 'the wound persists and is not a kill');
  await commit(wound, 'D1-E2');
  assert(wound.state.phase === 'WIN', 'the wounded guard is finished on the next turn');
}

async function battleLastStep(seed?: number) {
  const g = start('trunk-last-step', seed);
  assert(g.state.board.filter(cell => cell && !cell.behavior.passive).length === 4, 'two armed guards and two armed goblins');
  const greedy = preview(g, 'E5-E6-F5-F4-F3-F2');
  const longest = Math.max(...g.availableMoves(16).map(steps => g.preview(steps).kills));
  assert(greedy.kills === longest && greedy.damage === 2 && !greedy.playerDies,
    'the longest chain ends between the blue guard and an armed goblin: the forecast shows 2 damage');
  assert(preview(g, 'E5-E6-F5-F4-F3').damage === 0, 'stopping one step earlier is safe');
  const trap = start('trunk-last-step', seed);
  await commit(trap, 'E5-E6-F5-F4-F3-F2');
  assert(trap.state.player.hp === 3 && trap.state.phase === 'PLAYER_INPUT', 'the greedy ending costs 2 HP but stays playable');

  const lane = preview(g, 'C5-B5-A4-A3-B2');
  assert(hitOn(g, lane, 'B2')?.killed && lane.hits.at(-1)?.remainingPower === 0 && lane.damage === 0,
    'four red goblins give exactly the 5 power for the red guard; its square is out of every strike');
  await commit(g, 'C5-B5-A4-A3-B2');
  await commit(g, 'B1-C2-D3-E2-F1');
  assert(g.state.phase === 'WIN' && g.state.turn === 2 && g.state.player.hp === 5, 'the authored blue lane finishes the second guard');
}

async function battleArrows(seed?: number) {
  const g = start('trunk-arrows', seed);
  const lever = at(g, 'C4'), guard = at(g, 'D6');
  assert(g.state.devices.length === 1 && g.state.devices[0].kind === 'arrows' && g.state.devices[0].charges === 2, 'one two-charge lever');
  const ordinary = g.availableMoves(16).filter(steps => !steps.includes(lever));
  assert(Math.max(0, ...ordinary.map(steps => g.preview(steps).hits.find(hit => hit.index === guard)?.damage ?? 0)) <= 3,
    'without the lever no chain brings more than 3 power to the 7-HP guard');
  const safe = preview(g, 'B2-C3-C4-D5-D6');
  assert(safe.hits.map(hit => hit.availablePower).join() === '1,2,3,4' && hitOn(g, safe, 'D6')?.hpAfter === 3, 'the lever keeps the color and adds no power');
  assert(safe.completesRoom && safe.damage === 0 && safe.endIndex === at(g, 'D5') && safe.trapHits?.some(hit => hit.index === guard && hit.killed),
    'arrows finish the wounded guard while the cat stands above the line');
  const onLine = preview(g, 'A2-B2-C3-D3-C4-D5-C6-D6');
  assert(onLine.completesRoom && onLine.trapDamage === 4 && onLine.damage === 4, 'ending on the arrow line is forecast as 4 damage');
  assert(preview(g, 'A2-B2-C3-D3-C4-D5-C6').playerDies, 'stopping on the line beside the surviving guard is forecast as death');
  await commit(g, 'B2-C3-C4-D5-D6');
  assert(g.state.phase === 'WIN' && g.state.player.hp === 5 && g.state.devices[0].charges === 1, 'lever battle won in one turn');
  const hurt = start('trunk-arrows', seed);
  await commit(hurt, 'A2-B2-C3-D3-C4-D5-C6-D6');
  assert(hurt.state.phase === 'WIN' && hurt.state.player.hp === 1, 'the forecast 4 damage from own arrows is executed');
}

/** The routes rest on the authored layout, not on refill colors: replay them on the refill seeds of real runs. */
async function routesOnRunSeeds() {
  for (const runSeed of [1, 83, 701, 987654321]) {
    await battleLastStep(forestNodeSeed(runSeed, 'trunk-3'));
    await battleArrows(forestNodeSeed(runSeed, 'trunk-4'));
  }
}

async function replayIsExact() {
  const routes: [TrunkId, string[]][] = [
    ['trunk-axe', ['B3-B2-C2', 'D1-E1-E2', 'D1-E2']],
    ['trunk-last-step', ['C5-B5-A4-A3-B2', 'B1-C2-D3-E2-F1']],
    ['trunk-wake', ['E2-E3-E4', 'D3-C4-B3-A2-A3']],
  ];
  for (const [id, steps] of routes) {
    const runs = [start(id), start(id)];
    for (const engine of runs) for (const route of steps) await commit(engine, route);
    assert(JSON.stringify(runs[0].captureAnalysisSnapshot()) === JSON.stringify(runs[1].captureAnalysisSnapshot()), `${id}: the same seed and actions give the same state`);
  }
}

async function lockedToolsAndRetry() {
  for (const { id } of TRUNK) {
    const g = start(id), snapshot = JSON.stringify(g.state);
    g.state.player.energy = 20;
    for (const item of ['frost', 'bomb', 'healing', 'fire'] as ItemKind[]) {
      g.state.inventory[item] = 3;
      assert(!g.previewItem(item).valid && !g.useItem(item), `${item} stays locked in ${id}`);
    }
    assert(!g.setAbility('jump') && !g.previewAbility('jump').valid && !await g.useAbility('jump'), `jump stays locked in ${id}`);
    assert(!g.setAbility('spin') && !g.previewAbility('spin').valid && !await g.useAbility('spin'), `spin stays locked in ${id}`);
    g.restartLevel();
    assert(JSON.stringify(g.state) === snapshot, `${id} retry restores exact opening`);
  }

  // Rows 1–2 have no armed enemy: waiting never hurts the cat, and the refills stay passive (rows 1–4 keep passivity).
  for (const id of ['trunk-wake', 'trunk-axe'] as const) {
    const g = start(id);
    for (let turn = 0; turn < 5; turn++) {
      assert(await g.waitTurn(), `passive ${id} can advance turn ${turn + 1}`);
      assert(g.state.player.hp === 5, `trainees never injure the cat in ${id}`);
      assert(g.state.board.every(cell => !cell || cell.behavior.passive && !cell.behavior.aggressive), `trainees including refills remain passive on turn ${turn + 1}`);
    }
  }

  const interrupted = start('trunk-axe'), opening = JSON.stringify(interrupted.state);
  const stop = interrupted.subscribe((_state, event) => { if (event.type === 'hit') interrupted.restartLevel(); });
  const steps = path(interrupted, 'B3-B2-C2');
  assert(interrupted.beginChain(steps[0]) && interrupted.extendChain(steps[1]) && interrupted.extendChain(steps[2]), 'interrupted route is selected');
  assert(!await interrupted.releaseChain(), 'restart cancels the stale resolving turn');
  stop();
  assert(JSON.stringify(interrupted.state) === opening, 'hit-time restart restores every authored entity and target');

  const won = start('trunk-wake');
  await commit(won, 'D2-D3-C4-B3-A2-A3-B4-C5');
  const outcome = won.runBattleOutcome();
  assert(outcome?.won && outcome.nodeId === 'trunk-1' && outcome.player.hp === 5, 'a won trunk battle reports its outcome to the run');
}

async function alternateEndpointsStayPlayable() {
  for (const { id } of TRUNK) {
    const sample = start(id);
    const byEnd = new Map<number, number[]>();
    for (const steps of sample.availableMoves(4)) {
      const forecast = sample.preview(steps);
      if (forecast.damage < sample.state.player.hp && !byEnd.has(forecast.endIndex)) byEnd.set(forecast.endIndex, steps);
    }
    assert(byEnd.size >= 3, `${id} offers varied first endpoints`);
    for (const [endpoint, steps] of byEnd) {
      const g = start(id);
      await commit(g, steps.map(cell => label(g, cell)).join('-'));
      assert(g.state.phase === 'WIN' || g.state.phase === 'PLAYER_INPUT' && g.availableMoves(4).length > 0,
        `${id} endpoint ${endpoint} remains playable after random refill`);
    }
  }
}

async function run() {
  authoredLayouts();
  await battleWake(); await battleAxe(); await battleLastStep(); await battleArrows();
  await routesOnRunSeeds();
  await replayIsExact(); await lockedToolsAndRetry(); await alternateEndpointsStayPlayable();
  console.log('PASS trunk battles 1–4 as map nodes: authored two-color layouts, row palettes, verified routes (authored and run seeds), forecast traps, exact replay, locked tools, playable endpoints');
}

run().catch(error => { console.error(error); throw error; });
