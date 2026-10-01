/**
 * Boar, crystals and loot (decision of 01.10.2026) through real engine turns: a crystal or an elite's loot (a `prism`
 * record) no longer holds the boar's row — it slides with it; at a spiked edge or an open pit it neither breaks nor
 * falls but stops the row like a wall (a boar that cannot move at all is stunned); thorns and puddles do not touch it.
 * The Rest forecast of the push equals execution.
 */
import type { CustomEnemy, CustomLevelDefinition } from './customLevel';
import { ForestEngine } from './forestEngine';
import type { EdgeSide } from './customLevel';
import type { ForestCell, TerrainKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;

/** 6×6 floor. The boar on B1 (1) charges down column B toward the cat on D6 (33): lane B2, B3, B4 (7, 13, 19). */
function start(seed: number, layout: Record<number, CustomEnemy | null>, options: { terrain?: Record<number, TerrainKind>; spikes?: EdgeSide[]; pit?: number; hero?: number; oneColor?: boolean } = {}): ForestEngine {
  const terrain: TerrainKind[] = Array(36).fill('floor');
  for (const [index, kind] of Object.entries(options.terrain ?? {})) terrain[Number(index)] = kind;
  const enemies: CustomEnemy[] = [{ index: 1, kind: 'melee', variant: 'boar', color: 0, hp: 9, aggressive: true },
    ...Object.values(layout).filter((enemy): enemy is CustomEnemy => !!enemy)];
  const level: CustomLevelDefinition = { version: 1, name: 'boar-crystals', seed, cols: 6, rows: 6, terrain, heroIndex: options.hero ?? 33, enemies, doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: options.oneColor ? [100, 0, 0, 0, 0] : [100, 100, 0, 0, 0], extraColors: [], playerHp: 9,
    ...(options.spikes ? { spikedEdges: options.spikes } : {}) };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(level), 'level starts');
  assert(g.state.board[1]?.intent.charge?.dy === 1, 'the boar announces a charge down column B');
  // The load refills every empty cell; clear the column below the authored bodies so the row has room.
  for (const index of [7, 13, 19, 25, 31]) if (!(index in layout)) g.state.board[index] = null;
  if (options.pit !== undefined) g.state.pits.push({ index: options.pit, closesAfterTurn: 99 });
  return g;
}
const crystal = (index: number): CustomEnemy => ({ index, kind: 'prism', color: null, hp: 1 });
const goblin = (index: number, hp: number): CustomEnemy => ({ index, kind: 'melee', color: 1, hp });
const at = (g: ForestEngine, id: number) => g.state.board.findIndex(cell => cell?.id === id);

/** Rest under the charge: the forecast's moves and stun equal what the turn did. */
async function rest(g: ForestEngine, label: string) {
  const preview = g.previewRest(), boar = g.state.board[1]!;
  const ids = g.state.board.filter((cell): cell is ForestCell => !!cell).map(cell => cell.id);
  assert(await g.waitTurn(), `${label}: rest resolves`);
  const charge = preview.enemyPhase!.charges.find(entry => entry.boarId === boar.id)!;
  assert(charge && charge.stunned === (boar.behavior.restTurns === 1 && charge.from === charge.to), `${label}: forecast stun ${charge?.stunned}`);
  for (const move of preview.enemyPhase!.moves) if (move.id && ids.includes(move.id) && g.state.board.some(cell => cell?.id === move.id))
    assert(at(g, move.id) === move.to, `${label}: entity ${move.id} forecast at ${move.to}, executed at ${at(g, move.id)}`);
  return { preview, boar };
}

async function slidesWithTheRow() {
  for (let k = 1; k <= 5; k++) {
    // Goblin (survives the ram) — crystal — goblin, room below; puddles on every cell the crystal can reach.
    const g = start(spread(k), { 7: goblin(7, 5), 13: crystal(13), 19: goblin(19, 0) }, { terrain: { 19: 'puddle', 25: 'puddle', 31: 'puddle' } });
    const link = g.state.board[13]!;
    const { preview } = await rest(g, `slide ${k}`);
    assert(!preview.enemyPhase!.charges[0].stunned, `seed ${k}: the row moves`);
    const where = at(g, link.id);
    assert(where > 13 && g.state.board[where] === link && link.hp === 1, `seed ${k}: the crystal slid with the row (now ${where}) intact`);
    assert(g.state.terrain[where] === 'puddle' && !link.status.wet, `seed ${k}: a crystal on a puddle is never wet`);
    assert(!preview.enemyPhase!.knockedDown.includes(link.id), `seed ${k}: a crystal is not «knocked down»`);
  }
  console.log('PASS a crystal in the boar\'s row slides with it onto a puddle, intact and dry; forecast = execution');
}

async function loot() {
  // An elite's loot (a prism carrying an item) slides onto thorns untouched.
  // The goblin ahead dies on the thorns of B5 (25), so the row keeps moving: the loot crosses those thorns to B6 (31).
  const g = start(spread(7), { 7: goblin(7, 5), 13: crystal(13), 19: goblin(19, 0) }, { terrain: { 25: 'thorns' } });
  const link = g.state.board[13]!; link.loot = 'bomb';
  await rest(g, 'loot on thorns');
  assert(g.state.board[at(g, link.id)]?.loot === 'bomb' && at(g, link.id) === 31 && link.hp === 1 && !link.defeated, `the loot crossed the thorns intact (at ${at(g, link.id)})`);
  console.log('PASS loot slides with the row onto thorns untouched');
}

async function wallAtSpikesAndPits() {
  for (let k = 1; k <= 3; k++) {
    // A goblin that survives the ram, then bodies down to a crystal at the spiked bottom edge.
    const spiked = start(spread(k), { 7: goblin(7, 9), 13: goblin(13, 0), 19: goblin(19, 0), 25: goblin(25, 0), 31: crystal(31) }, { spikes: ['bottom'] });
    const link = spiked.state.board[31]!;
    const { preview, boar } = await rest(spiked, `spikes ${k}`);
    assert(spiked.state.board[31] === link && link.hp === 1, `seed ${k}: the crystal at the spikes neither breaks nor falls`);
    assert(boar.behavior.restTurns === 1 && preview.enemyPhase!.charges[0].stunned, `seed ${k}: the row did not move, the boar is stunned`);
    assert(!preview.enemyPhase!.deaths.length, `seed ${k}: nothing is crushed`);
    // Control: a creature in the same place is crushed by the spikes and the row moves.
    const control = start(spread(k), { 7: goblin(7, 9), 13: goblin(13, 0), 19: goblin(19, 0), 25: goblin(25, 0), 31: goblin(31, 0) }, { spikes: ['bottom'] });
    const controlRest = await rest(control, `spikes control ${k}`);
    assert(controlRest.preview.enemyPhase!.deaths.some(death => death.cause === 'spikes') && !controlRest.preview.enemyPhase!.charges[0].stunned, `seed ${k}: a creature at the spikes is crushed and the row moves`);
    // An open pit right after a crystal at the front: the same wall.
    const pit = start(spread(k), { 7: goblin(7, 9), 13: goblin(13, 0), 19: goblin(19, 0), 25: crystal(25) }, { pit: 31 });
    const pitLink = pit.state.board[25]!;
    const pitRest = await rest(pit, `pit ${k}`);
    assert(pit.state.board[25] === pitLink && pitRest.boar.behavior.restTurns === 1, `seed ${k}: the crystal before the pit holds; the boar is stunned`);
  }
  console.log('PASS at a spiked edge or an open pit a crystal stops the row like a wall (boar stunned); a creature there is crushed');
}

async function stillHeld() {
  // A frozen creature still holds the row (a crystal behind it does not change that).
  const g = start(spread(11), { 7: goblin(7, 9), 13: crystal(13) });
  g.state.board[7]!.status.frozen = 1;
  const { boar } = await rest(g, 'frozen');
  assert(boar.behavior.restTurns === 1, 'a frozen creature still holds the row');
  console.log('PASS frozen creatures still hold the row');
}

/**
 * Review of 02.10.2026: a crystal falling during the chain is accounted for by the forecast but its cell is never
 * shown — not even through the boar's push of it in the enemy phase that follows.
 */
async function fallingCrystalStaysHidden() {
  // The cat on F6 (35) chains six goblins along the bottom row and up; the boar on B1 charges down column B, where
  // the crystal of the sixth kill may fall.
  let checked = 0, pushed = 0;
  for (let seed = 300; seed <= 420; seed++) {
    // One refill color: the chain is always legal; the crystal's cell depends on the seed.
    // The column is left as refilled (null entries keep the refill there).
    const g = start(seed, { 7: null, 13: null, 19: null, 25: null, 31: null }, { hero: 35, oneColor: true });
    const path = [34, 33, 32, 31, 30, 24], preview = g.preview(path);
    if (!preview.valid || !preview.crystals || !preview.enemyPhase) continue;
    checked++;
    if (preview.enemyPhase.moves.length) pushed++;
    assert(preview.enemyPhase.moves.every(move => move.id >= 0) && preview.enemyPhase.rams.every(ram => ram.id >= 0),
      `seed ${seed}: the forecast shows no move or ram of a crystal that has not fallen yet`);
  }
  assert(checked > 5 && pushed > 0, `chains that drop a crystal before a boar's push were previewed (${checked}, pushes ${pushed})`);
  console.log(`PASS a crystal falling in the chain stays hidden in the boar's forecast (${checked} chains)`);
}

await slidesWithTheRow();
await fallingCrystalStaysHidden();
await loot();
await wallAtSpikesAndPits();
await stillHeld();
console.log('PASS boar crystals');
