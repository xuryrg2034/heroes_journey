import fixtures from '../../tests/fixtures/recovered-rules.json';
import * as core from './recovered/core';
import * as combat from './recovered/combat';
import type { Entity, Point } from './recovered/sharedtypes';

// Heterogeneous fixture input is deliberately data-driven; production APIs remain typed.
type Bag = Record<string, any>;
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) throw new Error(`${message}\nactual=${JSON.stringify(actual)}\nexpected=${JSON.stringify(expected)}`);
}
function run(fn: string, data: Bag) {
  const entities = new Map<number, Entity>((data.entities ?? []).map((e: Entity & { id: number }) => [e.id, structuredClone(e)]));
  const cells = new Map<string, Entity>((data.cells ?? []).map(([x, y, id]: number[]) => [`${x},${y}`, entities.get(id)!]));
  const get = (x: number, y: number) => cells.get(`${x},${y}`) ?? null;
  const player = entities.get(0)!, path: Point[] = data.path ?? [], a = data.args ?? [];
  let result: unknown = null;
  switch (fn) {
    case 'path_colour': result = core.pathColour(path, get, a[0]); break;
    case 'agro_start_turn': result = core.agroStartTurn(a[0], a[1], a[2], a[3], a[4], a[5]); break;
    case 'enemy_will_attack': result = core.enemyWillAttack(player); break;
    case 'can_heal': result = combat.canHeal(player, a[0]); break;
    case 'can_fire_arrow_hit': result = combat.canFireArrowHit(a[0], a[1], a[2], a[3]); break;
    default: throw new Error(`Unknown fixture ${fn}`);
  }
  return { result, events: [], state: null };
}
const counts = new Map<string, number>();
for (const vector of fixtures.vectors) {
  equal(run(vector.fn, vector.input as Bag), vector.expected, vector.id);
  counts.set(vector.fn, (counts.get(vector.fn) ?? 0) + 1);
}
equal(Object.fromEntries(counts), fixtures.counts, 'all function groups exercised');
if (counts.size !== 5) throw new Error('Expected the 5 reference functions the game uses');
console.log(`PASS ${counts.size} recovered core/combat functions the game uses against ${fixtures.vectors.length} actual Python vectors`);
