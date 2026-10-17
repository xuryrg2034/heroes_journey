/**
 * Task 49, the camp's lines by the hero of the last run (view/npcLines.ts `CAT_MARKED`, `pickLine`; view/heroLines.ts `toadRunKey`):
 * after Ведунья's run (`LineContext.hero` 'toad') no line that carries the mark `cat` is said — on any occasion, on many turns of the
 * memory — and every occasion still has a line; after the cat's run (no hero) the marked lines are said as before. Her own lines of
 * the run: the record, the death by the crowd / the Jailer / any other cause. Node only: `npm run test:realtime-npc-lines`.
 */
// The project has no Node typings (the design table is read as text, Node only).
// @ts-expect-error node:fs has no declarations here
import { readFileSync } from 'node:fs';
import { CAT_MARKED, NPC_LINES, pickLine, type DeathCause, type LineContext, type LineKey } from './npcLines';
import { toadRunKey, TOAD_LINES } from './heroLines';
import type { NpcId } from './metaModel';
import { TOAD_LINES_BY_NPC } from './npcToadLines';

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
    const memory = Object.fromEntries((Object.keys(NPC_LINES[npc]) as LineKey[]).flatMap(k => [[`${npc}:${k}`, turn], [`${npc}:${k}:toad`, turn]]));
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

const DOC = readFileSync(new URL('../../../docs/design-notes/npc-lines-v2.md', import.meta.url), 'utf8').split(/\r?\n/);
const NAMES: Record<string, NpcId | undefined> = { 'Неясыть': 'owl', 'Марфа': 'herb', 'Ерофей': 'smith' };

check('the 89 variants of the design table: every row of Неясыть, Марфа, Ерофей is in the data under its NPC and key, in the table order, word for word; Шиш and Евлампий rows wait', () => {
  const from = DOC.findIndex((l: string) => l.startsWith('### Варианты для Ведуньи')), rows: { who: string; key: string; text: string }[] = [];
  for (const l of DOC.slice(from)) {
    if (l.startsWith('| NPC | Метка')) break;
    const m = /^\| (Неясыть|Марфа|Ерофей|Шиш|Евлампий) \| `([a-z_0-9]+)` \| (.*) \|\s*$/.exec(l);
    if (m) rows.push({ who: m[1], key: m[2], text: m[3] });
  }
  assert(rows.length === 89, `${rows.length} rows in the table`);
  const ours = rows.filter(r => NAMES[r.who]);
  const expected: Record<string, string[]> = {};
  for (const r of ours) (expected[`${NAMES[r.who]}.${r.key}`] ??= []).push(r.text);
  const got: Record<string, string[]> = {};
  for (const npc of NPCS) for (const [key, list] of Object.entries(TOAD_LINES_BY_NPC[npc])) got[`${npc}.${key}`] = [...list!];
  assert(JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(Object.keys(got).sort()), 'the same NPC and key pairs');
  for (const k of Object.keys(expected)) assert(JSON.stringify(expected[k]) === JSON.stringify(got[k]), `${k}: the text of the table`);
  assert(ours.length === 53 && Object.values(got).flat().length === 53, `${ours.length} rows of the three NPC`);
});

check('the table of the mark cat (v1 rows) is CAT_MARKED, place for place', () => {
  const from = DOC.findIndex((l: string) => l.startsWith('### Метка `cat`')), table: Record<string, number[]> = {};
  for (const l of DOC.slice(from)) {
    if (l.startsWith('### ') && !l.includes('Метка')) break;
    const m = /^\| (Неясыть|Марфа|Ерофей) \| v1 \| `([a-z_0-9]+)`(?: \((\d+)\))? \|/.exec(l);
    if (m) (table[`${NAMES[m[1]]}.${m[2]}`] ??= []).push(m[3] ? Number(m[3]) : 1);
  }
  const ours: Record<string, number[]> = {};
  for (const npc of NPCS) for (const [key, places] of Object.entries(CAT_MARKED[npc])) ours[`${npc}.${key}`] = [...places!];
  assert(Object.values(table).flat().length === 53, `${Object.values(table).flat().length} v1 marks in the table`);
  assert(JSON.stringify(Object.keys(table).sort()) === JSON.stringify(Object.keys(ours).sort()), 'the same keys');
  for (const k of Object.keys(table)) assert(JSON.stringify([...table[k]].sort()) === JSON.stringify([...ours[k]].sort()), `${k}: marks ${table[k]} vs ${ours[k]}`);
});

check('after her run her variant goes first and is counted apart (npc:key:toad); after the cat run no variant is said', () => {
  for (const npc of NPCS) for (const key of ['win', 'record', 'death_crowd', 'death_other'] as const) {
    const variants = TOAD_LINES_BY_NPC[npc][key];
    if (!variants?.length) continue;
    const ctx = key === 'win' ? { won: true } : key === 'record' ? { won: false, record: true } : { won: false, cause: key === 'death_crowd' ? 'crowd' as const : 'other' as const };
    // The cat has said this key many times: her counter is her own, the first show is her first variant, without «опять».
    const met = { [`${npc}:first:toad`]: 99, [`${npc}:first_self:toad`]: 99, [`${npc}:win_first:toad`]: 99 };
    const first = pickLine(npc, { others: NPCS, hero: 'toad', last: ctx }, { ...met, [`${npc}:${key}`]: 7 });
    assert(first.text === variants[0] && first.id === `${npc}:${key}:toad`, `${npc} ${key}: first ${first.text}`);
    const second = pickLine(npc, { others: NPCS, hero: 'toad', last: ctx }, { ...met, [`${npc}:${key}`]: 7, [`${npc}:${key}:toad`]: 1 });
    const list = [...variants, ...(NPC_LINES[npc][key] ?? []).filter((_, i) => !(CAT_MARKED[npc][key] ?? []).includes(i + 1))];
    assert(second.text === list[1 % list.length], `${npc} ${key}: second`);
    for (let t = 0; t < 6; t++) {
      const cat = pickLine(npc, { others: NPCS, last: ctx }, { [`${npc}:first`]: 99, [`${npc}:${key}`]: t, [`${npc}:${key}:toad`]: t });
      assert(!variants.includes(cat.text) && cat.id === `${npc}:${key}`, `${npc} ${key}: the cat hears no variant`);
    }
  }
});
