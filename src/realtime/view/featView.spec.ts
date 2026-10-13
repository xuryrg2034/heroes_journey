/**
 * Task 16 «Подвиги», the view (view/featView.ts) and the first-meeting memory (view/firstMeet.ts): the card's line of every feat a
 * run's nodes draw, the HUD line and the door line read from the sim's own `featProgress` over real ticks of a fight with a feat
 * (an `afterGoals` feat waits before the goals, grows after them, «Подвиг ✓» once done), the result row with the kinds the run pays
 * (names of forest/resources.ts), and the memory of first meetings (once ever, kept, a broken storage). Node only:
 * `npm run test:realtime-feat-view`. The drawing at 1280×720 by real input is tests/realtime-feats.spec.ts.
 */
import { registerArena } from '../sim/arenas';
import { featProgress, featResult } from '../sim/feat';
import { defaultParams } from '../sim/params';
import { Simulation } from '../sim/simulation';
import { createRtRun, rtFeatKinds, rtFeatRoll, rtMapNodes, rtFeatNode } from '../run/rtRun';
import { RESOURCES } from '../forest/resources';
import { featCardLine, FeatDoorView, featGoalText, featHudText, featHudTitle, featResultRow, featRewardText } from './featView';
import { FIRST_MEET_KEY, FirstMeetStore } from './firstMeet';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'feat-view-field', name: 'Поле подвига (вид)', summary: 'Тест вида подвига', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 3,
});

/** A quiet fight with the feat `kind` N (the run's `Params.feats` on, the loadout carrying it). */
function fight(kind: 'score' | 'afterGoals' | 'arena', n: number): Simulation {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 0; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.feats = true;
  const sim = new Simulation({ arena: 'feat-view-field', params: p, seed: seedOf(1), loadout: { feat: { kind, n } } });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const ticks = (sim: Simulation, seconds: number): void => { for (let i = 0; i < Math.round(seconds * 60); i++) sim.tick(); };

check('card lines: every feat of 40 seeds\' nodes reads «Подвиг: <goal> → <reward>»; the reward by number only; an event node «если будет бой»', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 40; k++) {
    const run = createRtRun(seedOf(k), { gift: 'mini', feats: true });
    for (const node of rtMapNodes(run).filter(rtFeatNode)) {
      const feat = rtFeatRoll(run.seed, node), line = featCardLine(feat, node.type === 'event');
      assert(line.label === (node.type === 'event' ? 'Подвиг, если будет бой' : 'Подвиг'), `label ${line.label}`);
      const goal = feat.kind === 'score' ? `набери ${feat.n} очков` : feat.kind === 'afterGoals' ? `продержись ${feat.n} с после целей` : `продержись ${feat.n} с на арене`;
      const reward = 'talisman' in feat.reward ? 'талисман на выбор' : `${feat.reward.resources} ресурса`;
      assert(line.text === `${goal} → ${reward}`, `${node.id}: «${line.text}» / «${goal} → ${reward}»`);
      assert(!Object.values(RESOURCES).some(r => line.text.includes(r.label)), `no kind on the card: ${line.text}`);
      seen.add(`${feat.kind}:${'talisman' in feat.reward ? 't' : 'r'}:${node.type === 'event'}`);
    }
  }
  for (const want of ['score:r:false', 'afterGoals:r:false', 'arena:r:false', 'score:t:false', 'afterGoals:r:true']) assert(seen.has(want), `seen ${want}: ${[...seen]}`);
  assert(featGoalText('score', 1) === 'набери 1 очко' && featGoalText('score', 22) === 'набери 22 очка' && featRewardText({ resources: 4 }) === '4 ресурса' && featRewardText({ resources: 5 }) === '5 ресурсов', 'words');
});

check('HUD and door: an «after the goals» feat waits (0/20 с, no door line), grows after the goals (the door line = the HUD line), «Подвиг ✓» at 20 s', () => {
  const sim = fight('afterGoals', 20), w = sim.world, door = new FeatDoorView(72);
  ticks(sim, 2);
  let p = featProgress(w)!;
  assert(p.waiting && featHudText(p) === 'Подвиг 0/20 с' && featHudTitle(p) === 'Подвиг: продержись 20 с после целей (счёт пойдёт после целей)', `waiting: ${featHudText(p)} / ${featHudTitle(p)}`);
  door.draw(w, false);
  assert(!door.shown.visible, 'no door line before the goals');
  sim.command({ t: 'goals' });
  ticks(sim, 5.5);
  p = featProgress(w)!;
  assert(!p.waiting && featHudText(p) === 'Подвиг 5/20 с', `grown: ${featHudText(p)}`);
  door.draw(w, true);
  assert(door.shown.visible && door.shown.text === 'Подвиг 5/20 с', `door: ${JSON.stringify(door.shown)}`);
  ticks(sim, 15);
  p = featProgress(w)!;
  assert(p.done && featHudText(p) === 'Подвиг ✓', `done: ${featHudText(p)}`);
  door.draw(w, true);
  assert(!door.shown.visible, 'no door line once done');
});

check('HUD: score «Подвиг 0/800»; arena seconds whole «Подвиг 3/60 с»', () => {
  const score = fight('score', 800);
  ticks(score, 0.5);
  assert(featHudText(featProgress(score.world)!) === 'Подвиг 0/800', featHudText(featProgress(score.world)!));
  const arena = fight('arena', 60);
  ticks(arena, 3.5);
  assert(featHudText(featProgress(arena.world)!) === 'Подвиг 3/60 с', featHudText(featProgress(arena.world)!));
});

check('result row: done — «+3 — 1 Смола, 2 Травы» (the run\'s kinds, names of forest/resources.ts); a talisman; done and lost; not done — grey', () => {
  const kinds = rtFeatKinds(seedOf(3), 'r5c0', 3), feat = { kind: 'afterGoals' as const, n: 20, reward: { resources: 3 } };
  const row = featResultRow(feat, { done: true, value: 20 }, true, kinds)!;
  const counts = Object.entries(RESOURCES).map(([kind, r]) => [r.label, kinds.filter(k => k === kind).length] as const).filter(([, n]) => n > 0);
  assert(row.text === `+3 — ${counts.map(([label, n]) => `${n} ${label}`).join(', ')}` && !row.grey, `row ${row.text}`);
  assert(featResultRow({ ...feat, reward: { talisman: true } }, { done: true, value: 20 }, true, [])!.text === 'талисман на выбор', 'talisman');
  const lost = featResultRow(feat, { done: true, value: 20 }, false, kinds)!;
  assert(lost.grey && lost.text === 'выполнен, но поражение — 0', `lost ${lost.text}`);
  const sim = fight('score', 800);
  ticks(sim, 1);
  const missed = featResultRow({ kind: 'score', n: 800, reward: { resources: 3 } }, featResult(sim.world), true, [])!;
  assert(missed.grey && missed.text === 'не выполнен — 0/800', `missed ${missed.text}`);
  assert(featResultRow(null, null, true, []) === null, 'no feat — no row');
});

check('first meetings: once ever, kept by a reload; a broken record or storage — nothing met, no throw', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const a = new FirstMeetStore(storage);
  assert(a.meet('feat') && !a.meet('feat') && a.meet('heal-button'), 'once');
  const b = new FirstMeetStore(storage);
  assert(b.has('feat') && b.has('heal-button') && !b.has('bag') && !b.meet('feat'), 'kept');
  assert(JSON.parse(data.get(FIRST_MEET_KEY)!).met.join() === 'feat,heal-button', data.get(FIRST_MEET_KEY)!);
  data.set(FIRST_MEET_KEY, '{oops');
  assert(new FirstMeetStore(storage).meet('feat'), 'broken record — new');
  const throwing = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  const c = new FirstMeetStore(throwing);
  assert(c.meet('bag') && !c.meet('bag'), 'no storage — the page keeps it');
});
