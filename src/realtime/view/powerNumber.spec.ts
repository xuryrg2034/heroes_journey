/**
 * Task 8b, the power number of the drawn chain (view/powerNumber.ts): the first survivor decides (red, the power that reaches it),
 * no survivor — the power after the last link, no enemy link — no number. Node only: `npm run test:realtime-power-number`.
 * The number on screen by the real mouse is tests/realtime-camera.spec.ts.
 */
import { strike, type LinkPlan } from '../sim/chain';
import { planPowerNumber } from './powerNumber';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const enemy = (id: number, power: number, hp: number, plates = 0): { link: LinkPlan; after: number } => {
  const outcome = strike(power, hp, 1, 1, plates);
  return { link: { link: { kind: 'enemy', id }, outcome }, after: outcome.powerAfter };
};
/** A plan as `planChain` builds it: each hit carries the power on. */
function plan(hps: (number | { plates: number })[]): { links: LinkPlan[]; power: number } {
  let power = 0;
  const links = hps.map((h, i) => { const e = typeof h === 'number' ? enemy(i + 1, power, h) : enemy(i + 1, power, 9, h.plates); power = e.after; return e.link; });
  return { links, power };
}

check('weak links: the number grows with them, warm', () => {
  assert(JSON.stringify(planPowerNumber(plan([0, 0, 0]))) === JSON.stringify({ value: 3, red: false }), `${JSON.stringify(planPowerNumber(plan([0, 0, 0])))}`);
});

check('the last link survives: the power that reaches it, red', () => {
  assert(JSON.stringify(planPowerNumber(plan([0, 0, 0, 6]))) === JSON.stringify({ value: 4, red: true }), `${JSON.stringify(planPowerNumber(plan([0, 0, 0, 6])))}`);
});

check('a survivor in the middle (the world changed while drawing): the number is its, not the last link\'s', () => {
  // A, B weak, C tough (HP 6) survives with 3 coming in, D after it.
  const p = plan([0, 0, 6, 0]);
  assert(JSON.stringify(planPowerNumber(p)) === JSON.stringify({ value: 3, red: true }), `${JSON.stringify(planPowerNumber(p))}`);
});

check('a plate is no survivor: the chain goes on through the armoured elite', () => {
  const p = plan([0, 0, { plates: 2 }, 0]);
  assert(planPowerNumber(p)?.red === false, `${JSON.stringify(planPowerNumber(p))}`);
});

check('no enemy link (a button or the door alone): no number', () => {
  assert(planPowerNumber({ links: [{ link: { kind: 'object', id: 7 }, outcome: null }], power: 0 }) === null, 'a button alone');
  assert(planPowerNumber({ links: [], power: 0 }) === null, 'empty');
});
