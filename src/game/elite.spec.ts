/**
 * Elite modifier (decisions of 30.09.2026, elite.ts) through real engine commands: HP ×2 baked at load, +1 to every
 * attack on the cat (and only on the cat), loot only when the player kills the elite, 50% by the battle RNG, never on
 * the rest of the chain, the enemy under it crushed without credit, picked up by a chain, carried by the run.
 */
import { validateCustomLevel, type CustomEnemy, type CustomLevelDefinition } from './customLevel';
import { ELITE_HP_FACTOR } from './elite';
import { ForestEngine } from './forestEngine';
import type { EngineEvent, ItemKind } from './forestTypes';
import { ITEM_KINDS } from './items';
import { forestFixtureLevel } from './testing/fixtures';
import { availableNodes, createForestRun, enterNode, parseForestRun, resolveBattle, serializeForestRun } from './run/forestRun';
import { nodeBattleTemplate } from './run/forestMap';

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

/**
 * A real drop picked up by a later chain: the item joins the inventory; no power, energy, score or prism objective for
 * it. Searches the spread seeds for a drop that a legal chain can reach.
 */
async function pickup() {
  for (let seed = 1; seed <= 60; seed++) {
    const g = camp(spread(seed)), events = record(g);
    await chain(g, PATH);
    const drop = events.find(event => event.type === 'loot');
    if (!drop || g.state.phase !== 'PLAYER_INPUT') continue;
    const at = drop.index!, item = drop.text as ItemKind;
    const path = g.availableMoves(8).find(candidate => candidate.includes(at));
    if (!path) continue;
    const preview = g.preview(path), hit = preview.hits.find(entry => entry.index === at)!;
    assert(preview.valid && hit.loot === item && !hit.physical, `seed ${seed}: the preview shows the pickup of ${item}`);
    const enemyHits = preview.hits.filter(entry => g.state.board[entry.index]?.kind !== 'prism' && g.state.board[entry.index]?.kind !== 'door').length;
    assert(preview.energyGain === Math.min(7 - g.state.player.energy, enemyHits * 0.5), `seed ${seed}: no energy for the pickup`);
    const items = g.state.inventory[item], prisms = g.state.objective.prisms;
    let scoreBefore = g.state.score, pickupScore = -1;
    g.subscribe((state, event) => { if (event.type === 'collect' && event.index === at) pickupScore = state.score - scoreBefore; scoreBefore = state.score; });
    await chain(g, path);
    assert(g.state.inventory[item] === items + 1 && g.state.objective.prisms === prisms, `seed ${seed}: the item joins the inventory; not a prism objective`);
    assert(pickupScore === 0, `seed ${seed}: the pickup scores nothing (got ${pickupScore})`);
    assert(events.some(event => event.type === 'loot-pickup' && event.index === at && event.text === item), `seed ${seed}: a loot-pickup event`);
    console.log(`PASS a real drop (seed ${spread(seed)}) is picked up by a later chain: +1 ${item}, no power, energy, score or prism objective`);
    return;
  }
  throw new Error('no reachable drop on 60 seeds');
}

/** Review of 01.10.2026: loot after an ability is drawn from a copy of the live RNG in its forecast (spin). */
async function abilityForecast() {
  let drops = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const enemies: CustomEnemy[] = [16, 17, 18, 25, 30, 31, 32].map(index => ({ index, kind: 'melee', color: 0, hp: 1, elite: true }));
    enemies.push({ index: 23, kind: 'melee', color: 0, hp: 0 });
    for (const index of [3, 21, 27, 45, 0, 6, 42, 48]) enemies.push({ index, kind: 'ranged', color: 1, hp: 3, aggressive: true });
    for (const index of [10, 38, 22, 26]) enemies.push({ index, kind: 'melee', color: 1, hp: 3, aggressive: true });
    const g = start({ ...level(enemies, 24, spread(seed)), cols: 7, rows: 7, terrain: Array(49).fill('floor'), playerHp: 20 });
    g.state.player.energy = 7;
    const before = g.state.player.hp, preview = g.previewAbility('spin'), events = record(g);
    assert(preview.valid && await g.useAbility('spin'), `seed ${seed}: spin`);
    if (events.some(event => event.type === 'loot')) drops++;
    assert(before - g.state.player.hp === preview.damage && !!preview.playerDies === (g.state.player.hp === 0), `seed ${seed}: spin forecast ${preview.damage}, executed ${before - g.state.player.hp}`);
  }
  assert(drops > 0, 'loot fell after the spin');
  console.log(`PASS the spin forecast equals execution with loot falling after it (${drops}/60 seeds)`);
}

/** Review of 01.10.2026: loot falling after one lever volley may change the next one; the preview shows the copy's. */
async function leversForecast() {
  let drops = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const enemies: CustomEnemy[] = [{ index: 21, kind: 'melee', color: 0, hp: 0 }, { index: 17, kind: 'melee', color: 0, hp: 0 },
      { index: 11, kind: 'melee', color: 1, hp: 1, elite: true }, { index: 13, kind: 'melee', color: 1, hp: 3 }, { index: 8, kind: 'melee', color: 1, hp: 3 }, { index: 3, kind: 'melee', color: 1, hp: 3 }];
    const g = start({ ...level(enemies, 22, spread(seed)), cols: 5, rows: 5, terrain: Array(25).fill('floor'),
      devices: [{ index: 16, kind: 'arrows', charges: 1, targets: [11, 6, 1] }, { index: 18, kind: 'arrows', charges: 1, targets: [13, 8, 3] }] });
    const path = [21, 16, 17, 18], preview = g.preview(path);
    let volleys = false, trapKills = 0, dropped = false;
    g.subscribe((_state, event) => { if (event.type === 'trap') volleys = true; if (volleys && event.type === 'kill' && event.text !== 'loot') trapKills++; if (event.type === 'loot') dropped = true; });
    await chain(g, path);
    if (dropped) drops++;
    assert(trapKills === preview.trapKills, `seed ${seed}: lever kills forecast ${preview.trapKills}, executed ${trapKills}`);
  }
  assert(drops > 0, 'loot fell between the volleys');
  console.log(`PASS lever results in the preview equal execution when loot falls between volleys (${drops}/80 seeds)`);
}

/** The run keeps looted items within what the battle's elites can drop; made-up loot is rejected. */
function runCarriesLoot() {
  let run = createForestRun(77);
  const first = availableNodes(run)[0], template = nodeBattleTemplate(first)!;
  // The map has no elites yet: mark one in this battle for the test.
  const original = template.definition.enemies;
  template.definition.enemies = original.map((enemy, n) => n === 0 ? { ...enemy, elite: true } : enemy);
  try {
    const entered = enterNode(run, first.id);
    assert(entered.ok, 'enter the first battle');
    run = entered.run;
    const pending = run.pending as { entry: { player: { hp: number; maxHp: number; energy: number }; inventory: Record<ItemKind, number> } };
    const inventory = { ...pending.entry.inventory, bomb: pending.entry.inventory.bomb + 1 };
    const won = resolveBattle(run, { nodeId: first.id, won: true, player: { ...pending.entry.player }, inventory });
    assert(won.ok && won.run.loot.some(gain => gain.nodeId === first.id && gain.item === 'bomb' && gain.count === 1), 'the run records the picked-up bomb');
    const saved = serializeForestRun(won.run);
    assert(parseForestRun(saved)?.resources.inventory.bomb === inventory.bomb, 'a save with the looted bomb loads');
    const tamper = (change: (value: Record<string, any>) => void) => { const value = JSON.parse(saved); change(value); return parseForestRun(JSON.stringify(value)); };
    assert(tamper(value => { value.resources.inventory.bomb++; }) === null, 'one bomb more than grants, finds and loot is rejected');
    assert(tamper(value => { value.loot[0].count = 2; value.resources.inventory.bomb++; }) === null, 'more items than the battle has elites is rejected');
    assert(tamper(value => { value.loot.push({ nodeId: first.id, item: 'frost', count: 1 }); value.resources.inventory.frost++; }) === null, 'a second item from one elite is rejected');
    assert(tamper(value => { value.loot = [{ nodeId: 'trunk-2', item: 'bomb', count: 1 }]; }) === null, 'loot of a node not won is rejected');
    assert(tamper(value => { delete value.loot; value.resources.inventory.bomb--; })?.loot.length === 0, 'a save from before loot loads with no loot');
  } finally { template.definition.enemies = original; }
  const plain = createForestRun(78), node = availableNodes(plain)[0], step = enterNode(plain, node.id);
  assert(step.ok, 'enter');
  const value = JSON.parse(serializeForestRun(step.run));
  value.loot = [{ nodeId: node.id, item: 'bomb', count: 1 }];
  assert(parseForestRun(JSON.stringify(value)) === null, 'loot of a battle without elites (or not yet won) is rejected');
  console.log('PASS the run records looted items; saves stay bounded by the battle\'s elites, grants and finds');
}

bakingAndValidation();
await heroDamageBonus();
await chainLoot();
await noLootFromEnemies();
await bombLoot();
await pickup();
await abilityForecast();
await leversForecast();
runCarriesLoot();
console.log('PASS elite');
