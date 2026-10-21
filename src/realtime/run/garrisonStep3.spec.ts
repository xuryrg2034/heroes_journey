/**
 * Task 59б «Гарнизон, шаг 3» — the run's flag `step3` and the trails' drill (run/garrison.ts `garrisonDrill`, `RT_GARRISON_STEP3_ON`;
 * docs/realtime-slice.md, «Гарнизон, шаг 3»). Node only: `npm run test:realtime-garrison-step3`. The runs are walked by the run's
 * commands (metaWalk.testkit.ts); seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { garrisonDrill, RT_GARRISON_STEP3_ON, rtGarrisonNodeId } from './garrison';
import { walkRun } from './metaWalk.testkit';
import { createRtRun, parseRtRun, rtArenaLoadout, serializeRtRun, type RtRunState } from './rtRun';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

check('the game\'s default: `RT_GARRISON_STEP3_ON` off — a new run has no `step3`; asked for, a run of step 2 takes it with the seed\'s drill; without step 2 — none', () => {
  assert(RT_GARRISON_STEP3_ON === false && createRtRun(seedOf(1)).step3 === undefined, 'off by default');
  const run = createRtRun(seedOf(2), { step3: true });
  assert(run.step2 === true && run.step3?.drill === garrisonDrill(seedOf(2)), JSON.stringify(run.step3));
  assert(createRtRun(seedOf(3), { step3: true, step2: false }).step3 === undefined && createRtRun(seedOf(4), { step3: true, garrison: false }).step3 === undefined, 'only with step 2');
});

check('the drill: by the seed alone — both drills over 300 seeds, the same for the same seed; a walk into the garrison keeps the value its creation drew (the entry\'s draw)', () => {
  const drills = Array.from({ length: 300 }, (_, i) => createRtRun(seedOf(i + 1), { step3: true }).step3!.drill);
  const barracks = drills.filter(d => d === 'barracks').length;
  console.log(`   «Казарма» в ${barracks} походах из 300 (эвристика)`);
  assert(barracks > 0 && barracks < 300, `both drills (${barracks})`);
  assert(drills.every((d, i) => createRtRun(seedOf(i + 1), { step3: true }).step3!.drill === d), 'the same seed, the same drill');
  for (let k = 1; k <= 10; k++) {
    let entered: RtRunState | null = null;
    const walk = walkRun({ k, create: { gift: 'full', garrison: true, step3: true }, each: state => { if (!entered && state.pending?.kind === 'battle' && rtGarrisonNodeId(state.pending.nodeId)) entered = structuredClone(state); } });
    const at = entered as RtRunState | null;
    assert(at?.step3?.drill === garrisonDrill(walk.run.seed) && walk.run.step3?.drill === at.step3.drill, `seed ${k}: the drill at the garrison's first fight`);
  }
});

check('saves: a run of step 3 reads back byte for byte; `step3` without step 2, a forged drill or a stray key is no run', () => {
  const walk = walkRun({ k: 5, create: { gift: 'mini', garrison: true, step3: true } });
  const text = serializeRtRun(walk.run), back = parseRtRun(text);
  assert(back && serializeRtRun(back) === text, 'reads back');
  const forge = (edit: (v: Record<string, unknown>) => void): RtRunState | null => { const v = JSON.parse(text) as Record<string, unknown>; edit(v); return parseRtRun(JSON.stringify(v)); };
  assert(forge(v => { delete v.step2; }) === null, 'without step 2');
  assert(forge(v => { v.step3 = { drill: (v.step3 as { drill: string }).drill === 'armory' ? 'barracks' : 'armory' }; }) === null, 'a forged drill');
  assert(forge(v => { v.step3 = { drill: (v.step3 as { drill: string }).drill, x: 1 }; }) === null && forge(v => { v.step3 = true; }) === null, 'a stray shape');
});

check('a run without the flag plays the garrison of step 2 byte for byte: the garrison\'s fights (arena, knights, bolts, deep) and the final save of 300 walks — the digest of the base `8afcb20d`', () => {
  const lines: string[] = [];
  for (let k = 1; k <= 300; k++) {
    const seen = new Set<string>(), out: string[] = [];
    const walk = walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true }, each: state => {
      const p = state.pending;
      if (p?.kind !== 'battle' || !rtGarrisonNodeId(p.nodeId) || seen.has(p.nodeId)) return;
      seen.add(p.nodeId);
      const l = rtArenaLoadout(state);
      out.push(`${p.nodeId}:${p.arena}${l.knights ? '+k' + l.knights : ''}${l.bolts ? '+bolts' : ''}${l.deep ? '+deep' : ''}`);
    } });
    assert(walk.run.step3 === undefined, `seed ${k}: no flag`);
    lines.push(`${k} ${out.join(' ')} ${textHash(serializeRtRun(walk.run))}`);
  }
  // The digest of the same 300 walks on the base 8afcb20d (task 59а, before 59б): scratch probe, 21.10.2026.
  assert(textHash(lines.join('\n')) === 2747571745, `digest ${textHash(lines.join('\n'))}`);
});

console.log(`garrison step 3: ${checks} checks passed`);
