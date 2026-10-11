/**
 * The forest run layer (src/realtime/forest), node only: `npm run test:realtime-forest`. The map generator and the event
 * catalogue came from the removed turn-based game with their own checks gone; these hold the rules a real-time run meets:
 * - the map of a seed is the same every time, valid as a save, and starts at map row 5;
 * - every node is reached from the start and every path ends at a boss; the Jailer's row joins all paths;
 * - on every path: no hard battle, rest, find, merchant or event twice in a row; a rest 1–3 branch rows before a hard
 *   battle; at most EVENTS_PER_PATH events from row 5 to the boss; every branch offers a path with and without a hard
 *   battle; every map has a merchant;
 * - the event catalogue passes its structural checks.
 */
import { BOSS_ROW, BRANCH_FIRST_ROW, CHECKPOINT_ID, EVENTS_PER_PATH, generatedRunMap, generateForestMap, NO_REPEAT_TYPES, REST_BEFORE_HARD, TRAIL_FIRST_ROW, validateStoredMap } from './mapGenerator';
import { validateForestEvents } from './forestEvents';
import type { ForestMapNode, ForestRunMap } from './forestMap';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const SEEDS = [0, 1, 2, 3, ...Array.from({ length: 196 }, (_, k) => Math.imul(k + 1, 2654435761) >>> 0)];

/** Every path of a run map from its start to a node without exits. */
function paths(map: ForestRunMap): ForestMapNode[][] {
  const walk = (node: ForestMapNode): ForestMapNode[][] => node.next.length ? node.next.flatMap(id => walk(map.node(id)!).map(rest => [node, ...rest])) : [[node]];
  return map.starts().flatMap(id => walk(map.node(id)!));
}

check('a seed gives the same map every time; the map is a valid save and starts at map row 5', () => {
  for (const seed of SEEDS) {
    const map = generateForestMap(seed);
    assert(JSON.stringify(map) === JSON.stringify(generateForestMap(seed)), `seed ${seed}: same map`);
    assert(!validateStoredMap(map).length, `seed ${seed}: ${validateStoredMap(map).join(' ')}`);
    const run = generatedRunMap(map);
    assert(run.starts().length >= 2 && run.starts().every(id => run.node(id)!.row === TRAIL_FIRST_ROW), `seed ${seed}: the run starts with a choice on row 5`);
  }
  assert(new Set(SEEDS.map(seed => JSON.stringify(generateForestMap(seed)))).size === SEEDS.length, 'different seeds, different maps');
});

check('every node is on a path; every path passes the Jailer and ends at a boss', () => {
  for (const seed of SEEDS) {
    const run = generatedRunMap(generateForestMap(seed)), all = paths(run), seen = new Set(all.flat().map(node => node.id));
    assert(run.nodes.every(node => seen.has(node.id)), `seed ${seed}: a node off every path`);
    for (const path of all) {
      assert(path.some(node => node.id === CHECKPOINT_ID), `seed ${seed}: a path misses the Jailer`);
      assert(path[path.length - 1].type === 'boss' && path[path.length - 1].row === BOSS_ROW, `seed ${seed}: a path does not end at a boss`);
    }
  }
});

check('on every path: no repeats, a rest before a hard battle, at most EVENTS_PER_PATH events; a choice of risk per branch; a merchant per map', () => {
  for (const seed of SEEDS) {
    const run = generatedRunMap(generateForestMap(seed)), all = paths(run);
    assert(run.nodes.some(node => node.type === 'shop'), `seed ${seed}: no merchant`);
    for (const path of all) {
      for (let n = 1; n < path.length; n++) assert(!(path[n].type === path[n - 1].type && NO_REPEAT_TYPES.includes(path[n].type)), `seed ${seed}: ${path[n].type} twice in a row at ${path[n].id}`);
      assert(path.filter(node => node.type === 'event').length <= EVENTS_PER_PATH, `seed ${seed}: too many events on a path`);
      path.forEach((node, n) => {
        if (node.type !== 'hard') return;
        const before = path.slice(0, n).filter(other => other.row >= Math.max(BRANCH_FIRST_ROW, node.row - REST_BEFORE_HARD.max) && other.row <= node.row - REST_BEFORE_HARD.min);
        assert(before.some(other => other.type === 'rest'), `seed ${seed}: ${node.id} without a rest before it`);
      });
    }
    for (const lane of ['den', 'camp']) {
      const branch = all.map(path => path.filter(node => node.lane === lane)).filter(part => part.length);
      assert(branch.some(part => part.some(node => node.type === 'hard')) && branch.some(part => !part.some(node => node.type === 'hard')), `seed ${seed}: ${lane} offers no choice of risk`);
    }
  }
});

check('the event catalogue passes its structural checks', () => {
  const errors = validateForestEvents();
  assert(!errors.length, errors.join(' '));
});

console.log(`realtime-forest: ${checks} checks passed`);
