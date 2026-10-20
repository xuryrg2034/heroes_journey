/**
 * Task 51 «Лагерь, этап 3», step 51а (docs/design-notes/task-51-camp-l3.md, sections 2.1, 3.1, 8.1; docs/realtime-slice.md, «Лагерь,
 * этап 3»): the camp's catalogue and profile — levels 0–3, the gate of level 3, the ids `gambler` and `monk`, the quests done by NPC,
 * the first garrison passed. Node only: `npm run test:realtime-hearth-l3`. Whole runs walked by the run's own commands
 * (metaWalk.testkit.ts), the profile as the view keeps it (`createRtProfileStore`):
 * - a profile of v1 (real runs, upgrades bought) reads byte for byte; stored levels 3 and Шиш's / Евлампий's levels read, malformed ones drop;
 * - level 3 is not sold before a hero passed the forest (`gate`) and is sold after (16); not before level 2; Евлампий's 3rd is `locked`;
 *   Шиш and Евлампий are `absent` until they come;
 * - the quest done counts for its NPC (`done`); the garrison passed the first time for the profile — `last.firstGarrison`, once.
 * 51б: «Путь в гарнизон» (2 garrison seeds, the choice gives the garrison), «Склянка в гарнизон» (the rule of three potions), «Правка в
 * гарнизоне» (the first reroll of a garrison screen free, once a run).
 * The death causes of the garrison (`guardroom`, `castellan`) are task 48б's (trollRun.spec.ts). Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { seedOf, walkRun } from './metaWalk.testkit';
import { createRtProfileStore, parseRtProfile, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { RT_HEARTH_PRICES } from './metaCatalog';
import { parseRtMeta, rtHearthGate3, rtHearthGateItems } from './rtMeta';
import { arenaSeed, parseRtRun, rtEnterGarrison, rtRerollTalismans, rtRerollView, rtGarrisonMaps, rtGarrisonSeed, rtGateView, serializeRtRun, type RtRunState } from './rtRun';
import { garrisonSeed } from './garrison';
import { generateForestMap } from '../forest/mapGenerator';
import { checkRecord, runKey, runRecordId, sessionKey } from '../telemetry/schema';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
/** A profile played: `n` cat runs of the forest (lost at its final when `lose`), the camp's upgrades bought as the stock allows. */
function played(n: number, lose: boolean, garrison = false): { storage: ReturnType<typeof memoryStorage>; store: ReturnType<typeof createRtProfileStore> } {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let k = 1; k <= n; k++) {
    store.startRun();
    const walk = walkRun({ k, create: { gift: 'full', garrison, locked: store.locked(), hearth: store.hearthStart(seedOf(k)).flags }, ...lose ? { loseAt: (_r: RtRunState, type: string) => type === 'boss' } : {} });
    store.endRun({ reachedJailer: true, seeded: false, won: walk.run.result?.outcome === 'victory' });
    store.endRunMeta(walk.run);
    for (const npc of ['owl', 'herb', 'smith'] as const) for (const level of [1, 2]) store.buyHearth(npc, level);
  }
  return { storage, store };
}

check('a profile of v1 (real runs, upgrades bought) reads byte for byte; levels 3 and Шиш\'s / Евлампий\'s read, malformed ones drop', () => {
  const { storage } = played(6, true), text = storage.data.get(RT_PROFILE_STORAGE_KEY)!;
  const stored = JSON.parse(text);
  assert(stored.meta.hearth.levels.owl >= 1 && JSON.stringify(parseRtProfile(text)) === text, 'the v1 profile');
  const h = stored.meta.hearth;
  h.levels = { owl: 3, herb: 2, smith: 1, gambler: 2, monk: 0 };
  h.met = { herb: true, smith: true, gambler: true, monk: 'yes' };
  h.done = { owl: 2, herb: 0, crow: 4 };
  const read = parseRtMeta(stored.meta)!.hearth!;
  assert(same(read.levels, { owl: 3, herb: 2, smith: 1, gambler: 2 }), `levels ${JSON.stringify(read.levels)}`);
  assert(same(read.met, { herb: true, smith: true, gambler: true }) && same(read.done, { owl: 2 }), `met ${JSON.stringify(read.met)}, done ${JSON.stringify(read.done)}`);
  h.levels = { owl: 5, herb: 2, smith: 1, gambler: 7 }; h.done = { herb: -1 };
  const bad = parseRtMeta(stored.meta)!.hearth!;
  assert(same(bad.levels, { owl: 0, herb: 2, smith: 1 }) && bad.done === undefined, `malformed ${JSON.stringify(bad)}`);
});

check('level 3: not sold before a hero passed the forest (`gate`), sold after for 16; not before level 2; Шиш and Евлампий absent until they come', () => {
  // Runs lost at the forest's final: stock enough, level 2 bought, the gate closed.
  const { storage, store } = played(14, true);
  const meta = store.load().meta!;
  assert(!rtHearthGate3(meta) && !store.hearth().gate3 && meta.hearth!.levels.owl === 2, 'the gate closed, level 2 bought');
  // Enough stock for level 3 (the profile's stock is the profile's; set it for the check of the gate only).
  const p = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!); p.meta.hearth.stock = 40; storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
  assert(same(store.buyHearth('owl', 3), { ok: false, need: 16, have: 40, reason: 'gate' }), 'gate');
  assert(store.buyHearth('gambler', 1).ok === false && (store.buyHearth('gambler', 1) as { reason?: string }).reason === 'absent' && (store.buyHearth('monk', 1) as { reason?: string }).reason === 'absent', 'Шиш, Евлампий absent');
  // A cat run that wins the forest opens the gate.
  const walk = walkRun({ k: 2, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: store.hearthStart(seedOf(2)).flags } });
  assert(walk.run.result?.outcome === 'victory', 'the forest won');
  store.endRunMeta(walk.run);
  const stock = store.hearth().stock;
  assert(store.hearth().gate3 && stock >= RT_HEARTH_PRICES[2], `gate open, stock ${stock}`);
  assert(store.buyHearth('owl', 3).ok && store.hearth().levels.owl === 3 && store.hearth().stock === stock - 16, 'level 3 bought for 16');
  assert((store.buyHearth('owl', 4) as { reason?: string }).reason === 'level', 'no level 4');
  // Level 3 before level 2: a profile whose smith has level 1 only.
  const q = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!); q.meta.hearth.levels.smith = 1; q.meta.hearth.met.monk = true; q.meta.hearth.stock = 99; storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(q));
  assert((store.buyHearth('smith', 3) as { reason?: string }).reason === 'level' && store.buyHearth('smith', 2).ok && store.buyHearth('smith', 3).ok, 'level by level');
  // Евлампий (here by a stored profile: his coming is step 51г): levels 1–2 sold, the 3rd locked whatever the gate.
  assert(store.buyHearth('monk', 1).ok && store.buyHearth('monk', 2).ok && (store.buyHearth('monk', 3) as { reason?: string }).reason === 'locked', 'Евлампий locked at 3');
  // A reload keeps it all.
  assert(same(createRtProfileStore(storage).hearth().levels, { gambler: 0, monk: 2, owl: 3, herb: 2, smith: 3 }), JSON.stringify(createRtProfileStore(storage).hearth().levels));
});

check('a quest done counts for its NPC (`done`); the garrison passed the first time for the profile — `last.firstGarrison`, once', () => {
  // Quests: every done one counts (real runs, the quest the camp gave).
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  const done: Record<string, number> = {};
  for (let k = 1; k <= 10; k++) {
    const flags = store.hearthStart(seedOf(k)).flags;
    const walk = walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: flags }, ...k % 3 === 0 ? { loseAt: (_r: RtRunState, type: string) => type === 'checkpoint' } : {} });
    const end = store.endRunMeta(walk.run)!;
    if (end.quest?.done) done[end.quest.npc] = (done[end.quest.npc] ?? 0) + 1;
    assert(same(store.hearth().done, done), `seed ${k}: ${JSON.stringify(store.hearth().done)} ≠ ${JSON.stringify(done)}`);
  }
  assert(Object.values(done).reduce((a, b) => a + b, 0) >= 3, `quests done ${JSON.stringify(done)}`);
  // The garrison: the first pass marks `firstGarrison`, the next one does not; a forest win does not.
  const g = createRtProfileStore(memoryStorage());
  const forest = walkRun({ k: 1, create: { gift: 'full', garrison: false, locked: g.locked() } });
  g.endRunMeta(forest.run);
  assert(forest.run.result?.outcome === 'victory' && g.hearth().last?.firstWin && !g.hearth().last?.firstGarrison, 'a forest win: no mark');
  const passes: boolean[] = [];
  for (const k of [2, 3]) {
    const walk = walkRun({ k, create: { gift: 'full', garrison: true, locked: g.locked() } });
    const end = g.endRunMeta(walk.run)!;
    assert(walk.run.result?.outcome === 'victory' && end.record.after.wonLevel === 2, `seed ${k}: the garrison passed`);
    passes.push(!!g.hearth().last?.firstGarrison);
  }
  assert(same(passes, [true, false]), `marks ${passes}`);
});

// ---------- 51б: level 3 of Неясыть, Марфа, Ерофей (spec 2.2) ----------

/** A profile whose camp has `levels` (the NPCs met) and a cat who passed the forest (the gate open): a stored profile as setup. */
function campL3(levels: { owl: number; herb: number; smith: number }): ReturnType<typeof createRtProfileStore> {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  const won = walkRun({ k: 2, create: { gift: 'full', garrison: false, locked: store.locked() } });
  store.endRunMeta(won.run);
  const p = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!);
  p.meta.hearth.levels = levels; p.meta.hearth.met = { herb: true, smith: true };
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
  assert(store.hearth().gate3, 'the gate open');
  return store;
}
/** A meta run of the store through the forest into the garrison; `gate` — the choices at «Предместье». */
function gateWalk(store: ReturnType<typeof createRtProfileStore>, k: number, extra: Partial<Parameters<typeof walkRun>[0]> = {}, create: Record<string, unknown> = {}): { run: RtRunState; atGate: RtRunState | null } {
  let atGate: RtRunState | null = null;
  const walk = walkRun({ k, create: { gift: 'full', garrison: true, locked: store.locked(), hearth: store.hearthStart(seedOf(k)).flags, ...create }, each: r => { if (r.pending?.kind === 'outskirts') atGate = r; }, ...extra });
  return { run: walk.run, atGate };
}

check('51б «Путь в гарнизон»: 2 different garrison seeds, the choice gives the garrison\'s map and node seeds; map 0 — the garrison of before; a run without it — as before', () => {
  let differentMaps = 0;
  for (let k = 1; k <= 12; k++) {
    const seeds = rtGarrisonMaps(seedOf(k));
    assert(seeds.length === 2 && seeds[0] === garrisonSeed(seedOf(k)) && seeds[0] !== seeds[1], `seed ${k}: ${seeds}`);
    if (JSON.stringify(generateForestMap(seeds[0])) !== JSON.stringify(generateForestMap(seeds[1]))) differentMaps++;
  }
  assert(differentMaps >= 10, `different maps on ${differentMaps} of 12 seeds`);
  const store = campL3({ owl: 3, herb: 0, smith: 0 });
  assert(store.hearthStart(seedOf(5)).flags.garrisonMaps === 2 && store.hearthStart(seedOf(5)).maps?.length === 3, 'level 3: «Путь в гарнизон» and the 3 forest maps of level 2');
  for (const map of [0, 1] as const) {
    const { run, atGate } = gateWalk(store, 5, { gate: () => ({ map }) });
    assert(atGate && same(rtGateView(atGate)?.maps, rtGarrisonMaps(atGate.seed)) && rtGateView(atGate)?.items === undefined, 'the gate shows 2 maps');
    const g = rtGarrisonMaps(run.seed)[map];
    assert(run.garrisonMap === map && rtGarrisonSeed(run) === g && same(run.garrisonLevel?.map, generateForestMap(g)), `map ${map}: the garrison's map of its seed`);
    const node = run.visited.find(id => id.startsWith('g:'))!;
    assert(node && arenaSeed(run, node) === arenaSeed({ seed: run.seed, garrisonMap: map }, node) && (map === 0) === (arenaSeed(run, node) === arenaSeed({ seed: run.seed }, node)), 'node seeds of the chosen garrison');
    assert(same(parseRtRun(serializeRtRun(run)), run), 'the save round-trips');
  }
  // A choice without the flag is refused; a run without it keeps no field and the garrison of before.
  const plain = gateWalk(createRtProfileStore(memoryStorage()), 5);
  assert(plain.atGate && !rtEnterGarrison(plain.atGate, undefined, { map: 1 }).ok && plain.run.garrisonMap === undefined && same(plain.run.garrisonLevel?.map, generateForestMap(garrisonSeed(plain.run.seed))), 'without the flag');
  // A tampered save: `garrisonMap` without the flag.
  const save = JSON.parse(serializeRtRun(plain.run)); save.garrisonMap = 1;
  assert(parseRtRun(JSON.stringify(save)) === null, 'refused');
});

check('51б «Склянка в гарнизон»: 2 kinds at «Предместье», one joins the hand; a healing one with a full hand is shown unavailable and refused', () => {
  const store = campL3({ owl: 0, herb: 3, smith: 0 });
  let full = 0, taken = 0;
  for (let k = 1; k <= 8; k++) {
    const flags = store.hearthStart(seedOf(k)).flags;
    assert(flags.gateItems?.length === 2 && flags.gateItems[0] !== flags.gateItems[1] && same(flags.gateItems, rtHearthGateItems(seedOf(k))) && store.hearthStart(seedOf(k)).items?.length === 2, `seed ${k}: 2 kinds; the forest's 2 of level 2`);
    // A hand of one potion with the cap 1: full, unless the walk drank it.
    const { atGate } = gateWalk(store, k, {}, { potionCap: 1 });
    if (!atGate) continue;
    const view = rtGateView(atGate)!, handFull = atGate.items.healing >= 1;
    for (const entry of view.items!) {
      assert(entry.available === !(entry.item === 'healing' && handFull), `seed ${k}: ${entry.item} available ${entry.available}, hand ${atGate.items.healing}`);
      const step = rtEnterGarrison(atGate, undefined, { item: entry.item });
      assert(step.ok === entry.available, `seed ${k}: taking ${entry.item}`);
      if (step.ok) { taken++; assert(step.run.items[entry.item] === atGate.items[entry.item] + 1 && step.run.gateItem === entry.item && step.run.openItems.includes(entry.item), 'in hand'); assert(same(parseRtRun(serializeRtRun(step.run)), step.run), 'save'); }
      else full++;
    }
  }
  assert(taken >= 8 && full >= 1, `taken ${taken}, refused for a full hand ${full}`);
  assert(createRtProfileStore(memoryStorage()).hearthStart(seedOf(1)).flags.gateItems === undefined, 'no flag below level 3');
});

check('51б «Правка в гарнизоне»: the first reroll of a garrison screen is free, once a run; the forest\'s screens and a run without level 3 pay', () => {
  let checked = 0, forestPaid = 0;
  for (let k = 1; k <= 40 && checked < 4; k++) {
    for (const smith of [2, 3]) {
      const store = campL3({ owl: 0, herb: 0, smith });
      assert((store.hearthStart(seedOf(k)).flags.garrisonRerolls === 1) === (smith === 3), 'the flag of level 3');
      // The first screen of «Застава» (hard) in the forest and in the garrison as the walk reached them (no reroll on the way).
      const screens: { forest?: RtRunState; garrison?: RtRunState } = {};
      gateWalk(store, k, { each: r => { const p = r.pending; if (p?.kind === 'talisman' && p.source === 'hard') { const key = p.nodeId.startsWith('g:') ? 'garrison' : 'forest'; screens[key] ??= r; } } });
      if (screens.forest) { const v = rtRerollView(screens.forest); assert(v && !v.free && v.price === 1, 'the forest pays'); forestPaid++; }
      const at = screens.garrison;
      if (!at) continue;
      const view = rtRerollView(at)!;
      if (smith === 2) { assert(!view.free && view.price === 1, `seed ${k}: pays without level 3`); continue; }
      assert(view.free && view.price === 0, `seed ${k}: free in the garrison`);
      if (!view.available) continue;
      const step = rtRerollTalismans(at);
      assert(step.ok && step.run.garrisonRerolled === 1 && step.run.jailerRerolled === at.jailerRerolled && same(step.run.materials, at.materials), `seed ${k}: free, the counter spent`);
      const next = rtRerollView(step.run)!;
      assert(!next.free && next.price === 2, `seed ${k}: the next one pays (${next.price})`);
      assert(same(parseRtRun(serializeRtRun(step.run)), step.run), 'the save round-trips');
      checked++;
    }
  }
  assert(checked >= 3 && forestPaid >= 3, `garrison screens rerolled free ${checked}, forest screens ${forestPaid}`);
});

check('51б telemetry: the run record\'s `hearth` takes level 3 (offered, chosen) and `checkRecord` passes it; malformed ones are refused', () => {
  const session = sessionKey(Date.UTC(2026, 9, 17), 7), runId = runKey(Date.UTC(2026, 9, 17), 1);
  const header = { schema: 1, id: runRecordId(session, runId), kind: 'run', session, run: runId, build: 'b', at: '2026-10-17T00:00:00Z', params: { storage: 'p', hash: 'h' } };
  const base = { ...header, seed: 1, outcome: 'victory', farRow: 10, death: null, nodes: [], choices: [], fights: [], kit: {}, runParams: {} };
  const hearth = { garrisonMaps: 2, garrisonMap: 1, gateItems: ['bomb', 'fire'], gateItem: 'fire', garrisonRerolls: 1 };
  assert(checkRecord({ ...base, hearth }) === null, `passes (${checkRecord({ ...base, hearth })})`);
  for (const bad of [{ garrisonMaps: 1 }, { garrisonMap: -1 }, { gateItems: [3] }, { gateItem: 2 }, { garrisonRerolls: 0 }]) assert(checkRecord({ ...base, hearth: { ...hearth, ...bad } }) === 'run meta', `refused ${JSON.stringify(bad)}`);
});

console.log(`hearth stage 3 (51а–51б): ${checks} checks passed`);
