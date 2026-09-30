import { ForestEngine } from './forestEngine';
import { DEMONSTRATION_OPENING } from './forestLevel';
import { adjacent, isWalkable, prepareIntents, simulateChain } from './forestSystems';
import type { CellKind, EnemyColor, ForestCell, RotationGeometry } from './forestTypes';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
let id = 9000;
function cell(kind: CellKind = 'melee', color: EnemyColor | null = 0, hp = kind === 'melee' ? 0 : 4): ForestCell {
  return { id: id++, kind, color, hp, maxHp: hp, armor: 0, countdown: 1,
    status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: 'Test' } };
}
function fixture() {
  const g = new ForestEngine(); g.animationScale = 0; g.startLevel();
  g.state.board.fill(null); g.state.terrain.fill('floor');
  g.state.wave = 3; g.state.spawnCounts = { archers: 2, boss: 1 }; return g;
}
function rotation(g: ForestEngine, from: number, to: number, geometry: RotationGeometry = 'cardinal') {
  const source = g.state.board[from]!, target = g.state.board[to]!;
  source.behavior.restTurns = 1; source.intent.moveTo = to; source.intent.swapWithId = target.id;
  const plan = { from, to, sourceId: source.id, targetId: target.id, geometry }; g.state.rotations.push(plan); return plan;
}
async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), `start ${path[0]}`);
  for (const index of path.slice(1)) assert(g.extendChain(index), `extend ${index}`);
  return g.releaseChain();
}
async function demonstration() {
  const g = new ForestEngine(); g.animationScale = 0; g.startLevel();
  assert(g.state.board.filter(Boolean).length === 39, 'all 39 walkable non-hero cells start occupied');
  assert(g.state.board[10]?.kind === 'melee' && g.state.board[11]?.status.wet && g.state.board[20]?.kind === 'melee', 'former spawn holes start with ordinary goblins');
  const log: string[] = [];
  for (const path of DEMONSTRATION_OPENING) {
    const preview = g.preview(path); assert(preview.valid, `authored route valid: ${preview.reason}`);
    const expectedKills = preview.hits.filter(hit => hit.killed).length;
    assert(await commit(g, path), 'authored route resolves');
    assert(g.state.lastDamage === preview.damage, 'authored preview/commit damage parity');
    assertDense(g);
    log.push(`${g.state.turn}:wave${g.state.wave}/hp${g.state.player.hp}/kills${expectedKills}`);
  }
  assert(g.state.phase === 'PLAYER_INPUT' && g.state.turn === 2 && g.state.wave === 2, 'documented opening reaches random archer wave');
  assert(g.state.inventory.frost === 1, 'wave two grants one optional frost');
  console.log('PASS tutorial opening', log.join(' '));
}
function assertDense(g: ForestEngine) {
  g.state.board.forEach((target, index) => {
    if (isWalkable(g.state, index)) assert(index === g.state.player.index ? target === null : !!target, `dense walkable board at ${index}`);
  });
}
async function regressions() {
  const g = fixture(); g.state.board[44] = cell(); g.state.board[37] = cell('boss', null, 20);
  g.state.board[36] = cell('melee', 1);
  assert(!g.beginChain(0), 'remote enemy start forbidden');
  g.beginChain(44); g.extendChain(37);
  assert(!g.extendChain(36), 'living intermediate boss cannot be crossed');
  assert(g.extendChain(44) && g.state.chain.length === 1, 'backtracking works');
  assert(!await g.releaseChain() && g.state.turn === 0, 'tiny chain is free cancellation');
  const preview = g.preview([44, 37]);
  assert(preview.hits[0].availablePower === 1 && preview.hits[0].powerSpent === 0
    && preview.hits[1].availablePower === 2 && preview.hits[1].powerSpent === 2 && preview.endIndex === 44,
  'weak target builds budget; durable survivor spends it and stops the cat');
  const bossId = g.state.board[37]!.id;
  await commit(g, [44, 37]);
  assert(g.state.board[37]!.id === bossId && g.state.board[37]!.hp === 18, 'wounded boss HP/identity persists through refill');
  assert(g.state.player.index === 44, 'hero stops before surviving terminal');

  const f = fixture(); f.state.inventory.frost = 1; f.state.board[44] = cell(); f.state.board[37] = cell('boss', null, 20);
  f.state.board[37]!.status.wet = true; f.state.board[37]!.intent.cells = [44];
  // Since 30.09.2026 frost works on any enemy: a dry target is accepted and frozen exactly like a wet one.
  const dry = fixture(); dry.state.inventory.frost = 1; dry.state.board[44] = cell(); dry.state.board[44]!.intent.cells = [45];
  const dryPreview = dry.previewFrost(44);
  assert(!dry.state.board[44]!.status.wet && dryPreview.valid && dryPreview.freezes && dryPreview.skippedCells.join() === '45', 'dry target is accepted and its attack is shown as skipped');
  assert(dry.prepareFrost(44) && dry.state.board[44]!.status.frozen > 0 && dry.state.board[44]!.status.brittle && dry.state.inventory.frost === 0, 'dry target freezes and becomes brittle');
  assert(!f.prepareFrost(0) && f.state.inventory.frost === 1, 'empty target never consumes frost');
  const before = JSON.stringify(f.state);
  assert(f.previewFrost(37).valid && JSON.stringify(f.state) === before, 'frost targeting is dry run');
  assert(f.prepareFrost(37) && !f.prepareFrost(37), 'one consumable prep per turn');
  assert(f.preview([44, 37]).hits[1].damage === 4 && f.preview([44, 37]).damage === 0, 'brittle doubles available power, frozen removes intent');
  await commit(f, [44, 37]);
  assert(f.state.player.hp === 5 && f.state.board[37]!.hp === 16, 'frozen hit does not prematurely restore enemy action');
  assert(f.state.board[37]!.status.frozen === 0 && !f.state.board[37]!.status.brittle && f.state.inventory.frost === 0, 'freeze expires after skipped phase, brittle consumed, no refill');

  const w = fixture(); w.state.inventory.frost = 1; w.state.board[44] = cell('ranged', 0, 7); w.state.board[44]!.status.wet = true; w.state.board[44]!.intent.cells = [45];
  w.prepareFrost(44); assert(await w.waitTurn() && w.state.player.hp === 5 && w.state.turn === 1, 'item-only wait resolves exactly one skipped enemy phase');
  assert(w.state.board[44]!.status.brittle && w.state.board[44]!.status.frozen === 0, 'unconsumed brittle survives freeze expiry');

  const v = fixture(); v.state.board[44] = cell(); v.state.board[37] = cell('boss', null, 2);
  v.state.board[36] = cell(); v.state.board[36]!.intent.cells = [37];
  assert(v.preview([44, 37]).damage === 0, 'boss lethal preview omits canceled enemy phase');
  const afterBoss = simulateChain(v.state, [44, 37, 36]);
  assert(afterBoss.preview.hits.length === 2 && afterBoss.preview.endIndex === 37 && afterBoss.board[36]?.hp === 0, 'boss death immediately ends further simulated hits');
  await commit(v, [44, 37]); assert(v.state.phase === 'WIN' && v.state.player.hp === 5, 'boss death stops remaining enemy attacks');

  const c = fixture(); c.state.player.index = 8; c.state.terrain[9] = 'tree'; c.state.terrain[15] = 'pond';
  assert(!adjacent(c.state, 8, 16), 'two blocked corners prohibit diagonal'); c.state.terrain[9] = 'floor'; assert(adjacent(c.state, 8, 16), 'one blocked corner permits diagonal');
  c.state.board[9] = cell('melee', null); c.state.board[10] = cell('melee', 2);
  assert(simulateChain(c.state, [9, 10]).preview.valid, 'killed colorless target allows arbitrary outgoing color');

  const r = new ForestEngine(); r.animationScale = 0.2; r.startLevel();
  const pending = commit(r, DEMONSTRATION_OPENING[0]); r.restartLevel(); await pending;
  assert(r.state.turn === 0 && r.state.objective.kills === 0 && r.state.player.index === 45, 'restart cancels pending resolution');
  r.damagePlayer(5); assert(r.state.phase === 'LOSE', 'damage can lose'); r.restartLevel(); assert(r.state.player.hp === 5, 'retry restores health');

  const repair = fixture(); repair.state.board = Array.from({ length: 49 }, () => cell('ranged', 2, 7)); repair.state.board[45] = null;
  repair.state.board[44] = cell('melee', 0); repair.state.board[37] = cell('melee', 1); repair.state.board[0] = cell('boss', null, 13);
  const preserved = repair.getBoardState(); assert(repair.availableMoves().length === 0, 'fixture has no legal route from hero');
  await repair.waitTurn(); assert(repair.availableMoves().length === 0, 'no generated slots means a trapped position is not automatically rearranged');
  preserved.forEach((old, index) => { if (old) assert(repair.state.board[index]?.id === old.id && repair.state.board[index]?.hp === old.hp && repair.state.board[index]?.color === old.color, 'generation preserves living IDs, HP and colors'); });
  console.log('PASS adjacency, sequential HP, survivor blocking, corners, wildcard, frost dry-run/duration, wait, immediate boss win, async restart');
}
async function alternatePolicies() {
  for (const seed of [701, 29, 83, 705, 719]) {
    const g = new ForestEngine(seed); g.animationScale = 0; g.startLevel();
    const visits = new Map<number, number>();
    for (let step = 0; step < 40 && g.state.phase === 'PLAYER_INPUT'; step++) {
      const paths = g.availableMoves(); assert(paths.length > 0, `reachable move exists seed${seed} turn${step}`);
      assert(paths.some(path => g.preview(path).damage < g.state.player.hp), `nonfatal chain available seed${seed} turn${step}`);
      const targets = g.state.board.flatMap((target, index) => target?.kind === (g.state.wave === 3 ? 'boss' : 'ranged') ? [index] : []);
      const score = (path: number[]) => {
        const p = g.preview(path);
        const distance = targets.length ? Math.min(...targets.map(index => Math.abs(index % 7 - p.endIndex % 7) + Math.abs(Math.floor(index / 7) - Math.floor(p.endIndex / 7)))) : 0;
        return p.hits.reduce((sum, hit) => sum + (g.state.board[hit.index]?.kind === 'boss' ? hit.damage * 12 : g.state.board[hit.index]?.kind === 'ranged' ? hit.damage * 8 : 0), 0)
          + p.kills * 2 - p.damage * 50 - distance * 2 - (p.damage >= g.state.player.hp ? 10000 : 0) - (visits.get(p.endIndex) ?? 0) * 0.5;
      };
      const path = paths.sort((a, b) => score(b) - score(a))[0];
      const p = g.preview(path), oldBoard = g.getBoardState(), oldHp = g.state.player.hp;
      const moved = new Map<number, number>();
      const replaced = new Set<number>();
      const unsubscribe = g.subscribe((state, event) => {
        if (event.type === 'enemy-swap') { moved.set(event.from!, event.to!); moved.set(event.to!, event.from!); }
        if (event.type === 'special-arrival') replaced.add(event.oldId!);
        // A colour-change crystal crushes the enemy on its seeded cell (every mode since 30.09.2026).
        if (event.type === 'crystal' && event.oldId !== undefined) replaced.add(event.oldId);
        // Archer arrows strike every creature on the announced line (positions are unchanged before swaps).
        if (event.type === 'hit' && state.phase === 'ENEMY_RESOLVE' && oldBoard[event.index!]) replaced.add(oldBoard[event.index!]!.id);
      });
      await commit(g, path);
      visits.set(p.endIndex, (visits.get(p.endIndex) ?? 0) + 1);
      unsubscribe();
      assert(g.state.lastDamage === Math.min(p.damage, oldHp), 'alternate incoming preview parity');
      if (g.state.phase === 'PLAYER_INPUT') assertDense(g);
      oldBoard.forEach((old, index) => {
        if (!old || path.includes(index) || replaced.has(old.id)) return;
        const now = g.state.board[moved.get(index) ?? index]; assert(now?.id === old.id && now?.hp === old.hp, 'refill preserves every living entity at its declared position');
      });
    }
    // Only per-turn invariants are asserted; whether this heuristic bot wins is balance, not a rule.
    console.log(`POLICY seed=${seed} ${g.state.phase} turns=${g.state.turn} HP=${g.state.player.hp} wave=${g.state.wave}`);
  }
}
async function arrivalRegressions() {
  const openExit = (g: ForestEngine) => {
    const exit = cell('door', null, 1); exit.door = { branch: 'forward', label: 'Fixture exit', destination: 'banquet', magic: true, breached: true, footprint: [44] };
    g.state.board[44] = exit;
  };
  const firstPositions = new Set<number>();
  for (const seed of [0, 1, 29, 83, 701, 7010, 123456, 987654, 0x12345678, 0x7fffffff, 0xdeadbeef, 0xffffffff]) {
    const g = new ForestEngine(seed); g.animationScale = 0; g.startLevel();
    const pool = g.state.board.flatMap((target, index) => target?.kind === 'melee' ? [index] : []);
    const original = g.getBoardState(), expected: number[] = [], actual: number[] = [];
    let random = seed;
    for (let draw = 0; draw < 2; draw++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      expected.push(pool.splice(Math.floor(random / 4294967296 * pool.length), 1)[0]);
    }
    // Frozen ordinary goblins are still valid victims; the replacement has fresh state.
    g.state.board.forEach(target => { if (target) { target.status.frozen = 2; target.status.brittle = true; target.behavior.aggressive = true; } });
    g.state.objective.kills = 8;
    g.subscribe((state, event) => {
      if (event.type !== 'special-arrival') return;
      const index = event.index!, replacement = state.board[index]!;
      actual.push(index);
      assert(original[index]?.id === event.oldId && replacement.id === event.newId && event.oldId !== event.newId, 'arrival announces exact victim and replacement identity');
      assert(state.phase === 'BOARD_UPDATE' && replacement.kind === 'ranged' && replacement.behavior.restTurns === 0, 'arrival publishes the validated next-turn intent after all enemy actions');
      assert(replacement.color === original[index]!.color && replacement.hp === 7, 'archer keeps the randomly selected victim color with fresh health');
      assert(replacement.status.frozen === 0 && !replacement.status.brittle && !replacement.behavior.aggressive && replacement.behavior.restTurns === 0, 'fresh special does not inherit victim combat status');
      assert(replacement.status.wet === (state.terrain[index] === 'puddle'), 'new special gets wet only from current terrain');
      assert(state.objective.kills === 8 && state.objective.rangedKills === 0 && state.score === 30, 'NPC replacement grants no kill objective or score credit');
      assertDense(g);
    });
    await g.waitTurn();
    assert(JSON.stringify(actual) === JSON.stringify(expected), `uniform full melee pool selection without fixed positions or color filters seed${seed}`);
    assert(g.state.spawnCounts.archers === 2 && new Set(actual).size === 2 && g.state.player.hp === 5, 'exact unique archer quota and no arrival-turn attack');
    firstPositions.add(actual[0]);
  }
  assert(firstPositions.size >= 6, 'different seeds vary arrival locations throughout the board');

  const protectedBoard = intentFixture(); protectedBoard.state.wave = 2; protectedBoard.state.spawnCounts = { archers: 0, boss: 0 };
  openExit(protectedBoard);
  protectedBoard.state.board[0] = cell('boss', null, 20); protectedBoard.state.board[1] = cell('ranged', 1, 7);
  protectedBoard.state.board[0]!.status.frozen = 2; protectedBoard.state.board[1]!.status.frozen = 2;
  protectedBoard.state.board[11] = cell(); protectedBoard.state.board[20] = cell();
  const protectedIds = protectedBoard.getBoardState();
  await protectedBoard.waitTurn();
  assert(protectedBoard.state.board[11]?.kind === 'ranged' && protectedBoard.state.board[20]?.kind === 'ranged', 'only occupied normal goblins qualify when other types fill the board');
  protectedIds.forEach((target, index) => {
    if (target && target.kind !== 'melee') assert(protectedBoard.state.board[index]?.id === target.id, 'boss, existing archer and prisms are never arrival victims');
  });
  assertDense(protectedBoard);

  const pending = intentFixture(); pending.state.wave = 2; pending.state.spawnCounts = { archers: 0, boss: 0 };
  openExit(pending);
  let arrivals = 0; pending.subscribe((_state, event) => { if (event.type === 'special-arrival') arrivals++; });
  await pending.waitTurn(); assert(arrivals === 0 && pending.state.spawnCounts.archers === 0, 'zero eligible victims leaves all arrivals pending');
  pending.state.board[11] = cell(); pending.state.terrain[11] = 'puddle'; pending.state.board[11]!.status.frozen = 2;
  await pending.waitTurn(); assert(arrivals === 1 && pending.state.spawnCounts.archers === 1, 'one available victim fulfills only one archer arrival');
  await pending.waitTurn(); assert(arrivals === 1 && pending.state.spawnCounts.archers === 1, 'pending quota cannot duplicate existing specials');
  pending.state.board[20] = cell(); await pending.waitTurn();
  assert(arrivals === 2 && pending.state.spawnCounts.archers === 2, 'later ordinary goblin fulfills remaining quota');
  pending.state.board[11] = cell('prism', null, 1); await pending.waitTurn();
  assert(arrivals === 2, 'removing an arrived archer does not reopen its quota');
  pending.state.wave = 3; await pending.waitTurn();
  assert(pending.state.spawnCounts.boss === 0, 'boss also waits when no normal victim exists');
  pending.state.board[11] = cell(); await pending.waitTurn();
  assert(pending.state.spawnCounts.boss === 1 && pending.state.board[11]?.kind === 'boss' && pending.state.board[11]?.color === null && arrivals === 3, 'boss arrives once by replacing a later available normal goblin');
  assertDense(pending);

  const refilled = new ForestEngine(); refilled.animationScale = 0; refilled.startLevel();
  refilled.state.board[10] = null; refilled.state.board[11] = null; refilled.state.board[20] = null;
  refilled.state.objective.kills = 8;
  refilled.subscribe((_state, event) => { if (event.type === 'special-arrival') assertDense(refilled); });
  await refilled.waitTurn(); assertDense(refilled);
  assert(refilled.state.board[10] && refilled.state.board[11] && refilled.state.board[20], 'former reserved positions refill normally before special arrivals');

  const replay = new ForestEngine(701); replay.animationScale = 0;
  const records: string[] = [];
  for (let run = 0; run < 2; run++) {
    replay.restartLevel();
    for (const path of DEMONSTRATION_OPENING) await commit(replay, path);
    records.push(JSON.stringify({ board: replay.getBoardState(), player: replay.state.player, counts: replay.state.spawnCounts }));
  }
  assert(records[0] === records[1], 'same seed and player actions reproduce arrivals, IDs and subsequent intents');

  const cancel = new ForestEngine(); cancel.animationScale = 0; cancel.startLevel(); cancel.state.objective.kills = 8;
  cancel.subscribe((_state, event) => { if (event.type === 'special-arrival') cancel.restartLevel(); });
  assert(!await cancel.waitTurn() && cancel.state.turn === 0 && cancel.state.spawnCounts.archers === 0 && cancel.state.board.every(target => !target || target.kind === 'melee'), 'restart on arrival cancels the old quota loop and leaves fresh board intact');
  assertDense(cancel);
  console.log('PASS dense start/refill, uniform seeded occupied replacements, protected victim pool, no NPC kill credit, fresh status, deferred quotas, replay, arrival restart');
}
function intentFixture() {
  const g = fixture();
  // Inert occupied cells isolate phase tests without introducing runtime refill exceptions.
  g.state.board = Array.from({ length: 49 }, (_, index) => index === g.state.player.index ? null : cell('prism', null, 1));
  return g;
}
async function intentRegressions() {
  const a = intentFixture(); a.state.turn = 1;
  for (const index of [0, 1, 2]) a.state.board[index] = cell();
  prepareIntents(a.state);
  const first = a.state.board.find(target => target?.behavior.aggressive)!;
  assert(a.state.board.filter(target => target?.behavior.aggressive).length === 1, 'one newly angry melee per preparation');
  await a.waitTurn();
  assert(first.behavior.aggressive && a.state.board.filter(target => target?.behavior.aggressive).length === 2, 'missed melee stays angry while another joins');
  await a.waitTurn();
  assert(a.state.board.filter(target => target?.behavior.aggressive).length === 3 && a.state.player.hp === 5, 'anger accumulates beyond per-turn recruitment without fake hits');
  const copy = a.getBoardState().find(target => target?.id === first.id)!;
  copy.behavior.aggressive = false; copy.behavior.restTurns = 99;
  assert(first.behavior.aggressive && first.behavior.restTurns === 0, 'snapshot deeply clones behavior');

  const hit = intentFixture(); hit.state.board[44] = cell();
  const melee = hit.state.board[44]!; melee.behavior.aggressive = true; prepareIntents(hit.state);
  melee.status.frozen = 1;
  await hit.waitTurn();
  assert(melee.behavior.aggressive && hit.state.player.hp === 5, 'frozen melee preserves aggression and skips hit');
  await hit.waitTurn();
  assert(hit.state.player.hp === 4 && !melee.behavior.aggressive && melee.behavior.restTurns === 1 && !melee.intent.cells.length, 'actual melee hit clears anger for a visible calm input');
  await hit.waitTurn();
  assert(hit.state.player.hp === 4 && melee.behavior.aggressive, 'calm grace lasts a complete enemy phase before reacquisition');

  const archer = intentFixture(); archer.state.board[20] = cell('ranged', 0, 7);
  archer.state.board[13] = cell('melee', 2, 3);
  const partner = archer.state.board[13]!; partner.status.brittle = true; partner.behavior.aggressive = true;
  archer.state.terrain[13] = 'puddle'; partner.status.wet = true;
  const ranged = archer.state.board[20]!; prepareIntents(archer.state);
  const shots: number[] = [], swaps: number[] = [];
  archer.subscribe((_state, event) => {
    if (event.type === 'attack') shots.push(event.to!);
    if (event.type === 'enemy-swap') {
      assert(event.from === 20 && event.index === event.to, 'rotation event identifies both cells'); swaps.push(event.to!);
      assert(archer.state.board[13] === ranged && archer.state.board[20] === partner, 'swap is atomic before its event');
      assert(ranged.behavior.restTurns === 1 && partner.behavior.aggressive && partner.status.brittle, 'rotation preserves current behavior and brittle');
    }
  });
  ranged.status.frozen = 1;
  await archer.waitTurn();
  assert(shots.length === 0 && ranged.behavior.restTurns === 0, 'frozen archer does not consume its ready shot');
  const rayEnd = ranged.intent.cells.at(-1);
  await archer.waitTurn();
  assert(shots.length === 1 && shots[0] === rayEnd && shots[0] !== archer.state.player.index && archer.state.player.hp === 5, 'missed shot executes toward fixed ray endpoint');
  assert(ranged.behavior.restTurns === 1 && !ranged.intent.cells.length && ranged.intent.moveTo === 13 && ranged.intent.swapWithId === partner.id, 'shot schedules full rest and explicit occupied-cell partner');
  ranged.status.frozen = 1;
  await archer.waitTurn();
  assert(ranged.behavior.restTurns === 1 && archer.state.board[20] === ranged && !swaps.length, 'freeze pauses rest and rotation');
  await archer.waitTurn();
  assert(shots.length === 1 && swaps[0] === 13 && archer.state.board[13] === ranged && archer.state.board[20] === partner, 'resting archer exchanges places without firing or deleting partner');
  assert(archer.state.board.filter(Boolean).length === 48 && ranged.hp === 7 && ranged.color === 0 && partner.hp === 3 && partner.color === 2, 'swap preserves occupied count, health and colors');
  assert(ranged.status.wet && !partner.status.wet, 'wet status follows terrain for both participants');
  assert(ranged.behavior.restTurns === 0 && ranged.intent.cells.length > 0, 'archer becomes ready only after its rest phase');

  for (const obstruction of ['hero', 'boss', 'prism', 'frozen-source', 'frozen-target', 'terrain', 'diagonal'] as const) {
    const blocked = intentFixture(); blocked.state.board[20] = cell('ranged', 0, 7);
    blocked.state.board[13] = cell(); blocked.state.board[19] = cell();
    const mover = blocked.state.board[20]!;
    const plan = rotation(blocked, 20, 13);
    if (obstruction === 'hero') { blocked.state.player.index = 13; blocked.state.board[13] = null; }
    if (obstruction === 'boss' || obstruction === 'prism') blocked.state.board[13]!.kind = obstruction;
    if (obstruction === 'frozen-source') mover.status.frozen = 1;
    if (obstruction === 'frozen-target') blocked.state.board[13]!.status.frozen = 1;
    if (obstruction === 'terrain') blocked.state.terrain[13] = 'tree';
    if (obstruction === 'diagonal') { blocked.state.board[12] = blocked.state.board[13]; blocked.state.board[13] = null; mover.intent.moveTo = 12; plan.to = 12; }
    const occupantId = blocked.state.board[13]?.id;
    let moved = false; blocked.subscribe((_state, event) => { if (event.type === 'enemy-swap') moved = true; });
    await blocked.waitTurn();
    assert(!moved && blocked.state.board[20]?.id === mover.id, `${obstruction} cancels whole rotation without selecting another partner`);
    if (occupantId) assert(blocked.state.board[13]?.id === occupantId, 'canceled swap cannot overwrite living occupant');
    assert(blocked.state.board[blocked.state.player.index] === null, 'rotation never overwrites hero');
  }

  const collision = intentFixture();
  for (const index of [12, 13, 20]) {
    collision.state.board[index] = cell('ranged', 0, 7);
    collision.state.board[index]!.behavior.restTurns = 1;
  }
  prepareIntents(collision.state);
  assert(collision.state.board[12]!.intent.moveTo === 13 && collision.state.board[13]!.intent.moveTo === undefined && collision.state.board[20]!.intent.moveTo === undefined, 'planner reserves disjoint pairs deterministically');
  // Defensive execution rejects reciprocal and overlapping requests even in malformed external state.
  collision.state.rotations = [];
  for (const [from, to] of [[12, 13], [13, 12], [20, 13]]) {
    rotation(collision, from, to);
  }
  const lowerId = collision.state.board[12]!.id, middleId = collision.state.board[13]!.id, otherId = collision.state.board[20]!.id;
  let pairEvents = 0; collision.subscribe((_state, event) => { if (event.type === 'enemy-swap') pairEvents++; });
  await collision.waitTurn();
  assert(pairEvents === 1 && collision.state.board[13]?.id === lowerId && collision.state.board[12]?.id === middleId && collision.state.board[20]?.id === otherId, 'conflicts and reciprocal plans cannot move an entity twice');
  assert(new Set(collision.state.board.filter(Boolean).map(target => target!.id)).size === 48, 'rotation never duplicates IDs');

  for (const victim of ['source', 'partner'] as const) {
    const killed = intentFixture(); killed.state.player.index = 18;
    killed.state.board[20] = cell('ranged', 0, victim === 'source' ? 2 : 7); killed.state.board[13] = cell(); killed.state.board[19] = cell();
    const source = killed.state.board[20]!, target = killed.state.board[13]!;
    rotation(killed, 20, 13);
    let rotated = false; killed.subscribe((_state, event) => { if (event.type === 'enemy-swap') rotated = true; });
    killed.state.board[12] = cell();
    await commit(killed, victim === 'source' ? [19, 20] : [19, 12, 13]);
    assert(!rotated && (victim === 'source' ? killed.state.board[13]?.id === target.id : killed.state.board[20]?.id === source.id), 'hero finishing on either endpoint cancels the complete pair');
  }

  const fixed = intentFixture(); fixed.state.player.index = 33;
  fixed.state.board[20] = cell('ranged', 0, 7); fixed.state.board[20]!.behavior.restTurns = 1;
  fixed.state.board[13] = cell(); fixed.state.board[13]!.behavior.aggressive = true;
  fixed.state.board[26] = cell(); fixed.state.board[27] = cell(); prepareIntents(fixed.state);
  // This regression tests attack-before-swap ordering, independently of movement target selection.
  fixed.state.rotations = []; rotation(fixed, 20, 13);
  const incoming = fixed.preview([26, 27]); assert(incoming.valid && incoming.damage === 0, 'before-swap attack footprint excludes future neighbor');
  await commit(fixed, [26, 27]);
  assert(fixed.state.lastDamage === incoming.damage && fixed.state.board[20]?.kind === 'melee', 'partner attacks only before swap; new adjacency adds no hidden damage');

  const cancel = intentFixture();
  cancel.state.board[20] = cell('ranged'); cancel.state.board[20]!.behavior.restTurns = 1; cancel.state.board[20]!.intent.moveTo = 13;
  cancel.state.board[13] = cell(); cancel.state.board[20]!.intent.swapWithId = cancel.state.board[13]!.id;
  rotation(cancel, 20, 13);
  cancel.subscribe((_state, event) => { if (event.type === 'enemy-swap') cancel.restartLevel(); });
  assert(!await cancel.waitTurn() && cancel.state.turn === 0 && cancel.state.player.index === 45, 'restart during rotation cancels remaining phase');

  const idle = new ForestEngine(); idle.animationScale = 0; idle.startLevel();
  for (let turn = 0; turn < 12 && idle.state.phase === 'PLAYER_INPUT'; turn++) await idle.waitTurn();
  assert(idle.state.phase === 'LOSE', 'repeated waiting lets persistent aggression become lethal');
  console.log('PASS persistent anger, calm grace, fixed missed shots, archer rest, frozen phases, atomic occupied rotation, cancellation, conflicts, preserved entities, fixed attack preview, restored map, restart, idle pressure');
}
function pairFixture() {
  const g = intentFixture(); g.state.player.index = 18; g.state.board[18] = null; g.state.board[45] = cell('prism', null, 1);
  for (const index of [6, 12, 13, 19, 27]) g.state.board[index] = cell();
  g.state.board[20] = cell('ranged', 0, 2); rotation(g, 20, 13); return g;
}
async function refillAndPairRegressions() {
  const distributions = new Set<string>();
  for (const seed of [701, 29, 83, 705, 719, 101]) {
    const g = new ForestEngine(seed); g.animationScale = 0; g.startLevel();
    const initial = JSON.stringify(g.getBoardState()), replay: string[] = [];
    for (let run = 0; run < 2; run++) {
      if (run) { g.restartLevel(); assert(JSON.stringify(g.getBoardState()) === initial, 'restart preserves authored start'); }
      await commit(g, [38, 39, 40, 33]); assertDense(g);
      const pattern = [38, 39, 40].map(index => g.state.board[index]!.color).join('');
      distributions.add(pattern);
      replay.push(JSON.stringify({ board: g.getBoardState(), rotations: g.state.rotations, player: g.state.player }));
      assert(g.availableMoves(7).length > 0, 'random refill retains playable chains');
    }
    assert(replay[0] === replay[1], 'same seed and actions reproduce new colors, IDs and intent pairs');
  }
  assert(distributions.size >= 4 && [...distributions].some(pattern => pattern !== '222'), 'seeded refill varies instead of restoring authored blue map');

  for (const [label, path] of [['source', [19, 20, 27]], ['partner', [19, 12, 13, 6]], ['both', [19, 20, 13, 12]]] as const) {
    const g = pairFixture(), oldIds = [g.state.board[20]!.id, g.state.board[13]!.id];
    const before = JSON.stringify(g.state), preview = g.preview([...path]);
    assert(preview.valid && preview.rotations[0].active && JSON.stringify(g.state) === before, `${label} death preserves pure cell-pair forecast`);
    let swaps = 0, attacks = 0, pairIds: number[] = [];
    g.subscribe((state, event) => {
      if (event.type === 'attack') attacks++;
      if (event.type === 'spawn' && state.phase === 'ENEMY_RESOLVE') pairIds = [state.board[20]!.id, state.board[13]!.id];
      if (event.type === 'enemy-swap') {
        swaps++; assert(state.board[20]!.id === pairIds[1] && state.board[13]!.id === pairIds[0], 'swap exchanges actual replacement IDs atomically');
        assert(event.geometry === 'cardinal' && !state.rotations.some(plan => plan.from === 20 && plan.to === 13), 'completed plan disappears before its geometry-bearing event');
      }
    });
    await commit(g, [...path]); assertDense(g);
    assert(swaps === 1 && attacks === 0 && g.state.lastDamage === preview.damage, 'replacements rotate once and do not attack on arrival');
    if (label !== 'partner') assert(!pairIds.includes(oldIds[0]), 'dead initiator gets a fresh ordinary occupant');
    if (label !== 'source') assert(!pairIds.includes(oldIds[1]), 'dead partner gets a fresh ordinary occupant');
    assert(pairIds[0] !== pairIds[1], 'two replacement occupants have distinct IDs');
  }

  for (const frozenIndex of [20, 13]) {
    const g = pairFixture(); g.state.board[frozenIndex]!.status.frozen = 1;
    const path = frozenIndex === 20 ? [19, 12, 13, 6] : [19, 20, 27];
    assert(!g.preview(path).rotations[0].active, 'living frozen endpoint blocks pair even when other endpoint dies');
    let swaps = 0; g.subscribe((_state, event) => { if (event.type === 'enemy-swap') swaps++; });
    await commit(g, path); assert(swaps === 0, 'frozen cancellation agrees with forecast');
  }
  const frozenDead = pairFixture(); frozenDead.state.board[20]!.status.frozen = 1; frozenDead.state.board[20]!.status.brittle = true;
  assert(frozenDead.preview([19, 20, 27]).rotations[0].active, 'dead frozen participant no longer blocks its fresh replacement');
  let thawed = false; frozenDead.subscribe((state, event) => { if (event.type === 'enemy-swap') thawed = state.board[13]!.status.frozen === 0 && !state.board[13]!.status.brittle; });
  await commit(frozenDead, [19, 20, 27]); assert(thawed, 'replacement does not inherit frozen or brittle status');

  const item = pairFixture(); item.state.inventory.bomb = 1; item.state.board[20]!.hp = 4;
  const itemPair = JSON.stringify(item.state.rotations), victims = [item.state.board[20]!.id, item.state.board[13]!.id];
  assert(await item.useItem('bomb', 20), 'bomb kills a declared participant before chain');
  assert(JSON.stringify(item.state.rotations) === itemPair && item.previewRotations()[0].active, 'item refill preserves announced geometry and pair');
  const replacements = [item.state.board[20]!.id, item.state.board[13]!.id];
  assert(!victims.includes(replacements[0]) && replacements[1] === victims[1], 'item replaces killed endpoint and preserves surviving partner');
  await item.waitTurn(); assert(item.state.board[20]!.id === replacements[1] && item.state.board[13]!.id === replacements[0], 'item replacements execute existing exchange');

  const arrows = pairFixture(); arrows.state.hazard = { cells: [20], turnsUntil: 1, damage: 2 };
  const events: string[] = []; let replacementAtTarget = 0, volleyOccupant = 0, volleyKilled = false;
  arrows.subscribe((state, event) => {
    events.push(event.type);
    if (event.type === 'spawn' && state.phase === 'ENEMY_RESOLVE') replacementAtTarget = state.board[13]!.id;
    if (event.type === 'arrow-volley') volleyOccupant = state.board[20]?.id ?? 0;
    if (event.type === 'kill' && event.index === 20) volleyKilled = true;
  });
  await commit(arrows, [19, 20, 13, 12]);
  assert(events.indexOf('enemy-swap') < events.indexOf('arrow-volley') && volleyOccupant === replacementAtTarget && volleyKilled,
    'arrows hit and defeat swapped zero-HP replacement after atomic exchange');

  const knight = intentFixture(); knight.state.player.index = 16; knight.state.board[16] = null; knight.state.board[45] = cell('prism', null, 1);
  for (const index of [9, 23, 25]) knight.state.board[index] = cell();
  knight.state.board[24] = cell('ranged', 0, 2); knight.state.board[24]!.variant = 'knight'; rotation(knight, 24, 9, 'knight');
  const knightPartner = knight.state.board[9]!.id;
  assert(knight.preview([23, 24, 25]).rotations[0].active, 'dead knight preserves original jump over occupied blockers');
  await commit(knight, [23, 24, 25]);
  assert(knight.state.board[24]!.id === knightPartner && knight.state.board[9]!.kind === 'melee', 'ordinary replacement follows stored knight geometry');

  const cancel = pairFixture(); let oldSwap = false;
  cancel.subscribe((state, event) => {
    if (event.type === 'spawn' && state.phase === 'ENEMY_RESOLVE') cancel.restartLevel();
    if (event.type === 'enemy-swap') oldSwap = true;
  });
  assert(!await commit(cancel, [19, 20, 13, 12]) && !oldSwap && cancel.state.turn === 0 && cancel.state.player.index === 45, 'restart on pair reinforcement cancels stale swap and remaining phase'); assertDense(cancel);

  for (const lethal of ['attack', 'volley'] as const) {
    const g = pairFixture();
    if (lethal === 'attack') { g.state.board[0] = cell(); g.state.board[0]!.behavior.aggressive = true; g.state.board[0]!.intent = { cells: [12], damage: 5, label: 'Lethal' }; }
    else g.state.hazard = { cells: [12], turnsUntil: 1, damage: 5 };
    const preview = g.preview([19, 20, 13, 12]);
    assert(preview.damage === 5 && preview.rotations[0].active === (lethal === 'volley'), 'forecast distinguishes death before rotation from later volley death');
    let swaps = 0; g.subscribe((_state, event) => { if (event.type === 'enemy-swap') swaps++; });
    await commit(g, [19, 20, 13, 12]);
    assert(g.state.phase === 'LOSE' && swaps === (lethal === 'volley' ? 1 : 0), 'lethal phase order agrees with common preview');
  }
  console.log('PASS seeded varied refill/replay, dead source/partner/both rotations, fresh nonattacking replacements, freeze, items, original chess geometry, arrow order, death phase and restart');
}
void demonstration().then(regressions).then(intentRegressions).then(refillAndPairRegressions).then(arrivalRegressions).then(alternatePolicies).catch(error => { console.error(error); throw error; });
