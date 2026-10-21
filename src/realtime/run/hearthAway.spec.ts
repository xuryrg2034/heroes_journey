/**
 * Task 51 «Лагерь, этап 3», step 51д (docs/design-notes/task-51-camp-l3.md, section 3.4; docs/realtime-slice.md, «Лагерь, этап 3»): the
 * NPCs leave for one run and are met on the road. Node only: `npm run test:realtime-hearth-away`. Whole runs walked by the run's own
 * commands (metaWalk.testkit.ts), the profile as the view keeps it (`createRtProfileStore(storage, { away: true, gambler: true })` — the
 * leaving on; the game's default is off until the camp's trace and the rest's meeting):
 * - Ерофей leaves after his first quest done, not after the second, again after the third; one at a time; not in the quest draw while away;
 *   with the leaving off — never;
 * - the run of his leaving: the first rest of his zone (the trails, run rows 2–4) holds the meeting; the deal by the stream `npc-meet`
 *   (the same by the seed); one deal; the rest's own choice stays; the save round-trips; back after the run — met or «не дождался»;
 * - Марфа away: her start consumable without a choice; her deal keeps the rule of three potions; Шиш's «Скупка»: a consumable for 2 resources;
 * - a run without an NPC away — no meeting, the rest as before.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { parseRtRun, rtMeetDeal, rtMeetView, rtMeetZone, rtNode, rtRestView, serializeRtRun, type RtRunState } from './rtRun';
import { runRow } from './arenaPools';
import { stockTotal } from '../forest/merchant';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
type Store = ReturnType<typeof createRtProfileStore>;
/** A profile with Ерофей, Марфа and Шиш met (a stored profile as setup), the leaving on (and Шиш's camp). */
function camp(on = true): { storage: ReturnType<typeof memoryStorage>; store: Store } {
  const storage = memoryStorage(), store = createRtProfileStore(storage, { away: on, gambler: true });
  store.endRunMeta(walkRun({ k: 99, create: { gift: 'full', garrison: false, locked: store.locked() } }).run);
  const p = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!);
  p.meta.hearth.met = { herb: true, smith: true, gambler: true }; p.meta.hearth.levels = { owl: 0, herb: 2, smith: 1, gambler: 1 };
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
  return { storage, store };
}
/** Sets the next run's quest (setup: the quest the camp's draw would give). */
function quest(storage: ReturnType<typeof memoryStorage>, npc: string, id: string): void {
  const p = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!); p.meta.hearth.quest = { npc, id }; storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
}
/** A run of the camp; Ерофей's quest «отруби гирю» done by the walk's `sever` (or not). */
function campRun(store: Store, k: number, extra: Partial<WalkOptions> = {}): RtRunState {
  return walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: store.hearthStart(seedOf(k)).flags }, ...extra }).run;
}

check('Ерофей leaves after his first quest done, not after the second, again after the third; one at a time; out of the quest draw; the leaving off — never', () => {
  const { storage, store } = camp(), off = camp(false), aways: (string | undefined)[] = [];
  for (let n = 1; n <= 3; n++) {
    quest(storage, 'smith', 'smith-sever'); quest(off.storage, 'smith', 'smith-sever');
    // A run where the quest is done (the weight severed); the away run between them (none of his quests then).
    const run = campRun(store, 10 + n, { sever: true }), offRun = campRun(off.store, 10 + n, { sever: true });
    const end = store.endRunMeta(run)!; off.store.endRunMeta(offRun);
    assert(end.quest?.npc === 'smith' && end.quest.done, `${n}: the quest done`);
    aways.push(store.hearth().away);
    assert(store.hearth().quest?.npc !== 'smith' || store.hearth().away !== 'smith', 'not in the draw while away');
    assert(off.store.hearth().away === undefined, 'off: nobody leaves');
    if (store.hearth().away) { store.endRunMeta(campRun(store, 50 + n)); assert(store.hearth().away === undefined, 'back after one run'); }
  }
  assert(same(aways, ['smith', undefined, 'smith']) && store.hearth().done.smith === 3, `leaves: ${JSON.stringify(aways)}`);
});

/** A walk of the away run steered to the rests of the zone (or away from every rest: `meet` false). */
function awayWalk(store: Store, k: number, meet: boolean): { run: RtRunState; atMeet: RtRunState | null } {
  let atMeet: RtRunState | null = null;
  const run = campRun(store, k, {
    pickNode: (r, ids) => (meet ? ids.find(id => rtNode(r, id)?.type === 'rest') : ids.find(id => rtNode(r, id)?.type !== 'rest')) ?? null,
    each: r => { if (!atMeet && rtMeetView(r)) atMeet = r; },
  });
  return { run, atMeet };
}
/** A camp with `npc` away for the next run. */
function awayCamp(npc: 'herb' | 'smith' | 'gambler'): { storage: ReturnType<typeof memoryStorage>; store: Store } {
  const c = camp(), p = JSON.parse(c.storage.data.get(RT_PROFILE_STORAGE_KEY)!);
  p.meta.hearth.away = { npc }; delete p.meta.hearth.quest;
  c.storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
  assert(c.store.hearth().away === npc && c.store.hearthStart(seedOf(1)).flags.away === npc, 'away for the next run');
  return c;
}

check('the away run: the first rest of Ерофей\'s zone holds the meeting; the deal by `npc-meet` (the same by the seed), one deal, the rest\'s choice stays; back — met', () => {
  let met = 0, missed = 0, deals = 0;
  for (let k = 1; k <= 16; k++) {
    const { store } = awayCamp('smith'), { run, atMeet } = awayWalk(store, k, true);
    if (!atMeet) {
      // No rest of the zone on the walk's path: «не дождался».
      assert(!run.npcMeet, `seed ${k}: no meeting off the zone`);
      store.endRunMeta(run);
      assert(same(store.hearth().last?.away, { npc: 'smith', met: false }) && store.hearth().away === undefined, 'back without a meeting');
      missed++; continue;
    }
    const node = rtNode(atMeet, atMeet.npcMeet!.nodeId)!;
    assert(node.type === 'rest' && rtMeetZone('smith', node) && runRow(node.row) >= 2 && runRow(node.row) <= 4, `seed ${k}: a rest of the trails, rows 2–4`);
    // The first rest of the zone: no rest of the zone before it on the path.
    assert(!atMeet.visited.some(id => rtNode(atMeet, id)?.type === 'rest' && rtMeetZone('smith', rtNode(atMeet, id)!)), 'the first one');
    const view = rtMeetView(atMeet)!;
    assert(view.npc === 'smith' && view.deals.length === 2 && same(rtMeetView(structuredClone(atMeet)), view), 'two deals, the same by the seed');
    assert(rtRestView(atMeet)!.heal.available, 'the rest\'s own choice stays');
    const deal = view.deals.find(d => d.available);
    if (deal) {
      const step = rtMeetDeal(atMeet, deal.id);
      assert(step.ok && step.run.talismans.includes(deal.talisman!) && stockTotal(step.run.materials) === stockTotal(atMeet.materials) - 2, 'the talisman for 2 resources');
      assert(!rtMeetDeal(step.run, view.deals.find(d => d.id !== deal.id)!.id).ok && rtRestView(step.run)!.heal.available, 'one deal; the rest stays');
      assert(same(parseRtRun(serializeRtRun(step.run)), step.run), 'the save round-trips');
      deals++;
    }
    // The meeting stays at the first rest of the zone for the whole run (a later rest of the zone does not move it).
    const zoneRests = run.visited.filter(id => rtNode(run, id)?.type === 'rest' && rtMeetZone('smith', rtNode(run, id)!));
    assert(run.npcMeet?.nodeId === zoneRests[0], `seed ${k}: the meeting at the first rest of the zone (${run.npcMeet?.nodeId} of ${zoneRests})`);
    store.endRunMeta(run);
    assert(same(store.hearth().last?.away, { npc: 'smith', met: true }) && store.hearth().met2.smith === 1 && store.hearth().away === undefined, `seed ${k}: back, met`);
    met++;
  }
  assert(met >= 4 && deals >= 3, `met ${met}, missed ${missed}, deals ${deals}`);
  // A walk past every rest: «не дождался».
  const { store } = awayCamp('smith'), { run } = awayWalk(store, 3, false);
  if (!run.visited.some(id => rtNode(run, id)?.type === 'rest' && rtMeetZone('smith', rtNode(run, id)!))) {
    store.endRunMeta(run);
    assert(same(store.hearth().last?.away, { npc: 'smith', met: false }), 'missed');
  }
});

check('Марфа away: her start consumable without a choice, her deal keeps the rule of three potions; Шиш\'s «Скупка»: a consumable for 2 resources', () => {
  const herb = awayCamp('herb');
  assert(herb.store.hearthStart(seedOf(5)).items?.length === 1 && camp().store.hearthStart(seedOf(5)).items?.length === 2, 'Марфа away: one kind, no choice');
  let herbMet = 0, gamblerMet = 0;
  for (let k = 1; k <= 30 && (herbMet < 1 || gamblerMet < 1); k++) {
    for (const npc of ['herb', 'gambler'] as const) {
      const { store } = awayCamp(npc), { atMeet } = awayWalk(store, k, true);
      if (!atMeet) continue;
      const node = rtNode(atMeet, atMeet.npcMeet!.nodeId)!, view = rtMeetView(atMeet)!;
      assert(rtMeetZone(npc, node) && node.id.startsWith(npc === 'herb' ? 'den-' : 'camp-'), `${npc}: its branch`);
      if (npc === 'herb') {
        for (const deal of view.deals) assert(deal.available === (deal.reason === ''), 'a reason when unavailable');
        const full = view.deals.find(d => d.item === 'healing' && atMeet.potionCap && atMeet.items.healing >= atMeet.potionCap);
        assert(!full || !full.available, 'a healing one with a full hand is not sold');
        herbMet++;
      } else {
        for (const deal of view.deals) {
          const step = rtMeetDeal(atMeet, deal.id);
          assert(step.ok && step.run.items[deal.item!] === atMeet.items[deal.item!] - 1 && step.run.materials[deal.gain!] === atMeet.materials[deal.gain!] + 2, `«Скупка» ${deal.id}`);
        }
        gamblerMet++;
      }
    }
  }
  assert(herbMet >= 1 && gamblerMet >= 1, `meetings: Марфа ${herbMet}, Шиш ${gamblerMet}`);
});

check('a run without an NPC away: no meeting at any rest, the rest as before', () => {
  const { store } = camp();
  for (let k = 1; k <= 6; k++) {
    const run = campRun(store, k, { pickNode: (r, ids) => ids.find(id => rtNode(r, id)?.type === 'rest') ?? null, each: r => assert(rtMeetView(r) === null, 'no meeting') });
    assert(run.npcMeet === undefined && run.hearth?.away === undefined, `seed ${k}`);
  }
});

console.log(`hearth away (51д): ${checks} checks passed`);
