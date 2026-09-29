import fixtures from '../../tests/fixtures/recovered-rules.json';
import * as core from './recovered/core';
import * as board from './recovered/board';
import * as combat from './recovered/combat';
import type { Entity, Point } from './recovered/sharedtypes';

// Heterogeneous fixture input is deliberately data-driven; production APIs remain typed.
type Bag = Record<string, any>;
interface TestEntity extends Entity, board.RefillEntity { id: number }
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) throw new Error(`${message}\nactual=${JSON.stringify(actual)}\nexpected=${JSON.stringify(expected)}`);
}
function run(fn: string, data: Bag) {
  const events: unknown[][] = [], log = (...event: unknown[]) => { events.push(event); };
  const entities = new Map<number, TestEntity>((data.entities ?? []).map((e: TestEntity) => [e.id, structuredClone(e)]));
  const cells = new Map<string, TestEntity>((data.cells ?? []).map(([x, y, id]: number[]) => [`${x},${y}`, entities.get(id)!]));
  const get = (x: number, y: number) => cells.get(`${x},${y}`) ?? null;
  const query = (x: number, y: number) => { log('get', x, y); return get(x, y); };
  const player = entities.get(0)!, path: Point[] = data.path ?? [], a = data.args ?? [];
  let result: unknown = null, state: unknown = null;
  switch (fn) {
    case 'is_path_ender': result = core.isPathEnder(entities.get(data.target) ?? null); break;
    case 'power_contribution': result = core.powerContribution(entities.get(data.target) ?? null, a[0], player, a[1]); break;
    case 'path_attack_power': result = core.pathAttackPower(path, get, player, a[0], a[1]); break;
    case 'path_colour': result = core.pathColour(path, get, a[0]); break;
    case 'is_pathable':
      try { result = core.isPathable(data.point, path, get, player, a[0], a[1], a[2], a[3], a[4]); }
      catch (error) { if (!(error instanceof Error) || !error.message.includes('initialized path')) throw error; result = 'ERROR_EMPTY_PATH'; }
      break;
    case 'gaps_below': result = core.gapsBelow(get, a[0], a[1], a[2]); break;
    case 'next_board_colour': result = core.nextBoardColour(a[0], new Set(a[1])); break;
    case 'agro_start_turn': result = core.agroStartTurn(a[0], a[1], a[2], a[3], a[4], a[5]); break;
    case 'enemy_will_attack': result = core.enemyWillAttack(player); break;
    case 'gem_class': result = core.gemClass(a[0], a[1]); break;
    case 'gem_value': result = core.gemValue(a[0], a[1], a[2]); break;
    case 'process_fall_refill': {
      const current = { ...data.state } as core.FallRefillState; let fill = 0;
      result = core.processFallRefill(a[0], a[1], current, {
        fall: () => log('fall'), refill: n => { log('refill', n); return data.fills[fill++]; },
        settled: n => { log('settled', n); return n === 5 ? data.settled5 : data.settled10; },
        fallDiagonals: () => { log('diagonals'); return data.diagonal; }, sound: n => log('sound', n), challengeCountdown: n => log('countdown', n),
      }); state = current; break;
    }
    case 'can_heal': result = combat.canHeal(player, a[0]); break;
    case 'can_shield': result = combat.canShield(player); break;
    case 'can_fire_arrow_hit': result = combat.canFireArrowHit(a[0], a[1], a[2], a[3]); break;
    case 'boss_update': {
      const boss = { ...data.boss } as combat.BossState;
      result = combat.bossUpdate(boss, a[0], (name, current) => { log('handler', name, { ...current }); current.settle_timer = data.handlerSettle; }); state = boss; break;
    }
    case 'ghost_action': result = combat.ghostAction(a[0], a[1], a[2], a[3], () => { log('numSkelly'); return data.numSkelly; }); break;
    case 'volcano_action': result = combat.volcanoAction(a[0], a[1], a[2]); break;
    case 'vine_action': result = combat.vineAction(a[0], a[1], a[2], a[3], a[4], a[5], a[6], {
      random: (low, high) => { log('random', low, high); return data.draw; },
      createReticle: (x, y) => { log('reticle', x, y); return `${x},${y}`; }, setProperty: (e, p, v) => log('property', e, p, v),
      playSound: x => log('sound', x), decrementBossProperty: (p, v) => log('decrement', p, v), setBossProperty: (p, v) => log('bossProperty', p, v),
    }); break;
    default: {
      const width = data.width, height = data.height;
      const free = (x: number, y: number, w: number, h: number) => {
        log('free', x, y, w, h);
        for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) if (i < 0 || i >= width || j < 0 || j >= height || get(i, j)) return false;
        return true;
      };
      const setCell = (x: number, y: number, e: TestEntity, flag: boolean) => {
        log('cell', x, y, e.id, flag);
        for (let i = x; i < x + e.width; i++) for (let j = y; j < y + e.height; j++) cells.set(`${i},${j}`, e);
      };
      const setProperty = (e: TestEntity, p: number, v: number) => { log('property', e.id, p, v); e.properties[p] = v; };
      const removeProperty = (e: TestEntity, p: number) => { log('remove', e.id, p); delete e.properties[p]; };
      const setNextState = (e: TestEntity, s: number) => log('state', e.id, s);
      if (fn === 'bottom_free_row') result = board.bottomFreeRow(a[0], a[1], a[2], a[3], height, query, free, col => log('failure', col));
      else if (fn === 'get_fall_layer') result = board.getFallLayer(a[0], width, query, (x, y, flag) => { log('clear', x, y, flag); cells.delete(`${x},${y}`); }).map(e => e?.id ?? null);
      else if (fn === 'insert_fall_layer') board.insertFallLayer((data.layer as (number | null)[]).map(id => id === null ? null : entities.get(id)!),
        (x, y, w, h) => { log('bottom', x, y, w, h); return data.destinations[x]; }, setNextState, setCell, removeProperty);
      else if (fn === 'fall_down') combat.fallDown(width, height, query, setProperty, row => log('layer', row), () => log('insert'));
      else if (fn === 'refill') {
        let serial = 100;
        result = board.refill(width, height, a[0], a[1], a[2], a[3], a[4], {
          randomColumn: w => { log('randomColumn', w); return data.draw; },
          isEmpty: (x, y) => { log('empty', x, y); return !get(x, y); },
          anyAbove: (x, y) => { log('above', x, y); for (let j = 0; j < y; j++) if (get(x, j)) return true; return false; },
          isFree: free, spawn: (x, y, w, h, colour) => {
            serial++; const size = w === 2 && data.large && serial % 2 ? 2 : 1;
            const e: TestEntity = { id: serial, col: x, row: y, width: size, height: size, y: serial, properties: {},
              subtype: 0, power: 1, max_power: 1, colour: -3, attack_mode: 0, attack_power: 0 };
            entities.set(serial, e); log('spawn', x, y, w, h, colour, serial, size); return e;
          }, setCell, setProperty, getCell: query,
          highestEntity: x => { log('highest', x); const values = [...cells].filter(([key]) => Number(key.split(',')[0]) === x).map(([, e]) => e.y); return values.length ? Math.min(...values) : 0; },
          removeProperty, setNextState,
        });
      } else throw new Error(`Unknown fixture ${fn}`);
      state = { cells: [...cells].map(([key, e]) => [...key.split(',').map(Number), e.id]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
        entities: [...entities.values()].sort((a, b) => a.id - b.id).map(e => ({ id: e.id, properties: e.properties, y: e.y })) };
    }
  }
  return { result, events, state };
}
const counts = new Map<string, number>();
for (const vector of fixtures.vectors) {
  equal(run(vector.fn, vector.input as Bag), vector.expected, vector.id);
  counts.set(vector.fn, (counts.get(vector.fn) ?? 0) + 1);
}
equal(Object.fromEntries(counts), fixtures.counts, 'all function groups exercised');
if (counts.size !== 24) throw new Error('Expected all 24 reference functions');
console.log(`PASS ${counts.size} recovered core/board/combat functions against ${fixtures.vectors.length} actual Python vectors, mutations and dependency order`);
