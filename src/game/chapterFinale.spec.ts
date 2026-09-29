import { shieldIsActive } from './combatRules';
import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const index = (label: string) => (Number(label.slice(1)) - 1) * 7 + label.charCodeAt(0) - 65;
const route = (...labels: string[]) => labels.map(index);
const boss = (g: ForestEngine) => g.state.board.find(cell => cell?.kind === 'boss');
function start(number: number) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startTutorial(number - 1), `lesson ${number} starts directly`);
  return g;
}
async function commit(g: ForestEngine, ...labels: string[]) {
  const path = route(...labels), before = JSON.stringify(g.state), hp = g.state.player.hp;
  const existingColors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const prediction = g.preview(path);
  assert(JSON.stringify(g.state) === before, 'preview preserves the whole state');
  assert(prediction.valid, `${labels.join(' → ')}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), 'chain starts');
  for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
  assert(await g.releaseChain(), 'chain commits');
  for (const cell of g.state.board) {
    if (!cell || cell.kind !== 'melee') continue;
    if (existingColors.has(cell.id)) assert(cell.color === existingColors.get(cell.id), 'surviving enemies retain their authored color');
    else if (cell.behavior.passive) assert(cell.color !== null && g.state.customLevel!.paletteWeights[cell.color] > 0, 'new ordinary enemies use the active palette');
  }
  assert(g.state.lastDamage === prediction.damage && g.state.player.hp === hp - prediction.damage, 'incoming damage matches forecast');
  assert(g.state.player.index === prediction.endIndex, 'endpoint matches forecast');
  assert((g.state.phase === 'LOSE') === prediction.playerDies, 'death matches forecast');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'completion matches forecast');
  return prediction;
}
async function jump(g: ForestEngine, label: string) {
  const before = JSON.stringify(g.state), hp = g.state.player.hp, energy = g.state.player.energy;
  const prediction = g.previewAbility('jump', index(label));
  assert(JSON.stringify(g.state) === before && prediction.valid, `pure valid jump ${label}: ${prediction.reason}`);
  assert(await g.useAbility('jump', index(label)), 'earned jump commits');
  assert(g.state.player.energy === energy - 2 && g.state.player.hp === hp - prediction.damage, 'jump resources match forecast');
  assert(g.state.lastDamage === prediction.damage && g.state.player.index === prediction.endIndex, 'jump damage and endpoint match');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'jump completion matches');
}
function won(g: ForestEngine, hp: number) {
  assert(g.state.phase === 'WIN' && g.state.player.hp === hp, `victory with ${hp} HP`);
}
function layouts() {
  assert(TUTORIAL_LESSONS.length === 16, 'thirteen lessons, finale, two branches');
  for (let number = 14; number <= 16; number++) {
    const lesson = TUTORIAL_LESSONS[number - 1], validation = validateCustomLevel(lesson.definition);
    assert(validation.valid, `lesson ${number}: ${validation.errors.join(' ')}`);
    assert(new Set(lesson.definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color])).size === 5, 'five authored ordinary colors');
    const g = start(number);
    assert(g.state.player.hp === 5 && g.state.player.energy === 0, 'standard HP and no free energy');
    assert(Object.values(g.state.inventory).every(amount => amount === 0), 'no free consumables');
    assert(!g.previewAbility('jump', index('E2')).valid, 'jump must be earned');
    assert(lesson.allowedAbilities?.join() === 'jump' && lesson.allowedItems?.join() === 'frost', 'earned capabilities persist');
    assert(!g.startTutorialChoice(14), 'branch cannot be selected before victory');
  }
}
async function combined(g: ForestEngine) {
  assert(shieldIsActive(boss(g)!), 'jailer starts shielded');
  assert(!g.preview(route('B5', 'B4', 'C4', 'D4', 'E4', 'E3')).valid, 'front approach is blocked by shield');
  const opening = await commit(g, 'B5', 'C5', 'C4', 'B4', 'B3', 'C3', 'C2');
  assert(opening.trapKills === 4 && g.state.pits.length === 4 && boss(g)!.hp === 14, 'lever drops escorts and closes routes, boss remains');
  assert(!g.preview(route('D2', 'E2')).valid && !g.previewAbility('jump', index('D2')).valid, 'pit blocks chain and landing');
  assert(g.state.player.energy === 3 && !shieldIsActive(boss(g)!) && boss(g)!.behavior.restTurns === 1, 'missed heavy attack still lowers shield');
  await jump(g, 'E2');
  assert(g.state.pits.length === 0 && shieldIsActive(boss(g)!), 'floor closes and shield returns after recovery turn');
  const strike = await commit(g, 'F1', 'G1', 'G2', 'F2', 'G3', 'G4', 'F4', 'E4', 'F3', 'E3');
  assert(strike.hits.at(-1)?.hpAfter === 5 && strike.hits.at(-1)?.attackEffect === 'fire' && boss(g)!.hp === 4, 'brazier burns the final HP needed for a jump finish');
  assert(g.state.devices.every(device => device.charges === 0), 'both devices are used');
  await jump(g, 'E3'); won(g, 5);
  assert(g.state.objective.tutorialTargets === 1, 'jailer is the only required target');
}
async function direct(g: ForestEngine) {
  const strike = await commit(g, 'B5', 'B4', 'C4', 'B3', 'A2', 'B2', 'C3', 'C2', 'D1', 'C1', 'D2', 'E3');
  assert(strike.damage === 2 && boss(g)!.hp === 2 && !shieldIsActive(boss(g)!), 'flank attack trades two HP for speed and recovery');
  assert(g.preview(route('D3', 'D4', 'E4', 'E3')).valid, 'lowered shield also allows a frontal finishing option');
  await commit(g, 'D3', 'E3'); won(g, 3);
  assert(g.state.devices.every(device => device.charges === 1), 'neither lever nor brazier is compulsory');
}
async function escape(g: ForestEngine) {
  assert(g.state.tutorial!.targetIds.length === 0, 'exit branch has no kill-all target');
  await commit(g, 'B5', 'B4', 'C4', 'C3', 'D3', 'D2');
  assert(g.state.phase === 'PLAYER_INPUT' && g.state.objective.turns === 1, 'opening gate condition does not itself win');
  const exit = await commit(g, 'E2', 'F1', 'G1'); won(g, 5);
  assert(exit.opensDoor === index('G1') && g.state.player.index === index('G1'), 'cat actually crosses the exit');
  assert(g.state.board.some(cell => cell?.kind === 'ranged'), 'surviving archer does not prevent escape');
}
async function beacon(g: ForestEngine) {
  await commit(g, 'B5', 'B4', 'C4', 'C3');
  const planned = [...(boss(g)!.intent.summonCells ?? [])];
  assert(planned.length === 2, 'source telegraphs two ordinary reinforcements');
  await commit(g, 'B3', 'B2', 'C2', 'D2', 'E2');
  assert(boss(g)!.hp === 3 && planned.every(i => g.state.board[i]?.behavior.aggressive && !g.state.board[i]?.behavior.passive), 'second response summons armed enemies');
  await jump(g, 'E2'); won(g, 5);
  assert(!boss(g) && g.state.board.some(cell => cell?.behavior.aggressive), 'source objective wins while armed escorts survive');
}
async function fastBeacon(g: ForestEngine) {
  const events: string[] = []; const unsubscribe = g.subscribe((_state, event) => events.push(event.type));
  await commit(g, 'B5', 'B4', 'C4', 'C3', 'B3', 'B2', 'C2', 'D1', 'D2', 'E2');
  unsubscribe(); won(g, 5);
  assert(!events.includes('special-arrival'), 'killing source early prevents reinforcement');
}
async function southernColors(g: ForestEngine) {
  for (const [color, labels] of [[1, ['C6', 'D6']], [3, ['E6', 'F6']]] as const) {
    assert(labels.every(label => g.state.board[index(label)]?.color === color), 'southern chain uses the authored new color');
    await commit(g, ...labels);
  }
  assert(g.state.player.energy === 2, 'green and ochre earn a jump without free starting energy');
  const violet = g.state.tutorial!.index === 13 ? ['F5', 'E5'] : ['G5', 'F5', 'F4', 'G4'];
  assert(violet.every(label => g.state.board[index(label)]?.color === 4), 'violet patch forms a playable chain');
  await commit(g, ...violet);
  if (g.state.tutorial!.index === 13) {
    await commit(g, 'F4', 'G4', 'G3', 'G2', 'G1', 'F1', 'F2', 'F3', 'E4', 'E3');
    assert(boss(g)!.hp === 4 && g.state.devices[0].charges === 1, 'southern approach burns boss into jump range without opening pits');
    await jump(g, 'E3');
  } else if (g.state.tutorial!.index === 14) {
    await commit(g, 'G3', 'G2', 'F2', 'F3', 'E2', 'F1', 'G1');
    assert(g.state.player.index === index('G1'), 'southern detour still physically crosses the door');
  } else {
    await commit(g, 'G3', 'F3', 'F2', 'G2', 'G1', 'F1', 'E1', 'E2');
    assert(!boss(g), 'blue chain reached from violet defeats the bell source');
  }
  won(g, 5);
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
  const jailer = await replay(14, combined); await replay(14, direct);
  assert(!jailer.nextTutorial() && !jailer.startTutorialChoice(0), 'fork needs an allowed explicit choice');
  assert(jailer.startTutorialChoice(14) && jailer.state.tutorial!.index === 14, 'first branch starts exit battle');
  await escape(jailer); assert(!jailer.nextTutorial() && !jailer.startTutorialChoice(15), 'exit branch does not force source battle');
  const other = start(14); await direct(other);
  assert(other.startTutorialChoice(15) && other.state.tutorial!.index === 15, 'second branch starts source battle');
  await beacon(other); assert(!other.nextTutorial() && !other.startTutorialChoice(14), 'source branch does not force exit battle');
  await replay(15, escape); await replay(16, beacon); await replay(16, fastBeacon);
  for (const number of [14, 15, 16]) await replay(number, southernColors);
  console.log('PASS chapter finale: shield/recovery, optional lever/fire/jump, boss routes and five-color southern alternatives, true exit, source reinforcements, branches, pure forecast and exact replay');
}
main().catch(error => { console.error(error); throw error; });
