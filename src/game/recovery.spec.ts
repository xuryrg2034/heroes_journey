import fixtureData from '../../tests/fixtures/recovered-movement.json';
import { FOREST_FIXTURE_OPENING, forestFixtureLevel, startForestFixture } from './testing/fixtures';
import { canSwapEnemies, prepareIntents, rotationPreview } from './forestSystems';
import { recoveredMoveTowards } from './recoveredEnemyMovement';
import type { ForestCell } from './forestTypes';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
function goldenVectors() {
  for (const vector of fixtureData.vectors) {
    const eligibilityCalls: number[][] = [], rngCalls: number[][] = [];
    const eligible = new Set(vector.eligible.map(point => point.join(',')));
    const actual = recoveredMoveTowards(vector.input, {
      canMoveTo: (x, y) => { eligibilityCalls.push([x, y]); return eligible.has(`${x},${y}`); },
      rand: (min, max) => { const draw = vector.draws[rngCalls.length]; rngCalls.push([min, max]); assert(draw !== undefined, `${vector.id} unexpected RNG draw`); return draw; },
    });
    equal(actual, vector.expected, `${vector.id} Python position`);
    equal(rngCalls.length, vector.expectedDraws, `${vector.id} Python draw count`);
    equal(rngCalls, vector.expectedRngCalls, `${vector.id} Python RNG calls`);
    equal(eligibilityCalls, vector.expectedEligibilityCalls, `${vector.id} Python eligibility order`);
  }
  console.log(`PASS ${fixtureData.vectors.length} actual recovered Python movement vectors, results and dependency call order`);
}
function fixture() {
  const g = startForestFixture(701);
  g.state.player.index = 45; g.state.terrain.fill('floor'); g.state.board.fill(null);
  return g;
}
let id = 50000;
function cell(kind: ForestCell['kind'] = 'melee'): ForestCell {
  return { id: id++, kind, hp: 4, maxHp: 4, color: 0, armor: 0, countdown: 1,
    behavior: { aggressive: false, restTurns: kind === 'ranged' ? 1 : 0 },
    status: { frozen: 0, brittle: false, wet: false }, intent: { cells: [], damage: 1, label: '' } };
}
function adapterRules() {
  const g = fixture(); g.state.board[24] = cell('ranged');
  for (const index of [17, 23, 25, 31]) g.state.board[index] = cell();
  let draws = 0; prepareIntents(g.state, () => { draws++; return 0; });
  assert(g.state.rotations[0]?.to === 31 && draws === 1, 'south toward hero wins over smaller north index');
  g.state.board[31] = null; draws = 0; prepareIntents(g.state, () => { draws++; return 0; });
  assert(g.state.rotations[0]?.to === 25 && draws === 2, 'same-distance east wins before farther north');
  g.state.board[23] = g.state.board[25] = null; draws = 0; prepareIntents(g.state, () => { draws++; return 0; });
  assert(g.state.rotations[0]?.to === 17 && draws === 3, 'third pass accepts retreat');
  g.state.board[17] = null; draws = 0; prepareIntents(g.state, () => { draws++; return 0; });
  assert(g.state.rotations.length === 0 && draws === 3, 'blocked native search consumes three draws without moving');

  for (const obstruction of ['hero', 'frozen-source', 'frozen-target', 'boss', 'door', 'prism', 'wall', 'diagonal'] as const) {
    const blocked = fixture(); blocked.state.board[24] = cell('ranged'); blocked.state.board[31] = cell();
    if (obstruction === 'hero') { blocked.state.player.index = 31; blocked.state.board[31] = null; }
    else if (obstruction === 'frozen-source') blocked.state.board[24]!.status.frozen = 1;
    else if (obstruction === 'frozen-target') blocked.state.board[31]!.status.frozen = 1;
    else if (obstruction === 'wall') blocked.state.terrain[31] = 'wall';
    else if (obstruction === 'diagonal') { blocked.state.board[32] = blocked.state.board[31]; blocked.state.board[31] = null; }
    else blocked.state.board[31]!.kind = obstruction;
    prepareIntents(blocked.state, () => 0);
    assert(!blocked.state.rotations.length, `${obstruction} excluded by occupied cardinal adapter`);
  }
  const paired = fixture(); paired.state.board[17] = cell('ranged'); paired.state.board[24] = cell(); paired.state.board[31] = cell('ranged');
  prepareIntents(paired.state, () => 0);
  assert(paired.state.rotations.length === 1 && canSwapEnemies(paired.state, 17, 24), 'reserved target cannot belong to second pair');
  const before = JSON.stringify(paired.state.rotations);
  paired.state.board[17] = null; paired.state.board[24] = null;
  assert(rotationPreview(paired.state)[0].active && JSON.stringify(paired.state.rotations) === before, 'announced pair survives both deaths without new selection');
  assert(!rotationPreview(paired.state, paired.state.board, 24)[0].active, 'hero still cancels announced endpoint');
  console.log('PASS integrated movement preference, all eligibility protections, disjoint pairs and death/hero semantics');
}
async function seededReplay() {
  // The camp with two authored archers (A3 and B5, off the opening routes) instead of the removed wave-2 arrivals.
  const level = forestFixtureLevel(984);
  const enemies = level.enemies.map(enemy => [2, 29].includes(enemy.index) ? { ...enemy, kind: 'ranged' as const, hp: 7 } : enemy);
  const g = startForestFixture(984, { enemies });
  const play = async () => {
    for (const path of FOREST_FIXTURE_OPENING.map(route => [...route])) {
      assert(g.beginChain(path[0]), 'natural opening begin'); for (const index of path.slice(1)) assert(g.extendChain(index), 'natural opening extend');
      assert(await g.releaseChain(), 'natural opening commit');
    }
    await g.waitTurn(); assert(g.state.rotations.length > 0, 'resting archers prepare a seeded rotation');
    const rng = (g as unknown as { rng: number }).rng, snapshot = JSON.stringify(g.state);
    for (let n = 0; n < 5; n++) { g.preview(); g.previewRotations(); }
    assert((g as unknown as { rng: number }).rng === rng && JSON.stringify(g.state) === snapshot, 'previews neither draw RNG nor change fixed intents');
    return snapshot;
  };
  const first = await play(); g.restartLevel(); equal(await play(), first, 'seeded intents and refill replay after restart');
  console.log('PASS seeded archer intent/refill restart replay and pure repeated previews');
}
goldenVectors(); adapterRules(); await seededReplay();
