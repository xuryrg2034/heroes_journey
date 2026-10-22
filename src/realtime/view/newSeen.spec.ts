/**
 * П8 «Новое на карте» (view/newSeen.ts): the viewer's memory on a plain-object storage, the final caption texts, and the
 * kinds an arena brings — against what a simulation of the arena really spawns, and on the nodes of real run maps. Node
 * only: `npm run test:realtime-new-seen`. The end-to-end result (sign, caption, toggle, sandbox) is tests/realtime-new-seen.spec.ts.
 */
import { rtChooseKnack } from '../run/rtRun';
import { AFFIX_CAPTIONS, arenaKinds, KIND_CAPTIONS, NEW_SEEN_KEY, newKindsOfArena, NewSeenStore, type NewSeenStorage } from './newSeen';
import { Simulation } from '../sim/simulation';
import { defaultParams, type Params } from '../sim/params';
import { POOL_ROSTERS, ANCHOR_ROLES, ANCHOR_ARENAS } from '../sim/rosters';
import { createRtRun, arenaPreview, isArenaNode, rtAvailableNodes, rtChooseGift, rtChooseGiftPick, rtEnterNode, rtGiftView, resolveArena, rtChooseTalisman, rtChooseHammer, rtChooseFind, rtItemRefusal, rtRestHeal, rtShopLeave, rtChooseEventOption, rtEventView, type RtRunState, type RtRunStep } from '../run/rtRun';
import { RUN_ARENAS } from '../run/arenaPools';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { createFightObserver } from '../telemetry/observe';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { collectRecords, latestRuns } from '../telemetry/report';
import { checkRecord } from '../telemetry/schema';
import { rtRunParams } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const memory = (): { data: Map<string, string>; store: NewSeenStorage } => {
  const data = new Map<string, string>();
  return { data, store: { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } } };
};

check('memory: a fresh viewer has met nothing; the first meeting is reported once and survives a reload', () => {
  const { data, store } = memory();
  const a = new NewSeenStore(store);
  assert(!a.hasKind('wolf') && !a.hasAffix('fiery'), 'fresh');
  assert(a.meetKind('wolf') === true && a.meetKind('wolf') === false, 'wolf once');
  assert(a.meetAffix('fat') === true && a.meetAffix('fat') === false, 'fat once');
  const b = new NewSeenStore(store);
  assert(b.hasKind('wolf') && b.hasAffix('fat') && !b.hasKind('boar'), 'reload keeps it');
  assert(b.meetKind('wolf') === false, 'no second caption after a reload');
  assert(data.has(NEW_SEEN_KEY), 'own key');
});

check('memory: broken or throwing storage never throws and keeps the page working', () => {
  const junk = new NewSeenStore({ getItem: () => '{not json', setItem: () => {} });
  assert(!junk.hasKind('wolf') && junk.meetKind('wolf') && junk.hasKind('wolf'), 'junk starts empty, works in memory');
  const wrongVersion = new NewSeenStore({ getItem: () => JSON.stringify({ version: 9, kinds: ['wolf'] }), setItem: () => {} });
  assert(!wrongVersion.hasKind('wolf'), 'unknown version is ignored');
  const throwing = new NewSeenStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  assert(throwing.meetKind('boar') && throwing.hasKind('boar'), 'throwing storage');
  assert(new NewSeenStore(null).meetKind('lynx'), 'no storage');
});

check('texts: the final strings, 8 forest kinds and 6 garrison kinds (task 43) without the basic enemy, 4 affixes', () => {
  assert(Object.keys(KIND_CAPTIONS).sort().join() === 'archer,boar,crossbow,firebrand,guard,handler,hive,hound,keymaster,knight,lynx,pitcher,porcupine,recruit,rook,rootling,sapper,shaman,shield,slime,slinger,warden,wardrobe,wisp,wolf', 'kinds');
  // Each caption has a name before its first « — » (the camp's list splits there; the line may hold another dash — the guard's).
  for (const [kind, text] of Object.entries(KIND_CAPTIONS)) assert(text.indexOf(' — ') > 0, `${kind}: «${text}»`);
  assert(KIND_CAPTIONS.guard === 'Стражник — ходит строем: строй — готовая цепь' && KIND_CAPTIONS.knight === 'Рыцарь — цепь снимает латы; без лат нападает', 'garrison texts (design 16.10.2026)');
  assert(KIND_CAPTIONS.wolf === 'Волк — окружает; в стае бьёт сильнее' && KIND_CAPTIONS.shaman === 'Шаман — лучом усиливает слабого', 'texts');
  assert(AFFIX_CAPTIONS.swift === 'Стремительный — быстрее, на пластину меньше' && AFFIX_CAPTIONS.fat === 'Толстый — медленный, на пластину больше', 'affixes');
  assert(Object.keys(AFFIX_CAPTIONS).length === 4, 'four affixes');
});

/** A fight where the hero cannot fall; the kinds that really stood on the arena in `seconds` of its own pace. */
function spawnedKinds(arena: string, roster: string | undefined, seed: number, seconds: number): Set<string> {
  const p: Params = defaultParams();
  p.contactDamage = 0; p.heroHp = 40; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0;
  const sim = new Simulation({ arena, params: p, seed, ...roster !== undefined ? { roster } : {} }), kinds = new Set<string>(sim.world.enemies.map(e => e.kind));
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick();
    for (const e of sim.world.enemies) kinds.add(e.kind);
    sim.world.events.length = 0;
  }
  return kinds;
}

check('arena kinds: every kind a simulated fight spawns (3 seeds, 50 s) is in `arenaKinds`, for every run arena, pool roster and role', () => {
  const pairs: [string, string | undefined][] = RUN_ARENAS.map(a => [a, undefined]);
  for (const def of POOL_ROSTERS) pairs.push(['buttons', def.id]);
  for (const def of ANCHOR_ROLES) for (const arena of Object.keys(ANCHOR_ARENAS)) pairs.push([arena, def.id]);
  for (const [arena, roster] of pairs) {
    const claimed = arenaKinds(arena, roster);
    for (let k = 1; k <= 3; k++) for (const kind of spawnedKinds(arena, roster, seedOf(k + 400), 50)) {
      if (kind in KIND_CAPTIONS) assert(claimed.has(kind), `${arena}/${roster ?? '-'}: a simulated fight spawned «${kind}», arenaKinds says ${[...claimed]}`);
    }
  }
});

check('arena kinds: a roster brings its kinds; a pool roster drops the template newcomers; an unknown arena brings nothing', () => {
  assert(arenaKinds('buttons', 'hunt').has('lynx') && arenaKinds('buttons', 'hunt').has('archer'), 'hunt');
  assert(!arenaKinds('buttons', 'wolves').has('archer'), 'wolves roster is wolves');
  assert(arenaKinds('shields', '+archer').has('shield') && arenaKinds('shields', '+archer').has('archer'), 'anchor keeps its kind, adds a role');
  assert(arenaKinds('archers').has('archer'), 'archers arena');
  assert(arenaKinds('nonexistent').size === 0, 'unknown arena: nothing');
});

const ok = (step: RtRunStep): RtRunState => { if (!step.ok) throw new Error(step.reason); return step.run; };
/** The mini-gift walk of rosters.spec.ts: first button of every screen, `k + step` on the map, every arena a won fight; `visit` sees each map screen. */
function walk(seed: number, k: number, visit: (run: RtRunState) => void): void {
  let run = createRtRun(seed, { gift: 'mini', rosterMix: true, garrison: false });
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'gift') {
      const view = rtGiftView(run)!, first = view.options.find(o => o.available);
      run = ok(rtChooseGift(run, first ? first.index : null));
      const open = rtGiftView(run);
      if (open && open.chosen !== null) run = ok(rtChooseGiftPick(run, open.picks[0]));
    } else if (pending?.kind === 'battle') run = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }));
    else if (pending?.kind === 'hammer') run = ok(rtChooseTalisman(ok(rtChooseHammer(run, null)), null));
    // Task 50: the knack screen (RT_KNACKS_ON) is passed over and is not a step of the walk (its node choice turns on `step`).
    else if (pending?.kind === 'knack') { run = ok(rtChooseKnack(run, null)); step--; }
    else if (pending?.kind === 'talisman') run = ok(rtChooseTalisman(run, null));
    else if (pending?.kind === 'rest') run = ok(rtRestHeal(run));
    else if (pending?.kind === 'find') run = ok(rtChooseFind(run, pending.options.find(item => !rtItemRefusal(run, item)) ?? pending.options[0]));
    else if (pending?.kind === 'shop') run = ok(rtShopLeave(run));
    else if (pending?.kind === 'event') run = ok(rtChooseEventOption(run, rtEventView(run)!.options.find(o => o.available)!.id));
    else {
      visit(run);
      const next = rtAvailableNodes(run);
      run = ok(rtEnterNode(run, next[(k + step) % next.length].id));
    }
  }
}

check('map: on real run maps the sign logic follows the preview — arena nodes with an unmet kind only; none when everything is met; non-arena nodes have no preview', () => {
  let screens = 0, signed = 0, unsigned = 0, notArena = 0;
  for (let k = 1; k <= 40; k++) {
    const fresh = new NewSeenStore(memory().store), all = new NewSeenStore(memory().store);
    for (const kind of Object.keys(KIND_CAPTIONS)) all.meetKind(kind);
    walk(seedOf(k + 900), k, run => {
      for (const node of rtAvailableNodes(run)) {
        screens++;
        const preview = isArenaNode(node) ? arenaPreview(run, node) : null;
        if (!preview) { notArena++; continue; }
        assert(newKindsOfArena(preview.arena, preview.roster, all).length === 0, 'nothing is new when all are met');
        const news = newKindsOfArena(preview.arena, preview.roster, fresh);
        for (const kind of news) assert(arenaKinds(preview.arena, preview.roster).has(kind) && kind in KIND_CAPTIONS, `${kind}`);
        if (news.length) signed++; else unsigned++;
      }
    });
  }
  assert(screens > 100 && signed > 0 && unsigned > 0 && notArena > 0, `map cards ${screens}, signed ${signed}, unsigned ${unsigned}, non-arena ${notArena}`);
  console.log(`   ${screens} available node cards over 40 runs: ${signed} arena cards with the sign for a fresh viewer, ${unsigned} without, ${notArena} not arenas`);
});

check('map: a viewer who met a kind gets no sign for it any more', () => {
  const store = new NewSeenStore(memory().store);
  assert(newKindsOfArena('shields', undefined, store).includes('shield'), 'shields arena is new to a fresh viewer');
  store.meetKind('shield');
  assert(!newKindsOfArena('shields', undefined, store).includes('shield'), 'met');
});

// ---- Telemetry ----

function fakeLocal(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
}

{
  const local = fakeLocal(), session: SessionStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; })();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: rtRunParams(defaultParams()), observer: createFightObserver, local, sessionStore: session, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const run = createRtRun(seedOf(7), { gift: 'mini' });
  rec.runStarted(null, run);
  const exportRun = async () => { const file = await rec.exportFile(); const set = collectRecords([{ name: 'new-seen', text: file.text }]); return latestRuns(set.records)[0]; };
  const before = await exportRun();
  assert(before && before.mapSigns === undefined && checkRecord(before) === null, 'a run without a shown sign has no field (older records read the same)');
  rec.mapChoice(run, { nodeId: 'n1', signed: ['n1', 'n3'], chosenSigned: true });
  rec.mapChoice(run, { nodeId: 'n5', signed: ['n2'], chosenSigned: false });
  const after = await exportRun();
  assert(after && checkRecord(after) === null, 'the record stays valid');
  assert(JSON.stringify(after.mapSigns) === JSON.stringify([{ nodeId: 'n1', signed: ['n1', 'n3'], chosenSigned: true }, { nodeId: 'n5', signed: ['n2'], chosenSigned: false }]), `mapSigns ${JSON.stringify(after.mapSigns)}`);
  console.log('ok - telemetry: mapChoice writes `RunRecord.mapSigns` in order; no sign shown — no field');
}
