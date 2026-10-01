/**
 * ECS stage 6: forecast = execution (docs/ecs-architecture.md §3.7). On every map battle, for the actions a player
 * can take (chains, Rest, jump, spin), the preview is compared with what the committed turn actually does:
 * the cat's HP (exact damage, decision Г of 01.10.2026: never more than its HP), its death, the victory, the forced
 * deaths, the effects left on the cat. Fire items between turns put burning on enemies so effect ticks take part.
 * Editor levels add porcupines, attackers that cause bleeding and poison and elites, with low HP and small kill goals. A
 * preview must not touch the live position, RNG or IDs, nor throw.
 */
import type { AbilityKind, ChainPreview, ForestState } from './forestTypes';
import { ForestEngine } from './forestEngine';
import { FOREST_NODE_BATTLES } from './run/forestBattles';
import { forestFixtureLevel, nodeBattleSetup, startForestFixture } from './testing/fixtures';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }

type Action = { kind: 'chain'; path: number[] } | { kind: 'rest' } | { kind: 'ability'; ability: AbilityKind; target?: number };
const SEEDS = [1, 701];
const STEPS = 8;

function startBattle(battleId: string, seed: number): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  const setup = nodeBattleSetup(battleId, { seed, player: { hp: 5, maxHp: 5, energy: 7 }, allowedAbilities: ['jump', 'spin'],
    allowedItems: ['fire', 'bomb', 'frost', 'healing'], inventory: { frost: 2, bomb: 2, healing: 1, fire: 6 } });
  if (!g.startRunBattle(setup)) throw new Error(`${battleId}: rejected`);
  return g;
}
const fingerprint = (g: ForestEngine) => { const s = g.captureAnalysisSnapshot(); return JSON.stringify([s.state, s.rng, s.nextId]); };

function candidates(g: ForestEngine): { action: Action; preview: ChainPreview }[] {
  const out: { action: Action; preview: ChainPreview }[] = [];
  for (const path of g.availableMoves(6).slice(0, 6)) out.push({ action: { kind: 'chain', path }, preview: g.preview(path) });
  out.push({ action: { kind: 'rest' }, preview: g.previewRest() });
  const spin = g.previewAbility('spin'); if (spin.valid) out.push({ action: { kind: 'ability', ability: 'spin' }, preview: spin });
  let jumps = 0;
  for (let target = 0; target < g.state.board.length && jumps < 2; target += 5) {
    const jump = g.previewAbility('jump', target); if (jump.valid) { jumps++; out.push({ action: { kind: 'ability', ability: 'jump', target }, preview: jump }); }
  }
  return out.filter(candidate => candidate.preview.valid);
}
async function act(g: ForestEngine, action: Action): Promise<boolean> {
  if (action.kind === 'rest') return g.waitTurn();
  if (action.kind === 'ability') return g.useAbility(action.ability, action.target);
  g.beginChain(action.path[0]); for (const index of action.path.slice(1)) g.extendChain(index);
  return g.releaseChain();
}

/** Effect stacks without the empty ones, in a fixed order. */
const effects = (value: object | undefined) => JSON.stringify(Object.entries(value ?? {}).filter(([, n]) => n).sort());
let lootDrops = 0, eliteHits = 0;
let compared = 0, deaths = 0, wins = 0, tickWins = 0, effectTurns = 0;
function compare(label: string, before: ForestState, preview: ChainPreview, after: ForestState) {
  compared++;
  assert(preview.damage <= before.player.hp, `${label}: forecast damage ${preview.damage} exceeds the cat's ${before.player.hp} HP`);
  assert(before.player.hp - preview.damage === after.player.hp, `${label}: forecast damage ${preview.damage} from ${before.player.hp} HP, executed ${after.player.hp} HP`);
  assert(!!preview.playerDies === (after.player.hp === 0), `${label}: forecast death ${!!preview.playerDies}, executed HP ${after.player.hp}`);
  const win = !!preview.completesRoom || !!preview.enemyPhase?.completesObjective;
  assert(win === (after.phase === 'WIN'), `${label}: forecast victory ${win}, executed phase ${after.phase}`);
  for (const death of preview.enemyPhase?.deaths ?? []) assert(!after.board.some(cell => cell?.id === death.id), `${label}: forecast death of ${death.id} (${death.cause}) did not happen`);
  if (after.phase === 'PLAYER_INPUT' && preview.endEffects) assert(effects(preview.endEffects) === effects(after.player.damageEffects),
    `${label}: forecast effects ${JSON.stringify(preview.endEffects)}, executed ${JSON.stringify(after.player.damageEffects)}`);
  if (after.player.hp === 0) deaths++;
  if (after.phase === 'WIN') { wins++; if (preview.enemyPhase?.completesObjective) tickWins++; }
}

async function play(battleId: string, seed: number, g: ForestEngine) {
  g.subscribe((state, event) => {
    if (event.type === 'loot') lootDrops++;
    if (event.type === 'damage' && event.from !== undefined && state.board[event.from]?.elite) eliteHits++;
  });
  for (let step = 0; step < STEPS && g.state.phase === 'PLAYER_INPUT'; step++) {
    // Burning on an enemy every other turn: effect ticks of the cat's targets take part in the enemy phase.
    if (step % 2 === 1 && g.state.inventory.fire > 0) {
      const target = g.state.board.findIndex(cell => cell && cell.kind !== 'door' && cell.kind !== 'prism');
      if (target >= 0 && g.previewItem('fire', target).valid) { await g.useItem('fire', target); effectTurns++; }
      if (g.state.phase !== 'PLAYER_INPUT') break;
    }
    const position = g.captureAnalysisSnapshot(), before = fingerprint(g);
    const options = candidates(g);
    assert(fingerprint(g) === before, `${battleId} seed ${seed} step ${step}: previews changed the live position, RNG or IDs`);
    for (const { action, preview } of options) {
      g.restoreAnalysisSnapshot(position);
      const state = g.captureAnalysisSnapshot().state;
      await act(g, action);
      compare(`${battleId} seed ${seed} step ${step} ${JSON.stringify(action)}`, state, preview, g.state);
    }
    // Advance with the longest chain (or Rest), as a greedy player would.
    g.restoreAnalysisSnapshot(position);
    const chains = options.filter(option => option.action.kind === 'chain' && !option.preview.playerDies);
    const pick = chains.sort((a, b) => (b.action as { path: number[] }).path.length - (a.action as { path: number[] }).path.length)[0];
    await act(g, pick?.action ?? { kind: 'rest' });
  }
}

/**
 * An editor level: porcupines, bleeding and poison attackers, low HP, a small kill goal (seeded variation). Seeds
 * above 20: no effects at all, every enemy armed and the cat at 1–2 HP — announced strikes exceed its HP.
 */
function startEditorLevel(seed: number): ForestEngine {
  const level = forestFixtureLevel(seed);
  let draw = seed * 7919;
  const random = () => { draw = (draw * 1103515245 + 12345) % 2147483648; return draw / 2147483648; };
  if (seed > 20) level.enemies = level.enemies.map(enemy => ({ ...enemy, aggressive: true }));
  else level.enemies = level.enemies.map(enemy => { const roll = random();
    return roll < 0.15 ? { ...enemy, variant: 'porcupine' as const } : roll < 0.3 ? { ...enemy, attackEffect: 'bleeding' as const, aggressive: true }
      : roll < 0.4 ? { ...enemy, attackEffect: 'poison' as const, aggressive: true }
      // Elites (elite.ts): +1 to the cat, loot falling during chains and after levers, items and ticks.
      : roll < 0.55 ? { ...enemy, hp: Math.max(1, enemy.hp), elite: true, aggressive: roll < 0.48 } : enemy; });
  level.goals = [{ key: 'kills', target: 3 + seed % 6 }]; level.playerHp = seed > 20 ? 1 + seed % 2 : 3 + seed % 4;
  const g = new ForestEngine(); g.animationScale = 0;
  if (!g.startCustomLevel(level)) throw new Error(`editor level ${seed}: rejected`);
  return g;
}

/**
 * Review of 01.10.2026: a one-enemy path that meets the goals while quills or bleeding force the safe-path check made
 * the forecast throw — in the start-cell list, at the chain start and in the refill witness of a live turn.
 */
async function goalOnOneKill() {
  const level = forestFixtureLevel();
  level.goals = [{ key: 'kills', target: 1 }]; level.playerHp = 1;
  level.enemies = level.enemies.map(enemy => enemy.index === 38 ? { ...enemy, variant: 'porcupine' as const } : enemy);
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(level) && g.validStarts().includes(38) && g.beginChain(38), 'a porcupine start next to a 1-HP cat with a one-kill goal');
  const bleeding = startForestFixture(701, { goals: [{ key: 'kills', target: 5 }], playerHp: 9 });
  bleeding.state.objective.kills = 4;
  bleeding.state.player.damageEffects = { burning: 0, burningTurns: 0, poison: 0, bleeding: 3, bleedingSteps: 0 };
  bleeding.validStarts(); bleeding.previewRest();
  assert(await bleeding.waitTurn() && bleeding.state.phase === 'PLAYER_INPUT', 'a bleeding cat one kill short of the goal rests and the board refills');
  console.log('PASS a one-kill goal under quills or bleeding: start cells, chain start and the refill witness');
}

async function main() {
  await goalOnOneKill();
  for (const battleId of Object.keys(FOREST_NODE_BATTLES)) for (const seed of SEEDS) await play(battleId, seed, startBattle(battleId, seed));
  for (let seed = 1; seed <= 30; seed++) await play(`editor-${seed}`, seed, startEditorLevel(seed));
  assert(compared > 500 && deaths > 0 && wins > 0 && effectTurns > 0 && lootDrops > 0 && eliteHits > 0,
    `coverage: ${compared} compared, ${deaths} deaths, ${wins} wins, ${effectTurns} fire turns, ${lootDrops} loot drops, ${eliteHits} elite hits on the cat`);
  console.log(`PASS forecast = execution: ${compared} actions on ${Object.keys(FOREST_NODE_BATTLES).length} battles × ${SEEDS.length} seeds and 30 editor levels; ${deaths} deaths, ${wins} victories (${tickWins} at the end of the turn), ${effectTurns} turns with burning enemies, ${lootDrops} elite loot drops, ${eliteHits} elite hits on the cat; previews leave the position, RNG and IDs untouched`);
}
await main();
