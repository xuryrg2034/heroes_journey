// Read-only investigation: run with node --import tsx artifacts/softlock-reproduction.mjs.
// No product files or game rules are changed. The natural case uses public actions only.
import { writeFileSync } from 'node:fs';
import { ForestEngine } from '../src/game/forestEngine.ts';
import { prepareIntents } from '../src/game/forestSystems.ts';

function assert(value, message) { if (!value) throw new Error(message); }
function describe(g) {
  return { phase: g.state.phase, turn: g.state.turn, player: { ...g.state.player }, inventory: { ...g.state.inventory },
    ordinaryMoves: g.availableMoves().length, jumpTargets: g.state.board.flatMap((_, i) => g.previewAbility('jump', i).valid ? [i] : []),
    spin: g.previewAbility('spin').valid, rageAffordable: g.state.player.energy >= 3.5,
    neighbors: g.chainNeighbors(g.state.player.index).map(index => ({ index, id: g.state.board[index]?.id, variant: g.state.board[index]?.variant, hp: g.state.board[index]?.hp })),
    rotations: structuredClone(g.state.rotations) };
}
async function chain(g, path) {
  assert(g.beginChain(path[0]), `begin ${path}`);
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${path}`);
  assert(await g.releaseChain(), `commit ${path}`);
}
const constructed = new ForestEngine(21); constructed.animationScale = 0; constructed.startScenario('barracks', 21);
// Synthetic late-room positioning, preserving every authored entity and HP. NOT a natural-history claim.
constructed.state.board[45] = constructed.state.board[11]; constructed.state.board[11] = null; constructed.state.player.index = 11;
constructed.state.inventory = { frost: 0, bomb: 0, healing: 0, fire: 0 }; prepareIntents(constructed.state);
const constructedBefore = describe(constructed); constructed.ensureMoves(); const constructedAfterRepair = describe(constructed);
const constructedWaits = [];
while (constructed.state.phase === 'PLAYER_INPUT' && constructedWaits.length < 6) { await constructed.waitTurn(); constructedWaits.push(describe(constructed)); }

const history = [
  { kind: 'item', item: 'bomb', index: 22 },
  { kind: 'chain', path: [38, 39] },
  { kind: 'chain', path: [32, 31, 38] },
  { kind: 'jump', index: 24 },
  { kind: 'chain', path: [31, 32, 25] },
  { kind: 'jump', index: 11 },
];
async function natural() {
  const g = new ForestEngine(21); g.animationScale = 0; g.startScenario('barracks', 21);
  for (const action of history) {
    if (action.kind === 'chain') await chain(g, action.path);
    else if (action.kind === 'item') assert(g.useItem(action.item, action.index), 'spend bomb on distant elite');
    else assert(await g.useAbility(action.kind, action.index), `ability ${action.index}`);
  }
  return g;
}
const trapped = await natural(), naturalAtTrap = describe(trapped), naturalBoard = trapped.getBoardState();
assert(naturalAtTrap.ordinaryMoves === 0 && naturalAtTrap.player.energy === 0 && naturalAtTrap.inventory.bomb === 0, 'natural zero-energy trap with bomb already spent');
const frostTargets = trapped.state.board.flatMap((_, index) => trapped.previewItem('frost', index).valid ? [index] : []);
const frozen = await natural(); assert(frostTargets.length === 1 && frostTargets[0] === 31, 'only frost target is remote from trapped pair');
assert(frozen.useItem('frost', 31), 'spend remote frost'); const afterFrost = describe(frozen);
const naturalWaits = [];
while (frozen.state.phase === 'PLAYER_INPUT' && naturalWaits.length < 10) {
  if (frozen.state.player.hp <= 2 && frozen.state.inventory.healing && !frozen.state.itemPrepared) assert(frozen.useItem('healing'), 'use last healing');
  await frozen.waitTurn(); naturalWaits.push(describe(frozen));
}
assert(naturalWaits.every(state => state.ordinaryMoves === 0) && frozen.state.phase === 'LOSE', 'frost, healing and waiting never open a move before defeat');
const report = { constructed: { before: constructedBefore, afterRepair: constructedAfterRepair, waits: constructedWaits },
  natural: { theme: 'barracks', seed: 21, history, atTrap: naturalAtTrap, board: naturalBoard, frostTargets, afterFrost, waits: naturalWaits } };
writeFileSync(new URL('./softlock-verified.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ constructed: constructedAfterRepair, natural: naturalAtTrap, frostTargets, afterFrostMoves: afterFrost.ordinaryMoves,
  waits: naturalWaits.map(state => ({ phase: state.phase, hp: state.player.hp, moves: state.ordinaryMoves })) }, null, 2));
