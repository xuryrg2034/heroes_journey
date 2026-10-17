/**
 * Task 51 «Лагерь, этап 3», step 51а (docs/design-notes/task-51-camp-l3.md, sections 2.1, 3.1, 8.1; docs/realtime-slice.md, «Лагерь,
 * этап 3»): the camp's catalogue and profile — levels 0–3, the gate of level 3, the ids `gambler` and `monk`, the quests done by NPC,
 * the first garrison passed. Node only: `npm run test:realtime-hearth-l3`. Whole runs walked by the run's own commands
 * (metaWalk.testkit.ts), the profile as the view keeps it (`createRtProfileStore`):
 * - a profile of v1 (real runs, upgrades bought) reads byte for byte; stored levels 3 and Шиш's / Евлампий's levels read, malformed ones drop;
 * - level 3 is not sold before a hero passed the forest (`gate`) and is sold after (16); not before level 2; Евлампий's 3rd is `locked`;
 *   Шиш and Евлампий are `absent` until they come;
 * - the quest done counts for its NPC (`done`); the garrison passed the first time for the profile — `last.firstGarrison`, once.
 * The death causes of the garrison (`guardroom`, `castellan`) are task 48б's (trollRun.spec.ts). Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { seedOf, walkRun } from './metaWalk.testkit';
import { createRtProfileStore, parseRtProfile, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { RT_HEARTH_PRICES } from './metaCatalog';
import { parseRtMeta, rtHearthGate3 } from './rtMeta';
import type { RtRunState } from './rtRun';

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

console.log(`hearth stage 3 (51а): ${checks} checks passed`);
