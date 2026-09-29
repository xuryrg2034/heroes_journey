/** Persistent damage carried by either a hero or a board cell. */
export interface DamageEffects {
  burning: number;
  /** Completed end-turn ticks toward the next burning stack loss (0 or 1). */
  burningTurns: number;
  poison: number;
  bleeding: number;
  /** Ordinary grid steps toward the next bleeding hit (0, 1, or 2). */
  bleedingSteps: number;
  /** Player-owned stacks, used to attribute delayed damage and defeats. */
  creditedBurning?: number;
  creditedPoison?: number;
  creditedBleeding?: number;
}

export type DamageEffectKind = 'fire' | 'poison' | 'bleeding' | 'wind';
export type DamageEffectHit = { kind: 'fire' | 'poison' | 'bleeding'; damage: number; playerCredit: boolean };

function count(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}

/** Return a fresh, canonical snapshot; absent effects read as zero. */
export function summarizeDamageEffects(current: DamageEffects | undefined): Required<DamageEffects> {
  const burning = count(current?.burning);
  const poison = count(current?.poison);
  const bleeding = count(current?.bleeding);
  return {
    burning,
    burningTurns: burning ? count(current?.burningTurns) % 2 : 0,
    poison,
    bleeding,
    bleedingSteps: bleeding ? count(current?.bleedingSteps) % 3 : 0,
    creditedBurning: Math.min(burning, count(current?.creditedBurning)),
    creditedPoison: Math.min(poison, count(current?.creditedPoison)),
    creditedBleeding: Math.min(bleeding, count(current?.creditedBleeding)),
  };
}

function present(effects: Required<DamageEffects>): DamageEffects | undefined {
  return effects.burning || effects.poison || effects.bleeding ? effects : undefined;
}

function hits(kind: DamageEffectHit['kind'], total: number, credited: number): DamageEffectHit[] {
  const result: DamageEffectHit[] = [];
  if (credited) result.push({ kind, damage: credited, playerCredit: true });
  if (total > credited) result.push({ kind, damage: total - credited, playerCredit: false });
  return result;
}

/** Add one stack. Wind only fans an existing fire; neither action deals impact damage. */
export function applyDamageEffect(
  current: DamageEffects | undefined,
  kind: DamageEffectKind,
  playerCredit = false,
): DamageEffects | undefined {
  const effects = summarizeDamageEffects(current);
  if (kind === 'wind' && effects.burning === 0) return present(effects);
  if (kind === 'fire' || kind === 'wind') {
    effects.burning++;
    if (playerCredit) effects.creditedBurning++;
  } else if (kind === 'poison') {
    effects.poison++;
    if (playerCredit) effects.creditedPoison++;
  } else {
    effects.bleeding++;
    if (playerCredit) effects.creditedBleeding++;
  }
  return effects;
}

/** End-turn damage is evaluated before fire and bleeding stack decay. */
export function tickDamageEffects(current: DamageEffects | undefined): {
  effects: DamageEffects | undefined;
  hits: DamageEffectHit[];
} {
  const effects = summarizeDamageEffects(current);
  const damageHits = [
    ...hits('fire', effects.burning, effects.creditedBurning),
    ...hits('poison', effects.poison, effects.creditedPoison),
  ];
  if (effects.burning) {
    effects.burningTurns++;
    if (effects.burningTurns === 2) {
      effects.burning--;
      effects.burningTurns = 0;
      // Stack order is not tracked: spend uncredited stacks first so credited stacks persist.
      if (effects.creditedBurning > effects.burning) effects.creditedBurning--;
    }
  }
  if (effects.bleeding) {
    effects.bleeding--;
    if (effects.creditedBleeding > effects.bleeding) effects.creditedBleeding--;
    if (!effects.bleeding) effects.bleedingSteps = 0;
  }
  return { effects: present(effects), hits: damageHits };
}

/** Count ordinary grid steps only. Callers exclude jumps and swaps. */
export function stepBleeding(current: DamageEffects | undefined, steps = 1): {
  effects: DamageEffects | undefined;
  hits: DamageEffectHit[];
  damage: number;
} {
  const effects = summarizeDamageEffects(current);
  const ordinarySteps = count(steps);
  if (!effects.bleeding || !ordinarySteps) return { effects: present(effects), hits: [], damage: 0 };
  const triggers = Math.floor((effects.bleedingSteps + ordinarySteps) / 3);
  effects.bleedingSteps = (effects.bleedingSteps + ordinarySteps) % 3;
  const damageHits = hits('bleeding', triggers * effects.bleeding, triggers * effects.creditedBleeding);
  return { effects, hits: damageHits, damage: triggers * effects.bleeding };
}

/** Healing cures poison and bleeding, including partial movement progress. */
export function cleanseDamageEffects(current: DamageEffects | undefined): DamageEffects | undefined {
  const effects = summarizeDamageEffects(current);
  effects.poison = effects.creditedPoison = 0;
  effects.bleeding = effects.bleedingSteps = effects.creditedBleeding = 0;
  return present(effects);
}
