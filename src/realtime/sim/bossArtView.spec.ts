/**
 * «Зона нажатия босса по рисунку»: one number for the simulation and the view. The press zones of `sim/bossArt.ts` (`BOSS_ART`) are the
 * view's drawings — its box sides and feet (trollView, chiefView, warlockView, render.ts `JAILER_ART`, `GARRISON_ART`), the club's
 * pose (`CLUB_GRIP`, `CLUB_HAND`) and the pictures' aspects (public/art/characters/*.png). A drawing resized in the view without the
 * table (or the other way) fails here. Read from the sources and the PNG headers (no view module is loaded). Node only:
 * `npm run test:realtime-boss-pick-art`.
 */
// @ts-expect-error node:fs has no declarations here
import { readFileSync } from 'node:fs';
import { BOSS_ART } from './bossArt';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const source = (file: string): string => readFileSync(new URL(`../view/${file}`, import.meta.url), 'utf8');
/** The number a source gives `pattern` (its first group). */
function numberIn(text: string, pattern: RegExp, what: string): number {
  const m = pattern.exec(text);
  assert(m, `${what}: not found`);
  return Number(m[1]);
}
/** The picture's height / width from its PNG header. */
function aspectOf(id: string): number {
  const b = readFileSync(new URL(`../../../public/art/characters/${id}.png`, import.meta.url));
  return b.readUInt32BE(20) / b.readUInt32BE(16);
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

check('the boxes: the cores\' sides and feet, the parts\' sides and the ladle\'s and sack\'s drop are the view\'s numbers', () => {
  const troll = source('trollView.ts'), chief = source('chiefView.ts'), warlock = source('warlockView.ts'), render = source('render.ts');
  const want: [string, number, number | undefined, number | undefined][] = [
    ['troll', numberIn(troll, /export const TROLL_ART = ([\d.]+);/, 'TROLL_ART'), numberIn(troll, /export const TROLL_FEET = ([\d.]+);/, 'TROLL_FEET'), undefined],
    ['chief', numberIn(chief, /export const CHIEF_ART = ([\d.]+);/, 'CHIEF_ART'), numberIn(chief, /export const CHIEF_FEET = ([\d.]+);/, 'CHIEF_FEET'), undefined],
    ['warlock', numberIn(warlock, /export const WARLOCK_ART = ([\d.]+);/, 'WARLOCK_ART'), numberIn(warlock, /export const WARLOCK_FEET = ([\d.]+);/, 'WARLOCK_FEET'), undefined],
    ['jailer', numberIn(render, /const JAILER_ART = ([\d.]+);/, 'JAILER_ART'), numberIn(render, /const JAILER_FEET = ([\d.]+);/, 'JAILER_FEET'), undefined],
    // GARRISON_ART: the drawing stands on the disc's bottom (one body radius below the centre).
    ['castellan', numberIn(render, /\[CASTELLAN\]: \{ id: 'castellan', size: ([\d.]+) \}/, 'GARRISON_ART castellan'), 1, undefined],
    ['troll-club', numberIn(troll, /const CLUB_ART = ([\d.]+);/, 'CLUB_ART'), undefined, undefined],
    ['troll-rock', numberIn(troll, /const ROCK_ART = ([\d.]+);/, 'ROCK_ART'), undefined, undefined],
    ['troll-tail', numberIn(troll, /const KNOT_ART = ([\d.]+);/, 'KNOT_ART'), undefined, undefined],
    ['chief-ladle', numberIn(chief, /const LADLE_ART = ([\d.]+)/, 'LADLE_ART'), undefined, -numberIn(render, /part\.position\.set\(0, -r \* ([\d.]+)\)/, 'chief part drop')],
    ['chief-sack', numberIn(chief, /SACK_ART = ([\d.]+);/, 'SACK_ART'), undefined, -numberIn(render, /part\.position\.set\(0, -r \* ([\d.]+)\)/, 'chief part drop')],
  ];
  for (const [kind, side, feet, dy] of want) {
    const box = BOSS_ART[kind];
    assert(box && near(box.side, side) && box.feet === feet && (box.dy ?? undefined) === dy, `${kind}: the table ${JSON.stringify(box)}, the view side ${side}, feet ${feet}, drop ${dy}`);
  }
  assert(Object.keys(BOSS_ART).length === want.length, `every drawing checked (${Object.keys(BOSS_ART).join(', ')})`);
});

check('the aspects: the pictures\' height / width (the knot is drawn with the rock\'s picture)', () => {
  const pictures: Record<string, string> = { troll: 'troll', chief: 'chief', warlock: 'warlock', jailer: 'jailer', castellan: 'castellan', 'troll-club': 'troll-club', 'troll-rock': 'troll-rock', 'troll-tail': 'troll-rock', 'chief-ladle': 'chief-ladle', 'chief-sack': 'chief-sack' };
  for (const [kind, id] of Object.entries(pictures)) assert(near(BOSS_ART[kind].aspect, aspectOf(id)), `${kind}: the table ${BOSS_ART[kind].aspect}, ${id}.png ${aspectOf(id)}`);
});

check('the club\'s pose: the grip and the paw\'s angle are the view\'s', () => {
  const troll = source('trollView.ts'), sim = readFileSync(new URL('./bossArt.ts', import.meta.url), 'utf8');
  for (const [name, pattern] of [['CLUB_GRIP', /const CLUB_GRIP = (\{ x: [\d.]+, y: [\d.]+ \});/], ['CLUB_HAND', /const CLUB_HAND = (-?[\d.]+);/], ['CLUB_AXIS', /const CLUB_AXIS = \w+\.?\w*\((\d+, \d+)\);/]] as const) {
    const v = pattern.exec(troll)?.[1], s = pattern.exec(sim)?.[1];
    assert(v !== undefined && v === s, `${name}: the view ${v}, the table ${s}`);
  }
});

console.log(`boss art = view: ${checks} checks passed`);
