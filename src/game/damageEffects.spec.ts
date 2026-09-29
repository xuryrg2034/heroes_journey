import {
  applyDamageEffect,
  cleanseDamageEffects,
  stepBleeding,
  summarizeDamageEffects,
  tickDamageEffects,
} from './damageEffects';

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

equal(tickDamageEffects(undefined), { effects: undefined, hits: [] }, 'absent effects do nothing');
equal(stepBleeding(undefined), { effects: undefined, hits: [], damage: 0 }, 'absent bleeding does nothing');
equal(applyDamageEffect(undefined, 'wind'), undefined, 'wind needs existing fire');

const initialFire = applyDamageEffect(undefined, 'fire', true)!;
const firstFireTick = tickDamageEffects(initialFire);
equal(firstFireTick.hits, [{ kind: 'fire', damage: 1, playerCredit: true }], 'fire damages at turn end');
equal(firstFireTick.effects?.burningTurns, 1, 'first fire tick starts shared decay timer');
equal(initialFire.burningTurns, 0, 'ticking does not mutate input');

const refreshedFire = applyDamageEffect(firstFireTick.effects, 'fire')!;
equal(refreshedFire.burningTurns, 1, 'reapplying fire does not restart decay');
const fannedFire = applyDamageEffect(refreshedFire, 'wind', true)!;
equal([fannedFire.burning, fannedFire.creditedBurning], [3, 2], 'wind fans one stack with source credit');
const secondFireTick = tickDamageEffects(fannedFire);
equal(secondFireTick.hits, [
  { kind: 'fire', damage: 2, playerCredit: true },
  { kind: 'fire', damage: 1, playerCredit: false },
], 'mixed fire stacks retain damage attribution');
equal([secondFireTick.effects?.burning, secondFireTick.effects?.burningTurns, secondFireTick.effects?.creditedBurning],
  [2, 0, 2], 'second complete turn removes uncredited fire stack after damage');
equal(tickDamageEffects(tickDamageEffects(secondFireTick.effects).effects).effects?.burning, 1,
  'remaining fire loses another stack after two more turns');

const poisoned = applyDamageEffect(applyDamageEffect(undefined, 'poison', true), 'poison')!;
const poisonTick = tickDamageEffects(poisoned);
equal(poisonTick.hits, [
  { kind: 'poison', damage: 1, playerCredit: true },
  { kind: 'poison', damage: 1, playerCredit: false },
], 'each poison stack deals end-turn damage with its own credit');
equal(poisonTick.effects, poisoned, 'poison never decays');

const bleeding = applyDamageEffect(applyDamageEffect(undefined, 'bleeding', true), 'bleeding')!;
const firstSteps = stepBleeding(bleeding, 2);
equal([firstSteps.damage, firstSteps.effects?.bleedingSteps], [0, 2], 'two ordinary steps carry progress');
const thirdStep = stepBleeding(firstSteps.effects);
equal(thirdStep.hits, [
  { kind: 'bleeding', damage: 1, playerCredit: true },
  { kind: 'bleeding', damage: 1, playerCredit: false },
], 'third step damages once per bleeding stack');
equal([thirdStep.damage, thirdStep.effects?.bleedingSteps], [2, 0], 'third step resets movement remainder');
equal(stepBleeding(thirdStep.effects, 7).damage, 4, 'multiple triples trigger once per triple');
equal(bleeding.bleedingSteps, 0, 'movement does not mutate input');

const partialBleeding = stepBleeding(bleeding, 2).effects;
const afterTurn = tickDamageEffects(partialBleeding);
equal([afterTurn.effects?.bleeding, afterTurn.effects?.bleedingSteps], [1, 2],
  'end turn removes one bleed stack but carries ordinary-step remainder');
equal(stepBleeding(afterTurn.effects).damage, 1, 'movement progress carries between turns');
equal(tickDamageEffects(afterTurn.effects).effects, undefined, 'final bleeding stack expires at turn end');

const afflicted = applyDamageEffect(
  applyDamageEffect(stepBleeding(applyDamageEffect(undefined, 'bleeding'), 2).effects, 'poison'),
  'fire',
)!;
const cured = cleanseDamageEffects(afflicted)!;
equal(summarizeDamageEffects(cured), {
  burning: 1, burningTurns: 0, poison: 0, bleeding: 0, bleedingSteps: 0,
  creditedBurning: 0, creditedPoison: 0, creditedBleeding: 0,
}, 'healing clears poison and bleeding movement progress but preserves fire');
equal([afflicted.poison, afflicted.bleeding, afflicted.bleedingSteps], [1, 1, 2], 'healing does not mutate input');
equal(cleanseDamageEffects(poisoned), undefined, 'healing removes all effects if no fire remains');

console.log('PASS damage effect timing, movement, source credit, immutability and healing');
