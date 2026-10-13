/**
 * Task 16 «Подвиги» (sim/feat.ts; run/rtRun.ts `rtFeatOf`, `rtNodeFeat`, `finishBattleNode`; run/rtRunStorage.ts `featsOn`;
 * docs/realtime-slice.md, «Подвиги»). Node only: `npm run test:realtime-feats`.
 *
 * The run goes by its own commands; its arenas are real fights — journalled commands on the quiet test field of
 * runFight.testkit.ts (chains for the score, ticks for the seconds, the goals, the walk into the door, a ring that kills).
 * Checks:
 * - the same run seed gives every node the same feat whatever the path; the card shows what the battle plays; the seeds vary
 *   the kinds and rewards (all three kinds, both rewards over many seeds); the Jailer's and the final fight have none;
 * - each kind is done by real play and not before its condition: «очки» by chains, «после целей» by waiting alive after the
 *   goals (waiting before them), «на арене» by the fight's time; the event `feat` `done` comes once;
 * - the reward only through the door: resources at the door; a talisman choice after the fight's own screens (a «Застава»
 *   offer first), rerollable, reloadable; a pool too short — resources by the row; a death after the feat or a door before it
 *   pays nothing;
 * - a first run (profile without the Jailer) has no feats and no new state; a save before the rule loads and saves byte for
 *   byte; feats move no existing stream; the profile's `jailer` stays once set; `startRun` counts the viewer's runs;
 * - the fight replays from its journal; a journal without the key plays the world without the feat;
 * - telemetry: the run record's `feats` (done, when, how much was missing, what was paid), `viewerRun`, `firsts`, the fight's
 *   `novelty`, the choice's `realSeconds`, the feat's choice source; the records pass `checkRecord`; the report has its sections.
 * The test sets the talisman pool by hand only where it says so (a short pool the real walk does not reach). Seeds
 * `Math.imul(k, 2654435761) >>> 0`.
 */
import {
  createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseTalisman, rtEnterNode, rtFeatOf, rtFeatResources, rtFeatRoll,
  rtMapNodes, rtNode, rtNodeFeat, rtRerollTalismans, rtRerollView, rtRunParams, serializeRtRun, RT_FEAT_TALISMANS,
  type RtArenaOutcome, type RtFeat, type RtRunState, type RtRunStep,
} from './rtRun';
import { runRow } from './arenaPools';
import { stockTotal } from '../forest/merchant';
import { RT_TALISMANS } from './rtTalismans';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { defaultParams } from '../sim/params';
import { featProgress, FEAT_KINDS, type FeatKind } from '../sim/feat';
import { replay, Simulation } from '../sim/simulation';
import type { World, WorldEvent } from '../sim/world';
import { createFightObserver } from '../telemetry/observe';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { checkRecord, FEAT_SOURCE, type FightRecord, type RunRecord } from '../telemetry/schema';
import { chainOf, closeNode, ok, playFight, quiet, same, seedOf, takeGift, ticks, type FightPlan } from './runFight.testkit';
import before from '../../../tests/fixtures/rt-run-save-before-reroll.json';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

const reload = (run: RtRunState): RtRunState => { const back = parseRtRun(serializeRtRun(run)); assert(back, 'the save loads'); return back; };
const newRun = (k: number, feats = true): RtRunState => takeGift(createRtRun(seedOf(k), { gift: 'mini', feats }));
const pendingFeat = (run: RtRunState): RtFeat | undefined => (run.pending?.kind === 'battle' ? run.pending.feat : undefined);
const openNode = (run: RtRunState) => (run.pending && 'nodeId' in run.pending ? rtNode(run, run.pending.nodeId)! : undefined);
const materials = (run: RtRunState): number => stockTotal(run.materials);
const bagOf = (outcome: RtArenaOutcome): number => Object.values(outcome.bag ?? {}).reduce((a, b) => a + (b ?? 0), 0);
/** The latch read through a call (no narrowing across the ticks). */
const latch = (w: World): World['feat'] => w.feat;
const featEvents = (events: readonly WorldEvent[]) => events.filter(ev => ev.type === 'feat');

/** Closes non-battle screens until the map or a battle (a talisman screen refused). */
function toMap(run: RtRunState): RtRunState {
  for (let i = 0; i < 20 && run.pending && run.pending.kind !== 'battle' && !run.result; i++) run = closeNode(run);
  return run;
}
/** A plain won fight (goals, the door), `plan` added. */
const win = (run: RtRunState, extra: Partial<FightPlan> = {}): { run: RtRunState; step: RtRunStep; outcome: RtArenaOutcome; events: WorldEvent[] } => {
  const { outcome, events } = playFight(run, { chains: [3], params: rtRunParams(quiet()), ...extra });
  const step = resolveArena(run, outcome);
  return { run: ok(step, 'resolve'), step, outcome, events };
};
/**
 * The run walks by its own commands (the node `prefer` picks first, else the first available) to an open battle whose feat
 * passes `want`; the battles before it are won plainly. Null — the run ended or none came.
 */
function walkTo(run: RtRunState, want: (feat: RtFeat | undefined, run: RtRunState) => boolean, prefer: (type: string) => boolean = () => false): RtRunState | null {
  for (let i = 0; i < 400 && !run.result; i++) {
    run = toMap(run);
    if (run.pending?.kind === 'battle') {
      if (want(pendingFeat(run), run)) return run;
      run = toMap(win(run).run);
      continue;
    }
    if (run.pending || run.result) continue;
    const next = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, (next.find(n => prefer(n.type)) ?? next[0]).id), 'enter');
  }
  return null;
}
/** The first seed (k from `from`) whose walk reaches a battle with a feat that passes `want`. */
function findBattle(want: (feat: RtFeat | undefined, run: RtRunState) => boolean, prefer?: (type: string) => boolean, from = 1): { run: RtRunState; k: number } {
  for (let k = from; k < from + 80; k++) {
    const run = walkTo(newRun(k), want, prefer);
    if (run) return { run, k };
  }
  throw new Error('no such battle in 80 seeds');
}
const ofKind = (kind: FeatKind, reward?: 'resources' | 'talisman') => (feat: RtFeat | undefined): boolean => !!feat && feat.kind === kind && (!reward || reward in feat.reward);

// ---------- The draw ----------

await check('the same seed gives each node the same feat whatever the path; the card shows what the battle plays', () => {
  for (let k = 1; k <= 6; k++) {
    // Two walks of one seed by different first nodes: every node both walks reach has the same feat on its card and in its battle.
    const a = newRun(k), first = rtAvailableNodes(a);
    const walks = [first[0], first[first.length - 1]].map(start => {
      let run = ok(rtEnterNode(a, start.id), 'enter'), seen = new Map<string, string>();
      for (let i = 0; i < 40 && !run.result; i++) {
        run = toMap(run);
        if (run.pending?.kind === 'battle') { seen.set(run.pending.nodeId, JSON.stringify(pendingFeat(run) ?? null)); run = toMap(win(run).run); continue; }
        if (run.pending) continue;
        const next = rtAvailableNodes(run);
        for (const node of next) seen.set(`card:${node.id}`, JSON.stringify(rtNodeFeat(run, node)));
        const node = next.find(n => n.type === 'battle' || n.type === 'hard') ?? next[0], card = rtNodeFeat(run, node);
        run = ok(rtEnterNode(run, node.id), 'enter');
        if (run.pending?.kind === 'battle') assert(same(pendingFeat(run) ?? null, card), `the card of ${node.id} shows what its battle plays: ${JSON.stringify(card)} / ${JSON.stringify(pendingFeat(run))}`);
      }
      return seen;
    });
    let common = 0;
    for (const [id, feat] of walks[0]) if (walks[1].has(id)) { common++; assert(walks[1].get(id) === feat, `seed ${k}, ${id}: ${feat} / ${walks[1].get(id)}`); }
    assert(common > 0, `seed ${k}: the walks share nodes`);
  }
});

await check('seeds vary the kinds and the rewards; the Jailer and the final have none; an event node has one', () => {
  const kinds: Record<string, number> = {}, rewards = { resources: 0, talisman: 0 };
  const perSeed: string[] = [];
  for (let k = 1; k <= 60; k++) {
    const run = newRun(k), line: string[] = [];
    for (const node of rtMapNodes(run)) {
      const feat = rtFeatOf(run, node);
      if (node.type === 'checkpoint' || node.type === 'boss' || !['battle', 'hard', 'breakthrough', 'event'].includes(node.type)) { assert(feat === null, `${node.type} has no feat`); continue; }
      assert(feat, `${node.type} ${node.id} has a feat`);
      kinds[feat.kind] = (kinds[feat.kind] ?? 0) + 1;
      rewards['talisman' in feat.reward ? 'talisman' : 'resources']++;
      line.push(`${node.id}:${feat.kind}`);
      // Reproducible: a second run of the seed gives the same.
      assert(same(rtFeatOf(newRun(k), node), feat), 'the same seed, the same feat');
    }
    perSeed.push(line.join(','));
  }
  const all = Object.values(kinds).reduce((a, b) => a + b, 0);
  for (const kind of FEAT_KINDS) assert((kinds[kind] ?? 0) > all * 0.2, `kind ${kind}: ${kinds[kind]} of ${all}`);
  const share = rewards.talisman / all;
  assert(share > 0.15 && share < 0.35, `talisman rewards ${rewards.talisman} of ${all}`);
  assert(new Set(perSeed).size === perSeed.length, 'every seed has its own feats');
});

await check('N grows with the run row (rows 1–3 below rows 7+) for each kind; the resources reward too', () => {
  const byKind = new Map<FeatKind, Map<number, Set<number>>>(), res = new Map<number, Set<number>>();
  for (let k = 1; k <= 30; k++) for (const node of rtMapNodes(newRun(k))) {
    if (!['battle', 'hard', 'breakthrough', 'event'].includes(node.type)) continue;
    const roll = rtFeatRoll(seedOf(k), node), row = runRow(node.row);
    const rows = byKind.get(roll.kind) ?? new Map<number, Set<number>>(); byKind.set(roll.kind, rows);
    (rows.get(row) ?? rows.set(row, new Set()).get(row)!).add(roll.n);
    if ('resources' in roll.reward) (res.get(row) ?? res.set(row, new Set()).get(row)!).add(roll.reward.resources);
  }
  for (const [kind, rows] of byKind) {
    const low = Math.max(...[1, 2, 3].flatMap(r => [...rows.get(r) ?? []])), high = Math.min(...[7, 8, 9].flatMap(r => [...rows.get(r) ?? []]));
    assert(Number.isFinite(low) && Number.isFinite(high) && low < high, `${kind}: rows 1–3 ≤ ${low} < rows 7+ ${high}`);
    for (const set of rows.values()) assert(set.size === 1, `${kind}: one N a row`);
  }
  assert(Math.max(...res.get(1) ?? []) < Math.min(...res.get(8) ?? [Infinity]), 'more resources deeper');
});

// ---------- Each kind by real play ----------

await check('«Набери N очков»: done by the chain that brings the score to N, not before; resources at the door', () => {
  const { run } = findBattle(ofKind('score', 'resources'));
  const feat = pendingFeat(run)!, before = materials(run);
  assert(same(rtArenaLoadout(run).feat, { kind: 'score', n: feat.n }), 'the loadout carries the feat');
  let crossed = 0;
  const { outcome, events, sim } = playFight(run, { chains: [], params: rtRunParams(quiet()), play: (s, seen) => {
    for (let i = 0; i < 200 && s.world.stats.score < feat.n; i++) {
      const was = s.world.stats.score;
      assert(!s.world.feat && !featProgress(s.world)!.done, `not done at ${was} < ${feat.n}`);
      chainOf(s, 8, seen);
      if (s.world.stats.score >= feat.n) crossed = was;
    }
  } });
  assert(crossed > 0 && crossed < feat.n && sim.world.stats.score >= feat.n, `the last chain crossed ${feat.n}`);
  assert(featEvents(events).length === 1 && outcome.feat?.done === true, 'one feat event, done');
  const step = resolveArena(run, outcome), next = ok(step, 'resolve');
  const paid = step.ok ? step.events.find(ev => ev.type === 'feat-paid') : undefined;
  assert(paid?.type === 'feat-paid' && paid.resources.length === (feat.reward as { resources: number }).resources && !paid.fallback, 'the door paid the resources');
  assert(materials(next) === before + paid.resources.length + bagOf(outcome), `materials ${before} → ${materials(next)}`);
  assert(next.battles[next.battles.length - 1].feat?.done === true, 'the record keeps it done');
});

await check('«Продержись N с после целей»: waiting before the goals, done N s after them alive, not a tick before', () => {
  const { run } = findBattle(ofKind('afterGoals'));
  const feat = pendingFeat(run)!;
  const { outcome, events } = playFight(run, { chains: [], params: rtRunParams(quiet()), play: (s, seen) => {
    ticks(s, 120, seen);
    const wait = featProgress(s.world)!;
    assert(wait.waiting && wait.value === 0 && !wait.done, `waiting before the goals: ${JSON.stringify(wait)}`);
    s.command({ t: 'goals' });
    const start = s.world.greedStart!;
    ticks(s, 60 * 600, seen, w => w.time - start >= feat.n - 0.5);
    assert(!s.world.feat && featProgress(s.world)!.value < feat.n, 'not done half a second before');
    ticks(s, 60 * 5, seen, w => !!w.feat);
    const at = latch(s.world);
    assert(at && Math.abs(at.time - start - feat.n) < 1 / 30, `done at goals + ${feat.n}: ${at?.time} (goals ${start})`);
  } });
  assert(featEvents(events).length === 1 && outcome.feat?.done === true && outcome.feat.at !== undefined, 'done once');
  ok(resolveArena(run, outcome), 'resolve');
});

await check('«Продержись N с на арене»: done at N s of the fight; a death after it pays nothing, the record keeps it done', () => {
  const { run } = findBattle(ofKind('arena'));
  const feat = pendingFeat(run)!, before = materials(run);
  const { outcome, events } = playFight(run, { chains: [], lose: true, params: rtRunParams(quiet()), play: (s, seen) => {
    ticks(s, 60 * 600, seen, w => w.time >= feat.n - 0.5);
    assert(!s.world.feat, 'not before N');
    ticks(s, 60 * 5, seen, w => !!w.feat);
    const at = latch(s.world);
    assert(at && Math.abs(at.time - feat.n) < 1 / 30, `done at ${feat.n}: ${at?.time}`);
  } });
  assert(outcome.won === false && outcome.feat?.done === true && featEvents(events).length === 1, 'done, then the hero fell');
  const step = resolveArena(run, outcome), next = ok(step, 'resolve');
  assert(next.result?.outcome === 'defeat' && materials(next) === before, 'the defeat pays nothing');
  assert(step.ok && !step.events.some(ev => ev.type === 'feat-paid') && next.battles[next.battles.length - 1].feat?.done === true, 'no feat-paid; the record: done');
});

await check('a death before the feat\'s seconds: not done, no event, the record keeps it not done', () => {
  const { run } = findBattle(ofKind('arena'));
  const feat = pendingFeat(run)!;
  const { outcome, events, sim } = playFight(run, { chains: [], lose: true, params: rtRunParams(quiet()) });
  assert(sim.world.time < feat.n && !sim.world.feat && featProgress(sim.world)!.value < feat.n, `the hero fell at ${sim.world.time} s < ${feat.n}`);
  assert(outcome.feat?.done === false && !featEvents(events).length, 'not done, no event');
  const next = ok(resolveArena(run, outcome), 'resolve');
  assert(next.battles[next.battles.length - 1].feat?.done === false, 'the record: not done');
});

await check('the door before the feat: not done, nothing paid (the grey line), the run goes on', () => {
  const { run } = findBattle(ofKind('afterGoals', 'resources'));
  const before = materials(run);
  const { outcome, step, run: next } = win(run, { chains: [3] });
  assert(outcome.won && outcome.feat?.done === false, 'won without the feat');
  assert(step.ok && !step.events.some(ev => ev.type === 'feat-paid') && materials(next) === before + bagOf(outcome), 'nothing for the feat');
  const record = next.battles[next.battles.length - 1];
  assert(record.feat && record.feat.done === false && record.feat.kind === 'afterGoals', 'the record keeps the feat, not done');
});

// ---------- The talisman reward ----------

/** Wins the open battle with its «на арене» / «после целей» / «очки» feat done (the shortest real play for its kind). */
function winDone(run: RtRunState): { run: RtRunState; step: RtRunStep; outcome: RtArenaOutcome } {
  const feat = pendingFeat(run)!;
  const play: FightPlan['play'] = (s, seen) => {
    if (feat.kind === 'score') for (let i = 0; i < 200 && s.world.stats.score < feat.n; i++) chainOf(s, 8, seen);
    else { if (feat.kind === 'afterGoals') s.command({ t: 'goals' }); ticks(s, 60 * 600, seen, w => !!w.feat); }
    assert(s.world.feat, 'the feat is done');
  };
  const { outcome } = playFight(run, { chains: [], params: rtRunParams(quiet()), play });
  const step = resolveArena(run, outcome);
  return { run: ok(step, 'resolve'), step, outcome };
}

await check('a talisman reward: its choice of two comes last (after «Застава»\'s offer), reloads, rerolls, and gives the talisman', () => {
  const { run } = findBattle((feat, r) => !!feat && 'talisman' in feat.reward && openNode(r)!.type === 'hard', type => type === 'hard');
  const done = winDone(run);
  let next = done.run;
  assert(next.pending?.kind === 'talisman' && next.pending.source === 'hard', 'the «Застава» offer first');
  next = reload(ok(rtChooseTalisman(next, null), 'refuse the hard offer'));
  assert(next.pending?.kind === 'talisman' && next.pending.source === 'feat' && next.pending.options.length === RT_FEAT_TALISMANS, `then the feat's choice of ${RT_FEAT_TALISMANS}`);
  const streams = JSON.stringify(next.streams);
  // The reroll (as «Застава»'s): paid, a new offer without the shown ones; a reload keeps it.
  next = { ...next, materials: { ...next.materials, dew: next.materials.dew + 3 } };
  const view = rtRerollView(next);
  assert(view?.available, `the feat's offer rerolls: ${JSON.stringify(view)}`);
  const shown = next.pending?.kind === 'talisman' ? [...next.pending.options] : [];
  next = reload(ok(rtRerollTalismans(next), 'reroll'));
  assert(next.pending?.kind === 'talisman' && next.pending.options.every(id => !shown.includes(id)) && JSON.stringify(next.streams) !== streams, 'a new offer (a talismans draw)');
  const pick = next.pending.options[0];
  next = ok(rtChooseTalisman(next, pick), 'take');
  assert(next.talismans.includes(pick) && !next.pending && next.visited.includes(run.pending!.kind === 'battle' ? run.pending.nodeId : ''), 'taken; the node completed');
});

await check('a talisman reward with too few talismans: resources by the row instead — at the card and at the payout', () => {
  const { run } = findBattle(feat => !!feat && 'talisman' in feat.reward);
  const node = openNode(run)!, row = runRow(node.row);
  // By hand: every talisman but one out of the pool (the real walk does not empty it).
  const short = (r: RtRunState): RtRunState => ({ ...r, talismansGone: RT_TALISMANS.map(t => t.id).filter(id => id !== RT_TALISMANS[0].id && !r.talismans.includes(id)) });
  assert(same(rtFeatOf(short(run), node)!.reward, { resources: rtFeatResources(row) }), 'the card shows resources when the pool is short');
  const done = winDone(short(run)), before = materials(short(run));
  const step = done.step;
  const paid = step.ok ? step.events.find(ev => ev.type === 'feat-paid') : undefined;
  assert(paid?.type === 'feat-paid' && paid.fallback === true && paid.resources.length === rtFeatResources(row), 'paid by the row instead');
  assert(!(done.run.pending?.kind === 'talisman' && done.run.pending.source === 'feat') && materials(done.run) >= before + rtFeatResources(row), 'no feat screen');
  assert(reload(short(run)), 'the open battle with its talisman feat loads with a short pool');
});

// ---------- First run, old saves, streams, the profile ----------

await check('a first run (no Jailer in the profile) has no feats: no flag, no card, no loadout field, the fight has no feat', () => {
  const storage = memory(), profile = createRtProfileStore(storage);
  assert(!profile.featsOn(), 'an empty profile: no feats');
  const run = takeGift(createRtRun(seedOf(3), { gift: 'mini', feats: profile.featsOn() }));
  assert(run.feats === undefined && !serializeRtRun(run).includes('feat'), 'no flag in the save');
  const battle = walkTo(run, () => true)!;
  assert(rtMapNodes(battle).every(node => rtNodeFeat(battle, node) === null) && pendingFeat(battle) === undefined && rtArenaLoadout(battle).feat === undefined, 'no feat anywhere');
  const { outcome, events, sim } = playFight(battle, { chains: [3], params: rtRunParams(quiet()) });
  assert(!sim.world.feat && featProgress(sim.world) === null && outcome.feat === undefined && !featEvents(events).length, 'the fight has no feat');
  const next = ok(resolveArena(battle, outcome), 'resolve');
  assert(next.battles.every(b => b.feat === undefined) && !serializeRtRun(next).includes('feat'), 'no feat in the records');
});

await check('feats move no existing stream: the same walk with and without them takes the same arenas, rosters and draws', () => {
  for (let k = 1; k <= 4; k++) {
    let a = newRun(k, true), b = newRun(k, false);
    for (let i = 0; i < 30 && !a.result; i++) {
      a = toMap(a); b = toMap(b);
      if (a.pending?.kind === 'battle') { a = toMap(win(a).run); b = toMap(win(b).run); continue; }
      if (a.pending) continue;
      const id = (rtAvailableNodes(a).find(n => n.type === 'battle') ?? rtAvailableNodes(a)[0]).id;
      a = ok(rtEnterNode(a, id), 'enter'); b = ok(rtEnterNode(b, id), 'enter');
      assert(same(a.picks, b.picks) && same(a.streams, b.streams) && a.oathDraws === b.oathDraws, `seed ${k}: the same picks and draws`);
    }
  }
});

await check('a save before the rule loads and saves byte for byte, without feats; malformed feats are no run', () => {
  for (const text of [before.hard, before.event]) {
    const old = parseRtRun(text);
    assert(old && old.feats === undefined && serializeRtRun(old) === text, 'the old save loads and saves byte for byte');
    assert(rtMapNodes(old).every(node => rtNodeFeat(old, node) === null), 'no feats on its map');
  }
  const { run } = findBattle(ofKind('score'));
  assert(reload(run) && same(reload(run), run), 'an open battle with a feat reloads');
  const bad = (change: (r: RtRunState) => void): boolean => { const r = structuredClone(run); change(r); return parseRtRun(serializeRtRun(r)) === null; };
  assert(bad(r => { delete r.feats; }), 'a feat without the flag');
  assert(bad(r => { (r.pending as { feat: RtFeat }).feat.n += 1; }), 'another N');
  assert(bad(r => { (r.pending as { feat: RtFeat }).feat.kind = 'arena'; }), 'another kind');
  assert(bad(r => { (r.pending as { feat: RtFeat }).feat.reward = { resources: 9 }; }), 'another reward');
  assert(bad(r => { (r as unknown as { feats: boolean }).feats = false; }), 'a flag not true');
});

function memory(): RunStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
}

await check('the profile: `jailer` once a run reached the Jailer, and it stays; an old giftFull reads as it; `startRun` counts', () => {
  const storage = memory(), profile = createRtProfileStore(storage);
  assert(profile.startRun() === 1 && profile.startRun() === 2, 'runs 1, 2');
  profile.endRun({ reachedJailer: false, seeded: false });
  assert(!profile.featsOn(), 'no Jailer yet');
  profile.endRun({ reachedJailer: true, seeded: true });
  assert(!profile.featsOn(), 'a seeded run changes nothing');
  profile.endRun({ reachedJailer: true, seeded: false });
  assert(profile.featsOn() && profile.giftKind(false) === 'full', 'the Jailer reached: feats and the full gift');
  profile.endRun({ reachedJailer: false, seeded: false });
  assert(profile.featsOn() && profile.giftKind(false) === 'mini', 'a later short run: still feats, the gift back to mini');
  assert(profile.startRun() === 3, 'run 3');
  const old = memory();
  old.setItem(RT_PROFILE_STORAGE_KEY, '{"version":1,"giftFull":true}');
  assert(createRtProfileStore(old).featsOn(), 'an old profile with giftFull: feats');
  const plain = memory();
  plain.setItem(RT_PROFILE_STORAGE_KEY, '{"version":1,"giftFull":false}');
  createRtProfileStore(plain).endRun({ reachedJailer: false, seeded: false });
  assert(plain.getItem(RT_PROFILE_STORAGE_KEY) === '{"version":1,"giftFull":false}', 'a profile without the new fields saves as before');
});

// ---------- The simulation: replay, the journal without the key ----------

await check('a fight with a feat replays from its journal; without the key (or the kit\'s feat) the world has no feat', () => {
  const { run } = findBattle(ofKind('arena'));
  const feat = pendingFeat(run)!;
  const sim = new Simulation({ arena: 'run-fight-field', params: rtRunParams(quiet()), seed: seedOf(9), record: true, loadout: rtArenaLoadout(run), hero: { hp: run.hp, maxHp: run.maxHp } });
  sim.command({ t: 'clear', keepMarked: false });
  const hashes: string[] = [];
  for (let i = 0; i < 60 * (feat.n + 2); i++) { sim.tick(); sim.world.events.length = 0; if (sim.world.tick % 300 === 0) hashes.push(sim.hash()); }
  assert(sim.world.feat, 'done');
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!));
  const back = new Simulation({ arena: journal.arena, params: journal.params, seed: journal.seed, loadout: journal.loadout, hero: journal.hero });
  const again: string[] = [];
  for (let i = 0; i < journal.ticks; i++) { for (const e of journal.commands.filter((c: { tick: number }) => c.tick === i)) back.command(e.cmd); back.tick(); if (back.world.tick % 300 === 0) again.push(back.hash()); }
  assert(same(hashes, again) && back.hash() === sim.hash() && replay(journal).hash() === sim.hash(), 'the same hashes every 300 ticks and at the end');
  const off = structuredClone(journal);
  delete off.params.feats;
  const w: World = replay(off).world;
  assert(!w.feat && featProgress(w) === null, 'without the key: no feat');
  const noKit = structuredClone(journal);
  delete noKit.loadout.feat;
  assert(!replay(noKit).world.feat, 'without the kit\'s feat: no feat');
});

// ---------- Telemetry ----------

await check('telemetry: the run record\'s feats, viewerRun, firsts, the fight\'s novelty and feat, the choice\'s realSeconds; checkRecord', async () => {
  const fake = (): KeyValueStore => {
    const map = new Map<string, string>();
    return { getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
  };
  const sessionFake = (): SessionStore => { const map = new Map<string, string>(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }; };
  const local = fake();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: rtRunParams(defaultParams()), observer: createFightObserver, local, sessionStore: sessionFake(), channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const { run: start, k } = findBattle(feat => !!feat && 'talisman' in feat.reward);
  let run = start;
  rec.runStarted(null, run, 2);
  rec.firstMeet(run, 'feat');
  const feed = (step: RtRunStep, realSeconds?: number): void => { assert(step.ok, step.ok ? '' : step.reason); rec.runStep(run, step, realSeconds === undefined ? {} : { realSeconds }); run = step.run; };
  const node = openNode(run)!, feat = pendingFeat(run)!;
  // The fight recorded as the view records it, with a first meeting in it.
  const { outcome } = playFight(run, { chains: [], k, params: rtRunParams(quiet()), start: s => { rec.beginFight(s, { nodeId: node.id, row: runRow(node.row), runState: run }); rec.firstMeet(run, 'kind:wolf'); rec.firstMeet(run, 'kind:wolf'); },
    play: (s, seen) => {
      if (feat.kind === 'score') for (let i = 0; i < 200 && s.world.stats.score < feat.n; i++) chainOf(s, 8, seen);
      else { if (feat.kind === 'afterGoals') s.command({ t: 'goals' }); ticks(s, 60 * 600, seen, w => !!w.feat); }
      rec.beforeTick(s.world);
    } });
  rec.endFight('victory');
  feed(resolveArena(run, outcome));
  while (run.pending?.kind === 'talisman' && run.pending.source !== 'feat') feed(rtChooseTalisman(run, null), 1.5);
  assert(run.pending?.kind === 'talisman' && run.pending.source === 'feat', 'the feat\'s screen');
  feed(rtChooseTalisman(run, run.pending.options[1]), 2.25);
  await new Promise(r => setTimeout(r, 20));
  const records = await rec.buffer.all();
  const r = records.filter((x): x is RunRecord => x.kind === 'run').pop()!, f = records.filter((x): x is FightRecord => x.kind === 'fight').pop()!;
  assert(checkRecord(r) === null && checkRecord(f) === null, `records pass: ${checkRecord(r)} ${checkRecord(f)}`);
  assert(r.viewerRun === 2 && r.featsOn === true, 'viewerRun, featsOn');
  assert(same(r.firsts?.map(x => x.id), ['feat', 'kind:wolf']) && r.firsts![0].fight === null && r.firsts![1].fight === f.fight, `firsts ${JSON.stringify(r.firsts)}`);
  assert(f.summary.novelty === 2 && f.summary.feat?.done === true && f.summary.feat.kind === feat.kind && f.summary.feat.missing === 0, `fight summary ${JSON.stringify(f.summary.feat)} novelty ${f.summary.novelty}`);
  const rf = r.feats?.[0];
  assert(rf && rf.done && rf.won && rf.paid === 'talisman' && rf.kind === feat.kind && rf.n === feat.n && rf.at !== null && rf.fight === f.fight, `run feats ${JSON.stringify(r.feats)}`);
  const choice = r.choices.find(c => c.source === FEAT_SOURCE);
  assert(choice && choice.taken.length === 1 && choice.realSeconds === 2.25, `the feat's choice ${JSON.stringify(choice)}`);
  assert(checkRecord({ ...r, viewerRun: 0 }) === 'run viewerRun' && checkRecord({ ...r, feats: [{}] }) === 'run feats' && checkRecord({ ...r, firsts: [{ id: '' }] }) === 'run firsts', 'malformed fields refused');
  assert(checkRecord({ ...r, choices: [{ ...r.choices[0], realSeconds: -1 }] }) === 'run choice realSeconds', 'a negative time refused');
  rec.dispose();
});

await check('telemetry: a door before the feat — the run record says not done and how much was missing', async () => {
  const fake = (): KeyValueStore => {
    const map = new Map<string, string>();
    return { getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
  };
  const local = fake();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: rtRunParams(defaultParams()), observer: createFightObserver, local, sessionStore: null, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const { run: start, k } = findBattle(ofKind('score'));
  let run = start;
  rec.runStarted(null, run);
  const node = openNode(run)!, feat = pendingFeat(run)!;
  const { outcome, sim } = playFight(run, { chains: [4], k, params: rtRunParams(quiet()), start: s => rec.beginFight(s, { nodeId: node.id, row: runRow(node.row), runState: run }) });
  rec.endFight('victory');
  const step = resolveArena(run, outcome);
  rec.runStep(run, step as Extract<RtRunStep, { ok: true }>); run = ok(step, 'resolve');
  await new Promise(r => setTimeout(r, 20));
  const r = (await rec.buffer.all()).filter((x): x is RunRecord => x.kind === 'run').pop()!;
  const rf = r.feats?.[0];
  assert(rf && !rf.done && rf.won && rf.paid === null && rf.at === null && rf.missing === feat.n - sim.world.stats.score && r.viewerRun === undefined, `run feats ${JSON.stringify(r.feats)}`);
  assert(checkRecord(r) === null, 'the record passes');
  rec.dispose();
});

console.log(`feats: ${checks} checks ok`);
