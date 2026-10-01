/**
 * Elite modifier (decisions of 30.09.2026, elite.ts) through real engine commands: HP ×2 baked at load, +1 to every
 * attack on the cat (and only on the cat), loot only when the player kills the elite, 50% by the battle RNG, never on
 * the rest of the chain, the enemy under it crushed without credit, picked up by a chain, carried by the run.
 */
import { validateCustomLevel, type CustomEnemy, type CustomLevelDefinition } from './customLevel';
import { ELITE_HP_FACTOR } from './elite';
import { ForestEngine } from './forestEngine';
import type { EngineEvent, ForestCell, ItemKind } from './forestTypes';
import { ITEM_KINDS } from './items';
import { forestFixtureLevel } from './testing/fixtures';
import { availableNodes, enterNode, createForestRun, parseForestRun, resolveBattle, serializeForestRun } from './run/forestRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
/** Well-spread battle seeds: the first draw of the battle LCG barely differs between consecutive small seeds. */
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;

function level(enemies: CustomEnemy[], heroIndex: number, seed = 5): CustomLevelDefinition {
  return { version: 1, name: 'elite', seed, cols: 6, rows: 6, terrain: Array(36).fill('floor'), heroIndex, enemies, doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    playerHp: 9, inventory: { frost: 0, bomb: 2, healing: 0, fire: 0 } };
}
function start(definition: CustomLevelDefinition): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(definition), `level starts: ${validateCustomLevel(definition).errors.join('; ')}`);
  return g;
}
function record(g: ForestEngine): EngineEvent[] { const events: EngineEvent[] = []; g.subscribe((_state, event) => events.push(event)); return events; }
async function chain(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), `begin ${path[0]}`);
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
  assert(await g.releaseChain(), 'chain released');
}
// Two passive pairs keep an ordinary chain on the board without attacking.
const filler: CustomEnemy[] = [{ index: 30, kind: 'melee', color: 1, hp: 0 }, { index: 31, kind: 'melee', color: 1, hp: 0 }, { index: 34, kind: 'melee', color: 1, hp: 0 }, { index: 35, kind: 'melee', color: 1, hp: 0 }];

function bakingAndValidation() {
  const g = start(level([{ index: 7, kind: 'ranged', color: 0, hp: 3, elite: true }, { index: 8, kind: 'melee', color: 0, hp: 2, variant: 'sentinel', elite: true }, ...filler], 22));
  const archer = g.state.board[7]!, sentinel = g.state.board[8]!;
  assert(archer.elite && archer.hp === 3 * ELITE_HP_FACTOR && archer.maxHp === 6 && sentinel.elite && sentinel.hp === 4, 'authored HP doubled at load');
  const errors = (enemy: CustomEnemy) => validateCustomLevel(level([enemy, ...filler], 22)).errors.join(' ');
  assert(errors({ index: 7, kind: 'boss', color: null, hp: 5, elite: true }).includes('элитой'), 'a boss cannot be elite');
  assert(errors({ index: 7, kind: 'prism', color: null, hp: 1, elite: true }).includes('элитой'), 'a prism cannot be elite');
  assert(errors({ index: 7, kind: 'melee', color: 0, hp: 0, elite: true }).includes('элитой'), 'a 0-HP elite is rejected (doubling gives nothing)');
  assert(!errors({ index: 7, kind: 'melee', color: 0, hp: 1, elite: true }), 'an ordinary goblin with HP may be elite');
  console.log('PASS baking: HP ×2 at load; validator: only ordinary enemies with HP ≥ 1');
}

/** Rest under one attack: the cat's HP loss of the elite version minus the plain one. Preview equals execution. */
async function heroDamage(attacker: (elite: boolean) => CustomEnemy[], heroIndex: number, label: string): Promise<{ plain: number; elite: number }> {
  const result = { plain: 0, elite: 0 };
  for (const elite of [false, true]) {
    const g = start(level([...attacker(elite), ...filler], heroIndex));
    const before = g.state.player.hp, preview = g.previewRest();
    assert(await g.waitTurn(), `${label}: rest resolves`);
    assert(before - g.state.player.hp === preview.damage, `${label}: forecast ${preview.damage}, executed ${before - g.state.player.hp}`);
    result[elite ? 'elite' : 'plain'] = preview.damage;
  }
  return result;
}
async function heroDamageBonus() {
  // Melee: an armed goblin beside the cat.
  const melee = await heroDamage(elite => [{ index: 21, kind: 'melee', color: 0, hp: 1, aggressive: true, elite }], 22, 'melee');
  assert(melee.elite === melee.plain + 1 && melee.plain === 1, `melee: ${melee.plain} → ${melee.elite}`);
  // Arrow: the archer's line crosses a goblin before the cat; the creature takes the plain damage.
  let crossedHp = -1;
  for (const elite of [false, true]) {
    const g = start(level([{ index: 4, kind: 'ranged', color: 0, hp: 2, aggressive: true, elite }, { index: 10, kind: 'melee', color: 1, hp: 5 }, ...filler], 22));
    const before = g.state.player.hp, preview = g.previewRest();
    assert(await g.waitTurn(), 'arrow: rest resolves');
    assert(before - g.state.player.hp === preview.damage, 'arrow: forecast equals execution');
    if (elite) { assert(preview.damage === 2, `elite arrow hits the cat for 2 (got ${preview.damage})`); crossedHp = g.state.board[10]?.hp ?? -1; }
    else assert(preview.damage === 1, 'plain arrow hits the cat for 1');
  }
  assert(crossedHp === 4, `the elite's arrow still deals 1 to a creature on its line (HP ${crossedHp})`);
  // Boar ram: the charge at the cat right below it (the empty cells of the board are refilled at load).
  const ram = await heroDamage(elite => [{ index: 16, kind: 'melee', variant: 'boar', color: 0, hp: 3, aggressive: true, elite }], 22, 'ram');
  assert(ram.elite === ram.plain + 1, `ram: ${ram.plain} → ${ram.elite}`);
  console.log('PASS +1 to the cat from an elite swing, arrow and ram; creatures on the arrow line take the plain damage');
}

/** The camp fixture with the blue chain D6→E6→F6→F5 crossing an elite on F6 (40). */
function camp(seed: number): ForestEngine {
  const definition = forestFixtureLevel(seed);
  definition.enemies = definition.enemies.map(enemy => enemy.index === 40 ? { ...enemy, hp: 1, elite: true } : enemy);
  return start(definition);
}
const PATH = [38, 39, 40, 33];
async function chainLoot() {
  let drops = 0;
  const items = new Set<ItemKind>();
  for (let seed = 1; seed <= 40; seed++) {
    const g = camp(spread(seed)), events = record(g);
    assert(g.state.board[40]!.elite && g.state.board[40]!.hp === 2, 'the elite on F6 has 2 HP');
    const preview = g.preview(PATH);
    assert(preview.valid && preview.kills === 4, `seed ${seed}: the chain kills the elite and goes on`);
    await chain(g, PATH);
    assert(g.state.objective.kills === 4, `seed ${seed}: the chain's 4 kills are credited, a crushed enemy is not`);
    const loot = events.filter(event => event.type === 'loot');
    assert(loot.length <= 1, `seed ${seed}: one roll per elite`);
    if (!loot.length) continue;
    drops++;
    const at = loot[0].index!, cell = g.state.board[at];
    items.add(loot[0].text as ItemKind);
    assert(at !== 33 && at !== g.state.player.index, `seed ${seed}: the loot never lands on the rest of the chain or the cat`);
    assert(cell?.kind === 'prism' && cell.loot === loot[0].text && ITEM_KINDS.includes(cell.loot!), `seed ${seed}: the loot lies as a prism carrying its item`);
    // Same seed and actions: the same drop.
    const again = camp(spread(seed)), replay = record(again);
    await chain(again, PATH);
    assert(JSON.stringify(replay.filter(event => event.type === 'loot')) === JSON.stringify(loot), `seed ${seed}: the drop repeats exactly`);
  }
  assert(drops >= 8 && drops <= 32, `about half of the kills drop loot (${drops} of 40)`);
  assert(items.size >= 2, `the item varies (${[...items].join()})`);
  console.log(`PASS chain kills of an elite: ${drops}/40 drops, items ${[...items].join(', ')}, never on the rest of the chain, repeatable, crushed enemies uncredited`);
}

async function noLootFromEnemies() {
  // A boar's ram (2) kills an elite goblin (1 → 2 HP): an enemy ability, no loot.
  for (let seed = 1; seed <= 20; seed++) {
    const g = start(level([{ index: 4, kind: 'melee', variant: 'boar', color: 0, hp: 3, aggressive: true }, { index: 10, kind: 'melee', color: 1, hp: 1, elite: true }, ...filler], 22, spread(seed)));
    const events = record(g);
    assert(await g.waitTurn(), 'rest resolves');
    assert(!g.state.board.some(cell => cell?.elite), `seed ${seed}: the ram killed the elite`);
    assert(!events.some(event => event.type === 'loot'), `seed ${seed}: an enemy's kill drops no loot`);
  }
  console.log('PASS an elite killed by an enemy ability drops nothing');
}

async function bombLoot() {
  let drops = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = start(level([{ index: 14, kind: 'melee', color: 0, hp: 2, elite: true }, ...filler], 22, spread(seed)));
    const events = record(g);
    assert(g.useItem('bomb', 14) && !g.state.board.some(cell => cell?.elite), `seed ${seed}: the bomb kills the elite`);
    if (events.some(event => event.type === 'loot')) drops++;
  }
  assert(drops > 3 && drops < 27, `a bomb kill drops loot about half of the time (${drops}/30)`);
  console.log(`PASS an elite killed by an item drops loot (${drops}/30)`);
}

async function pickup() {
  // A dropped consumable on E6 (39): the chain D6→E6→F6→F5 passes it like a crystal.
  const g = camp(1), events = record(g);
  const id = Math.max(...g.state.board.map(cell => cell?.id ?? 0)) + 1000;
  const loot: ForestCell = { id, kind: 'prism', color: null, hp: 1, maxHp: 1, armor: 0, countdown: 2, loot: 'bomb',
    status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: '' } };
  g.state.board[39] = loot;
  const bombs = g.state.inventory.bomb, prisms = g.state.objective.prisms;
  const preview = g.preview(PATH);
  assert(preview.valid && preview.hits.some(hit => hit.index === 39 && hit.loot === 'bomb'), 'the preview shows the pickup');
  await chain(g, PATH);
  assert(g.state.inventory.bomb === bombs + 1 && g.state.objective.prisms === prisms, 'the item joins the inventory; it is not a prism objective');
  assert(events.some(event => event.type === 'loot-pickup' && event.index === 39 && event.text === 'bomb'), 'a loot-pickup event is published');
  console.log('PASS a chain passing the loot picks it up into the inventory');
}

function runCarriesLoot() {
  // A won battle that ends with one more bomb than it started with: the save holds it.
  let run = createForestRun(77);
  const first = availableNodes(run)[0];
  const entered = enterNode(run, first.id);
  assert(entered.ok, 'enter the first battle');
  run = entered.run;
  const pending = run.pending as { entry: { player: { hp: number; maxHp: number; energy: number }; inventory: Record<ItemKind, number> } };
  const inventory = { ...pending.entry.inventory, bomb: pending.entry.inventory.bomb + 1 };
  const won = resolveBattle(run, { nodeId: first.id, won: true, player: { ...pending.entry.player }, inventory });
  assert(won.ok && won.run.loot.some(gain => gain.nodeId === first.id && gain.item === 'bomb' && gain.count === 1), 'the run records the picked-up bomb');
  const parsed = parseForestRun(serializeForestRun(won.run));
  assert(parsed && parsed.resources.inventory.bomb === inventory.bomb, 'a save with the looted bomb loads');
  const tampered = JSON.parse(serializeForestRun(won.run)); tampered.resources.inventory.bomb++;
  assert(parseForestRun(JSON.stringify(tampered)) === null, 'one bomb more than grants, finds and loot is rejected');
  const legacy = JSON.parse(serializeForestRun(won.run)); delete legacy.loot; legacy.resources.inventory.bomb--;
  assert(parseForestRun(JSON.stringify(legacy))?.loot.length === 0, 'a save from before loot loads with no loot');
  console.log('PASS the run records looted items; saves stay bounded by grants, finds and loot');
}

bakingAndValidation();
await heroDamageBonus();
await chainLoot();
await noLootFromEnemies();
await bombLoot();
await pickup();
runCarriesLoot();
console.log('PASS elite');
