import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const index = (label: string) => (Number(label.slice(1)) - 1) * 6 + label.charCodeAt(0) - 65;
const route = (...labels: string[]) => labels.map(index);
function start(number: number) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startTutorial(number - 1), `lesson ${number} starts`);
  return g;
}
async function commit(g: ForestEngine, ...labels: string[]) {
  const path = route(...labels), before = JSON.stringify(g.state), hp = g.state.player.hp;
  const existingColors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const prediction = g.preview(path);
  assert(JSON.stringify(g.state) === before, 'preview leaves the authored state unchanged');
  assert(prediction.valid, `${labels.join(' → ')}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), 'chain starts');
  for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
  assert(await g.releaseChain(), 'chain commits');
  for (const cell of g.state.board) {
    if (!cell || cell.kind !== 'melee') continue;
    if (existingColors.has(cell.id)) assert(cell.color === existingColors.get(cell.id), 'surviving enemies retain their authored color');
    else if (cell.behavior.passive) assert(cell.color !== null && g.state.customLevel!.paletteWeights[cell.color] > 0, 'new ordinary enemies use the active palette');
  }
  assert(g.state.lastDamage === prediction.damage, 'incoming damage matches preview');
  assert(g.state.player.hp === hp - prediction.damage, 'remaining HP matches preview');
  assert(g.state.player.index === prediction.endIndex, 'endpoint matches preview');
  assert((g.state.phase === 'LOSE') === prediction.playerDies, 'death matches preview');
  return prediction;
}
function won(g: ForestEngine, hp = 5) {
  assert(g.state.phase === 'WIN' && g.state.objective.tutorialTargets === 2, 'both original marked IDs complete the battle');
  assert(g.state.player.hp === hp, `route finishes with ${hp} HP, got ${g.state.player.hp}`);
}
function openAt(g: ForestEngine, ...labels: string[]) {
  assert(g.state.pits.map(pit => pit.index).sort((a, b) => a - b).join() === route(...labels).sort((a, b) => a - b).join(), 'only the authored floor cells open');
  assert(g.state.pits.every(pit => g.state.board[pit.index] === null), 'open holes remain empty during refill');
}
function layouts() {
  for (let number = 11; number <= 13; number++) {
    const lesson = TUTORIAL_LESSONS[number - 1], { definition } = lesson;
    assert(validateCustomLevel(definition).valid, `lesson ${number} validates`);
    assert(new Set(definition.enemies.map(enemy => enemy.color)).size === (number === 11 ? 3 : 4), 'authored board follows the campaign palette');
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.devices!.map(device => device.index), definition.heroIndex]);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain !== 'wall'), 'all walkable squares have authored content'));
    const g = start(number);
    assert(g.state.player.hp === 5 && g.state.player.energy === 0, 'no free HP or energy');
    assert(Object.values(g.state.inventory).every(amount => amount === 0), 'no free consumables');
    assert(g.state.tutorial!.targetIds.length === 2 && g.state.pits.length === 0, 'two marked IDs and initially closed floor');
    assert(lesson.allowedAbilities?.join() === 'jump' && lesson.allowedItems?.join() === 'frost', 'previously unlocked capabilities remain available');
  }
}

async function crossing(g: ForestEngine) {
  const unsafe = g.preview(route('B4', 'C4', 'C3'));
  assert(unsafe.valid && unsafe.playerDies && !unsafe.completesRoom, 'ending on the armed floor predicts a lethal fall');
  const safe = await commit(g, 'B4', 'C4', 'C3', 'D3', 'D2');
  assert(!safe.playerDies && safe.trapKills === 1, 'crossing the floor before opening is safe and drops the remaining enemy');
  openAt(g, 'C3', 'D3', 'C5');
  assert(!g.preview(route('D3', 'C3')).valid, 'open floor cannot be traversed in a chain');
  assert(!g.previewAbility('jump', index('D3')).valid, 'jump cannot land in a hole');
  assert(g.state.objective.tutorialTargets === 1, 'one lever activation does not win the battle');
  await commit(g, 'E2', 'F3', 'F4', 'F5');
  won(g);
}

async function choice(g: ForestEngine) {
  const guardId = g.state.board[index('D2')]!.id;
  const first = await commit(g, 'B4', 'C4', 'C3', 'B3', 'C2');
  assert(first.trapKills === 4 && g.state.objective.tutorialTargets === 1, 'floor defeats the marked guard and three ordinary enemies');
  assert(!g.state.board.some(cell => cell?.id === guardId), 'the original marked guard fell');
  openAt(g, 'D2', 'D3', 'D4', 'D5');
  assert(!g.preview(route('D2', 'E2')).valid, 'the former short route is closed for the following turn');
  await commit(g, 'C1', 'D1');
  assert(g.state.pits.length === 0 && route('D2', 'D3', 'D4', 'D5').every(cell => g.state.board[cell]), 'the detour spends the open turn, then closed floor refills');
  assert(g.state.board[index('D2')]!.id !== guardId && g.state.objective.tutorialTargets === 1, 'refill does not restore the marked objective');
  await commit(g, 'E1', 'F2', 'F3', 'F4', 'E5', 'F5');
  won(g);
}

async function leap(g: ForestEngine) {
  assert(g.state.player.energy === 2, 'the opening chain earns exactly the jump cost');
  const before = JSON.stringify(g.state), prediction = g.previewAbility('jump', index('E3'));
  assert(JSON.stringify(g.state) === before && prediction.valid && prediction.damage === 0, 'jump across the gap has a pure safe preview');
  assert(await g.useAbility('jump', index('E3')), 'earned jump crosses the open strip');
  assert(g.state.player.energy === 0 && g.state.player.index === prediction.endIndex && g.state.lastDamage === prediction.damage, 'jump execution matches the forecast');
  assert(g.state.pits.length === 0, 'floor closes after the jumping turn');
}

async function embers(g: ForestEngine) {
  await commit(g, 'B4', 'C4', 'C3', 'B3', 'C2');
  openAt(g, 'D2', 'D3', 'D4', 'D5');
  await leap(g);
  const last = await commit(g, 'F3', 'E4', 'F4', 'E5', 'F5');
  assert(last.hits.at(-1)?.hpAfter === 1 && last.hits.at(-1)?.attackEffect === 'fire', 'short chain leaves one HP for the brazier effect');
  assert(g.state.devices.every(device => device.charges === 0), 'both devices contributed to the solution');
  won(g, 4);
}

async function greenBank(g: ForestEngine) {
  const opening = await commit(g, 'C6', 'D6');
  assert(opening.energyGain === 1, 'the new green bank supplies a real two-enemy chain');
  await commit(g, 'E6', 'E5', 'F4', 'F5', 'E4');
  await commit(g, 'D4', 'D3', 'C3', 'C2', 'D2');
  won(g);
  assert(g.state.devices[0].charges === 1, 'the green bank provides an alternate approach without the lever');
}

async function alternatives() {
  const walking = start(11);
  await commit(walking, 'B4', 'B3', 'C3', 'D3', 'D2');
  await commit(walking, 'E2', 'F3', 'F4', 'F5');
  won(walking); assert(walking.state.devices[0].charges === 1, 'first lesson can be won without opening the floor');

  const strength = start(12);
  await commit(strength, 'B4', 'B3', 'A2', 'B2', 'C2', 'C3', 'D3', 'D2');
  await commit(strength, 'E2', 'F2', 'F3', 'F4', 'E5', 'F5');
  won(strength); assert(strength.state.devices[0].charges === 1, 'long chain trades extra attacks for keeping the short route');

  const longBlue = start(13);
  await commit(longBlue, 'B4', 'C4', 'C3', 'B3', 'C2');
  await leap(longBlue);
  await commit(longBlue, 'E2', 'F2', 'F3', 'F4', 'F5');
  won(longBlue); assert(longBlue.state.devices[1].charges === 1, 'long blue chain saves one HP without the brazier');
}

async function deathAndCancellation() {
  const death = start(11), entry = JSON.stringify(death.state);
  await commit(death, 'B4', 'C4', 'C3');
  assert(death.state.phase === 'LOSE' && death.state.player.hp === 0, 'unsafe authored endpoint really kills the cat');
  death.restartLevel(); assert(JSON.stringify(death.state) === entry, 'restart after falling restores closed floor and full resources');

  const interrupted = start(12), initial = JSON.stringify(interrupted.state), events: string[] = [];
  let restarted = false;
  interrupted.subscribe((_state, event) => {
    events.push(event.type);
    if (event.type === 'pit-open' && !restarted) { restarted = true; interrupted.restartLevel(); }
  });
  const path = route('B4', 'C4', 'C3', 'B3', 'C2');
  assert(interrupted.beginChain(path[0]), 'interruptible chain starts');
  for (const step of path.slice(1)) assert(interrupted.extendChain(step), 'interruptible chain extends');
  assert(!await interrupted.releaseChain(), 'restart cancels the old opening turn');
  assert(restarted && events.at(-1) === 'start' && JSON.stringify(interrupted.state) === initial, 'stale pit events cannot affect the restarted lesson');
}

async function main() {
  layouts();
  for (const [number, play] of [[11, crossing], [12, choice], [13, embers], [11, greenBank]] as const) {
    const g = start(number), entry = JSON.stringify(g.state);
    await play(g); const completed = JSON.stringify(g.state);
    g.restartLevel(); assert(JSON.stringify(g.state) === entry, 'restart restores the exact authored state');
    await play(g); assert(JSON.stringify(g.state) === completed, 'replay reproduces pits, refill, HP, IDs and outcome exactly');
  }
  await alternatives();
  await deathAndCancellation();
  console.log('PASS authored lessons 11–13, safe crossing, route tradeoff, pit/fire/jump, green-bank alternative, preview/live, closure/refill and exact restart');
}
main().catch(error => { console.error(error); throw error; });
