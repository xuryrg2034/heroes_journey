/**
 * Goblin-barricade and camp node battles (src/game/run/battles/goblins.ts, docs/levels/forest-nodes-goblins.md).
 * Every battle starts through ForestEngine.startRunBattle exactly as in a run: the refill seed and the row palette
 * come from the setup, the cat has 5/5 HP and 0 energy, tools are those guaranteed on the row.
 * The checks play real commands: intended routes on several refill seeds, forecast against execution,
 * traps visible in the forecast, replay by seed, refill variety. No bot is expected to win or lose.
 */
import { hasOrdinaryChain } from './boardGeneration';
import { shieldIsActive } from './combatRules';
import { ELITE_HP_FACTOR, heroStrikeDamage } from './elite';
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

function layouts() {
  const frames = new Set<string>();
  assert(GOBLIN_BATTLES.length === Object.keys(ROWS).length, 'six goblin battles');
  for (const battle of GOBLIN_BATTLES) {
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
  for (const battle of GOBLIN_BATTLES) {
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
    // Priority target: the archer first, then the guard, deterministic on every refill seed.
    const priority = new Play('goblin-archer-watch', seed);
    await priority.chain('E4', 'E3', 'E2', 'D1');
    assert(!priority.g.state.board.some(cell => cell?.kind === 'ranged'), 'the archer falls first');
    await priority.chain('D2', 'C3', 'D3');
    priority.won(5);
    if (seed === SEEDS[0]) await replayMatches(priority);
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
    await play.chain('D2', 'C2', 'B2', 'C3', 'C4');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);
  }
}

async function shamanRite() {
  for (const seed of SEEDS) {
    const play = new Play('goblin-shaman-rite', seed), shaman = play.cell('E1')!, bearer = play.cell('E3')!;
    assert(bearer.shield?.dy === 1, 'the breach faces the cat below');
    await play.chain('E5', 'F5', 'G5', 'G4');
    assert(bearer.shield?.dx === 1 && !bearer.shield.dy && shaman.intent.empowerIds?.length === 2, 'the shield turns east; the rite is announced');
    // «Now»: through the breach from below; the shaman dies before its rite.
    const now = play.preview('F4', 'E4', 'E3', 'E2', 'F1', 'E1');
    assert(now.valid && now.enemyPhase!.empowered.length === 0, 'killing the shaman cancels the rite in the forecast');
    await play.chain('F4', 'E4', 'E3', 'E2', 'F1', 'E1');
    await play.ability('jump', 'B1');
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
  for (const seed of SEEDS) {
    const play = new Play('camp-cauldron-ring', seed);
    for (const [bait, guard] of [[['F6', 'F7', 'E6', 'D5', 'C5', 'C4'], 'B4'], [['F6', 'F7', 'E6', 'D5', 'E4'], 'F4']] as const) {
      const prediction = play.preview(...bait);
      assert(prediction.valid && prediction.damage === 1 && prediction.damageBySource.melee === 1, `the armed goblin ${guard} strikes a chain that stops beside it`);
    }
    const ring = await play.chain('F6', 'F7', 'E6', 'D5', 'C5', 'C4', 'D3');
    assert(ring.damage === 0 && play.g.state.player.energy >= 3, 'the pocket D3 is safe and the chain pays for the spin');
    const spin = await play.ability('spin');
    assert(spin.kills >= 3, 'the spin takes the shaman and both guards');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);
  }
}

async function shieldWall() {
  const drops = new Set<boolean>();
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
    play2.won(5);
    if (seed === SEEDS[0]) await replayMatches(play2);
  }
  assert(drops.size === 2, 'the answer holds both when the elite drops loot and when it does not');
  // Without the jump the elite can still be wounded and finished, paying 2 HP to its arrow.
  const slow = new Play('camp-shield-wall', ELITE_SEEDS[0]);
  await slow.chain('E7', 'D7', 'C7', 'B7', 'A7');
  await slow.chain('A7', 'B6', 'B5', 'A4');
  slow.won(3);
  // A frost flask carried by the run (the node goblin-archer grants one) makes the elite brittle: then the lane may take
  // the shaman and the jump (4 × 2) kills the 6-HP elite. A legal use of frost, not a rule bent for the route.
  const frost = new Play('camp-shield-wall', ELITE_SEEDS[0], undefined, 1);
  assert(frost.g.useItem('frost', frost.at('A7')) && frost.cell('A7')!.status.brittle, 'frost makes the elite brittle');
  await frost.chain('E7', 'D7', 'C7', 'B7', 'B6', 'B5', 'A4');
  await frost.ability('jump', 'A7');
  frost.won(5);
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
    play.won(5);
  }
}

async function gateRun() {
  for (const seed of SEEDS) {
    const play = new Play('camp-gate-run', seed), gate = play.cell('C1')!;
    assert(gate.kind === 'door' && gate.intent.label === 'Выполни цели', 'the gate is closed on the first turn');
    await play.chain('B4', 'A3', 'A2', 'B3');
    assert(play.cell('C1')!.intent.label === 'Выход открыт', 'the gate opens after the first turn');
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
console.log('goblin battles: layouts, routes on five refill seeds (eleven for the elite), forecasts, traps, replay and refill variety pass');
