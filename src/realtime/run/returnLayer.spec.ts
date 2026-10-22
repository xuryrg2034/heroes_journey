/**
 * Task 61а «Возвращение» and 61б «после первой победы» (docs/design-notes/task-61-return-and-beyond.md, А, Б.1–Б.3, Г.1, Г.5 items 1–5):
 * the profile's side. Node only: `npm run test:realtime-return`. Whole runs walked by the run's own commands (metaWalk.testkit.ts), the
 * meta applied and the camp read through the profile store as the view uses them (`startRun`, `endRunMeta`, `returnView`, the marks):
 * - a meta run lost counts a return; the camp's scene plays once a death (full the first three, short later); a reload after it — none;
 * - a won run, an abandoned one and a seeded one count none and play no scene; a death not visited is not shown after a later run;
 * - the first death — Неясыть's `revive_first` (her variant after Ведунья's run) and Ведунья's own line; the key N to its NPC only;
 * - 12 deaths — 10 scorches and 2 darker ones; a profile without the fields reads and writes byte for byte;
 * - the profile built with the first castle win (the castle is not in the run yet, spec Г.8: `rtApplyMeta` with `castleWon` over a real
 *   won run): the end line once, the camp's scene once (the fire turquoise, Евлампий comes and says `first_fire`), `win_castle_first`,
 *   the first death after it — `revive_after` and a full scene.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { walkRun, type WalkOptions } from './metaWalk.testkit';
import { rtNode, type RtRunState } from './rtRun';
import { runRow } from './arenaPools';
import { parseRtMeta, rtAfterWinLineDue, rtApplyMeta, RT_REVIVE_FULL } from './rtMeta';
import { createRtProfileStore, parseRtProfile, RT_PROFILE_STORAGE_KEY, type RtProfileStore, type RunStorage } from './rtRunStorage';
import { RT_RUN_END_TEXT } from './rtRunEnd';
import { RT_TOAD_ID } from './metaCatalog';
import { NPC_LINES, pickLine, RETURN_KEYS, type DeathCause, type LineContext } from '../view/npcLines';
import { TOAD_LINES_BY_NPC } from '../view/npcToadLines';
import { toadLine, toadRunKey, TOAD_LINES } from '../view/heroLines';
import type { NpcId } from '../view/metaModel';
// The project has no Node typings (the spec's tables are read as text, Node only).
// @ts-expect-error node:fs has no declarations here
import { readFileSync } from 'node:fs';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const NPCS: NpcId[] = ['owl', 'herb', 'smith', 'gambler', 'monk'];
const rowOf = (run: RtRunState): number => { const p = run.pending as { nodeId?: string } | null; return p?.nodeId ? runRow(rtNode(run, p.nodeId)!.row) : 0; };
/** A meta run as the view starts it (`startRun`, the hero chosen, its locked items): won, lost at row 2–4, or left open (abandoned). */
function metaRun(store: RtProfileStore, k: number, end: 'win' | 'death' | 'open', extra: Partial<WalkOptions> = {}): RtRunState {
  store.startRun();
  const options: WalkOptions = { k, create: { gift: 'mini', feats: true, locked: store.locked(), hero: store.heroChoice() }, ...end === 'death' ? { loseAt: run => rowOf(run) >= 2 + (k % 3) } : {}, ...extra };
  if (end !== 'open') return walkRun(options).run;
  let open: RtRunState | null = null;
  walkRun({ ...options, each: state => { if (!open && !state.pending && state.visited.length >= 4) open = state; } });
  assert(open && !(open as RtRunState).result, `seed ${k}: an open run to abandon`);
  return open;
}
/** The line `npc` says in the camp after the last run, the context built from the store as the view builds it. */
function campLine(store: RtProfileStore, npc: NpcId, extra: Partial<LineContext> = {}): ReturnType<typeof pickLine> {
  const camp = store.hearth(), back = store.returnView(), l = camp.last!;
  return pickLine(npc, {
    others: NPCS, ...l.hero ? { hero: l.hero } : {}, ...back.monkFire && npc === 'monk' ? { fire: true } : {}, ...camp.self[npc as 'herb'] ? { self: true } : {},
    last: { won: l.won, ...l.cause ? { cause: l.cause as DeathCause } : {}, ...back.revive ? { revive: back.revive.n, ...back.revive.after ? { reviveAfter: true } : {} } : {}, ...l.firstCastle ? { castleFirst: true } : {} },
    ...extra,
  }, camp.lines);
}
const revived = (store: RtProfileStore): number | undefined => store.load().meta?.hearth?.revived;

check('Г.5.1: a meta run lost counts a return; the camp plays the full scene; a reload before the camp still plays it, after it — no scene', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  const run = metaRun(store, 1, 'death');
  assert(run.result?.outcome === 'defeat', 'the walk lost its run');
  assert(revived(store) === undefined && store.returnView().scene === null, 'no return before the run is applied');
  store.endRunMeta(run);
  assert(revived(store) === 1, `revived ${revived(store)}`);
  assert(createRtProfileStore(storage).returnView().scene === 'full', 'a reload before the camp: the scene is still due');
  // The end screen reloaded (the same run applied again) counts nothing more.
  store.endRunMeta(run);
  assert(revived(store) === 1, 'the same run twice — one return');
  assert(store.markReviveSeen() && !store.markReviveSeen(), 'the scene marked once');
  const again = createRtProfileStore(storage).returnView();
  assert(again.scene === null && again.revive?.n === 1 && again.scorches.light === 1, `after the scene: none, the return's lines still the visit's (${JSON.stringify(again)})`);
});

check('Г.5.2: a won run, an abandoned one, a seeded one — no return, no scene; a death not shown before a later run is not shown after it', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  const won = metaRun(store, 2, 'win');
  assert(won.result?.outcome === 'victory', 'the walk won its run');
  store.endRunMeta(won);
  store.endRunMeta(metaRun(store, 3, 'open'));
  assert(revived(store) === undefined && store.returnView().scene === null && store.returnView().revive === undefined, 'a win and an abandoned run: no return');
  assert(!storage.data.get(RT_PROFILE_STORAGE_KEY)!.includes('revived'), 'no field written');
  // A seeded run (`?seed=`, «Поход дня» is seeded too) changes nothing at all.
  const before = storage.data.get(RT_PROFILE_STORAGE_KEY);
  const seeded = walkRun({ k: 4, create: { gift: 'full', seeded: true }, loseAt: run => rowOf(run) >= 2 }).run;
  assert(seeded.result?.outcome === 'defeat' && store.endRunMeta(seeded) === null && storage.data.get(RT_PROFILE_STORAGE_KEY) === before, 'a seeded death: the profile byte for byte');
  // A death, the camp not entered, then a win: the win's camp plays no return scene (the death's lines are gone too).
  store.endRunMeta(metaRun(store, 5, 'death'));
  assert(store.returnView().scene === 'full', 'the death is due');
  store.endRunMeta(metaRun(store, 6, 'win'));
  const view = store.returnView();
  assert(revived(store) === 1 && view.scene === null && view.revive === undefined && view.scorches.light === 1, `after the win: ${JSON.stringify(view)}`);
});

check('Г.5.3: the first death — Неясыть says `revive_first` above the meeting and the death cause; after Ведунья\'s run her variant and her own line', () => {
  const store = createRtProfileStore(memoryStorage());
  store.endRunMeta(metaRun(store, 7, 'death'));
  const owl = campLine(store, 'owl');
  assert(owl.key === 'revive_first' && owl.text === NPC_LINES.owl.revive_first![0], `owl: ${owl.key} «${owl.text}»`);
  store.markLine(owl.id);
  // The meeting comes on the next click of the visit (the view's `said`: no last run), the return line is said once.
  const next = pickLine('owl', { others: NPCS }, store.hearth().lines);
  assert(next.key === 'first', `then the meeting: ${next.key}`);
  assert(campLine(store, 'owl').key !== 'revive_first', 'said once');
  // Ведунья: freed by a won run (the Jailer), chosen; her first death is the profile's second return.
  const her = createRtProfileStore(memoryStorage());
  her.endRunMeta(metaRun(her, 8, 'win'));
  assert(her.chooseHero(RT_TOAD_ID), 'Ведунья freed and chosen');
  her.endRunMeta(metaRun(her, 9, 'death'));
  const back = her.returnView(), last = her.hearth().last!;
  assert(last.hero === RT_TOAD_ID && back.revive?.n === 1 && back.scene === 'full', `her death: ${JSON.stringify(back)}`);
  const key = toadRunKey({ ...last, revive: back.revive.n }, her.hearth().lines);
  assert(key === 'revive_first' && toadLine(key, her.hearth().lines).text === TOAD_LINES.revive_first[0], `her own line: ${key}`);
  her.markLine(toadLine('revive_first', her.hearth().lines).id);
  assert(toadRunKey({ ...last, revive: back.revive.n }, her.hearth().lines) !== 'revive_first', 'her own line once');
  const owlToad = campLine(her, 'owl');
  assert(owlToad.key === 'revive_first' && owlToad.text === TOAD_LINES_BY_NPC.owl.revive_first![0] && owlToad.id === 'owl:revive_first:toad', `owl after her run: «${owlToad.text}»`);
});

check('Г.5.4: 12 deaths in a row — 10 scorches and 2 darker; full scenes the first three, short later; the key N to its NPC only, none past 5', () => {
  const store = createRtProfileStore(memoryStorage());
  const scenes: (string | null)[] = [];
  for (let n = 1; n <= 12; n++) {
    store.endRunMeta(metaRun(store, 10 + n, 'death'));
    const view = store.returnView();
    assert(view.revive?.n === n, `death ${n}: the occasion ${JSON.stringify(view.revive)}`);
    scenes.push(view.scene);
    // Who says a return line now: the one NPC of the key N (the pool `revive_first` … `revive_5`); the others the death's cause.
    const keys = NPCS.map(npc => campLine(store, npc).key).filter(key => key.startsWith('revive_'));
    const want = n === 1 ? ['revive_first'] : n <= 5 ? [`revive_${n}`] : [];
    assert(JSON.stringify(keys) === JSON.stringify(want), `death ${n}: return lines ${keys}`);
    store.markReviveSeen();
  }
  assert(scenes.join(',') === [...Array(RT_REVIVE_FULL).fill('full'), ...Array(12 - RT_REVIVE_FULL).fill('short')].join(','), `scenes ${scenes}`);
  const scorches = store.returnView().scorches;
  assert(revived(store) === 12 && scorches.light === 10 && scorches.dark === 2, `scorches ${JSON.stringify(scorches)}`);
});

check('Г.5.4: a profile without the fields (saved before task 61, a death in its last run) reads with no return and writes byte for byte; the first death after it brings `scorch_retro`', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  store.endRunMeta(metaRun(store, 30, 'win'));
  store.endRunMeta(metaRun(store, 31, 'death'));
  // The same profile as the code before task 61 stored it: the return not counted.
  const stored = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!);
  delete stored.meta.hearth.revived;
  const old = JSON.stringify(stored);
  assert(!old.includes('revived') && !old.includes('reviveSeen') && !old.includes('afterWin') && old.includes('"cause"'), 'an old profile with a death');
  storage.data.set(RT_PROFILE_STORAGE_KEY, old);
  const view = store.returnView();
  assert(view.scene === null && view.revive === undefined && view.scorches.light === 0 && !view.retro && view.fire === 'warm' && !view.afterWinScene, `old: ${JSON.stringify(view)}`);
  assert(!store.markReviveSeen() && !store.markAfterWinLine() && !store.markAfterWinScene() && storage.data.get(RT_PROFILE_STORAGE_KEY) === old, 'the marks write nothing');
  assert(store.chooseHero('cat') && storage.data.get(RT_PROFILE_STORAGE_KEY) === old, 'read and written byte for byte');
  assert(JSON.stringify(parseRtProfile(old)) === old, 'parsed byte for byte');
  // Its first counted death: the owl explains the clean stones once (runs before it).
  store.endRunMeta(metaRun(store, 32, 'death'));
  assert(store.returnView().revive?.n === 1 && store.returnView().retro, 'scorch_retro due');
  store.markLine('owl:scorch_retro');
  assert(!store.returnView().retro, 'said once');
  // A new profile's first run lost: no retro (nothing to wash away).
  const fresh = createRtProfileStore(memoryStorage());
  fresh.endRunMeta(metaRun(fresh, 33, 'death'));
  assert(fresh.returnView().revive?.n === 1 && !fresh.returnView().retro, 'a new profile: no retro');
});

check('Г.1: the stored fields read only when sound — whole counts from 1, `reviveSeen` not above `revived`, `afterWin.at` whole, its marks only `true`', () => {
  const base = { heroes: {}, hearth: { stock: 0, levels: { owl: 0, herb: 0, smith: 0 }, met: {}, lines: {}, quiet: 0 } };
  const read = (hearth: object, afterWin?: unknown) => parseRtMeta({ ...base, hearth: { ...base.hearth, ...hearth }, ...afterWin !== undefined ? { afterWin } : {} })!;
  assert(read({ revived: 3, reviveSeen: 2 }).hearth!.revived === 3 && read({ revived: 3, reviveSeen: 2 }).hearth!.reviveSeen === 2, 'sound');
  for (const bad of [0, -1, 1.5, '2', null]) assert(read({ revived: bad }).hearth!.revived === undefined, `revived ${bad}`);
  assert(read({ revived: 2, reviveSeen: 3 }).hearth!.reviveSeen === undefined && read({ reviveSeen: 1 }).hearth!.reviveSeen === undefined, 'reviveSeen above revived');
  assert(JSON.stringify(read({}, { at: 7, revived: 2, line: true, scene: 'yes', monk: 1, extra: 1 }).afterWin) === '{"at":7,"revived":2,"line":true}', 'afterWin');
  for (const bad of [{}, { at: -1 }, { at: '3' }, 5, null]) assert(read({}, bad).afterWin === undefined, `afterWin ${JSON.stringify(bad)}`);
});

check('Г.5.5: the profile with the first castle win (Node, spec Г.8): the end line once; the camp scene once — the fire turquoise, Евлампий comes and says `first_fire`; `win_castle_first`', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let k = 40; k < 44; k++) store.endRunMeta(metaRun(store, k, 'death'));
  store.markReviveSeen();
  // The castle is not in the run yet: a real won run applied as the castle's (`castleWon`), the profile written as the store writes it.
  const run = metaRun(store, 44, 'win'), profile = store.load();
  assert(run.result?.outcome === 'victory' && !profile.meta!.hearth!.met.monk, 'a won run; Евлампий not at the fire');
  const applied = rtApplyMeta(profile.meta, run, { viewerRun: profile.runs, castleWon: true });
  assert(applied.end.afterWin === true && applied.meta.afterWin?.at === profile.runs && applied.meta.afterWin?.revived === 4 && applied.meta.hearth!.last!.firstCastle === true, `the gate: ${JSON.stringify(applied.meta.afterWin)}`);
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ ...profile, meta: applied.meta }));
  // The end screen: the line once (a reload of the screen — the same end — says it no more).
  assert(RT_RUN_END_TEXT.afterWin === 'Летопись не дописана', 'the line (Д11)');
  assert(rtAfterWinLineDue(store.load().meta, applied.end) && store.markAfterWinLine(), 'the line said');
  assert(!rtAfterWinLineDue(createRtProfileStore(storage).load().meta, applied.end) && !store.markAfterWinLine(), 'once');
  // The camp: the scene due, Евлампий comes with it; the fire turquoise from now on. Неясыть's meeting was said at the earlier camps.
  while (campLine(store, 'owl').key === 'first') store.markLine('owl:first');
  const camp = store.returnView();
  assert(camp.afterWinScene && camp.monkComes && camp.fire === 'turquoise' && camp.scene === null, `the camp: ${JSON.stringify(camp)}`);
  assert(campLine(store, 'owl').key === 'win_castle_first' && campLine(store, 'owl').text === NPC_LINES.owl.win_castle_first![0], 'Неясыть: win_castle_first');
  assert(store.markAfterWinScene() && !store.markAfterWinScene(), 'the scene marked once');
  const after = createRtProfileStore(storage), view = after.returnView(), hearth = after.load().meta!.hearth!;
  assert(!view.afterWinScene && !view.monkComes && view.monkFire && view.fire === 'turquoise' && hearth.met.monk === true && hearth.self?.monk === true, `after the scene: ${JSON.stringify(view)}`);
  assert(after.hearth().met.monk && after.chronicle().pages.length > 0, 'Евлампий at the fire');
  const meet = campLine(after, 'monk');
  assert(meet.key === 'first_fire' && meet.text === NPC_LINES.monk.first_fire![0], `Евлампий meets: ${meet.key}`);
  after.markLine(meet.id);
  const second = campLine(after, 'monk');
  assert(second.key === 'win_castle_first' && second.text === NPC_LINES.monk.win_castle_first![0], `then: ${second.key}`);
  // A second castle win changes nothing of the layer.
  const twice = rtApplyMeta(after.load().meta, metaRun(after, 45, 'win'), { castleWon: true });
  assert(twice.end.afterWin === undefined && JSON.stringify(twice.meta.afterWin) === JSON.stringify(after.load().meta!.afterWin) && !twice.meta.hearth!.last!.firstCastle, 'once a profile');
});

check('Б.3, А.4: the first death after the first win — `revive_after` (Неясыть, Евлампий; above `revive_5`) and a full scene; the next death a short one', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage);
  for (let k = 50; k < 54; k++) { store.endRunMeta(metaRun(store, k, 'death')); store.markReviveSeen(); }
  const profile = store.load(), won = rtApplyMeta(profile.meta, metaRun(store, 54, 'win'), { viewerRun: store.load().runs, castleWon: true, monk: true });
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ ...store.load(), meta: won.meta }));
  store.markAfterWinScene();
  store.endRunMeta(metaRun(store, 55, 'death'));
  const view = store.returnView();
  assert(view.revive?.n === 5 && view.revive.after && view.scene === 'full', `the first death after the win: ${JSON.stringify(view)}`);
  const said = Object.fromEntries(NPCS.map(npc => [npc, campLine(store, npc).key]));
  assert(said.owl === 'revive_after' && said.monk === 'revive_after' && !Object.values(said).includes('revive_5'), `lines ${JSON.stringify(said)}`);
  assert(campLine(store, 'monk').text === NPC_LINES.monk.revive_after![0] && campLine(store, 'owl').text === NPC_LINES.owl.revive_after![0], 'the texts');
  store.markReviveSeen();
  store.endRunMeta(metaRun(store, 56, 'death'));
  assert(store.returnView().revive?.after === undefined && store.returnView().scene === 'short', 'the next death: short, no revive_after');
});

check('the lines of task 61 are the spec\'s drafts (tables А.4 and Б.3, `scorch_retro` of А.5) word for word, under their NPC and key; the cat\'s are marked, her variants apart', () => {
  const DOC = readFileSync(new URL('../../../docs/design-notes/task-61-return-and-beyond.md', import.meta.url), 'utf8') as string;
  const NAMES: Record<string, NpcId> = { 'Неясыть': 'owl', 'Марфа': 'herb', 'Ерофей': 'smith', 'Шиш': 'gambler', 'Евлампий': 'monk' };
  const rows: { key: string; npc: NpcId; text: string; mark: string }[] = [];
  let own = '';
  const lines = DOC.split(/\r?\n/), part = (from: string, to: string): string[] => lines.slice(lines.findIndex(l => l.startsWith(from)), lines.findIndex(l => l.startsWith(to)));
  for (const l of [...part('### А.4.', '### А.5.'), ...part('### Б.3.', '### Б.4.')]) {
    // `| key | who | when | text | mark |` (А.4) and `| key | who | text | mark |` (Б.3); a variant row says «(вариант)».
    const m = /^\| `([a-z_0-9:]+)`(?: \(вариант\))? \| ([^|]+?) \|(?: [^|]+ \|)? ([^|]+?) \| (?:`(cat|toad)`|—) \|\s*$/.exec(l);
    if (m && m[1] === 'toad:revive_first') own = m[3];
    else if (m && NAMES[m[2]]) rows.push({ key: m[1], npc: NAMES[m[2]], text: m[3], mark: m[4] ?? '' });
  }
  const retro = /`scorch_retro`: «([^»]+)»/.exec(DOC);
  assert(rows.length === 14 && retro && own, `${rows.length} rows of the tables`);
  rows.push({ key: 'scorch_retro', npc: 'owl', text: retro[1], mark: '' });
  const want: Record<string, string[]> = {};
  for (const r of rows) (want[`${r.npc}.${r.key}${r.mark === 'toad' ? ':toad' : ''}`] ??= []).push(r.text);
  const got: Record<string, string[]> = {};
  for (const npc of NPCS) for (const key of RETURN_KEYS) {
    if (NPC_LINES[npc][key]) got[`${npc}.${key}`] = [...NPC_LINES[npc][key]!];
    if (TOAD_LINES_BY_NPC[npc][key]) got[`${npc}.${key}:toad`] = [...TOAD_LINES_BY_NPC[npc][key]!];
  }
  assert(JSON.stringify(Object.keys(want).sort()) === JSON.stringify(Object.keys(got).sort()), `keys ${Object.keys(got).sort()}`);
  for (const k of Object.keys(want)) assert(JSON.stringify(want[k]) === JSON.stringify(got[k]), `${k}: ${JSON.stringify(got[k])}`);
  assert(TOAD_LINES.revive_first[0] === own, 'her own line');
  // The cat's mark: after her run the marked line is not said (her variant, or no line of the key); after the cat's it is.
  for (const r of rows) if (r.mark === 'cat') {
    const memory = { [`${r.npc}:first`]: 9 }, last = r.key === 'win_castle_first' ? { won: true, castleFirst: true } : { won: false, cause: 'other' as const, revive: r.key === 'revive_first' ? 1 : Number(r.key.slice(-1)) };
    assert(pickLine(r.npc, { others: NPCS, hero: 'toad', last }, memory).text !== r.text && pickLine(r.npc, { others: NPCS, last }, memory).text === r.text, `${r.npc}.${r.key}: the mark`);
  }
});

console.log(`${checks} checks passed`);
