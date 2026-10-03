/**
 * Camp branch battles for the pools of rows 10–12 (src/game/run/battles/camp.ts, docs/levels/forest-branch-camp.md).
 * Every battle starts through ForestEngine.startRunBattle exactly as in a run: refill seed and row palette from the
 * setup, the cat's HP and energy (0, 3 and 7 — the run carries energy), the tools guaranteed on the row.
 * The checks play real commands: intended routes on spread refill seeds, forecast against execution, the traps of the
 * main decision visible in the forecast, replay by seed, refill variety and a protracted variant (goals on turns 10–16
 * still leave a way out). Ways over refilled cells are found by a search over real moves, never fixed. No bot is
 * expected to win or lose.
 */
import { hasOrdinaryChain } from './boardGeneration';
import { shieldIsActive } from './combatRules';
import { ELITE_HP_FACTOR } from './elite';
import { ForestEngine } from './forestEngine';
import type { ChainPreview } from './forestTypes';
import { CAMP_BATTLES } from './run/battles/camp';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import type { RunBattleSetup, RunPlayerResources } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const json = (value: unknown) => JSON.stringify(value);

/** The branch rows: a pool battle may come on any of them. Row 11 is the analysis row. */
const BRANCH_ROWS = [10, 11, 12];
const ROW = 11;
/** Spread refill seeds (golden ratio): neighbouring small seeds barely differ in the first draws. */
const SEEDS = [1, 2, 3, 4, 5, 13, 14, 15].map(k => Math.imul(k, 2654435761) >>> 0);
const ENERGIES = [0, 3, 7];

function setupFor(id: string, seed: number, energy = 0, row = ROW, hp = 5): RunBattleSetup {
  const battle = forestBattle(id)!, tools = guaranteedRowTools(row)!;
  const player: RunPlayerResources = { hp, maxHp: 5, energy };
  return { nodeId: `spec-${id}`, label: battle.name, seed, template: { kind: 'battle', id }, row, player,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, row) };
}

type Action = { chain: string[] } | { ability: 'jump' | 'spin'; target?: string };

/** A running battle that records every committed action for the replay check. */
class Play {
  readonly g = new ForestEngine();
  readonly log: Action[] = [];
  readonly snapshots: string[] = [];
  constructor(readonly id: string, readonly seed: number, readonly energy = 0, readonly row = ROW, hp = 5) {
    this.g.animationScale = 0;
    assert(this.g.startRunBattle(setupFor(id, seed, energy, row, hp)), `${id}: starts as a node battle (seed ${seed})`);
    this.snapshots.push(json(this.g.state));
  }
  get where() { return `${this.id} (seed ${this.seed}, energy ${this.energy}, row ${this.row})`; }
  at(label: string) { return (Number(label.slice(1)) - 1) * this.g.state.cols + label.charCodeAt(0) - 65; }
  cell(label: string) { return this.g.state.board[this.at(label)]; }
  label(index: number) { return String.fromCharCode(65 + index % this.g.state.cols) + (Math.floor(index / this.g.state.cols) + 1); }
  door() { return this.g.state.board.findIndex(cell => cell?.kind === 'door'); }
  preview(...labels: string[]): ChainPreview {
    const before = json(this.g.state), rng = this.g.captureAnalysisSnapshot().rng;
    const prediction = this.g.preview(labels.map(label => this.at(label)));
    assert(json(this.g.state) === before && this.g.captureAnalysisSnapshot().rng === rng, `${this.where}: preview ${labels.join('-')} is pure`);
    return prediction;
  }
  /** Commit a chain by real input and compare everything the forecast promised with the result. */
  async chain(...labels: string[]): Promise<ChainPreview> {
    const { g } = this, path = labels.map(label => this.at(label)), hp = g.state.player.hp;
    const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
    const prediction = this.preview(...labels);
    assert(prediction.valid, `${this.where}: ${labels.join('-')} — ${prediction.reason}`);
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
    assert(json(g.state) === before, `${this.where}: ${ability} preview is pure`);
    assert(prediction.valid, `${this.where}: ${ability} ${target ?? ''} — ${prediction.reason}`);
    assert(await g.useAbility(ability, index), `${ability} commits`);
    assert(g.state.player.energy === energy - prediction.energyCost, `${ability}: energy spent as forecast`);
    this.after(prediction, hp, colors);
    this.log.push({ ability, target });
    return prediction;
  }
  private after(prediction: ChainPreview, hp: number, colors: Map<number, number | null>) {
    const { state } = this.g;
    assert(state.lastDamage === prediction.damage && state.player.hp === hp - prediction.damage, `${this.where}: damage ${state.lastDamage} matches forecast ${prediction.damage}`);
    assert(state.player.index === prediction.endIndex, `${this.where}: endpoint matches forecast`);
    assert((state.phase === 'LOSE') === !!prediction.playerDies, `${this.where}: death matches forecast`);
    assert((state.phase === 'WIN') === !!prediction.completesRoom, `${this.where}: completion matches forecast`);
    const alive = new Set(state.board.flatMap(cell => cell ? [cell.id] : []));
    if (state.phase === 'PLAYER_INPUT') {
      for (const death of prediction.enemyPhase?.deaths ?? []) assert(!alive.has(death.id), `${this.where}: forecast ${death.cause} death happened`);
      for (const raised of prediction.enemyPhase?.empowered ?? []) {
        const cell = state.board.find(entry => entry?.id === raised.id);
        assert(cell && cell.behavior.tier === raised.tier, `${this.where}: forecast rite raised ${raised.id} to ${raised.tier}`);
      }
      assert(hasOrdinaryChain(state), `${this.where}: an ordinary chain is available after the turn`);
    }
    const palette = state.customLevel!.paletteWeights;
    for (const cell of state.board) {
      if (!cell || cell.kind !== 'melee' || cell.variant) continue;
      if (colors.has(cell.id)) assert(cell.color === colors.get(cell.id), `${this.where}: survivors keep their color`);
      else assert(cell.color !== null && palette[cell.color] > 0, `${this.where}: refills use the row palette`);
    }
    this.snapshots.push(json(state));
  }
  won(hp: number) { assert(this.g.state.phase === 'WIN' && this.g.state.player.hp === hp, `${this.where}: victory with ${hp} HP, got ${this.g.state.phase} ${this.g.state.player.hp}`); }
  /** The goals are met, the door is open and the battle goes on: meeting the goals is no victory. */
  goalsMet() {
    const door = this.g.state.board[this.door()];
    assert(this.g.state.phase === 'PLAYER_INPUT' && door?.intent.label === 'Выход открыт', `${this.where}: the goals open the door and the battle goes on`);
  }
  /** Every action available now (chains, jumps, the spin) with its forecast. */
  actions() {
    const { g } = this, list: { p: ChainPreview; commit: () => Promise<unknown>; kind: 'chain' | 'ability' }[] = [];
    for (const path of g.availableMoves(16)) {
      const p = g.preview(path);
      if (p.valid) list.push({ p, kind: 'chain', commit: async () => { g.beginChain(path[0]); for (const step of path.slice(1)) g.extendChain(step); await g.releaseChain(); } });
    }
    for (let index = 0; index < g.state.board.length; index++) {
      const p = g.previewAbility('jump', index);
      if (p.valid) list.push({ p, kind: 'ability', commit: () => g.useAbility('jump', index) });
    }
    const spin = g.previewAbility('spin');
    if (spin.valid) list.push({ p: spin, kind: 'ability', commit: () => g.useAbility('spin') });
    return list;
  }
  /** The goals are met by this forecast (in the chain or after the enemies answer). */
  static meetsGoals(p: ChainPreview) { return !!(p.unlocksExit || p.enemyPhase?.unlocksExit || p.completesRoom); }
  /**
   * The way out over refilled cells: a search of real moves (no death, least damage first) for a chain into the open door
   * within `turns` turns, then committed by real input. Returns the number of turns it took.
   */
  async leave(turns: number): Promise<number> {
    const { g } = this, root = g.captureAnalysisSnapshot(), door = this.door();
    const search = async (depth: number): Promise<number[][] | null> => {
      const moves = g.availableMoves(16).map(path => ({ path, p: g.preview(path) })).filter(move => move.p.valid && !move.p.playerDies);
      const exit = moves.filter(move => move.p.completesRoom && move.path.at(-1) === door).sort((a, b) => a.p.damage - b.p.damage || a.path.length - b.path.length)[0];
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
    if (!plan) throw new Error(`${this.where}: the open door is reached within ${turns} turn(s)`);
    for (const path of plan) await this.chain(...path.map(index => this.label(index)));
    assert(this.g.state.phase === 'WIN' && this.g.state.player.index === door, `${this.where}: the cat leaves through the door`);
    return plan.length;
  }
}

/** Replay the recorded actions on a fresh engine with the same seed: every snapshot must repeat exactly. */
async function replayMatches(play: Play) {
  const again = new Play(play.id, play.seed, play.energy, play.row);
  assert(again.snapshots[0] === play.snapshots[0], `${play.id}: same start`);
  for (const [step, action] of play.log.entries()) {
    if ('chain' in action) await again.chain(...action.chain);
    else await again.ability(action.ability, action.target);
    assert(again.snapshots[step + 1] === play.snapshots[step + 1], `${play.id}: replay by seed repeats step ${step + 1}`);
  }
}

/** No first action meets the goals at once, whatever energy the run carries in. */
function noOneTurnGoals(id: string) {
  for (const energy of ENERGIES) {
    const play = new Play(id, SEEDS[0], energy);
    const instant = play.actions().filter(action => Play.meetsGoals(action.p));
    assert(instant.length === 0, `${play.where}: no first action meets the goals`);
  }
}

function layouts() {
  const frames = new Set<string>();
  assert(CAMP_BATTLES.length === 3, 'three camp branch battles');
  const tools = json(guaranteedRowTools(ROW));
  for (const row of BRANCH_ROWS) {
    // A pool battle may come on any branch row: the same five colors and the same guaranteed tools on each.
    assert(json(forestRowPalette(row)) === json(forestRowPalette(ROW)), `row ${row}: the branch palette`);
    assert(json(guaranteedRowTools(row)) === tools, `row ${row}: the branch tools`);
  }
  assert(json(guaranteedRowTools(ROW)!.abilities) === json(['jump', 'spin']), 'the branch opens the jump and the spin');
  for (const battle of CAMP_BATTLES) {
    const { definition } = battle;
    assert(battle.id.startsWith('camp-'), `${battle.id}: camp prefix`);
    assert(validateNodeBattle(battle).length === 0, `${battle.id}: ${validateNodeBattle(battle).join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${battle.id}: field 5×5…7×7`);
    assert(definition.doors.length === 1 && definition.completion === 'exit', `${battle.id}: one exit door`);
    // The opening uses the five colors of the branch rows, so the refill palette is the row palette.
    const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(json([...colors].sort()) === json([...forestRowPalette(ROW)].sort()), `${battle.id}: opening uses the five colors`);
    for (const row of BRANCH_ROWS) {
      assert(json(authoredRefillPalette(battle, row)) === json([100, 100, 100, 100, 100]), `${battle.id}: refill palette of row ${row} is the row palette`);
    }
    // Marked goals stand on different colors.
    const goalColors = battle.targetIndices.map(index => definition.enemies.find(enemy => enemy.index === index)!.color);
    assert(new Set(goalColors).size === goalColors.length, `${battle.id}: goals of different colors`);
    const frame = `${definition.cols}x${definition.rows}:${definition.heroIndex}:${definition.terrain.map(terrain => terrain === 'floor' ? '.' : '#').join('')}`;
    assert(!frames.has(frame), `${battle.id}: own field shape and cat position`);
    frames.add(frame);
  }
}

/** A cat arriving with 1 HP has at least one safe first chain in every battle. */
function woundedArrival() {
  for (const battle of CAMP_BATTLES) {
    const play = new Play(battle.id, SEEDS[0], 0, ROW, 1);
    const safe = play.g.availableMoves(16).some(path => { const p = play.g.preview(path); return p.valid && !p.playerDies && p.damage === 0; });
    assert(safe, `${battle.id}: a safe first chain exists at 1 HP`);
  }
}

/**
 * «Две вышки»: from A4 the far archer E1 aims along row 1 over the near tower B1, the near archer along column B.
 * Taking the near tower first ends under the far volley; the far tower first is safe, and the near archer, resting
 * after its volley, falls to the jump E1 → B1. The door A1 is one turn away.
 */
async function twinTowers() {
  noOneTurnGoals('camp-twin-towers');
  for (const energy of ENERGIES) for (const seed of SEEDS) {
    const play = new Play('camp-twin-towers', seed, energy), near = play.cell('B1')!, far = play.cell('E1')!;
    assert(near.kind === 'ranged' && far.kind === 'ranged' && near.color !== far.color, 'two archers of different colors');
    assert(json(far.intent.cells) === json(['D1', 'C1', 'B1'].map(label => play.at(label))), 'the far archer covers the near tower');
    assert(json(near.intent.cells) === json(['B2', 'B3', 'B4'].map(label => play.at(label))), 'the near archer covers column B');
    // The trap: the long red run takes the near tower and stops on the far volley.
    const greedy = play.preview('A5', 'B4', 'A3', 'B3', 'A2', 'B1');
    assert(greedy.valid && greedy.hits.at(-1)?.killed && greedy.endIndex === play.at('B1') && greedy.damage === 1 && greedy.damageBySource.ranged === 1,
      'the forecast shows the far volley on the near tower');
    // The answer: the far tower first.
    const lane = await play.chain('B5', 'C4', 'D3', 'D2', 'E1');
    assert(lane.hits.at(-1)?.killed && lane.damage === 0, 'the blue lane kills the far archer and ends safe');
    const resting = play.cell('B1')!;
    assert(resting.kind === 'ranged' && resting.behavior.restTurns > 0, 'the near archer rests after its volley');
    await play.ability('jump', 'B1');
    play.goalsMet();
    assert(play.g.state.player.hp === 5, 'the answer costs no HP');
    assert(await play.leave(1) === 1, 'the door A1 beside the near tower is one turn away');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);
  }
  // The other order also wins, one HP poorer and with the door across the field.
  const other = new Play('camp-twin-towers', SEEDS[0]);
  await other.chain('A5', 'B4', 'A3', 'B3', 'A2', 'B1');
  assert(other.g.state.player.hp === 4 && other.cell('E1')!.behavior.restTurns > 0, 'the far archer rests after hitting the cat');
  await other.ability('jump', 'E1');
  other.goalsMet();
  assert(other.g.state.player.index === other.at('E1'), 'the near-first order ends far from the door');
}

/**
 * «Гать через пруд»: the only crossings B3 and F3 are held by bearers whose shields face the cat. From A7 the far bearer
 * faces the water and is open from below; killing it leaves the cat on F3, which turns the near bearer east into the
 * water, and the moss path on the far bank enters it from above and continues into the door A2.
 */
async function pondCauseway() {
  noOneTurnGoals('camp-pond-causeway');
  for (const energy of ENERGIES) for (const seed of SEEDS) {
    const play = new Play('camp-pond-causeway', seed, energy), near = play.cell('B3')!, far = play.cell('F3')!;
    assert(near.variant === 'sentinel' && far.variant === 'sentinel' && near.color !== far.color, 'two bearers of different colors');
    assert(shieldIsActive(near) && near.shield?.dy === 1 && !near.shield.dx, 'the near bearer faces the cat below');
    assert(far.shield?.dx === -1 && !far.shield.dy, 'the far bearer faces west into the water');
    // A chain that stops under the far bearer is struck by it.
    const bait = play.preview('B6', 'C5', 'D4', 'E4', 'F4');
    assert(bait.valid && bait.damage === 1 && bait.damageBySource.melee === 1, 'stopping beside the far bearer costs a blow');
    const lane = await play.chain('B6', 'C5', 'D4', 'E4', 'F4', 'F3');
    assert(lane.hits.at(-1)?.killed && lane.damage === 0 && play.g.state.player.index === play.at('F3'), 'the ochre lane takes the far bearer from below');
    const turned = play.cell('B3')!;
    assert(turned.shield?.dx === 1 && !turned.shield.dy, 'the cat on F3 turns the near shield into the water');
    const out = await play.chain('E2', 'D2', 'C2', 'B2', 'B3', 'A2');
    assert(out.opensDoor === play.at('A2') && out.completesRoom && out.damage === 0, 'the far-bank path takes the near bearer and leaves at once');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);

    // The trap: the long amethyst run ends between the causeways; both shields face the cat and the lane is closed.
    const trap = new Play('camp-pond-causeway', seed, energy);
    const decoy = await trap.chain('B7', 'C7', 'D7', 'E7', 'F7', 'F6', 'E6', 'D6', 'C6');
    assert(decoy.kills === 9 && decoy.damage === 0, 'the decoy is the longest first chain and costs nothing now');
    assert(trap.cell('F3')!.shield?.dy === 1 && trap.cell('B3')!.shield?.dy === 1, 'both shields face the cat in the middle');
    const closed = trap.preview('B6', 'C5', 'D4', 'E4', 'F4', 'F3');
    assert(!closed.valid && closed.reason.includes('Щит'), 'the far bearer is closed after the decoy');
  }
}

/**
 * «Верховный шаман»: the elite shaman (6 HP) retreats from the cat to C2, then stands for two actions while its rite is
 * announced on B1 and C1. The answer runs through both rite targets (the rite fails), wounds it to 2 and spins: the
 * shaman and the bodyguard D2 die, nobody strikes. The door F7 is in the far corner.
 */
async function highShaman() {
  noOneTurnGoals('camp-high-shaman');
  const exits: number[] = [];
  for (const energy of ENERGIES) for (const seed of SEEDS) {
    const play = new Play('camp-high-shaman', seed, energy), shaman = play.cell('C3')!;
    assert(shaman.variant === 'shaman' && shaman.elite && shaman.hp === 3 * ELITE_HP_FACTOR, 'the elite shaman has 6 HP');
    assert(shaman.intent.moveTo === play.at('C2'), 'the shaman announces its retreat to C2');
    assert(!play.g.previewAbility('jump', play.at('C3')).valid, 'a jump cannot take the 6-HP shaman');
    const archer = play.cell('F4')!;
    assert(json(archer.intent.cells) === json(['E4', 'D4', 'C4'].map(label => play.at(label))), 'the archer covers C4–E4');
    // The greedy run ends beside the armed goblin E6; the ends C4–E4 meet the arrow.
    const greedy = play.preview('B4', 'B5', 'C6', 'D6', 'E7');
    assert(greedy.valid && greedy.damage === 1 && greedy.damageBySource.melee === 1, 'the longest first run ends beside an armed goblin');
    const east = play.preview('D4', 'E4');
    assert(east.valid && east.damage === 1 && east.damageBySource.ranged === 1, 'an end on the archer line costs the arrow');

    await play.chain('C4', 'B3');
    const chanting = play.cell('C2')!;
    assert(chanting.id === shaman.id, 'the shaman retreated to C2');
    const rite = chanting.intent.empowerIds ?? [];
    assert(json([...rite].sort()) === json([play.cell('B1')!.id, play.cell('C1')!.id].sort()) && chanting.intent.moveTo === undefined,
      'the rite is announced on B1 and C1 and the shaman stands still');
    const lane = await play.chain('A2', 'B1', 'C1', 'C2');
    assert(lane.hits.at(-1)?.hpAfter === 2 && lane.damage === 0 && (lane.enemyPhase?.empowered ?? []).length === 0,
      'the lane through the rite targets cuts the rite and wounds the shaman to 2');
    assert(play.cell('C2')?.id === shaman.id && play.cell('C2')!.intent.moveTo !== undefined, 'after a turn without a rite the shaman announces its retreat');
    // The jump would take it too, but the bodyguard D2 strikes the landing cell; the spin takes the bodyguard as well.
    const jump = play.g.previewAbility('jump', play.at('C2'));
    assert(jump.valid && jump.unlocksExit && jump.damage >= 1 && jump.damageBySource.melee >= 1, 'the jump finishes the shaman under the bodyguard');
    const spin = await play.ability('spin');
    assert(spin.unlocksExit && spin.damage === 0 && spin.hits.some(hit => hit.index === play.at('D2') && hit.killed), 'the spin takes the shaman and the bodyguard');
    play.goalsMet();
    assert(play.g.state.player.hp === 5, 'the answer costs no HP');
    exits.push(await play.leave(3));
    play.won(play.g.state.player.hp);
    if (seed === SEEDS[0]) await replayMatches(play);
  }
  // The door is a turn or more away over refills; most exits take one or two turns.
  assert(exits.filter(turns => turns <= 2).length >= exits.length * 0.6, `the far door is mostly one or two turns away (${exits.join(',')})`);

  // The trap «from the east»: the end on C4 meets the arrow; the short lane D3 → shaman leaves the rite intact, the
  // bodyguard strikes, and there is no energy left to finish the 4-HP shaman before its retreat.
  for (const seed of SEEDS.slice(0, 3)) {
    const trap = new Play('camp-high-shaman', seed);
    const first = await trap.chain('C4');
    assert(first.damage === 1 && first.damageBySource.ranged === 1, 'the end on C4 costs the arrow');
    const short = await trap.chain('D3', 'C2');
    assert(short.hits.at(-1)?.hpAfter === 4 && (short.enemyPhase?.empowered ?? []).length === 2 && short.damage >= 1,
      'the short lane leaves the rite intact and stops under the bodyguard');
    assert(!trap.g.previewAbility('jump', trap.at('C2')).valid && trap.cell('C2')!.intent.moveTo !== undefined,
      'no energy for the jump, and the shaman announces its retreat');
  }
}

/**
 * Protracted variant: the cat spends nine turns on short safe chains that spare the special enemies, then a search of
 * real moves meets the goals (turn 10–16) and a second search reaches the door — late goals are no dead end.
 */
async function protracted() {
  const special = (play: Play, index: number) => { const cell = play.g.state.board[index]; return !!cell && (!!cell.variant || cell.kind === 'ranged' || !!cell.elite || cell.hp > 0); };
  for (const battle of CAMP_BATTLES) for (const seed of SEEDS.slice(0, 3)) {
    const play = new Play(battle.id, seed);
    for (let turn = 0; turn < 9; turn++) {
      const moves = play.g.availableMoves(16).map(path => ({ path, p: play.g.preview(path) }))
        .filter(move => move.p.valid && !move.p.playerDies && !move.p.unlocksExit && !move.p.enemyPhase?.unlocksExit && !move.p.hits.some(hit => special(play, hit.index)))
        .sort((a, b) => a.p.damage - b.p.damage || a.path.length - b.path.length);
      assert(moves.length, `${play.where}: a safe delaying chain on turn ${turn + 1}`);
      await play.chain(...moves[0].path.map(index => play.label(index)));
    }
    const { g } = play;
    const progress = (p: ChainPreview) => p.hits.reduce((sum, hit) => sum + (special(play, hit.index) ? (g.state.board[hit.index]!.hp - (hit.hpAfter ?? 0)) * 10 : 0), 0) - p.damage * 8;
    const search = async (depth: number): Promise<boolean> => {
      if ((g.state.customLevel?.goalCompletedTurn ?? null) !== null) return true;
      if (depth === 0 || g.state.phase !== 'PLAYER_INPUT') return false;
      const snapshot = g.captureAnalysisSnapshot();
      for (const action of play.actions().filter(entry => !entry.p.playerDies).sort((a, b) => progress(b.p) - progress(a.p)).slice(0, 6)) {
        await action.commit();
        if (g.state.phase === 'PLAYER_INPUT' && await search(depth - 1)) return true;
        g.restoreAnalysisSnapshot(snapshot);
      }
      return false;
    };
    assert(await search(5), `${play.where}: the goals are still reachable after a slow start`);
    const goalTurn = g.state.customLevel!.goalCompletedTurn!;
    assert(goalTurn >= 10 && goalTurn <= 16, `${play.where}: late goals on turn ${goalTurn}`);
    await play.leave(3);
  }
}

/** Refills after the same first move differ between seeds; the authored start never does. */
async function refillVariety() {
  const firstMoves: Record<string, string[]> = {
    'camp-twin-towers': ['B5', 'C4', 'D3', 'D2', 'E1'],
    'camp-pond-causeway': ['B6', 'C5', 'D4', 'E4', 'F4', 'F3'],
    'camp-high-shaman': ['C4', 'B3'],
  };
  for (const [id, move] of Object.entries(firstMoves)) {
    const starts = new Set<string>(), refills = new Set<string>();
    for (const seed of SEEDS.slice(0, 5)) {
      const play = new Play(id, seed);
      starts.add(json(play.g.state.board.map(cell => cell?.color ?? null)));
      await play.chain(...move);
      refills.add(json(play.g.state.board.map(cell => cell?.color ?? null)));
    }
    assert(starts.size === 1, `${id}: the authored start is the same for every seed`);
    assert(refills.size > 1, `${id}: refills differ between seeds`);
  }
}

/** The same answers hold on the first and the last branch row. */
async function otherRows() {
  for (const row of [10, 12]) {
    const towers = new Play('camp-twin-towers', SEEDS[1], 0, row);
    await towers.chain('B5', 'C4', 'D3', 'D2', 'E1');
    await towers.ability('jump', 'B1');
    towers.goalsMet();
    const causeway = new Play('camp-pond-causeway', SEEDS[1], 0, row);
    await causeway.chain('B6', 'C5', 'D4', 'E4', 'F4', 'F3');
    await causeway.chain('E2', 'D2', 'C2', 'B2', 'B3', 'A2');
    causeway.won(5);
    const shaman = new Play('camp-high-shaman', SEEDS[1], 0, row);
    await shaman.chain('C4', 'B3');
    await shaman.chain('A2', 'B1', 'C1', 'C2');
    await shaman.ability('spin');
    shaman.goalsMet();
  }
}

layouts();
woundedArrival();
await twinTowers();
await pondCauseway();
await highShaman();
await protracted();
await refillVariety();
await otherRows();
console.log('camp branch battles: layouts, routes on eight spread seeds at entry energy 0/3/7, traps in the forecast, exits, replay, late goals and refill variety pass');
