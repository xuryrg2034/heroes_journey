/**
 * Goblin-barricade and camp node battles (src/game/run/battles/goblins.ts, docs/levels/forest-nodes-goblins.md).
 * Every battle starts through ForestEngine.startRunBattle exactly as in a run: the refill seed and the row palette
 * come from the setup, the cat has 5/5 HP and 0 energy, tools are those guaranteed on the row.
 * The checks play real commands: intended routes on several refill seeds, forecast against execution,
 * traps visible in the forecast, replay by seed, refill variety. No bot is expected to win or lose.
 * Every battle ends through its exit (decision of 02.10.2026): the goals only open the door, the victory is entering it.
 * Where the way to the door runs over refilled cells, it is found by a search over real commands, never fixed.
 */
import { hasOrdinaryChain } from './boardGeneration';
import { shieldIsActive } from './combatRules';
import { ELITE_HP_FACTOR, heroStrikeDamage } from './elite';
import { nextReinforcementTurn, REINFORCEMENT_DELAY } from './exitRules';
import { ForestEngine } from './forestEngine';
import type { ChainPreview } from './forestTypes';
import { GOBLIN_BATTLES } from './run/battles/goblins';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import type { RunBattleSetup, RunPlayerResources } from './run/runBattle';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const json = (value: unknown) => JSON.stringify(value);

/** Map row each battle is designed for (docs/levels/forest-nodes-goblins.md, «Узлы»). */
const ROWS: Record<string, number> = {
  'goblin-archer-watch': 5, 'goblin-shield-flank': 6, 'goblin-shaman-rite': 7,
  'camp-cauldron-ring': 10, 'camp-shield-wall': 12, 'camp-gate-run': 13,
};
/** Refill seeds as a run would derive them; the authored layout does not depend on them. */
const SEEDS = [9601, 17, 4242, 777001, 31337];
/**
 * Spread refill seeds for battles with an elite (its loot is a 50% roll of the battle RNG). The first draw of the
 * generator barely differs for neighbouring small seeds, so they are spread by the golden ratio; k = 1…3 and 13…15
 * cover both outcomes of the loot roll in camp-shield-wall.
 */
const ELITE_SEEDS = [1, 2, 3, 13, 14, 15].map(k => Math.imul(k, 2654435761) >>> 0);

function setupFor(id: string, seed: number, player: RunPlayerResources = { hp: 5, maxHp: 5, energy: 0 }, frost = 0): RunBattleSetup {
  const battle = forestBattle(id)!, row = ROWS[id], tools = guaranteedRowTools(row)!;
  return { nodeId: `spec-${id}`, label: battle.name, seed, template: { kind: 'battle', id }, row, player,
    inventory: { frost, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, row) };
}

type Action = { chain: string[] } | { ability: 'jump' | 'spin'; target?: string } | { rest: true };

/** A running battle that records every committed action for the replay check. */
class Play {
  readonly g = new ForestEngine();
  readonly log: Action[] = [];
  readonly snapshots: string[] = [];
  constructor(readonly id: string, readonly seed: number, player?: RunPlayerResources, frost = 0) {
    this.g.animationScale = 0;
    assert(this.g.startRunBattle(setupFor(id, seed, player, frost)), `${id}: starts as a node battle (seed ${seed})`);
    this.snapshots.push(json(this.g.state));
  }
  at(label: string) { return (Number(label.slice(1)) - 1) * this.g.state.cols + label.charCodeAt(0) - 65; }
  cell(label: string) { return this.g.state.board[this.at(label)]; }
  preview(...labels: string[]): ChainPreview {
    const before = json(this.g.state), rng = this.g.captureAnalysisSnapshot().rng;
    const prediction = this.g.preview(labels.map(label => this.at(label)));
    assert(json(this.g.state) === before && this.g.captureAnalysisSnapshot().rng === rng, `${this.id}: preview ${labels.join('-')} is pure`);
    return prediction;
  }
  /** Commit a chain by real input and compare everything the forecast promised with the result. */
  async chain(...labels: string[]): Promise<ChainPreview> {
    const { g } = this, path = labels.map(label => this.at(label)), hp = g.state.player.hp;
    const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
    const prediction = this.preview(...labels);
    assert(prediction.valid, `${this.id} (seed ${this.seed}): ${labels.join('-')} — ${prediction.reason}`);
    assert(g.beginChain(path[0]), 'chain starts');
    for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
    assert(await g.releaseChain(), 'chain commits');
    this.after(prediction, hp, colors);
    this.log.push({ chain: labels });
    return prediction;
  }
  async ability(ability: 'jump' | 'spin', target?: string): Promise<ChainPreview> {
    const { g } = this, index = target === undefined ? undefined : this.at(target), hp = g.state.player.hp, energy = g.state.player.energy;
    const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
    const before = json(g.state);
    const prediction = g.previewAbility(ability, index);
    assert(json(g.state) === before, `${this.id}: ${ability} preview is pure`);
    assert(prediction.valid, `${this.id} (seed ${this.seed}): ${ability} ${target ?? ''} — ${prediction.reason}`);
    assert(await g.useAbility(ability, index), `${ability} commits`);
    assert(g.state.player.energy === energy - prediction.energyCost, `${ability}: energy spent as forecast`);
    this.after(prediction, hp, colors);
    this.log.push({ ability, target });
    return prediction;
  }
  private after(prediction: ChainPreview, hp: number, colors: Map<number, number | null>) {
    const { state } = this.g;
    assert(state.lastDamage === prediction.damage && state.player.hp === hp - prediction.damage, `${this.id}: damage ${state.lastDamage} matches forecast ${prediction.damage}`);
    assert(state.player.index === prediction.endIndex, `${this.id}: endpoint matches forecast`);
    assert((state.phase === 'LOSE') === !!prediction.playerDies, `${this.id}: death matches forecast`);
    assert((state.phase === 'WIN') === !!prediction.completesRoom, `${this.id}: completion matches forecast`);
    const alive = new Set(state.board.flatMap(cell => cell ? [cell.id] : []));
    // The enemy phase is forecast on a copy: every creature it kills (arrows included) is gone afterwards.
    if (state.phase === 'PLAYER_INPUT') {
      for (const death of prediction.enemyPhase?.deaths ?? []) assert(!alive.has(death.id), `${this.id}: forecast ${death.cause} death happened`);
      for (const raised of prediction.enemyPhase?.empowered ?? []) {
        const cell = state.board.find(entry => entry?.id === raised.id);
        assert(cell && cell.behavior.tier === raised.tier && !cell.behavior.passive, `${this.id}: forecast rite raised ${raised.id} to ${raised.tier}`);
      }
      assert(hasOrdinaryChain(state), `${this.id} (seed ${this.seed}): an ordinary chain is available after the turn`);
    }
    const palette = state.customLevel!.paletteWeights;
    for (const cell of state.board) {
      if (!cell || cell.kind !== 'melee' || cell.variant) continue;
      if (colors.has(cell.id)) assert(cell.color === colors.get(cell.id), `${this.id}: survivors keep their color`);
      else assert(cell.color !== null && palette[cell.color] > 0, `${this.id}: refills use the row palette`);
    }
    this.snapshots.push(json(state));
  }
  won(hp: number) { assert(this.g.state.phase === 'WIN' && this.g.state.player.hp === hp, `${this.id} (seed ${this.seed}): victory with ${hp} HP, got ${this.g.state.phase} ${this.g.state.player.hp}`); }
  label(index: number) { return String.fromCharCode(65 + index % this.g.state.cols) + (Math.floor(index / this.g.state.cols) + 1); }
  door() { return this.g.state.board.findIndex(cell => cell?.kind === 'door'); }
  /** The goals are met, the door is open and the battle goes on: meeting the goals is no victory. */
  goalsMet() {
    const door = this.g.state.board[this.door()];
    assert(this.g.state.phase === 'PLAYER_INPUT' && door?.intent.label === 'Выход открыт', `${this.id} (seed ${this.seed}): the goals open the door and the battle goes on`);
  }
  /**
   * The way out over refilled cells: a search of real moves (no death, least damage first) for a chain into the open door
   * within `turns` turns, then committed by real input. Returns the number of turns it took.
   */
  async leave(turns: number): Promise<number> {
    const { g } = this, root = g.captureAnalysisSnapshot(), door = this.door();
    const search = async (depth: number): Promise<number[][] | null> => {
      const moves = g.availableMoves(16).map(path => ({ path, p: g.preview(path) })).filter(move => move.p.valid && !move.p.playerDies);
      const exit = moves.filter(move => move.p.completesRoom && move.path.at(-1) === door).sort((a, b) => a.path.length - b.path.length)[0];
      if (exit) return [exit.path];
      if (depth <= 1) return null;
      const snapshot = g.captureAnalysisSnapshot();
      for (const { path } of moves.sort((a, b) => a.p.damage - b.p.damage).slice(0, 8)) {
        assert(g.beginChain(path[0]) && path.slice(1).every(step => g.extendChain(step)) && await g.releaseChain(), 'search move commits');
        const rest = g.state.phase === 'PLAYER_INPUT' ? await search(depth - 1) : null;
        g.restoreAnalysisSnapshot(snapshot);
        if (rest) return [path, ...rest];
      }
      return null;
    };
    const plan = await search(turns);
    g.restoreAnalysisSnapshot(root);
    if (!plan) throw new Error(`${this.id} (seed ${this.seed}): the open door is reached within ${turns} turn(s)`);
    for (const path of plan) await this.chain(...path.map(index => this.label(index)));
    assert(this.g.state.phase === 'WIN' && this.g.state.player.index === door, `${this.id}: the cat leaves through the door`);
    return plan.length;
  }
}

/** Replay the recorded actions on a fresh engine with the same seed: every snapshot must repeat exactly. */
async function replayMatches(play: Play) {
  const again = new Play(play.id, play.seed);
  assert(again.snapshots[0] === play.snapshots[0], `${play.id}: same start`);
  for (const [step, action] of play.log.entries()) {
    if ('chain' in action) await again.chain(...action.chain);
    else if ('ability' in action) await again.ability(action.ability, action.target);
    assert(again.snapshots[step + 1] === play.snapshots[step + 1], `${play.id}: replay by seed repeats step ${step + 1}`);
  }
}

/** Goblin trail battles of 04.10.2026 (pools of rows 5–8, no fixed node): verified by goblinTrailBattles.spec.ts. */
const TRAIL_BATCH = ['goblin-watch-relief', 'goblin-pike-gate'];
const DESIGNED = GOBLIN_BATTLES.filter(battle => !TRAIL_BATCH.includes(battle.id));

function layouts() {
  const frames = new Set<string>();
  assert(DESIGNED.length === Object.keys(ROWS).length, 'six goblin battles');
  for (const battle of DESIGNED) {
    const row = ROWS[battle.id], { definition } = battle;
    assert(row !== undefined, `${battle.id}: has a designed row`);
    assert(validateNodeBattle(battle).length === 0, `${battle.id}: ${validateNodeBattle(battle).join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${battle.id}: field 5×5…7×7`);
    // The opening uses exactly the colors of its row, so the node palette is the row palette (never narrower or wider).
    const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(json([...colors].sort()) === json([...forestRowPalette(row)].sort()), `${battle.id}: opening uses the ${forestRowPalette(row).length} colors of row ${row}`);
    assert(json(authoredRefillPalette(battle, row)) === json([0, 1, 2, 3, 4].map(color => forestRowPalette(row).includes(color as never) ? 100 : 0)), `${battle.id}: refill palette equals the row palette`);
    const frame = `${definition.cols}x${definition.rows}:${definition.heroIndex}:${definition.terrain.map(terrain => terrain === 'wall' ? '#' : '.').join('')}`;
    assert(!frames.has(frame), `${battle.id}: own field shape and cat position`);
    frames.add(frame);
  }
}

/** A cat arriving with 1 HP has at least one safe first move in every battle: no death from the first turn. */
function woundedArrival() {
  for (const battle of DESIGNED) {
    const play = new Play(battle.id, SEEDS[0], { hp: 1, maxHp: 5, energy: 0 });
    const safe = play.g.availableMoves(16).some(path => { const p = play.g.preview(path); return p.valid && !p.playerDies && p.damage === 0; });
    assert(safe, `${battle.id}: a safe first chain exists at 1 HP`);
  }
}

async function archerWatch() {
  for (const seed of SEEDS) {
    // Trap in the forecast: killing the guard on the announced line D2–D4 leaves the cat under the arrow.
    const lesson = new Play('goblin-archer-watch', seed);
    const archer = lesson.cell('D1')!;
    assert(json(archer.intent.cells) === json(['D2', 'D3', 'D4'].map(label => lesson.at(label))), 'the archer announces D2–D4');
    const onLine = lesson.preview('C4', 'C3', 'D3');
    assert(onLine.valid && onLine.endIndex === lesson.at('D3') && onLine.damage === 1 && onLine.damageBySource.ranged === 1 && !onLine.playerDies,
      'the forecast shows the arrow for a chain that ends on the line');
    // Wound the guard and step aside: the arrow finishes it and the kill counts.
    const guard = lesson.cell('D3')!;
    const wound = await lesson.chain('C4', 'D3');
    assert(wound.hits.at(-1)?.index === lesson.at('D3') && !wound.hits.at(-1)?.killed && wound.hits.at(-1)?.hpAfter === 1, 'the chain only wounds the guard');
    assert(wound.enemyPhase!.deaths.some(death => death.id === guard.id && death.cause === 'arrow'), 'the forecast shows the arrow finishing the guard');
    assert(lesson.g.state.objective.tutorialTargets === 1 && lesson.g.state.player.hp === 5, 'the arrow kill counts as the player’s target');
    // The way out «nearby»: after the wound the archer is the last goal, and whenever a chain can kill it, the same chain
    // continues into the door C2 beside it. That chain runs over refilled cells, so it is searched among the real moves;
    // when the refill gives no chain to the archer, the second turn leads out.
    assert(lesson.cell('C2')!.kind === 'door' && lesson.cell('C2')!.intent.label === 'Выполни цели', 'the door C2 is closed until the goals');
    const archerNow = lesson.g.availableMoves(16).some(path => { const p = lesson.g.preview(path); return p.valid && p.hits.some(hit => hit.killed && lesson.g.state.board[hit.index]?.kind === 'ranged'); });
    const turns = await lesson.leave(2);
    assert(!archerNow || turns === 1, 'the chain that kills the archer after the wound leaves through C2 at once');
    // Priority target: the archer first, then the guard, deterministic on every refill seed.
    const priority = new Play('goblin-archer-watch', seed);
    await priority.chain('E4', 'E3', 'E2', 'D1');
    assert(!priority.g.state.board.some(cell => cell?.kind === 'ranged'), 'the archer falls first');
    const stay = priority.preview('D2', 'C3', 'D3');
    assert(stay.valid && !stay.completesRoom && stay.opensDoor === undefined, 'killing the guard without the door is no victory');
    // The same winning chain continues into the door C2 (diagonal to the guard's cell): the victory comes before the answer.
    const out = await priority.chain('D2', 'C3', 'D3', 'C2');
    assert(out.opensDoor === priority.at('C2') && out.completesRoom && out.hits.at(-2)?.killed, 'the forecast opens the door mid-chain');
    priority.won(5);
    if (seed === SEEDS[0]) await replayMatches(priority);
    // Meeting the goals without the door: the battle goes on, the cat may leave later from beside the door.
    const later = new Play('goblin-archer-watch', seed);
    await later.chain('E4', 'E3', 'E2', 'D1');
    await later.chain('D2', 'C3', 'D3');
    later.goalsMet();
    await later.chain('C2');
    later.won(later.g.state.player.hp);
  }
  // The node grants one frost flask: the archer stands in a puddle, so freezing it cancels the announced shot.
  const frost = new Play('goblin-archer-watch', SEEDS[0], undefined, 1);
  assert(frost.g.useItem('frost', frost.at('D1')) && frost.cell('D1')!.status.frozen > 0, 'the wet archer can be frozen');
  const safe = frost.preview('C4', 'C3', 'D3');
  assert(safe.valid && safe.damage === 0 && !(safe.enemyPhase?.deaths ?? []).some(death => death.cause === 'arrow'), 'a frozen archer does not shoot');
}

async function shieldFlank() {
  for (const seed of SEEDS) {
    const play = new Play('goblin-shield-flank', seed), bearer = play.cell('C4')!;
    assert(shieldIsActive(bearer) && bearer.shield?.dy === -1, 'the shield faces the cat above');
    const direct = play.preview('D2', 'C3', 'C4');
    assert(!direct.valid && direct.reason.includes('Щит'), 'the red pocket cannot enter from the shield side');
    const bait = play.preview('D2', 'C2', 'B2', 'C3');
    assert(bait.valid && bait.damage === 1 && bait.damageBySource.melee === 1, 'the forecast shows the bearer striking a chain that stops beside it');
    await play.chain('E2', 'F2', 'G2', 'G3', 'F3', 'E4', 'E3');
    assert(bearer.shield?.dx === 1 && !bearer.shield.dy, 'the cat in the east turns the shield away from the pocket');
    const stay = play.preview('D2', 'C2', 'B2', 'B3', 'C3', 'C4');
    assert(stay.valid && !stay.completesRoom, 'killing the bearer without the door is no victory');
    // The exit C5 is the gap the bearer guards: the chain that kills it continues into the door at once.
    // The pocket D2, C3 is sturdy (1 HP each, so it keeps its color under prototype A); B3 is the extra fuel (05.10.2026).
    const out = await play.chain('D2', 'C2', 'B2', 'B3', 'C3', 'C4', 'C5');
    assert(out.opensDoor === play.at('C5') && out.completesRoom, 'the forecast opens the door behind the bearer mid-chain');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);
  }
}

async function shamanRite() {
  for (const seed of [...SEEDS, ...ELITE_SEEDS]) {
    const play = new Play('goblin-shaman-rite', seed), shaman = play.cell('E1')!, bearer = play.cell('E3')!;
    assert(bearer.shield?.dy === 1, 'the breach faces the cat below');
    await play.chain('E5', 'F5', 'G5', 'G4');
    assert(bearer.shield?.dx === 1 && !bearer.shield.dy && shaman.intent.empowerIds?.length === 2, 'the shield turns east; the rite is announced');
    // «Now»: through the breach from below; the shaman dies before its rite.
    const now = play.preview('F4', 'E4', 'E3', 'E2', 'F1', 'E1');
    assert(now.valid && now.enemyPhase!.empowered.length === 0, 'killing the shaman cancels the rite in the forecast');
    await play.chain('F4', 'E4', 'E3', 'E2', 'F1', 'E1');
    // The jump takes the last goal and opens the door C1 beside the landing cell; the exit is one turn later («ход»).
    await play.ability('jump', 'B1');
    play.goalsMet();
    assert(play.g.state.player.hp === 5, 'the answer after the jump costs nothing');
    await play.chain('C1');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);

    // «Later»: a turn spent elsewhere lets the rite arm both announced goblins, as forecast.
    const later = new Play('goblin-shaman-rite', seed);
    await later.chain('E5', 'F5', 'G5', 'G4');
    const announced = [...later.cell('E1')!.intent.empowerIds!];
    const delay = await later.chain('F4', 'E4');
    assert(json(delay.enemyPhase!.empowered.map(entry => entry.id).sort()) === json([...announced].sort()), 'the forecast names both raised goblins');
    assert(delay.damage === 1, 'stopping under the bearer costs a blow');
  }
}

async function cauldronRing() {
  const exits: number[] = [];
  for (const seed of [...SEEDS, ...ELITE_SEEDS]) {
    const play = new Play('camp-cauldron-ring', seed);
    for (const [bait, guard] of [[['F6', 'F7', 'E6', 'D5', 'C5', 'C4'], 'B4'], [['F6', 'F7', 'E6', 'D5', 'E4'], 'F4']] as const) {
      const prediction = play.preview(...bait);
      assert(prediction.valid && prediction.damage === 1 && prediction.damageBySource.melee === 1, `the armed goblin ${guard} strikes a chain that stops beside it`);
    }
    const ring = await play.chain('F6', 'F7', 'E6', 'D5', 'C5', 'C4', 'D3');
    assert(ring.damage === 0 && play.g.state.player.energy >= 3, 'the pocket D3 is safe and the chain pays for the spin');
    const spin = await play.ability('spin');
    assert(spin.kills >= 3, 'the spin takes the shaman and both guards');
    // The goals open the gate D1 two rows above the cauldron: a chain over the refilled ring (C2, D2, E2) leads out.
    // After the goals refills may come as elites (12%), so a ring of 2-HP elites can cost a second turn.
    play.goalsMet();
    exits.push(await play.leave(2));
    if (seed === SEEDS[0]) await replayMatches(play);
  }
  assert(exits.filter(turns => turns === 1).length >= exits.length - 2, `the gate is one turn away on most seeds (${exits.join(',')})`);
}

async function shieldWall() {
  const drops = new Set<boolean>();
  let lootAndLeave = 0;
  for (const seed of [...SEEDS, ...ELITE_SEEDS]) {
    const play = new Play('camp-shield-wall', seed), archer = play.cell('A7')!;
    // The elite archer: authored 3 HP doubled at load, its arrow hits the cat for 2 (the same forecast as execution).
    assert(archer.kind === 'ranged' && archer.elite && archer.hp === 3 * ELITE_HP_FACTOR && archer.maxHp === 6, 'the archer A7 is an elite with 6 HP');
    assert(json(archer.intent.cells) === json(['B7', 'C7', 'D7'].map(label => play.at(label))) && heroStrikeDamage(archer) === 2,
      'the elite announces the flank path B7–D7 and hits the cat for 2');
    const straight = play.preview('E5', 'D4', 'C4');
    assert(!straight.valid && straight.reason.includes('Щит'), 'the wall cannot be entered from the cat’s side');
    const bait = play.preview('E5', 'E4', 'D4');
    assert(bait.valid && ['B7', 'C7', 'D7'].every(label => bait.enemyPhase!.deaths.some(death => death.index === play.at(label) && death.cause === 'arrow')),
      'the forecast shows the arrow clearing the flank path when the cat stays');
    // Too short a run only wounds the elite; the cat stops on its line and the forecast shows the elite arrow (2).
    const wound = play.preview('E7', 'D7', 'C7', 'B7', 'A7');
    assert(wound.valid && wound.hits.at(-1)?.hpAfter === 1 && wound.endIndex === play.at('B7') && wound.damage === 2 && wound.damageBySource.ranged === 2,
      'a short run wounds the elite and leaves the cat under a 2-damage arrow');
    // One chain takes one pocket: the elite and then the shaman is refused.
    const both = play.preview('E7', 'D7', 'C7', 'B7', 'A7', 'B6', 'B5', 'A4');
    assert(!both.valid, 'one chain cannot take the elite and the shaman');

    // The trap: the lane spent on the shaman leaves the elite out of the jump's reach (it would survive the landing).
    const trap = new Play('camp-shield-wall', seed);
    await trap.chain('E7', 'D7', 'C7', 'B7', 'B6', 'B5', 'A4');
    assert(!trap.g.state.board.some(cell => cell?.variant === 'shaman') && trap.g.state.player.energy >= 2, 'the lane reaches the shaman behind the wall');
    const late = trap.g.previewAbility('jump', trap.at('A7'));
    assert(!late.valid && trap.cell('A7')?.hp === 6, 'the forecast refuses to jump on the 6-HP elite');

    // The answer: the lane to the elite (6 enemies, power 6), then the jump finishes the shaman — with or without loot.
    const play2 = new Play('camp-shield-wall', seed);
    const lane = await play2.chain('E7', 'D7', 'C7', 'B6', 'B7', 'A7');
    assert(lane.hits.at(-1)?.killed && lane.hits.at(-1)?.availablePower === 6 && lane.damage === 0, 'the lane kills the elite at exactly 6 power');
    const loot = play2.g.state.board.filter(cell => cell?.loot);
    assert(loot.length <= 1 && loot.every(cell => cell!.loot === 'frost'), 'the elite drops at most one loot, a consumable open in this setup (frost only)');
    drops.add(loot.length === 1);
    await play2.ability('jump', 'A4');
    // The jump meets the goals and opens the door A6 below the shaman's pocket (04.10.2026, was A1); the battle goes on,
    // so the dropped loot stays on the field and can be taken on the way out — at the price of turns under growing anger.
    play2.goalsMet();
    assert(play2.g.state.board.filter(cell => cell?.loot).length === loot.length, 'the dropped loot waits on the field after the goals');
    if (loot.length) {
      const door = play2.door();
      if (play2.g.availableMoves(16).some(path => path.at(-1) === door && path.some(index => play2.g.state.board[index]?.loot) && play2.g.preview(path).completesRoom)) lootAndLeave++;
    }
    // The way out is one turn («ход»): the blue A5 between the pocket and the door leads out.
    const exit = play2.preview('A5', 'A6');
    assert(exit.valid && exit.completesRoom && exit.damage === 0, 'the blue A5 leads out through A6');
    assert(await play2.leave(1) === 1, 'the exit is one turn after the jump');
    play2.won(5);
    if (seed === SEEDS[0]) await replayMatches(play2);
  }
  assert(drops.size === 2, 'the answer holds both when the elite drops loot and when it does not');
  assert(lootAndLeave > 0, 'on some seeds one chain both takes the loot and leaves');
  // Without the jump the elite can still be wounded and finished, paying 2 HP to its arrow.
  const slow = new Play('camp-shield-wall', ELITE_SEEDS[0]);
  await slow.chain('E7', 'D7', 'C7', 'B7', 'A7');
  // Elites move (decision of 01.10.2026): a resting elite archer retreats from a cat closer than 3 cells. In the corner
  // A7 neither side (A6, B7) is farther from the cat on B7, so the wounded elite stays in its pocket.
  const resting = slow.cell('A7')!;
  assert(resting.elite && resting.behavior.restTurns > 0 && resting.intent.moveTo === undefined, 'the resting elite has nowhere to retreat from the corner');
  await slow.chain('A7', 'B6', 'B5', 'A4');
  slow.goalsMet();
  await slow.leave(1);
  slow.won(3);
  // A frost flask carried by the run (the node goblin-archer grants one) makes the elite brittle: then the lane may take
  // the shaman and the jump (4 × 2) kills the 6-HP elite. A legal use of frost, not a rule bent for the route.
  const frost = new Play('camp-shield-wall', ELITE_SEEDS[0], undefined, 1);
  assert(frost.g.useItem('frost', frost.at('A7')) && frost.cell('A7')!.status.brittle, 'frost makes the elite brittle');
  await frost.chain('E7', 'D7', 'C7', 'B7', 'B6', 'B5', 'A4');
  await frost.ability('jump', 'A7');
  // This way ends in the elite's corner A7, beside the door A6 (04.10.2026; with the door on A1 it took up to two turns).
  frost.goalsMet();
  await frost.leave(2);
  // Energy carries over between nodes. With 3 or 7 at the entry no first action wins at once (the jump from F6 reaches
  // neither target, the spin does not kill the elite), and the answer still holds on spread seeds.
  for (const energy of [3, 7]) for (const seed of ELITE_SEEDS) {
    const play = new Play('camp-shield-wall', seed, { hp: 5, maxHp: 5, energy });
    const { g } = play, cells = g.state.board.map((_cell, index) => index);
    const instant = [...g.availableMoves(16).map(path => g.preview(path)),
      ...cells.map(index => g.previewAbility('jump', index)), g.previewAbility('spin')].filter(p => p.valid && p.completesRoom);
    assert(instant.length === 0, `camp-shield-wall (energy ${energy}, seed ${seed}): no one-turn win`);
    assert(!g.previewAbility('jump', play.at('A7')).valid, 'carried energy does not let the jump take the elite');
    await play.chain('E7', 'D7', 'C7', 'B6', 'B7', 'A7');
    await play.ability('jump', 'A4');
    await play.leave(1);
    play.won(5);
  }
}

/**
 * Breakthrough, class «ход» (03.10.2026): the goal «hold one turn» is met after the first enemy answer, so the first
 * chain is forecast «ВЫХОД ОТКРОЕТСЯ ПОСЛЕ ОТВЕТА ВРАГОВ», the chest falls at the end of turn 1, the reinforcement is
 * due after turn 4, and the gate is entered on turn 2.
 */
async function gateRun() {
  for (const seed of SEEDS) {
    const play = new Play('camp-gate-run', seed), gate = play.cell('C1')!;
    assert(gate.kind === 'door' && gate.intent.label === 'Выполни цели', 'the gate is closed on the first turn');
    const first = play.preview('B4', 'A3', 'A2', 'B3');
    assert(first.valid && !first.unlocksExit && first.enemyPhase?.unlocksExit, 'the first chain opens the gate only after the enemies answer');
    await play.chain('B4', 'A3', 'A2', 'B3');
    assert(play.cell('C1')!.intent.label === 'Выход открыт', 'the gate opens after the first turn');
    assert(play.g.state.customLevel!.goalCompletedTurn === 1 && play.g.state.board.some(cell => !!cell?.chest), 'the chest falls at the end of the first turn');
    assert(nextReinforcementTurn(play.g.state) === 1 + REINFORCEMENT_DELAY, 'the reinforcement is due after turn 4');
    await play.chain('C2', 'C3', 'D2', 'C1');
    play.won(5);
    assert(play.g.state.player.index === play.at('C1'), 'the cat leaves through the gate');
    if (seed === SEEDS[0]) await replayMatches(play);
  }
}

/** Refills after the same first move differ between seeds; the authored start never does. */
async function refillVariety() {
  const firstMoves: Record<string, string[]> = {
    'goblin-archer-watch': ['C4', 'D3'], 'goblin-shield-flank': ['E2', 'F2', 'G2', 'G3', 'F3', 'E4', 'E3'],
    'goblin-shaman-rite': ['E5', 'F5', 'G5', 'G4'], 'camp-cauldron-ring': ['F6', 'F7', 'E6', 'D5', 'C5', 'C4', 'D3'],
    'camp-shield-wall': ['E7', 'D7', 'C7', 'B6', 'B7', 'A7'], 'camp-gate-run': ['B4', 'A3', 'A2', 'B3'],
  };
  for (const [id, move] of Object.entries(firstMoves)) {
    const starts = new Set<string>(), refills = new Set<string>();
    for (const seed of SEEDS) {
      const play = new Play(id, seed);
      starts.add(json(play.g.state.board.map(cell => cell?.color ?? null)));
      await play.chain(...move);
      refills.add(json(play.g.state.board.map(cell => cell?.color ?? null)));
    }
    assert(starts.size === 1, `${id}: the authored start is the same for every seed`);
    assert(refills.size > 1, `${id}: refills differ between seeds`);
  }
}

layouts();
woundedArrival();
await archerWatch();
await shieldFlank();
await shamanRite();
await cauldronRing();
await shieldWall();
await gateRun();
await refillVariety();
console.log('goblin battles: layouts, routes on five refill seeds (eleven for the elite and the «one turn» exits), exits through the door, forecasts, traps, replay and refill variety pass');
