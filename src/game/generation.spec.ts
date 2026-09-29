import { ForestEngine } from './forestEngine';
import { hasOrdinaryChain } from './boardGeneration';
import { isWalkable } from './forestSystems';
import type { ForestCell, RoomTheme } from './forestTypes';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
async function chain(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'begin generation route'); for (const index of path.slice(1)) assert(g.extendChain(index), 'extend generation route');
  assert(await g.releaseChain(), 'commit generation route');
}
function dense(g: ForestEngine) {
  g.state.board.forEach((cell, index) => { if (isWalkable(g.state, index)) assert(index === g.state.player.index ? !cell : !!cell, 'published generation is dense'); });
}
function corridor() {
  const g = new ForestEngine(984); g.animationScale = 0; g.startLevel();
  const first = g.state.board[44]!, second = g.state.board[37]!;
  g.state.board.fill(null); g.state.terrain.fill('wall');
  for (const index of [37, 44, 45]) g.state.terrain[index] = 'floor';
  g.state.board[44] = first; g.state.board[37] = second; first.color = second.color = 0;
  g.state.wave = 3; g.state.spawnCounts = { archers: 2, boss: 1 }; return g;
}
async function naturalArrivals() {
  for (const seed of [984, 2178, 2760]) {
    const g = new ForestEngine(seed); g.animationScale = 0; g.startLevel();
    await chain(g, [38, 39, 40, 33]); const before = g.getBoardState(), survivorObjects = [...g.state.board];
    const route = [26, 19, 20, 13], preview = g.preview(route), killed = new Set(preview.hits.filter(hit => hit.killed).map(hit => before[hit.index]!.id));
    const arrivals = new Set<number>(), events: string[] = []; let publications = 0;
    g.subscribe((state, event) => {
      events.push(event.type);
      if (event.type === 'special-arrival') arrivals.add(event.oldId!);
      if (state.turn === 2 && (event.type === 'spawn' && state.phase === 'BOARD_UPDATE' || event.type === 'special-arrival')) {
        publications++; dense(g); assert(hasOrdinaryChain(state), 'every published candidate already has an ordinary chain');
        assert(state.spawnCounts.archers === 2 && state.board.filter(cell => cell?.kind === 'ranged').length === 2, 'both arrivals commit atomically before first event');
        assert(state.objective.kills === 8 && state.objective.rangedKills === 0, 'rejected candidates and replacement victims grant no player kill credit');
      }
    });
    await chain(g, route);
    assert(publications >= 2 && arrivals.size === 2 && !events.includes('reshuffle'), 'only accepted arrival events publish, without emergency rearrangement');
    before.forEach((cell, index) => {
      if (!cell || killed.has(cell.id) || arrivals.has(cell.id)) return;
      const actual = g.state.board[index];
      assert(actual === survivorObjects[index] && actual?.hp === cell.hp && actual.color === cell.color && JSON.stringify(actual.status) === JSON.stringify(cell.status), 'surviving published enemies retain object identity, HP, colors, status and position');
    });
    const result = JSON.stringify(g.state); g.restartLevel(); await chain(g, [38, 39, 40, 33]); await chain(g, route);
    assert(JSON.stringify(g.state) === result, 'candidate rejection consumes RNG deterministically across restart');
  }
  console.log('PASS natural two-archer blocking seeds rerolled before publication, atomic quotas, survivors, no NPC credit and restart replay');
}
async function finiteFallbackAndDeferral() {
  const g = corridor(); g.state.board[37]!.color = 4; g.state.inventory.bomb = 1; g.state.chosenAbility = 'jump'; g.state.player.energy = 0;
  const existing = g.state.board[37]!, old = JSON.stringify(existing); let draws = 0, spawns = 0;
  const internals = g as unknown as { random(): number; nextId: number };
  const firstId = internals.nextId; internals.random = () => { draws++; return 0.5; };
  g.subscribe((_state, event) => { if (event.type === 'spawn') spawns++; });
  assert(g.useItem('bomb', 44), 'item creates exactly one unpublished ordinary replacement');
  assert(draws === 64 && g.state.board[44]!.color === 4 && g.state.board[44]!.id === firstId && spawns === 1, '32 rejected color samples use finite exact five-color fallback without publishing or consuming rejected IDs');
  assert(g.state.board[37] === existing && JSON.stringify(existing) === old && hasOrdinaryChain(g.state), 'only new slot changes color and ordinary validation ignores selected ability/zero energy');

  const pending = corridor(); pending.state.wave = 2; pending.state.spawnCounts = { archers: 0, boss: 0 };
  const eventIds: number[] = []; pending.subscribe((_state, event) => { if (event.type === 'special-arrival') eventIds.push(event.newId!); });
  await pending.waitTurn();
  assert(pending.state.spawnCounts.archers === 1 && pending.state.board[37]?.kind === 'ranged' && pending.state.board[44]?.kind === 'melee' && hasOrdinaryChain(pending.state), 'unsafe full quota is partially deferred after finite victim search');
  await pending.waitTurn(); assert(pending.state.spawnCounts.archers === 1 && eventIds.length === 1, 'no safe remaining victim leaves quota pending without duplicate events');
  const victim: ForestCell = { ...pending.state.board[44]!, id: 90000, status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: 'Fixture' } };
  pending.state.board[0] = victim; pending.state.terrain[0] = 'floor'; pending.state.board[37]!.status.frozen = 1; await pending.waitTurn();
  assert(pending.state.spawnCounts.archers === 2 && pending.state.board[0]?.kind === 'ranged' && new Set(eventIds).size === 2, 'later safe victim fulfills exact deferred quota');
  dense(pending);
  console.log('PASS bounded random attempts, new-slot-only exact color fallback, independent ordinary validation, partial and resumed quotas');
}
async function unchangedPlayerTrap() {
  const g = new ForestEngine(21); g.animationScale = 0; g.startScenario('barracks', 21);
  assert(g.useItem('bomb', 22), 'spend bomb without removing distant elite');
  await chain(g, [38, 39]); await chain(g, [32, 31, 38]); assert(await g.useAbility('jump', 24), 'first natural jump');
  // Five-color refill now leaves a two-chair group here; Rest earns the missing
  // half energy before visiting the same unchanged diagonal-escape position.
  await chain(g, [31, 32]); await g.waitTurn(); const elite = g.state.board[10]!, commander = g.state.board[12]!;
  assert(await g.useAbility('jump', 11), 'historical natural jump remains legal');
  assert(g.state.player.energy === 0 && hasOrdinaryChain(g.state) && g.preview([19, 12]).valid, 'old cardinal-only trap now has a legal diagonal escape');
  assert(g.state.board[10] === elite && g.state.board[12] === commander && elite.hp === 10 && commander.hp === 16, 'new escape comes from diagonal geometry, without weakening or replacing existing enemies');

  // A constructed legal position checks the unchanged no-rescue contract under eight-way geometry.
  // Unlike the historical route above, this is explicitly a fixture, not a natural-seed claim.
  const trapped = new ForestEngine(701); trapped.animationScale = 0; trapped.startLevel();
  const prototype = trapped.state.board[44]!; trapped.state.board.fill(null); trapped.state.terrain.fill('wall');
  trapped.state.player.index = 45; trapped.state.player.energy = 2; trapped.state.terrain[45] = 'floor';
  trapped.state.wave = 3; trapped.state.spawnCounts = { archers: 2, boss: 1 };
  const strong = [17, 23, 25, 31];
  for (const index of [...strong, 24, 43, 44]) {
    const cell = structuredClone(prototype); cell.id = 100000 + index;
    cell.hp = cell.maxHp = strong.includes(index) ? 20 : index === 24 ? 4 : 0; cell.color = 0;
    trapped.state.board[index] = cell; trapped.state.terrain[index] = 'floor';
  }
  assert(trapped.preview([44, 43]).valid && trapped.previewAbility('jump', 24).valid, 'player initially has a chain and can choose a bad distant landing');
  const survivors = strong.map(index => trapped.state.board[index]!);
  await trapped.useAbility('jump', 24);
  assert(trapped.state.player.energy === 0 && !hasOrdinaryChain(trapped.state) && trapped.availableMoves().length === 0, 'eight-way enclosed landing remains a tactical risk');
  assert(survivors.every((cell, n) => trapped.state.board[strong[n]] === cell && cell.hp === 20 && cell.color === 0), 'refill cannot recolor, damage or displace published blockers');
  await trapped.waitTurn();
  assert(trapped.state.player.energy === 0.5 && !hasOrdinaryChain(trapped.state) && survivors.every(cell => cell.hp === 20 && cell.color === 0), 'rest earns only half energy without automatic rescue');
  console.log('PASS historical natural trap gains a diagonal escape; constructed eight-way bad jump preserves no-rescue and unchanged living enemies');
}
async function pairGeneration() {
  const g = new ForestEngine(984); g.animationScale = 0; g.startLevel();
  const first = g.state.board[44]!, archer = g.state.board[37]!, last = g.state.board[30]!;
  g.state.board.fill(null); g.state.terrain.fill('wall');
  for (const index of [30, 37, 44, 45]) g.state.terrain[index] = 'floor';
  first.color = archer.color = last.color = 0; archer.kind = 'ranged'; archer.hp = archer.maxHp = 2; archer.behavior.restTurns = 1;
  g.state.board[44] = first; g.state.board[37] = archer; g.state.board[30] = last;
  g.state.wave = 3; g.state.spawnCounts = { archers: 2, boss: 1 };
  g.state.rotations = [{ from: 37, to: 44, sourceId: archer.id, targetId: first.id, geometry: 'cardinal' }];
  g.state.hazard = { cells: [44], turnsUntil: 1, damage: 2 };
  let draw = 0; (g as unknown as { random(): number }).random = () => [0.5, 0, 0.5, 0.5][draw++ % 4];
  const published = new Map<number, number | null>(); const events: string[] = [];
  let volleyVictim = 0, volleyKilled = false;
  g.subscribe((state, event) => {
    events.push(event.type);
    if (event.type === 'spawn' && state.phase === 'ENEMY_RESOLVE') for (const index of event.indices!) {
      const cell = state.board[index]!; published.set(cell.id, cell.color);
    }
    if (event.type === 'arrow-volley') volleyVictim = state.board[44]?.id ?? 0;
    if (event.type === 'kill' && event.index === 44) volleyKilled = true;
  });
  await chain(g, [44, 37, 30]);
  assert(published.size === 2 && events.indexOf('enemy-swap') < events.indexOf('arrow-volley') && hasOrdinaryChain(g.state), 'pair generation validates a post-swap and post-volley ordinary witness before publishing replacements');
  for (const [id, color] of published) {
    const survivor = g.state.board.find(cell => cell?.id === id);
    assert(survivor ? survivor.color === color : id === volleyVictim && volleyKilled,
      'later refill cannot repaint a survivor; arrow removal is the only absent published identity');
  }
  assert(volleyKilled && !events.includes('reshuffle'), 'fixed arrow defeats the zero-HP occupant without any live reshuffle'); dense(g);
  console.log('PASS pre-swap replacement validation uses projected swaps/volley and preserves published replacement colors');
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
  for (const theme of ['forest', 'gate', 'banquet', 'barracks', 'chess', 'library', 'wizard'] as RoomTheme[]) for (const seed of [1, 21, 32, 83, 701, 984]) {
    const g = new ForestEngine(seed); let starts = 0;
    g.subscribe((state, event) => { if (event.type === 'start') { starts++; assert(hasOrdinaryChain(state), 'initial scene validates its ordinary opening before start publication'); dense(g); } });
    g.startScenario(theme, seed); assert(starts === 1 && g.availableMoves().length > 0, 'quick witness agrees with actual move search on each generated room');
  }
  console.log('PASS all scene themes validate new content before start; quick witness agrees with ordinary move search');
}
void naturalArrivals().then(finiteFallbackAndDeferral).then(pairGeneration).then(witnessRules).then(unchangedPlayerTrap).then(initialScenes).catch(error => { console.error(error); throw error; });
