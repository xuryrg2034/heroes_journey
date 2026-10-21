/**
 * «Зона нажатия босса по рисунку»: one number for the simulation and the view. The press zones of `sim/bossArt.ts` (`BOSS_ART`) are the
 * view's drawings — its box sides and feet (trollView, chiefView, warlockView, render.ts `JAILER_ART`, `GARRISON_ART`), the club's
 * pose (`CLUB_GRIP`, `CLUB_HAND`) and the pictures' aspects (public/art/characters/*.png). A drawing resized in the view without the
 * table (or the other way) fails here. Read from the sources and the PNG headers (no view module is loaded). Node only:
 * `npm run test:realtime-boss-pick-art`.
 */
// Node 20 has no global navigator; pixi.js reads it on load (view/nodeNavigator.testkit.ts). First import.
import '../view/nodeNavigator.testkit';
// @ts-expect-error node:fs has no declarations here
import { readFileSync } from 'node:fs';
import { BOSS_ART } from './bossArt';
import { CHIEF_ART, CHIEF_FEET, LADLE_ART, SACK_ART } from '../view/chiefView';
import { JAILER_ART, JAILER_FEET } from '../view/render';
import { CLUB_ART, KNOT_ART, ROCK_ART, TROLL_ART, TROLL_ART_ASPECT, TROLL_FEET } from '../view/trollView';
import { WARLOCK_ART, WARLOCK_FEET } from '../view/warlockView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const source = (file: string): string => readFileSync(new URL(`../view/${file}`, import.meta.url), 'utf8');
/** The picture's height / width from its PNG header. */
function aspectOf(id: string): number {
  const b = readFileSync(new URL(`../../../public/art/characters/${id}.png`, import.meta.url));
  return b.readUInt32BE(20) / b.readUInt32BE(16);
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

check('the boxes: the drawings of the view (its exported sizes and feet) are the table numbers — one source, `BOSS_ART`, read by the view', () => {
  const want: [string, number, number | undefined][] = [
    ['troll', TROLL_ART, TROLL_FEET], ['chief', CHIEF_ART, CHIEF_FEET], ['warlock', WARLOCK_ART, WARLOCK_FEET], ['jailer', JAILER_ART, JAILER_FEET],
    ['troll-club', CLUB_ART, undefined], ['troll-rock', ROCK_ART, undefined], ['troll-tail', KNOT_ART, undefined], ['chief-ladle', LADLE_ART, undefined], ['chief-sack', SACK_ART, undefined],
  ];
  for (const [kind, side, feet] of want) {
    const box = BOSS_ART[kind];
    assert(box && near(box.side, side) && (box.feet ?? undefined) === feet, `${kind}: the table ${JSON.stringify(box)}, the view side ${side}, feet ${feet}`);
  }
  assert(near(TROLL_ART_ASPECT, BOSS_ART.troll.aspect), 'the Troll aspect: the view reads the table');
  // The Castellan, his crossbow and the chief parts drop are in render.ts's tables (not exported); their sources read the table by name.
  const render = source('render.ts');
  for (const name of ["BOSS_ART.castellan.side", "BOSS_ART['castellan-crossbow'].side", 'BOSS_ART[e.kind]?.dy']) assert(render.includes(name), `render.ts reads ${name} from the table`);
  assert(BOSS_ART['chief-ladle'].dy === BOSS_ART['chief-sack'].dy, 'the chief parts hang by one drop');
});

check('the aspects: the pictures\' height / width (the knot is drawn with the rock\'s picture)', () => {
  const pictures: Record<string, string> = { troll: 'troll', chief: 'chief', warlock: 'warlock', jailer: 'jailer', castellan: 'castellan', 'troll-club': 'troll-club', 'troll-rock': 'troll-rock', 'troll-tail': 'troll-rock', 'chief-ladle': 'chief-ladle', 'chief-sack': 'chief-sack', 'castellan-crossbow': 'garrison-crossbow' };
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
