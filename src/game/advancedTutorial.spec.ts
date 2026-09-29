import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const index = (label: string, cols: number) => (Number(label.slice(1)) - 1) * cols + label.charCodeAt(0) - 65;
const at = (g: ForestEngine, label: string) => index(label, g.state.cols);
const route = (g: ForestEngine, labels: string[]) => labels.map(label => at(g, label));
function start(number: number) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startTutorial(number - 1), `lesson ${number} starts`);
  return g;
}
/** Real player input: preview, then begin/extend/release; the result must match the forecast. */
async function commit(g: ForestEngine, ...labels: string[]) {
  const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const path = route(g, labels), before = JSON.stringify(g.state), prediction = g.preview(path);
  assert(JSON.stringify(g.state) === before, 'preview does not mutate the state');
  assert(prediction.valid, `${labels.join(' → ')}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), 'chain starts');
  for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
  assert(await g.releaseChain(), 'chain commits');
  assert(g.state.lastDamage === prediction.damage, `${labels.join(' → ')}: incoming damage matches preview`);
  assert(g.state.player.index === prediction.endIndex, 'endpoint matches preview');
  for (const cell of g.state.board) {
    if (!cell) continue;
    if (colors.has(cell.id)) assert(cell.color === colors.get(cell.id), 'survivors keep their colors');
    else assert(cell.behavior.passive && cell.color !== null && g.state.customLevel!.paletteWeights[cell.color] > 0,
      'new tutorial enemies remain passive and use the current palette');
  }
  return prediction;
}
function won(g: ForestEngine, hp = 5) {
  assert(g.state.phase === 'WIN' && g.state.objective.tutorialTargets === g.state.tutorial!.targetIds.length, 'all original marked IDs complete the battle');
  assert(g.state.player.hp === hp, `route finishes at ${hp} HP`);
}

/** General palette rule for all sixteen battles (AGENTS.md): 1–8 two colors, 9–11 three, 12–13 four, 14–16 five. */
function paletteProgression() {
  for (const [offset, lesson] of TUTORIAL_LESSONS.entries()) {
    const number = offset + 1, { definition } = lesson;
    const expected = number <= 8 ? [0, 2] : number <= 11 ? [0, 1, 2] : number <= 13 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4];
    const initial = definition.enemies.filter(enemy => enemy.color !== null);
    assert([...new Set(initial.map(enemy => enemy.color))].sort().join() === expected.join(), `lesson ${number}: exact authored palette`);
    assert(definition.paletteWeights.every((weight, color) => (weight > 0) === expected.includes(color)), `lesson ${number}: random refill matches palette`);
    const adjacent = (a: number, b: number) => a !== b && Math.abs(a % definition.cols - b % definition.cols) <= 1
      && Math.abs(Math.floor(a / definition.cols) - Math.floor(b / definition.cols)) <= 1;
    for (const color of expected) {
      const cells = initial.filter(enemy => enemy.color === color).map(enemy => enemy.index);
      assert(cells.length >= 2 && cells.some(a => cells.some(b => adjacent(a, b))), `lesson ${number}: color ${color} has a playable patch, not a decorative singleton`);
    }
  }
}

function layouts() {
  const shapes = new Set<string>();
  for (let number = 7; number <= 10; number++) {
    const lesson = TUTORIAL_LESSONS[number - 1], { definition } = lesson;
    assert(validateCustomLevel(definition).valid, `lesson ${number} is a valid authored level`);
    assert(definition.cols >= 5 && definition.rows >= 5 && definition.cols <= 7 && definition.rows <= 7, `lesson ${number} fits 5×5…7×7`);
    shapes.add(`${definition.cols}x${definition.rows}@${definition.heroIndex % definition.cols},${Math.floor(definition.heroIndex / definition.cols)}`);
    const colors = new Set<number>(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(colors.size === (number < 9 ? 2 : 3), `lesson ${number} has its staged color count`);
    assert(definition.paletteWeights.every((weight, color) => (weight > 0) === colors.has(color)), 'random refill uses the introduced palette');
    const occupied = new Set(definition.enemies.map(enemy => enemy.index));
    definition.terrain.forEach((terrain, cell) => {
      assert(terrain === 'wall' ? !occupied.has(cell) : cell === definition.heroIndex || occupied.has(cell), 'all walkable squares are authored');
    });
    const g = start(number), marked = new Set(g.state.tutorial!.targetIds);
    assert(marked.size === lesson.targetIndices.length && marked.size >= 2 && g.state.player.energy === 0, 'marked targets and no free energy');
    assert(g.state.board.every(cell => !cell || marked.has(cell.id) || cell.behavior.passive || !cell.behavior.passive && cell.maxHp === 0 && cell.kind === 'melee'),
      'only marked guards and authored armed weak enemies can attack');
    assert(g.state.board.filter(cell => cell && marked.has(cell.id)).every(cell => !cell!.behavior.passive), 'marked guards remain real threats');
    assert(number === 7 ? g.state.inventory.frost === 1 : Object.values(g.state.inventory).every(amount => amount === 0), 'consumables follow staged lesson inventory');
    assert(g.availableMoves(4).length > 0, `lesson ${number} opens with a legal chain`);
  }
  assert(shapes.size === 4, 'battles 7–10 differ in field shape or cat start');
}

async function frost(g: ForestEngine) {
  const guard = at(g, 'C3');
  assert(g.state.terrain[guard] === 'puddle' && g.state.board[guard]?.status.wet && g.state.board[guard]?.hp === 4, 'the ford guard stands wet in a puddle');
  // The trap is visible before committing: without frost the short chain only wounds the guard and cannot cross.
  assert(g.preview(route(g, ['E2', 'D2', 'C3'])).hits.at(-1)?.hpAfter === 1, 'forecast shows the unprepared guard survives');
  assert(!g.preview(route(g, ['E2', 'D2', 'C3', 'B3'])).valid, 'a surviving guard blocks the crossing');
  const skipped = g.previewFrost(guard);
  assert(skipped.valid && skipped.skippedCells.length > 0, 'frost forecast lists the attack it will skip');
  assert(g.useItem('frost', guard), 'authored cold flask prepares the wet guard');
  assert(g.state.turn === 0 && g.state.inventory.frost === 0, 'preparation spends the flask without advancing a turn');
  const prediction = g.preview(route(g, ['E2', 'D2', 'C3', 'B3'])), hit = prediction.hits.find(entry => entry.index === guard)!;
  assert(hit.availablePower === 3 && hit.damage === 6 && hit.killed && prediction.completesRoom, 'frost doubles three power and the chain crosses the ford');
  await commit(g, 'E2', 'D2', 'C3', 'B3');
  won(g); assert(g.state.turn === 1, 'frost crossing wins in one turn');
}

async function jump(g: ForestEngine) {
  const guard = at(g, 'C3');
  assert(!g.previewAbility('jump', guard).valid, 'jump cannot be bought before earning energy');
  assert(g.preview(route(g, ['C6', 'B6', 'C5'])).energyGain === 1.5, 'a three-enemy chain forecasts too little energy for the jump');
  const first = await commit(g, 'C6', 'D5', 'C5', 'B6', 'A5');
  assert(first.energyGain === 2.5 && g.state.player.energy === 2.5 && g.state.objective.tutorialTargets === 1, 'five hits earn the jump and defeat the near guard');
  assert(['A4', 'B4', 'C4', 'D4'].every(label => g.state.terrain[at(g, label)] === 'wall'), 'the direct route crosses a real wall');
  const prediction = g.previewAbility('jump', guard);
  assert(prediction.valid && prediction.hits[0].damage === 4 && prediction.completesRoom, 'jump forecasts the far guard defeat');
  assert(await g.useAbility('jump', guard), 'earned jump resolves');
  assert(g.state.player.index === guard && g.state.player.energy === 0.5 && g.state.lastDamage === prediction.damage, 'jump spends energy and lands across the wall');
  won(g);
}

async function prism(g: ForestEngine) {
  const bridge = at(g, 'D3'), guard = at(g, 'E2');
  assert(g.state.board[bridge]?.kind === 'prism' && g.state.board[bridge]?.color === null && g.state.board[bridge]?.hp === 1, 'authored prism is a living colorless entity');
  assert(!g.preview(route(g, ['A3', 'B3', 'C2', 'D2', 'E2'])).valid, 'red cannot directly continue into blue');
  // Trap: a short red run through the prism only wounds the seven-HP banner guard, and the forecast says so.
  assert(g.preview(route(g, ['B4', 'C4', 'C3', 'D3', 'E2'])).hits.at(-1)?.hpAfter === 3, 'forecast shows the short prism chain leaves the guard alive');
  const labels = ['A3', 'B3', 'C2', 'C1', 'D2', 'C3', 'C4', 'D3', 'E2'];
  const prediction = g.preview(route(g, labels)), hit = prediction.hits.find(entry => entry.index === bridge)!;
  assert(prediction.valid && hit.availablePower === 7 && hit.remainingPower === 7 && hit.powerSpent === 0, 'prism preserves accumulated power without adding any');
  assert(prediction.hits.at(-1)?.index === guard && prediction.hits.at(-1)?.damage === 8 && prediction.hits.at(-1)?.killed, 'seven red hits carried by the prism defeat the blue guard');
  await commit(g, ...labels);
  assert(g.state.objective.prisms === 1 && g.state.objective.tutorialTargets === 1, 'prism collection does not count as a marked guard');
  assert(['F3', 'F4', 'E4'].every(label => g.state.board[at(g, label)]?.color === 1), 'the green group survives the first refill');
  await commit(g, 'F3', 'F4', 'E4', 'E5');
  won(g);
}

async function archer(g: ForestEngine) {
  const source = g.state.board[at(g, 'B2')]!, lineIds = route(g, ['C2', 'D2', 'E2']).map(index => g.state.board[index]!.id);
  assert(source.kind === 'ranged' && source.intent.cells.join() === route(g, ['C2', 'D2', 'E2']).join(), 'opening shot has a fixed visible line C2–E2');
  // Trap: the longest opening chain ends on the archer line; the forecast shows the incoming arrow.
  const greedy = g.preview(route(g, ['F4', 'G3', 'G2', 'F3', 'E2', 'D1', 'C2']));
  assert(greedy.valid && greedy.damage > 0 && source.intent.cells.includes(greedy.endIndex), 'forecast warns that the longest chain stops in the line of fire');
  const first = await commit(g, 'F4', 'F3', 'G3', 'G2', 'G1');
  assert(first.damage === 0 && g.state.objective.tutorialTargets === 1, 'the corner guard falls and the cat stops in a safe pocket');
  // The missed shot still strikes every creature on the line: three weak goblins fall, credited to the player.
  assert(first.enemyPhase?.deaths.filter(death => death.cause === 'arrow').map(death => death.id).join() === lineIds.join(), 'forecast lists the goblins the arrow kills');
  assert(!g.state.board.some(cell => cell && lineIds.includes(cell.id)) && g.state.objective.kills === first.kills + 3, 'arrow kills on the line count for the player');
  const plan = g.state.rotations[0], partnerId = g.state.board[at(g, 'C2')]!.id;
  assert(source.behavior.restTurns === 1 && source.intent.cells.length === 0, 'missed shot leads to a harmless rest turn');
  assert(plan?.from === at(g, 'B2') && plan.to === at(g, 'C2') && plan.sourceId === source.id && plan.targetId === partnerId, 'rest announces the only exit from the niche with the refilled C2 occupant');
  const keep = g.preview(route(g, ['F1', 'F2']));
  assert(keep.rotations[0]?.active && keep.damage === 0, 'stopping outside the pair forecasts a safe exchange');
  await commit(g, 'F1', 'F2');
  assert(g.state.board[at(g, 'C2')]?.id === source.id && g.state.board[at(g, 'B2')]?.id === partnerId, 'announced pair really exchanges positions');
  const landing = g.previewAbility('jump', at(g, 'C2'));
  assert(landing.valid && landing.completesRoom, 'the archer left its niche and is now in jump range');
  assert(await g.useAbility('jump', at(g, 'C2')), 'jump resolves');
  assert(g.state.objective.rangedKills === 1, 'moved original archer counts as the marked target');
  won(g); assert(g.state.turn === 3, 'the archer exam takes three turns');
}

async function alternatives() {
  const cold = start(7);
  await commit(cold, 'F2', 'F3', 'E3');
  await commit(cold, 'E4', 'F5', 'E5', 'D5', 'D4', 'C3', 'B3');
  won(cold); assert(cold.state.inventory.frost === 1 && cold.state.turn === 2, 'the southern approach wins without the flask one turn later');

  const walking = start(8);
  await commit(walking, 'C6', 'B6', 'C5', 'D5');
  await commit(walking, 'E5', 'E4');
  assert(walking.state.player.index === at(walking, 'E4'), 'the cat stops inside the breach after defeating its armed keeper');
  await commit(walking, 'E3', 'E2', 'D1', 'C2', 'C3');
  won(walking); assert(walking.state.turn === 3, 'the breach detour wins without the jump one turn later');

}

async function main() {
  paletteProgression();
  layouts();
  for (const [offset, play] of [frost, jump, prism, archer].entries()) {
    const g = start(offset + 7), entry = JSON.stringify(g.state);
    await play(g); const completed = JSON.stringify(g.state);
    g.restartLevel(); assert(JSON.stringify(g.state) === entry, 'restart restores resources, intent, palette and marked IDs exactly');
    await play(g); assert(JSON.stringify(g.state) === completed, 'replay reproduces the same refills, swaps and result');
  }
  await alternatives();
  console.log('PASS sixteen-lesson palette rule and connected color groups; lessons 7–10 routes, visible traps, alternate routes, preview parity and exact restart replay');
}
main().catch(error => { console.error(error); throw error; });
