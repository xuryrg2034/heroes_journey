import { shieldIsActive } from './combatRules';
import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { variantSeed } from './levelAnalysis';
import { TUTORIAL_LESSONS } from './tutorialLevels';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
/** UI label (column letter, row from 1) to a board index of the running battle. */
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const route = (g: ForestEngine, ...labels: string[]) => labels.map(label => at(g, label));
const boss = (g: ForestEngine) => g.state.board.find(cell => cell?.kind === 'boss');
function start(number: number, refillSeed = 0) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startTutorial(number - 1), `lesson ${number} starts directly`);
  // Same seed substitution as the level analyzer: the authored start stays, only later refills change.
  if (refillSeed) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, refillSeed); g.restoreAnalysisSnapshot(snap); }
  return g;
}
async function commit(g: ForestEngine, ...labels: string[]) {
  const path = route(g, ...labels), before = JSON.stringify(g.state), hp = g.state.player.hp;
  const existingColors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const prediction = g.preview(path);
  assert(JSON.stringify(g.state) === before, 'preview preserves the whole state');
  assert(prediction.valid, `${labels.join(' → ')}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), 'chain starts');
  for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
  assert(await g.releaseChain(), 'chain commits');
  for (const cell of g.state.board) {
    if (!cell || cell.kind !== 'melee') continue;
    if (existingColors.has(cell.id)) assert(cell.color === existingColors.get(cell.id), 'surviving enemies retain their color');
    else if (cell.behavior.passive) assert(cell.color !== null && g.state.customLevel!.paletteWeights[cell.color] > 0, 'new ordinary enemies use the active palette');
  }
  assert(g.state.lastDamage === prediction.damage && g.state.player.hp === hp - prediction.damage, 'incoming damage matches forecast');
  assert(g.state.player.index === prediction.endIndex, 'endpoint matches forecast');
  assert((g.state.phase === 'LOSE') === !!prediction.playerDies, 'death matches forecast');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'completion matches forecast');
  return prediction;
}
async function jump(g: ForestEngine, label: string) {
  const before = JSON.stringify(g.state), hp = g.state.player.hp, energy = g.state.player.energy;
  const prediction = g.previewAbility('jump', at(g, label));
  assert(JSON.stringify(g.state) === before && prediction.valid, `pure valid jump ${label}: ${prediction.reason}`);
  assert(await g.useAbility('jump', at(g, label)), 'earned jump commits');
  assert(g.state.player.energy === energy - 2 && g.state.player.hp === hp - prediction.damage, 'jump resources match forecast');
  assert(g.state.lastDamage === prediction.damage && g.state.player.index === prediction.endIndex, 'jump damage and endpoint match');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'jump completion matches');
}
function won(g: ForestEngine, hp: number) {
  assert(g.state.phase === 'WIN' && g.state.player.hp === hp, `victory with ${hp} HP, got ${g.state.phase} ${g.state.player.hp}`);
}
function layouts() {
  assert(TUTORIAL_LESSONS.length === 16, 'thirteen lessons, finale, two branches');
  const sizes: Record<number, string> = { 14: '7x6', 15: '5x7', 16: '6x7' };
  for (let number = 14; number <= 16; number++) {
    const lesson = TUTORIAL_LESSONS[number - 1], { definition } = lesson, validation = validateCustomLevel(definition);
    assert(validation.valid, `lesson ${number}: ${validation.errors.join(' ')}`);
    assert(`${definition.cols}x${definition.rows}` === sizes[number], `lesson ${number} keeps its own field shape`);
    assert(new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color])).size === 5, 'five authored ordinary colors');
    assert(definition.paletteWeights.every(weight => weight > 0), 'refill uses all five colors');
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.doors.map(door => door.index), definition.heroIndex]);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain !== 'wall'), 'every walkable square has authored content'));
    const g = start(number);
    assert(g.state.player.hp === 5 && g.state.player.energy === 0, 'standard HP and no free energy');
    assert(Object.values(g.state.inventory).every(amount => amount === 0), 'no free consumables');
    assert(!g.previewAbility('jump', g.state.player.index - g.state.cols).valid, 'jump must be earned');
    assert(lesson.allowedAbilities?.join() === 'jump' && lesson.allowedItems?.join() === 'frost', 'earned capabilities persist');
    assert(!g.startTutorialChoice(14), 'branch cannot be selected before victory');
  }
  assert(TUTORIAL_LESSONS[13].nextLessonIndices?.join() === '14,15', 'the Jailer forks into both branches');
  assert(TUTORIAL_LESSONS[14].nextLessonIndices?.length === 0 && TUTORIAL_LESSONS[15].nextLessonIndices?.length === 0, 'both branches end the chapter');
}

/** No chain reaches the Jailer with 14 power on the opening board: flank fuel is short, the shield blocks the pool. */
function jailerOpeningCap() {
  const g = start(14), jailerIndex = at(g, 'D1'), hp = boss(g)!.hp;
  const reaching = g.availableMoves().filter(path => path.at(-1) === jailerIndex);
  assert(reaching.length > 0, 'the flank is reachable on the first turn');
  for (const path of reaching) {
    const hit = g.preview(path).hits.at(-1)!;
    assert(hit.index === jailerIndex && hit.hpAfter > 0 && hp - hit.hpAfter <= 5, 'no first chain can kill or badly wound the Jailer');
  }
  assert(!g.preview(route(g, 'E3', 'E2', 'D1')).valid, 'the shield blocks the pool below');
}

/** 14: right flank, the pool from below in the rest window, then the left flank finishes with a chain. */
async function jailer(g: ForestEngine) {
  assert(shieldIsActive(boss(g)!), 'Jailer starts shielded');
  const flank = await commit(g, 'F3', 'F2', 'E1', 'D1');
  assert(flank.damage === 0 && boss(g)!.hp === 10, 'the flank strike is safe: the heavy blow was aimed below');
  assert(!shieldIsActive(boss(g)!) && boss(g)!.behavior.restTurns === 1, 'a missed heavy strike still lowers the shield for a turn');
  await commit(g, 'E2', 'E3', 'D2', 'C3', 'B3', 'C2', 'D1');
  assert(boss(g)!.hp === 3 && shieldIsActive(boss(g)!), 'the pool from below lands in the rest window; the shield returns');
  assert(boss(g)!.intent.cells.includes(g.state.player.index) && boss(g)!.intent.damage === 2, 'the next heavy strike is aimed at the cat below');
  const finish = await commit(g, 'B1', 'C1', 'D1'); won(g, 5);
  assert(finish.completesRoom && g.state.player.energy >= 2, 'a side chain finishes the Jailer; the earned jump stays unused');
  assert(g.state.objective.tutorialTargets === 1 && g.state.objective.bossKills === 1, 'the Jailer is the only required target');
}
/** 14, alternative: after the same two turns the earned jump also finishes (it ignores the shield). */
async function jailerJump(g: ForestEngine) {
  await commit(g, 'F3', 'G2', 'F2', 'E1', 'D1');
  await commit(g, 'E2', 'E3', 'D2', 'C3', 'B3', 'C2', 'D1');
  assert(boss(g)!.hp === 2, 'the longer flank leaves two HP');
  await jump(g, 'D1'); won(g, 5);
}
/** 14, trap: eating the pool while the shield is up wastes the rest window. */
async function poolTooEarly(g: ForestEngine) {
  await commit(g, 'E3', 'E2', 'D2', 'C2', 'B3', 'C3');
  assert(boss(g)!.hp === 14 && !shieldIsActive(boss(g)!), 'the Jailer is untouched although its shield is down now');
  const reaching = g.availableMoves().filter(path => path.at(-1) === at(g, 'D1')).map(path => 14 - g.preview(path).hits.at(-1)!.hpAfter);
  assert(Math.max(0, ...reaching) < 7, 'with the lesson seed the window no longer offers the pool damage');
}

async function escape(g: ForestEngine) {
  const door = g.state.board[at(g, 'C1')]!;
  assert(g.state.tutorial!.targetIds.length === 0 && door.kind === 'door', 'exit branch has no kill target');
  assert(door.intent.label === 'Выполни цели', 'the gate is closed on the first turn');
  await commit(g, 'D6', 'C5', 'D5', 'C4');
  assert(g.state.phase === 'PLAYER_INPUT' && g.state.objective.turns === 1, 'opening the gate does not itself win');
  assert(g.state.board[at(g, 'C1')]!.intent.label === 'Выход открыт', 'the gate opens after the first turn');
  // The archer's opening line B4–B6 kills those goblins; their refill colors depend on the seed, so the route avoids them.
  const exit = await commit(g, 'C3', 'D3', 'D2', 'D1', 'C1'); won(g, 5);
  assert(exit.opensDoor === at(g, 'C1') && g.state.player.index === at(g, 'C1'), 'the cat actually crosses the exit');
  assert(g.state.board.some(cell => cell?.kind === 'melee' && cell.hp === 3), 'the optional gate guard survives');
}

/** 16: the longer red branch kills both announced goblins, wounds the bell, and a short chain finishes it. */
async function beacon(g: ForestEngine) {
  const events: string[] = []; const unsubscribe = g.subscribe((_state, event) => events.push(event.type));
  await commit(g, 'E7', 'E6', 'E5', 'E4', 'E3');
  const planned = [...(boss(g)!.intent.summonCells ?? [])], ids = [...boss(g)!.intent.summonIds!];
  assert(planned.join() === route(g, 'B1', 'C1').join(), 'the bell announces B1 and C1, the first calm goblins in board order');
  await commit(g, 'D3', 'C3', 'B2', 'C1', 'B1', 'A1');
  assert(boss(g)!.hp === 2 && !events.includes('special-arrival'), 'killing the announced goblins cancels the summon');
  assert(!g.state.board.some(cell => cell && ids.includes(cell.id)), 'announced IDs are gone; new occupants are not reinforcements');
  assert(g.state.board.every(cell => !cell || cell.kind !== 'melee' || cell.behavior.passive), 'no armed goblin appears');
  await commit(g, 'B2', 'A1'); unsubscribe(); won(g, 5);
  assert(!boss(g), 'a chain through the second gate silences the bell');
}
/** 16, the other choice: the short branch leaves the announced goblins, which arm next to the cat. */
async function acceptTheBlow(g: ForestEngine) {
  await commit(g, 'E7', 'E6', 'E5', 'E4', 'E3');
  let arrivals = 0; g.subscribe((_state, event) => { if (event.type === 'special-arrival') arrivals++; });
  await commit(g, 'D3', 'C3', 'B2', 'A1');
  const guard = g.state.board[at(g, 'B1')]!;
  assert(boss(g)!.hp === 4 && arrivals === 2 && guard.behavior.aggressive && !guard.behavior.passive, 'both announced goblins arm');
  assert(guard.intent.cells.includes(g.state.player.index), 'the armed B1 threatens the cat standing in the gate B2');
  const finishes = g.availableMoves().filter(path => path.at(-1) === at(g, 'A1')).map(path => g.preview(path).hits.at(-1)!.hpAfter);
  assert(finishes.length > 0 && finishes.every(hp => hp > 0), 'no chain can silence the bell this turn');
  const snapshot = g.captureAnalysisSnapshot();
  assert(await g.waitTurn() && g.state.player.hp === 4, 'staying costs the reinforcement blow');
  g.restoreAnalysisSnapshot(snapshot);
  await jump(g, 'A1'); won(g, 5);
}

async function refillIndependence() {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const [number, play] of [[14, jailer], [14, jailerJump], [15, escape], [16, beacon], [16, acceptTheBlow]] as const) await play(start(number, seed));
  }
}
async function replay(number: number, play: (g: ForestEngine) => Promise<void>) {
  const g = start(number), initial = JSON.stringify(g.state);
  await play(g); const final = JSON.stringify(g.state);
  g.restartLevel(); assert(JSON.stringify(g.state) === initial, 'restart restores authored initial state exactly');
  await play(g); assert(JSON.stringify(g.state) === final, 'real replay reproduces HP, IDs, refill, intents and result');
  return g;
}
async function main() {
  layouts();
  jailerOpeningCap();
  const first = await replay(14, jailer); await replay(14, jailerJump); await replay(14, poolTooEarly);
  assert(!first.nextTutorial() && !first.startTutorialChoice(0), 'fork needs an allowed explicit choice');
  assert(first.startTutorialChoice(14) && first.state.tutorial!.index === 14, 'first branch starts the exit battle');
  await escape(first); assert(!first.nextTutorial() && !first.startTutorialChoice(15), 'exit branch does not force the bell battle');
  const second = start(14); await jailer(second);
  assert(second.startTutorialChoice(15) && second.state.tutorial!.index === 15, 'second branch starts the bell battle');
  await beacon(second); assert(!second.nextTutorial() && !second.startTutorialChoice(14), 'bell branch does not force the exit battle');
  await replay(15, escape); await replay(16, beacon); await replay(16, acceptTheBlow);
  await refillIndependence();
  console.log('PASS chapter finale: opening cap, shield/rest window, pool trap, chain finish from the other flank, jump alternative, true exit, bell summon cancelled or accepted, branches, refill seeds, pure forecast and exact replay');
}
main().catch(error => { console.error(error); throw error; });
