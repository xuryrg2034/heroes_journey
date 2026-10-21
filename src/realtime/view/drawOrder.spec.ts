/**
 * The drawing order of the bodies (view/drawOrder.ts; design 21.10.2026, task 48 §24, «bossPickArt»): what is on top is `artDrawnAbove` — the larger y,
 * at an equal y the larger id — whatever history the views have. Node only: `npm run test:realtime-draw-order`. Real PixiJS `Container`s sorted by
 * `zIndex` as the render's `enemyLayer` does (`sortableChildren`); the views are made in different orders and made anew (what a colour or hp change
 * does), and the order that comes out is compared with `artDrawnAbove` itself.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Container } from 'pixi.js';
import { artDrawnAbove } from '../sim/bossArt';
import { drawRanks } from './drawOrder';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

interface Body { id: number; y: number }
/** The layer as render.ts keeps it: one root per body, added in `order`, sorted by `zIndex`; returns the ids bottom to top. */
function layerOrder(bodies: readonly Body[], order: readonly number[], ranked: boolean): number[] {
  const layer = new Container(), roots = new Map<number, Container>();
  layer.sortableChildren = true;
  const ranks = drawRanks([...bodies].reverse());
  for (const id of order) {
    const b = bodies.find(x => x.id === id)!, root = new Container();
    root.zIndex = ranked ? ranks.get(id)! : b.y;
    roots.set(id, root);
    layer.addChild(root);
  }
  layer.sortChildren();
  return layer.children.map(c => [...roots].find(([, r]) => r === c)![0]);
}

const bodies: Body[] = [{ id: 3, y: 5 }, { id: 7, y: 5 }, { id: 9, y: 4.5 }, { id: 11, y: 5 }, { id: 2, y: 6 }, { id: 5, y: 5.0000001 }];

check('the old key (`zIndex = y`) leaves an equal y to the history: the order of adding decides — the defect', () => {
  const a = layerOrder(bodies, [3, 7, 9, 11, 2, 5], false), b = layerOrder(bodies, [11, 7, 3, 9, 2, 5], false);
  assert(JSON.stringify(a) !== JSON.stringify(b), `the same bodies drawn in two orders by the old key: ${a} / ${b}`);
});

check('the rank: whatever the order the views were made in, the order drawn is `artDrawnAbove` — the larger y, at an equal y the larger id', () => {
  const orders = [[3, 7, 9, 11, 2, 5], [11, 7, 3, 9, 2, 5], [5, 2, 11, 9, 7, 3], [7, 11, 3, 5, 2, 9]];
  const first = layerOrder(bodies, orders[0], true);
  for (const o of orders) {
    const got = layerOrder(bodies, o, true);
    assert(JSON.stringify(got) === JSON.stringify(first), `the views made in order ${o}: ${got}, not ${first}`);
    for (let i = 0; i + 1 < got.length; i++) {
      const low = bodies.find(b => b.id === got[i])!, high = bodies.find(b => b.id === got[i + 1])!;
      assert(artDrawnAbove(high, low) && !artDrawnAbove(low, high), `${got[i + 1]} is over ${got[i]} as \`artDrawnAbove\` says`);
    }
  }
  assert(first.join() === '9,3,7,11,5,2', `bottom to top: ${first}`);
});

check('a view made anew (a colour or hp change: the root leaves and a new one is added last) keeps its place by its id, not by being last', () => {
  const layer = new Container();
  layer.sortableChildren = true;
  const roots = new Map<number, Container>(), ranks = drawRanks([...bodies].reverse());
  for (const b of bodies) { const r = new Container(); r.zIndex = ranks.get(b.id)!; roots.set(b.id, r); layer.addChild(r); }
  // Body 11 (y 5, between 7 and 5.0000001) is made anew: removed, a new root added last.
  const old = roots.get(11)!;
  layer.removeChild(old);
  const fresh = new Container();
  fresh.zIndex = drawRanks([...bodies].reverse()).get(11)!;
  roots.set(11, fresh);
  layer.addChild(fresh);
  layer.sortChildren();
  const ids = layer.children.map(c => [...roots].find(([, r]) => r === c)![0]);
  assert(ids.join() === '9,3,7,11,5,2', `after the view of 11 was made anew: ${ids}`);
});

console.log('draw order: all checks passed');
