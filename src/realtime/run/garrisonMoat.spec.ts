/**
 * Task 40 «Гарнизон, шаг 1б» (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md; docs/realtime-slice.md, «Гарнизон»):
 * the run's side — «Ров» in the garrison's pools and the keymaster's deep fights, «Повозка» at «Предместье», «Гарнизон пройден» in
 * the depth record, the run record's levels and the report's section «Гарнизон». Node only: `npm run test:realtime-garrison-moat`.
 *
 * Whole runs walked by the run's own commands (metaWalk.testkit.ts: enter, the arena fed back, every screen chosen, «В гарнизон»):
 * - «Ров» is the keymaster's first meeting: on garrison rows 6–9 only, before any deep «Галерея» or «Караульня»; its deep fight (the
 *   loadout's `deep`) on rows 8–9; a run without the flag plays the pools of step 1а;
 * - the cart only with the camp: the deposit leaves the stock at once; carried 100 % at a death in the garrison, the rest by the rule
 *   (50 %, the floor), the cap 40 together; «−» / «+» bounds; a run without the camp has no cart and walks as without the flag;
 * - the record: the Castellan won → `wonLevel` 2; an old profile's `won: true` reads as `wonLevel` 1; the level passed comes first;
 * - telemetry: the run record's `level`, `levelCleared`, `cart` pass `checkRecord`; the report's curve «л N», «г N».
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { stockTotal } from '../forest/merchant';
import { runRow } from './arenaPools';
import { GARRISON_DEEP_ROW, GARRISON_MOAT_ARENA, garrisonArenaChoices, RT_GARRISON_MOAT_ON, rtGarrisonNodeId } from './garrison';
import { ok, seedOf, walkRun, type Walk, type WalkOptions } from './metaWalk.testkit';
import {
  createRtRun, parseRtRun, rtArenaLoadout, rtAvailableNodes, rtCartView, rtEnterGarrison, rtEnterNode, rtNode, serializeRtRun, RT_CART_KEEP, RT_CART_MAX, type RtRunState,
} from './rtRun';
import { parseRtMeta, rtApplyMeta, rtCarry, rtRunWonLevel, RT_CARRY_FLOOR } from './rtMeta';
import { checkRecord, runKey, runRecordId, sessionKey, type RunRecord } from '../telemetry/schema';
import { garrisonStats, levelRowKey } from '../telemetry/report';
import { RtRecorder } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { defaultParams } from '../sim/params';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** The camp's flags of a meta run (any one makes the camp: `hearth` is kept only with `locked`). */
const CAMP = { locked: [] as string[], hearth: { jailerRerolls: 1 } };
/** A run with the garrison; task 40's moat parts pass the flag `moat` explicitly (`RT_GARRISON_MOAT_ON` is off until the ui view). */
const garrisonWalk = (k: number, extra: Partial<WalkOptions> = {}, create: WalkOptions['create'] = {}): Walk =>
  walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, moat: true, ...create }, ...extra });
/** The fights a walk entered: node, garrison row, arena, the loadout's `deep`. */
interface Fight { nodeId: string; row: number; arena: string; deep: boolean; type: string }
function fightsOf(k: number, create: WalkOptions['create'] = {}): { walk: Walk; fights: Fight[] } {
  const fights: Fight[] = [];
  const walk = garrisonWalk(k, {
    each: state => {
      const pending = state.pending;
      if (pending?.kind !== 'battle' || !rtGarrisonNodeId(pending.nodeId) || fights.some(f => f.nodeId === pending.nodeId)) return;
      const node = rtNode(state, pending.nodeId)!;
      fights.push({ nodeId: node.id, row: runRow(node.row), arena: pending.arena, deep: rtArenaLoadout(state).deep === true, type: node.type });
    },
  }, create);
  return { walk, fights };
}
/** A run walked up to «Предместье» (the forest won, the relic taken): the state on the cart's screen. */
function toOutskirts(k: number, create: WalkOptions['create'], loot?: number): RtRunState {
  let at: RtRunState | null = null;
  garrisonWalk(k, { ...loot !== undefined ? { loot } : {}, each: state => { if (!at && state.pending?.kind === 'outskirts') at = structuredClone(state); }, loseAt: run => !!run.garrisonLevel }, create);
  assert(at, `seed ${k}: «Предместье» reached`);
  return at;
}

check('«Ров» is the keymaster\'s first meeting: garrison rows 6–9 only, before any deep «Галерея» / «Караульня»; its deep fight on rows 8–9 (30 seeds)', () => {
  let moats = 0, deepMoats = 0, deepOthers = 0;
  for (let k = 1; k <= 30; k++) {
    const { walk, fights } = fightsOf(k);
    assert(walk.run.moat === true && walk.run.result !== null, `seed ${k}: a run with the flag walked to its end`);
    const firstMoat = fights.findIndex(f => f.arena === GARRISON_MOAT_ARENA);
    for (const [i, f] of fights.entries()) {
      if (f.arena === GARRISON_MOAT_ARENA) {
        moats++;
        assert(f.row >= 6 && f.row <= 9, `seed ${k}: «Ров» on row ${f.row}`);
        assert(f.deep === (f.row >= GARRISON_DEEP_ROW), `seed ${k}: «Ров» on row ${f.row} deep ${f.deep}`);
        if (f.deep) deepMoats++;
      } else if (f.deep) {
        deepOthers++;
        assert((f.arena === 'g-gallery' || f.arena === 'g-guardroom') && f.row >= GARRISON_DEEP_ROW && firstMoat >= 0 && firstMoat < i, `seed ${k}: a deep ${f.arena} on row ${f.row} only after «Ров» (${firstMoat} < ${i})`);
      }
    }
    // An ordinary battle on row 6+ before «Ров» was met would have been «Ров» (its own arena first).
    const ordinary = fights.filter(f => f.type === 'battle' || f.type === 'breakthrough' || f.type === 'event');
    const firstLate = ordinary.find(f => f.row >= 6);
    if (firstLate) assert(firstLate.arena === GARRISON_MOAT_ARENA, `seed ${k}: the first ordinary fight from row 6 is «Ров» (${firstLate.arena} on ${firstLate.row})`);
    // Every state of the walk reads back from its save.
    assert(serializeRtRun(parseRtRun(serializeRtRun(walk.run))!) === serializeRtRun(walk.run), `seed ${k}: the save reads back`);
  }
  assert(moats >= 10 && deepMoats > 0 && deepOthers > 0, `«Ров» played ${moats}, deep ${deepMoats}, deep others ${deepOthers}`);
});

check('a run without the flag (`moat: false`) plays the pools of step 1а: no «Ров», no deep fight; `moat` without the garrison is no run', () => {
  for (let k = 1; k <= 12; k++) {
    const { walk, fights } = fightsOf(k, { moat: false });
    assert(walk.run.moat === undefined && fights.length > 0 && fights.every(f => f.arena !== GARRISON_MOAT_ARENA && !f.deep), `seed ${k}: ${fights.map(f => f.arena)}`);
  }
  assert(garrisonArenaChoices(6, ['g-yard', 'g-kennel'], true).join() === GARRISON_MOAT_ARENA && !garrisonArenaChoices(6, ['g-yard', 'g-kennel']).includes(GARRISON_MOAT_ARENA), 'row 6: «Ров» with the flag, never without');
  const forest = createRtRun(seedOf(1), { garrison: false, moat: true });
  assert(forest.moat === undefined, 'no flag without the garrison');
  const bad = JSON.parse(serializeRtRun(forest)) as Record<string, unknown>;
  bad.moat = true;
  assert(parseRtRun(JSON.stringify(bad)) === null, 'a save with `moat` and no garrison is no run');
});

check('«Повозка» only with the camp: without it no cart, «В гарнизон» takes nothing and the run is the run without the flag (8 seeds)', () => {
  for (let k = 1; k <= 8; k++) {
    const at = toOutskirts(k, {});
    assert(rtCartView(at) === null, `seed ${k}: no cart without the camp`);
    assert(!rtEnterGarrison(at, 0).ok, `seed ${k}: a deposit is refused`);
    const entered = ok(rtEnterGarrison(at), 'garrison');
    assert(entered.cart === undefined && stockTotal(entered.materials) === stockTotal(at.materials), `seed ${k}: the stock stays`);
    // The same run created without the flag: «Предместье» and «В гарнизон» byte for byte (but the flag).
    const plain = toOutskirts(k, { moat: false }), plainEntered = ok(rtEnterGarrison(plain), 'garrison');
    const strip = (run: RtRunState): string => { const copy = structuredClone(run) as Partial<RtRunState>; delete copy.moat; return serializeRtRun(copy as RtRunState); };
    assert(strip(at) === strip(plain) && strip(entered) === strip(plainEntered), `seed ${k}: the run without the camp is the run without the flag`);
  }
});

check('«Повозка» with the camp: default «оставить 6» — min(stock − 6, 20); «−» / «+» within 0 … min(stock, 20); the deposit leaves the stock at once', () => {
  let rich = 0;
  for (let k = 1; k <= 8; k++) {
    const at = toOutskirts(k, CAMP, k % 2 ? 4 : undefined), stock = stockTotal(at.materials), view = rtCartView(at);
    assert(view && view.stock === stock && view.max === Math.min(stock, RT_CART_MAX) && view.keep === RT_CART_KEEP, `seed ${k}: the view (${JSON.stringify(view)})`);
    assert(view.deposit === Math.max(0, Math.min(stock - RT_CART_KEEP, RT_CART_MAX)), `seed ${k}: the default deposit ${view.deposit} of ${stock}`);
    if (stock > RT_CART_MAX + RT_CART_KEEP) rich++;
    const byDefault = ok(rtEnterGarrison(at), 'garrison');
    assert(byDefault.cart?.n === view.deposit && byDefault.cart.before === stock && stockTotal(byDefault.materials) === stock - view.deposit, `seed ${k}: the default deposit leaves the stock (${JSON.stringify(byDefault.cart)})`);
    for (const n of [0, view.max]) {
      const run = ok(rtEnterGarrison(at, n), `deposit ${n}`);
      assert(run.cart?.n === n && stockTotal(run.materials) === stock - n, `seed ${k}: deposit ${n}`);
    }
    for (const n of [-1, view.max + 1, 0.5]) assert(!rtEnterGarrison(at, n).ok, `seed ${k}: deposit ${n} refused`);
    assert(serializeRtRun(parseRtRun(serializeRtRun(byDefault))!) === serializeRtRun(byDefault), `seed ${k}: the save with the cart reads back`);
    const bad = JSON.parse(serializeRtRun(byDefault)) as { cart: { n: number; before: number } };
    bad.cart.n = bad.cart.before + 1;
    assert(parseRtRun(JSON.stringify(bad)) === null, `seed ${k}: a cart above its stock is no run`);
  }
  assert(rich > 0, 'some run had more than 26 resources (the deposit capped at 20)');
});

check('the carry with the cart: a death in the garrison carries the cart 100 % and the rest by the rule (50 %, the floor); a victory all; the cap 40 together', () => {
  for (let k = 1; k <= 8; k++) {
    for (const loot of [1, 4]) {
      const lost = garrisonWalk(k, { loot, loseAt: run => !!run.garrisonLevel && run.visited.filter(rtGarrisonNodeId).length >= 2 }, CAMP).run;
      assert(lost.result?.outcome === 'defeat' && lost.cart, `seed ${k}: lost in the garrison with a cart`);
      const rest = stockTotal(lost.materials), cart = lost.cart.n, carry = rtCarry(lost);
      const want = Math.min(40, cart + Math.max(Math.floor(rest / 2), Math.min(rest, RT_CARRY_FLOOR)));
      assert(carry.n === want && carry.cart === cart && carry.cap === 40, `seed ${k}, loot ${loot}: carry ${JSON.stringify(carry)} / want ${want} (cart ${cart}, rest ${rest})`);
      const end = rtApplyMeta(undefined, lost).end;
      assert(end.carry.cart === cart && end.stock.after === end.stock.before + carry.n, `seed ${k}: the end screen's carry (${JSON.stringify(end.carry)})`);
      const won = garrisonWalk(k, { loot }, CAMP).run;
      assert(won.result?.outcome === 'victory' && won.cart, `seed ${k}: the garrison won with a cart`);
      assert(rtCarry(won).n === Math.min(40, won.cart.n + stockTotal(won.materials)), `seed ${k}: a victory carries all (${JSON.stringify(rtCarry(won))})`);
    }
  }
  // The cap together: a rich run whose cart and rest exceed 40.
  const rich = garrisonWalk(3, { loot: 12, deposit: run => rtCartView(run)!.max }, CAMP).run;
  assert(rich.cart!.n === RT_CART_MAX && rtCarry(rich).n === 40 && stockTotal(rich.materials) + rich.cart!.n > 40, `the cap 40 together (${JSON.stringify(rtCarry(rich))}, rest ${stockTotal(rich.materials)})`);
  // A forest run (no garrison): no cart in the carry.
  const forest = walkRun({ k: 2 }).run;
  assert(rtCarry(forest).cart === undefined, 'a forest run has no cart');
});

check('the record (flag of the moat off and on): the Castellan won → wonLevel 2 («Гарнизон пройден»), beats any row; an old `won: true` reads as wonLevel 1; a later garrison death does not beat it', () => {
  // «Гарнизон пройден» acts for every run with the garrison — with «Ров» and without it (the flag of the moat off: the game now).
  for (const [k, moat] of [[1, false], [2, true], [3, false], [4, true]] as const) {
    const won = garrisonWalk(k, {}, { moat }).run, lost = garrisonWalk(k, { loseAt: run => !!run.garrisonLevel && run.visited.filter(rtGarrisonNodeId).length >= 4 }, { moat }).run;
    assert(!!won.moat === moat && !!lost.moat === moat, `seed ${k}: the flag of the moat ${moat}`);
    assert(rtRunWonLevel(won) === 2 && rtRunWonLevel(lost) === 1 && rtRunWonLevel(walkRun({ k, loseAt: (_r, type) => type === 'boss' }).run) === 0, `seed ${k}: the levels passed`);
    // An old profile: the forest won, the record row 10 (`won: true`, no `wonLevel`).
    const old = parseRtMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 10, won: true, xp: 100 } } } });
    assert(old?.heroes.cat?.record?.wonLevel === 1, `seed ${k}: won → wonLevel 1 (${JSON.stringify(old?.heroes.cat?.record)})`);
    const first = rtApplyMeta(old, won);
    assert(first.end.record.after.wonLevel === 2 && first.end.record.before?.wonLevel === 1 && first.end.record.beaten && first.meta.heroes.cat!.record!.wonLevel === 2, `seed ${k}: «Гарнизон пройден» (${JSON.stringify(first.end.record)})`);
    const again = rtApplyMeta(first.meta, lost);
    assert(!again.end.record.beaten && again.end.record.after.wonLevel === 2 && again.end.record.after.row === first.end.record.after.row, `seed ${k}: a later garrison death does not beat it (${JSON.stringify(again.end.record)})`);
    // The level passed decides before the row: a record of a death at the Castellan (the garrison's row 10) is beaten by his defeat.
    const atCastellan = parseRtMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 10, won: true, xp: 100, level: 2 } } } });
    const beat = rtApplyMeta(atCastellan, won).end.record;
    assert(beat.beaten && beat.after.wonLevel === 2 && beat.before?.wonLevel === 1, `seed ${k}: «Гарнизон пройден» beats «Гарнизон, ряд 10» (${JSON.stringify(beat)})`);
    // The stored record reads back.
    const stored = parseRtMeta(JSON.parse(JSON.stringify(again.meta)));
    assert(stored?.heroes.cat?.record?.wonLevel === 2 && stored.heroes.cat.record.level === 2, 'the record reads back');
  }
  // A record of task 38 (the garrison's row, `won: false`): the forest was passed to get there.
  const legacy = parseRtMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 5, won: false, xp: 40, level: 2 } } } });
  assert(legacy?.heroes.cat?.record?.wonLevel === 1, `a garrison record of task 38 reads as the forest passed (${JSON.stringify(legacy?.heroes.cat?.record)})`);
  // One name, one meaning: «beaten» reads the level passed, not `won` — a forest won again does not beat a record that passed it.
  const forestWin = walkRun({ k: 2 }).run;
  assert(forestWin.result?.outcome === 'victory', 'a forest run won');
  const again = rtApplyMeta(legacy, forestWin).end;
  assert(!again.record.beaten && again.record.after.level === 2 && again.record.after.wonLevel === 1 && again.record.after.won, `not beaten (${JSON.stringify(again.record)})`);
});

check('a run abandoned on the map of the garrison before any garrison node: its depth is the forest one (row 10, no level), no «новый рекорд» over «лес пройден»; a forest record of row 8 it beats (5 seeds)', () => {
  for (const [k, moat] of [[1, false], [2, true], [3, false], [4, false], [5, true]] as const) {
    const at = toOutskirts(k, { moat }), entered = ok(rtEnterGarrison(at), 'garrison');
    assert(entered.garrisonLevel && entered.visited.every(id => !rtGarrisonNodeId(id)) && entered.result === null, `seed ${k}: on the map of the garrison, no garrison node`);
    const forestPassed = parseRtMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 10, won: true, xp: 100 } } } });
    const end = rtApplyMeta(forestPassed, entered).end;
    assert(!end.record.beaten && end.record.after.level === undefined && end.record.after.row === 10 && end.record.after.wonLevel === 1, `seed ${k}: not beaten (${JSON.stringify(end.record)})`);
    const row8 = parseRtMeta({ heroes: { cat: { xp: 0, packs: [], record: { row: 8, won: false, xp: 30 } } } });
    const beat = rtApplyMeta(row8, entered).end;
    assert(beat.record.beaten && beat.record.after.level === undefined && beat.record.after.row === 10 && beat.record.after.wonLevel === 1, `seed ${k}: beats row 8 as the forest final (${JSON.stringify(beat.record)})`);
    // One garrison node entered: the garrison row 1 — a garrison record.
    const first = ok(rtEnterNode(entered, rtAvailableNodes(entered)[0].id), 'enter');
    assert(rtApplyMeta(forestPassed, first).end.record.after.level === 2, `seed ${k}: a garrison node makes it the garrison record`);
  }
});

check('telemetry: the run record\'s level, levelCleared and cart pass checkRecord (malformed refused); the report\'s curve «л N» / «г N», deaths, the cart', () => {
  const session = sessionKey(Date.UTC(2026, 9, 16), 7), runId = runKey(Date.UTC(2026, 9, 16), 1);
  const base = { schema: 1, id: runRecordId(session, runId), kind: 'run', session, run: runId, build: 'b', at: '2026-10-16T00:00:00Z', params: { storage: 'p', hash: 'h' },
    seed: 1, outcome: 'defeat', farRow: 3, death: null, nodes: [], choices: [], fights: [], kit: {}, runParams: {} };
  assert(checkRecord(base) === null, `the base passes (${checkRecord(base)})`);
  const full = { ...base, level: 2, levelCleared: 1, cart: { n: 5, before: 12 }, record: { row: 3, won: true, beaten: true, level: 2, wonLevel: 1 }, carry: { n: 9, share: 0.5, cap: 40, resources: 7, cart: 5 } };
  assert(checkRecord(full) === null, `the new fields pass (${checkRecord(full)})`);
  for (const bad of [{ level: 1 }, { levelCleared: 3 }, { cart: { n: 13, before: 12 } }, { record: { row: 3, won: true, beaten: true, wonLevel: 3 } }, { carry: { n: 9, share: 0.5, cap: 40, resources: 7, cart: -1 } }]) {
    assert(checkRecord({ ...full, ...bad }) === 'run meta', `refused: ${JSON.stringify(bad)}`);
  }
  const run = (id: string, outcome: string, nodes: [string, number][], cart?: { n: number; before: number }): RunRecord =>
    ({ run: id, outcome, nodes: nodes.map(([nodeId, row]) => ({ nodeId, row })), ...cart ? { cart } : {} } as unknown as RunRecord);
  const st = garrisonStats([
    run('A', 'defeat', [['r5c0', 1], ['r6c0', 2], ['r7c0', 3]]),
    run('B', 'defeat', [['r5c0', 1], ['r14c0', 10], ['g:r5c0', 1], ['g:r6c0', 2]], { n: 8, before: 14 }),
    run('C', 'victory', [['r14c0', 10], ['g:r14c0', 10]], { n: 0, before: 3 }),
  ], []);
  assert(st.reached[levelRowKey(1, 1)] === 3 && st.reached[levelRowKey(1, 3)] === 3 && st.reached[levelRowKey(1, 4)] === 2 && st.reached[levelRowKey(2, 2)] === 2 && st.reached[levelRowKey(2, 3)] === 1, JSON.stringify(st.reached));
  assert(st.deaths['л 3'] === 1 && st.deaths['г 2'] === 1 && Object.keys(st.deaths).length === 2, JSON.stringify(st.deaths));
  assert(st.carts.length === 2 && st.carts[0].n === 8, JSON.stringify(st.carts));
});

// The recorder (as the view feeds it): «В гарнизон» with the cart — the run record's `level`, `cart` and the sink `cart`.
{
  const local: KeyValueStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as unknown as KeyValueStore; })();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: defaultParams(), local, sessionStore: { getItem: () => null, setItem: () => undefined }, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const at = toOutskirts(5, CAMP, 4), step = rtEnterGarrison(at);
  assert(step.ok && step.run.cart && step.run.cart.n > 0, 'a deposit');
  rec.runStarted(null, at);
  rec.runStep(at, step);
  await new Promise(resolve => setTimeout(resolve, 20));
  const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run' && r.seed === at.seed).pop()!;
  const cartSpent = Object.values(record.resources?.spent.cart ?? {}).reduce((x, y) => x + y, 0);
  assert(record.level === 2 && record.levelCleared === 1 && record.cart?.n === step.run.cart.n && record.cart.before === step.run.cart.before && cartSpent === step.run.cart.n,
    `the run record: ${JSON.stringify({ level: record.level, levelCleared: record.levelCleared, cart: record.cart, spent: record.resources?.spent })}`);
  assert(checkRecord(record) === null, `the record passes (${checkRecord(record)})`);
  // The flag of the moat off (the game now): a run in the garrison still gets its level and the level passed; no cart.
  const plainAt = toOutskirts(6, { ...CAMP, moat: false }), plainStep = rtEnterGarrison(plainAt);
  assert(plainStep.ok && !plainStep.run.moat && plainStep.run.cart === undefined, 'no cart without the moat');
  rec.runStarted(null, plainAt);
  rec.runStep(plainAt, plainStep);
  await new Promise(resolve => setTimeout(resolve, 20));
  const plain = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run' && r.seed === plainAt.seed).pop()!;
  assert(plain.level === 2 && plain.levelCleared === 1 && plain.cart === undefined && !plain.resources?.spent.cart, `without the moat: ${JSON.stringify({ level: plain.level, levelCleared: plain.levelCleared, cart: plain.cart })}`);
  rec.dispose();
  checks++; console.log('ok - telemetry: the recorder writes the run level and the level passed (with the moat flag off too), the cart and the deposit under the sink `cart`');
}
check('the default of the game: a new run takes `moat` by `RT_GARRISON_MOAT_ON` (off until the ui view: the garrison without «Ров» and the cart)', () => {
  const run = createRtRun(seedOf(1));
  assert(run.garrison === true && run.moat === (RT_GARRISON_MOAT_ON ? true : undefined), JSON.stringify({ on: RT_GARRISON_MOAT_ON, garrison: run.garrison, moat: run.moat }));
});

console.log(`garrison moat: ${checks} checks passed`);
