/**
 * Task 8c: the node card's lines (view/nodeCard.ts) — goal, enemies, elites, terrain — read from the arena templates of the run
 * and the run row's numbers. Node only: `npm run test:realtime-node-card`. The card on screen (real clicks on the map) is
 * tests/realtime-actionbar.spec.ts.
 */
import { arenaTemplate } from '../sim/arenas';
import { ARENA_POOLS, FINAL_ARENA, HARD_ARENA } from '../run/arenaPools';
import { RT_RANDOM_ELITE_ROW, rtElitePlates } from '../run/rtRun';
import { eliteText, goalText, nodeDangers } from './nodeCard';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const text = (arena: string, row: number, extra: Partial<Parameters<typeof nodeDangers>[0]> = {}): Record<string, string> =>
  Object.fromEntries(nodeDangers({ arena, row, guaranteedElite: false, ...extra }).map(line => [line.id, line.text]));

check('the goal drops the arena name in front and starts with a capital', () => {
  assert(goalText('Поляна: убей цепью 20 врагов.') === 'Убей цепью 20 врагов.', goalText('Поляна: убей цепью 20 врагов.'));
  assert(goalText('Убей всех.') === 'Убей всех.', 'no name — as it is');
  for (const entry of ARENA_POOLS) {
    const goal = text(entry.arena, entry.rows[0]).goal, name = arenaTemplate(entry.arena).name;
    assert(goal && !goal.startsWith(`${name}:`), `${entry.arena}: ${goal}`);
  }
});

check('every run arena lists its lines in the design order: goal, enemies, elites, terrain; the ordinary enemies first', () => {
  const order = ['goal', 'enemies', 'elites', 'terrain'];
  for (const entry of [...ARENA_POOLS, { arena: HARD_ARENA, rows: [5, 5] as const }, { arena: FINAL_ARENA, rows: [10, 10] as const }]) {
    for (const row of entry.rows) {
      const ids = nodeDangers({ arena: entry.arena, row, guaranteedElite: false }).map(line => line.id);
      assert(ids[0] === 'goal' && ids[1] === 'enemies', `${entry.arena} row ${row}: ${ids}`);
      assert(ids.every((id, i) => i === 0 || order.indexOf(id) > order.indexOf(ids[i - 1])), `${entry.arena}: order ${ids}`);
      assert(text(entry.arena, row).enemies.startsWith('обычные'), `${entry.arena}: ${text(entry.arena, row).enemies}`);
    }
  }
});

check('enemies by kind (the template and the roster), terrain by zones and the pond', () => {
  assert(text('archers', 4).enemies === 'обычные, лучники', text('archers', 4).enemies);
  assert(text('thorns', 5).terrain === 'терновник', `thorns: ${text('thorns', 5).terrain}`);
  assert(text('ford', 6).terrain === 'река', `ford: ${text('ford', 6).terrain}`);
  assert(text('powder', 4).terrain === 'обрыв', `powder: ${text('powder', 4).terrain}`);
  assert(text('glade', 1).terrain === 'пруд', `glade: ${text('glade', 1).terrain}`);
  assert(text('shields', 3).terrain === undefined, 'no terrain — no line');
  assert(text('nope', 1).goal === undefined && nodeDangers({ arena: 'nope', row: 1, guaranteedElite: false }).length === 0, 'unknown arena — nothing');
});

check('elites: none before the random row, «могут прийти» from it, start elites and the guaranteed one counted; plates and traits of the row', () => {
  assert(text('glade', 1).elites === undefined, 'row 1: no elites');
  assert(text('lynx-den', RT_RANDOM_ELITE_ROW - 1).elites === undefined, 'row before the random elites');
  assert(text('shields', RT_RANDOM_ELITE_ROW).elites === `могут прийти · броня ${rtElitePlates(RT_RANDOM_ELITE_ROW)}`, `${text('shields', 3).elites}`);
  assert(text('shields', 3, { guaranteedElite: true }).elites === '1, могут прийти ещё · броня 2', `${text('shields', 3, { guaranteedElite: true }).elites}`);
  assert(text(HARD_ARENA, 5).elites === '2, могут прийти ещё · броня 3 · особое свойство', `outpost: ${text(HARD_ARENA, 5).elites}`);
  assert(text(FINAL_ARENA, 10, { startElite: true }).elites === '3, могут прийти ещё · броня 4 · 2 особых свойства', `final: ${text(FINAL_ARENA, 10, { startElite: true }).elites}`);
  assert(eliteText(1, false, 2, 0) === '1 · броня 2', eliteText(1, false, 2, 0)!);
  assert(eliteText(0, false, 2, 0) === null, 'none');
  assert(eliteText(0, true, 3, 5) === 'могут прийти · броня 3 · 5 особых свойств', eliteText(0, true, 3, 5)!);
});

check('the new kinds of the viewer are marked on the enemies line', () => {
  const line = nodeDangers({ arena: 'archers', row: 4, guaranteedElite: false, newKinds: ['archer'] }).find(l => l.id === 'enemies')!;
  assert(line.newKinds?.join() === 'archer', `${line.newKinds}`);
  const none = nodeDangers({ arena: 'archers', row: 4, guaranteedElite: false }).find(l => l.id === 'enemies')!;
  assert(none.newKinds === undefined, 'nothing new — no mark');
});
