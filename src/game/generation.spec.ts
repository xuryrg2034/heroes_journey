import type { ForestEngine } from './forestEngine';
import { hasOrdinaryChain } from './boardGeneration';
import { isWalkable } from './forestSystems';
import { FOREST_NODE_BATTLES } from './run/forestBattles';
import { FOREST_FIXTURE_OPENING, startForestFixture, startNodeBattle } from './testing/fixtures';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
async function chain(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'begin generation route'); for (const index of path.slice(1)) assert(g.extendChain(index), 'extend generation route');
  assert(await g.releaseChain(), 'commit generation route');
}
function dense(g: ForestEngine) {
  // Device cells stay empty by design: refill never covers a lever or a brazier.
  g.state.board.forEach((cell, index) => { if (isWalkable(g.state, index) && !g.state.devices.some(device => device.index === index)) assert(index === g.state.player.index ? !cell : !!cell, `published generation is dense at ${index}`); });
}
function corridor() {
  const g = startForestFixture(984);
  const first = g.state.board[44]!, second = g.state.board[37]!;
  g.state.board.fill(null); g.state.terrain.fill('wall');
  for (const index of [37, 44, 45]) g.state.terrain[index] = 'floor';
  g.state.board[44] = first; g.state.board[37] = second; first.color = second.color = 0;
  return g;
}
async function naturalRefill() {
  for (const seed of [984, 2178, 2760]) {
    const g = startForestFixture(seed);
    const [opening, route] = FOREST_FIXTURE_OPENING.map(path => [...path]);
    await chain(g, opening); const before = g.getBoardState(), survivorObjects = [...g.state.board];
    const preview = g.preview(route), killed = new Set(preview.hits.filter(hit => hit.killed).map(hit => before[hit.index]!.id));
    const crushed = new Set<number>(), events: string[] = []; let publications = 0;
    g.subscribe((state, event) => {
      events.push(event.type);
      if (event.type === 'crystal' && event.oldId !== undefined) crushed.add(event.oldId);
      if (state.turn === 2 && event.type === 'spawn' && state.phase === 'BOARD_UPDATE') {
        publications++; dense(g); assert(hasOrdinaryChain(state), 'every published candidate already has an ordinary chain');
        assert(state.objective.kills === 8, 'rejected refill candidates grant no player kill credit');
      }
    });
    await chain(g, route);
    assert(publications === 1 && !events.includes('reshuffle'), 'the accepted refill is published once, without emergency rearrangement');
    before.forEach((cell, index) => {
      if (!cell || killed.has(cell.id) || crushed.has(cell.id)) return;
      const actual = g.state.board[index];
      assert(actual === survivorObjects[index] && actual?.hp === cell.hp && actual.color === cell.color && JSON.stringify(actual.status) === JSON.stringify(cell.status), 'surviving published enemies retain object identity, HP, colors, status and position');
    });
    const result = JSON.stringify(g.state); g.restartLevel(); await chain(g, opening); await chain(g, route);
    assert(JSON.stringify(g.state) === result, 'candidate rejection consumes RNG deterministically across restart');
  }
  console.log('PASS camp refill validated before publication, survivors, no refill credit and restart replay');
}
async function finiteFallbackAndDeferral() {
  const g = corridor(); g.state.board[37]!.color = 4; g.state.inventory.bomb = 1; g.state.chosenAbility = 'jump'; g.state.player.energy = 0;
  const existing = g.state.board[37]!, old = JSON.stringify(existing); let draws = 0, spawns = 0;
  const internals = g as unknown as { random(): number; nextId: number };
  const firstId = internals.nextId; internals.random = () => { draws++; return 0.5; };
  g.subscribe((_state, event) => { if (event.type === 'spawn') spawns++; });
  assert(g.useItem('bomb', 44), 'item creates exactly one unpublished ordinary replacement');
  // One weighted palette draw per candidate. Since 04.10.2026 a single hit is an opening: the cat already has a hittable
  // neighbour (37), so the first candidate is accepted — one draw, no fallback (before: 32 rejected samples, then a recolour).
  assert(draws === 1 && g.state.board[44]!.id === firstId && spawns === 1, 'the first candidate is accepted: one draw, no rejected IDs, published once');
  assert(g.state.board[37] === existing && JSON.stringify(existing) === old && hasOrdinaryChain(g.state), 'only new slot changes color and ordinary validation ignores selected ability/zero energy');

  console.log('PASS bounded random attempts (a single hit opens at once), new-slot-only colours, independent ordinary validation');
}
async function unchangedPlayerTrap() {
  // A constructed legal position checks the unchanged no-rescue contract under eight-way geometry.
  // This is explicitly a fixture, not a natural-seed claim.
  const trapped = startForestFixture(701);
  const prototype = trapped.state.board[44]!; trapped.state.board.fill(null); trapped.state.terrain.fill('wall');
  trapped.state.player.index = 45; trapped.state.player.energy = 2; trapped.state.terrain[45] = 'floor';
  const strong = [17, 23, 25, 31];
  for (const index of [...strong, 24, 43, 44]) {
    const cell = structuredClone(prototype); cell.id = 100000 + index;
    cell.hp = cell.maxHp = strong.includes(index) ? 20 : index === 24 ? 4 : 0; cell.color = 0;
    trapped.state.board[index] = cell; trapped.state.terrain[index] = 'floor';
  }
  assert(trapped.preview([44, 43]).valid && trapped.previewAbility('jump', 24).valid, 'player initially has a chain and can choose a bad distant landing');
  const survivors = strong.map(index => trapped.state.board[index]!);
  await trapped.useAbility('jump', 24);
  // Since 04.10.2026 a single hit is a move: the enclosed landing leaves only wounding hits on the durable neighbours —
  // a tactical cost, no dead end.
  const moves = trapped.availableMoves();
  assert(trapped.state.player.energy === 0 && hasOrdinaryChain(trapped.state) && moves.length > 0 && moves.every(path => path.length === 1 && strong.includes(path[0])), 'eight-way enclosed landing leaves only single wounding hits');
  assert(survivors.every((cell, n) => trapped.state.board[strong[n]] === cell && cell.hp === 20 && cell.color === 0), 'refill cannot recolor, damage or displace published blockers');
  await trapped.waitTurn();
  assert(trapped.state.player.energy === 0.5 && survivors.every(cell => cell.hp === 20 && cell.color === 0), 'rest earns only half energy without automatic rescue');
  console.log('PASS constructed eight-way bad jump: single wounding hits only, no rescue, unchanged living enemies');
}
async function pairGeneration() {
  const g = startForestFixture(984);
  // The resting archer on 30 announced a swap with the goblin on 37; the chain kills that partner (and the goblins on 44
  // and 36) and ends on 36, away from the pair: the living source swaps with a fresh replacement (a dead source would
  // drop its exchange, decision of 04.10.2026).
  const first = g.state.board[44]!, partner = g.state.board[37]!, archer = g.state.board[30]!, side = g.state.board[36]!;
  g.state.board.fill(null); g.state.terrain.fill('wall');
  for (const index of [30, 36, 37, 44, 45]) g.state.terrain[index] = 'floor';
  for (const cell of [first, partner, side]) { cell.color = 0; cell.kind = 'melee'; cell.hp = cell.maxHp = 0; }
  archer.color = 0; archer.kind = 'ranged'; archer.hp = archer.maxHp = 2; archer.behavior.restTurns = 1;
  g.state.board[44] = first; g.state.board[37] = partner; g.state.board[30] = archer; g.state.board[36] = side;
  g.state.rotations = [{ from: 30, to: 37, sourceId: archer.id, targetId: partner.id, geometry: 'cardinal' }];
  // Consecutive draws walk through all five colours, so raw replacement colours never form a chain by themselves.
  let draw = 0; (g as unknown as { random(): number }).random = () => [0.1, 0.3, 0.5, 0.7, 0.9][draw++ % 5];
  const published = new Map<number, number | null>(); const events: string[] = [];
  g.subscribe((state, event) => {
    events.push(event.type);
    if (event.type === 'spawn' && state.phase === 'ENEMY_RESOLVE') for (const index of event.indices!) {
      const cell = state.board[index]!; published.set(cell.id, cell.color);
    }
  });
  await chain(g, [44, 37, 36]);
  assert(published.size === 1 && events.indexOf('spawn') < events.indexOf('enemy-swap') && hasOrdinaryChain(g.state), 'pair generation validates a post-swap ordinary witness before publishing the replacement');
  assert(g.state.board[30]?.kind === 'melee' && g.state.board[37]?.id === archer.id, 'the living archer swapped with the fresh replacement');
  for (const [id, color] of published) {
    const survivor = g.state.board.find(cell => cell?.id === id);
    assert(survivor && survivor.color === color, 'later refill cannot repaint a published replacement');
  }
  assert(!events.includes('reshuffle'), 'no live reshuffle'); dense(g);
  console.log('PASS pre-swap replacement validation uses projected swaps and preserves published replacement colors');
}
function witnessRules() {
  const g = corridor(), original = g.state.board[44]!;
  g.state.player.index = 24; g.state.board.fill(null); g.state.terrain.fill('wall');
  for (const index of [24, 23, 22, 21, 14]) g.state.terrain[index] = 'floor';
  for (const index of [23, 22, 21, 14]) g.state.board[index] = { ...original, id: 91000 + index, status: { ...original.status }, behavior: { ...original.behavior }, intent: { ...original.intent, cells: [] } };
  for (const index of [22, 21]) { g.state.board[index]!.kind = 'prism'; g.state.board[index]!.color = null; }
  g.state.board[14]!.color = 2; const before = JSON.stringify(g.state);
  assert(hasOrdinaryChain(g.state) && g.availableMoves().some(path => path.join() === '23,22,21,14') && JSON.stringify(g.state) === before, 'four-cell witness covers two prisms without mutating the supplied state');
  g.state.chosenAbility = 'jump'; g.state.player.energy = 0;
  assert(hasOrdinaryChain(g.state), 'ordinary witness is independent of selected ability and current energy');
}
function initialScenes() {
  const check = (label: string, start: (observe: (g: ForestEngine) => void) => ForestEngine) => {
    let starts = 0;
    const g = start(engine => engine.subscribe((state, event) => { if (event.type === 'start') { starts++; assert(hasOrdinaryChain(state), `${label}: initial scene validates its ordinary opening before start publication`); dense(engine); } }));
    assert(starts === 1 && g.availableMoves().length > 0, `${label}: quick witness agrees with actual move search`);
  };
  // The start event fires inside the fixture helpers, so the observer is attached by restarting the loaded battle.
  const restarted = (engine: ForestEngine, observe: (g: ForestEngine) => void) => { observe(engine); engine.restartLevel(); return engine; };
  for (const seed of [1, 21, 32, 83, 701, 984]) check(`camp seed ${seed}`, observe => restarted(startForestFixture(seed), observe));
  for (const id of Object.keys(FOREST_NODE_BATTLES)) for (const seed of [1, 83, 984]) check(`${id} seed ${seed}`, observe => restarted(startNodeBattle(id, { seed }), observe));
  console.log('PASS camp and every map-node battle validate new content before start; quick witness agrees with ordinary move search');
}
void naturalRefill().then(finiteFallbackAndDeferral).then(pairGeneration).then(witnessRules).then(unchangedPlayerTrap).then(initialScenes).catch(error => { console.error(error); throw error; });
