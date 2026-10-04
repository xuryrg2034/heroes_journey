/**
 * Battle effects of the talismans and oaths (docs/talismans.md, 04.10.2026), through real engine commands on spread
 * seeds: forecast = execution, exact replay, and no change without talismans (the golden comparison covers that).
 * The Ash ward against every kind of lethal damage: an enemy's strike, quills, thorns, a bleeding step, a burning
 * tick and a pit lever; the first lethal hit leaves 1 HP and spends the ward, a second one in the same turn kills.
 */
import { ForestEngine } from './forestEngine';
import type { ChainPreview, ForestState } from './forestTypes';
import { authoredLesson, type LessonTile } from './lessonBuilder';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';
import type { TalismanId } from './talismans';
import { nextReinforcementTurn } from './exitRules';
import { angryOrdinaryCount } from './mapBattleRules';
import type { DamageEffects } from './damageEffects';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const json = (value: unknown) => JSON.stringify(value);
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
const battle = (id: string, rows: string[], legend: Record<string, LessonTile> = {}) => {
  registry[id] = authoredLesson({ id, name: id, description: '', hint: '', seed: 7500, rows, legend: { D: { door: true }, T: { color: 3, target: true }, ...legend } });
};
interface Options { talismans?: TalismanId[]; ward?: boolean; hp?: number; energy?: number; row?: number; effects?: DamageEffects; abilities?: ('jump' | 'spin')[] }
function start(id: string, seed: number, options: Options = {}): ForestEngine {
  const hp = options.hp ?? 5;
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed, template: { kind: 'battle', id }, row: options.row ?? 6,
    player: { hp, maxHp: Math.max(hp, 5), energy: options.energy ?? 0, ...(options.effects ? { damageEffects: { ...options.effects } } : {}) },
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: options.abilities ?? [],
    ...(options.talismans ? { talismans: options.talismans } : {}), ...(options.ward ? { wardReady: true } : {}) };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), `${id} starts`);
  return g;
}
/** A pure forecast, then real input; the cat's HP and the ward as forecast. */
async function play(g: ForestEngine, path: number[] | 'rest', where: string): Promise<ChainPreview> {
  const before = json(g.captureAnalysisSnapshot());
  const preview = path === 'rest' ? g.previewRest() : g.preview(path);
  assert(json(g.captureAnalysisSnapshot()) === before, `${where}: the forecast spends nothing`);
  assert(preview.valid, `${where}: ${preview.reason}`);
  const hp = g.state.player.hp, ward = !!g.state.player.ward;
  if (path === 'rest') assert(await g.waitTurn(), `${where}: rest`);
  else { assert(g.beginChain(path[0]), `${where}: begin`); for (const index of path.slice(1)) assert(g.extendChain(index), `${where}: extend ${index}`); assert(await g.releaseChain(), `${where}: release`); }
  assert(hp - g.state.player.hp === preview.damage, `${where}: damage ${preview.damage} forecast, ${hp - g.state.player.hp} taken`);
  assert(!!preview.playerDies === ((g.state.phase as ForestState['phase']) === 'LOSE'), `${where}: death as forecast`);
  assert(!!preview.wardSaves === (ward && !g.state.player.ward), `${where}: the ward is spent as forecast (${!!preview.wardSaves})`);
  return preview;
}

// Fields (5×5, the cat on C3 = 12 unless noted).
battle('spec-tal-open', ['GGGGG', 'RRRRR', 'RRHTR', 'BBBBB', 'BBBBD']);
const TARGET = 13;
battle('spec-tal-durable', ['GGGGG', 'GSGGG', 'GGHGG', 'BBBBB', 'TBBBD'], { S: { color: 1, hp: 2 } });
// Two armed goblins beside the cat by a side (C2, D3): goblins strike only by the four sides.
battle('spec-tal-strike', ['RRRRR', 'RRgRR', 'RRHgR', 'RRRRR', 'TRRRD']);
battle('spec-tal-quills', ['RRRRR', 'RRRRR', 'RPHRR', 'RRRRR', 'TRRRD'], { P: { color: 0, variant: 'porcupine', hp: 0 } });
battle('spec-tal-thorns', ['RRRRR', 'RRRRR', 'RKHRR', 'RRRRR', 'TRRRD'], { K: { color: 0, terrain: 'thorns' } });
// A pit lever on B3 that opens a pit on its own cell: the chain B2 → lever leaves the cat standing on the opening pit.
battle('spec-tal-pits', ['RRRRR', 'RRRRR', 'RLHRR', 'RRRRR', 'TRRRD'], { L: { device: { kind: 'pits', charges: 1, targets: ['B3'] } } });

async function whetstone() {
  for (let k = 1; k <= 3; k++) {
    // The first ordinary chain starts with a power of 1: a single hit takes a goblin with 2 HP.
    const g = start('spec-tal-durable', spread(k), { talismans: ['whetstone'] });
    const first = await play(g, [6], `seed ${k} first chain`);
    assert(first.whetstone && first.hits[0].availablePower === 2 && first.hits[0].killed, `seed ${k}: the Whetstone adds 1 to the first chain`);
    const plain = start('spec-tal-durable', spread(k));
    const without = plain.preview([6]);
    assert(!without.whetstone && without.hits[0].availablePower === 1 && !without.hits[0].killed, `seed ${k}: without it the single hit only wounds`);
    // The second ordinary chain starts from 0 again.
    const next = g.availableMoves(4)[0];
    if (next && g.state.phase === 'PLAYER_INPUT') assert(!g.preview(next).whetstone && g.preview(next).hits[0].availablePower === 1, `seed ${k}: only the first chain`);
  }
  console.log('PASS Whetstone: the first ordinary chain of a battle starts with a power of 1, forecast = execution');
}

async function millstoneHourglassPaws() {
  // Millstone shard: a crystal for 5 chain kills (column of five weak goblins).
  const path = [11, 10, 5, 6, 7];
  for (let k = 1; k <= 3; k++) {
    const g = start('spec-tal-open', spread(k), { talismans: ['millstone-shard'] });
    const preview = g.preview(path);
    assert(preview.valid && preview.kills === 5 && preview.crystals === 1, `seed ${k}: five kills drop a crystal (${preview.crystals})`);
    assert(!start('spec-tal-open', spread(k)).preview(path).crystals, `seed ${k}: without it five kills drop none`);
    await play(g, path, `seed ${k} millstone`);
  }
  // Hourglass: the first reinforcement comes 4 turns after the goals.
  const h = start('spec-tal-open', spread(1), { talismans: ['hourglass'] });
  const goal = h.availableMoves(8).find(candidate => candidate.includes(TARGET) && !candidate.includes(24));
  assert(goal, 'a chain through the target');
  await play(h, goal, 'hourglass goals');
  assert(h.state.customLevel!.goalCompletedTurn !== null && nextReinforcementTurn(h.state) === h.state.customLevel!.goalCompletedTurn! + 4, 'Hourglass: the first reinforcement at goal + 4');
  const plain = start('spec-tal-open', spread(1));
  await play(plain, goal, 'plain goals');
  assert(nextReinforcementTurn(plain.state) === plain.state.customLevel!.goalCompletedTurn! + 3, 'without it at goal + 3');
  // Nimble paws: the jump costs 1 energy.
  const p = start('spec-tal-open', spread(2), { talismans: ['nimble-paws'], energy: 1, abilities: ['jump'] });
  const jump = p.previewAbility('jump', 2);
  assert(jump.valid && jump.energyCost === 1, `Nimble paws: a jump for 1 energy (${jump.reason})`);
  assert(!start('spec-tal-open', spread(2), { energy: 1, abilities: ['jump'] }).previewAbility('jump', 2).valid, 'without them 1 energy is not enough');
  assert(await p.useAbility('jump', 2) && p.state.player.energy === 0, 'the jump spends 1');
  console.log('PASS Millstone shard (crystal for 5), Hourglass (reinforcement at goal + 4), Nimble paws (jump for 1)');
}

async function chestAndOaths() {
  const goal = (g: ForestEngine) => g.availableMoves(8).find(candidate => candidate.includes(TARGET) && !candidate.includes(24));
  const chestOf = async (talismans: TalismanId[]) => {
    const g = start('spec-tal-open', spread(3), { talismans });
    const path = goal(g); assert(path, 'goal chain'); await play(g, path, `chest ${talismans}`);
    return g.state.board.find(cell => cell?.chest)?.chest;
  };
  assert((await chestOf([]))?.length === 2 && (await chestOf(['ragman-pouch']))?.length === 3, 'Ragman\'s pouch: the chest holds 3');
  assert((await chestOf(['oath-poverty']))?.length === 0, 'Oath of poverty: the chest is empty');
  // Oaths: +1 energy at the start of every battle, capped at 7.
  assert(start('spec-tal-open', spread(1), { talismans: ['oath-hunger'], energy: 2 }).state.player.energy === 3, 'an oath adds 1 energy at the start');
  assert(start('spec-tal-open', spread(1), { talismans: ['oath-wrath'], energy: 7 }).state.player.energy === 7, 'up to 7');
  // Oath of wrath: 2 calm enemies become angry per turn before the goals.
  for (let k = 1; k <= 3; k++) {
    const g = start('spec-tal-open', spread(k), { talismans: ['oath-wrath'], hp: 40 });
    const w = start('spec-tal-open', spread(k), { hp: 40 });
    const a0 = angryOrdinaryCount(g.state.board), b0 = angryOrdinaryCount(w.state.board);
    await g.waitTurn(); await w.waitTurn();
    assert(angryOrdinaryCount(g.state.board) - a0 === 2 && angryOrdinaryCount(w.state.board) - b0 === 1, `seed ${k}: wrath makes 2 angry per turn before the goals (${angryOrdinaryCount(g.state.board) - a0})`);
  }
  console.log('PASS Ragman\'s pouch (+1), Oath of poverty (empty chest), oaths +1 energy (cap 7), Oath of wrath (2 angry per turn)');
}

async function ashWard() {
  for (let k = 1; k <= 3; k++) {
    const seed = spread(k);
    // An enemy's strike: two armed goblins beside the cat at 1 HP — the first lethal swing is saved, the second kills.
    const strike = start('spec-tal-strike', seed, { talismans: ['ash-ward'], ward: true, hp: 1 });
    strike.state.board.forEach(cell => { if (cell?.behavior.aggressive) cell.behavior.restTurns = 0; });
    const answer = await play(strike, 'rest', `seed ${k} strike`);
    assert(answer.wardSaves && answer.playerDies, `seed ${k}: the ward takes the first lethal swing, the second kills (forecast)`);
    // One lethal swing only: saved with 1 HP.
    const one = start('spec-tal-strike', seed, { talismans: ['ash-ward'], ward: true, hp: 2 });
    const once = await play(one, 'rest', `seed ${k} single strike`);
    if (once.damage) assert(once.wardSaves && one.state.player.hp === 1 && one.state.phase === 'PLAYER_INPUT', `seed ${k}: a lethal strike leaves 1 HP`);
    // Quills.
    const quills = start('spec-tal-quills', seed, { talismans: ['ash-ward'], ward: true, hp: 1 });
    const q = await play(quills, [11], `seed ${k} quills`);
    assert(q.wardSaves && quills.state.player.hp === 1 && !quills.state.player.ward, `seed ${k}: quills — saved with 1 HP`);
    // Thorns at the chain's end.
    const thorns = start('spec-tal-thorns', seed, { talismans: ['ash-ward'], ward: true, hp: 1 });
    const t = await play(thorns, [11], `seed ${k} thorns`);
    assert(t.wardSaves && thorns.state.player.hp === 1, `seed ${k}: thorns — saved`);
    // A bleeding step.
    const bleed = start('spec-tal-open', seed, { talismans: ['ash-ward'], ward: true, hp: 1, effects: { burning: 0, burningTurns: 0, poison: 0, bleeding: 1, bleedingSteps: 1 } });
    const b = await play(bleed, [11, 10], `seed ${k} bleeding`);
    assert(b.wardSaves && bleed.state.player.hp >= 1, `seed ${k}: a bleeding step — saved`);
    // A burning tick at the end of the turn.
    const burn = start('spec-tal-open', seed, { talismans: ['ash-ward'], ward: true, hp: 1, effects: { burning: 1, burningTurns: 0, poison: 0, bleeding: 0, bleedingSteps: 0 } });
    const f = await play(burn, 'rest', `seed ${k} burning`);
    assert(f.wardSaves && burn.state.player.hp === 1, `seed ${k}: a burning tick — saved`);
    // A pit lever opening under the cat: the fall is lethal; the ward leaves 1 HP.
    const pit = start('spec-tal-pits', seed, { talismans: ['ash-ward'], ward: true, hp: 3 });
    const fall = await play(pit, [6, 11], `seed ${k} pit`);
    assert(fall.wardSaves && pit.state.player.hp === 1 && pit.state.pits.some(entry => entry.index === 11), `seed ${k}: a pit under the cat — saved with 1 HP`);
    assert(start('spec-tal-pits', seed, { hp: 3 }).preview([6, 11]).playerDies, `seed ${k}: without the ward the pit kills`);
    // Without the ward the same quills kill.
    const bare = start('spec-tal-quills', seed, { hp: 1 });
    assert(bare.preview([11]).playerDies, `seed ${k}: without the ward the quills kill`);
    // The run learns that the ward crumbled.
    quills.winLevel();
    assert(quills.runBattleOutcome()?.wardUsed === true, `seed ${k}: the outcome reports the spent ward`);
    const kept = start('spec-tal-open', seed, { talismans: ['ash-ward'], ward: true });
    kept.winLevel();
    assert(!kept.runBattleOutcome()?.wardUsed, `seed ${k}: an unused ward stays`);
  }
  console.log('PASS Ash ward: strike, quills, thorns, bleeding, burning, a pit — 1 HP and the ward spent, as forecast; a second lethal hit kills; the run is told');
}

async function replay() {
  const run = async (seed: number) => {
    const g = start('spec-tal-open', seed, { talismans: ['whetstone', 'millstone-shard', 'hourglass', 'oath-wrath', 'ash-ward'], ward: true, hp: 3 });
    for (let n = 0; n < 4 && g.state.phase === 'PLAYER_INPUT'; n++) {
      const path = g.availableMoves(5)[0]; if (path) { g.beginChain(path[0]); for (const index of path.slice(1)) g.extendChain(index); await g.releaseChain(); } else await g.waitTurn();
    }
    return json(g.captureAnalysisSnapshot());
  };
  for (let k = 1; k <= 3; k++) assert(await run(spread(k)) === await run(spread(k)), `seed ${k}: exact replay with talismans`);
  console.log('PASS exact replay with talismans');
}

await whetstone();
await millstoneHourglassPaws();
await chestAndOaths();
await ashWard();
await replay();
console.log('PASS talismans (battle effects)');
