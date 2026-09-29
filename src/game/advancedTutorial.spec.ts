import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const index = (label: string, cols = 6) => (Number(label.slice(1)) - 1) * cols + label.charCodeAt(0) - 65;
const route = (g: ForestEngine, labels: string[]) => labels.map(label => index(label, g.state.cols));
function start(number: number) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startTutorial(number - 1), `lesson ${number} starts`);
  return g;
}
async function commit(g: ForestEngine, ...labels: string[]) {
  const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const path = route(g, labels), before = JSON.stringify(g.state), prediction = g.preview(path);
  assert(JSON.stringify(g.state) === before, 'preview does not mutate the authored state');
  assert(prediction.valid, `${labels.join(' → ')}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), 'chain starts');
  for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
  assert(await g.releaseChain(), 'chain commits');
  assert(g.state.lastDamage === prediction.damage, 'incoming damage matches preview');
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
  assert(g.state.phase === 'WIN' && g.state.objective.tutorialTargets === 2, 'both original marked IDs complete the battle');
  assert(g.state.player.hp === hp, `route finishes at ${hp} HP`);
}

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
  for (let number = 7; number <= 10; number++) {
    const lesson = TUTORIAL_LESSONS[number - 1], { definition } = lesson;
    assert(validateCustomLevel(definition).valid, `lesson ${number} is a valid authored level`);
    const colors = new Set<number>(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(colors.size === (number < 9 ? 2 : 3), `lesson ${number} has its staged color count`);
    assert(definition.paletteWeights.every((weight, color) => (weight > 0) === colors.has(color)), 'random refill uses the introduced palette');
    const occupied = new Set(definition.enemies.map(enemy => enemy.index));
    definition.terrain.forEach((terrain, cell) => {
      assert(terrain === 'wall' ? !occupied.has(cell) : cell === definition.heroIndex || occupied.has(cell), 'all walkable squares are authored');
    });
    const g = start(number), marked = new Set(g.state.tutorial!.targetIds);
    assert(marked.size === 2 && g.state.player.energy === 0, 'two marked targets and no free energy');
    assert(g.state.board.every(cell => !cell || marked.has(cell.id) || cell.behavior.passive), 'ordinary targets never gain aggression');
    assert(g.state.board.filter(cell => cell && marked.has(cell.id)).every(cell => !cell!.behavior.passive), 'marked guards remain real threats');
    assert(number === 7 ? g.state.inventory.frost === 1 : Object.values(g.state.inventory).every(amount => amount === 0), 'consumables follow staged lesson inventory');
  }
}

async function frost(g: ForestEngine) {
  const path = route(g, ['B4', 'C4', 'C3']);
  assert(g.state.board[12]?.status.wet && g.state.board[12]?.hp === 6, 'six-HP guard starts wet');
  assert(g.preview(path).hits.at(-1)?.hpAfter === 3, 'short unprepared chain only wounds the guard');
  assert(g.previewFrost(12).valid && g.useItem('frost', 12), 'authored cold flask can prepare the wet guard');
  assert(g.state.turn === 0 && g.state.inventory.frost === 0, 'preparation spends the flask without advancing a turn');
  const hit = g.preview(path).hits.at(-1)!;
  assert(hit.damage === 6 && hit.availablePower === 3 && hit.killed, 'wet frost doubles three accumulated power');
  await commit(g, 'B4', 'C4', 'C3');
  await commit(g, 'D4', 'E4', 'E3', 'E2');
  won(g);
}

async function jump(g: ForestEngine) {
  assert(!g.previewAbility('jump', 22).valid, 'jump cannot be bought before earning energy');
  const first = await commit(g, 'A4', 'A3', 'B3', 'B4');
  assert(first.energyGain === 2 && g.state.player.energy === 2 && g.state.objective.tutorialTargets === 1, 'four ordinary hits earn exactly the jump cost');
  assert(g.state.terrain[21] === 'wall', 'the direct route crosses a real wall');
  const prediction = g.previewAbility('jump', 22);
  assert(prediction.valid && prediction.hits[0].damage === 4 && prediction.completesRoom, 'jump forecasts the marked guard defeat');
  assert(await g.useAbility('jump', 22), 'earned jump resolves');
  assert(g.state.player.energy === 0 && g.state.player.index === 22 && g.state.lastDamage === prediction.damage, 'jump spends energy and lands across the wall');
  won(g);
}

async function prism(g: ForestEngine) {
  assert(g.state.board[15]?.kind === 'prism' && g.state.board[15]?.color === null && g.state.board[15]?.hp === 1, 'authored prism is a living colorless entity');
  assert(!g.preview(route(g, ['B4', 'C4', 'D4'])).valid, 'red cannot directly cross into blue');
  const labels = ['B4', 'C4', 'C3', 'B3', 'B2', 'C2', 'D3', 'D2', 'E2'];
  const prediction = g.preview(route(g, labels)), bridge = prediction.hits.find(hit => hit.index === 15)!;
  assert(prediction.valid && bridge.availablePower === 6 && bridge.remainingPower === 6 && bridge.powerSpent === 0, 'prism preserves accumulated power without adding any');
  assert(prediction.hits.at(-1)?.damage === 8, 'six red hits plus two blue hits defeat the eight-HP guard');
  await commit(g, ...labels);
  assert(g.state.objective.prisms === 1 && g.state.objective.tutorialTargets === 1, 'prism collection does not count as a marked guard');
  assert(g.state.board.filter(cell => cell?.color !== null).some(cell => cell?.color === 1), 'green group survives the first refill');
  await commit(g, 'F2', 'F3', 'E4', 'E5', 'E6');
  won(g);
}

async function archer(g: ForestEngine) {
  const source = g.state.board[10]!, partnerId = g.state.board[9]!.id;
  assert(source.kind === 'ranged' && source.intent.cells.join() === '16,22,28', 'opening shot has a fixed visible line E3–E5');
  await commit(g, 'B4', 'C4', 'C3');
  const plan = g.state.rotations[0];
  assert(source.behavior.restTurns === 1 && source.intent.cells.length === 0, 'ordinary shot leads to a harmless rest turn');
  assert(plan?.from === 10 && plan.to === 9 && plan.sourceId === source.id && plan.targetId === partnerId, 'rest announces E2–D2 exchange with both original IDs');
  const prediction = g.preview(route(g, ['B3', 'B2', 'C2']));
  assert(prediction.rotations[0]?.active && prediction.damage === 0, 'preserving the pair forecasts a safe exchange');
  await commit(g, 'B3', 'B2', 'C2');
  assert(g.state.board[9]?.id === source.id && g.state.board[10]?.id === partnerId, 'announced pair really exchanges positions');
  assert(g.state.board[9]?.behavior.restTurns === 0 && g.state.board[9]?.intent.cells.includes(8), 'archer prepares its next shot after resting');
  await commit(g, 'D3', 'E3', 'E2', 'D2');
  assert(g.state.objective.tutorialTargets === 1 && g.state.objective.rangedKills === 1, 'moved original archer still counts as the marked target');
  await commit(g, 'E1', 'F2', 'F3', 'F4', 'E5', 'E6');
  won(g);
}

async function alternatives() {
  const cold = start(7);
  await commit(cold, 'B4', 'C4', 'B3', 'B2', 'C2', 'C3');
  await commit(cold, 'D4', 'E4', 'E3', 'E2');
  won(cold); assert(cold.state.inventory.frost === 1, 'longer red route wins without the flask');

  const walking = start(8);
  await commit(walking, 'A4', 'A3', 'B3', 'B4');
  await commit(walking, 'C4', 'C3', 'C2');
  await commit(walking, 'D2', 'E2', 'F3', 'F4', 'E4');
  won(walking); assert(walking.state.player.energy === 6, 'the northern detour wins without spending energy');

  const greenFirst = start(9);
  await commit(greenFirst, 'B4', 'C4', 'C3', 'D3', 'E4', 'E5', 'E6');
  assert(greenFirst.state.objective.tutorialTargets === 1 && greenFirst.state.board[10]?.hp === 8, 'prism may bridge to green first');
  await commit(greenFirst, 'D6', 'C6', 'D5', 'D4', 'E3', 'D2', 'E2');
  assert(greenFirst.state.board[10]?.hp === 1, 'short blue budget leaves a living guard and takes one hit');
  await commit(greenFirst, 'D1', 'E2');
  won(greenFirst, 4);

  const blocked = start(10), archerId = blocked.state.board[10]!.id;
  await commit(blocked, 'B4', 'C4', 'C3');
  assert(blocked.preview(route(blocked, ['D3', 'D2'])).rotations[0]?.active === false, 'ending on D2 forecasts exchange cancellation');
  await commit(blocked, 'D3', 'D2');
  assert(blocked.state.board[10]?.id === archerId && blocked.state.player.index === 9, 'occupying an endpoint cancels the announced exchange');
  assert(await blocked.useAbility('jump', 10), 'earned jump can remove the resting archer at its original position');
  await commit(blocked, 'F2', 'F3', 'E4', 'E5', 'E6');
  won(blocked);
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
  console.log('PASS sixteen-lesson palette/refill progression and connected color groups; lessons 7–10 actions, alternate routes, preview parity and exact restart replay');
}
main().catch(error => { console.error(error); throw error; });
