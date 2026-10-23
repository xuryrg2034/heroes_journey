/**
 * Task 61а–б (tests only): stored profiles of the camp's returns, built by core's own way (the run walked by its commands, the meta applied
 * by the profile store as the game applies it — run/metaWalk.testkit.ts, `endRunMeta`), so the browser tests store what the game would.
 * The first win over the castle is a real walk through the castle to the Warlock (task 55в, the run's flag `castle`), as core's
 * run/returnLayer.spec.ts does.
 */
import { walkRun, type WalkOptions } from '../run/metaWalk.testkit';
import { rtNode, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';
import { rtRunWonLevel } from '../run/rtMeta';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RtProfileStore, type RunStorage } from '../run/rtRunStorage';
import { pickLine } from './npcLines';
import type { NpcId } from './metaModel';

function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const rowOf = (run: RtRunState): number => { const p = run.pending as { nodeId?: string } | null; return p?.nodeId ? runRow(rtNode(run, p.nodeId)!.row) : 0; };
/** A meta run as the view starts it: won, lost at row 2–4, or `castle` — with the garrison and the castle, won to the Warlock. */
function metaRun(store: RtProfileStore, k: number, end: 'win' | 'death' | 'castle'): RtRunState {
  store.startRun();
  const options: WalkOptions = { k, create: { gift: 'mini', feats: true, locked: store.locked(), hero: store.heroChoice(), ...end === 'castle' ? { garrison: true, castle: true } : {} }, ...end === 'castle' ? { knack: () => null } : {}, ...end === 'death' ? { loseAt: run => rowOf(run) >= 2 + (k % 3) } : {} };
  return walkRun(options).run;
}

/**
 * The camps entered before: the meetings of the NPC at the fire said (as a player hears them on the first clicks), Ведунья's first camp.
 */
function metAll(store: RtProfileStore): void {
  const camp = store.hearth(), here = (['owl', 'herb', 'smith', 'gambler', 'monk'] as NpcId[]).filter(id => id === 'owl' || camp.met[id as 'herb']);
  for (const npc of here) for (let i = 0; i < 4; i++) {
    const line = pickLine(npc, { others: here }, store.hearth().lines);
    if (!/^first/.test(line.key)) break;
    store.markLine(line.id);
  }
  if (store.heroes().some(h => h.id === 'toad' && h.open)) store.markLine('toad:first_camp');
}

/** The stored profile (JSON) after `deaths` meta deaths in a row; the camp was entered after each but the last (its scene is due). */
export function returnProfile(deaths: number, from = 100): string {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let n = 1; n <= deaths; n++) {
    store.endRunMeta(metaRun(store, from + n, 'death'));
    if (n < deaths) { store.markReviveSeen(); metAll(store); }
  }
  return storage.data.get(RT_PROFILE_STORAGE_KEY)!;
}

/** Ведунья's first death (the profile's first return): freed by a won run, chosen, then lost. */
export function toadReturnProfile(from = 200): string {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let k = from; k < from + 6 && !store.heroes().some(h => h.id === 'toad' && h.open); k++) store.endRunMeta(metaRun(store, k, 'win'));
  if (!store.chooseHero('toad')) throw new Error('Ведунья is not free after six won runs');
  metAll(store);
  store.endRunMeta(metaRun(store, from + 10, 'death'));
  return storage.data.get(RT_PROFILE_STORAGE_KEY)!;
}

/**
 * The profile right after the first win over the castle (its camp scene due): four deaths before it (their scenes seen), then the win.
 * `monk` — Евлампий met at the fire before (else he comes with the scene).
 */
export function afterWinProfile(monk: boolean, from = 300): string {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let k = from; k < from + 4; k++) { store.endRunMeta(metaRun(store, k, 'death')); store.markReviveSeen(); metAll(store); }
  const run = metaRun(store, from + 4, 'castle');
  if (run.result?.outcome !== 'victory' || rtRunWonLevel(run) !== 3) throw new Error('the castle walk is not won to the Warlock');
  store.endRunMeta(run);
  if (!store.load().meta?.afterWin) throw new Error('the castle win opened no layer');
  if (monk) {
    const profile = store.load(), meta = profile.meta!;
    meta.hearth!.met = { ...meta.hearth!.met, monk: true };
    storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ ...profile, meta }));
  }
  // Евлампий met before: his meeting said at that camp.
  if (monk) metAll(store);
  return storage.data.get(RT_PROFILE_STORAGE_KEY)!;
}
