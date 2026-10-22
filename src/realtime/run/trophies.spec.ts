/**
 * Task 51е «Трофеи на стене лагеря», core (docs/design-notes/task-51-camp-l3.md, sections 4, 8.1, 10 and 12). Node only:
 * `npm run test:realtime-trophies`. Whole runs walked by the run's own commands (metaWalk.testkit.ts; a fight's outcome fed back as the
 * view builds it), the profile as the view keeps it (`createRtProfileStore` with the trophies and the chronicle on):
 * - every trophy by a real run (the Jailer won, his weight severed, the Troll won, shackles cut, the garrison passed, «Испытание» with the
 *   forest passed — a mark a step, the forest's bestiary full in the chronicle, a chain of 12+); «Котелок Главаря» not before the Chief is
 *   in the run («Последний рубеж» is no boss); the viewer's run of each, the end's list, the same end twice — once;
 * - «Чернильница Неясыти» earned stays when a later build adds a forest kind (not earned again, not lost);
 * - a run with a given seed and «Поход дня» earn nothing; the retro gives only the Castellan's banner and «Чернильница Неясыти», run 0, once;
 * - the trophies off — no field; a profile before the first trophy reads and writes byte for byte; the field is the meta's last key and
 *   reads strictly; the telemetry's field, `checkRecord` and the report's section.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { seedOf, walkRun, type Walk, type WalkOptions } from './metaWalk.testkit';
import { createRtProfileStore, parseRtProfile, RT_PROFILE_STORAGE_KEY, type RtProfileStore, type RunStorage } from './rtRunStorage';
import { parseRtMeta } from './rtMeta';
import { createRtRun, RT_FOREST_SHOOTERS_ON, RT_FOREST_TRICKS_ON, type RtArenaOutcome, type RtRunState } from './rtRun';
import { RT_DAILY_PRESET } from './rtDaily';
import { FINAL_ARENA } from './arenaPools';
import { garrisonArenaKinds, garrisonStep2Mode, rtGarrisonNodeId } from './garrison';
import { JAILER_RUN_ARENAS, TROLL_RUN_ARENAS } from '../sim/arenasBoss';
import { SCHEDULE_KINDS } from './schedule';
import { rtBestiaryFull, RT_TROPHY_LONG_CHAIN, type RtTrophy } from './trophies';
import { chronicleForestKinds, RT_CHRONICLE_FOREST_KINDS } from './chronicleCatalog';
import { RtRecorder } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { checkRecord, type RunRecord } from '../telemetry/schema';
import { trophiesSection } from '../telemetry/report';
import { defaultParams } from '../sim/params';

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const text = (storage: { data: Map<string, string> }): string => storage.data.get(RT_PROFILE_STORAGE_KEY) ?? '';
const store = (storage: RunStorage = memoryStorage(), on = true): RtProfileStore => createRtProfileStore(storage, { trophies: on, chronicle: true });
const held = (s: RtProfileStore, id: string): RtTrophy | undefined => s.trophies().find(t => t.id === id);
/** A meta run of the store: started (the viewer's run number), walked with the camp's flags. */
function metaRun(s: RtProfileStore, k: number, create: Record<string, unknown> = {}, extra: Partial<WalkOptions> = {}): { walk: Walk; viewerRun: number } {
  const viewerRun = s.startRun().run;
  const walk = walkRun({ k, create: { gift: 'full', garrison: false, chronicle: true, locked: s.locked(), hearth: s.hearthStart(seedOf(k)).flags, ...create }, ...extra });
  return { walk, viewerRun };
}
/** The fight at `nodeId` brings the keymaster (a garrison arena of his: the only one whose shackles a dash may cut). */
const keymaster = (run: RtRunState, nodeId: string, arena: string): boolean =>
  !!rtGarrisonNodeId(nodeId) && garrisonArenaKinds(arena, run.step2 ? garrisonStep2Mode(nodeId) : !!run.moat).includes('keymaster');
/** A won fight's outcome as the view builds it, with `extra` (the chain's longest, the shackles cut). */
const fed = (run: RtRunState, extra: Partial<RtArenaOutcome>): RtArenaOutcome => ({ nodeId: run.pending!.kind === 'battle' ? run.pending!.nodeId : '', won: true, hp: run.maxHp, kills: 20, damage: 0, time: 60, ...extra });

await check('every trophy by a real run, with the viewer\'s run; «Доска Испытания» a mark a step; the end lists the new; the same end twice — once', () => {
  const s = store();
  const seen: Record<string, number> = {}, facts = new Set<string>(), marks = new Set<number>();
  let finalStand = 0;
  for (let k = 1; k <= 12; k++) {
    // Seed by seed: odd ones sever the Jailer's weight (the walk's default); every 3rd passes the garrison; «Испытание» on some.
    const ash = k % 4 === 0 ? 2 : k % 4 === 1 ? 5 : 0;
    let cut = false, longest = false;
    // Garrison runs keep to the Troll's branch («Ров» with the keymaster is on it).
    const den = k % 3 === 0 ? { pickNode: (_run: RtRunState, ids: readonly string[]) => ids.find(id => id.includes('den')) ?? null } : {};
    const { walk, viewerRun } = metaRun(s, k, { garrison: k % 3 === 0, ...ash ? { ash } : {} }, { ...den, fight: run => {
      const pending = run.pending!.kind === 'battle' ? run.pending! : undefined;
      // A fight with the keymaster: the dash cut his shackles (`cuts`); the 3rd fight: a chain of 12 links (`bestChain`).
      if (pending && !cut && keymaster(run, pending.nodeId, pending.arena)) { cut = true; return fed(run, { cuts: 1 }); }
      if (pending && !longest && run.battles.length === 2 && k % 2 === 0) { longest = true; return fed(run, { bestChain: RT_TROPHY_LONG_CHAIN }); }
      return null;
    } });
    // The forest's kinds met in the run's fights (the view's calls), all of them by the 3rd run (the build's chapter: task 57а, 11 with the shooters).
    if (k <= 3) s.chronicleMeet(walk.run, { kinds: RT_CHRONICLE_FOREST_KINDS.filter((_, i) => i % 3 === k - 1), affixes: [] });
    const before = s.trophies(), end = s.endRunMeta(walk.run)!;
    const after = s.trophies(), added = after.filter(t => !before.some(b => b.id === t.id));
    for (const t of added) { assert(t.run === viewerRun, `seed ${k}: ${t.id} in run ${viewerRun}`); seen[t.id] = (seen[t.id] ?? 0) + 1; }
    assert(same((end.trophies ?? []).filter(e => !e.mark || !before.some(b => b.id === 'ash')).map(e => e.id), added.map(t => t.id)), `seed ${k}: the end's list ${JSON.stringify(end.trophies)}`);
    const r = walk.run;
    // What the runs did so far, from their own records — the trophies held are exactly these (nothing more, nothing less).
    if (r.battles.some(b => b.won && JAILER_RUN_ARENAS.includes(b.arena))) facts.add('jailer');
    if (r.battles.some(b => b.severed)) facts.add('severed');
    if (r.battles.some(b => b.won && TROLL_RUN_ARENAS.includes(b.arena))) facts.add('troll');
    if (cut) facts.add('shackles');
    if (r.result?.outcome === 'victory' && r.garrisonLevel) facts.add('castellan');
    if (longest) facts.add('long-chain');
    if (k >= 3) facts.add('bestiary');
    if (ash && (r.result?.outcome === 'victory' || r.garrisonLevel)) { facts.add('ash'); marks.add(ash); }
    assert(same(s.trophies().map(t => t.id).sort(), [...facts].sort()), `seed ${k}: held ${s.trophies().map(t => t.id)} ≠ done ${[...facts]}`);
    assert(same(held(s, 'ash')?.marks ?? [], [...marks].sort((a, b) => a - b)), `seed ${k}: the marks`);
    if (r.battles.some(b => b.won && b.arena === FINAL_ARENA)) finalStand++;
    // The same end again: the same result, no second trophy.
    const stored = JSON.stringify(s.trophies());
    assert(same(s.endRunMeta(walk.run), end) && JSON.stringify(s.trophies()) === stored, `seed ${k}: the same end twice`);
  }
  for (const id of ['jailer', 'severed', 'troll', 'shackles', 'castellan', 'ash', 'bestiary', 'long-chain']) assert(seen[id] === 1, `${id} earned once (${JSON.stringify(seen)})`);
  assert(!held(s, 'chief') && finalStand >= 1, `no «Котелок Главаря» before the Chief is in the run («Последний рубеж» won ${finalStand} times)`);
  assert(same(held(s, 'ash')!.marks, [2, 5]) && held(s, 'bestiary')!.run === 3, `«Доска Испытания» ${JSON.stringify(held(s, 'ash'))}, the bestiary in run 3`);
});

await check('«Чернильница Неясыти» stays when the forest gains a kind (the catalogue of a later build): held, not earned again, not lost', () => {
  const s = store();
  const { walk } = metaRun(s, 1);
  s.chronicleMeet(walk.run, { kinds: RT_CHRONICLE_FOREST_KINDS, affixes: [] });
  s.endRunMeta(walk.run);
  const ink = held(s, 'bestiary');
  assert(ink && ink.run === 1, `the chapter full: the trophy (${JSON.stringify(s.trophies())})`);
  // A later build: the forest's chapter gains a kind (task 57б) — the chapter is not full any more.
  const forest = RT_CHRONICLE_FOREST_KINDS as string[];
  forest.push('later-kind');
  try {
    const next = metaRun(s, 2);
    const end = s.endRunMeta(next.walk.run)!;
    assert(!(end.trophies ?? []).some(t => t.id === 'bestiary') && same(held(s, 'bestiary'), ink), `kept as it was, not earned again (${JSON.stringify(end.trophies)})`);
    assert(s.trophiesImport() && !s.trophiesImport() && same(held(s, 'bestiary'), ink), 'the retro (its mark once) adds nothing, removes nothing');
    assert(s.chronicle().pages.find(p => p.id === 'bestiary')!.chapters.find(ch => ch.id === 'forest')!.entries.some(e => e.id === 'later-kind' && e.state === 'unknown'), 'the chapter shows the new kind «?»');
  } finally { forest.pop(); }
});

await check('task 57а: with the flag of the shooters on (the build since 22.10.2026) the eight kinds of before and a wisp met earlier do not fill the chapter — it shows eleven, «Чернильница» needs them all and comes in the run that meets the last; with the flag off the eight are enough (design 21.10.2026)', () => {
  // Task 57б (RT_FOREST_TRICKS_ON on since 22.10.2026): the build's chapter — fifteen with the mechanics.
  assert(RT_FOREST_SHOOTERS_ON && RT_FOREST_TRICKS_ON && RT_CHRONICLE_FOREST_KINDS.length === 15, 'the build: the fifteen forest kinds');
  const storage = memoryStorage(), s = store(storage);
  const { walk } = metaRun(s, 1);
  // The viewer met every forest kind of before and a wisp.
  s.chronicleMeet(walk.run, { kinds: [...SCHEDULE_KINDS, 'wisp'], affixes: [] });
  s.endRunMeta(walk.run);
  assert(!held(s, 'bestiary'), `nine of fifteen: no trophy (${JSON.stringify(s.trophies())})`);
  const kinds = () => createRtProfileStore(storage, { trophies: true, chronicle: true }).chronicle().pages.find(p => p.id === 'bestiary')!.chapters.find(ch => ch.id === 'forest')!.entries;
  assert(JSON.parse(text(storage)).meta.chronicle.kinds.includes('wisp'), 'the wisp stays in the profile (read back from storage)');
  assert(kinds().length === 15 && kinds().find(e => e.id === 'wisp')?.state === 'seen' && kinds().find(e => e.id === 'slinger')?.state === 'unknown', 'the chapter of this build: fifteen, the wisp met, the slinger «?»');
  const profile = parseRtProfile(text(storage));
  assert(rtBestiaryFull({ kinds: profile.meta?.chronicle?.kinds }, chronicleForestKinds(false)) && !rtBestiaryFull({ kinds: profile.meta?.chronicle?.kinds }), 'the flag off: the eight are enough; the build needs the fifteen');
  const next = metaRun(s, 2);
  s.chronicleMeet(next.walk.run, { kinds: ['slinger', 'hive', 'rootling', 'slime', 'firebrand', 'centipede'], affixes: [] });
  s.endRunMeta(next.walk.run);
  const ink = held(s, 'bestiary');
  assert(ink && ink.run === 2 && kinds().every(e => e.state === 'seen'), `the fifteen met: the trophy in run 2 (${JSON.stringify(s.trophies())})`);
});

await check('a run with a given seed and «Поход дня» earn nothing; the trophies off — no field ever', () => {
  const storage = memoryStorage(), s = store(storage);
  const seeded = walkRun({ k: 1, create: { gift: 'full', garrison: true, seeded: true } });
  const daily = walkRun({ k: 2, seed: seedOf(2), create: { ...RT_DAILY_PRESET, schedule: [], garrison: true } });
  assert(daily.run.seeded && seeded.run.battles.some(b => b.won), 'real runs');
  assert(s.endRunMeta(seeded.run) === null && s.endRunMeta(daily.run) === null && !text(storage).includes('trophies'), 'no trophy, no write');
  const offStorage = memoryStorage(), off = store(offStorage, false);
  for (let k = 1; k <= 4; k++) off.endRunMeta(metaRun(off, k, { garrison: k === 3 }).walk.run);
  assert(!off.trophiesImport() && !text(offStorage).includes('trophies') && same(off.trophies(), []), 'off: nothing');
});

await check('the retro: only the Castellan\'s banner (`wonLevel` 2) and «Чернильница Неясыти» (the chronicle\'s bestiary from the history), run 0, once', () => {
  const storage = memoryStorage();
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, giftFull: true, runs: 9, won: true, seen: [...RT_CHRONICLE_FOREST_KINDS, 'elite'],
    meta: { heroes: { cat: { xp: 300, packs: [], record: { row: 4, won: true, xp: 90, level: 2, wonLevel: 2 }, ashBest: 4 } }, freed: { toad: { row: 5, run: 2 } } } }));
  const s = store(storage);
  const plain = text(storage);
  s.chronicleImport({ kinds: [], affixes: [] });
  assert(s.trophiesImport() && same(s.trophies(), [{ id: 'castellan', run: 0 }, { id: 'bestiary', run: 0 }]), `the retro ${JSON.stringify(s.trophies())}`);
  const once = text(storage);
  assert(!s.trophiesImport() && text(storage) === once, 'once');
  assert(plain !== once && !s.trophies().some(t => t.id === 'jailer' || t.id === 'ash'), 'no Jailer (Ведунья freed), no «Доска» (ashBest): not known for sure');
  // A forest win only: no banner; nothing to add — no write.
  const old = memoryStorage();
  old.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, giftFull: true, runs: 3, won: true, meta: { heroes: { cat: { xp: 90, packs: [], record: { row: 10, won: true, xp: 60, wonLevel: 1 } } } } }));
  const before = text(old);
  const oldStore = store(old);
  assert(oldStore.trophiesImport() && same(oldStore.trophies(), []) && oldStore.load().meta?.trophiesSince === 3 && !text(old).includes('"trophies":'), 'nothing known: no trophy, only the mark');
  assert(text(old) !== before && !oldStore.trophiesImport(), 'the mark: once');
});

await check('the retro once (review 21.10.2026): the forest filled by the fights of a run not ended yet gives the trophy at that run\'s end, with its number', () => {
  const storage = memoryStorage(), s = store(storage);
  // The first camp after the release: the chronicle's and the trophies' retro (nothing old) — the marks.
  s.chronicleImport({ kinds: [], affixes: [] });
  assert(s.trophiesImport() && s.load().meta?.trophiesSince === 0 && same(s.trophies(), []), 'the retro\'s mark, nothing found');
  // A run whose fights meet every forest kind; the camp opens before its end (a reload, an abandoned run): no retro trophy.
  const { walk, viewerRun } = metaRun(s, 2);
  s.chronicleMeet(walk.run, { kinds: RT_CHRONICLE_FOREST_KINDS, affixes: [] });
  assert(!s.trophiesImport() && same(s.trophies(), []), 'after the mark: the retro adds nothing');
  s.endRunMeta(walk.run);
  assert(same(held(s, 'bestiary'), { id: 'bestiary', run: viewerRun }) && viewerRun >= 1, `the trophy with the run\'s number ${JSON.stringify(s.trophies())}`);
  // Even a first retro does not count the kinds of a run in progress (its fresh ones): they are that run's.
  const t = store();
  const run = metaRun(t, 3).walk.run;
  t.chronicleImport({ kinds: [], affixes: [] });
  t.chronicleMeet(run, { kinds: RT_CHRONICLE_FOREST_KINDS, affixes: [] });
  assert(t.trophiesImport() && same(t.trophies(), []), 'a first retro: no run 0 for the kinds of a run in progress');
  t.endRunMeta(run);
  assert(held(t, 'bestiary')?.run === 1, 'its end gives it');
});

await check('a profile before the first trophy reads and writes byte for byte; the field is the meta\'s last key, reads back and reads strictly', () => {
  const a = memoryStorage(), b = memoryStorage();
  const on = store(a), off = store(b, false);
  for (const s of [on, off]) { s.startRun(); s.markLine('owl:first'); s.buyHearth('owl', 1); s.hearthStart(seedOf(5)); }
  assert(text(a) === text(b) && !text(a).includes('trophies'), 'no trophy yet: byte for byte');
  const storage = memoryStorage(), s = store(storage);
  const { walk } = metaRun(s, 1);
  s.chronicleMeet(walk.run, { kinds: ['wolf'], affixes: [] });
  s.endRunMeta(walk.run);
  // The stored string is the canonical one (the order `parseRtMeta` reads back in): `trophies` the meta's last key.
  const stored = JSON.parse(text(storage)).meta, keys = Object.keys(stored);
  assert(JSON.stringify(stored) === JSON.stringify(parseRtMeta(JSON.parse(JSON.stringify(stored)))) && keys[keys.length - 1] === 'trophies' && keys.indexOf('chronicle') < keys.indexOf('trophies'), `the stored keys: ${keys}`);
  s.trophiesImport();
  const marked = JSON.parse(text(storage)).meta, markedKeys = Object.keys(marked);
  assert(JSON.stringify(marked) === JSON.stringify(parseRtMeta(JSON.parse(JSON.stringify(marked)))) && same(markedKeys.slice(-2), ['trophiesSince', 'trophies']), `after the retro: ${markedKeys}`);
  const meta = s.load().meta!;
  assert(same(parseRtMeta(JSON.parse(JSON.stringify(meta)))!.trophies, meta.trophies), 'reads back');
  const read = (trophies: unknown) => parseRtMeta({ heroes: {}, trophies })!.trophies;
  assert(same(read([{ id: 'jailer', run: 3 }, { id: 'jailer', run: 4 }, { id: 'nope', run: 1 }, { id: 'troll', run: -1 }, { id: 'ash', run: 2, marks: [9, 3, 3, 0, 1] }, { id: 'castellan', run: 1.5 }, 'x', { id: 'ash', run: 5, marks: [2] }]),
    [{ id: 'jailer', run: 3 }, { id: 'ash', run: 2, marks: [1, 3] }]), 'garbage dropped');
  for (const empty of [[], {}, 'x', null, [{ id: 'ash', run: 1, marks: [] }]]) assert(read(empty) === undefined && !('trophies' in parseRtMeta({ heroes: {}, trophies: empty })!), `empty or malformed: no field (${JSON.stringify(empty)})`);
});

await check('telemetry: the run record\'s `trophies` (a mark as `ash:<step>`), `checkRecord`, the report\'s section «Трофеи»', async () => {
  const local: KeyValueStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as unknown as KeyValueStore; })();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: defaultParams(), local, sessionStore: { getItem: () => null, setItem: () => undefined }, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const s = store();
  const { walk } = metaRun(s, 1, { ash: 3 });
  rec.runStarted(null, createRtRun(walk.run.seed, { garrison: false, gift: 'full' }));
  const end = s.endRunMeta(walk.run)!;
  rec.runMetaEnd(walk.run, end);
  await new Promise(resolve => setTimeout(resolve, 20));
  const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run').pop()!;
  assert(end.trophies?.length && same(record.trophies, end.trophies.map(t => (t.id === 'ash' ? `ash:${t.mark}` : t.id))) && record.trophies!.includes('ash:3'), `the record ${JSON.stringify(record.trophies)}`);
  assert(checkRecord(record) === null && checkRecord({ ...record, trophies: [] }) !== null && checkRecord({ ...record, trophies: [1] } as unknown as RunRecord) !== null, 'checkRecord');
  const section = trophiesSection([{ ...record, viewerRun: 4 }, { ...record, viewerRun: 8, at: '2099-01-01T00:00:00.000Z' }]);
  assert(['Гиря Тюремщика', 'Доска Испытания', 'Засечки', '3 — 2'].every(w => section.includes(w)) && trophiesSection([]).includes('нет'), section);
  rec.dispose();
});

console.log(`realtime-trophies: ${checks} checks passed`);
