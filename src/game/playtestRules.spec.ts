/**
 * Rules decided after playtest 1 (30.09.2026, docs/biomes/forest-map.md «Плейтест 1»), checked through real
 * engine commands (startRunBattle / startCustomLevel, preview, begin/extend/release, rest, restart):
 * 1. the pressure before the goals in map battles on rows ≥ 5 (anger 1 per turn, weak refills — Grindstone-style,
 *    04.10.2026; after the goals: pressure.spec.ts) — and the calm trunk (rows 1–4) and editor;
 * 2. colour-change crystals (every mode) — 6 and 12 chain kills, seeded cells, uncredited crushing, protected
 *    cells, no limit, value and score, no power and no share in the next crystal's chain length;
 * 3. kill credit — archer, boar and club kills are not the player's, goal targets still count, devices are credited;
 * plus forecast = execution, seeded replay and cancellation of a stale turn.
 * Battle fixtures are added to the node registry here and loaded exactly like registry battles.
 */
import { ForestEngine } from './forestEngine';
import type { ChainPreview, EngineEvent, ForestCell } from './forestTypes';
import { authoredLesson } from './lessonBuilder';
import { variantSeed } from './levelAnalysis';
import { CRYSTAL_KILLS, CRYSTAL_SCORE_PER_KILL, runPressureInfo } from './mapBattleRules';
import { hasTag } from './enemyDefinitions';
import { FOREST_NODE_BATTLES, forestBattle, type NodeBattle } from './run/forestBattles';
import { authoredRefillPalette } from './run/forestMap';
import { startForestFixture, startNodeBattle } from './testing/fixtures';
import type { CustomLevelDefinition, PaletteWeights } from './customLevel';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
const json = (value: unknown) => JSON.stringify(value);

// ---------------------------------------------------------------- fixtures

const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
function register(battle: NodeBattle) { registry[battle.id] = battle; return battle.id; }

/**
 * Crystal field: red weak goblins (passive on the trunk) around a row of cells a crystal must never take — a boss
 * `Q`, a sentinel `S`, two marked targets `E` and `T`, a brazier `L` and a door `D`. (`E` was the castle's heavy
 * guard until the castle enemies were removed on 30.09.2026.)
 */
const FIELD = register(authoredLesson({
  id: 'spec-crystal-field', name: 'Поле кристаллов', description: 'Проверочный бой.', hint: 'Проверка.', seed: 9901,
  rows: [
    'RRRRRRR',
    'RRRRRRR',
    'RRRRRRR',
    'RRRRRRR',
    'QSETLDR',
    'RRRRRRR',
    'HRRRRRR',
  ],
  legend: {
    Q: { kind: 'boss', hp: 20 }, S: { color: 0, hp: 7, variant: 'sentinel' }, E: { color: 3, target: true },
    T: { color: 2, target: true }, L: { device: { kind: 'fire', charges: 1 } }, D: { door: true },
  },
}));
/** Pits lever `P` at G6 opening the whole second row. */
const PITS = register(authoredLesson({
  id: 'spec-crystal-pits', name: 'Люки', description: 'Проверочный бой.', hint: 'Проверка.', seed: 9902,
  rows: [
    'RRRRRRR',
    'RRRRRRR',
    'RRRRRRR',
    'RRRRBRR',
    'RRRRTRR',
    'RRRRRRP',
    'HRRRRRR',
  ],
  legend: { T: { color: 2, target: true }, P: { device: { kind: 'pits', charges: 1, targets: ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2'] } } },
}));
/** An armed archer `A` shooting down column A at the goblin `W` and the marked target `T`; the cat stands at A7. */
const ARCHER = register(authoredLesson({
  id: 'spec-archer-line', name: 'Линия стрелка', description: 'Проверочный бой.', hint: 'Проверка.', seed: 9903,
  rows: [
    'ABBBB',
    'WBBBB',
    'TGGGG',
    'GGGGG',
    'RGGGG',
    'RRRRR',
    'HRRRR',
  ],
  legend: { A: { kind: 'ranged', color: 1, hp: 7, armed: true }, W: { color: 0 }, T: { color: 3, target: true } },
}));

const RED_ONLY: PaletteWeights = [100, 0, 0, 0, 0];
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const cells = (g: ForestEngine, labels: string[]) => labels.map(label => at(g, label));

function node(id: string, row: number, options: { refill?: number; hp?: number; palette?: PaletteWeights; seed?: number } = {}) {
  const g = new ForestEngine(); g.animationScale = 0;
  const battle = forestBattle(id)!, hp = options.hp ?? 99;
  assert(g.startRunBattle({ nodeId: `spec-${id}`, label: battle.name, seed: options.seed ?? battle.definition.seed, template: { kind: 'battle', id }, row,
    player: { hp, maxHp: hp, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [],
    ...(options.palette ? { paletteWeights: options.palette } : {}) }), `${id}: starts as a node battle on row ${row}`);
  if (options.refill) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, options.refill); g.restoreAnalysisSnapshot(snap); }
  return g;
}
const field = (row = 5, refill = 0) => node(FIELD, row, { refill, palette: RED_ONLY });

/** A published event with the cat's cell and the phase at that moment. */
type Seen = EngineEvent & { cat: number; phase: string };
interface Played { preview: ChainPreview; events: Seen[]; scoreDelta: number; killsDelta: number }
/** One real chain: a pure forecast (no state, RNG or ID change), then real input; damage and the outcome match it. */
async function chain(g: ForestEngine, path: number[], where: string): Promise<Played> {
  const before = json(g.state), snap = g.captureAnalysisSnapshot();
  const preview = g.preview(path);
  const after = g.captureAnalysisSnapshot();
  assert(json(g.state) === before && after.rng === snap.rng && after.nextId === snap.nextId, `${where}: the forecast spends no state, RNG or IDs`);
  assert(preview.valid, `${where}: ${preview.reason}`);
  const hp = g.state.player.hp, score = g.state.score, kills = g.state.objective.kills;
  const events: Seen[] = [];
  const off = g.subscribe((state, event) => { events.push({ ...event, ...(event.indices ? { indices: [...event.indices] } : {}), cat: state.player.index, phase: state.phase }); });
  assert(g.beginChain(path[0]), `${where}: chain starts`);
  for (const step of path.slice(1)) assert(g.extendChain(step), `${where}: chain reaches ${step}`);
  assert(await g.releaseChain(), `${where}: chain resolves`);
  off();
  equal([g.state.lastDamage, g.state.player.hp], [preview.damage, hp - preview.damage], `${where}: damage matches the forecast`);
  equal(g.state.phase === 'WIN', !!preview.completesRoom || !!preview.enemyPhase?.completesObjective, `${where}: victory matches the forecast`);
  equal(g.state.phase === 'LOSE', !!preview.playerDies, `${where}: defeat matches the forecast`);
  return { preview, events, scoreDelta: g.state.score - score, killsDelta: g.state.objective.kills - kills };
}
const crystalsOf = (g: ForestEngine) => g.state.board.flatMap((cell, index) => cell?.kind === 'prism' && cell.crystalChain ? [{ index, cell }] : []);
const idsOf = (g: ForestEngine) => new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
/**
 * A chain of `length` weak red goblins from the cat (depth-first over the engine's chain neighbours), avoiding the
 * protected row; without `through` it avoids crystals, with it the path must pass that crystal (never first) and may
 * pass others.
 */
function redPath(g: ForestEngine, length: number, through?: number): number[] | null {
  const guarded = new Set(['A5', 'B5', 'C5', 'D5', 'E5', 'F5'].map(label => at(g, label)));
  const weak = (index: number) => { const cell = g.state.board[index]; return !!cell && cell.kind === 'melee' && !cell.variant && cell.color === 0 && cell.hp === 0; };
  const walk = (path: number[], kills: number): number[] | null => {
    const passed = through === undefined || path.includes(through);
    if (kills === length && passed) return path;
    for (const next of g.chainNeighbors(path.at(-1)!)) {
      if (path.includes(next) || guarded.has(next)) continue;
      if (next === through || through !== undefined && g.state.board[next]?.crystalChain) { const found = walk([...path, next], kills); if (found) return found; continue; }
      if (kills === length || !weak(next)) continue;
      const found = walk([...path, next], kills + 1); if (found) return found;
    }
    return null;
  };
  for (const start of g.chainNeighbors(g.state.player.index)) {
    if (!weak(start) || guarded.has(start)) continue;
    const found = walk([start], 1); if (found && g.preview(found).valid && !g.preview(found).completesRoom) return found;
  }
  return null;
}

// ---------------------------------------------------------------- 1. growing anger

/** Melee enemies that joined the anger queue after this turn: calm before, «Замах» now, no shaman/refill step. */
function angryIds(g: ForestEngine): Set<number> {
  return new Set(g.state.board.flatMap(cell => cell && cell.kind === 'melee' && cell.intent.label === 'Замах' ? [cell.id] : []));
}
async function angerByTurn(g: ForestEngine, turns: number): Promise<number[]> {
  const counts: number[] = [];
  for (let turn = 0; turn < turns; turn++) {
    const before = angryIds(g);
    assert(await g.waitTurn(), `rest ${turn + 1} resolves`);
    assert(g.state.phase === 'PLAYER_INPUT', `still fighting after rest ${turn + 1} (${g.state.phase})`);
    counts.push([...angryIds(g)].filter(id => !before.has(id) && !g.state.board.find(cell => cell?.id === id)?.behavior.tier).length);
  }
  return counts;
}

async function growingAnger() {
  // Row ≥ 5: lesson passivity is dropped; before the goals one calm enemy becomes angry per turn, never more (03.10.2026).
  const pressed = field(5);
  assert(runPressureInfo(pressed.state).active, 'row 5: the pressure is active');
  assert(pressed.state.board.every(cell => !cell || !cell.behavior.passive), 'row 5: no enemy of the lesson template is passive');
  const grown = await angerByTurn(pressed, 9);
  // The crystal field holds the Chief (Q, a protected cell): since 04.10.2026 no anger while it lives — the boss is the
  // pressure. One new angry enemy per turn without a boss: pressure.spec.ts.
  equal(grown, [0, 0, 0, 0, 0, 0, 0, 0, 0], 'row 5 with the Chief alive: no new angry enemy before the goals');
  const info = runPressureInfo(pressed.state);
  equal([info.active, info.nextAnger, info.afterGoals], [true, 0, false], 'UI data after nine turns');

  // The trunk (row 4) keeps authored passivity: nobody becomes angry; so does the real first trunk battle.
  const trunk = field(4);
  assert(!runPressureInfo(trunk.state).active && trunk.state.board.every(cell => !cell || cell.kind !== 'melee' || cell.behavior.passive), 'row 4: authored passivity kept');
  equal(await angerByTurn(trunk, 9), [0, 0, 0, 0, 0, 0, 0, 0, 0], 'row 4 (trunk): no growing anger');
  const wake = startNodeBattle('trunk-wake', { player: { hp: 99, maxHp: 99, energy: 0 } });
  equal(await angerByTurn(wake, 6), [0, 0, 0, 0, 0, 0], 'trunk-wake (row 1): passivity kept');

  // An editor level keeps one new angry enemy per turn.
  const editor = new ForestEngine(); editor.animationScale = 0;
  assert(editor.startCustomLevel({ ...forestBattle(FIELD)!.definition, playerHp: 20 } satisfies CustomLevelDefinition), 'editor level starts');
  equal(await angerByTurn(editor, 8), [1, 1, 1, 1, 1, 1, 1, 1], 'editor level: one new angry enemy per turn');

  // The Chief's battle (camp-chief, row 14) is a map battle with the pressure layers: soft anger before the goals.
  const chief = startNodeBattle('chief-breakfast', { player: { hp: 99, maxHp: 99, energy: 0 } });
  const chiefAnger = await angerByTurn(chief, 5);
  // Since 04.10.2026 the Chief is the pressure: no new anger while it lives.
  assert(chiefAnger.every(count => count === 0) && runPressureInfo(chief.state).active, `the chief node adds no anger while the Chief lives, got ${chiefAnger}`);
}

/** Before the goals the refill stays weak whatever the turn (Grindstone-style pressure, 04.10.2026: refills are always weak; the anger after the goals: pressure.spec.ts). */
async function strongerRefills() {
  const avoid = (g: ForestEngine) => new Set(['A5', 'B5', 'C5', 'D5', 'E5', 'F5'].map(label => at(g, label)));
  const play = async (g: ForestEngine, where: string) => {
    const blocked = avoid(g);
    const path = g.availableMoves(6).find(candidate => !candidate.some(index => blocked.has(index)) && candidate.length <= 5);
    assert(path, `${where}: an ordinary chain away from the protected row`);
    const known = idsOf(g);
    const played = await chain(g, path, where);
    assert(g.state.phase === 'PLAYER_INPUT', `${where}: the battle goes on`);
    return { played, fresh: g.state.board.filter((cell): cell is ForestCell => !!cell && !known.has(cell.id) && cell.kind === 'melee') };
  };
  const g = field(5);
  for (let turn = 0; turn < 6; turn++) assert(await g.waitTurn(), 'rest');
  for (const where of ['turn 7', 'turn 8', 'turn 9', 'turn 10', 'turn 11', 'turn 12', 'turn 13']) {
    const played = await play(g, where);
    assert(played.fresh.length && played.fresh.every(cell => !cell.behavior.passive && !cell.behavior.tier && (cell.elite || cell.hp === 0)), `${where}: new enemies are weak, unarmed and not passive before the goals`);
  }

  // The trunk keeps passive weak refills whatever the turn.
  const trunk = field(4);
  for (let turn = 0; turn < 8; turn++) assert(await trunk.waitTurn(), 'rest');
  const late = await play(trunk, 'trunk turn 9');
  assert(late.fresh.length && late.fresh.every(cell => cell.behavior.passive && !cell.behavior.tier && cell.hp === 0), 'row 4: refills stay passive and weak');
}

// ---------------------------------------------------------------- 2. crystals

const ROW6 = ['A6', 'B6', 'C6', 'D6', 'E6', 'F6', 'G6'];
const TWELVE = [...ROW6, 'G7', 'F7', 'E7', 'D7', 'C7'];

async function crystalCounts() {
  const five = field();
  const short = await chain(five, cells(five, ROW6.slice(0, 5)), 'five kills');
  assert(!short.preview.crystals && !short.preview.createsPrism && !crystalsOf(five).length, 'five chain kills create no crystal');

  const six = field();
  const known = idsOf(six);
  const one = await chain(six, cells(six, ROW6.slice(0, 6)), 'six kills');
  equal([one.preview.kills, one.preview.crystals, one.preview.createsPrism], [6, 1, true], 'six kills forecast one crystal, not its cell');
  const placed = crystalsOf(six);
  equal(placed.map(({ cell }) => cell.crystalChain), [6], 'one crystal holding the chain length 6');
  const events = one.events.filter(event => event.type === 'crystal');
  equal(events.map(event => [event.index, event.newId, event.amount]), placed.map(({ index, cell }) => [index, cell.id, CRYSTAL_SCORE_PER_KILL * 6]), 'one crystal event with its value');
  // It falls during the chain, right after the sixth kill and before the enemy phase (30.09.2026).
  const chainKills = one.events.flatMap((event, n) => event.type === 'kill' && !event.text && event.phase === 'PLAYER_RESOLVE' ? [n] : []);
  const fall = one.events.findIndex(event => event.type === 'crystal');
  assert(chainKills.length === 6 && fall > chainKills[5] && fall < one.events.findIndex(event => event.type === 'enemy-turn') && one.events[fall].phase === 'PLAYER_RESOLVE',
    'the crystal falls in the step of the sixth kill, before the enemy phase');
  assert(placed.every(({ cell }) => !known.has(cell.id) && cell.color === null && cell.kind === 'prism'), 'a crystal is a new colourless prism');

  const twelve = field();
  const two = await chain(twelve, cells(twelve, TWELVE), 'twelve kills');
  equal([two.preview.kills, two.preview.crystals], [12, 2], 'twelve kills forecast two crystals');
  equal(crystalsOf(twelve).map(({ cell }) => cell.crystalChain), [12, 12], 'two crystals, each holding 12');

  // No limit: crystals pile up over several long chains that leave the standing crystals alone.
  const pile = field(5, 3);
  await chain(pile, cells(pile, TWELVE), 'pile turn 1');
  for (let turn = 1; turn < 6 && pile.state.phase === 'PLAYER_INPUT' && crystalsOf(pile).length <= 2; turn++) {
    const path = redPath(pile, CRYSTAL_KILLS);
    if (!path) break;
    await chain(pile, path, `pile turn ${turn + 1}`);
  }
  assert(crystalsOf(pile).length > 2, `more than two crystals can stand on the field, got ${crystalsOf(pile).length}`);
}

/** A crystal does not need a cell away from the cat: a cramped 4×3 board still receives it (moved from the castle suite). */
function crowdedCrystal() {
  const tight = startForestFixture(), cell = tight.state.board.find(entry => entry?.kind === 'melee' && entry.color === 0)!;
  tight.state.cols = 4; tight.state.rows = 3; tight.state.player.index = 11; tight.state.devices = [];
  tight.state.terrain = Array.from({ length: 12 }, (_, index) => [3, 7].includes(index) ? 'wall' : 'floor');
  tight.state.board = Array.from({ length: 12 }, (_, index) => [3, 7, 11].includes(index) ? null : { ...structuredClone(cell), id: 5000 + index });
  const cramped = tight.preview([10, 9, 8, 4, 0, 1, 2, 6, 5]);
  assert(cramped.valid && cramped.kills === 9 && cramped.crystals === 1, 'a crystal does not need a cell away from the cat');
}

async function crystalPlacement() {
  // Seeded: the same refill seed repeats the cells; different seeds give different cells (no fixed coordinate).
  const positions = new Set<string>();
  let crushed = 0;
  const protectedLabels = ['A5', 'B5', 'C5', 'D5', 'E5', 'F5'];
  for (let k = 0; k < 10; k++) {
    const g = field(5, k), twin = field(5, k);
    const guarded = protectedLabels.map(label => g.state.board[at(g, label)]?.id);
    const before = new Map(g.state.board.flatMap((cell, index) => cell ? [[cell.id, index] as const] : []));
    const played = await chain(g, cells(g, TWELVE), `seed ${k}`);
    await chain(twin, cells(twin, TWELVE), `twin ${k}`);
    equal(json(twin.captureAnalysisSnapshot()), json(g.captureAnalysisSnapshot()), `seed ${k}: the same seed and chain repeat the crystals exactly`);
    const placed = crystalsOf(g);
    positions.add(placed.map(({ index }) => index).sort((a, b) => a - b).join());
    const path = cells(g, TWELVE), falls = played.events.filter(event => event.type === 'crystal');
    for (const event of falls) {
      // Never on the cat, the path still ahead of it or another crystal; freed cells behind the cat are allowed.
      const kills = played.events.slice(0, played.events.indexOf(event)).filter(entry => entry.type === 'kill' && !entry.text).length;
      assert(event.index !== event.cat, `seed ${k}: never on the cat`);
      assert(!path.slice(kills).includes(event.index!), `seed ${k}: never on the path ahead of the cat`);
      assert(falls.filter(other => other.index === event.index).length === 1, `seed ${k}: never on another crystal`);
      if (event.oldId !== undefined) {
        const crush = played.events[played.events.indexOf(event) - 1];
        assert(crush.type === 'kill' && crush.text === 'crystal' && crush.index === event.index, `seed ${k}: the crushed enemy dies through the common death path first`);
      }
    }
    for (const { index } of placed) {
      assert(!protectedLabels.map(label => at(g, label)).includes(index) && index !== at(g, 'D5'), `seed ${k}: never on a boss, guard, target, device or door`);
    }
    assert(guarded.every(id => id === undefined || g.state.board.some(cell => cell?.id === id)), `seed ${k}: protected enemies survive`);
    assert(g.state.devices.length === 1 && g.state.board[at(g, 'F5')]?.kind === 'door', `seed ${k}: device and door untouched`);
    // A crushed enemy dies without credit: the kill count grows by the chain kills only, no extra score.
    for (const event of played.events.filter(entry => entry.type === 'crystal' && entry.oldId !== undefined)) {
      crushed++;
      assert(before.has(event.oldId!) && !g.state.board.some(cell => cell?.id === event.oldId), `seed ${k}: the crushed enemy is gone`);
    }
    equal(played.killsDelta, 12, `seed ${k}: only the twelve chain kills are counted`);
    const hitScore = played.preview.hits.reduce((sum, hit) => sum + (hit.crystalScore ?? (hit.killed ? 20 + 2 * hit.damage : hit.damage)), 0);
    equal(played.scoreDelta, hitScore + (g.state.lastDamage ? 0 : 30), `seed ${k}: crushing scores nothing`);
  }
  // Many more seeds for the rarer cases: the first crystal never lands on the six cells still ahead, nor on the cat.
  for (let k = 10; k < 60; k++) {
    const g = field(5, k), path = cells(g, TWELVE);
    const events: Seen[] = [];
    g.subscribe((state, event) => { events.push({ ...event, cat: state.player.index, phase: state.phase }); });
    g.state.chain = [...path]; await g.releaseChain();
    for (const event of events.filter(entry => entry.type === 'crystal')) {
      const kills = events.slice(0, events.indexOf(event)).filter(entry => entry.type === 'kill' && !entry.text).length;
      assert(event.index !== event.cat && !path.slice(kills).includes(event.index!), `seed ${k}: the crystal keeps off the cat and the path ahead`);
    }
  }
  assert(positions.size >= 5, `crystal cells vary with the seed, got ${positions.size} layouts`);
  assert(crushed > 0, 'some crystals landed on a living enemy');

  // Open pits (the lever opens row 2 for the whole next turn) never receive a crystal; lever kills do not count.
  let overPits = 0;
  for (let k = 0; k < 6; k++) {
    const g = node(PITS, 5, { refill: k, palette: RED_ONLY });
    const played = await chain(g, cells(g, ['A6', 'B6', 'C6', 'D6', 'E6', 'F6', 'G6']), `pits seed ${k}`);
    equal([played.preview.kills, played.preview.crystals], [6, 1], `pits seed ${k}: six chain kills (lever kills apart), one crystal`);
    assert(g.state.pits.length === 7, `pits seed ${k}: row 2 is open`);
    const path = redPath(g, CRYSTAL_KILLS);
    if (!path) continue;
    const next = await chain(g, path, `pits seed ${k} next turn`);
    for (const event of next.events.filter(entry => entry.type === 'crystal')) { overPits++; assert(!g.state.pits.some(pit => pit.index === event.index), `pits seed ${k}: no crystal on an open pit`); }
  }
  assert(overPits > 0, 'crystals fell while pits were open');

  // Protected list: bosses of every kind and the named variants.
  for (const variant of ['troll', 'jailer', 'sentinel']) {
    assert(hasTag({ kind: variant === 'sentinel' ? 'melee' : 'boss', variant: variant as 'troll' }, 'CrystalProtected'), `${variant} is protected`);
  }
}

async function crystalValue() {
  // A crystal made by twelve kills: breaking it scores 20 × 12, gives no power and is not a kill.
  const g = field(5, 1);
  await chain(g, cells(g, TWELVE), 'make crystals');
  const crystal = crystalsOf(g)[0];
  assert(crystal, 'a crystal stands on the field');
  const path = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(kills => redPath(g, kills, crystal.index)).find(found => !!found);
  assert(path, 'a chain can pass through the crystal');
  const preview = g.preview(path);
  const hit = preview.hits.find(entry => entry.index === crystal.index)!;
  const broken = preview.hits.filter(entry => entry.crystalScore).length;
  equal([hit.crystalScore, preview.crystalScore], [CRYSTAL_SCORE_PER_KILL * 12, CRYSTAL_SCORE_PER_KILL * 12 * broken], 'the forecast shows the crystal score (20 × 12 per crystal)');
  const position = preview.hits.indexOf(hit);
  equal([hit.powerSpent, hit.availablePower, hit.remainingPower], [0, preview.hits[position - 1].remainingPower, preview.hits[position - 1].remainingPower], 'the crystal gives and spends no power');
  equal(preview.enemies, path.filter(index => g.state.board[index]?.kind !== 'prism').length, 'the crystal is not an enemy of the chain');
  const played = await chain(g, path, 'through the crystal');
  const hitScore = preview.hits.reduce((sum, entry) => sum + (entry.crystalScore ?? (entry.killed ? 20 + 2 * entry.damage : entry.damage)), 0);
  equal(played.scoreDelta, hitScore + (g.state.lastDamage ? 0 : 30), 'breaking the crystal scores its value');
  equal(played.killsDelta, preview.kills, 'breaking the crystal is not a kill');
  assert(!g.state.board.some(cell => cell?.id === crystal.cell.id), 'the crystal is gone');

  // Five enemy kills plus a crystal in one chain are not six kills: no new crystal is forecast or placed.
  let checked = 0;
  for (let k = 1; k <= 8 && !checked; k++) {
    const h = field(5, k);
    await chain(h, cells(h, TWELVE), `seed ${k}: make crystals`);
    const candidate = crystalsOf(h).map(({ index }) => redPath(h, CRYSTAL_KILLS - 1, index)).find(found => !!found);
    if (!candidate) continue;
    const forecast = h.preview(candidate);
    equal([forecast.kills, forecast.hits.length > forecast.kills, forecast.crystals ?? 0], [CRYSTAL_KILLS - 1, true, 0], `seed ${k}: five kills and a crystal forecast no crystal`);
    const known = new Set(crystalsOf(h).map(({ cell }) => cell.id));
    await chain(h, candidate, `seed ${k}: five kills and a crystal`);
    assert(!crystalsOf(h).some(({ cell }) => !known.has(cell.id)), `seed ${k}: no new crystal is placed`);
    checked++;
  }
  assert(checked, 'a five-kill chain through a crystal was found');

  // One rule in every mode: an editor level and a standalone lesson create crystals the same way; the old 8-kill prism is gone.
  const editor = new ForestEngine(); editor.animationScale = 0;
  assert(editor.startCustomLevel({ ...forestBattle(FIELD)!.definition, paletteWeights: RED_ONLY, goals: [{ key: 'kills', target: 999 }] }), 'editor level starts');
  const same = editor.preview(cells(editor, ROW6.slice(0, 6)));
  equal([same.crystals], [1], 'editor: six kills forecast one crystal');
  const known = idsOf(editor);
  await chain(editor, cells(editor, TWELVE), 'editor twelve kills');
  equal(crystalsOf(editor).filter(({ cell }) => !known.has(cell.id)).map(({ cell }) => cell.crystalChain), [12, 12], 'editor: two crystals of length 12');
}

/** A chain may start on a crystal or prism (30.09.2026): the first coloured target sets the colour, two enemies are still needed. */
const START = register(authoredLesson({
  id: 'spec-prism-start', name: 'Старт с кристалла', description: 'Проверочный бой.', hint: 'Проверка.', seed: 9905,
  rows: ['RRBB', 'RRBB', 'RRBB', 'HPBB'], legend: { P: { kind: 'prism' } }, goals: [{ key: 'kills', target: 999 }],
}));
async function chainFromCrystal() {
  const g = node(START, 5, { palette: [100, 0, 100, 0, 0] });
  const prism = at(g, 'B4');
  assert(g.validStarts().includes(prism) && g.beginChain(prism), 'the prism beside the cat starts a chain');
  g.cancelChain();
  // Since 04.10.2026 one enemy is a full chain: a prism and one enemy are enough.
  assert(g.preview(cells(g, ['B4', 'C4'])).valid, 'a prism and one enemy are a full chain');
  assert(!g.preview(cells(g, ['B4', 'C4', 'B3'])).valid, 'the first coloured target (blue) sets the colour');
  const played = await chain(g, cells(g, ['B4', 'C4', 'C3']), 'prism start');
  equal([played.preview.enemies, played.preview.kills, played.preview.hits.map(hit => hit.availablePower)], [2, 2, [0, 1, 2]], 'the prism gives no power and is not a kill');
  // A crystal made by a chain works the same: find one beside the cat and start from it.
  let started = 0;
  for (let k = 0; k < 10 && !started; k++) {
    const h = field(5, k);
    await chain(h, cells(h, TWELVE), `seed ${k}: make crystals`);
    for (let turn = 0; turn < 3 && !started && h.state.phase === 'PLAYER_INPUT'; turn++) {
      const crystal = crystalsOf(h).find(({ index }) => h.validStarts().includes(index));
      const path = crystal ? h.availableMoves(8).find(candidate => candidate[0] === crystal.index) : undefined;
      if (path) { await chain(h, path, `seed ${k}: start on a crystal`); started++; break; }
      await h.waitTurn();
    }
  }
  assert(started, 'a chain started on a crystal made by an earlier chain');
}

// ---------------------------------------------------------------- 3. kill credit

async function killCredit() {
  // Archer line A2–A4 toward the cat at A7: the plain goblin dies uncredited, the marked target counts for the task.
  const g = node(ARCHER, 5, { palette: [0, 100, 0, 0, 0] });
  const archer = g.state.board[at(g, 'A1')]!;
  assert(archer.intent.cells.includes(at(g, 'A2')) && archer.intent.cells.includes(at(g, 'A3')), 'the archer line covers the goblin and the target');
  const plain = g.state.board[at(g, 'A2')]!.id, target = g.state.board[at(g, 'A3')]!.id, lower = g.state.board[at(g, 'A4')]!.id;
  const played = await chain(g, cells(g, ['B6', 'C6']), 'archer turn');
  equal(played.preview.enemyPhase!.deaths.map(death => [death.id, death.cause]), [[plain, 'arrow'], [target, 'arrow'], [lower, 'arrow']], 'forecast: the arrow kills the line');
  equal([played.killsDelta, g.state.objective.tutorialTargets], [2, 1], 'arrow kills: no kill credit, the target counts for the task');
  assert(g.state.phase === 'WIN' && played.preview.enemyPhase!.completesObjective, 'the arrow on the only target wins, as forecast');

  // An editor level with a «defeat 3 enemies» goal: two chain kills plus the arrow kills do not complete it, and the
  // forecast agrees (chain() compares the forecast victory with the result).
  const goal = new ForestEngine(); goal.animationScale = 0;
  assert(goal.startCustomLevel({ ...forestBattle(ARCHER)!.definition, goals: [{ key: 'kills', target: 3 }], paletteWeights: [0, 100, 0, 0, 0] }), 'kill-goal level starts');
  const shot = await chain(goal, cells(goal, ['B6', 'C6']), 'kill goal with arrows');
  assert(shot.preview.enemyPhase!.deaths.length === 3 && !shot.preview.enemyPhase!.completesObjective && goal.state.phase === 'PLAYER_INPUT',
    'arrow kills do not complete a kill goal, and the forecast does not promise it');
  equal(goal.state.objective.kills, 2, 'only the chain kills count toward the goal');

  // Boar: the designed route of `boar-garden` pushes both marked targets onto the spikes; they count, nothing else does.
  const boar = node('boar-garden', 6, { hp: 5, palette: authoredRefillPalette(forestBattle('boar-garden')!, 6) });
  const first = await chain(boar, cells(boar, ['G5', 'F5', 'E6', 'D5', 'C5']), 'boar turn 1');
  equal(first.killsDelta, first.preview.kills, 'boar turn 1: chain kills only');
  const second = await chain(boar, cells(boar, ['B5', 'B6', 'C6']), 'boar turn 2');
  const spikes = second.preview.enemyPhase!.deaths.filter(death => death.cause === 'spikes').length;
  equal([spikes, boar.state.objective.tutorialTargets, second.killsDelta], [2, 2, second.preview.kills], 'spike deaths: targets count for the task, no kill credit');
  // Since the exit door (02.10.2026) the push meets the goals and opens the door; the battle goes on until the cat enters it.
  assert(boar.state.phase === 'PLAYER_INPUT' && boar.state.customLevel!.goalCompletedTurn !== null
    && boar.state.board.some(cell => cell?.kind === 'door' && cell.intent.label === 'Выход открыт'), 'boar-garden: the push opens the exit door');
  // The forecast said so (exit door, stage 2), and the chest fell at the end of that turn.
  assert(second.preview.enemyPhase!.unlocksExit && !second.preview.unlocksExit && !second.preview.enemyPhase!.completesObjective, 'boar-garden: the forecast shows the door opening in the enemy phase');
  assert(boar.state.board.some(cell => !!cell?.chest), 'boar-garden: the chest fell once the push met the goals');

  // Troll club in an editor level with a kill goal: club kills do not advance it.
  const club = new ForestEngine(); club.animationScale = 0;
  const rows = ['11Tt111', '11tt111', '1111111', '1111111', '1111111', '111@111'];
  const terrain = rows.join('').split('').map(() => 'floor' as const);
  const enemies: CustomLevelDefinition['enemies'] = [];
  rows.join('').split('').forEach((symbol, index) => { if (/\d/.test(symbol)) enemies.push({ index, kind: 'melee', color: Number(symbol) as 1, hp: 0 }); });
  enemies.push({ index: 2, kind: 'boss', color: null, hp: 24, variant: 'troll', aggressive: true, footprint: [2, 3, 9, 10] });
  assert(club.startCustomLevel({ version: 1, name: 'club', seed: 5, cols: 7, rows: 6, terrain, heroIndex: 38, enemies, doors: [],
    goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct', paletteWeights: [0, 100, 0, 0, 0], extraColors: [],
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, playerHp: 20 }), 'club level starts');
  let clubKills = 0, kills = club.state.objective.kills, chainKills = 0;
  for (let turn = 0; turn < 3; turn++) {
    const path = club.availableMoves(4).find(candidate => candidate.length === 2)!;
    const played = await chain(club, path, `club turn ${turn + 1}`);
    clubKills += played.preview.enemyPhase?.deaths.filter(death => death.cause === 'club').length ?? 0;
    chainKills += played.preview.kills;
  }
  assert(clubKills > 0, 'the club killed goblins');
  equal(club.state.objective.kills - kills, chainKills, 'club kills are not the player’s kills');

  // Devices are the player's: lever kills are credited with the chain kills.
  const pits = node(PITS, 5, { palette: RED_ONLY });
  const lever = await chain(pits, cells(pits, ['A6', 'B6', 'C6', 'D6', 'E6', 'F6', 'G6']), 'pits lever');
  equal(lever.killsDelta, 6 + 7, 'lever kills are credited');
}

// ---------------------------------------------------------------- determinism and cancellation

async function replayAndCancel() {
  // Seeded replay of a mixed sequence (chains and rests) on a pressured map battle with crystals.
  const script = async (g: ForestEngine) => {
    const snapshots: string[] = [];
    await chain(g, cells(g, TWELVE), 'replay chain');
    snapshots.push(json(g.captureAnalysisSnapshot()));
    for (let turn = 0; turn < 3; turn++) { await g.waitTurn(); snapshots.push(json(g.captureAnalysisSnapshot())); }
    const path = g.availableMoves(8)[0];
    if (path) { await chain(g, path, 'replay last'); snapshots.push(json(g.captureAnalysisSnapshot())); }
    return snapshots;
  };
  equal(await script(field(5, 4)), await script(field(5, 4)), 'the same seed and actions replay identically');

  // A restart from the crystal event cancels the stale turn: nothing of it survives.
  const g = field(5, 1), entry = json(g.state);
  let restarted = false;
  const off = g.subscribe((_state, event) => { if (event.type === 'crystal' && !restarted) { restarted = true; g.restartLevel(); } });
  g.state.chain = cells(g, TWELVE);
  const result = await g.releaseChain();
  off();
  assert(restarted && !result, 'the stale turn reports cancellation');
  equal(json(g.state), entry, 'the restart restores the entry: no crystal, no kills');
  const again = await chain(g, cells(g, TWELVE), 'after restart');
  equal(again.preview.crystals, 2, 'the next turn creates crystals normally');

  // A restart while the crystal is falling (during its animation) cancels the turn as well.
  const falling = field(5, 1); falling.animationScale = 0.02;
  const fallingEntry = json(falling.state);
  let dropped = false;
  falling.subscribe((_state, event) => { if (event.type === 'crystal' && !dropped) { dropped = true; setTimeout(() => falling.restartLevel(), 0); } });
  falling.state.chain = cells(falling, TWELVE);
  equal(await falling.releaseChain(), false, 'a restart during the crystal fall cancels the turn');
  equal(json(falling.state), fallingEntry, 'entry restored after the fall');

  // A restart during the animation before the refill also leaves no pending crystal behind.
  const slow = field(5, 1); slow.animationScale = 0.02;
  const slowEntry = json(slow.state);
  let fired = false;
  slow.subscribe((_state, event) => { if (event.type === 'enemy-turn' && !fired) { fired = true; setTimeout(() => slow.restartLevel(), 0); } });
  slow.state.chain = cells(slow, TWELVE);
  equal(await slow.releaseChain(), false, 'a restart during the animation cancels the turn');
  equal(json(slow.state), slowEntry, 'entry restored');
  slow.animationScale = 0;
  await slow.waitTurn();
  assert(!crystalsOf(slow).length, 'no stale crystal is placed by a later refill');
}

// ---------------------------------------------------------------- UI forecast extras: rams and Rest

/** Executed rams of one turn: `hit` (creature) or `damage` (cat) events tagged by the charge, in order. */
function executedRams(events: EngineEvent[]) {
  return events.filter(event => (event.type === 'hit' || event.type === 'damage') && (event.text === 'ram' || event.text === 'ЩИТ'))
    .map(event => [event.index, event.amount ?? 0]);
}
async function forecastExtras() {
  // enemyPhase.rams names who each boar really rams, as the live charge does, for many chains of boar-garden.
  let compared = 0, rammed = 0;
  for (const turn of [0, 1]) {
    const probe = node('boar-garden', 6, { hp: 5, palette: authoredRefillPalette(forestBattle('boar-garden')!, 6) });
    if (turn) await chain(probe, cells(probe, ['G5', 'F5', 'E6', 'D5', 'C5']), 'boar setup');
    const snapshot = probe.captureAnalysisSnapshot();
    for (const path of probe.availableMoves(8).slice(0, 24)) {
      const g = new ForestEngine(); g.animationScale = 0; g.restoreAnalysisSnapshot(snapshot);
      const preview = g.preview(path), events: EngineEvent[] = [];
      g.subscribe((_state, event) => { events.push({ ...event }); });
      g.state.chain = [...path]; await g.releaseChain();
      if (!preview.enemyPhase) continue;
      equal(preview.enemyPhase.rams.map(ram => [ram.index, ram.damage]), executedRams(events), `rams forecast = execution for ${path.join('-')}`);
      compared++; rammed += preview.enemyPhase.rams.length;
    }
  }
  assert(compared > 10 && rammed > 0, `rams compared on real chains (${compared} chains, ${rammed} rams)`);

  // previewRest: the enemy phase of Rest, pure, equal to waitTurn — damage, deaths, pushes, cat cell and defeat.
  const positions: [string, () => Promise<ForestEngine>][] = [
    ['pressured field', async () => { const g = field(5); for (let n = 0; n < 4; n++) await g.waitTurn(); return g; }],
    ['archer line', async () => node(ARCHER, 5, { palette: [0, 100, 0, 0, 0] })],
    ['boar garden', async () => { const g = node('boar-garden', 6, { hp: 5, palette: authoredRefillPalette(forestBattle('boar-garden')!, 6) }); await chain(g, cells(g, ['G5', 'F5', 'E6', 'D5', 'C5']), 'boar setup'); return g; }],
    ['wounded cat', async () => { const g = field(5); for (let n = 0; n < 5; n++) await g.waitTurn(); g.state.player.hp = 1; return g; }],
  ];
  for (const [name, make] of positions) {
    const g = await make();
    for (let turn = 0; turn < 3 && g.state.phase === 'PLAYER_INPUT'; turn++) {
      const before = json(g.state), snap = g.captureAnalysisSnapshot(), hp = g.state.player.hp, energy = g.state.player.energy;
      const rest = g.previewRest();
      const after = g.captureAnalysisSnapshot();
      assert(json(g.state) === before && after.rng === snap.rng && after.nextId === snap.nextId, `${name}: the Rest forecast is pure`);
      assert(rest.valid && rest.enemies === 0 && rest.hits.length === 0, `${name}: Rest has no player action`);
      const events: EngineEvent[] = [];
      const off = g.subscribe((_state, event) => { events.push({ ...event }); });
      assert(await g.waitTurn(), `${name}: Rest resolves`);
      off();
      const where = `${name} rest ${turn + 1}`, phase: string = g.state.phase;
      equal([g.state.lastDamage, g.state.player.hp], [rest.damage, hp - rest.damage], `${where}: damage matches`);
      equal(g.state.player.energy, energy + rest.energyGain, `${where}: energy matches`);
      equal(phase === 'LOSE', !!rest.playerDies, `${where}: defeat matches`);
      if (phase === 'PLAYER_INPUT') {
        equal(g.state.player.index, rest.enemyPhase!.heroIndex, `${where}: cat cell matches`);
        for (const death of rest.enemyPhase!.deaths) assert(!g.state.board.some(cell => cell?.id === death.id), `${where}: forecast ${death.cause} death happened`);
        equal(rest.enemyPhase!.rams.map(ram => [ram.index, ram.damage]), executedRams(events), `${where}: rams match`);
      }
    }
  }
}

async function main() {
  await growingAnger();
  await strongerRefills();
  await crystalCounts();
  crowdedCrystal();
  await crystalPlacement();
  await crystalValue();
  await chainFromCrystal();
  await killCredit();
  await replayAndCancel();
  await forecastExtras();
  console.log('PASS playtest rules: soft anger and weak refills before the goals on rows ≥ 5, calm trunk, crystals (fall at the 6th/12th kill during the chain, seeded cells, not ahead on the path, prism start, uncredited crushing, protected cells, pits, no limit, value, no power), kill credit (archer, boar, club, devices, targets), forecast = execution, replay, cancellation; UI forecasts enemyPhase.rams and previewRest = execution');
}
void main();
