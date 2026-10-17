/**
 * Task 49, the camp's lines by the hero of the last run (view/npcLines.ts `CAT_MARKED`, `pickLine`; view/heroLines.ts `toadRunKey`):
 * after Ведунья's run (`LineContext.hero` 'toad') no line that carries the mark `cat` is said — on any occasion, on many turns of the
 * memory — and every occasion still has a line; after the cat's run (no hero) the marked lines are said as before. Her own lines of
 * the run: the record, the death by the crowd / the Jailer / any other cause. Node only: `npm run test:realtime-npc-lines`.
 */
import { CAT_MARKED, NPC_LINES, pickLine, type DeathCause, type LineContext, type LineKey } from './npcLines';
import { toadRunKey, TOAD_LINES } from './heroLines';
import type { NpcId } from './metaModel';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const NPCS: NpcId[] = ['owl', 'herb', 'smith'];
const CAUSES: DeathCause[] = ['crowd', 'archer', 'sapper', 'jailer', 'final', 'fire', 'other'];
const OCCASIONS: Partial<LineContext>[] = [
  {}, { self: true }, { bought: 2 },
  { last: { won: true, firstWin: true } }, { last: { won: true } }, { last: { won: true, record: true } }, { last: { won: false, record: true } },
  { last: { won: false, questDone: true } }, { last: { won: false, questFail: true } }, { last: { won: false, pack: true } },
  ...CAUSES.map(cause => ({ last: { won: false, cause } })),
];
const marked = (npc: NpcId, key: LineKey, text: string): boolean => (CAT_MARKED[npc][key] ?? []).some(i => NPC_LINES[npc][key]![i - 1] === text);

check('the marks point at real lines (every place is inside its key\'s list) and name the cat\'s words', () => {
  let n = 0;
  for (const npc of NPCS) for (const [key, places] of Object.entries(CAT_MARKED[npc])) for (const i of places!) {
    const list = NPC_LINES[npc][key as LineKey];
    assert(list && i >= 1 && i <= list.length, `${npc}.${key}(${i}) is not a line`);
    n++;
  }
  assert(n >= 50, `${n} marks`);
});

check('after her run no marked line is said, on any occasion and any turn of the memory; every occasion still has a line', () => {
  for (const npc of NPCS) for (const ctx of OCCASIONS) for (let turn = 0; turn < 6; turn++) {
    const memory = Object.fromEntries((Object.keys(NPC_LINES[npc]) as LineKey[]).map(k => [`${npc}:${k}`, turn]));
    const line = pickLine(npc, { others: NPCS, hero: 'toad', ...ctx }, memory);
    assert(line.text, `${npc}: a line`);
    assert(!marked(npc, line.key, line.text), `${npc} ${JSON.stringify(ctx)} turn ${turn}: marked «${line.text}» after her run`);
  }
});

check('after the cat\'s run (no hero) the marked lines are said as before: the first death by the crowd of the owl is her first line', () => {
  const line = pickLine('owl', { others: NPCS, last: { won: false, cause: 'crowd' } }, { 'owl:first': 9 });
  assert(line.key === 'death_crowd' && line.text === NPC_LINES.owl.death_crowd![0], `got ${line.text}`);
  const hers = pickLine('owl', { others: NPCS, hero: 'toad', last: { won: false, cause: 'crowd' } }, { 'owl:first': 9 });
  assert(hers.text !== line.text, 'after her run the first line is skipped');
  let said = 0;
  for (let t = 0; t < 4; t++) if (marked('owl', 'death_crowd', pickLine('owl', { others: NPCS, last: { won: false, cause: 'crowd' } }, { 'owl:first': 9, 'owl:death_crowd': t }).text)) said++;
  assert(said === 4, 'the cat hears both marked lines in turn');
});

check('her lines of the run: the record first, then the death by cause (crowd, Jailer, any other); a win without a record — none', () => {
  assert(toadRunKey({ won: false, beaten: true, cause: 'crowd' }) === 'record', 'record first');
  assert(toadRunKey({ won: false, beaten: false, cause: 'crowd' }) === 'death_crowd' && toadRunKey({ won: false, beaten: false, cause: 'jailer' }) === 'death_jailer', 'crowd and Jailer');
  for (const cause of ['archer', 'sapper', 'final', 'fire', 'troll', undefined]) assert(toadRunKey({ won: false, beaten: false, cause }) === 'death_other', `other: ${cause}`);
  assert(toadRunKey({ won: true, beaten: false }) === null, 'a win without a record');
  assert(TOAD_LINES.death_crowd[0].includes('замкнуть') && TOAD_LINES.record.length === 1, 'the design\'s lines');
});
