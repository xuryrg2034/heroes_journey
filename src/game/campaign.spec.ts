import { ForestEngine } from './forestEngine';
import { canSwapEnemies, chessTargets, isWalkable, prepareIntents, simulateChain } from './forestSystems';
import { campaignBlueprint } from './campaignContent';
import type { AbilityKind, CellKind, ChainPreview, EnemyColor, ForestCell, RoomTheme } from './forestTypes';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), `start ${path[0]}`);
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
  return g.releaseChain();
}
let nextId = 10000;
function unit(kind: CellKind = 'melee', hp = kind === 'melee' ? 0 : 4, color: EnemyColor | null = 0): ForestCell {
  return { id: nextId++, kind, hp, maxHp: hp, color, armor: 0, countdown: 2,
    status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: 'Тест' } };
}
function fixture() {
  const g = new ForestEngine(); g.animationScale = 0; g.startCampaign();
  g.state.cols = g.state.rows = 7; g.state.player.index = 45; g.state.terrain = Array(49).fill('floor');
  g.state.board = Array.from({ length: 49 }, (_, index) => index === 45 ? null : unit('prism', 1, null));
  g.state.hazard = { cells: [], turnsUntil: 0, damage: 2 }; g.state.room.commanderSpawned = true;
  return g;
}
function door(g: ForestEngine, magic = false, hp = 200) {
  const result = unit('door', hp, null);
  if (hp === 0) result.maxHp = 200; // Already broken by earlier physical attacks.
  result.door = { branch: 'left', label: 'Пиршественный зал', destination: 'banquet', magic, breached: false, footprint: [31, 32] };
  g.state.board[31] = g.state.board[32] = result; return result;
}
async function gateAndRewardRules() {
  for (const access of ['key', 'breached', 'physical'] as const) {
    const single = fixture(); single.state.player.index = 38; single.state.board[38] = null;
    // The fixture's prism filler is no longer inert: a chain may start on a prism (30.09.2026). Clear it here so the
    // move search sees only the door contact.
    single.state.board = single.state.board.map(cell => cell?.kind === 'prism' ? null : cell);
    const exit = door(single, access !== 'physical', access === 'physical' ? 0 : 200);
    if (access === 'key') single.state.room.key.held = true;
    if (access === 'breached') exit.door!.breached = true;
    single.state.hazard = { cells: [31], turnsUntil: 1, damage: 5 };
    const preview = single.preview([31]);
    assert(preview.valid && preview.completesRoom && preview.opensDoor === 31 && preview.damage === 0, `${access}: adjacent opening door accepts a single contact`);
    assert(single.availableMoves().some(path => path.length === 1 && path[0] === 31), `${access}: move search includes single opening door`);
    assert(await commit(single, [31]) && single.state.phase === 'REWARD' && single.state.player.hp === 5, `${access}: single door contact completes before enemy phase`);
  }
  for (const obstacle of ['closed', 'magic', 'remote', 'ordinary'] as const) {
    const single = fixture(); single.state.player.index = obstacle === 'remote' ? 45 : 38; single.state.board[single.state.player.index] = null;
    const exit = door(single, obstacle === 'magic');
    if (obstacle === 'remote') single.state.room.key.held = true;
    if (obstacle === 'ordinary') single.state.board[31] = unit();
    const hp = single.state.board[31]!.hp;
    assert(!single.preview([31]).valid, `${obstacle}: single contact cannot bypass existing chain rules`);
    if (obstacle === 'remote') assert(!single.beginChain(31), 'remote keyed door cannot start a chain');
    else assert(!await commit(single, [31]), `${obstacle}: rejected single chain does not resolve`);
    assert(single.state.phase === 'PLAYER_INPUT' && single.state.turn === 0 && single.state.board[31]!.hp === hp && !exit.door!.breached, 'rejected single contact consumes no turn or target HP');
  }
  const g = fixture(); const gate = door(g); g.state.board[38] = unit('boss', 1, null); g.state.board[38]!.carriesKey = true;
  g.state.hazard = { cells: [31, 38, 44, 43, 42], turnsUntil: 1, damage: 2 };
  const preview = g.preview([38, 31]);
  assert(preview.valid && preview.keyCollected && preview.opensDoor === 31 && preview.damage === 0, 'same-chain commander kill collects key before gate contact and cancels hazards');
  assert(preview.hits[1].damage === 0 && preview.hits[1].doorOpened, 'key is checked before physical gate damage');
  const duplicate = simulateChain(g.state, [38, 31, 32]);
  assert(duplicate.preview.hits.filter(hit => hit.index === 31 || hit.index === 32).length === 1, 'multi-cell gate is one entity and one hit per chain');
  await commit(g, [38, 31]);
  assert(g.state.phase === 'REWARD' && g.state.player.hp === 5 && !g.state.room.key.held && !g.state.board[31] && !g.state.board[32], 'door contact clears full footprint and completes room before enemy phase');
  assert(gate.hp === 200, 'key opening does not pretend to inflict physical damage');
  assert(g.state.rewards.length === 3 && g.state.run.completedRooms === 1, 'completed room offers three rewards');
  assert(g.chooseReward('bomb') && g.state.room.depth === 1 && g.state.room.theme === 'banquet' && g.state.run.path.join() === 'left', 'chosen physical door determines forward-only next room');
  const bombCount = g.state.inventory.bomb;
  assert(!g.chooseReward('bomb') && g.state.inventory.bomb === bombCount, 'reward can be taken only once');
  const entryHp = g.state.player.hp, entryBoard = JSON.stringify(g.getBoardState());
  const innerDoor = g.state.board.findIndex(cell => cell?.kind === 'door');
  assert(g.useItem('bomb', innerDoor) && g.state.inventory.bomb === bombCount - 1, 'room inventory can be spent');
  g.damagePlayer(2); g.restartLevel();
  assert(g.state.inventory.bomb === bombCount && g.state.player.hp === entryHp && JSON.stringify(g.getBoardState()) === entryBoard, 'room retry restores exact entry snapshot without reward farming');
  g.restartRun(); assert(g.state.room.kind === 'gate' && g.state.run.completedRooms === 0 && g.state.inventory.bomb === 0, 'full restart starts a fresh campaign');

  const force = fixture(); const toughGate = door(force); force.state.board[44] = unit(); force.state.board[38] = unit();
  assert(force.preview([44, 38, 31]).hits[2].damage === 2, 'physical door spends the power earned from two weak enemies');
  await commit(force, [44, 38, 31]);
  assert(force.state.phase === 'PLAYER_INPUT' && force.state.board[31]?.hp === 198 && force.state.board[32]?.hp === 198 && force.state.player.index === 38,
    '200 HP gate keeps damage and terminal survivor stops cat outside');
  const snapshot = force.getBoardState(); assert(snapshot[31] === snapshot[32] && snapshot[31]?.id === toughGate.id, 'gate identity stays shared in snapshots');
  force.state.board[37] = unit(); force.state.board[30] = unit(); force.state.board[31]!.hp = 2;
  await commit(force, [37, 30, 31]); assert(force.state.phase === 'REWARD', 'physical destruction enters immediately without another action');

  const magic = fixture(); const locked = door(magic, true, 1); magic.state.board[44] = unit(); magic.state.board[38] = unit();
  const lockedPreview = magic.preview([44, 38, 31]);
  assert(lockedPreview.valid && lockedPreview.hits[2].damage === 0 && !lockedPreview.opensDoor, 'magical door ignores physical damage without a key');
  magic.state.inventory.bomb = 1;
  assert(magic.previewItem('bomb', 31).indices.join() === '31' && magic.useItem('bomb', 31), 'bomb targets one specific door');
  assert(locked.door?.breached && magic.state.phase === 'PLAYER_INPUT' && magic.state.player.index === 45, 'bomb breach never teleports or completes room');
  await commit(magic, [44, 38, 31]); assert(magic.state.phase === 'REWARD', 'breached magical door still requires physical chain contact');
}
async function hazardAndKeyRules() {
  const g = fixture(); g.state.board[44] = unit(); g.state.board[37] = unit();
  const commander = unit('boss', 2, null); commander.carriesKey = true; commander.status.frozen = 1; g.state.board[38] = commander;
  g.state.hazard = { cells: [37, 38, 31, 24, 17], turnsUntil: 1, damage: 2 };
  const preview = g.preview([44, 37]); assert(preview.damage === 2 && preview.volleyDamage === 2, 'fixed volley is included in incoming damage preview');
  await commit(g, [44, 37]);
  assert(g.state.lastDamage === 2 && g.state.player.hp === 3 && g.state.room.key.droppedAt === 38 && !g.state.room.key.held, 'arrows hurt hero and kill even frozen commander, leaving floor key');
  assert(g.state.room.combatKills === 3 && g.state.objective.bossKills === 0 && g.state.board[38]?.kind === 'melee', 'arrow deaths count for lure, not player boss credit; key survives refill occupant');
  g.state.board[38]!.color = 0; g.state.board[31] = unit();
  await commit(g, [38, 31]); assert(g.state.room.key.held && g.state.room.key.droppedAt === null, 'key overlay is collected only on actual cat entry');

  const order = fixture(); const archer = unit('ranged', 7), partner = unit('melee', 2);
  order.state.board[20] = archer; order.state.board[13] = partner;
  archer.behavior.restTurns = 1; archer.intent.moveTo = 13; archer.intent.swapWithId = partner.id;
  order.state.rotations = [{ from: 20, to: 13, sourceId: archer.id, targetId: partner.id, geometry: 'cardinal' }];
  order.state.hazard = { cells: [20], turnsUntil: 1, damage: 2 };
  const events: string[] = []; order.subscribe((_state, event) => events.push(event.type)); await order.waitTurn();
  assert(order.state.board[13]?.id === archer.id && order.state.board[13]?.hp === 7 && order.state.board[20]?.id !== partner.id, 'volley strikes occupant after the advertised swap');
  assert(events.indexOf('enemy-swap') < events.indexOf('arrow-volley'), 'rotations occur before global arrows');
}
async function enemyAndItemRules() {
  const support = fixture(); const cabinet = unit(), ally = unit('melee', 4); cabinet.variant = 'cabinet'; cabinet.supportTargetId = ally.id;
  support.state.board[44] = cabinet; support.state.board[37] = ally;
  support.state.player.index = 38;
  const guarded = simulateChain(support.state, [37], true).preview;
  assert(guarded.hits[0].damage === 1 && guarded.hits[0].hpAfter === 3, 'visible cabinet shield makes a four-HP ally survive the first hit');
  assert(!support.preview([37, 44]).valid, 'guarded living first target blocks reaching the cabinet');
  support.state.player.index = 45;
  const cabinetFirst = support.preview([44, 37]); assert(cabinetFirst.valid && cabinetFirst.hits[1].damage === 2, 'killing cabinet first removes protection within the same chain');
  support.state.player.index = 38;
  const second = unit(); second.variant = 'cabinet'; second.supportTargetId = ally.id; support.state.board[43] = second;
  assert(simulateChain(support.state, [37], true).preview.hits[0].damage === 1, 'multiple cabinet shields do not stack');
  cabinet.status.frozen = second.status.frozen = 1;
  assert(simulateChain(support.state, [37], true).preview.hits[0].damage === 1, 'freeze disables cabinet protection while first-step budget stays one');

  const corner = fixture(); corner.state.room.kind = 'castle'; corner.state.room.theme = 'library'; corner.state.player.index = 7;
  corner.state.terrain[0] = corner.state.terrain[1] = 'wall'; corner.state.board[0] = corner.state.board[1] = corner.state.board[7] = null;
  corner.state.board[8] = unit('melee', 4); corner.state.board[14] = unit('prism', 1, null); corner.state.board[15] = unit('boss', 16, null);
  const guard = unit(); guard.variant = 'cabinet'; guard.supportTargetId = corner.state.board[8]!.id; corner.state.board[9] = guard;
  corner.state.board[10] = unit(); corner.state.board[16] = unit(); corner.state.board[17] = unit();
  // A chain may start on the prism (30.09.2026), so the fixture's prism filler becomes wall (refill cannot fill it):
  // from the prism only the guarded chair and the commander are reachable, and both survive the first hit.
  corner.state.board.forEach((cell, index) => { if (cell?.kind === 'prism' && index !== 14) { corner.state.board[index] = null; corner.state.terrain[index] = 'wall'; } });
  assert(corner.validStarts().includes(14), 'the prism beside the cat is a valid start');
  assert(corner.availableMoves().length === 0, 'guarded first chair, a prism start and the living commander form a genuine no-move corner');
  const cornerBoard = corner.getBoardState(); await corner.waitTurn();
  assert(corner.availableMoves().length === 0 && guard.supportTargetId === corner.state.board[8]?.id, 'generation does not retarget an existing cabinet to rescue a trapped position');
  cornerBoard.forEach((cell, index) => { if (cell) assert(corner.state.board[index]?.id === cell.id && corner.state.board[index]?.hp === cell.hp, 'support repair preserves all entities and HP'); });
  corner.state.board.forEach((cell, index) => { if (isWalkable(corner.state, index)) assert(index === corner.state.player.index ? !cell : !!cell, 'support repair never creates floor holes'); });

  const chess = fixture(); chess.state.board.fill(null); chess.state.player.index = 26;
  const rook = unit('ranged', 7); rook.variant = 'rook'; chess.state.board[24] = rook; chess.state.board[25] = unit();
  assert(chessTargets(chess.state, 24, 'rook').includes(25) && !chessTargets(chess.state, 24, 'rook').includes(26), 'rook ray stops at intervening occupant');
  chess.state.board[32] = unit(); assert(!chessTargets(chess.state, 24, 'bishop').includes(40), 'bishop ray also stops at its first blocker');
  chess.state.board[9] = unit(); rook.variant = 'knight';
  assert(canSwapEnemies(chess.state, 24, 9), 'knight swap may jump over intervening pieces');
  rook.variant = 'rook'; chess.state.board[26] = unit(); chess.state.player.index = 32; chess.state.board[32] = null;
  assert(!canSwapEnemies(chess.state, 24, 26), 'sliding swap cannot cross a blocker');
  prepareIntents(chess.state); const fixedRay = [...rook.intent.cells];
  await commit(chess, [25, 26]); assert(chess.state.lastDamage === 0 && fixedRay.includes(25) && !fixedRay.includes(26), 'clearing a rook blocker never extends the already announced attack');

  const items = fixture(); items.state.inventory = { frost: 1, bomb: 1, healing: 1, fire: 1 };
  items.state.board[38] = unit('melee', 7); items.state.board[31] = unit(); items.state.board[37] = unit(); items.state.board[39] = unit();
  assert(items.previewItem('bomb', 38).indices.join() === '38' && items.previewItem('bomb', 38).damage === 6, 'bomb is stronger single-target damage');
  const fire = items.previewItem('fire', 38); assert(fire.indices.length === 4 && !fire.indices.includes(45) && fire.damage === 0, 'fire applies burning in a cross without impact or friendly damage');
  assert(items.useItem('fire', 38) && items.state.player.hp === 5 && items.state.board[38]?.hp === 7
    && items.state.board[38]?.damageEffects?.burning === 1, 'fire applies one burning stack and preserves current HP');
  assert(!items.useItem('bomb', 38), 'only one item can be prepared per turn');

  const wizard = fixture(); wizard.state.room.kind = 'wizard'; wizard.state.room.theme = 'wizard';
  const route = [44, 37, 30, 23, 16, 9, 2]; route.forEach(index => wizard.state.board[index] = unit());
  const mage = unit('boss', 7, null); mage.variant = 'wizard'; mage.bossStage = 1; wizard.state.board[2] = mage;
  const phase = wizard.preview(route);
  assert(phase.valid && phase.hits.at(-1)?.phaseChanged && phase.endsOnSurvivor && !phase.completesRoom && phase.hits.at(-1)?.hpAfter === 24, 'wizard seal is a visible separate stage and stops the chain alive');
  await commit(wizard, route); assert(wizard.state.board[2]?.bossStage === 2 && wizard.state.phase === 'PLAYER_INPUT', 'first stage cannot win the run');

  const cancelFire = new ForestEngine(); cancelFire.animationScale = 0; cancelFire.startCampaign(); cancelFire.state.inventory.fire = 1;
  cancelFire.state.board[7]!.hp = 1;
  const cleanForest = new ForestEngine(); cleanForest.animationScale = 0; cleanForest.startLevel();
  cancelFire.subscribe((_state, event) => { if (event.type === 'status') cancelFire.startLevel(); });
  assert(!cancelFire.useItem('fire', 7) && JSON.stringify(cancelFire.getBoardState()) === JSON.stringify(cleanForest.getBoardState()), 'restart on first burning application cancels remaining area effects against the fresh board');
}
/** Colour-change crystals, one rule for every mode since 30.09.2026 (mapBattleRules.ts), here in the castle campaign. */
async function prismRules() {
  const crystals = (g: ForestEngine) => g.state.board.filter(cell => cell?.kind === 'prism' && cell.crystalChain);
  const g = fixture(); g.state.board = Array.from({ length: 49 }, (_, index) => index === 45 ? null : unit());
  const route = [44, 37, 30, 23, 16, 9, 2, 1], preview = g.preview(route);
  assert(preview.valid && preview.kills === 8 && preview.crystals === 1 && preview.createsPrism, 'eight campaign kills forecast one crystal, not its cell');
  assert(g.preview(route.slice(0, 5)).crystals === undefined && g.preview(route.slice(0, 6)).crystals === 1, 'the crystal needs six chain kills');
  await commit(g, route);
  assert(crystals(g).length === 1 && crystals(g)[0]!.crystalChain === 8 && g.state.room.combatKills === 8 && g.availableMoves().length > 0,
    'one crystal of length 8 appears without extra combat credit and keeps a move');

  const capped = fixture(); capped.state.board = Array.from({ length: 49 }, (_, index) => index === 45 ? null : unit());
  capped.state.board[46] = unit('prism', 1, null); capped.state.board[47] = unit('prism', 1, null);
  assert(capped.preview(route).crystals === 1, 'standing prisms do not cap crystals');
  capped.state.board[46] = capped.state.board[47] = null; capped.state.run.active = false;
  assert(capped.preview(route).crystals === 1, 'the forest trial creates crystals too');
  capped.state.run.active = true; capped.state.room.key.held = true;
  const exit = unit('door', 200, null); exit.door = { branch: 'forward', label: 'Выход', destination: 'banquet', magic: false, breached: false, footprint: [0] }; capped.state.board[0] = exit;
  // Crystals fall during the chain (30.09.2026): the sixth kill drops one before the chain goes on into the door.
  assert(capped.preview([...route, 0]).completesRoom && capped.preview([...route, 0]).crystals === 1, 'a crystal falls at the sixth kill even when the chain then leaves the room');

  const bridge = fixture(); bridge.state.board[44] = unit('melee', 0, 0); bridge.state.board[37] = unit('prism', 1, null); bridge.state.board[30] = unit('melee', 0, 2);
  const linked = bridge.preview([44, 37, 30]); assert(linked.valid && linked.enemies === 2 && linked.hits.map(hit => hit.availablePower).join() === '1,1,2', 'prism changes color without adding to the budget');
  await commit(bridge, [44, 37, 30]); assert(bridge.state.objective.prisms === 1 && bridge.state.room.combatKills === 2, 'collecting prism never counts as a combat kill');

  const tight = fixture(); tight.state.cols = 4; tight.state.rows = 3; tight.state.player.index = 11;
  tight.state.terrain = Array.from({ length: 12 }, (_, index) => [3, 7].includes(index) ? 'wall' : 'floor');
  tight.state.board = Array.from({ length: 12 }, (_, index) => [3, 7, 11].includes(index) ? null : unit());
  const cramped = tight.preview([10, 9, 8, 4, 0, 1, 2, 6, 5]);
  assert(cramped.valid && cramped.kills === 9 && cramped.crystals === 1, 'a crystal does not need a cell away from the cat');
}
function contentRules() {
  const furniture = new ForestEngine(); furniture.animationScale = 0; furniture.startCastle();
  assert(furniture.state.board.filter(cell => cell?.variant === 'stool').length === 6 && furniture.state.board.filter(cell => cell?.variant === 'cabinet').length === 2, 'key arrival preserves authored swarm and support composition');
  assert(furniture.state.board.filter(cell => cell?.kind === 'melee').every(cell => !!cell?.variant), 'all castle background enemies are furniture');
  for (const theme of ['banquet', 'barracks', 'chess', 'library'] as RoomTheme[]) {
    const signatures = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const room = campaignBlueprint(theme, 1, seed), flat = room.level.map.join(''); signatures.add(flat);
      assert(room.doors.find(exit => exit.branch === 'left')?.footprint[0] === 21 && room.doors.find(exit => exit.branch === 'right')?.footprint[0] === 27, 'left and right exits occupy actual side walls');
      assert(room.doors.every(exit => exit.destination !== theme), 'next room choices avoid immediate theme repetition');
      const reached = new Set([room.heroIndex]), queue = [room.heroIndex];
      while (queue.length) {
        const index = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = index % room.cols + dx, y = Math.floor(index / room.cols) + dy, next = y * room.cols + x;
          if (x >= 0 && x < room.cols && y >= 0 && y < room.rows && flat[next] !== '#' && !reached.has(next)) { reached.add(next); queue.push(next); }
        }
      }
      assert(room.doors.every(exit => exit.footprint.every(index => reached.has(index))), 'every authored exit is geometrically reachable from entrance');
      assert(room.actors.every(actor => flat[actor.index] !== '#'), 'authored actors never occupy walls');
    }
    assert(signatures.size > 2, 'seeded room content varies authored patterns, palettes and mirroring');
  }
}
function scenarioRules() {
  const g = new ForestEngine(83); g.animationScale = 0;
  for (const theme of ['forest', 'gate', 'banquet', 'barracks', 'chess', 'library', 'wizard'] as const) {
    g.state.player.hp = 1; g.state.player.energy = 7; g.state.inventory.fire = 99; g.state.chosenAbility = 'jump';
    g.startScenario(theme);
    assert(g.state.room.theme === theme && g.state.phase === 'PLAYER_INPUT' && g.state.turn === 0, `${theme}: direct scenario loads requested room before input`);
    assert(g.state.player.hp === 5 && g.state.player.energy === 0 && g.state.chosenAbility === null && g.state.inventory.fire === 0, `${theme}: scenario uses fresh health, energy and inventory`);
    assert(g.state.run.seed === 83 && g.state.run.completedRooms === 0 && !g.state.run.path.length, 'direct scenario inherits selected seed without pretending to traverse a route');
    assert(g.state.room.depth === (theme === 'forest' || theme === 'gate' ? 0 : theme === 'wizard' ? 4 : 1), 'direct scenario uses appropriate progression depth');
    const castle = !['forest', 'gate'].includes(theme);
    assert(g.state.inventory.bomb === (castle ? 1 : 0) && g.state.inventory.frost === (theme === 'forest' ? 0 : 1) && g.state.inventory.healing === (theme === 'forest' ? 0 : 1), 'scenario inventory matches existing fresh-start rules');
    g.state.board.forEach((cell, index) => { if (isWalkable(g.state, index)) assert(index === g.state.player.index ? !cell : !!cell, 'every scenario starts densely populated'); });
    assert(g.availableMoves().length > 0, `${theme}: direct room has an available opening`);
    if (castle && theme !== 'wizard') assert(g.state.board.some(cell => cell?.carriesKey) && g.state.board.some(cell => cell?.kind === 'door'), 'castle test room contains its key carrier and onward doors');
    if (theme === 'wizard') assert(g.state.board.some(cell => cell?.variant === 'wizard' && cell.bossStage === 1), 'wizard test scene starts at the first boss stage');
    const snapshot = JSON.stringify({ board: g.getBoardState(), inventory: g.state.inventory, player: g.state.player, room: g.state.room });
    g.state.player.hp = 1; g.state.player.energy = 6; g.state.inventory.bomb = 9; g.state.chosenAbility = 'jump';
    g.restartLevel();
    assert(JSON.stringify({ board: g.getBoardState(), inventory: g.state.inventory, player: g.state.player, room: g.state.room }) === snapshot && g.state.chosenAbility === null, `${theme}: retry restores selected room entry without leaked state`);
    g.startScenario(theme, 83);
    assert(JSON.stringify({ board: g.getBoardState(), inventory: g.state.inventory, player: g.state.player, room: g.state.room }) === snapshot, 'explicit same seed reproduces direct room entry');
  }
  g.startCastle(701); const oldEntry = JSON.stringify(g.state); g.startScenario('banquet', 701);
  assert(JSON.stringify(g.state) === oldEntry, 'existing startCastle remains equivalent to banquet scenario');
  console.log('PASS all seven direct scenarios, dense openings, seed replay, fresh resources, selected-room retry and startCastle compatibility');
}
async function campaignPolicy(seed: number, cap = 16) {
  const g = new ForestEngine(seed); g.animationScale = 0; g.startCampaign(seed);
  const visits = new Map<string, number>();
  for (let step = 0; step < 100 && g.state.phase !== 'WIN' && g.state.phase !== 'LOSE'; step++) {
    if (g.state.phase === 'REWARD') {
      console.log('ROOM', seed, g.state.room.theme, 'turns', g.state.turn, 'HP', g.state.player.hp);
      assert(g.chooseReward(g.state.inventory.healing < 1 ? 'healing' : 'bomb'), 'select one room reward'); continue;
    }
    if (g.state.player.hp <= 2 && g.state.inventory.healing && !g.state.itemPrepared) g.useItem('healing');
    if (cap === 7 && g.state.room.kind === 'wizard' && g.state.inventory.bomb && !g.state.itemPrepared) {
      const target = g.state.board.findIndex(cell => cell?.variant === 'wizard');
      if (target >= 0) g.useItem('bomb', target);
      if ((g.state.phase as string) === 'WIN') break;
    }
    if (cap === 7 && g.state.room.kind === 'castle' && g.state.turn >= 6 && !g.state.room.key.held && g.state.room.key.droppedAt === null && g.state.inventory.bomb && !g.state.itemPrepared) {
      const exit = g.state.board.flatMap((cell, index) => cell?.kind === 'door' ? [index] : []).sort((a, b) =>
        Math.abs(a % g.state.cols - g.state.player.index % g.state.cols) + Math.abs(Math.floor(a / g.state.cols) - Math.floor(g.state.player.index / g.state.cols))
        - Math.abs(b % g.state.cols - g.state.player.index % g.state.cols) - Math.abs(Math.floor(b / g.state.cols) - Math.floor(g.state.player.index / g.state.cols)))[0];
      if (exit !== undefined) g.useItem('bomb', exit);
    }
    const breached = g.state.board.flatMap((cell, index) => cell?.kind === 'door' && cell.door?.breached ? [index] : []);
    const goals = breached.length ? breached : g.state.room.key.held ? g.state.board.flatMap((cell, index) => cell?.kind === 'door' ? [index] : [])
      : g.state.room.key.droppedAt !== null ? [g.state.room.key.droppedAt]
      : g.state.board.flatMap((cell, index) => cell?.carriesKey || cell?.variant === 'wizard' ? [index] : []);
    let actions = candidateActions(g, cap);
    if (!actions.length && g.state.inventory.bomb && !g.state.itemPrepared) {
      const target = g.chainNeighbors(g.state.player.index).find(index => g.state.board[index]?.kind === 'melee' && g.state.board[index]!.hp <= 6);
      if (target !== undefined) { assert(g.useItem('bomb', target), 'spend an existing bomb to escape a self-trapping jump'); actions = candidateActions(g, cap); }
    }
    if (!actions.length) { await g.waitTurn(); continue; }
    if (actions.every(action => action.preview.damage >= g.state.player.hp) && g.state.inventory.healing && !g.state.itemPrepared) g.useItem('healing');
    const score = ({ preview: p }: CandidateAction) => {
      const distance = goals.length ? Math.min(...goals.map(index => Math.abs(index % g.state.cols - p.endIndex % g.state.cols) + Math.abs(Math.floor(index / g.state.cols) - Math.floor(p.endIndex / g.state.cols)))) : 0;
      return (p.completesRoom ? 10000 : 0) + (p.keyCollected ? 500 : 0)
        + p.hits.reduce((sum, hit) => sum + (g.state.board[hit.index]?.carriesKey || g.state.board[hit.index]?.variant === 'wizard' ? hit.damage * (cap === 7 ? 45 : 25) : 0), 0)
        + p.kills * (cap === 7 && goals.length ? 1 : 3) - p.damage * 120 - distance * (cap === 7 ? 8 : 4) - p.energyCost * 0.5 - (p.damage >= g.state.player.hp ? 100000 : 0) - (visits.get(`${g.state.room.depth}:${p.endIndex}`) ?? 0) * 0.5;
    };
    const action = actions.sort((a, b) => score(b) - score(a))[0], preview = action.preview, hp = g.state.player.hp;
    await commitAction(g, action);
    const visited = `${g.state.room.depth}:${preview.endIndex}`; visits.set(visited, (visits.get(visited) ?? 0) + 1);
    assert(g.state.lastDamage === Math.min(hp, preview.damage), `campaign damage parity seed${seed} ${g.state.room.theme} turn${g.state.turn}`);
    if (g.state.phase === 'PLAYER_INPUT') g.state.board.forEach((cell, index) => {
      if (isWalkable(g.state, index)) assert(index === g.state.player.index ? !cell : !!cell, 'campaign stays densely occupied');
    });
  }
  // Balance is not asserted: a heuristic bot winning on a fixed seed says nothing about the rules.
  console.log('CAMPAIGN', seed, 'cap', cap, g.state.phase, g.state.room.theme, 'roomTurn', g.state.turn, 'HP', g.state.player.hp, 'rooms', g.state.run.completedRooms);
}
interface CandidateAction { preview: ChainPreview; path?: number[]; ability?: AbilityKind; target?: number }
function candidateActions(g: ForestEngine, cap = 16): CandidateAction[] {
  const actions: CandidateAction[] = g.availableMoves(cap).map(path => ({ path, preview: g.preview(path) }));
  for (let target = 0; target < g.state.board.length; target++) {
    const preview = g.previewAbility('jump', target); if (preview.valid) actions.push({ preview, ability: 'jump', target });
  }
  const spin = g.previewAbility('spin'); if (spin.valid) actions.push({ preview: spin, ability: 'spin' });
  return actions.filter(action => action.preview.valid);
}
async function commitAction(g: ForestEngine, action: CandidateAction) {
  return action.path ? commit(g, action.path) : g.useAbility(action.ability!, action.target);
}
void gateAndRewardRules().then(hazardAndKeyRules).then(enemyAndItemRules).then(prismRules).then(contentRules).then(scenarioRules)
  .then(() => campaignPolicy(701)).then(() => campaignPolicy(701, 7)).then(() => campaignPolicy(83, 7))
  .catch(error => { console.error(error); throw error; });
