/**
 * Task 49 «Второй герой», step 2 (docs/design-notes/task-49-second-hero.md, sections 5–7, 9, 12; docs/realtime-slice.md, «Герои»): the
 * run and the meta of Ведунья (`toad`). Node only: `npm run test:realtime-hero`. Whole runs walked by the run's own commands
 * (metaWalk.testkit.ts), the profile as the view keeps it (`createRtProfileStore`):
 * - a run without `hero` keeps no `heroId` (no meta) and is the cat's; Ведунья's run (meta or seeded) keeps `toad`, its fights take
 *   `Loadout.hero`, every save round-trips;
 * - no screen offers her «Печать» (the Jailer's forms, «Застава», events, the chest, the feat, the merchant, the archetype's place 1) on
 *   16 seeds of the forest and the garrison, while the cat's same walks do offer it;
 * - «Ледяная печать» from one «Иней на клинке» at a rest; no pair guarantee for the innate half; a form of «Конец» taken later does not
 *   replace the fusion (the cat's would);
 * - the packs are each hero's own (her order «Иней» first; 14 items locked at her start; the cat's packs untouched by her runs);
 * - Ведунья is freed by the first win over the Jailer in a meta run (any hero; the row and the viewer's run kept), not by a seeded run,
 *   not twice; `endRunMeta` frees her too; only a freed hero is chosen;
 * - Неясыть's «дальше прежнего» by the run's hero (the camp shows the chosen hero's, the run fixes it at its start); the cat's as before;
 * - «Испытание» is the hero's own: hers opens with her win, the cat's open one stays; the levels chosen apart;
 * - an old profile reads as before; the telemetry fields pass the schema.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { seedOf, walkRun } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtArenaLoadout, rtNode, rtFormReplaces, rtFusionOwed, rtFusionRecipe, rtFusionsReady, rtInnate, rtRestFuse, rtRestView, serializeRtRun, type RtRunState } from './rtRun';
import { createRtProfileStore, parseRtProfile, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { RT_HERO_ID, RT_META_LOCKABLE, RT_META_PACKS, RT_META_THRESHOLDS, RT_TOAD_ID, rtHeroPacks, rtLockedAfter } from './metaCatalog';
import { parseRtMeta, rtApplyMeta, rtJailerWonRow } from './rtMeta';
import { COUNTER_TALISMANS as CT, FORMS, FUSIONS, HAMMERS } from '../sim/buildIds';
import { checkRecord, runKey, runRecordId, sessionKey } from '../telemetry/schema';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const ALL = rtLockedAfter([]);

check('a run without `hero` is the cat\'s (no field without the meta); Ведунья\'s keeps `toad`, her fights take `Loadout.hero`; saves round-trip', () => {
  for (let k = 1; k <= 4; k++) {
    const seed = seedOf(k), cat = createRtRun(seed, { gift: 'full' }), toad = createRtRun(seed, { gift: 'full', hero: RT_TOAD_ID });
    assert(cat.heroId === undefined && same(cat, createRtRun(seed, { gift: 'full', hero: RT_HERO_ID })), 'cat: no field, `hero: cat` the same run');
    assert(createRtRun(seed, { locked: ALL }).heroId === RT_HERO_ID && createRtRun(seed, { locked: ALL, hero: RT_TOAD_ID }).heroId === RT_TOAD_ID, 'meta runs');
    assert(toad.heroId === RT_TOAD_ID && createRtRun(seed, { seeded: true, hero: RT_TOAD_ID }).heroId === RT_TOAD_ID, 'her seeded run (`?hero=toad`)');
    const { heroId: _h, ...rest } = toad;
    assert(same(rest, cat), 'the same map, gift and streams — only the hero differs');
  }
  let fights = 0;
  for (let k = 1; k <= 6; k++) {
    walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', hero: RT_TOAD_ID, garrison: k % 2 === 0, ...k % 3 === 0 ? { locked: ALL } : {} }, each: run => {
      assert(same(parseRtRun(serializeRtRun(run)), run), `seed ${k}: the save round-trips`);
      if (run.pending?.kind === 'battle') { fights++; assert(rtArenaLoadout(run).hero === RT_TOAD_ID, 'her fight takes the hero'); }
    } });
    walkRun({ k, create: { gift: 'full' }, each: run => { if (run.pending?.kind === 'battle') assert(rtArenaLoadout(run).hero === undefined, 'the cat\'s fight: no hero'); } });
  }
  assert(fights > 20, `fights ${fights}`);
  // A tampered save: the cat's id without the snapshot, an unknown hero.
  const save = JSON.parse(serializeRtRun(createRtRun(seedOf(1), { gift: 'full' })));
  assert(parseRtRun(JSON.stringify({ ...save, heroId: 'cat' })) === null && parseRtRun(JSON.stringify({ ...save, heroId: 'owl' })) === null && parseRtRun(JSON.stringify({ ...save, heroId: 'toad' })) !== null, 'parse');
});

check('no screen offers Ведунья «Печать» — Jailer\'s forms, «Застава», events, the chest, the feat, the merchant, the archetype (16 seeds); the cat\'s same walks do', () => {
  let catSeal = 0, toadForms = 0;
  for (let k = 1; k <= 16; k++) {
    const create = { gift: 'full' as const, feats: true, garrison: k % 2 === 0, habits: k % 4 === 0 };
    const habit = k % 8 === 0 ? 'cold' as const : k % 4 === 0 ? 'shift' as const : undefined;
    const toad = walkRun({ k, create: { ...create, hero: RT_TOAD_ID }, ...habit ? { habit } : {} }), cat = walkRun({ k, create, ...habit ? { habit } : {} });
    assert(!toad.offered.has(FORMS.seal), `seed ${k}: «Печать» offered to her`);
    if (cat.offered.has(FORMS.seal)) catSeal++;
    toadForms += [...toad.offered].filter(id => ['form-pierce', HAMMERS.blast, HAMMERS.fire, HAMMERS.cut, HAMMERS.return, 'frost-pass'].includes(id)).length;
  }
  assert(catSeal >= 3 && toadForms >= 16, `the cat was offered «Печать» on ${catSeal} seeds; her other forms ${toadForms}`);
});

/** Ведунья's walk that took «Иней на клинке» and made «Ледяная печать» at a rest (the first of the seeds that does). */
function fusedWalk(): { before: RtRunState; after: RtRunState; k: number } {
  for (let k = 1; k <= 200; k++) {
    let before: RtRunState | null = null, after: RtRunState | null = null;
    // The player takes «Иней на клинке» whenever a screen shows it (the archetype «Стужа» weighs it), goes for «Застава» until then (a late one —
    // the walk goes on into the garrison) and for a rest after; the rest of the walk is its own.
    const want = (run: RtRunState): string => (run.talismans.includes(CT.frostEdge) ? 'rest' : 'hard');
    walkRun({ k, create: { gift: 'full', hero: RT_TOAD_ID, habits: true, garrison: true }, habit: 'cold', fuse: true, talisman: (_run, options) => (options.includes(CT.frostEdge) ? CT.frostEdge : null),
      pickNode: (run, ids) => ids.find(id => rtNode(run, id)?.type === want(run)) ?? null, each: run => {
      if (!after && run.talismans.includes(FUSIONS.iceSeal)) after = run;
      if (!after && run.pending?.kind === 'rest' && rtFusionsReady(run).includes(FUSIONS.iceSeal)) before = run;
    } });
    if (before && after) return { before, after, k };
  }
  throw new Error('no walk made «Ледяная печать»');
}

check('«Ледяная печать» from one «Иней на клинке» at a rest; no pair guarantee for the innate half; «Прямая» taken later does not replace it', () => {
  // The recipe line and no guarantee: she holds «Иней» alone.
  const run = createRtRun(seedOf(3), { gift: 'full', hero: RT_TOAD_ID });
  run.talismans.push(CT.frostEdge);
  assert(same(rtFusionRecipe(run, CT.frostEdge), { partner: FORMS.seal, fusion: FUSIONS.iceSeal }) && rtFusionsReady(run).includes(FUSIONS.iceSeal), 'the recipe with the innate seal');
  assert(rtFusionOwed(run).length === 0, 'no owed pair for the innate half');
  const cat = createRtRun(seedOf(3), { gift: 'full' });
  cat.talismans.push(CT.frostEdge);
  assert(!rtFusionsReady(cat).length && rtFusionOwed(cat).some(o => o.partner === FORMS.seal), 'the cat: «Печать» owed, nothing ready');
  // A real rest of a walk.
  const { before, after, k } = fusedWalk();
  const view = rtRestView(before)!, step = rtRestFuse(before, FUSIONS.iceSeal);
  assert(view.fusions.some(f => f.fusion === FUSIONS.iceSeal && f.available) && step.ok, `seed ${k}: the rest makes it`);
  const made = step.ok ? step.run : before;
  assert(made.talismans.includes(FUSIONS.iceSeal) && !made.talismans.includes(CT.frostEdge) && made.talismansGone.includes(CT.frostEdge) && !made.talismansGone.includes(FORMS.seal), 'parts: «Иней» gone, «Печать» stays hers');
  assert(same(parseRtRun(serializeRtRun(after)), after), 'the fused save round-trips');
  // «Прямая» (and «Взрыв на конце») stand beside it; the cat's «Ледяная печать» would be replaced.
  assert(rtFormReplaces(made, FORMS.pierce) === null && rtFormReplaces(made, HAMMERS.blast) === null, 'no replacement of the innate fusion');
  const catFused = { ...made, heroId: undefined };
  assert(rtFormReplaces(catFused, FORMS.pierce) === FUSIONS.iceSeal, 'the cat\'s fusion holds «Конец»');
  const both = { ...made, talismans: [...made.talismans, FORMS.pierce] };
  assert(parseRtRun(serializeRtRun(both)) !== null, 'a save with the fusion and «Прямая» reads');
  assert(rtInnate(made).join() === FORMS.seal && rtInnate(catFused).length === 0, 'innate');
});

check('the packs are each hero\'s own: her order «Иней» first, all 14 items locked at her start, the cat\'s packs untouched by her runs', () => {
  assert(same(rtHeroPacks(RT_HERO_ID), RT_META_PACKS), 'the cat\'s order as before');
  const hers = rtHeroPacks(RT_TOAD_ID);
  assert(same(hers.map(p => p.id), ['frost', 'twins', 'hunter', 'long-chains', 'return']) && same(hers.map(p => p.at), RT_META_THRESHOLDS), 'her order at the same thresholds');
  assert(ALL.length === RT_META_LOCKABLE.length && ALL.length === 14, `items ${ALL.length}`);
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  // The cat opens «Охотник»: his first pack; hers stay closed.
  const catWalk = walkRun({ k: 2, create: { gift: 'full', locked: store.locked(RT_HERO_ID) } });
  const catEnd = store.endRunMeta(catWalk.run)!;
  assert(catEnd.hero === RT_HERO_ID && catEnd.pack?.id === 'hunter' && same(store.locked(RT_TOAD_ID), ALL), 'his pack; her items all locked');
  // Freed by that run (he won the Jailer), she runs: her first pack is «Иней», his stay.
  assert(store.chooseHero(RT_TOAD_ID) && store.heroChoice() === RT_TOAD_ID && same(store.locked(), ALL), 'her start: all locked');
  const toadWalk = walkRun({ k: 4, create: { gift: 'full', hero: store.heroChoice(), locked: store.locked() } });
  const end = store.endRunMeta(toadWalk.run)!;
  assert(end.hero === RT_TOAD_ID && end.pack?.id === 'frost' && !store.locked().includes(CT.frostEdge) && store.locked(RT_HERO_ID).includes(CT.frostEdge), 'her «Иней»; his still locked');
  const views = store.heroes(), cat = views.find(v => v.id === RT_HERO_ID)!, toad = views.find(v => v.id === RT_TOAD_ID)!;
  assert(same(cat.packs, ['hunter']) && same(toad.packs, ['frost']) && toad.chosen && toad.open && toad.nextPack?.id === 'twins' && cat.nextPack?.id === 'return', 'the views');
  // «✦ новое» per hero: «Иней» is new to her, not to him (locked there).
  assert(store.isNewOffer(CT.frostEdge) && !store.isNewOffer(CT.frostEdge, RT_HERO_ID) && store.markOffered(CT.frostEdge) && !store.isNewOffer(CT.frostEdge), '«✦ новое» by hero');
  assert(store.isNewOffer(CT.eliteHunter, RT_HERO_ID), 'his «Охотник» still new to him');
});

check('the first win over the Jailer in a meta run frees Ведунья (any hero; the row, the viewer\'s run); not a seeded run, not twice; only a freed hero is chosen', () => {
  for (let k = 1; k <= 6; k++) {
    const storage = memoryStorage(), store = createRtProfileStore(storage);
    assert(!store.chooseHero(RT_TOAD_ID) && store.heroChoice() === RT_HERO_ID && !store.heroes().find(v => v.id === RT_TOAD_ID)!.open, 'closed at first');
    store.startRun();
    // A seeded run that wins the Jailer frees nobody.
    let seededJailer: RtRunState | null = null;
    walkRun({ k, create: { gift: 'full', seeded: true }, each: run => { if (!seededJailer && rtJailerWonRow(run) !== null) seededJailer = run; } });
    assert(seededJailer && store.freeHero(seededJailer) === null, 'seeded: none');
    // A meta run: the state right after the Jailer's fight was fed back.
    let freedAt: RtRunState | null = null, freed: string | null = null, lost = false;
    walkRun({ k, create: { gift: 'full', locked: store.locked() }, loseAt: (_run, type) => k % 3 === 0 && type === 'checkpoint', each: run => {
      if (run.result?.outcome === 'defeat') lost = true;
      if (!freedAt && rtJailerWonRow(run) !== null) { freedAt = run; freed = store.freeHero(run); }
      else if (!freedAt) assert(store.freeHero(run) === null, 'nothing before the Jailer is won');
    } });
    if (lost) { assert(!freedAt && !store.load().meta?.freed, `seed ${k}: lost at the Jailer — not freed`); continue; }
    assert(freedAt && freed === RT_TOAD_ID, `seed ${k}: freed`);
    const row = rtJailerWonRow(freedAt!)!, meta = store.load().meta!;
    assert(same(meta.freed, { toad: { row, run: 1 } }) && store.freeHero(freedAt!) === null, 'once, with the row and the run');
    assert(store.chooseHero(RT_TOAD_ID) && store.heroChoice() === RT_TOAD_ID && store.chooseHero(RT_HERO_ID) && store.load().meta!.hero === undefined, 'chosen; the cat — no field');
  }
  // `endRunMeta` frees her when the view did not call `freeHero`.
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  const walk = walkRun({ k: 2, create: { gift: 'full', locked: store.locked() } });
  assert(rtJailerWonRow(walk.run) !== null && !store.load().meta?.freed, 'not freed yet');
  store.endRunMeta(walk.run);
  assert(store.load().meta?.freed?.toad?.row === rtJailerWonRow(walk.run) && store.heroes()[1].open, 'freed at the end');
  // A meta that names a hero not freed reads as the cat.
  assert(parseRtMeta({ heroes: {}, hero: 'toad' })!.hero === undefined && parseRtMeta({ heroes: {}, hero: 'toad', freed: { toad: { row: 5 } } })!.hero === 'toad', 'parse the choice');
});

check('«Испытание» is the hero\'s own: hers opens with her win (one win — all levels), the cat\'s open one stays; the levels chosen apart', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  store.endRun({ reachedJailer: true, seeded: false, won: true, hero: RT_HERO_ID });
  assert(store.ashOpen(RT_HERO_ID) && !store.ashOpen(RT_TOAD_ID) && store.chooseAsh(2, RT_HERO_ID) && !store.chooseAsh(1, RT_TOAD_ID), 'the cat\'s only');
  // Freed and chosen; her win (a seeded one does not count).
  const walk = walkRun({ k: 2, create: { gift: 'full', locked: store.locked() } });
  store.endRunMeta(walk.run);
  assert(store.chooseHero(RT_TOAD_ID) && !store.ashOpen() && store.ashChoice() === 0, 'hers closed (the chosen hero by default)');
  store.endRun({ reachedJailer: true, seeded: true, won: true, hero: RT_TOAD_ID });
  assert(!store.ashOpen(RT_TOAD_ID), 'a seeded win opens nothing');
  store.endRun({ reachedJailer: true, seeded: false, won: true });
  assert(store.ashOpen() && store.ashOpen(RT_TOAD_ID) && store.chooseAsh(8) && store.ashChoice() === 8 && store.ashChoice(RT_HERO_ID) === 2, 'hers: all levels; the cat\'s level kept');
  const profile = store.load();
  assert(profile.won === true && profile.ash === 2 && same(profile.heroAsh, { toad: { won: true, ash: 8 } }), JSON.stringify(profile.heroAsh));
  // The card's mark: the best «Испытание» of a won run (a lost run of a higher level leaves it).
  const won3 = walkRun({ k: 1, create: { gift: 'full', hero: RT_TOAD_ID, locked: ALL, ash: 3 } }).run, lost5 = walkRun({ k: 1, create: { gift: 'full', hero: RT_TOAD_ID, locked: ALL, ash: 5 }, loseAt: (_r, type) => type === 'boss' }).run;
  assert(won3.result?.outcome === 'victory' && lost5.result?.outcome === 'defeat', 'the walks');
  const after3 = rtApplyMeta(undefined, won3).meta, after5 = rtApplyMeta(after3, lost5).meta;
  assert(after3.heroes.toad!.ashBest === 3 && after5.heroes.toad!.ashBest === 3 && after3.heroes.cat === undefined, 'the mark only on a win, her own');
});

check('Неясыть\'s «дальше прежнего» is the run\'s hero\'s: the camp shows it by the chosen hero, the run fixes it at its start, its end checks it by that hero; the cat\'s quests as before', () => {
  // The cat with no change of hero: the camp's quest and the run's are the stored one (the end of the run before picked it), 12 runs.
  {
    const storage = memoryStorage(), store = createRtProfileStore(storage);
    for (let k = 1; k <= 12; k++) {
      const start = store.hearthStart(seedOf(k)), stored = store.load().meta?.hearth?.quest;
      assert(same(store.hearth().quest, stored) && same(start.flags.quest, stored), `seed ${k}: the cat's quest is the stored one`);
      const walk = walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: start.flags }, ...k % 4 === 0 ? { loseAt: (_r: RtRunState, type: string) => type === 'boss' } : {} });
      assert(same(walk.run.hearth?.quest, stored), 'the run carries it');
      store.endRunMeta(walk.run);
    }
  }
  // The cat passed the forest (his record: row 10) and freed Ведунья (no record): the owl's quest by the chosen hero.
  for (let k = 1; k <= 40; k++) {
    const storage = memoryStorage(), store = createRtProfileStore(storage);
    const cat = walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked() } });
    store.endRunMeta(cat.run);
    if (cat.run.result?.outcome !== 'victory' || store.load().meta?.hearth?.quest?.npc !== 'owl') continue;
    assert(store.hearth().quest?.id === 'owl-forest' && store.hearth(RT_TOAD_ID).quest?.id === 'owl-farther', 'the camp: the cat — «Пройди лес», Ведунья — «Дальше»');
    assert(store.chooseHero(RT_TOAD_ID) && store.hearth().quest?.id === 'owl-farther', 'the chosen hero changes the quest shown');
    const start = store.hearthStart(seedOf(k + 100));
    assert(start.flags.quest?.id === 'owl-farther' && store.hearthStart(seedOf(k + 100), RT_HERO_ID).flags.quest?.id === 'owl-forest', 'the run\'s start fixes it by its hero');
    // Her run fights 3 battles and dies: «Дальше» of her own (no record) is done; the cat's «Пройди лес» would not be.
    const toad = walkRun({ k: k + 100, create: { gift: 'full', garrison: false, hero: RT_TOAD_ID, locked: store.locked(), hearth: start.flags }, loseAt: (run: RtRunState) => run.battles.length >= 3 });
    assert(same(toad.run.hearth?.quest, { npc: 'owl', id: 'owl-farther' }) && toad.run.result?.outcome === 'defeat', 'her run carries «Дальше»');
    const end = store.endRunMeta(toad.run)!;
    assert(end.hero === RT_TOAD_ID && end.quest?.id === 'owl-farther' && end.quest.done, `checked by her record: ${JSON.stringify(end.quest)}`);
    assert(store.chooseHero(RT_HERO_ID) && store.hearth().quest?.npc === store.load().meta!.hearth!.quest!.npc, 'back to the cat');
    return;
  }
  throw new Error('no seed gave the owl\'s quest after a won forest');
});

check('an old profile (the cat only) reads as before; the run\'s telemetry fields pass the schema', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let k = 1; k <= 3; k++) { store.startRun(); const walk = walkRun({ k, create: { gift: 'full', locked: store.locked() } }); store.endRun({ reachedJailer: true, seeded: false, won: walk.run.result?.outcome === 'victory' }); store.endRunMeta(walk.run); }
  const text = storage.data.get(RT_PROFILE_STORAGE_KEY)!, stored = JSON.parse(text);
  delete stored.meta.freed;
  const old = JSON.stringify(stored);
  assert(JSON.stringify(parseRtProfile(old)) === old, 'an old profile reads byte for byte');
  const session = sessionKey(Date.UTC(2026, 9, 16), 7), runId = runKey(Date.UTC(2026, 9, 16), 1);
  const header = { schema: 1, id: runRecordId(session, runId), kind: 'run', session, run: runId, build: 'b', at: '2026-10-16T00:00:00Z', params: { storage: 'p', hash: 'h' } };
  const base = { ...header, seed: 1, outcome: 'victory', farRow: 10, death: null, nodes: [], choices: [], fights: [], kit: {}, runParams: {} };
  assert(checkRecord(base) === null && checkRecord({ ...base, hero: 'toad', freed: { hero: 'toad', row: 5 } }) === null, 'the hero fields pass');
  assert(checkRecord({ ...base, hero: 'cat' }) === 'run hero' && checkRecord({ ...base, freed: { hero: 'toad' } }) === 'run freed', 'malformed ones are refused');
  // A fresh profile's hero view: the cat open and chosen, Ведунья closed.
  const views = createRtProfileStore(memoryStorage()).heroes();
  assert(views.length === 2 && views[0].open && views[0].chosen && !views[1].open && !views[1].chosen, 'views');
});

console.log(`hero (run, meta): ${checks} checks passed`);
