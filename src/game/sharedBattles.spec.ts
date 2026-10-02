import { shieldIsActive } from './combatRules';
import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { variantSeed } from './levelAnalysis';
import { runPressureActive } from './mapBattleRules';
import { forestBattle } from './run/forestBattles';
import { authoredRefillPalette, forestNode, forestRowPalette } from './run/forestMap';
import { startNodeBattle } from './testing/fixtures';

// Battles shared by both trails (src/game/run/battles/shared.ts): «Три знамени» (node trail-banners, row 8; former
// lesson 9) and the Jailer checkpoint (node jailer, row 9; former lesson 14). Both are started exactly as their map
// nodes (startNodeBattle): 5/5 HP, 0 energy, no items, frost and jump open (guaranteed on every route), the row palette
// plus the authored colors. Rows ≥ 5 drop the authored passivity and add growing anger (mapBattleRules.ts), so these
// are the conditions every route below is played in. Both battles end through an exit door (decision of 02.10.2026):
// the goals open it, entering it wins — «Три знамени» F6 beside the green guard, the Jailer F1 two squares from the
// kill: the killing chain continues into it over a refilled neighbour (class «near», 03.10.2026); after the jump one turn.
// Analyzer metrics live in docs/levels/*.md, not here.

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
/** UI label (column letter, row from 1) to a board index of the running battle. */
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const route = (g: ForestEngine, ...labels: string[]) => labels.map(label => at(g, label));
const boss = (g: ForestEngine) => g.state.board.find(cell => cell?.kind === 'boss');
const DOOR = { 'three-banners': 'F6', 'jailer-gate': 'F1' } as const;
const doorLabel = (g: ForestEngine, id: keyof typeof DOOR) => g.state.board[at(g, DOOR[id])]?.kind === 'door' ? g.state.board[at(g, DOOR[id])]!.intent.label : 'none';
function start(id: 'three-banners' | 'jailer-gate', refillSeed = 0) {
  const g = startNodeBattle(id);
  // Same seed substitution as the level analyzer: the authored start stays, only later refills change.
  if (refillSeed) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, refillSeed); g.restoreAnalysisSnapshot(snap); }
  return g;
}
/** Real player input: pure preview, then begin/extend/release; the result must match the forecast. */
async function commit(g: ForestEngine, ...labels: string[]) {
  const path = route(g, ...labels), before = JSON.stringify(g.captureAnalysisSnapshot()), hp = g.state.player.hp;
  const existingColors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const prediction = g.preview(path);
  assert(JSON.stringify(g.captureAnalysisSnapshot()) === before, 'preview preserves the whole state, RNG and IDs');
  assert(prediction.valid, `${labels.join(' → ')}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), 'chain starts');
  for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
  assert(await g.releaseChain(), 'chain commits');
  for (const cell of g.state.board) {
    if (!cell || cell.kind !== 'melee') continue;
    if (existingColors.has(cell.id)) assert(cell.color === existingColors.get(cell.id), 'surviving enemies retain their color');
    else {
      assert(cell.color !== null && g.state.customLevel!.paletteWeights[cell.color] > 0, 'new ordinary enemies use the node palette');
      assert(!cell.behavior.passive, 'rows ≥ 5: new enemies are never passive');
    }
  }
  assert(g.state.lastDamage === prediction.damage && g.state.player.hp === hp - prediction.damage, `${labels.join(' → ')}: incoming damage ${g.state.lastDamage} matches forecast ${prediction.damage}`);
  assert(g.state.player.index === prediction.endIndex, 'endpoint matches forecast');
  assert((g.state.phase === 'LOSE') === !!prediction.playerDies, 'death matches forecast');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'completion matches forecast');
  if (g.state.phase === 'WIN') assert(prediction.opensDoor === path.at(-1) && g.state.player.index === path.at(-1), 'the victory is the cat entering the door');
  return prediction;
}
async function jump(g: ForestEngine, label: string) {
  const before = JSON.stringify(g.captureAnalysisSnapshot()), hp = g.state.player.hp, energy = g.state.player.energy;
  const prediction = g.previewAbility('jump', at(g, label));
  assert(JSON.stringify(g.captureAnalysisSnapshot()) === before && prediction.valid, `pure valid jump ${label}: ${prediction.reason}`);
  assert(await g.useAbility('jump', at(g, label)), 'earned jump commits');
  assert(g.state.player.energy === energy - 2 && g.state.player.hp === hp - prediction.damage, 'jump resources match forecast');
  assert(g.state.lastDamage === prediction.damage && g.state.player.index === prediction.endIndex, 'jump damage and endpoint match');
  assert((g.state.phase === 'WIN') === !!prediction.completesRoom, 'jump completion matches');
}
function won(g: ForestEngine, hp: number) {
  assert(g.state.phase === 'WIN' && g.state.player.hp === hp, `victory with ${hp} HP, got ${g.state.phase} ${g.state.player.hp}`);
  assert(g.state.objective.tutorialTargets === g.state.tutorial!.targetIds.length, 'all original marked IDs complete the battle');
  const outcome = g.runBattleOutcome();
  assert(outcome?.won && outcome.player.hp === hp, 'the run receives the victory with the remaining HP');
}

function layouts() {
  for (const [id, nodeId, size, colors] of [['three-banners', 'trail-banners', '6x6', 3], ['jailer-gate', 'jailer', '7x6', 5]] as const) {
    const battle = forestBattle(id)!, node = forestNode(nodeId)!, { definition } = battle;
    assert(node.content.kind === 'battle' && node.content.battleId === id, `${nodeId} plays ${id}`);
    const validation = validateCustomLevel(definition);
    assert(validation.valid, `${id}: ${validation.errors.join(' ')}`);
    assert(`${definition.cols}x${definition.rows}` === size, `${id} keeps its own field shape`);
    const authored = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(authored.size === colors, `${id}: ${colors} authored ordinary colors`);
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.doors.map(door => door.index), definition.heroIndex]);
    assert(definition.doors.length === 1 && definition.completion === 'exit', `${id} ends through one exit door`);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain !== 'wall'), `${id}: every walkable square has authored content`));
    const g = start(id), { state } = g;
    assert(state.runNode?.nodeId === nodeId && state.runNode.row === node.row && runPressureActive(state), `${id} starts as ${nodeId} on row ${node.row} with growing anger`);
    assert(state.player.hp === 5 && state.player.energy === 0, 'standard HP and no free energy');
    assert(Object.values(state.inventory).every(amount => amount === 0), 'no free consumables at the analysis entry');
    assert(state.runNode!.allowedItems.join() === 'frost' && state.runNode!.allowedAbilities.join() === 'jump', `${id}: frost and jump are open on every route, spin is not`);
    assert(!g.previewAbility('jump', state.player.index - state.cols).valid, 'jump must be earned');
    assert(JSON.stringify(state.customLevel!.paletteWeights) === JSON.stringify(authoredRefillPalette(battle, node.row))
      && forestRowPalette(node.row).every(color => state.customLevel!.paletteWeights[color] > 0), `${id}: row ${node.row} palette plus authored colors`);
    for (const enemy of definition.enemies) {
      const cell = state.board[enemy.index]!;
      assert(cell.color === enemy.color && cell.hp === enemy.hp && cell.variant === enemy.variant, `${id}: authored enemy at ${enemy.index} kept`);
      assert(!cell.behavior.passive, `${id}: row ${node.row} drops authored passivity at ${enemy.index}`);
    }
    assert(state.tutorial!.targetIds.join() === battle.targetIndices.map(index => state.board[index]!.id).join(), `${id}: marked targets keep their IDs`);
    assert(g.availableMoves(4).length > 0, `${id} opens with a legal chain`);
    assert(doorLabel(g, id) === 'Выполни цели', `${id}: the door on ${DOOR[id]} is closed at the start`);
  }
}

// ---------------------------------------------------------------- «Три знамени» (row 8)

/** Returns false when a colour-change crystal (seeded cell) took a cell of the second chain: the route is then not asserted. */
async function banners(g: ForestEngine): Promise<boolean> {
  const bridge = at(g, 'D3'), guard = at(g, 'E2');
  assert(g.state.board[bridge]?.kind === 'prism' && g.state.board[bridge]?.color === null && g.state.board[bridge]?.hp === 1, 'authored prism is a living colorless entity');
  assert(!g.preview(route(g, 'A3', 'B3', 'C2', 'D2', 'E2')).valid, 'red cannot directly continue into blue');
  // Trap: a short red run through the prism only wounds the seven-HP banner guard, and the forecast says so.
  assert(g.preview(route(g, 'B4', 'C4', 'C3', 'D3', 'E2')).hits.at(-1)?.hpAfter === 3, 'forecast shows the short prism chain leaves the guard alive');
  const labels = ['A3', 'B3', 'C2', 'C1', 'D2', 'C3', 'C4', 'D3', 'E2'];
  const prediction = g.preview(route(g, ...labels)), hit = prediction.hits.find(entry => entry.index === bridge)!;
  assert(prediction.valid && hit.availablePower === 7 && hit.remainingPower === 7 && hit.powerSpent === 0, 'prism preserves accumulated power without adding any');
  assert(prediction.hits.at(-1)?.index === guard && prediction.hits.at(-1)?.damage === 8 && prediction.hits.at(-1)?.killed, 'seven red hits carried by the prism defeat the blue guard');
  await commit(g, ...labels);
  assert(g.state.objective.prisms === 1 && g.state.objective.tutorialTargets === 1, 'prism collection does not count as a marked guard');
  // The nine-kill chain drops a crystal at its sixth kill on a seeded cell; it may crush a goblin of the green lane.
  const crystal = ['F3', 'F4', 'E4'].find(label => g.state.board[at(g, label)]?.crystalChain);
  if (crystal) { console.log(`NOTE three-banners: a crystal took ${crystal} of the green lane on this refill seed`); return false; }
  assert(['F3', 'F4', 'E4'].every(label => g.state.board[at(g, label)]?.color === 1), 'the green group survives the first refill');
  // «Рядом»: the green chain that defeats Z continues into the corner door F6.
  const greens = g.preview(route(g, 'F3', 'F4', 'E4', 'E5'));
  assert(greens.hits.at(-1)?.killed && !greens.completesRoom && greens.opensDoor === undefined, 'meeting both goals alone is no victory');
  const exit = await commit(g, 'F3', 'F4', 'E4', 'E5', 'F6');
  assert(exit.opensDoor === at(g, 'F6') && g.state.turn === 2, 'the same chain enters the door on turn 2');
  won(g, 5);
  return true;
}

// ---------------------------------------------------------------- Jailer (row 9)

/** No chain reaches the Jailer with 14 power on the opening board: flank fuel is short, the shield blocks the pool. */
function jailerOpeningCap() {
  const g = start('jailer-gate'), jailerIndex = at(g, 'D1'), hp = boss(g)!.hp;
  assert(boss(g)!.variant === 'jailer' && hp === 14 && g.state.tutorial!.targetIds.includes(boss(g)!.id), 'the Jailer is the 14-HP marked target');
  const reaching = g.availableMoves().filter(path => path.at(-1) === jailerIndex);
  assert(reaching.length > 0, 'the flank is reachable on the first turn');
  for (const path of reaching) {
    const hit = g.preview(path).hits.at(-1)!;
    assert(hit.index === jailerIndex && hit.hpAfter > 0 && hp - hit.hpAfter <= 5, 'no first chain can kill or badly wound the Jailer');
  }
  assert(!g.preview(route(g, 'E3', 'E2', 'D1')).valid, 'the shield blocks the pool below');
}

/** Right flank, the pool from below in the rest window, then the left flank finishes with a chain. */
async function jailer(g: ForestEngine) {
  assert(shieldIsActive(boss(g)!), 'Jailer starts shielded');
  const flank = await commit(g, 'F3', 'F2', 'E1', 'D1');
  assert(flank.damage === 0 && boss(g)!.hp === 10, 'the flank strike is safe: the heavy blow was aimed below');
  assert(!shieldIsActive(boss(g)!) && boss(g)!.behavior.restTurns === 1, 'a missed heavy strike still lowers the shield for a turn');
  await commit(g, 'E2', 'E3', 'D2', 'C3', 'B3', 'C2', 'D1');
  assert(boss(g)!.hp === 3 && shieldIsActive(boss(g)!), 'the pool from below lands in the rest window; the shield returns');
  assert(boss(g)!.intent.cells.includes(g.state.player.index) && boss(g)!.intent.damage === 2, 'the next heavy strike is aimed at the cat below');
  const finish = await commit(g, 'B1', 'C1', 'D1');
  assert(!finish.completesRoom && g.state.phase === 'PLAYER_INPUT' && !boss(g) && g.state.player.energy >= 2, 'a side chain finishes the Jailer; the earned jump stays unused');
  assert(g.state.objective.tutorialTargets === 1 && g.state.objective.bossKills === 1, 'the Jailer is the only required target');
  await leaveJailer(g);
}
/**
 * Staying after the kill: the cat stands on D1, two squares from the door F1; the enemies answer once, then any refilled
 * neighbour on E1 or E2 and the door make the exit chain. Found by a search over real moves, not a fixed refill.
 */
async function leaveJailer(g: ForestEngine) {
  const door = at(g, DOOR['jailer-gate']), turn = g.state.turn;
  assert(g.state.player.index === at(g, 'D1') && doorLabel(g, 'jailer-gate') === 'Выход открыт', 'the kill opens the door two squares away');
  const exits = g.availableMoves().filter(path => path.at(-1) === door).sort((a, b) => a.length - b.length);
  assert(exits.length > 0, 'an exit chain exists on the turn after the kill');
  const hp = g.state.player.hp;
  await commit(g, ...exits[0].map(index => String.fromCharCode(65 + index % g.state.cols) + (Math.floor(index / g.state.cols) + 1)));
  assert(g.state.turn === turn + 1, 'the cat leaves one turn after the kill');
  won(g, hp);
}
/**
 * «Рядом» for a chain finish (03.10.2026): the boss is no colour link, so the chain that kills the Jailer on D1 goes on
 * over any killable refilled neighbour (E1, E2) into the door the same turn. The squares are refilled, so the finishing
 * chain is found by a search over real moves, not fixed; it must kill the Jailer and end in the door.
 */
async function jailerNear(g: ForestEngine) {
  await commit(g, 'F3', 'F2', 'E1', 'D1');
  await commit(g, 'E2', 'E3', 'D2', 'C3', 'B3', 'C2', 'D1');
  const door = at(g, DOOR['jailer-gate']), jailerIndex = at(g, 'D1'), hp = g.state.player.hp;
  const finishes = g.availableMoves().filter(path => path.at(-1) === door && path.includes(jailerIndex)).sort((a, b) => a.length - b.length);
  assert(finishes.length > 0, 'the chain that kills the Jailer continues into the door the same turn');
  const out = await commit(g, ...finishes[0].map(index => String.fromCharCode(65 + index % g.state.cols) + (Math.floor(index / g.state.cols) + 1)));
  assert(out.opensDoor === door && out.hits.some(hit => hit.index === jailerIndex && hit.killed), 'the same chain kills the Jailer and opens the door mid-chain');
  won(g, hp);
}
/** Alternative: after the same two turns the earned jump also finishes (it ignores the shield); a jump cannot enter the door. */
async function jailerJump(g: ForestEngine) {
  await commit(g, 'F3', 'G2', 'F2', 'E1', 'D1');
  await commit(g, 'E2', 'E3', 'D2', 'C3', 'B3', 'C2', 'D1');
  assert(boss(g)!.hp === 2, 'the longer flank leaves two HP');
  await jump(g, 'D1');
  assert(g.state.phase === 'PLAYER_INPUT' && !boss(g), 'the jump finishes the Jailer; the door opens');
  await leaveJailer(g);
}
/** Trap: eating the pool while the shield is up wastes the rest window. */
async function poolTooEarly(g: ForestEngine) {
  await commit(g, 'E3', 'E2', 'D2', 'C2', 'B3', 'C3');
  assert(boss(g)!.hp === 14 && !shieldIsActive(boss(g)!), 'the Jailer is untouched although its shield is down now');
  const reaching = g.availableMoves().filter(path => path.at(-1) === at(g, 'D1')).map(path => 14 - g.preview(path).hits.at(-1)!.hpAfter);
  assert(Math.max(0, ...reaching) < 7, 'with the authored seed the window no longer offers the pool damage');
}

async function refillIndependence() {
  let clean = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    if (await banners(start('three-banners', seed))) clean++;
    await jailer(start('jailer-gate', seed)); await jailerJump(start('jailer-gate', seed)); await jailerNear(start('jailer-gate', seed));
  }
  assert(clean >= 4, `three-banners: the authored route is checked on most refill seeds, got ${clean} of 5`);
  // The Jailer's exit rests on refilled squares: check both exits (by the killing chain and one turn later) on spread seeds as well.
  for (let k = 1; k <= 4; k++) { const seed = Math.imul(k, 2654435761) >>> 0; await jailer(start('jailer-gate', seed)); await jailerJump(start('jailer-gate', seed)); await jailerNear(start('jailer-gate', seed)); }
}
async function replay(id: 'three-banners' | 'jailer-gate', play: (g: ForestEngine) => Promise<unknown>) {
  const g = start(id), initial = JSON.stringify(g.captureAnalysisSnapshot());
  await play(g); const final = JSON.stringify(g.captureAnalysisSnapshot());
  g.restartLevel(); assert(JSON.stringify(g.captureAnalysisSnapshot()) === initial, 'restart restores authored initial state exactly');
  await play(g); assert(JSON.stringify(g.captureAnalysisSnapshot()) === final, 'real replay reproduces HP, IDs, refill, intents and result');
}
async function main() {
  layouts();
  jailerOpeningCap();
  await replay('three-banners', banners);
  await replay('jailer-gate', jailer); await replay('jailer-gate', jailerJump); await replay('jailer-gate', jailerNear); await replay('jailer-gate', poolTooEarly);
  await refillIndependence();
  console.log('PASS shared battles as map nodes: Three Banners prism route into the door; Jailer opening cap, shield/rest window, pool trap, chain finish, jump alternative, exit by the killing chain or one turn later; refill seeds, pure forecast and exact replay');
}
main().catch(error => { console.error(error); throw error; });
