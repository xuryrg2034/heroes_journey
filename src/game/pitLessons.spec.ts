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
function start(number: number, refillSeed = 0) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startTutorial(number - 1), `lesson ${number} starts`);
  // Same seed substitution as the level analyzer: the authored start stays, only later refills change.
  if (refillSeed) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, refillSeed); g.restoreAnalysisSnapshot(snap); }
  return g;
}
async function commit(g: ForestEngine, ...labels: string[]) {
  const path = route(g, ...labels), before = JSON.stringify(g.state), hp = g.state.player.hp;
  const existingColors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const prediction = g.preview(path);
  assert(JSON.stringify(g.state) === before, 'preview leaves the state unchanged');
  assert(prediction.valid, `${labels.join(' → ')}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), 'chain starts');
  for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
  assert(await g.releaseChain(), 'chain commits');
  for (const cell of g.state.board) {
    if (!cell || cell.kind !== 'melee') continue;
    if (existingColors.has(cell.id)) assert(cell.color === existingColors.get(cell.id), 'surviving enemies retain their color');
    else if (cell.behavior.passive) assert(cell.color !== null && g.state.customLevel!.paletteWeights[cell.color] > 0, 'new ordinary enemies use the active palette');
  }
  assert(g.state.lastDamage === prediction.damage, 'incoming damage matches preview');
  assert(g.state.player.hp === hp - prediction.damage, 'remaining HP matches preview');
  assert(g.state.player.index === prediction.endIndex, 'endpoint matches preview');
  assert((g.state.phase === 'LOSE') === !!prediction.playerDies, 'death matches preview');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'victory matches preview');
  return prediction;
}
async function jump(g: ForestEngine, label: string) {
  const before = JSON.stringify(g.state), energy = g.state.player.energy, prediction = g.previewAbility('jump', at(g, label));
  assert(JSON.stringify(g.state) === before && prediction.valid, `pure valid jump ${label}: ${prediction.reason}`);
  assert(await g.useAbility('jump', at(g, label)), 'earned jump commits');
  assert(g.state.player.energy === energy - 2 && g.state.player.index === prediction.endIndex && g.state.lastDamage === prediction.damage, 'jump matches its forecast');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'jump victory matches its forecast');
}
function won(g: ForestEngine, hp: number) {
  assert(g.state.phase === 'WIN' && g.state.objective.tutorialTargets === 2, 'both original marked IDs complete the battle');
  assert(g.state.player.hp === hp, `route finishes with ${hp} HP, got ${g.state.player.hp}`);
}
function openAt(g: ForestEngine, ...labels: string[]) {
  assert(g.state.pits.map(pit => pit.index).sort((a, b) => a - b).join() === route(g, ...labels).sort((a, b) => a - b).join(), 'only the authored hatches open');
  assert(g.state.pits.every(pit => g.state.board[pit.index] === null), 'open holes stay empty through the refill');
}
function closedAndRefilled(g: ForestEngine, ...labels: string[]) {
  assert(g.state.pits.length === 0, 'hatches close after the following turn');
  assert(route(g, ...labels).every(cell => g.state.board[cell]), 'closed hatches are refilled');
}
function layouts() {
  const expected: Record<number, { colors: number; size: string }> = { 11: { colors: 3, size: '7x5' }, 12: { colors: 4, size: '6x6' }, 13: { colors: 4, size: '7x6' } };
  for (let number = 11; number <= 13; number++) {
    const lesson = TUTORIAL_LESSONS[number - 1], { definition } = lesson;
    assert(validateCustomLevel(definition).valid, `lesson ${number} validates`);
    assert(`${definition.cols}x${definition.rows}` === expected[number].size, `lesson ${number} keeps its own field shape`);
    const colors = new Set(definition.enemies.map(enemy => enemy.color));
    assert(colors.size === expected[number].colors, 'authored board follows the campaign palette');
    assert(definition.paletteWeights.filter(weight => weight > 0).length === expected[number].colors, 'refill palette matches the battle number');
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.devices!.map(device => device.index), definition.heroIndex]);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain !== 'wall'), 'every walkable square has authored content'));
    const g = start(number);
    assert(g.state.player.hp === 5 && g.state.player.energy === 0, 'no free HP or energy');
    assert(Object.values(g.state.inventory).every(amount => amount === 0), 'no free consumables');
    assert(g.state.tutorial!.targetIds.length === 2 && g.state.pits.length === 0, 'two marked IDs and initially closed hatches');
    assert(lesson.allowedAbilities?.join() === 'jump' && lesson.allowedItems?.join() === 'frost', 'previously unlocked capabilities remain available');
  }
}

/** 11: kill the near guard, then cross the hatches through the lever and stop beyond them. */
async function crossing(g: ForestEngine) {
  const unsafe = g.preview(route(g, 'B3', 'C3', 'D3'));
  assert(unsafe.valid && unsafe.playerDies && !unsafe.completesRoom, 'ending on a hatch predicts a lethal fall');
  await commit(g, 'B2', 'B1', 'C1', 'C2');
  assert(g.state.objective.tutorialTargets === 1, 'near guard falls first');
  const cross = await commit(g, 'B3', 'C3', 'D3', 'E3', 'F3');
  assert([...cross.pitCells ?? []].sort((a, b) => a - b).join() === route(g, 'D2', 'D3', 'D4').join() && !cross.playerDies, 'crossing through the lever is safe and opens the hatches behind the cat');
  won(g, 5);
}

/** 11, other order: crossing first leaves the cat on the far bank while the hatches are open. */
async function crossFirst(g: ForestEngine) {
  await commit(g, 'B3', 'C3', 'D3', 'E3', 'F3');
  openAt(g, 'D2', 'D3', 'D4');
  assert(g.state.objective.tutorialTargets === 1, 'one guard does not win the battle');
  assert(!g.preview(route(g, 'E3', 'D3')).valid, 'open hatch cannot be traversed');
  assert(!g.previewAbility('jump', at(g, 'D3')).valid, 'jump cannot land in a hole');
  await commit(g, 'G3', 'G4');
  closedAndRefilled(g, 'D2', 'D3', 'D4');
  await commit(g, 'F4', 'E4', 'E3', 'D2', 'C2');
  won(g, 5);
}

/** 12: pull the lever while crossing; the fallen guard frees the far bank. */
async function choice(g: ForestEngine) {
  const guardId = g.state.board[at(g, 'C4')]!.id;
  const first = await commit(g, 'C2', 'D2', 'D3', 'D4', 'C5');
  assert(first.trapKills! >= 1 && !g.state.board.some(cell => cell?.id === guardId), 'the strong guard falls through the hatch');
  assert(first.damage === 1 && g.state.objective.tutorialTargets === 1, 'the short path costs one hit from the escort and does not win yet');
  openAt(g, 'B4', 'C4', 'D4', 'E4');
  assert(!g.preview(route(g, 'D5', 'D4')).valid, 'the moat is closed to chains for one turn');
  await commit(g, 'C6', 'D5', 'E5', 'E6', 'D6');
  won(g, 4);
}

/** 12, trap: pulling the lever on the near bank strands the cat for the open turn. */
async function stranded(g: ForestEngine) {
  const guardId = g.state.board[at(g, 'C4')]!.id;
  await commit(g, 'D1', 'D2', 'D3', 'C2', 'B3', 'A2');
  openAt(g, 'B4', 'C4', 'D4', 'E4');
  assert(g.state.objective.tutorialTargets === 1, 'dropped guard counts, the far guard remains');
  assert(!g.previewAbility('jump', at(g, 'C4')).valid, 'jump cannot land in the open moat');
  await commit(g, 'A1', 'B1', 'B2');
  closedAndRefilled(g, 'B4', 'C4', 'D4', 'E4');
  assert(g.state.board[at(g, 'C4')]!.id !== guardId && g.state.objective.tutorialTargets === 1, 'refill does not restore the marked objective');
  await commit(g, 'C3', 'D4', 'D5', 'D6');
  won(g, 5);
}

/** 12, alternative: a blue chain ends on the lever itself and earns a jump over the open moat. */
async function leapOverMoat(g: ForestEngine) {
  await commit(g, 'B1', 'A1', 'B2', 'C3', 'D3');
  assert(g.state.player.energy === 2 && g.state.player.index === at(g, 'D3'), 'the lever square is a safe endpoint');
  await jump(g, 'D6');
  won(g, 5);
}

/** 13: drop the lever guard, burn the dead-end guard, finish it with the earned jump. */
async function embers(g: ForestEngine) {
  const lethal = g.preview(route(g, 'F2', 'F3', 'E3', 'D3'));
  assert(lethal.valid && lethal.playerDies, 'stopping on the D3 hatch is forecast as a fall');
  const first = await commit(g, 'F2', 'F3', 'E3', 'D3', 'D2');
  assert(first.trapKills! >= 1 && g.state.objective.tutorialTargets === 1 && g.state.player.energy === 2, 'lever drops the strong guard and the chain earns a jump');
  openAt(g, 'E2', 'D3', 'E4');
  const burn = await commit(g, 'C2', 'C3', 'B3', 'A3', 'A2', 'A1');
  assert(burn.hits.at(-1)?.hpAfter === 5 && burn.hits.at(-1)?.attackEffect === 'fire', 'brazier sets the surviving guard on fire');
  const guard = g.state.board[at(g, 'A1')]!;
  assert(guard.hp === 4 && g.state.player.index === at(g, 'A2'), 'the burn tick brings the guard into jump range; the cat blocks the only entrance');
  assert(g.availableMoves().every(path => !path.includes(at(g, 'A1'))), 'no chain can enter the dead end from its only entrance');
  closedAndRefilled(g, 'E2', 'D3', 'E4');
  await jump(g, 'A1');
  assert(g.state.devices.every(device => device.charges === 0), 'lever and brazier both contributed');
  won(g, 4);
}

/** Intended routes use only authored squares, so they must hold for any refill seed. */
async function refillIndependence() {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const [number, play] of [[11, crossing], [12, choice], [13, embers]] as const) await play(start(number, seed));
  }
}

async function deathAndCancellation() {
  const death = start(11), entry = JSON.stringify(death.state);
  await commit(death, 'B3', 'C3', 'D3');
  assert(death.state.phase === 'LOSE' && death.state.player.hp === 0, 'unsafe endpoint really kills the cat');
  death.restartLevel(); assert(JSON.stringify(death.state) === entry, 'restart after falling restores closed hatches and full resources');

  const interrupted = start(12), initial = JSON.stringify(interrupted.state), events: string[] = [];
  let restarted = false;
  interrupted.subscribe((_state, event) => {
    events.push(event.type);
    if (event.type === 'pit-open' && !restarted) { restarted = true; interrupted.restartLevel(); }
  });
  const path = route(interrupted, 'C2', 'D2', 'D3', 'D4', 'C5');
  assert(interrupted.beginChain(path[0]), 'interruptible chain starts');
  for (const step of path.slice(1)) assert(interrupted.extendChain(step), 'interruptible chain extends');
  assert(!await interrupted.releaseChain(), 'restart cancels the old opening turn');
  assert(restarted && events.at(-1) === 'start' && JSON.stringify(interrupted.state) === initial, 'stale pit events cannot affect the restarted lesson');
}

async function main() {
  layouts();
  for (const [number, play] of [[11, crossing], [11, crossFirst], [12, choice], [12, stranded], [12, leapOverMoat], [13, embers]] as const) {
    const g = start(number), entry = JSON.stringify(g.state);
    await play(g); const completed = JSON.stringify(g.state);
    g.restartLevel(); assert(JSON.stringify(g.state) === entry, 'restart restores the exact authored state');
    await play(g); assert(JSON.stringify(g.state) === completed, 'replay reproduces pits, refill, HP, IDs and outcome exactly');
  }
  await refillIndependence();
  await deathAndCancellation();
  console.log('PASS lessons 11–13: lethal-hatch forecast, safe crossing, stranded moat, jump over the moat, lever/brazier/jump exam, closure/refill, IDs, refill seeds, exact replay and cancellation');
}
main().catch(error => { console.error(error); throw error; });
