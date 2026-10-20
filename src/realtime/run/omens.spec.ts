/**
 * Task 56 «Приметы», the run (run/omens.ts, rtRun.ts; spec docs/design-notes/task-56-omens.md, section 11.2; docs/realtime-slice.md,
 * «Приметы»). Node only: `npm run test:realtime-omens-run`.
 *
 * Every check walks runs by the run's own commands (run/metaWalk.testkit.ts: enter, the arena fed back, every screen chosen) and reads
 * what the player sees — the map's omens, the battle card, the fight's values, the merchant, the heal, the save:
 * - the share of the nodes with an omen among those that may have one (200 seeds, the forest and the garrison) is 25–30 %; none on run
 *   row 1, the checkpoint, the breakthrough, the boss, a node that is not a fight;
 * - every omen of the pool comes as a node's omen and as a level's omen where it may (60 seeds); seeds differ, a seed repeats;
 * - the card is the fight: the open battle's omens are its node's roll and its level's omen, its values and loadout carry them, its record
 *   keeps them; another path to the node — the same omen;
 * - the outputs of `forest/` are as before with the omens (300 seeds): the map, the node seeds, events and outcomes, the merchant (but
 *   «Ярмарочный день»'s extra place), the gift, the stream counters;
 * - the level's omen is written when the level starts (the forest at the creation, the garrison on entering it); not on the checkpoint,
 *   not on the boss;
 * - «Перепутье»: every node of the next row is open, the nodes further are hidden; a step off the links reads back only with it;
 * - «Ярмарочный день»: +1 consumable in the last place, the stock before it as it was; the heal on the map dearer by 1;
 * - the save: a run without the omens reads and writes as before; one with them reloads at every step; malformed fields — no run;
 * - the meta: the pool by the packs, the garrison and Шиш (the heroes together); the gates by «Расписание леса» or «Испытание» II, set once,
 *   kept by «Обучение»; a seeded run reads the pool and changes nothing;
 * - the telemetry: `omensOn`, `omenPool`, `levelOmens`, `omenRoutes` only where an omen stood among the nodes open; the report's section.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { generateGarrisonMap, garrisonNodes, rtGarrisonNodeId } from './garrison';
import { runRow } from './arenaPools';
import {
  arenaSeed, createRtRun, healOffer, rtShopReroll, rtShopRerollView, parseRtRun, rtArenaLoadout, rtArenaParams, rtArenaRules, rtAvailableNodes, rtCrossroadsHidden, rtFightOmens, rtLevelOmen, rtMapNodes, rtNode,
  rtNodeOmen, rtNodeOmenRoll, rtRunParams, serializeRtRun, type RtRunState,
} from './rtRun';
import { rtFairItem, rtLevelOmenRoll, rtOmen, rtOmenPool, rtPackOmen, RT_OMEN_IDS, RT_OMENS, RT_OMENS_START, type RtOmenId } from './omens';
import { garrisonSeed } from './garrison';
import { seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { createRtProfileStore, rtProfileOmenPool, RT_PROFILE_STORAGE_KEY, type RtProfile } from './rtRunStorage';
import { SCHEDULE_ARCS } from './schedule';
import { RT_META_PACKS } from './metaCatalog';
import { defaultParams, copyParams } from '../sim/params';
import type { Journal } from '../sim/simulation';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { checkRecord, type RunRecord } from '../telemetry/schema';
import { omensSection } from '../telemetry/report';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

const ALL: RtOmenId[] = [...RT_OMEN_IDS];
const FIGHT_OMENS = RT_OMENS.filter(def => def.where === 'fight').map(def => def.id);
const eligible = (node: { type: string; row: number }): boolean => (node.type === 'battle' || node.type === 'hard') && runRow(node.row) >= 2;
const garrisonOf = (seed: number) => garrisonNodes(generateGarrisonMap(seed));
const walk = (k: number, create: WalkOptions['create'], extra: Partial<WalkOptions> = {}) => walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', ...create }, ...extra });
const readsBack = (run: RtRunState, what: string): void => {
  const text = serializeRtRun(run), again = parseRtRun(text);
  assert(again && serializeRtRun(again) === text, `${what}: the save reads back`);
};
const bad = (run: unknown, what: string): void => assert(parseRtRun(JSON.stringify(run)) === null, `refused: ${what}`);

// ---- Share and place ----

await check('share and place: 200 seeds × the forest and the garrison — 25–30 % of the nodes that may have an omen have one; none elsewhere', () => {
  let may = 0, have = 0;
  const perMap: number[] = [];
  for (let k = 1; k <= 200; k++) {
    const run = createRtRun(seedOf(k), { omens: ALL, garrison: true });
    for (const nodes of [rtMapNodes(run), garrisonOf(run.seed)]) {
      let mapMay = 0, mapHave = 0;
      for (const node of nodes) {
        const omen = rtNodeOmenRoll(run, node);
        if (!eligible(node)) { assert(omen === undefined, `seed ${k}: an omen on ${node.type} row ${runRow(node.row)}`); continue; }
        mapMay++; if (omen) mapHave++;
        assert(!omen || rtOmen(omen)!.where === 'fight', `seed ${k}: a map omen on a node (${omen})`);
        assert(!omen || rtOmen(omen)!.levels.includes(rtGarrisonNodeId(node.id) ? 2 : 1), `seed ${k}: ${omen} off its level`);
      }
      may += mapMay; have += mapHave; perMap.push(mapMay ? mapHave / mapMay : 0);
    }
  }
  const share = have / may;
  assert(share >= 0.25 && share <= 0.3, `the share ${share.toFixed(3)} of ${may}`);
  const sorted = [...perMap].sort((a, b) => a - b);
  console.log(`   share ${(100 * share).toFixed(1)} % of ${may} nodes; per map: min ${(100 * sorted[0]).toFixed(0)} %, median ${(100 * sorted[sorted.length >> 1]).toFixed(0)} %, max ${(100 * sorted[sorted.length - 1]).toFixed(0)} %, maps without one ${perMap.filter(x => x === 0).length} of ${perMap.length}`);
});

// ---- Variety ----

await check('variety: on 60 seeds every omen of the pool comes as a node\'s omen and as a level\'s omen (where it may); seeds differ, a seed repeats', () => {
  const asNode = new Set<string>(), asLevel = new Set<string>(), sets = new Set<string>();
  for (let k = 1; k <= 60; k++) {
    const run = createRtRun(seedOf(k), { omens: ALL, garrison: true });
    const level1 = rtLevelOmen(run, 1), level2 = rtLevelOmenRoll(ALL, garrisonSeed(run.seed), 2);
    assert(level1 !== undefined && rtOmen(level1)!.levels.includes(1), `seed ${k}: the forest's omen ${level1}`);
    if (level1) asLevel.add(level1);
    if (level2) asLevel.add(level2);
    const ids = [...rtMapNodes(run), ...garrisonOf(run.seed)].map(node => rtNodeOmenRoll(run, node) ?? '-');
    for (const id of ids) if (id !== '-') asNode.add(id);
    sets.add(`${level1}|${ids.join(',')}`);
    const again = createRtRun(seedOf(k), { omens: ALL, garrison: true });
    assert(serializeRtRun(again) === serializeRtRun(run) && [...rtMapNodes(again), ...garrisonOf(run.seed)].map(node => rtNodeOmenRoll(again, node) ?? '-').join(',') === ids.join(','), `seed ${k}: the same seed — the same omens`);
  }
  for (const id of FIGHT_OMENS) assert(asNode.has(id), `«${rtOmen(id)!.title}» never a node's omen`);
  // The garrison's level omen is one of 11 (17.10.2026: «Перекличка» comes only there — 7 % of the garrisons on 600 seeds; seeds 1–60
  // happen to have none), so the levels are looked at on 60 more seeds.
  for (let k = 61; k <= 120; k++) { const id = rtLevelOmenRoll(ALL, garrisonSeed(seedOf(k)), 2); if (id) asLevel.add(id); }
  for (const id of ALL) assert(asLevel.has(id), `«${rtOmen(id)!.title}» never a level's omen`);
  assert(sets.size >= 55, `seeds give different omens (${sets.size} of 60)`);
});

// ---- The card is the fight ----

await check('the card is the fight (60 walks): the open battle\'s omens are its roll and its level\'s; its values and loadout carry them; its record keeps them', () => {
  let fights = 0, withOmen = 0;
  for (let k = 1; k <= 60; k++) {
    const seenAt = new Map<string, string>();
    walk(k, { omens: ALL, garrison: k % 2 === 0 }, {
      each: run => {
        const pending = run.pending;
        if (pending?.kind === 'battle') {
          fights++;
          const node = rtNode(run, pending.nodeId)!, expect = rtFightOmens(run, node);
          assert(JSON.stringify(pending.omens ?? {}) === JSON.stringify(expect), `seed ${k}: the card's omens ${JSON.stringify(pending.omens)} vs ${JSON.stringify(expect)}`);
          if (!eligible(node)) assert(!pending.omens?.node, `seed ${k}: a node's omen on ${node.type}`);
          if (node.type === 'checkpoint' || node.type === 'boss') assert(!pending.omens, `seed ${k}: an omen on ${node.type}`);
          const list = [...pending.omens?.level ? [pending.omens.level] : [], ...pending.omens?.node ? [pending.omens.node] : []];
          if (list.length) withOmen++;
          const rules = rtArenaRules(run), params = rtArenaParams(run, rtRunParams(defaultParams())), base = rtArenaParams({ ...run, pending: { ...pending, omens: undefined } }, rtRunParams(defaultParams()));
          assert(JSON.stringify(rules.omens ?? []) === JSON.stringify(list), `seed ${k}: the rules' omens`);
          assert(params.omenStorm === list.includes('storm') && params.omenDrowse === list.includes('drowse') && params.omenFlood === list.includes('flood') && params.omenRollcall === list.includes('rollcall') && params.bagResetAll === list.includes('harvest'), `seed ${k}: the keys follow the omens ${list}`);
          assert(params.focusMax === base.focusMax * (list.includes('moon') ? 1.5 : 1) && params.crystals === (list.includes('magpie') || base.crystals) && params.jumpCost === (list.includes('tailwind') ? 1 : base.jumpCost) && params.chainShieldMinKills === (list.includes('pale') ? 5 : base.chainShieldMinKills), `seed ${k}: the values follow the omens ${list}`);
          const loadout = rtArenaLoadout(run), plain = rtArenaLoadout({ ...run, pending: { ...pending, omens: undefined } });
          assert(JSON.stringify(loadout.omens ?? []) === JSON.stringify(list) && loadout.colors === (list.includes('pale') ? (plain.colors ?? 4) - 1 : plain.colors), `seed ${k}: the loadout's omens and colours (${loadout.colors})`);
          const was = seenAt.get(node.id);
          assert(was === undefined || was === JSON.stringify(pending.omens ?? {}), `seed ${k}: the node's omens changed`);
          seenAt.set(node.id, JSON.stringify(pending.omens ?? {}));
        }
        const last = run.battles[run.battles.length - 1];
        if (last) assert(JSON.stringify(last.omens ?? {}) === JSON.stringify(rtFightOmens(run, rtNode(run, last.nodeId)!)), `seed ${k}: the record's omens`);
      },
    });
    // Another path through the same map: the omens of a node do not depend on the path.
    walk(k, { omens: ALL, garrison: k % 2 === 0 }, {
      pickNode: (_run, ids) => ids[ids.length - 1],
      each: run => {
        if (run.pending?.kind !== 'battle') return;
        const was = seenAt.get(run.pending.nodeId);
        assert(was === undefined || was === JSON.stringify(run.pending.omens ?? {}), `seed ${k}: another path, another omen at ${run.pending.nodeId}`);
      },
    });
  }
  assert(withOmen > fights * 0.4, `fights with an omen ${withOmen} of ${fights}`);
});

// ---- The outputs of forest/ ----

/** A state without the omens' own fields (and the extra place of «Ярмарочный день»). */
function stripped(run: RtRunState): string {
  const copy = JSON.parse(serializeRtRun(run)) as Record<string, unknown> & { pending: Record<string, unknown> | null; battles: Record<string, unknown>[] };
  delete copy.omens; delete copy.crossroadsFree;
  if (copy.pending) delete copy.pending.omens;
  for (const record of copy.battles) delete record.omens;
  return JSON.stringify(copy);
}

await check('forest/ as before (300 seeds): the walk with the omens (without «Перепутье» and «Ярмарочный день») passes the same states but the omens\' own fields', () => {
  const pool = ALL.filter(id => id !== 'crossroads' && id !== 'fair');
  for (let k = 1; k <= 300; k++) {
    const plain: string[] = [], omen: string[] = [];
    walk(k, { garrison: k % 3 === 0 }, { each: run => plain.push(stripped(run)) });
    walk(k, { garrison: k % 3 === 0, omens: pool }, { each: run => omen.push(stripped(run)) });
    assert(plain.length === omen.length && plain.every((s, i) => s === omen[i]), `seed ${k}: the walks differ at ${plain.findIndex((s, i) => s !== omen[i])}`);
  }
});

// ---- The level's omen ----

await check('the level\'s omen: the forest\'s at the creation, the garrison\'s on entering it (its own seed); none on the checkpoint and the boss', () => {
  let garrisons = 0;
  for (let k = 1; k <= 30; k++) {
    const created = createRtRun(seedOf(k), { omens: ALL, garrison: true });
    assert(created.omens?.level?.[1] && created.omens.level[2] === undefined, `seed ${k}: the forest's omen at the creation, no garrison's (${JSON.stringify(created.omens)})`);
    walk(k, { omens: ALL, garrison: true }, {
      each: run => {
        if (run.garrisonLevel) {
          const id = run.omens!.level![2];
          assert(id === rtLevelOmenRoll(ALL, garrisonSeed(run.seed), 2) && rtLevelOmen(run) === id, `seed ${k}: the garrison's omen by its seed`);
          if (run.pending?.kind === 'battle' && !run.visited.some(v => rtGarrisonNodeId(v))) garrisons++;
        } else assert(run.omens!.level![2] === undefined, `seed ${k}: a garrison's omen before the garrison`);
        if (run.pending?.kind === 'battle') {
          const node = rtNode(run, run.pending.nodeId)!;
          if (node.type === 'checkpoint' || node.type === 'boss') assert(!run.pending.omens, `seed ${k}: an omen on the ${node.type}`);
          else if (rtOmen(rtLevelOmen(run)!)?.where === 'fight' && (rtLevelOmen(run) !== 'harvest' || rtGarrisonNodeId(node.id) || runRow(node.row) >= 2)) assert(run.pending.omens?.level === rtLevelOmen(run), `seed ${k}: the level's omen not on ${node.type} row ${runRow(node.row)}`);
        }
      },
    });
  }
  assert(garrisons > 0, 'some walks reached the garrison');
});

// ---- «Перепутье» ----

const seedWith = (id: RtOmenId, from = 1, pool: readonly RtOmenId[] = ALL): number => { for (let k = from; ; k++) if (rtLevelOmen(createRtRun(seedOf(k), { omens: pool })) === id) return k; };

await check('«Перепутье»: every node of the next row of its part is open; the nodes further are hidden (no type, no omen); a step off the links reads back only with it', () => {
  let off = 0;
  for (let n = 0, k = 0; n < 4; n++) {
    k = seedWith('crossroads', k + 1);
    const result = walk(k, { omens: ALL, garrison: false }, {
      pickNode: (run, ids) => {
        const linked = run.currentNodeId === null ? ids : rtNode(run, run.currentNodeId)!.next;
        return ids.find(id => !linked.includes(id)) ?? null;
      },
      each: run => {
        readsBack(run, `seed ${k}`);
        if (run.pending || run.result) return;
        const open = rtAvailableNodes(run), here = run.currentNodeId ? rtNode(run, run.currentNodeId)! : null;
        if (here && open.length && !open.some(node => ['checkpoint', 'breakthrough', 'boss'].includes(node.type)) && here.type !== 'checkpoint') {
          const part = (lane: string) => (lane === 'den' || lane === 'camp' ? lane : 'trails');
          const row = rtMapNodes(run).filter(node => node.row === here.row + 1 && part(node.lane) === part(here.lane) && !['checkpoint', 'breakthrough', 'boss'].includes(node.type));
          assert(row.every(node => open.some(o => o.id === node.id)), `seed ${k}: the next row is open`);
        }
        for (const node of rtMapNodes(run)) {
          const hidden = rtCrossroadsHidden(run, node), next = (here ? here.row : 4) + 1;
          assert(hidden === node.row > next, `seed ${k}: ${node.id} hidden ${hidden}`);
          if (hidden) assert(rtNodeOmen(run, node) === undefined, `seed ${k}: an omen shown beyond the next row`);
        }
      },
    });
    off += result.run.crossroadsFree ?? 0;
    const end = result.run;
    if (end.crossroadsFree) {
      bad({ ...end, omens: { ...end.omens!, level: { 1: 'moon' } } }, `seed ${k}: steps off the links without «Перепутье»`);
      bad({ ...end, crossroadsFree: end.crossroadsFree + 1 }, `seed ${k}: a wrong count of steps`);
      bad({ ...end, crossroadsFree: undefined }, `seed ${k}: no count`);
    }
  }
  assert(off > 0, 'the walks took steps off the links');
  // Without the omen the same pick stays on the links.
  const k = seedWith('moon');
  const plain = walk(k, { omens: ALL, garrison: false }, { pickNode: (run, ids) => { const linked = run.currentNodeId === null ? ids : rtNode(run, run.currentNodeId)!.next; return ids.find(id => !linked.includes(id)) ?? null; } });
  assert(!plain.run.crossroadsFree, 'no step off the links without «Перепутье»');
});

// ---- «Ярмарочный день» ----

await check('«Ярмарочный день»: +1 consumable in the last place (the stock before it as without the omen); the heal on the map dearer by 1', () => {
  let shops = 0, heals = 0;
  const pool = ALL.filter(id => id !== 'crossroads');
  for (let n = 0, k = 0; n < 8; n++) {
    k = seedWith('fair', k + 1, pool);
    const stocks: string[] = [];
    walk(k, { omens: pool, garrison: false }, {
      each: run => {
        if (run.pending?.kind === 'shop' && !run.pending.bought.length) {
          const items = run.pending.stock.items;
          assert(items[items.length - 1] === rtFairItem(arenaSeed(run, run.pending.nodeId), items.slice(0, -1)), `seed ${k}: the extra place`);
          stocks.push(JSON.stringify(items.slice(0, -1))); shops++;
        }
        if (!run.pending && !run.result && run.healMap) {
          const offer = healOffer(run), without = healOffer({ ...run, omens: { ...run.omens!, level: { 1: 'moon' } } });
          assert(offer.price === without.price + 1, `seed ${k}: the heal ${offer.price} vs ${without.price}`); heals++;
        }
      },
    });
    const plain: string[] = [];
    walk(k, { omens: ALL.filter(id => id !== 'crossroads' && id !== 'fair'), garrison: false }, { each: run => { if (run.pending?.kind === 'shop' && !run.pending.bought.length) plain.push(JSON.stringify(run.pending.stock.items)); } });
    assert(JSON.stringify(stocks.slice(0, plain.length)) === JSON.stringify(plain.slice(0, stocks.length)), `seed ${k}: the stock before the extra place ${stocks} vs ${plain}`);
  }
  assert(shops > 0 && heals > 0, `shops ${shops}, heals ${heals}`);
});

await check('«Ярмарочный день»: a free reroll at each merchant of the level (the extra place stays); with Шиш\'s the two add up; the saves read back, a reroll mark without the omen — no run', () => {
  const pool = ALL.filter(id => id !== 'crossroads');
  let fairShops = 0, both = 0;
  for (let n = 0, k = 0; n < 6; n++) {
    k = seedWith('fair', k + 1, pool);
    for (const shish of [false, true]) {
      const create = { omens: pool, garrison: false, ...shish ? { locked: [], hearth: { shopRerolls: 1 as const } } : {} };
      let shop: RtRunState | null = null;
      walk(k, create, { pickNode: (run, ids) => ids.find(id => rtNode(run, id)?.type === 'shop') ?? null, each: run => { if (!shop && run.pending?.kind === 'shop') shop = structuredClone(run); } });
      if (!shop) continue;
      const at: RtRunState = shop, view = rtShopRerollView(at)!;
      assert(view && view.available && view.fair === true, `seed ${k}: the omen's reroll is offered (${JSON.stringify(view)})`);
      const first = rtShopReroll(at);
      assert(first.ok, `seed ${k}: the reroll goes`);
      const after = first.run, pending = after.pending as Extract<RtRunState['pending'], { kind: 'shop' }>;
      const items = pending.stock.items;
      assert(items[items.length - 1] === rtFairItem(arenaSeed(after, pending.nodeId), items.slice(0, -1)) && after.fairRerolls?.[pending.nodeId] === 1 && !after.shopRerolled, `seed ${k}: the extra place after the reroll, the omen's reroll spent`);
      readsBack(after, `seed ${k}: after the omen's reroll`);
      fairShops++;
      const again = rtShopRerollView(after)!;
      if (!shish) assert(!again.available && again.reason === 'Перебросов не осталось', `seed ${k}: no second reroll without Шиш (${JSON.stringify(again)})`);
      else {
        assert(again.available && !again.fair, `seed ${k}: Шиш's reroll after the omen's`);
        const second = rtShopReroll(after);
        assert(second.ok && second.run.shopRerolled === true && (second.run.pending as { rerolls?: number }).rerolls === 2, `seed ${k}: the second reroll is Шиш's`);
        readsBack(second.run, `seed ${k}: after both rerolls`);
        bad({ ...second.run, shopRerolled: undefined }, `seed ${k}: two rerolls without Шиш's spent`);
        both++;
      }
      bad({ ...after, omens: { ...after.omens!, level: { 1: 'moon' } } }, `seed ${k}: the omen's reroll without the omen`);
      bad({ ...after, fairRerolls: undefined }, `seed ${k}: the visit's mark without the run's`);
    }
  }
  assert(fairShops >= 3 && both >= 1, `merchants with the omen ${fairShops}, with Шиш too ${both}`);
});

// ---- The save ----

await check('the save: every step of 40 omen walks reads back; malformed omen fields — no run', () => {
  for (let k = 1; k <= 40; k++) {
    const { run } = walk(k, { omens: ALL, garrison: k % 2 === 0 }, { each: state => readsBack(state, `seed ${k}`) });
    bad({ ...run, omens: { pool: ['moon', 'nonsense'] } }, 'an unknown omen');
    bad({ ...run, omens: { ...run.omens!, pool: [...run.omens!.pool].reverse() } }, 'the pool out of order');
    bad({ ...run, omens: { ...run.omens!, pool: [] } }, 'an empty pool');
    const other = ALL.find(id => id !== run.omens!.level![1] && rtOmen(id)!.levels.includes(1))!;
    bad({ ...run, omens: { ...run.omens!, level: { ...run.omens!.level, 1: other } } }, 'a level\'s omen not by its roll');
    const record = run.battles.findIndex(b => b.omens);
    if (record >= 0) bad({ ...run, battles: run.battles.map((b, i) => (i === record ? { ...b, omens: undefined } : b)) }, 'a record without its omens');
    const plainRecord = run.battles.findIndex(b => !b.omens);
    if (plainRecord >= 0) bad({ ...run, battles: run.battles.map((b, i) => (i === plainRecord ? { ...b, omens: { node: 'storm' } } : b)) }, 'a record with omens not rolled');
  }
  // A run without the pool saves byte for byte as before (no field).
  const plain = createRtRun(seedOf(1), { gift: 'mini' }), withEmpty = createRtRun(seedOf(1), { gift: 'mini', omens: [] });
  assert(serializeRtRun(plain) === serializeRtRun(withEmpty) && !('omens' in plain), 'no pool — no field');
});

// ---- Meta: the pool and the gates ----

const fakeStorage = () => { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; };

await check('meta: the pool — the four, the packs of any hero, the garrison, Шиш; the gates — «Расписание леса» or «Испытание» II, set once, kept by «Обучение»; `?seed=` changes nothing', () => {
  const profile = (extra: Partial<RtProfile> = {}): RtProfile => ({ version: 1, giftFull: false, ...extra });
  assert(JSON.stringify(rtProfileOmenPool(profile())) === JSON.stringify(RT_OMENS_START), 'the four at once');
  const packs = { heroes: { cat: { xp: 200, packs: ['hunter', 'return'] }, toad: { xp: 400, packs: ['frost'] } } };
  const pool = rtProfileOmenPool(profile({ meta: packs as never }));
  assert(JSON.stringify(pool) === JSON.stringify(['moon', 'magpie', 'tailwind', 'harvest', 'storm', 'drowse', 'crossroads']), `the packs of both heroes: ${pool}`);
  for (const pack of RT_META_PACKS) assert(rtPackOmen(pack.id)?.kind === 'omen', `pack ${pack.id} opens an omen`);
  const garrison = rtProfileOmenPool(profile({ meta: { heroes: { cat: { xp: 0, packs: [], record: { row: 3, won: true, xp: 0, level: 2 } } } } as never }));
  assert(garrison.includes('rollcall') && !garrison.includes('fair'), `the garrison opens «Перекличка» (${garrison})`);
  const gambler = rtProfileOmenPool(profile({ meta: { heroes: {}, hearth: { stock: 0, levels: { owl: 0, herb: 0, smith: 0 }, met: { gambler: true }, lines: {}, quiet: 0 } } as never }));
  assert(gambler.includes('fair'), `Шиш opens «Ярмарочный день» (${gambler})`);
  assert(JSON.stringify(rtOmenPool({ packs: [], garrison: false, gambler: false })) === JSON.stringify(RT_OMENS_START), 'the pure pool');

  const storage = fakeStorage(), store = createRtProfileStore(storage), arcs = SCHEDULE_ARCS.map(arc => arc.id);
  assert(store.omensStart({ ash: 0, history: arcs.slice(1), seeded: false }) === null && !store.load().omensOpen, 'closed before the schedule is done');
  assert(store.omensStart({ ash: 0, history: arcs, seeded: true }) !== null && !store.load().omensOpen, 'a seeded run reads the gates, writes nothing');
  assert(JSON.stringify(store.omensStart({ ash: 0, history: arcs, seeded: false })) === JSON.stringify(RT_OMENS_START) && store.load().omensOpen === true, 'the schedule done — open for good');
  store.resetSchedule();
  assert(store.omensStart({ ash: 0, history: [], seeded: false }) !== null, '«Обучение» keeps the gates open');
  const fresh = createRtProfileStore(fakeStorage());
  assert(fresh.omensStart({ ash: 2, history: [], seeded: false }) !== null && fresh.load().omensOpen === true, '«Испытание» II opens them');
  const text = storage.map.get(RT_PROFILE_STORAGE_KEY)!;
  assert(JSON.parse(text).omensOpen === true, 'the profile keeps the gates');
  // The pool is a snapshot: a pack opened mid-run does not change the run.
  const run = createRtRun(seedOf(4), { omens: RT_OMENS_START });
  const later = { ...run };
  assert(JSON.stringify(later.omens!.pool) === JSON.stringify(RT_OMENS_START), 'the run keeps its pool');
});

// ---- Telemetry ----

await check('telemetry: `omensOn`, `omenPool`, `levelOmens`, `omenRoutes` (only where an omen stood among the nodes open), `crossroadsSteps`; `checkRecord`; the report\'s section', async () => {
  const fake = (): KeyValueStore => {
    const map = new Map<string, string>();
    return { getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
  };
  const sessionFake = (): SessionStore => { const map = new Map<string, string>(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }; };
  const records: RunRecord[] = [];
  for (let k = 1; k <= 6; k++) {
    const local = fake();
    const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: copyParams(defaultParams() as unknown as Journal['params']), local, sessionStore: sessionFake(), channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
    let started = false, routes = 0;
    walk(k, { omens: ALL, garrison: false }, { onStep: (before, step) => {
      if (!started) { rec.runStarted(null, before); started = true; }
      if (!before.pending && !before.result && step.events.some(e => e.type === 'node-entered') && rtAvailableNodes(before).some(node => rtNodeOmen(before, node))) routes++;
      rec.runStep(before, step, { realSeconds: 1 });
    } });
    await new Promise(r => setTimeout(r, 10));
    const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run').pop()!;
    assert(record.omensOn === true && JSON.stringify(record.omenPool) === JSON.stringify(ALL) && record.levelOmens?.[0]?.level === 1, `seed ${k}: the run's omens ${JSON.stringify(record.levelOmens)}`);
    assert((record.omenRoutes?.length ?? 0) === routes && (record.omenRoutes ?? []).every(r => r.offered.some(o => o.omen) && r.offered.some(o => o.nodeId === r.chosen)), `seed ${k}: ${routes} route choices with an omen (${record.omenRoutes?.length})`);
    assert(checkRecord(record) === null, `seed ${k}: checkRecord ${checkRecord(record)}`);
    assert(checkRecord({ ...record, omensOn: undefined } as RunRecord) === 'run omens', 'the fields need the flag');
    records.push(record);
  }
  const section = omensSection(records, []);
  assert(/Примета уровня/.test(section) && /Маршрут/.test(section) && RT_OMENS.some(def => section.includes(def.title)), section);
});

console.log(`realtime-omens-run: ${checks} checks passed`);
