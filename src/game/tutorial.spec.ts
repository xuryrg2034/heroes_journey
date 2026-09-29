import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';
import { chainAdjacent, isWalkable } from './forestSystems';
import { hasOrdinaryChain } from './boardGeneration';
import { variantSeed } from './levelAnalysis';
import type { ChainPreview, ItemKind } from './forestTypes';

// Battles 1–6 of the opening path (src/game/lessons/opening.ts). Every route below is played through the
// real engine commands on the lesson's own seed; refills after the first move are the seeded random ones.
// Analyzer metrics are recorded in docs/levels/*.md, not asserted here.

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function start(number: number): ForestEngine {
  const engine = new ForestEngine(); engine.animationScale = 0;
  assert(engine.startTutorial(number), `lesson ${number + 1} starts`);
  return engine;
}

const at = (engine: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * engine.state.cols + label.charCodeAt(0) - 65;
const path = (engine: ForestEngine, route: string) => route.split('-').map(label => at(engine, label));
const preview = (engine: ForestEngine, route: string) => engine.preview(path(engine, route));
const hitOn = (engine: ForestEngine, forecast: ChainPreview, label: string) => forecast.hits.find(hit => hit.index === at(engine, label));

async function commit(engine: ForestEngine, route: string): Promise<ChainPreview> {
  const steps = path(engine, route);
  const before = JSON.stringify(engine.state);
  const colors = new Map(engine.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const forecast = engine.preview(steps);
  assert(JSON.stringify(engine.state) === before, `preview of ${route} preserves state and refill RNG`);
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
    else assert(cell.behavior.passive && cell.color !== null && engine.state.customLevel!.paletteWeights[cell.color] > 0,
      'new tutorial enemies remain passive and use the current palette');
  }
  if (engine.state.phase === 'PLAYER_INPUT') assert(hasOrdinaryChain(engine.state), `route ${route} leaves an ordinary chain`);
  return forecast;
}

function authoredLayouts() {
  assert(TUTORIAL_LESSONS.length === 16, 'thirteen lessons, jailer and two branch encounters');
  const ids = ['chain', 'power', 'position', 'arrows', 'fire', 'crossroads'];
  TUTORIAL_LESSONS.slice(0, 6).forEach((lesson, number) => {
    assert(lesson.id === ids[number], `battle ${number + 1} keeps id ${ids[number]}`);
    const { definition } = lesson;
    const validation = validateCustomLevel(definition);
    assert(validation.valid, `${lesson.id} uses a valid custom-level definition: ${validation.errors.join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${lesson.id} is between 5×5 and 7×7`);
    assert(definition.enemies.every(enemy => enemy.color === 0 || enemy.color === 2), `${lesson.id} starts with red and blue enemies only`);
    assert(new Set(definition.enemies.map(enemy => enemy.color)).size === 2, `${lesson.id} starts with both colors`);
    assert(definition.paletteWeights.join() === '100,0,100,0,0', `${lesson.id} refills from the two-color palette`);
    assert(!lesson.allowedItems?.length && !lesson.allowedAbilities?.length && !lesson.initialEnergy, `${lesson.id} has no tools`);
    assert(definition.turnLimit === 0 && (definition.playerHp ?? 5) === 5, `${lesson.id} has 5 HP and no turn limit`);
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...(definition.devices ?? []).map(device => device.index)]);
    definition.terrain.forEach((terrain, cell) => {
      if (terrain !== 'wall') assert(cell === definition.heroIndex || occupied.has(cell), `${lesson.id} floor ${cell} is authored`);
      else assert(!occupied.has(cell), `${lesson.id} wall ${cell} is clear`);
    });
    const engine = start(number);
    const { state } = engine;
    assert(state.player.hp === 5 && state.player.maxHp === 5 && state.player.energy === 0, `${lesson.id} starts at 5 HP without energy`);
    assert(Object.values(state.inventory).every(amount => amount === 0), `${lesson.id} starts without consumables`);
    assert(state.board.every((cell, index) => !isWalkable(state, index) || index === state.player.index || !!cell
      || state.devices.some(device => device.index === index)), `${lesson.id} starts dense`);
    // Colors form connected groups: every colored enemy touches a chain-adjacent enemy of its own color.
    state.board.forEach((cell, index) => {
      if (!cell || cell.color === null) return;
      assert(state.board.some((other, near) => near !== index && other?.color === cell.color && chainAdjacent(state, index, near)),
        `${lesson.id} enemy at ${index} belongs to a same-color group`);
    });
    assert(hasOrdinaryChain(state), `${lesson.id} opens with an ordinary chain`);
  });
}

async function lessonOne() {
  const g = start(0);
  const diagonal = 'D2-D3-C4-B3-A2-A3-B4-C5';
  const forecast = preview(g, diagonal);
  assert(forecast.hits.map(hit => hit.availablePower).join() === '1,2,3,4,5,6,7,8', 'every weak goblin adds one power');
  assert(forecast.completesRoom, 'the diagonal red chain reaches eight defeats at once');
  assert(!preview(g, 'D2-D3-D4').valid, 'crossing from red to blue is rejected without spending a turn');
  const orthogonalOnly = g.availableMoves(16).filter(steps => steps.every((cell, n) => n === 0
    || cell % 5 === steps[n - 1] % 5 || Math.floor(cell / 5) === Math.floor(steps[n - 1] / 5)));
  assert(orthogonalOnly.every(steps => !g.preview(steps).completesRoom), 'no orthogonal-only chain wins: the lesson needs a diagonal step');
  await commit(g, diagonal);
  assert(g.state.phase === 'WIN' && g.state.objective.kills === 8 && g.state.player.hp === 5, 'lesson 1 won in one turn');

  const twoTurns = start(0);
  await commit(twoTurns, 'E2-E3-E4');
  assert(twoTurns.state.phase === 'PLAYER_INPUT' && twoTurns.state.objective.kills === 3, 'a short blue chain keeps the lesson going');
  await commit(twoTurns, 'D3-C4-B3-A2-A3');
  assert(twoTurns.state.phase === 'WIN', 'a second red chain with diagonals completes the goal');
}

async function lessonTwo() {
  const g = start(1);
  assert(g.state.board[at(g, 'C2')]?.hp === 3 && g.state.board[at(g, 'E2')]?.hp === 4, 'marked guards have authored HP');
  assert(g.state.board.every(cell => !cell || cell.behavior.passive), 'nobody is armed in lesson 2');
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
  assert(g.state.phase === 'WIN' && g.state.turn === 2, 'lesson 2 won in two turns');

  const wound = start(1);
  await commit(wound, 'B3-B2-C2');
  await commit(wound, 'D1-E1-E2');
  assert(wound.state.board[at(wound, 'E2')]?.hp === 1 && wound.state.objective.tutorialTargets === 1, 'the wound persists and is not a kill');
  await commit(wound, 'D1-E2');
  assert(wound.state.phase === 'WIN', 'the wounded guard is finished on the next turn');
}

async function lessonThree() {
  const g = start(2);
  assert(g.state.board.filter(cell => cell && !cell.behavior.passive).length === 4, 'two armed guards and two armed goblins');
  const greedy = preview(g, 'E5-E6-F5-F4-F3-F2');
  const longest = Math.max(...g.availableMoves(16).map(steps => g.preview(steps).kills));
  assert(greedy.kills === longest && greedy.damage === 2 && !greedy.playerDies,
    'the longest chain ends between the blue guard and an armed goblin: the forecast shows 2 damage');
  assert(preview(g, 'E5-E6-F5-F4-F3').damage === 0, 'stopping one step earlier is safe');
  const trap = start(2);
  await commit(trap, 'E5-E6-F5-F4-F3-F2');
  assert(trap.state.player.hp === 3 && trap.state.phase === 'PLAYER_INPUT', 'the greedy ending costs 2 HP but stays playable');

  const lane = preview(g, 'C5-B5-A4-A3-B2');
  assert(hitOn(g, lane, 'B2')?.killed && lane.hits.at(-1)?.remainingPower === 0 && lane.damage === 0,
    'four red goblins give exactly the 5 power for the red guard; its square is out of every strike');
  await commit(g, 'C5-B5-A4-A3-B2');
  await commit(g, 'B1-C2-D3-E2-F1');
  assert(g.state.phase === 'WIN' && g.state.turn === 2 && g.state.player.hp === 5, 'the authored blue lane finishes the second guard');
}

async function lessonFour() {
  const g = start(3);
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
  assert(g.state.phase === 'WIN' && g.state.player.hp === 5 && g.state.devices[0].charges === 1, 'lever lesson won in one turn');
  const hurt = start(3);
  await commit(hurt, 'A2-B2-C3-D3-C4-D5-C6-D6');
  assert(hurt.state.phase === 'WIN' && hurt.state.player.hp === 1, 'the forecast 4 damage from own arrows is executed');
}

async function lessonFive() {
  const g = start(4);
  const brazier = at(g, 'B4'), guard = at(g, 'C3');
  assert(g.state.devices.length === 1 && g.state.devices[0].kind === 'fire', 'one brazier');
  assert(g.availableMoves(16).every(steps => steps.includes(brazier) || !steps.includes(guard)), 'at the start the red guard is reachable only through the brazier');
  const burn = preview(g, 'A5-B5-B4-C3');
  const hit = hitOn(g, burn, 'C3')!;
  assert(!hit.killed && hit.hpAfter === 1 && hit.attackEffect === 'fire' && burn.endIndex === brazier && burn.damage === 0,
    'two goblins leave the guard at 1 HP with fire; the cat stops diagonally, out of both strikes');
  const overkill = preview(g, 'A5-B5-B6-C6-C5-B4-C3');
  assert(hitOn(g, overkill, 'C3')?.killed && overkill.damage === 1, 'more power kills the guard but leaves the cat next to the blue guard');
  await commit(g, 'A5-B5-B4-C3');
  assert(g.state.objective.tutorialTargets === 1 && g.state.player.hp === 5, 'fire finishes the guard at the end of the turn');
  assert(!g.state.player.attackEffect && g.state.devices[0].charges === 1, 'the brazier enchants only that chain');
  await commit(g, 'A4-A3-B2-C2-D3');
  assert(g.state.phase === 'WIN' && g.state.turn === 2 && g.state.player.hp === 5, 'the authored blue lane beside the brazier finishes lesson 5');

  const hurt = start(4);
  await commit(hurt, 'A5-B5-B6-C6-C5-B4-C3');
  assert(hurt.state.player.hp === 4 && hurt.state.objective.tutorialTargets === 1, 'overkill costs the forecast hit');
}

async function lessonSix() {
  const g = start(5);
  const palisade = ['A2', 'B2', 'C2', 'C1'].map(label => at(g, label));
  const gate = at(g, 'C3');
  assert(g.state.devices.map(device => device.kind).sort().join() === 'arrows,fire', 'lever and brazier');
  assert(g.availableMoves(16).every(steps => !steps.some(cell => palisade.includes(cell))), 'the palisade is out of reach on the first turn');
  const volley = 'G6-G5-G4-F3-E3-E4-E5-F5-F6', gateLane = 'E7-E6-E5-D5-D4-C3-C2-C1', last = 'B2-A2';
  // The solution rests on authored survivors and the cat's stop, not on refill colors: replay it on several refill streams.
  for (let k = 0; k < 5; k++) {
    const r = start(5), snapshot = r.captureAnalysisSnapshot();
    snapshot.rng = variantSeed(snapshot.rng, k); r.restoreAnalysisSnapshot(snapshot);
    await commit(r, volley);
    assert(r.state.player.index === at(r, 'F6') && r.state.board[at(r, 'A2')]?.hp === 5, `refill stream ${k}: first volley 9 → 5, cat on F6`);
    const moves = r.availableMoves(16);
    assert(moves.filter(steps => steps.some(cell => palisade.includes(cell))).every(steps => steps.includes(gate)), 'every way into the palisade passes the brazier');
    const hurt = preview(r, 'E7-E6-E5-D5-D4-C3-C2');
    assert(hurt.damage === 1 && hurt.endIndex === at(r, 'C2'), 'stopping on C2 next to the surviving red guard is forecast as a hit');
    const second = await commit(r, gateLane);
    assert(hitOn(r, second, 'C1')?.killed === true && r.state.player.index === at(r, 'C1') && r.state.board[at(r, 'A2')]?.hp === 1,
      `refill stream ${k}: second volley (5 → 1) and the red guard through the brazier gate`);
    await commit(r, last);
    assert(r.state.phase === 'WIN' && r.state.turn === 3 && r.state.player.hp === 5, `refill stream ${k}: lesson 6 won in three turns`);
  }
}

async function replayIsExact() {
  const routes: [number, string[]][] = [
    [1, ['B3-B2-C2', 'D1-E1-E2', 'D1-E2']],
    [4, ['A5-B5-B4-C3', 'A4-A3-B2-C2-D3']],
    [5, ['G6-G5-G4-F3-E3-E4-E5-F5-F6', 'E7-E6-E5-D5-D4-C3-C2-C1', 'B2-A2']],
  ];
  for (const [number, steps] of routes) {
    const runs = [start(number), start(number)];
    for (const engine of runs) for (const route of steps) await commit(engine, route);
    assert(JSON.stringify(runs[0].state) === JSON.stringify(runs[1].state), `lesson ${number + 1}: the same seed and actions give the same state`);
  }
}

async function restrictionsAndRepeat() {
  for (let number = 0; number < 6; number++) {
    const g = start(number), snapshot = JSON.stringify(g.state);
    g.state.player.energy = 20;
    for (const item of ['frost', 'bomb', 'healing', 'fire'] as ItemKind[]) {
      g.state.inventory[item] = 3;
      assert(!g.previewItem(item).valid && !g.useItem(item), `${item} stays locked in lesson ${number + 1}`);
    }
    assert(!g.setAbility('jump') && !g.previewAbility('jump').valid && !await g.useAbility('jump'), `jump stays locked in lesson ${number + 1}`);
    assert(!g.setAbility('spin') && !g.previewAbility('spin').valid && !await g.useAbility('spin'), `spin stays locked in lesson ${number + 1}`);
    g.restartLevel();
    assert(JSON.stringify(g.state) === snapshot, `lesson ${number + 1} retry restores exact opening`);
  }

  for (let number = 0; number < 2; number++) {
    const g = start(number);
    for (let turn = 0; turn < 5; turn++) {
      assert(await g.waitTurn(), `passive lesson ${number + 1} can advance turn ${turn + 1}`);
      assert(g.state.player.hp === 5, `trainees never injure the cat in lesson ${number + 1}`);
      assert(g.state.board.every(cell => !cell || cell.behavior.passive && !cell.behavior.aggressive), `trainees including refills remain passive on turn ${turn + 1}`);
    }
  }

  const interrupted = start(1), opening = JSON.stringify(interrupted.state);
  const stop = interrupted.subscribe((_state, event) => { if (event.type === 'hit') interrupted.restartLevel(); });
  const steps = path(interrupted, 'B3-B2-C2');
  assert(interrupted.beginChain(steps[0]) && interrupted.extendChain(steps[1]) && interrupted.extendChain(steps[2]), 'interrupted route is selected');
  assert(!await interrupted.releaseChain(), 'restart cancels the stale resolving turn');
  stop();
  assert(JSON.stringify(interrupted.state) === opening, 'hit-time restart restores every authored entity and target');

  const progressed = start(0);
  await commit(progressed, 'D2-D3-C4-B3-A2-A3-B4-C5');
  assert(progressed.nextTutorial(), 'completed lesson advances to the second');
  assert(progressed.state.tutorial?.index === 1 && progressed.state.player.hp === 5 && progressed.state.turn === 0, 'next lesson starts fresh');
}

async function alternateEndpointsStayPlayable() {
  for (let number = 0; number < 6; number++) {
    const sample = start(number);
    const byEnd = new Map<number, number[]>();
    for (const steps of sample.availableMoves(4)) {
      const forecast = sample.preview(steps);
      if (forecast.damage < sample.state.player.hp && !byEnd.has(forecast.endIndex)) byEnd.set(forecast.endIndex, steps);
    }
    assert(byEnd.size >= 3, `lesson ${number + 1} offers varied first endpoints`);
    for (const [endpoint, steps] of byEnd) {
      const g = start(number);
      await commit(g, steps.map(cell => String.fromCharCode(65 + cell % g.state.cols) + (Math.floor(cell / g.state.cols) + 1)).join('-'));
      assert(g.state.phase === 'WIN' || g.state.phase === 'PLAYER_INPUT' && g.availableMoves(4).length > 0,
        `lesson ${number + 1} endpoint ${endpoint} remains playable after random refill`);
    }
  }
}

async function run() {
  authoredLayouts();
  await lessonOne(); await lessonTwo(); await lessonThree();
  await lessonFour(); await lessonFive(); await lessonSix();
  await replayIsExact(); await restrictionsAndRepeat(); await alternateEndpointsStayPlayable();
  console.log('PASS battles 1–6: authored two-color layouts, verified routes, forecast traps, exact replay, locked tools, playable endpoints');
}

run().catch(error => { throw error; });
