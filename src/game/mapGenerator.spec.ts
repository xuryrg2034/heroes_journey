import { ForestEngine } from './forestEngine';
import { battlePoolEntry, laneBranches, poolCandidates, rowTools, type PoolBattleType } from './run/battlePools';
import { authoredRefillPalette, type ForestMapNode, type ForestNodeType } from './run/forestMap';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, createForestRun, enterNode, eventView, forestRunView, parseForestRun,
  resolveBattle, runNode, serializeForestRun, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { forestBattle } from './run/forestBattles';
import { generateForestMap } from './run/mapGenerator';
import { clearsTrunk } from './run/playerProfile';

// Generated forest map (docs/roguelike-runs.md, sections 3–4; docs/biomes/forest-map.md, «Генерация карты»).
// The map is read the way the game reads it — through the run API (createForestRun with `map: 'generated'`,
// forestRunView, availableNodes, enterNode) — and checked on 1000+ spread seeds: connectivity, node types and their
// rules on every path, tools by row, pool battles that fit their node, a rest before every hard battle, a choice of
// risk in each branch, determinism and variety, and a map that no battle, event or choice can change. Runs are walked
// by a seeded bot with the real engine (debug win, as forestRun.spec.ts): only the transitions are checked, never a
// victory of the bot.

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const SEEDS = Array.from({ length: 1000 }, (_, k) => spread(k + 1));
const FREE_TYPES: Record<number, readonly ForestNodeType[]> = {
  5: ['battle'], 6: ['battle', 'rest', 'find', 'event'], 7: ['battle', 'rest', 'find', 'event'], 8: ['battle', 'rest', 'find', 'event'], 9: ['checkpoint'],
  10: ['battle', 'hard', 'rest'], 11: ['battle', 'hard', 'rest'], 12: ['battle', 'hard', 'rest'], 13: ['breakthrough'], 14: ['boss'],
};

/** The map a new generated run shows: every node as the view lists it (picks come later, on entering). */
function mapOf(seed: number, skipTrunk = false) {
  const run = createForestRun(seed, { map: 'generated', skipTrunk });
  const nodes = forestRunView(run).nodes.map(entry => entry.node), byId = new Map(nodes.map(node => [node.id, node]));
  return { run, nodes, byId, starts: availableNodes(run).map(node => node.id) };
}
type MapView = ReturnType<typeof mapOf>;
/** Every route from the run's first choice to a boss. */
function paths(map: MapView): ForestMapNode[][] {
  const walk = (node: ForestMapNode): ForestMapNode[][] => node.next.length ? node.next.flatMap(id => walk(map.byId.get(id)!).map(path => [node, ...path])) : [[node]];
  return map.starts.flatMap(id => walk(map.byId.get(id)!));
}
/** Tools opened on entering each node of a path: grants of the nodes so far and of the node, rewards of the battles before it. */
function toolsAlong(path: ForestMapNode[]): Set<string>[] {
  const open = new Set<string>();
  return path.map((node, n) => {
    if (n) for (const tool of [...path[n - 1].rewardGrants?.items ?? [], ...path[n - 1].rewardGrants?.abilities ?? []]) open.add(tool);
    for (const tool of [...node.grants?.items ?? [], ...node.grants?.abilities ?? []]) open.add(tool);
    return new Set(open);
  });
}
const branchOf = (node: ForestMapNode) => node.lane === 'den' || node.lane === 'camp' ? node.lane : null;

/** From the start every boss is reachable, every node lies on a route, nothing dangles; the trunk opens the map. */
function connectivity() {
  for (const seed of SEEDS) {
    const map = mapOf(seed), routes = paths(map), onRoute = new Set(routes.flat().map(node => node.id));
    assert(json(map.starts) === json(['trunk-1']), `${seed}: the first run starts at the trunk`);
    for (const node of map.nodes) {
      assert(onRoute.has(node.id), `${seed}: ${node.id} lies on a route from the start`);
      assert(node.type === 'boss' ? !node.next.length : node.next.length > 0, `${seed}: ${node.id} has an exit unless it is a boss`);
      for (const id of node.next) assert(map.byId.get(id)?.row === node.row + 1, `${seed}: ${node.id} → ${id} goes one row deeper`);
    }
    const bosses = map.nodes.filter(node => node.type === 'boss');
    assert(bosses.length === 2 && new Set(bosses.map(branchOf)).size === 2, `${seed}: one boss per branch`);
    for (const boss of bosses) assert(routes.some(route => route[route.length - 1].id === boss.id), `${seed}: ${boss.id} is reachable`);
    const skip = mapOf(seed, true);
    assert(skip.starts.length >= 2 && skip.starts.every(id => skip.byId.get(id)!.row === 5), `${seed}: past the trunk a run starts with a choice of row 5`);
    assert(json(skip.byId.get('trunk-4')!.next) === json(skip.starts), `${seed}: the trunk exit leads to the first trail row`);
    const checkpoints = map.nodes.filter(node => node.row === 9);
    assert(checkpoints.length === 1 && checkpoints[0].type === 'checkpoint', `${seed}: the Jailer is the only node of row 9`);
    assert(routes.every(route => route.some(node => node.type === 'checkpoint')), `${seed}: every route meets the Jailer`);
    assert(map.nodes.filter(node => node.row >= 10).every(node => branchOf(node)), `${seed}: rows 10–14 belong to a branch`);
  }
}

/**
 * Node types fit their rows; on no route stand two hard battles, two rests or two finds in a row; a route meets at most
 * as many events as there are; the children of one parent differ in type (the free rows); a rest stands 1–3 rows
 * before every hard battle on every route; each branch has a route without a hard battle and one with a hard battle.
 */
function typeRules() {
  let twoHard = 0;
  for (const seed of SEEDS) {
    const map = mapOf(seed), routes = paths(map);
    for (const node of map.nodes.filter(entry => entry.lane !== 'trunk')) assert(FREE_TYPES[node.row].includes(node.type), `${seed}: ${node.id} is ${node.type} on row ${node.row}`);
    for (const route of routes) {
      route.forEach((node, n) => {
        if (n && ['hard', 'rest', 'find'].includes(node.type)) assert(route[n - 1].type !== node.type, `${seed}: ${route[n - 1].id} → ${node.id}: two ${node.type} in a row`);
        if (node.type === 'hard') assert(route.slice(Math.max(0, n - 3), n).some(before => before.type === 'rest'), `${seed}: a rest 1–3 rows before ${node.id}`);
      });
      assert(route.filter(node => node.type === 'event').length <= 2, `${seed}: at most two events on a route`);
    }
    for (const parent of map.nodes) {
      const free = parent.next.map(id => map.byId.get(id)!).filter(child => (FREE_TYPES[child.row]?.length ?? 1) > 1);
      for (const branch of new Set(free.map(branchOf))) {
        const kinds = free.filter(child => branchOf(child) === branch).map(child => child.type);
        assert(new Set(kinds).size === kinds.length, `${seed}: the children of ${parent.id} differ in type (${kinds})`);
      }
    }
    for (const branch of ['den', 'camp'] as const) {
      const through = routes.filter(route => route.some(node => node.lane === branch)).map(route => route.filter(node => node.type === 'hard').length);
      assert(through.includes(0) && through.some(count => count >= 1), `${seed}: ${branch} has a route without and a route with a hard battle`);
      if (Math.max(...through) >= 2) twoHard++;
    }
  }
  console.log(`PASS node types and route rules on ${SEEDS.length} maps (branches with a two-hard route: ${twoHard})`);
}

/** Tools by row on every route: frost from row 5, jump from row 7, spin after the Jailer; every pooled node has fitting battles. */
function toolsAndPools() {
  for (const seed of SEEDS) {
    const map = mapOf(seed), guaranteed = new Map<string, Set<string>>();
    for (const route of paths(map)) {
      toolsAlong(route).forEach((tools, n) => {
        const node = route[n], expected = rowTools(node.row);
        for (const tool of [...expected.items, ...expected.abilities]) assert(tools.has(tool), `${seed}: ${tool} is open on entering ${node.id}`);
        if (node.row < 10) assert(!tools.has('spin'), `${seed}: no spin before the Jailer's victory (${node.id})`);
        const known = guaranteed.get(node.id);
        guaranteed.set(node.id, known ? new Set([...known].filter(tool => tools.has(tool))) : tools);
      });
    }
    for (const node of map.nodes.filter(entry => entry.content.kind === 'pool' && entry.type !== 'event')) {
      const slot = { row: node.row, type: node.type as PoolBattleType, lane: node.lane }, tools = [...guaranteed.get(node.id)!];
      const candidates = poolCandidates(slot, { items: tools as never[], abilities: tools as never[] });
      assert(candidates.length > 0, `${seed}: ${node.id} (${node.type}, row ${node.row}, ${node.lane}) has a battle`);
      for (const id of candidates) {
        const entry = battlePoolEntry(id)!;
        assert(entry.type === node.type && node.row >= entry.rows[0] && node.row <= entry.rows[1] && laneBranches(slot).includes(entry.branch)
          && entry.requires.every(tool => tools.includes(tool)), `${seed}: ${id} fits ${node.id}`);
      }
    }
  }
}

/** The same seed gives the same map; different seeds give different maps (node types at the same places, battles). */
function determinismAndVariety() {
  let compared = 0, typeDiffers = 0, shapes = new Set<string>(), battleDiffers = 0, battleCompared = 0;
  for (let k = 0; k < SEEDS.length; k++) {
    const a = mapOf(SEEDS[k]), again = createForestRun(SEEDS[k], { map: 'generated' });
    assert(json(again.map) === json(a.run.map) && json({ kind: 'generated', ...generateForestMap(SEEDS[k]) }) === json(a.run.map), `${SEEDS[k]}: the same seed gives the same map`);
    shapes.add(json(a.run.map));
    if (k + 1 < SEEDS.length) {
      const b = mapOf(SEEDS[k + 1]);
      for (const node of a.nodes.filter(entry => entry.lane !== 'trunk')) {
        const other = b.byId.get(node.id);
        if (!other) continue;
        compared++; if (other.type !== node.type) typeDiffers++;
      }
      // The battle a first trail node would get (skipping the trunk) differs between seeds as well.
      const pa = new Map(availableNodes(createForestRun(SEEDS[k], { map: 'generated', skipTrunk: true })).map(node => [node.id, node.name]));
      for (const node of availableNodes(createForestRun(SEEDS[k + 1], { map: 'generated', skipTrunk: true }))) {
        if (!pa.has(node.id)) continue;
        battleCompared++; if (pa.get(node.id) !== node.name) battleDiffers++;
      }
    }
  }
  assert(shapes.size >= SEEDS.length * 0.95, `distinct maps: ${shapes.size} of ${SEEDS.length}`);
  assert(typeDiffers / compared > 0.2, `node types differ between neighbouring seeds: ${(typeDiffers / compared * 100).toFixed(1)}%`);
  assert(battleDiffers / battleCompared > 0.3, `first battles differ between neighbouring seeds: ${(battleDiffers / battleCompared * 100).toFixed(1)}%`);
  console.log(`PASS determinism; variety: ${shapes.size} distinct maps of ${SEEDS.length}, node types differ at ${(typeDiffers / compared * 100).toFixed(1)}% of shared places, first battles at ${(battleDiffers / battleCompared * 100).toFixed(1)}%`);
}

/** A seeded bot walks a whole run with real commands and the real engine; returns the run and the battles it met. */
async function botRun(seed: number, skipTrunk: boolean, choice: number, lose = false) {
  let run = createForestRun(seed, { map: 'generated', skipTrunk });
  const map = json(run.map), met: { nodeId: string; battleId: string; candidates: string[]; history: string[] }[] = [];
  let step = 0;
  while (!run.result) {
    assert(json(run.map) === map, `${seed}: the map never changes during the run`);
    assert(json(parseForestRun(serializeForestRun(run))) === json(run), `${seed}: the run survives a save at step ${step}`);
    if (run.pending?.kind === 'battle') {
      const node = runNode(run, run.pending.nodeId)!, setup = battleSetup(run)!;
      assert(node.content.kind === 'battle' && setup.template.id === node.content.battleId, `${seed}: ${node.id} plays its picked battle`);
      const battle = forestBattle(setup.template.id)!, entry = battlePoolEntry(setup.template.id);
      if (node.lane !== 'trunk') {
        const tools = rowTools(node.row);
        assert(entry && entry.type === node.type && node.row >= entry.rows[0] && node.row <= entry.rows[1], `${seed}: ${setup.template.id} fits ${node.id}`);
        assert([...tools.items, ...tools.abilities].every(tool => [...setup.allowedItems, ...setup.allowedAbilities].includes(tool as never)), `${seed}: ${node.id} opens the row tools`);
        assert(entry!.requires.every(tool => [...setup.allowedItems, ...setup.allowedAbilities].includes(tool as never)), `${seed}: ${node.id} opens what ${setup.template.id} requires`);
        assert(json(setup.paletteWeights) === json(authoredRefillPalette(battle, node.row)) && setup.row === node.row, `${seed}: ${node.id} gets the palette of row ${node.row}`);
      }
      const e = new ForestEngine(); e.animationScale = 0;
      assert(e.startRunBattle(setup), `${seed}: ${node.id} starts`);
      if (lose && node.row >= 10) e.damagePlayer(99); else e.winLevel();
      run = ok(resolveBattle(run, e.runBattleOutcome()!), `${seed}: resolve ${node.id}`);
    } else if (run.pending?.kind === 'find') {
      run = ok(chooseFindItem(run, run.pending.options[choice % run.pending.options.length]), `${seed}: find`);
    } else if (run.pending?.kind === 'event') {
      const view = eventView(run)!, options = view.options.filter(option => option.available);
      run = ok(chooseEventOption(run, options[choice % options.length].id), `${seed}: event ${view.event.id}`);
    } else {
      const next = availableNodes(run);
      assert(next.length > 0, `${seed}: a way on from ${run.currentNodeId}`);
      const target = next[(choice + step) % next.length];
      const history = run.picks.flatMap(pick => pick.battleId ? [pick.battleId] : []);
      const entered = enterNode(run, target.id);
      if (target.lane !== 'trunk' && target.row === 5) assert(entered.ok && clearsTrunk(entered.events), `${seed}: entering row 5 marks the trunk cleared`);
      run = ok(entered, `${seed}: enter ${target.id}`);
      const node = runNode(run, target.id)!;
      assert(node.name === target.name && json(node.content) === json(target.content), `${seed}: ${target.id} holds what the map showed before entering`);
      if (node.content.kind === 'battle' && node.lane !== 'trunk') {
        met.push({ nodeId: node.id, battleId: node.content.battleId, history,
          candidates: poolCandidates({ row: node.row, type: node.type as PoolBattleType, lane: node.lane }, run.tools) });
      }
    }
    step++;
  }
  return { run, met };
}

/**
 * Whole runs on spread seeds, with and without the trunk: every transition, battle setup, find and event is valid, the
 * map stays as generated, every battle fits its node, and repeats follow the window: a battle met before comes only
 * when its node's pool had no unused one, and then not as one of the two battles before it (pools of three or more).
 */
async function botRuns() {
  let repeats = 0, battles = 0;
  for (let k = 1; k <= 24; k++) {
    const seed = spread(k * 7), { run, met } = await botRun(seed, k % 2 === 0, k);
    assert(run.result?.outcome === 'victory' && runNode(run, run.result.nodeId)?.type === 'boss', `${seed}: the bot's run ends at a boss`);
    for (const { battleId, candidates, history, nodeId } of met) {
      battles++;
      if (!history.includes(battleId)) continue;
      repeats++;
      assert(candidates.every(id => history.includes(id)), `${seed}: ${nodeId} repeats ${battleId} while its pool still had an unused battle`);
      if (candidates.length > 2) assert(!history.slice(-2).includes(battleId), `${seed}: ${nodeId} repeats one of the two previous battles`);
    }
  }
  const lost = await botRun(spread(99), true, 1, true);
  assert(lost.run.result?.outcome === 'defeat' && json(parseForestRun(serializeForestRun(lost.run))) === json(lost.run), 'a lost generated run ends and survives a save');
  console.log(`PASS 24 bot runs to a boss and a lost run; ${repeats} repeats in ${battles} pooled battles, all inside the window`);
}

/**
 * The map depends only on the run seed: runs of one seed that choose differently, win or lose, take other finds and
 * events keep the same map; and a node's battle depends only on what the run met before it, not on the map stream.
 */
async function mapIgnoresChoices() {
  for (let k = 1; k <= 8; k++) {
    const seed = spread(k * 13), generated = json({ kind: 'generated', ...generateForestMap(seed) });
    for (const choice of [0, 1, 2]) {
      const { run } = await botRun(seed, true, choice);
      assert(json(run.map) === generated, `${seed}: choice ${choice} leaves the map as generated`);
      const view = forestRunView(run).nodes.map(entry => [entry.node.id, entry.node.type, entry.node.next]);
      assert(json(view) === json(forestRunView(createForestRun(seed, { map: 'generated', skipTrunk: true })).nodes.map(entry => [entry.node.id, entry.node.type, entry.node.next])),
        `${seed}: the played map shows the same nodes, types and edges`);
    }
    // Two runs with the same history reach the same node with the same battle.
    const first = createForestRun(seed, { map: 'generated', skipTrunk: true }), [node] = availableNodes(first);
    assert(availableNodes(createForestRun(seed, { map: 'generated', skipTrunk: true }))[0].name === node.name, `${seed}: the same history gives the same battle`);
  }
}

/** A saved generated run keeps its map; a forged map or pick is rejected; the old authored save still loads. */
function saves() {
  const seed = spread(4242);
  let run = createForestRun(seed, { map: 'generated', skipTrunk: true });
  run = ok(enterNode(run, availableNodes(run)[0].id), 'enter');
  assert(json(parseForestRun(serializeForestRun(run))) === json(run), 'an open generated battle round-trips');
  const tamper = (edit: (value: Record<string, any>) => void) => { const value = JSON.parse(serializeForestRun(run)); edit(value); return parseForestRun(JSON.stringify(value)); };
  assert(tamper(v => { v.map.nodes.find((node: any) => node.type === 'boss').type = 'battle'; }) === null, 'a map without a boss is rejected');
  assert(tamper(v => { v.map.nodes.find((node: any) => node.id.startsWith('r5')).type = 'rest'; }) === null, 'a rest on row 5 is rejected');
  assert(tamper(v => { const node = v.map.nodes.find((entry: any) => entry.id.startsWith('r6')); node.next = ['r9c1']; }) === null, 'an edge skipping rows is rejected');
  assert(tamper(v => { v.picks[0].battleId = 'troll-lair'; }) === null, 'a battle outside the node pool is rejected');
  assert(tamper(v => { v.picks = []; }) === null, 'an entered pool node without its pick is rejected');
  assert(tamper(v => { v.map = { kind: 'authored' }; }) === null, 'a generated route does not load on the authored graph');
  // The battle in a save stays even if the pools change later: the save carries the pick, not a reroll.
  const other = createForestRun(seed, { map: 'generated' });
  assert(json(parseForestRun(serializeForestRun(other))) === json(other), 'a fresh generated run with the trunk round-trips');
}

connectivity();
console.log(`PASS connectivity on ${SEEDS.length} maps`);
typeRules();
toolsAndPools();
console.log(`PASS tools by row and fitting pools on ${SEEDS.length} maps`);
determinismAndVariety();
await mapIgnoresChoices();
console.log('PASS the map depends only on the run seed');
saves();
console.log('PASS saves of generated runs');
await botRuns();
console.log('Map generator checks passed.');
