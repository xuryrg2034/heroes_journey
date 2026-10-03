import type { ForestEngine } from './forestEngine';
import { forestFixtureLevel, startForestFixture, startNodeBattle } from './testing/fixtures';
import type { CustomLevelDefinition } from './customLevel';
import { adjacent, chainAdjacent, isWalkable, JUMP_RANGE, prepareIntents } from './forestSystems';
import type { AbilityKind, CellKind, ForestCell } from './forestTypes';
import { hasOrdinaryChain } from './boardGeneration';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
let nextId = 20000;
function unit(kind: CellKind = 'melee', hp = kind === 'melee' ? 0 : 4): ForestCell {
  return { id: nextId++, kind, color: kind === 'boss' || kind === 'door' || kind === 'prism' ? null : 0, hp, maxHp: hp, armor: 0, countdown: 1,
    status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: 'Тест' } };
}
/** Camp patch whose goal is one boss kill (validation wants an authored boss; the tests rebuild the board anyway). */
const BOSS_GOAL: Partial<CustomLevelDefinition> = { goals: [{ key: 'bossKills', target: 1 }],
  enemies: forestFixtureLevel().enemies.map(enemy => enemy.index === 1 ? { index: 1, kind: 'boss', color: null, hp: 20 } : enemy) };
/** The camp fixture (hero entry 45, energy 0) rebuilt as an open floor full of weak red goblins around the cat on 24. */
function fixture(energy = 7, patch: Partial<CustomLevelDefinition> = {}) {
  const g = startForestFixture(701, patch); g.state.player.index = 24; g.state.player.energy = energy;
  g.state.terrain.fill('floor'); g.state.board = Array.from({ length: 49 }, (_, index) => index === 24 ? null : unit());
  g.state.rotations = []; return g;
}
async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), `start ${path[0]}`); for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`); return g.releaseChain();
}
function dense(g: ForestEngine) {
  g.state.board.forEach((cell, index) => { if (isWalkable(g.state, index)) assert(index === g.state.player.index ? !cell : !!cell, `dense cell ${index}`); });
}
async function energyAndChains() {
  const g = fixture(0);
  assert(chainAdjacent(g.state, 24, 16) && adjacent(g.state, 24, 16), 'ordinary chains use all eight neighboring directions');
  assert(g.beginChain(16) && g.preview([23, 15]).valid, 'normal chain accepts diagonal first and intermediate steps at zero energy'); g.cancelChain();
  assert(g.beginChain(23) && g.extendChain(22) && g.extendChain(23), 'normal chain retains backtracking');
  assert(g.state.player.energy === 0 && g.preview([23, 22]).energyGain === 1, 'hover and backtrack never grant forecast energy');
  g.cancelChain(); assert(g.state.player.energy === 0 && g.state.turn === 0, 'cancel grants no energy or turn');
  // Since 04.10.2026 a chain of one enemy is a full hit: its forecast grants half energy like any ordinary hit.
  const single = g.preview([23]); assert(single.valid && single.energyGain === 0.5 && g.state.player.energy === 0, 'a one-enemy chain forecasts half energy, nothing spent yet');
  g.state.board[22]!.hp = g.state.board[22]!.maxHp = 20;
  const p = g.preview([23, 22]); assert(p.valid && p.energyGain === 1 && !p.hits[1].killed, 'surviving terminal enemy still grants half energy');
  await commit(g, [23, 22]); assert(g.state.player.energy === 1, 'committed ordinary hits grant exactly half each');

  const capped = fixture(6.5); await commit(capped, [23, 22]); assert(capped.state.player.energy === 7, 'energy caps at seven');
  const bridge = fixture(0); bridge.state.board[22] = unit('prism', 1); bridge.state.board[21]!.color = 2;
  assert(bridge.preview([23, 22, 21]).energyGain === 1, 'prism contributes no energy'); await commit(bridge, [23, 22, 21]);
  assert(bridge.state.player.energy === 1, 'prism bridge energy equals two enemies');

  const diagonal = fixture(0);
  assert(diagonal.preview([16, 8]).valid && diagonal.preview([16, 8]).energyGain === 1 && diagonal.preview([16, 8]).energyCost === 0, 'ordinary diagonal chain generates energy without ability cost');
  diagonal.state.board[8]!.color = 1; assert(!diagonal.preview([16, 8]).valid, 'diagonal chain retains color restriction'); diagonal.state.board[8]!.color = 0;
  assert(diagonal.preview([16]).valid && diagonal.preview([16]).energyGain === 0.5 && diagonal.state.player.energy === 0, 'a one-enemy diagonal chain is a full hit (04.10.2026), forecast only');
  await commit(diagonal, [16, 8]); assert(diagonal.state.player.energy === 1 && diagonal.state.chosenAbility === null, 'committed diagonal chain earns half per enemy');
  assert(!diagonal.previewAbility('jump', 1).valid, 'insufficient energy still rejects jump');
  const removed = 'rage' as AbilityKind, snapshot = JSON.stringify(diagonal.state);
  assert(!diagonal.setAbility(removed) && !diagonal.previewAbility(removed).valid && !await diagonal.useAbility(removed), 'removed ability is rejected even through stale untyped callers');
  assert(JSON.stringify(diagonal.state) === snapshot && Number.isFinite(diagonal.state.player.energy), 'removed ability cannot mutate state or create NaN energy');
  const corner = fixture(0); corner.state.board = corner.state.board.map((cell, index) => index === 16 || index === 8 ? cell : null);
  assert(corner.validStarts().includes(16) && corner.availableMoves().some(path => path.join() === '16,8') && hasOrdinaryChain(corner.state), 'diagonal-only witness agrees across input, move enumeration and generation');
  corner.state.terrain[17] = corner.state.terrain[23] = 'wall'; assert(!corner.beginChain(16) && !hasOrdinaryChain(corner.state), 'two blocked side tiles prohibit corner cutting');
  corner.state.terrain[17] = 'floor'; assert(corner.beginChain(16) && hasOrdinaryChain(corner.state), 'one open side permits diagonal regardless of occupancy');

  {
    const enemy = fixture(); const attacker = enemy.state.board[16]!; attacker.behavior.aggressive = true; prepareIntents(enemy.state);
    assert(!attacker.intent.cells.includes(24) && attacker.intent.cells.includes(17) && attacker.intent.cells.length === 4, 'an ordinary aggressive melee attacks only four sides');
    await enemy.waitTurn(); assert(enemy.state.player.hp === 5 && attacker.behavior.aggressive, 'diagonal melee miss preserves anger without damaging hero');
    const cardinal = fixture(); cardinal.state.board[17]!.behavior.aggressive = true; prepareIntents(cardinal.state);
    await cardinal.waitTurn(); assert(cardinal.state.player.hp === 4, 'cardinal melee attack still hits hero');
  }
  const recruited = fixture(); recruited.state.turn = 1; recruited.state.board.forEach((cell, index) => { if (cell && index !== 16) cell.kind = 'prism'; }); prepareIntents(recruited.state);
  assert(recruited.state.board[16]!.behavior.aggressive && !recruited.state.board[16]!.intent.cells.includes(24), 'newly recruited anger uses the same cardinal footprint');
  console.log('PASS ordinary eight-way chains, corner rules, diagonal-only generation witness, cardinal melee, energy/cap/colors and removed ability rejection');
}
async function jumpRules() {
  const g = fixture(2); g.state.terrain[17] = 'wall'; g.state.board[17] = null;
  const before = JSON.stringify(g.state), p = g.previewAbility('jump', 3);
  assert(p.valid && p.endIndex === 3 && p.hits[0].damage === 4 && JSON.stringify(g.state) === before, 'jump preview is pure and can cross walls');
  assert(!g.previewAbility('jump', 24).valid && !g.previewAbility('jump', 17).valid, 'jump cannot land on hero or wall');
  g.state.board[3]!.hp = g.state.board[3]!.maxHp = 7; g.setAbility('jump');
  assert(!await g.useAbility('jump', 3) && g.state.chosenAbility === 'jump' && g.state.player.energy === 2, 'unlethal landing cannot overlap enemy or spend energy');
  g.state.board[3]!.status.brittle = true;
  assert(g.previewAbility('jump', 3).valid && g.previewAbility('jump', 3).hits[0].damage === 8, 'brittle modifies landing damage');
  const events: string[] = []; g.subscribe((_state, event) => events.push(event.type));
  await g.useAbility('jump', 3);
  assert(g.state.player.index === 3 && g.state.player.energy === 0 && g.state.turn === 1 && g.state.chosenAbility === null, 'jump lands, spends energy and resolves a full turn');
  assert(events.indexOf('ability') < events.indexOf('move') && events.includes('enemy-turn'), 'jump effect precedes movement and existing enemy phase'); dense(g);

  const range = fixture(); range.state.player.index = 0; range.state.board[0] = null; range.state.board[24] = unit();
  assert(JUMP_RANGE === 3 && range.previewAbility('jump', 3).valid && range.previewAbility('jump', 16).valid && !range.previewAbility('jump', 4).valid && !range.previewAbility('jump', 17).valid, 'Euclidean radius three includes boundary and excludes beyond-circle diagonals');
  assert(!await range.useAbility('jump', 25) && range.state.player.energy === 7 && range.state.turn === 0 && range.state.player.index === 0, 'old five-tile landing is rejected without energy, movement or turn');
  range.state.board[16] = unit('door'); assert(!range.previewAbility('jump', 16).valid, 'jump never bypasses a door');
  range.state.board[16] = unit('prism', 1); assert(!range.previewAbility('jump', 16).valid, 'jump does not target prism');
  range.state.board[16] = null;
  assert(range.previewAbility('jump', 16).valid && range.previewAbility('jump', 16).hits.length === 0, 'jump may land on empty floor without a hit');
  await range.useAbility('jump', 16); assert(range.state.player.index === 16 && range.state.player.energy === 5 && range.state.turn === 1, 'empty-floor landing spends energy and a turn'); dense(range);
  console.log('PASS jump radius/walls/landing, lethal requirement, physical status modifiers, empty landing, turn and energy');
}
async function spinRules() {
  const g = fixture(3), targets = g.neighbors(24); assert(targets.length === 8, 'spin reaches all eight neighbors');
  g.state.board[17] = unit('melee', 7); const survivor = g.state.board[17]!;
  g.state.board[18] = unit('door', 200); g.state.board[25] = unit('prism', 1);
  g.state.board[23] = unit('boss', 4);
  g.state.board[30]!.hp = g.state.board[30]!.maxHp = 7; g.state.board[30]!.status.brittle = true;
  const p = g.previewAbility('spin');
  assert(p.valid && p.hits.length === 6 && p.hits.find(hit => hit.index === 17)?.damage === 4 && p.hits.find(hit => hit.index === 30)?.damage === 8, 'spin skips door/prism and applies brittle to its simultaneous hits');
  const oldDoor = g.state.board[18]!.id, oldPrism = g.state.board[25]!.id; await g.useAbility('spin');
  assert(g.state.player.index === 24 && g.state.player.energy === 0 && g.state.turn === 1, 'spin stays in place and pays one full turn');
  assert(g.state.board[17]!.id === survivor.id && g.state.board[17]!.hp === 3, 'a durable neighbor survives the spin wounded');
  assert(g.state.board[18]!.id === oldDoor && g.state.board[18]!.hp === 200 && g.state.board[25]!.id === oldPrism, 'spin cannot damage doors or consume prisms');
  assert(g.state.objective.kills === 5 && g.state.objective.bossKills === 1, 'spin credits actual kills'); dense(g);

  const multi = fixture(); const shared = unit('boss', 20); multi.state.board[16] = multi.state.board[17] = shared;
  assert(multi.previewAbility('spin').hits.filter(hit => hit.hpBefore === 20).length === 1, 'spin hits shared multi-cell entity once');
  await multi.useAbility('spin'); assert(multi.state.board[16] === multi.state.board[17] && multi.state.board[16]!.hp === 16, 'shared footprint stays one wounded entity');
  const empty = fixture(); empty.neighbors(24).forEach(index => empty.state.board[index] = unit('prism', 1));
  assert(!empty.previewAbility('spin').valid && !await empty.useAbility('spin') && empty.state.player.energy === 7, 'empty spin cannot consume energy');
  console.log('PASS simultaneous eight-neighbor spin, brittle, doors, prisms, kill credit and entity dedupe');
}
async function phasesAndPersistence() {
  for (const ability of ['jump', 'spin'] as const) {
    const g = fixture(); g.state.board[0]!.behavior.aggressive = true; g.state.board[0]!.intent = { cells: [ability === 'jump' ? 3 : 24], damage: 1, label: 'Fixed' };
    const p = g.previewAbility(ability, 3); await g.useAbility(ability, 3);
    assert(p.damage === 1 && g.state.lastDamage === p.damage && g.state.player.hp === 4, `${ability}: fixed enemy attack matches preview`);
    const cancel = fixture(); cancel.subscribe((_state, event) => { if (event.type === 'ability') cancel.restartLevel(); });
    assert(!await cancel.useAbility(ability, 3) && cancel.state.turn === 0 && cancel.state.player.energy === 0 && cancel.state.player.index === 45, `${ability}: restart callback cannot mutate fresh state or energy`);
  }
  // The authored exit of an editor level: it opens once every goal is met and ends the battle when the chain reaches it.
  const exitLevel = { completion: 'exit' as const, goals: [{ key: 'kills' as const, target: 1 }], doors: [{ index: 22 }],
    enemies: forestFixtureLevel().enemies.filter(enemy => enemy.index !== 22) };
  const g = fixture(2, exitLevel); g.state.objective.kills = 1;
  const exit = unit('door', 1); exit.door = { label: 'Выход', breached: true, footprint: [22] }; g.state.board[22] = exit;
  assert(g.preview([23, 22]).energyGain === 0.5, 'door does not generate energy even on battle completion');
  await commit(g, [23, 22]); assert(g.state.phase === 'WIN' && g.state.player.energy === 2.5, 'enemy energy arrives before the early battle-complete return');
  const boss = fixture(1, BOSS_GOAL); boss.state.board[22] = unit('boss', 2);
  await commit(boss, [23, 22]); assert(boss.state.phase === 'WIN' && boss.state.player.energy === 2, 'final boss chain grants energy before victory');
  // A map node starts with the energy carried by the run; a retry restores it and the outcome carries the earned energy on.
  const node = startNodeBattle('trunk-wake', { player: { hp: 5, maxHp: 5, energy: 2.5 } });
  assert(node.state.player.energy === 2.5, 'node battle starts with the carried energy');
  node.state.player.energy = 0; node.setAbility(null); node.restartLevel();
  assert(node.state.player.energy === 2.5 && node.state.chosenAbility === null, 'node restart restores entry energy and clears armed mode');
  node.state.player.energy = 4; node.winLevel(); assert(node.runBattleOutcome()?.player.energy === 4, 'won node hands its energy to the run');
  console.log('PASS ability incoming preview, callback restart, exit/boss energy before victory, node energy carry and entry snapshot');
}
async function restRules() {
  const g = fixture(3.5); g.beginChain(16); g.setAbility('jump');
  const attacker = g.state.board[23]!; attacker.behavior.aggressive = true; attacker.intent = { cells: [24], damage: 1, label: 'Замах' };
  g.state.board[16]!.status.frozen = 1;
  g.state.board[0] = unit('ranged', 7); const source = g.state.board[0]!, partner = g.state.board[1]!; source.behavior.restTurns = 1;
  g.state.rotations = [{ from: 0, to: 1, sourceId: source.id, targetId: partner.id, geometry: 'cardinal' }];
  const events: string[] = []; g.subscribe((_state, event) => events.push(event.type));
  const resting = g.waitTurn();
  assert(g.state.phase === 'ENEMY_RESOLVE' && g.state.player.energy === 4 && !g.state.chain.length && g.state.chosenAbility === null, 'rest immediately earns half energy and clears armed input');
  assert(!await g.waitTurn() && g.state.player.energy === 4 && g.state.turn === 1, 'second rest click during resolution cannot duplicate energy or turns');
  assert(await resting && g.state.player.hp === 4 && g.state.lastDamage === 1, 'rest consumes full enemy phase including the fixed attack');
  assert(g.state.board[1]!.id === source.id && g.state.board[0]!.id === partner.id && events.indexOf('attack') < events.indexOf('enemy-swap'), 'rest keeps attack-before-rotation order');
  assert(!attacker.behavior.aggressive && attacker.behavior.restTurns === 1 && g.state.board[16]!.status.frozen === 0, 'rest advances attack calm grace and frozen duration normally');
  const misses = fixture(0); misses.state.board[0]!.behavior.aggressive = true; misses.state.board[0]!.intent.cells = [1];
  await misses.waitTurn(); assert(misses.state.player.energy === 0.5 && misses.state.board[0]!.behavior.aggressive, 'rest does not clear missed enemy aggression');
  const capped = fixture(6.5); await capped.waitTurn(); assert(capped.state.player.energy === 7, 'rest energy reaches seven');
  await capped.waitTurn(); assert(capped.state.player.energy === 7, 'rest never exceeds energy cap');
  capped.state.phase = 'WIN'; assert(!await capped.waitTurn() && capped.state.player.energy === 7, 'rest outside player input grants nothing');
  const cancel = fixture(2); cancel.subscribe((_state, event) => { if (event.type === 'enemy-turn') cancel.restartLevel(); });
  assert(!await cancel.waitTurn() && cancel.state.player.energy === 0 && cancel.state.turn === 0 && cancel.state.player.index === 45 && cancel.state.player.hp === 5, 'restart callback cancels stale rest without awarding energy or attacks to fresh state');
  console.log('PASS rest half-energy/cap, cleared selection, single committed turn, enemy attacks/anger/rotations/status and restart cancellation');
}
void energyAndChains().then(jumpRules).then(spinRules).then(phasesAndPersistence).then(restRules).catch(error => { console.error(error); throw error; });
