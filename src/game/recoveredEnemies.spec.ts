import oracleData from '../../tests/fixtures/recovered-enemies.json';
import * as rules from './recovered/enemies';
import { ForestEngine } from './forestEngine';
import { cloneEntity } from './ecs/components';
import { prepareIntents } from './forestSystems';
import { hasOrdinaryChain } from './boardGeneration';
import { startForestFixture, startNodeBattle } from './testing/fixtures';
import type { ForestCell } from './forestTypes';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
interface World { width: number; height: number; cells: Record<string, rules.EnemyActor>; blocked: number[][]; done: boolean[] }
interface Vector { id: string; fn: string; args: (number | boolean)[]; world: World; actor: rules.EnemyActor | null; expected: unknown; actorAfter: unknown; trace: unknown[][] }
function references() {
  for (const v of oracleData.vectors as unknown as Vector[]) {
    const w = v.world, trace: unknown[][] = [], a = structuredClone(v.actor); let done = 0;
    const record = (...values: unknown[]) => { trace.push(values); };
    const contains = (points: number[][], x: number, y: number) => points.some(point => point[0] === x && point[1] === y);
    const ops: rules.EnemyBoardOps & rules.ShieldOps & rules.BasicAttackOps = {
      valid: (x, y) => { record('valid', x, y); return x >= 0 && x < w.width && y >= 0 && y < w.height; },
      cell: (x, y) => { record('cell', x, y); return w.cells[`${x},${y}`] ?? null; },
      playableMove: (sx, sy, x, y) => { record('playableMove', sx, sy, x, y); return !contains(w.blocked, x, y); },
      remove: (e, prop) => { record('remove', prop); delete e.properties[prop]; },
      set: (e, prop, value) => { record('set', prop, value); e.properties[prop] = value; },
      spriteIndex: (_e, name) => { record('spriteIndex', name); const [prefix, suffix] = name.split('_'); return ['side', 'front', 'back'].indexOf(prefix) * 4 + ['idle', 'ready', 'attack', 'hit'].indexOf(suffix) + 10; },
      setAnim: (_e, anim, restart, reverse) => record('setAnim', anim, restart, reverse), sound: (_e, sound) => record('sound', sound),
      animDone: () => { record('animDone'); return w.done[done++ % w.done.length]; }, idle: () => record('idle'), meleeDamage: () => record('meleeDamage'), nextState: (_e, state) => record('nextState', state),
    };
    const n = (index: number) => v.args[index] as number, b = (index: number) => v.args[index] as boolean;
    let result: unknown;
    switch (v.fn) {
      case 'can_move_to': result = rules.canMoveTo(n(0), n(1), n(2), n(3), b(4), b(5), ops); break;
      case 'is_visibly_agro': result = rules.isVisiblyAgro(a!); break;
      case 'update_shield_dir': rules.updateShieldDir(a!, n(0), n(1), ops); result = null; break;
      case 'update_basic_attack': result = rules.updateBasicAttack(a!, n(0), n(1), ops); break;
      default: throw new Error(`Unknown oracle ${v.fn}`);
    }
    equal(result, v.expected, `${v.id} result`); equal(trace, v.trace, `${v.id} callback order`);
    equal(a ? { properties: a.properties, face_dir: a.face_dir } : null, v.actorAfter, `${v.id} mutations`);
  }
  console.log(`PASS ${oracleData.vectors.length} actual Python fixtures across the four enemy functions the game uses, exact results/mutations/callback order`);
}
let nextId = 80000;
function unit(kind: ForestCell['kind'] = 'melee', hp = kind === 'melee' ? 0 : 4): ForestCell { return { id: nextId++, kind, color: 0, hp, maxHp: hp, armor: 0, countdown: 1,
  status: { frozen: 0, brittle: false, wet: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: '' } }; }
function fixture() {
  // The camp fixture as a blank floor: the removed forest trial is no longer the generic board.
  const g = startForestFixture(701); g.state.terrain.fill('floor'); g.state.board.fill(null);
  g.state.player.index = 31;
  g.state.board[24] = unit('melee', 3); g.state.board[24]!.variant = 'sentinel';
  for (const index of [17, 18, 23, 25, 30, 32]) g.state.board[index] = unit(); prepareIntents(g.state); return g;
}
async function commit(g: ForestEngine, path: number[]) { assert(g.beginChain(path[0]), 'begin shield route'); for (const index of path.slice(1)) assert(g.extendChain(index), 'extend shield route'); assert(await g.releaseChain(), 'commit shield route'); }
async function shields() {
  const front = fixture(), sentinel = front.state.board[24]!;
  equal(sentinel.shield, { dx: 0, dy: 1 }, 'shield faces south toward hero');
  const clone = cloneEntity(sentinel); clone.shield!.dy = -1; equal(sentinel.shield, { dx: 0, dy: 1 }, 'shield cloning isolates candidates');
  let reason = ''; front.subscribe((_state, event) => { if (event.type === 'invalid') reason = event.text ?? ''; });
  const before = JSON.stringify(front.state); assert(!front.beginChain(24) && !front.validStarts().includes(24) && reason.includes('Щит'), 'front rejected at input with precise reason');
  equal(JSON.stringify(front.state), before, 'front rejection costs no HP/energy/turn/state');
  front.state.player.energy = 7; assert(!front.preview([32, 24]).valid, 'ordinary diagonal from protected half-plane rejected');
  front.cancelChain();
  const side = front.preview([30, 23, 24]); assert(side.valid && side.hits.at(-1)!.availablePower === 3 && side.hits.at(-1)!.killed, 'side approach builds enough power from two weak targets to bypass shield');
  await commit(front, [30, 23, 24]); assert(!front.state.board.some(cell => cell?.id === sentinel.id) && front.state.lastDamage === side.damage, 'side preview matches committed death and incoming damage');
  const back = fixture(); back.state.player.index = 10; back.state.board[17] = unit(); assert(back.preview([17, 24]).valid, 'rear approach allowed without retargeting shield');
  const frozen = fixture(); frozen.state.board[24]!.hp = frozen.state.board[24]!.maxHp = 1;
  frozen.state.board[24]!.status.frozen = 1; frozen.state.board[24]!.status.brittle = true;
  assert(frozen.preview([24, 17]).valid, 'freeze disables shield and brittle doubles ordinary hit');
  const abilities = fixture(); abilities.state.player.energy = 7; abilities.state.board[24]!.hp = abilities.state.board[24]!.maxHp = 4;
  assert(abilities.previewAbility('jump', 24).valid && abilities.previewAbility('spin').hits.some(hit => hit.index === 24 && hit.damage === 4), 'jump/spin ignore directional shield');
  abilities.state.inventory.bomb = 1; assert(abilities.previewItem('bomb', 24).damage === 6 && abilities.useItem('bomb', 24), 'bomb ignores directional shield');
  // The removed castle rooms (barracks, library) no longer host the sentinel: the forest-map shield battle does.
  const g = startNodeBattle('goblin-shield-flank');
  const guard = g.state.board.find(cell => cell?.variant === 'sentinel')!; assert(guard?.hp === 3 && !!guard.shield && hasOrdinaryChain(g.state), 'authored sentinel battle has a validated ordinary opening');
  const initial = JSON.stringify(g.state); await g.waitTurn(); const after = JSON.stringify(g.state); g.restartLevel(); equal(JSON.stringify(g.state), initial, 'entry snapshot restores guard and resources'); await g.waitTurn(); equal(JSON.stringify(g.state), after, 'sentinel preparation seeded replay');
  console.log('PASS runtime sentinel front/flank/rear/diagonal, freeze, ability exceptions, shared preview/commit, cloning, validated scenes and restart');
}
references(); await shields();
