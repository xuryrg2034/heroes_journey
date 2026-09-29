import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';
import { isWalkable } from './forestSystems';
import type { ItemKind } from './forestTypes';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function index(label: string, cols: number): number {
  return (Number(label.slice(1)) - 1) * cols + label.charCodeAt(0) - 65;
}

function route(cols: number, ...labels: string[]): number[] { return labels.map(label => index(label, cols)); }

async function commit(engine: ForestEngine, path: number[]) {
  const before = JSON.stringify(engine.state);
  const colors = new Map(engine.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const forecast = engine.preview(path);
  assert(JSON.stringify(engine.state) === before, 'preview preserves state and refill RNG');
  assert(forecast.valid, `route ${path.join(',')} valid: ${forecast.reason}`);
  assert(engine.beginChain(path[0]), `route starts at ${path[0]}`);
  for (const step of path.slice(1)) assert(engine.extendChain(step), `route extends to ${step}`);
  assert(await engine.releaseChain(), `route ${path.join(',')} resolves`);
  assert(engine.state.lastDamage === forecast.damage, 'preview matches incoming damage');
  for (const cell of engine.state.board) {
    if (!cell) continue;
    if (colors.has(cell.id)) assert(cell.color === colors.get(cell.id), 'survivors keep their colors');
    else assert(cell.behavior.passive && cell.color !== null && engine.state.customLevel!.paletteWeights[cell.color] > 0,
      'new tutorial enemies remain passive and use the current palette');
  }
}

function start(number: number): ForestEngine {
  const engine = new ForestEngine(); engine.animationScale = 0;
  assert(engine.startTutorial(number), `lesson ${number + 1} starts`);
  return engine;
}

function authoredLayouts() {
  assert(TUTORIAL_LESSONS.length === 16, 'thirteen lessons, jailer and two branch encounters');
  for (const lesson of TUTORIAL_LESSONS.slice(0, 6)) {
    const { definition } = lesson;
    const validation = validateCustomLevel(definition);
    assert(validation.valid, `${lesson.id} uses a valid custom-level definition: ${validation.errors.join(' ')}`);
    const colors = new Set(definition.enemies.map(enemy => enemy.color));
    assert(colors.size === 2 && colors.has(0) && colors.has(2), `${lesson.id} starts with both red and blue enemies`);
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...(definition.devices ?? []).map(device => device.index)]);
    definition.terrain.forEach((terrain, cell) => {
      if (terrain === 'floor') assert(cell === definition.heroIndex || occupied.has(cell), `${lesson.id} floor ${cell} is authored`);
      else assert(!occupied.has(cell), `${lesson.id} wall ${cell} is clear`);
    });
    const engine = start(TUTORIAL_LESSONS.indexOf(lesson));
    assert(engine.state.player.hp === 5 && engine.state.player.maxHp === 5, `${lesson.id} starts at 5 HP`);
    assert(Object.values(engine.state.inventory).every(amount => amount === 0), `${lesson.id} starts without consumables`);
    assert(engine.state.board.every((cell, cellIndex) => !isWalkable(engine.state, cellIndex) ||
      cellIndex === engine.state.player.index ? true : !!cell || !!engine.state.devices?.some(device => device.index === cellIndex)), `${lesson.id} starts dense`);
  }
  for (const number of [1, 2]) {
    const lesson = TUTORIAL_LESSONS[number];
    const targets = lesson.targetIndices.map(target => lesson.definition.enemies.find(enemy => enemy.index === target));
    assert(targets.length === 2 && targets.every(Boolean), `${lesson.id} has two present marked targets`);
    assert(new Set(targets.map(target => target!.color)).size === 2, `${lesson.id} marks one guard of each color`);
  }
}

async function lessonOne() {
  const g = start(0);
  const red = route(5, 'B4', 'C4', 'C3');
  assert(g.preview(red).hits.map(hit => hit.availablePower).join() === '1,2,3', 'first chain accumulates one power per weak target');
  assert(!g.preview(route(5, 'B4', 'C4', 'D4')).valid, 'crossing from red to blue is rejected without spending a turn');
  await commit(g, red);
  assert(g.state.player.index === index('C3', 5) && g.state.objective.kills === 3, 'red opening kills three');
  assert(!g.preview(route(5, 'D3', 'E2', 'D1')).valid, 'independent final pair cannot extend the blue chain');
  await commit(g, route(5, 'D3', 'E2'));
  assert(g.state.objective.kills === 5 && g.state.phase === 'PLAYER_INPUT', 'blue diagonal chain teaches second color');
  await commit(g, route(5, 'D1', 'E1'));
  assert(g.state.phase === 'WIN' && g.state.objective.kills >= 7, 'independent red pair reaches seven-kill goal');
}

async function lessonTwo() {
  const g = start(1);
  const redGuard = index('C3', 5), blueGuard = index('E2', 5);
  assert(g.state.board[redGuard]?.hp === 3 && g.state.board[blueGuard]?.hp === 4, 'marked guards have authored HP');
  const red = route(5, 'B4', 'C4', 'C3');
  assert(g.preview(red).hits.map(hit => hit.availablePower).join() === '1,2,3', 'first guard dies on third hit');
  await commit(g, red);
  assert(g.state.phase === 'PLAYER_INPUT' && g.state.objective.tutorialTargets === 1, 'first marked guard advances objective');
  const blue = route(5, 'D4', 'E4', 'E3', 'E2');
  assert(g.preview(blue).hits.map(hit => hit.availablePower).join() === '1,2,3,4', 'second guard dies on fourth hit');
  await commit(g, blue);
  assert(g.state.phase === 'WIN' && g.state.objective.tutorialTargets === 2, 'both guard IDs complete the lesson');
}

async function lessonThree() {
  const g = start(2);
  const safe = route(6, 'B4', 'C4');
  const unsafe = route(6, 'B4', 'C4', 'D4');
  assert(g.state.board[index('D3', 6)]?.hp === 3 && g.state.board[index('E2', 6)]?.hp === 3, 'two armed marked guards start at 3 HP');
  assert(g.preview(safe).valid && g.preview(safe).damage === 0 && g.preview(safe).endIndex === index('C4', 6), 'diagonal endpoint is safe');
  assert(g.preview(unsafe).valid && g.preview(unsafe).damage === 1 && g.preview(unsafe).endIndex === index('D4', 6), 'cardinal endpoint takes one hit');
  await commit(g, safe);
  assert(g.state.player.hp === 5 && g.state.player.index === index('C4', 6), 'safe route preserves HP');
  await commit(g, route(6, 'B3', 'C3', 'D3'));
  assert(g.state.objective.tutorialTargets === 1 && g.state.player.hp === 5, 'built-up red chain removes first threat');
  await commit(g, route(6, 'E3', 'F3', 'E2'));
  assert(g.state.phase === 'WIN' && g.state.objective.tutorialTargets === 2 && g.state.player.hp === 5, 'blue chain removes second threat without injury');
}

async function alternativeRoutes() {
  const two = start(1);
  await commit(two, route(5, 'B4', 'C4', 'C3'));
  const short = route(5, 'D3', 'E2');
  assert(two.preview(short).valid && two.preview(short).endIndex === index('D3', 5), 'short approach stops before surviving guard');
  await commit(two, short);
  assert(two.state.board[index('E2', 5)]?.hp === 2 && two.state.objective.tutorialTargets === 1, 'wound persists and does not count as marked kill');
  assert(two.state.phase === 'PLAYER_INPUT', 'short approach remains playable');
  await commit(two, route(5, 'D2', 'E2'));
  assert(two.state.phase === 'WIN' && two.state.objective.tutorialTargets === 2, 'wounded guard can be finished on a second approach');

  const three = start(2);
  await commit(three, route(6, 'B4', 'C4', 'D4'));
  assert(three.state.player.hp === 4 && three.state.phase === 'PLAYER_INPUT', 'unsafe route hurts but is recoverable');
  assert(three.availableMoves().length > 0, 'unsafe endpoint still offers a move');
  await commit(three, route(6, 'C3', 'B3', 'C2', 'D3'));
  await commit(three, route(6, 'E3', 'F3', 'E2'));
  assert(three.state.phase === 'WIN' && three.state.player.hp === 4, 'unsafe opening can still finish both marked guards');
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
  const path = route(5, 'B4', 'C4', 'C3');
  assert(interrupted.beginChain(path[0]) && interrupted.extendChain(path[1]) && interrupted.extendChain(path[2]), 'interrupted route is selected');
  assert(!await interrupted.releaseChain(), 'restart cancels the stale resolving turn');
  stop();
  assert(JSON.stringify(interrupted.state) === opening, 'hit-time restart restores every authored entity and target');

  const progressed = start(0);
  await commit(progressed, route(5, 'B4', 'C4', 'C3'));
  await commit(progressed, route(5, 'D3', 'E2'));
  await commit(progressed, route(5, 'D1', 'E1'));
  assert(progressed.nextTutorial(), 'completed lesson advances to the second');
  assert(progressed.state.tutorial?.index === 1 && progressed.state.player.hp === 5 && progressed.state.turn === 0, 'next lesson starts fresh');
}

async function alternateEndpointsStayPlayable() {
  for (let number = 0; number < 6; number++) {
    const sample = start(number);
    const byEnd = new Map<number, number[]>();
    for (const path of sample.availableMoves(4)) {
      const preview = sample.preview(path);
      if (preview.damage < sample.state.player.hp && !byEnd.has(preview.endIndex)) byEnd.set(preview.endIndex, path);
    }
    assert(byEnd.size >= 3, `lesson ${number + 1} offers varied first endpoints`);
    for (const [endpoint, path] of byEnd) {
      const g = start(number);
      await commit(g, path);
      assert(g.state.phase === 'WIN' || g.state.phase === 'PLAYER_INPUT' && g.availableMoves(4).length > 0,
        `lesson ${number + 1} endpoint ${endpoint} remains playable after random refill`);
    }
  }
}


async function trailEncounters() {
  const arrows = start(3);
  const first = route(6, 'B4', 'C4', 'D4');
  const prediction = arrows.preview(first);
  assert(prediction.valid && prediction.enemies === 2 && prediction.power === 2, 'lever preserves color and adds no power');
  await commit(arrows, first);
  assert(arrows.state.board[index('E2', 6)]?.hp === 4 && arrows.state.player.hp === 5, 'lever softens the marked guard and safe endpoint preserves health');
  assert(arrows.state.devices?.[0].charges === 1, 'lever charge consumed once');
  await commit(arrows, route(6, 'E4', 'F4', 'F3', 'E2'));
  assert(arrows.state.phase === 'WIN', 'arrow encounter completed with ordinary follow-up');

  const secondLever = start(3);
  await commit(secondLever, first);
  await commit(secondLever, route(6, 'C3', 'B3', 'C4'));
  assert(secondLever.state.phase === 'WIN' && secondLever.state.devices[0].charges === 0, 'returning to the lever is a valid alternative to the blue finish');

  const fire = start(4);
  await commit(fire, route(6, 'B4', 'C4', 'D3'));
  assert(fire.state.objective.tutorialTargets === 1 && fire.state.player.hp === 5, 'first guardian dies to fire after surviving physical hit');
  assert(!fire.state.player.attackEffect, 'brazier does not permanently enchant the player');
  await commit(fire, route(6, 'D4', 'E4'));
  await commit(fire, route(6, 'D4', 'C3', 'C4', 'D3', 'E2'));
  assert(fire.state.phase === 'WIN' && fire.state.player.hp === 5, 'second brazier approach applies lesson independently');

  const combined = start(5);
  await commit(combined, route(7, 'B5', 'C5', 'D5'));
  assert(combined.state.board[index('D2', 7)]?.hp === 4, 'combined trap wounds distant red guard');
  await commit(combined, route(7, 'E5', 'F5', 'E4', 'F3'));
  assert(combined.state.objective.tutorialTargets === 1, 'combined fire removes blue guard');
  await commit(combined, route(7, 'D4', 'D3', 'C3', 'D2'));
  assert(combined.state.phase === 'WIN' && combined.state.player.hp === 5, 'combined encounter won safely');

  // Direct force is a valid alternative, not an obligatory device tutorial script.
  const direct = start(4);
  await commit(direct, route(6, 'B4', 'C4', 'D3'));
  await commit(direct, route(6, 'D4', 'E4', 'F4', 'F3', 'E2'));
  assert(direct.state.phase === 'WIN' && direct.state.devices?.[0].charges === 1, 'second guard can be defeated without consuming another brazier charge');
}

async function run() {
  authoredLayouts();
  await lessonOne(); await lessonTwo(); await lessonThree(); await alternativeRoutes();
  await trailEncounters();
  await restrictionsAndRepeat(); await alternateEndpointsStayPlayable();
  console.log('PASS authored tutorial maps, mixed-color routes, marked objectives, safe and unsafe endings, repeatability, alternate endpoints');
}

run().catch(error => { throw error; });
