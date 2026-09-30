/**
 * ECS stage 3: one damage function, the kill command and rule observers (docs/ecs-architecture.md §3.5–3.7).
 * Observers are the extension points of the next mechanics (elite loot on death, chest, contracts statistics):
 * a new rule registers an observer instead of editing every damage or death site.
 */
import { applyDamage, heroTarget, killCreature } from './combatRules';
import { damagedObservers, deathObservers, onDamaged, onDeath, type DeathCredit } from './ecs/observers';
import { ForestEngine } from './forestEngine';
import type { ForestCell } from './forestTypes';
import { CHAIN_HIT_OBSERVERS, HERO_STEP_OBSERVERS } from './turnSystems';
import { forestFixtureLevel, nodeBattleSetup } from './testing/fixtures';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
let nextId = 9000;
const creature = (patch: Partial<ForestCell> = {}): ForestCell => ({ id: nextId++, kind: 'melee', color: 0, hp: 0, maxHp: 0, armor: 0, countdown: 2,
  status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: '' }, ...patch });

function registry() {
  assert(damagedObservers().join() === 'troll-hurt-mark', `damage observers: ${damagedObservers().join()}`);
  assert(deathObservers().join() === 'goal-progress', `death observers: ${deathObservers().join()}`);
  assert(CHAIN_HIT_OBSERVERS.map(observer => observer.name).join() === 'quills', 'chain-hit observers: quills');
  assert(HERO_STEP_OBSERVERS.map(observer => observer.name).join() === 'bleeding-step', 'hero-step observers: bleeding step');
  onDamaged('troll-hurt-mark', () => { throw new Error('a repeated name must not register twice'); });
  assert(damagedObservers().length === 1, 'a repeated observer name is ignored');
  console.log('PASS observer registry: troll mark, goal progress, quills, bleeding step; names are unique');
}

function damage() {
  const weak = creature(), outcome = applyDamage(weak, 1, 'physical');
  assert(outcome.killed && weak.defeated && outcome.hpRemoved === 0, 'a 0-HP enemy is defeated by any positive hit');
  const brittle = creature({ hp: 4, maxHp: 4, status: { wet: false, frozen: 0, brittle: true } });
  applyDamage(brittle, 1, 'effect'); assert(brittle.status.brittle, 'only physical damage clears brittleness');
  applyDamage(brittle, 1, 'physical'); assert(!brittle.status.brittle && brittle.hp === 2, 'physical damage clears brittleness');
  const troll = creature({ kind: 'boss', color: null, variant: 'troll', hp: 10, maxHp: 10 });
  applyDamage(troll, 0, 'hazard'); assert(!troll.behavior.hurtThisTurn, 'zero damage does not mark the troll');
  applyDamage(troll, 2, 'hazard'); assert(troll.behavior.hurtThisTurn, 'the troll-hurt-mark observer marks any positive damage');
  const state = { player: { index: 0, hp: 2, maxHp: 5, energy: 0 }, lastDamage: 1 };
  const hero = applyDamage(heroTarget(state), 5, 'melee');
  assert(hero.damage === 2 && hero.killed && state.player.hp === 0 && state.lastDamage === 3, 'cat damage is capped by HP and counted in lastDamage');
  console.log('PASS one damage function for creatures and the cat: defeat, brittleness, troll mark, HP cap');
}

async function deathsInPlay() {
  const seen: { id: number; credit: DeathCredit; onBoard: boolean }[] = [];
  onDeath('spec-probe', (state, cell, _index, credit) => { seen.push({ id: cell.id, credit, onBoard: state.board.some(entry => entry?.id === cell.id) }); });
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(forestFixtureLevel(83)), 'camp starts');
  const kills: number[] = [];
  g.subscribe((_state, event) => { if (event.type === 'kill') kills.push(event.index!); });
  const path = g.availableMoves(6).find(move => move.length >= 3)!;
  const expected = path.map(index => g.state.board[index]!.id);
  g.beginChain(path[0]); for (const index of path.slice(1)) g.extendChain(index);
  const killsBefore = g.state.objective.kills;
  await g.releaseChain();
  const credited = seen.filter(entry => expected.includes(entry.id));
  assert(credited.length === path.length && credited.every(entry => entry.credit === 'player' && !entry.onBoard), 'every chain kill notifies death observers after removal, credited to the player');
  assert(g.state.objective.kills - killsBefore >= path.length && kills.length >= path.length, 'goal progress observer counted the kills');
  // Doors and prisms are removed without observers.
  const before = seen.length, state = g.state;
  const door = creature({ kind: 'door', color: null, hp: 1, maxHp: 1, door: { label: 'x', breached: false, footprint: [0] } });
  killCreature(state, door, 0, 'player');
  assert(seen.length === before, 'a door death does not notify');
  // Enemy phases on a battle with archers and wolves: every death that reaches the observers carries a known credit.
  const lair = new ForestEngine(); lair.animationScale = 0;
  assert(lair.startRunBattle(nodeBattleSetup('den-watch', { seed: 3 })), 'den watch starts');
  for (let turn = 0; turn < 6 && lair.state.phase === 'PLAYER_INPUT'; turn++) await lair.waitTurn();
  assert(seen.every(entry => ['player', 'enemy', 'environment', 'none'].includes(entry.credit)), 'every death carries a known credit');
  console.log(`PASS death observers see ${seen.length} deaths after removal with their credit; doors never notify`);
}

async function main() {
  registry();
  damage();
  await deathsInPlay();
  console.log('PASS ecs observers');
}
main().catch(error => { console.error(error); throw error; });
