/**
 * Task 37 «Лагерь „Очаг“ v1» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md; docs/realtime-slice.md, «Мета: опыт,
 * открытия, лагерь»). Node only: `npm run test:realtime-hearth`. Whole runs walked by the run's own commands (metaWalk.testkit.ts),
 * the meta applied and the camp used through the profile store as the view uses them:
 * - the carry: a victory 100 %, a death 50 % (down) with the floor min(resources, 6), an abandoned run as a death, the cap 20;
 * - purchases and their refusals (the price and the stock; an NPC not in the camp; level 3 by the gate of task 51);
 * - the camp's flags on real runs: Марфа's start consumable, Ерофей's free reroll of the Jailer's hammer screen and of its oath and
 *   relic screen, «Полный верстак» (every hammer not locked), Неясыть's 2 and 3 maps (the chosen seed's forest the same);
 * - quests: counted by the real run, not counted without the condition; +10 XP and +3 stock outside the cap;
 * - Марфа and Ерофей come from the real event choice (and not from the other choices); the fallback after 3 quiet runs;
 * - the camp view, the lines' counter, the last run; the telemetry of the camp.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { generateForestMap } from '../forest/mapGenerator';
import { stockTotal } from '../forest/merchant';
import { ITEM_KINDS } from '../forest/items';
import { HAMMER_IDS } from '../sim/buildIds';
import { RT_META_LOCKABLE } from './metaCatalog';
import { seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtNode, rtRerollView, rtTrollNode, serializeRtRun, type RtRunState } from './rtRun';
import { rtHearthFlagsWith, RT_CARRY_CAP_PER_LEVEL, RT_QUEST_STOCK, RT_QUEST_XP } from './rtMeta';
import { createRtProfileStore, rtHearthStart, RT_PROFILE_STORAGE_KEY, type RtProfileStore, type RunStorage } from './rtRunStorage';
import { runRow } from './arenaPools';
import { RtRecorder } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import type { RunRecord } from '../telemetry/schema';
import { defaultParams } from '../sim/params';

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const rowOf = (run: RtRunState): number => { const p = run.pending as { nodeId?: string } | null; return p?.nodeId ? runRow(rtNode(run, p.nodeId)!.row) : 0; };
/** A meta run as the view makes it from the camp (`hearthStart` → `rtHearthFlagsWith`; the map chosen: `map`, the consumable: `item`). */
function campRun(store: RtProfileStore, k: number, extra: Partial<WalkOptions> = {}, choice: { map?: number; item?: (typeof ITEM_KINDS)[number] } = {}, locked = store.locked()): WalkOptions & { seed: number } {
  const start = store.hearthStart(seedOf(k)), seed = start.maps?.[choice.map ?? 0] ?? seedOf(k);
  return { k, seed, create: { gift: 'mini', feats: true, locked, hearth: rtHearthFlagsWith(start, choice.item) }, ...extra };
}
/** Profile stock set by real runs: victories with rich loot until the stock reaches `need`. */
function earn(store: RtProfileStore, need: number, from = 100): void {
  for (let k = from; store.hearth().stock < need && k < from + 20; k++) store.endRunMeta(walkRun(campRun(store, k, { loot: 4 })).run);
  assert(store.hearth().stock >= need, `stock ${store.hearth().stock} ≥ ${need}`);
}
/** A run (seed index from `from`) that meets `event` and takes `option` there; the walk steers to event nodes. */
function eventRun(store: RtProfileStore, event: string, option: string, from: number): { walk: ReturnType<typeof walkRun>; k: number } {
  for (let k = from; k < from + 400; k++) {
    let met = false;
    const walk = walkRun({ ...campRun(store, k), loseAt: undefined,
      pickNode: (run, ids) => ids.find(id => rtNode(run, id)!.type === 'event') ?? null,
      eventChoice: (id, open) => (id === event && open.includes(option) ? (met = true, option) : id === event ? null : null) });
    if (met) return { walk, k };
  }
  throw new Error(`no run met ${event}`);
}

await check('the carry: a victory 100 %, a death 50 % with the floor min(resources, 6), an abandoned run as a death, the cap 20 a level', () => {
  const cases: { name: string; options: WalkOptions; abandon?: boolean }[] = [];
  for (let k = 1; k <= 10; k++) {
    cases.push({ name: 'victory', options: { k, create: { gift: 'mini', locked: [] }, loot: 1 } }, { name: 'victory-rich', options: { k, create: { gift: 'mini', locked: [] }, loot: 5 } });
    cases.push({ name: 'death', options: { k, create: { gift: 'mini', locked: [] }, loot: 1 + (k % 4), loseAt: run => rowOf(run) >= 2 + (k % 6) } });
    cases.push({ name: 'abandoned', options: { k, create: { gift: 'mini', locked: [] }, loot: 1 + (k % 4), loseAt: undefined, pickNode: undefined }, abandon: true });
  }
  const seen = new Set<string>();
  for (const { name, options, abandon } of cases) {
    let run = walkRun(options).run;
    // An abandoned run: «Новый поход» over a run in progress — the run as it stood at row 5 (the walk replayed to there).
    if (abandon) {
      let at: RtRunState | null = null;
      walkRun({ ...options, each: state => { if (!at && !state.pending && state.visited.length >= 5) at = state; } });
      assert(at !== null && !(at as RtRunState).result, `${name} ${options.k}: an open run to abandon`);
      run = at;
    }
    const resources = stockTotal(run.materials), end = createRtProfileStore(memoryStorage()).endRunMeta(run)!;
    const want = run.result?.outcome === 'victory' ? Math.min(20, resources) : Math.min(20, Math.max(Math.floor(resources / 2), Math.min(resources, 6)));
    assert(end.carry.n === want && end.carry.resources === resources && end.carry.cap === RT_CARRY_CAP_PER_LEVEL && end.carry.share === (run.result?.outcome === 'victory' ? 1 : 0.5), `${name} ${options.k}: carry ${JSON.stringify(end.carry)}, want ${want}`);
    assert(end.stock.before === 0 && end.stock.after === want, `${name} ${options.k}: stock ${JSON.stringify(end.stock)}`);
    if (run.result?.outcome === 'victory' && resources > 20) seen.add('cap');
    if (run.result?.outcome !== 'victory' && resources > 0 && resources < 12 && want === Math.min(resources, 6) && want > Math.floor(resources / 2)) seen.add('floor');
    if (run.result?.outcome !== 'victory' && resources >= 12) seen.add('half');
    if (abandon) seen.add('abandoned');
    if (run.result?.outcome === 'victory' && resources <= 20) seen.add('full');
  }
  for (const what of ['cap', 'floor', 'half', 'abandoned', 'full']) assert(seen.has(what), `the cases saw «${what}» (${[...seen]})`);
});

await check('purchases: the next level for its price; a shortfall shows the price and the stock; an NPC not in the camp — refused; level 3 by the gate of task 51', () => {
  const store = createRtProfileStore(memoryStorage());
  store.endRunMeta(walkRun(campRun(store, 1, { loot: 1, loseAt: run => rowOf(run) >= 2 })).run);
  const have = store.hearth().stock;
  assert(have < 4, `a short first run (${have})`);
  assert(same(store.buyHearth('owl', 1), { ok: false, need: 4, have }), 'a shortfall: need 4');
  earn(store, 30);
  const stock = store.hearth().stock;
  assert(same(store.buyHearth('owl', 2), { ok: false, need: 8, have: stock, reason: 'level' }), 'level 2 before level 1');
  assert(store.buyHearth('owl', 1).ok && store.hearth().levels.owl === 1 && store.hearth().stock === stock - 4, 'owl 1 for 4');
  assert(store.buyHearth('owl', 2).ok && store.hearth().levels.owl === 2 && store.hearth().stock === stock - 12, 'owl 2 for 8');
  // Task 51 (stage 3): level 3 is sold once a hero passed the forest (`gate3`, test:realtime-hearth-l3); here the walks won it — 16.
  const gate = store.hearth().gate3, three = store.buyHearth('owl', 3);
  assert(gate ? three.ok || (!three.ok && three.need === 16 && three.reason === undefined) : !three.ok && three.reason === 'gate', `level 3 by the gate (${gate}): ${JSON.stringify(three)}`);
  assert(same(store.buyHearth('herb', 1), { ok: false, need: 4, have: store.hearth().stock, reason: 'absent' }), 'Марфа is not in the camp yet');
});

await check('Марфа and Ерофей come from the real event choice («Перевязать», «Заточка»), not from the other choices; the event and its stream unchanged', () => {
  const store = createRtProfileStore(memoryStorage());
  store.endRunMeta(walkRun(campRun(store, 1)).run);
  const leave = eventRun(store, 'wounded-cub', 'leave', 10);
  store.endRunMeta(leave.walk.run);
  assert(!store.hearth().met.herb, 'leaving the cub brings nobody');
  const cub = eventRun(store, 'wounded-cub', 'bandage', leave.k + 1);
  // The event's outcome is the run's own: a meta run with every pack open walks as the run without the meta and takes the same outcome.
  const steer = { pickNode: (run: RtRunState, ids: readonly string[]) => ids.find(id => rtNode(run, id)!.type === 'event') ?? null, eventChoice: (id: string, open: readonly string[]) => (id === 'wounded-cub' && open.includes('bandage') ? 'bandage' : null) };
  const choice = (run: RtRunState) => run.eventChoices.find(entry => run.picks.some(p => p.nodeId === entry.nodeId && p.eventId === 'wounded-cub'));
  let compared = 0;
  for (let k = 1; k <= 60; k++) {
    const open = walkRun({ k, create: { gift: 'mini', feats: true, locked: [] }, ...steer }).run, plain = walkRun({ k, create: { gift: 'mini', feats: true }, ...steer }).run;
    if (!choice(open)) continue;
    compared++;
    assert(same(choice(open), choice(plain)) && same(open.materials, plain.materials) && open.hp === plain.hp, `seed ${k}: the same outcome`);
  }
  assert(compared >= 3, `the cub met on ${compared} seeds`);
  store.endRunMeta(cub.walk.run);
  assert(store.hearth().met.herb && !store.hearth().self.herb, 'Марфа met by the event');
  const grinder = eventRun(store, 'wandering-grinder', 'grind', cub.k + 1);
  store.endRunMeta(grinder.walk.run);
  assert(store.hearth().met.smith && !store.hearth().self.smith, 'Ерофей met by the event');
});

await check('the fallback: an NPC not met comes by itself after 3 finished runs since the first camp — Марфа first, then Ерофей', () => {
  const store = createRtProfileStore(memoryStorage());
  const quiet = (k: number) => store.endRunMeta(walkRun({ ...campRun(store, k), eventChoice: () => 'leave', loseAt: run => rowOf(run) >= 3 }).run);
  quiet(1);
  quiet(2); quiet(3);
  assert(!store.hearth().met.herb, 'not after 2 runs');
  quiet(4);
  assert(store.hearth().met.herb && store.hearth().self.herb && !store.hearth().met.smith, 'Марфа after 3');
  quiet(5); quiet(6); quiet(7);
  assert(store.hearth().met.smith && store.hearth().self.smith, 'Ерофей 3 runs later');
});

await check('the camp\'s flags on real runs: Марфа\'s start consumable (L1 by the stream, L2 a choice of 2), Ерофей\'s free Jailer reroll and «Полный верстак», Неясыть\'s 2 and 3 maps', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  store.endRunMeta(walkRun(campRun(store, 1)).run);
  // Every NPC present (the profile as the fallback leaves it), stock earned by real runs.
  for (let k = 2; !store.hearth().met.smith; k++) store.endRunMeta(walkRun({ ...campRun(store, k, { loot: 4 }), eventChoice: () => 'leave' }).run);
  earn(store, 60, 200);
  assert(store.buyHearth('herb', 1).ok && store.buyHearth('smith', 1).ok && store.buyHearth('owl', 1).ok, 'level 1 of all');
  // L1: one kind by the stream `hearth-herb`, different over seeds; the run starts with it.
  const kinds = new Set<string>();
  for (let k = 1; k <= 12; k++) {
    const start = store.hearthStart(seedOf(k));
    assert(start.items?.length === 1 && start.maps?.length === 2 && start.maps[0] === seedOf(k) && start.maps[1] !== start.maps[0] && start.flags.maps === 2 && start.flags.jailerRerolls === 1 && !start.flags.hammerAll, `seed ${k}: L1 ${JSON.stringify(start)}`);
    kinds.add(start.items[0]);
    const run = createRtRun(start.maps[1], { gift: 'mini', locked: store.locked(), hearth: rtHearthFlagsWith(start) });
    const plain = createRtRun(start.maps[1], { gift: 'mini' });
    assert(run.items[start.items[0]] === plain.items[start.items[0]] + 1 && run.openItems.includes(start.items[0]), `seed ${k}: +1 «${start.items[0]}»`);
    assert(same(run.map, generateForestMap(start.maps[1])) && same(run.map, plain.map) && same(run.gift, plain.gift), `seed ${k}: the chosen seed's forest is the same`);
    assert(same(rtHearthStart(store.load(), seedOf(k)), start), 'the free function reads the same');
  }
  assert(kinds.size >= 3, `the kinds vary over seeds (${[...kinds]})`);
  // Ерофей L1: the hammer screen rerolls once free; the hammer not shown comes; the oath screen has no free reroll after it.
  for (let k = 1; k <= 6; k++) {
    let hammer: string[] | null = null, rerolled: string[] | null = null, oathFree = false;
    // Task 30: the hammer screen — a run without forms (`forms: false`); formsRun.spec.ts checks the form screen's free reroll.
    const camp = campRun(store, k, {}, {}, []);
    const walk = walkRun({ ...camp, create: { ...camp.create, forms: false }, jailerReroll: 'hammer', each: run => {
      if (run.pending?.kind === 'hammer' && !run.pending.rerolled) hammer = [...run.pending.options];
      if (run.pending?.kind === 'hammer' && run.pending.rerolled) rerolled = [...run.pending.options];
      if (run.pending?.kind === 'talisman' && run.pending.source === 'oath' && rtRerollView(run)) oathFree = true;
      assert(parseRtRun(serializeRtRun(run)) !== null, `seed ${k}: the save reads back`);
    } });
    assert(hammer && rerolled && (rerolled as string[]).length === 3 && HAMMER_IDS.some(id => !hammer!.includes(id) && rerolled!.includes(id)) && walk.run.jailerRerolled === 1 && !oathFree, `seed ${k}: the hammer reroll (${hammer} → ${rerolled})`);
  }
  // The same free reroll on the oath and relic screen (every relic open): price 0, resources kept.
  for (let k = 1; k <= 6; k++) {
    let free = false;
    walkRun({ ...campRun(store, k, {}, {}, []), jailerReroll: 'oath', each: run => {
      const view = run.pending?.kind === 'talisman' && run.pending.source === 'oath' ? rtRerollView(run) : null;
      if (view?.free && view.available) free = view.price === 0;
      if (run.pending?.kind === 'talisman' && run.pending.source === 'oath' && run.pending.rerolls) assert(run.jailerRerolled === 1 && !rtRerollView(run), `seed ${k}: one free reroll`);
    } });
    assert(free, `seed ${k}: the oath screen rerolled free`);
  }
  // L2: Ерофей's «Полный верстак» — every hammer not locked (4 with none locked, 3 with «Возврат» locked); Неясыть 3 maps; Марфа 2.
  earn(store, 24, 300);
  assert(store.buyHearth('smith', 2).ok && store.buyHearth('owl', 2).ok && store.buyHearth('herb', 2).ok, 'level 2 of all');
  for (let k = 1; k <= 6; k++) {
    const start = store.hearthStart(seedOf(k));
    assert(start.maps?.length === 3 && new Set(start.maps).size === 3 && start.items?.length === 2 && start.items[0] !== start.items[1] && start.flags.hammerAll, `seed ${k}: L2 ${JSON.stringify(start)}`);
    const chosen = start.items[1], run = createRtRun(start.maps[2], { gift: 'mini', locked: [], hearth: rtHearthFlagsWith(start, chosen) });
    assert(run.hearth?.startItems?.[0] === chosen && run.items[chosen] >= 1, `seed ${k}: the chosen consumable`);
    for (const [locked, size] of [[[], 4], [[...RT_META_LOCKABLE], 3]] as const) {
      let shown = 0;
      const camp = campRun(store, k, {}, {}, [...locked]);
      walkRun({ ...camp, create: { ...camp.create, forms: false }, each: run => { if (run.pending?.kind === 'hammer' && !run.pending.rerolled) shown = run.pending.options.length; } });
      assert(shown === size, `seed ${k}: «Полный верстак» shows ${shown}, want ${size}`);
    }
  }
});

await check('quests: counted by the real run and not without the condition; +10 XP and +3 stock outside the carry\'s cap; the next quest by the stream', () => {
  const store = createRtProfileStore(memoryStorage());
  store.endRunMeta(walkRun(campRun(store, 1, { loseAt: run => rowOf(run) >= 3 })).run);
  for (let k = 2; !store.hearth().met.smith; k++) store.endRunMeta(walkRun({ ...campRun(store, k, { loseAt: run => rowOf(run) >= 2 }), eventChoice: () => 'leave' }).run);
  const results: Record<string, { done: number; failed: number }> = {};
  const npcs = new Set<string>();
  for (let k = 40; k < 100; k++) {
    const quest = store.hearth().quest!;
    npcs.add(quest.npc);
    const record = store.load().meta!.heroes.cat!.record!;
    // The run either meets the condition or not: a sever or none, a long or a short run, items kept or used.
    const lose = k % 2 === 0 ? (run: RtRunState) => rowOf(run) >= 2 : undefined;
    const walk = walkRun({ ...campRun(store, k, { loseAt: lose, sever: k % 3 !== 0, loot: 6 }) });
    const run = walk.run, end = store.endRunMeta(run)!;
    const items = ITEM_KINDS.reduce((sum, kind) => sum + run.items[kind], 0), depth = end.record.after.row;
    const want = quest.id === 'herb-flasks' ? items >= 2 : quest.id === 'smith-sever' ? run.battles.some(b => b.severed) : quest.id === 'owl-forest' ? run.result?.outcome === 'victory' : Math.max(0, runRow(Math.max(0, ...[...run.visited, run.result?.nodeId ?? ''].map(id => rtNode(run, id)?.row ?? 0)))) > record.row;
    assert(end.quest?.id === quest.id && end.quest.done === want, `seed ${k}: quest ${quest.id} done ${end.quest?.done}, want ${want} (items ${items}, depth ${depth}, record ${record.row})`);
    assert(end.quest.xp === (want ? RT_QUEST_XP : 0) && end.quest.stock === (want ? RT_QUEST_STOCK : 0) && (end.xp.parts.some(p => p.id === 'quest') === want), `seed ${k}: the reward`);
    assert(end.stock.after === end.stock.before + end.carry.n + (want ? RT_QUEST_STOCK : 0), `seed ${k}: +3 outside the cap`);
    assert(store.hearth().last?.quest === want, `seed ${k}: the last run keeps the quest's result`);
    (results[quest.id] ??= { done: 0, failed: 0 })[want ? 'done' : 'failed']++;
  }
  for (const id of ['herb-flasks', 'smith-sever']) assert(results[id]?.done && results[id]?.failed, `${id} both ways (${JSON.stringify(results)})`);
  assert(results['owl-farther']?.failed || results['owl-forest']?.failed, `the owl's quest seen (${JSON.stringify(results)})`);
  assert(npcs.size === 3, `the quest comes from each NPC over seeds (${[...npcs]})`);
  // A run without the quest flag (made outside the camp) counts no quest.
  const end = store.endRunMeta(walkRun({ k: 7, create: { gift: 'mini', locked: store.locked() } }).run)!;
  assert(end.quest === undefined && store.hearth().last?.quest === undefined, 'no quest, no result');
});

await check('the camp view: the last run (cause, first win, pack, record), the bestiary, the lines\' counter', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  assert(!store.markLine('owl:first'), 'no camp before the first run');
  store.endRunMeta(walkRun(campRun(store, 3, { loseAt: (_run, type) => type === 'checkpoint' })).run);
  let view = store.hearth();
  assert(view.last?.won === false && view.last.cause === 'jailer' && view.last.row === 5 && view.last.beaten && view.quest?.npc === 'owl', `after the Jailer: ${JSON.stringify(view)}`);
  const lost = walkRun(campRun(store, 4, { loseAt: (_run, type) => type === 'boss' })).run;
  store.endRunMeta(lost);
  // Task 48: the den's boss is the Troll — its own cause.
  const boss = rtNode(lost, lost.battles[lost.battles.length - 1]!.nodeId)!;
  assert(store.hearth().last?.cause === (rtTrollNode(lost, boss) ? 'troll' : 'final'), `the final: ${store.hearth().last?.cause}`);
  const won = store.endRunMeta(walkRun(campRun(store, 5)).run)!;
  view = store.hearth();
  assert(view.last?.won && view.last.firstWin && view.last.cause === undefined && (view.last.pack === true) === !!won.pack, `the first win: ${JSON.stringify(view.last)}`);
  store.endRunMeta(walkRun(campRun(store, 6)).run);
  assert(store.hearth().last?.firstWin === undefined, 'the second win is not the first');
  assert(store.markLine('owl:first') && store.markLine('owl:first') && store.markLine('herb:death_jailer') && same(store.hearth().lines, { 'owl:first': 2, 'herb:death_jailer': 1 }), 'the lines count');
  store.meetSchedule(['wolf', 'archer', 'elite', 'cliff'], seedOf(99));
  assert(same(store.hearth().seen, ['wolf', 'archer']), `the bestiary: kinds only (${store.hearth().seen})`);
  // A profile reloaded from its text reads the same camp.
  assert(same(createRtProfileStore(storage).hearth(), store.hearth()) && JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!).meta.hearth.stock === store.hearth().stock, 'stored');
});

await check('telemetry: the run record gets the camp\'s flags, the map chosen, the meta end, purchases and NPC clicks', async () => {
  const local: KeyValueStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as unknown as KeyValueStore; })();
  const session = { getItem: () => null, setItem: () => undefined };
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: defaultParams(), local, sessionStore: session, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const store = createRtProfileStore(memoryStorage());
  store.endRunMeta(walkRun(campRun(store, 1)).run);
  earn(store, 8, 400);
  store.buyHearth('owl', 1);
  const options = campRun(store, 2, {}, { map: 1 }), start = store.hearthStart(seedOf(2));
  const run = createRtRun(options.seed, { garrison: false, ...options.create });
  rec.runStarted(null, run); rec.hearthMap(run, 1);
  const ended = walkRun(options).run, end = store.endRunMeta(ended)!;
  rec.runMetaEnd(ended, end); rec.hearthBuy(ended, 'owl', 2, 8); rec.hearthClick(ended, 'owl'); rec.hearthClick(ended, 'owl'); rec.hearthClick(ended, 'herb');
  await new Promise(resolve => setTimeout(resolve, 20));
  const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run' && r.seed === run.seed).pop()!;
  assert(record.locked === run.locked!.length && record.hearth?.maps === 2 && record.hearth.map === 1 && start.maps![1] === run.seed && record.quest?.npc === run.hearth!.quest!.npc, `the start: ${JSON.stringify({ locked: record.locked, hearth: record.hearth, quest: record.quest })}`);
  assert(record.xp?.gained === end.xp.gained && record.xp.before === end.xp.before && record.xp.after === end.xp.after && same(record.xp.parts, end.xp.parts) && same(record.carry, end.carry) && same(record.stock, end.stock) && record.record?.row === end.record.after.row && record.quest?.done === end.quest?.done, `the end: ${JSON.stringify(record.xp)}`);
  assert(same(record.hearthBuys, [{ npc: 'owl', level: 2, price: 8 }]) && same(record.npcClicks, { owl: 2, herb: 1 }), 'the camp');
  rec.dispose();
});

console.log(`${checks} checks passed`);
