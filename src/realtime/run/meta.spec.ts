/**
 * Task 36 «Опыт героя, открытия, рекорд глубины» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md; docs/realtime-slice.md,
 * «Мета: опыт, открытия, лагерь»). Node only: `npm run test:realtime-meta`. Whole runs walked by the run's own commands (enter, the
 * arena fed back, every screen chosen — metaWalk.testkit.ts), the meta applied by the profile store as the view applies it:
 * - a run without the meta flags walks byte for byte as before the task (24 seeds, every state and offer: meta.reference.ts);
 * - XP of real runs: a victory, a death at the Jailer, a death on run row 8, «Испытание» II (×1.2, rounded down); the parts are the
 *   run's won fights by node; at most one pack a run, the rest clipped to the next threshold − 1; the record;
 * - the locked items never appear in any pool of a meta run (40 seeds; every source seen: «Застава», the chest, the feat, events'
 *   reward battles, the gift, the merchant, the Jailer's hammer and oath screens, the events), while the same seeds without the
 *   flag do offer them; the pools' minimums (the hard offer's rare place, 3 hammers, the oath screen's 3);
 * - a seeded run: no flags kept, no meta; a second call for the same run returns the same; saves round-trip, malformed ones read
 *   as no run; «✦ новое»; the telemetry fields.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. Measured numbers are printed (heuristics, no claim on balance).
 */
import { META_REFERENCE } from './meta.reference';
import { REFERENCE_WALKS, seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtNode, rtOathSlots, serializeRtRun, type RtRunState } from './rtRun';
import { createRtProfileStore, rtIsNewOffer, type RunStorage } from './rtRunStorage';
import { RT_META_LOCKABLE, RT_META_PACKS, RT_META_THRESHOLDS } from './metaCatalog';
import { rtRunDepth, RT_XP_BATTLE, RT_XP_ELITE, RT_XP_FEAT, RT_XP_FINAL, RT_XP_JAILER, RT_XP_VICTORY } from './rtMeta';
import { runRow } from './arenaPools';
import { rtTalisman, rtTalismanEligible, RT_TALISMANS } from './rtTalismans';
import { HAMMER_IDS } from '../sim/buildIds';
import { checkRecord, runKey, runRecordId, sessionKey } from '../telemetry/schema';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const ALL = [...RT_META_LOCKABLE];
const meta = (k: number, extra: Partial<WalkOptions> = {}, create: Parameters<typeof createRtRun>[1] = {}): WalkOptions =>
  ({ k, create: { gift: k % 2 ? 'full' : 'mini', feats: true, locked: ALL, ...create }, ...extra });
const rowOf = (run: RtRunState): number => { const p = run.pending as { nodeId?: string } | null; return p?.nodeId ? runRow(rtNode(run, p.nodeId)!.row) : 0; };
/** Expected XP of a run by the spec's table (the run's won fights by node type, feats done in won fights, the victory). */
function expectedBase(run: RtRunState): number {
  let xp = run.result?.outcome === 'victory' ? RT_XP_VICTORY : 0;
  for (const record of run.battles.filter(entry => entry.won)) {
    const type = rtNode(run, record.nodeId)!.type;
    xp += type === 'checkpoint' ? RT_XP_JAILER : type === 'boss' ? RT_XP_FINAL : type === 'hard' || type === 'breakthrough' ? RT_XP_ELITE : RT_XP_BATTLE;
    if (record.feat?.done) xp += RT_XP_FEAT;
  }
  return xp;
}

check('a run without the meta flags walks byte for byte as before the task (24 seeds: every state, every offer, the result)', () => {
  for (const options of REFERENCE_WALKS()) {
    const walk = walkRun(options), got = `${walk.digest.toString(16)}:${walk.steps}:${walk.run.result?.outcome ?? 'open'}:${[...walk.offered].sort().join(',').length}`;
    assert(got === META_REFERENCE[options.k], `seed ${options.k}: ${got} ≠ ${META_REFERENCE[options.k]}`);
    assert(walk.run.locked === undefined && walk.run.heroId === undefined && walk.run.hearth === undefined, `seed ${options.k}: no meta fields`);
  }
});

check('a seeded run keeps no meta flags (its pools are those of before) and gives no meta; the profile is byte for byte the same', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let k = 1; k <= 6; k++) {
    const plain = walkRun({ k, create: { gift: 'full', seeded: true } }), flagged = walkRun({ k, create: { gift: 'full', seeded: true, locked: ALL, hearth: { jailerRerolls: 1, hammerAll: true } } });
    assert(flagged.digest === plain.digest && flagged.run.locked === undefined && flagged.run.hearth === undefined, `seed ${k}: a seeded run ignores the flags`);
    const before = storage.data.get('ashen-oath-rt-profile-v1') ?? null;
    assert(store.endRunMeta(flagged.run) === null, `seed ${k}: no meta for a seeded run`);
    assert((storage.data.get('ashen-oath-rt-profile-v1') ?? null) === before, `seed ${k}: the profile untouched`);
  }
  assert(same(store.load(), { version: 1, giftFull: false }), 'an empty profile still');
});

check('XP of real runs: a victory, a death at the Jailer, a death on run row 8, «Испытание» II (×1.2 down); parts are the won fights by node', () => {
  const measured: Record<string, number[]> = { victory: [], jailer: [], row8: [], ash2: [] };
  for (let k = 1; k <= 12; k++) {
    const cases: [string, WalkOptions][] = [
      ['victory', meta(k)],
      ['jailer', meta(k, { loseAt: (_run, type) => type === 'checkpoint' })],
      ['row8', meta(k, { loseAt: run => rowOf(run) >= 8 })],
      ['ash2', meta(k, {}, { ash: 2 })],
    ];
    for (const [name, options] of cases) {
      const walk = walkRun(options), store = createRtProfileStore(memoryStorage()), end = store.endRunMeta(walk.run)!;
      const base = expectedBase(walk.run), level = walk.run.ash ?? 0, want = Math.floor(base * (10 + level) / 10);
      assert(end.xp.gained === want, `seed ${k} ${name}: XP ${end.xp.gained}, the table says ${want} (base ${base}, level ${level})`);
      assert(end.xp.parts.reduce((sum, part) => sum + part.xp, 0) === end.xp.gained, `seed ${k} ${name}: the parts add up`);
      if (name === 'victory') assert(walk.run.result?.outcome === 'victory' && end.xp.parts.some(p => p.id === 'final') && end.xp.parts.some(p => p.id === 'victory') && end.xp.parts.some(p => p.id === 'jailer'), `seed ${k}: the victory's parts`);
      if (name === 'jailer') assert(walk.run.result?.outcome === 'defeat' && rtNode(walk.run, walk.run.result.nodeId)!.type === 'checkpoint' && !end.xp.parts.some(p => p.id === 'jailer' || p.id === 'victory'), `seed ${k}: the death at the Jailer`);
      if (name === 'row8') assert(walk.run.result?.outcome === 'defeat' && rtRunDepth(walk.run) >= 8 && end.record.after.row === rtRunDepth(walk.run), `seed ${k}: the death on row ${rtRunDepth(walk.run)}`);
      if (name === 'ash2') assert(walk.run.ash === 2 && (end.xp.parts.find(p => p.id === 'ash')?.xp ?? 0) === want - base, `seed ${k}: «Испытание» II adds ${want - base}`);
      measured[name].push(end.xp.gained);
    }
  }
  const range = (list: number[]): string => `${Math.min(...list)}–${Math.max(...list)} (mean ${Math.round(list.reduce((a, b) => a + b, 0) / list.length)})`;
  console.log(`  measured 15.10.2026 (12 seeds, the walk): victory ${range(measured.victory)}, death at the Jailer ${range(measured.jailer)}, death on row 8 ${range(measured.row8)}, «Испытание» II victory ${range(measured.ash2)}`);
});

check('at most one pack a run; the rest carried, clipped to the next threshold − 1; the record and «новый рекорд»; the same result on a reload', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  const opened: string[] = [];
  for (let n = 0; n < 8; n++) {
    const walk = walkRun(meta(n + 1, {}, { locked: store.locked(), ash: 5 }));
    const before = store.load().meta?.heroes.cat?.xp ?? 0, end = store.endRunMeta(walk.run)!;
    const index = opened.length;
    assert(end.xp.before === before, `run ${n}: before ${end.xp.before}`);
    if (index < RT_META_PACKS.length && before + end.xp.gained >= RT_META_PACKS[index].at) {
      assert(end.pack?.id === RT_META_PACKS[index].id, `run ${n}: the pack ${RT_META_PACKS[index].id} opens (got ${end.pack?.id})`);
      opened.push(end.pack.id);
    } else assert(end.pack === null, `run ${n}: no pack`);
    const next = RT_META_PACKS[opened.length];
    if (next) assert(end.xp.after <= next.at - 1 && end.xp.after === Math.min(before + end.xp.gained, next.at - 1), `run ${n}: clipped to ${next.at - 1} (${end.xp.after})`);
    assert(same(end.thresholds, RT_META_THRESHOLDS) && (next ? end.nextPack?.id === next.id && end.nextPack.at === next.at && end.nextPack.size === next.items.length : end.nextPack === null), `run ${n}: the next pack`);
    assert(same(store.locked(), RT_META_LOCKABLE.filter(id => !RT_META_PACKS.filter(pack => opened.includes(pack.id)).some(pack => pack.items.some(item => item.id === id)))), `run ${n}: the locked list follows the packs`);
    // A reload of the end screen: the same result, nothing applied twice.
    const text = storage.data.get('ashen-oath-rt-profile-v1');
    assert(same(store.endRunMeta(walk.run), end) && storage.data.get('ashen-oath-rt-profile-v1') === text, `run ${n}: a second call is the same`);
  }
  assert(opened.length >= 3, `packs opened over 8 victories at «Испытание» V: ${opened.join(',')}`);
  // The record: a later death closer to the start is no new record.
  const lost = walkRun(meta(30, { loseAt: run => rowOf(run) >= 2 }, { locked: store.locked() }));
  const end = store.endRunMeta(lost.run)!;
  assert(end.record.before?.won === true && end.record.before.row === 10 && !end.record.beaten && end.record.after.row === 10 && end.record.after.won, `the record stays: ${JSON.stringify(end.record)}`);
});

check('a first run sets the record; a run that goes farther beats it, one that does not — not', () => {
  const store = createRtProfileStore(memoryStorage());
  const first = walkRun(meta(3, { loseAt: run => rowOf(run) >= 4 })).run, a = store.endRunMeta(first)!, depth = rtRunDepth(first);
  assert(depth >= 4 && a.record.before === null && a.record.after.row === depth && a.record.beaten, JSON.stringify(a.record));
  const b = store.endRunMeta(walkRun(meta(4, { loseAt: run => rowOf(run) >= 1 })).run)!;
  assert(!b.record.beaten && b.record.after.row === depth, JSON.stringify(b.record));
  const farther = walkRun(meta(5, { loseAt: run => rowOf(run) > depth })).run, c = store.endRunMeta(farther)!;
  assert(c.record.beaten && c.record.after.row === rtRunDepth(farther) && c.record.after.row > depth && c.record.before?.row === depth, JSON.stringify(c.record));
});

check('locked items never appear in any pool of a meta run (40 seeds, every source seen); the same seeds without the flag offer them', () => {
  const sources = new Map<string, number>(), hit = (name: string) => sources.set(name, (sources.get(name) ?? 0) + 1);
  const unlockedOffers = new Set<string>();
  for (let k = 1; k <= 40; k++) {
    const options = meta(k, {
      circle: true, loseAt: undefined,
      each: run => {
        const p = run.pending;
        if (p?.kind === 'talisman') hit(`talisman:${p.source}`);
        if (p?.kind === 'hammer') { hit('hammer'); assert(p.options.length === 3, `seed ${k}: 3 of 3 hammers (${p.options})`); }
        if (p?.kind === 'gift') hit('gift');
        if (p?.kind === 'shop') hit('shop');
        if (p?.kind === 'event') hit('event');
        if (p?.kind === 'casino') hit('circle');
        if (p?.kind === 'talisman' && p.source === 'hard') assert(rtTalisman(p.options[0])?.rarity === 'rare', `seed ${k}: the hard offer's rare place (${p.options})`);
        if (p?.kind === 'talisman' && p.source === 'oath' && !p.rerolls) {
          // The oath and relic screen shows as many as are left (3 at the start), never a locked one, never fewer than it can.
          const pool = { taken: run.talismans, gone: [...run.talismansGone, ...ALL] }, left = RT_TALISMANS.filter(def => (def.rarity === 'oath' || def.rarity === 'relic') && rtTalismanEligible(def.id, pool)).length;
          assert(p.options.length === Math.min(rtOathSlots(run, p.nodeId), left) && left <= 3, `seed ${k}: the oath screen shows ${p.options.length} of ${left} left (${p.options})`);
        }
        assert(parseRtRun(serializeRtRun(run)) !== null, `seed ${k}: the meta run's save reads back`);
      },
    }, { schedule: k % 4 === 0 ? [] : undefined });
    const walk = walkRun(options);
    const leak = [...walk.offered].filter(id => ALL.includes(id));
    assert(!leak.length, `seed ${k}: locked offered — ${leak.join(', ')}`);
    for (const id of walkRun({ ...options, create: { ...options.create, locked: undefined }, each: undefined }).offered) if (ALL.includes(id)) unlockedOffers.add(id);
  }
  for (const source of ['talisman:hard', 'talisman:chest', 'talisman:feat', 'talisman:event', 'talisman:oath', 'hammer', 'gift', 'shop', 'event', 'circle']) assert((sources.get(source) ?? 0) > 0, `the walk saw the source ${source}`);
  assert(unlockedOffers.size >= 8, `without the flag the same walks offer locked items (${[...unlockedOffers].join(', ')})`);
  console.log(`  sources seen: ${[...sources].map(([name, n]) => `${name} ${n}`).join(', ')}; without the flag offered ${unlockedOffers.size} of ${ALL.length} lockable`);
});

check('the pools\' minimums with everything locked: common 3, uncommon 3, rare 3, relics 2 (+ the oath), hammers 3', () => {
  const left = (rarity: string) => RT_TALISMANS.filter(def => def.rarity === rarity && !ALL.includes(def.id)).length;
  assert(left('common') >= 3 && left('uncommon') >= 3 && left('rare') >= 3, `common ${left('common')}, uncommon ${left('uncommon')}, rare ${left('rare')}`);
  assert(left('relic') + left('oath') === 3, `the oath screen's candidates ${left('relic') + left('oath')}`);
  assert(HAMMER_IDS.filter(id => !ALL.includes(id)).length === 3, 'hammers 3');
  for (const pack of RT_META_PACKS) for (const item of pack.items) assert(item.kind === 'event' || item.kind === 'hammer' ? true : !!rtTalisman(item.id), `${item.id} is in the catalogue`);
});

check('saves: a meta run round-trips; malformed meta fields read as no run', () => {
  const run = createRtRun(seedOf(7), { gift: 'mini', locked: ALL, hearth: { jailerRerolls: 1 } });
  const text = serializeRtRun(run);
  assert(same(parseRtRun(text), run) && run.heroId === 'cat', 'round-trip');
  const bad = (change: (value: Record<string, unknown>) => void, what: string) => {
    const value = JSON.parse(text) as Record<string, unknown>; change(value);
    assert(parseRtRun(JSON.stringify(value)) === null, `${what} reads as no run`);
  };
  bad(v => { v.locked = ['no-such']; }, 'an unknown locked id');
  bad(v => { v.locked = [...ALL].reverse(); }, 'an unsorted locked list');
  bad(v => { delete v.locked; }, 'a hero without locked');
  bad(v => { v.seeded = true; }, 'a seeded run with locked');
  bad(v => { v.heroId = 'dog'; }, 'an unknown hero');
  bad(v => { v.hearth = { jailerRerolls: 9 }; }, 'a malformed hearth');
  bad(v => { v.jailerRerolled = 2; }, 'more Jailer rerolls than given');
  const plain = createRtRun(seedOf(7), { gift: 'mini' });
  bad(v => { for (const key of Object.keys(v)) delete v[key]; Object.assign(v, JSON.parse(serializeRtRun(plain)), { hearth: { hammerAll: true } }); }, 'a hearth without locked');
  assert(parseRtRun(serializeRtRun(plain)) !== null, 'the plain run reads');
});

check('«✦ новое»: an opened item until it is offered; a locked or a base item never', () => {
  const store = createRtProfileStore(memoryStorage());
  for (let k = 1; !store.load().meta?.heroes.cat?.packs.length && k < 10; k++) store.endRunMeta(walkRun(meta(k, {}, { ash: 5 })).run);
  const profile = store.load();
  assert(profile.meta?.heroes.cat?.packs[0] === 'hunter', 'pack 1 opened');
  assert(rtIsNewOffer(profile, 'elite-hunter') && store.isNewOffer('bone-wheel'), 'opened items are new');
  assert(!rtIsNewOffer(profile, 'prism') && !rtIsNewOffer(profile, 'whetstone'), 'a locked or a base item is not');
  assert(store.markOffered(['elite-hunter', 'whetstone']) && !store.isNewOffer('elite-hunter') && store.isNewOffer('finishing-blow'), 'marked once');
  assert(!store.markOffered('elite-hunter'), 'nothing more to mark');
});

check('telemetry: the run record\'s meta fields pass `checkRecord`; malformed ones are refused', () => {
  const store = createRtProfileStore(memoryStorage()), end = store.endRunMeta(walkRun(meta(2)).run)!;
  const session = sessionKey(Date.UTC(2026, 9, 15), 7), runId = runKey(Date.UTC(2026, 9, 15), 1);
  const header = { schema: 1, id: runRecordId(session, runId), kind: 'run', session, run: runId, build: 'b', at: '2026-10-15T00:00:00Z', params: { storage: 'p', hash: 'h' } };
  const base = { ...header, seed: 1, outcome: 'victory', farRow: 10, death: null, nodes: [], choices: [], fights: [], kit: {}, runParams: {} };
  const schemaOk = checkRecord(base);
  assert(schemaOk === null, `a record without the meta fields passes (${schemaOk})`);
  const full = { ...base, xp: { gained: end.xp.gained, before: end.xp.before, after: end.xp.after, parts: end.xp.parts }, pack: 'hunter', record: { row: 10, won: true, beaten: true }, locked: 14,
    carry: end.carry, stock: end.stock, hearthBuys: [{ npc: 'owl', level: 1, price: 4 }], npcClicks: { owl: 2 }, hearth: { maps: 2, map: 1, startItems: ['bomb'], jailerRerolls: 1, hammerAll: true }, quest: { npc: 'owl', id: 'owl-farther', done: true } };
  assert(checkRecord(full) === schemaOk, `the meta fields pass (${checkRecord(full)})`);
  for (const [field, value] of [['xp', { gained: -1 }], ['carry', { n: 1, share: 0.3, cap: 20, resources: 1 }], ['hearthBuys', [{ npc: 'owl', level: 0, price: 4 }]], ['quest', { npc: 'owl' }], ['locked', -1]] as const) {
    assert(checkRecord({ ...full, [field]: value }) === 'run meta', `${field} malformed is refused`);
  }
});

console.log(`${checks} checks passed`);
