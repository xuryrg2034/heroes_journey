/**
 * Elite behaviours by kind (package «Урон имеет значение», docs/realtime-design-research.md, section 4.3, item 6; this
 * iteration — three kinds; docs/realtime-elite-behaviors.md). Behind the hashed param `eliteBehaviors` (off by default;
 * journals without it — off, every existing journal replays to the same hash). The rules live in the kinds' modules:
 * - basic — «Ведёт строем» (enemies/basic.ts): weak enemies of its colour walk in a column behind it;
 * - wolf — «Вожак» (enemies/wolf.ts): the ring howls for `wolfLeaderSettleCount` wolves, its howl rushes `wolfLeaderThrow`;
 * - boar — «Двойной рывок» (enemies/boar.ts): a second charge along a new line after `boarSecondWindup`.
 * This module is the view's door to them: the behaviour name per kind and the state to draw. Read only.
 */
import type { Enemy, World } from './world';
import { formationOf, formationSlot, leaderOf } from './enemies/basic';
import { boarLane } from './enemies/boar';
import { wolfRushLength, wolfRushLine } from './enemies/wolf';

export type EliteBehaviorId = 'leads' | 'leader' | 'double-charge';

export interface EliteBehavior { id: EliteBehaviorId; title: string }

/** Kinds with an elite behaviour this iteration and the player-facing name (the label «Элита · Вожак»). */
const BY_KIND: Readonly<Record<string, EliteBehavior>> = {
  basic: { id: 'leads', title: 'Ведёт строем' },
  wolf: { id: 'leader', title: 'Вожак' },
  boar: { id: 'double-charge', title: 'Двойной рывок' },
};

/** The elite behaviour of a kind (id and Russian name); null — the kind has none yet. Independent of the param. */
export function eliteBehaviorOf(kind: string): EliteBehavior | null { return BY_KIND[kind] ?? null; }

/** The elite behaviours act in this world (the param). */
export function eliteBehaviorsOn(world: World): boolean { return !!world.params.eliteBehaviors; }

/** The behaviour this enemy shows now: an elite of a kind with one, the param on; null otherwise. */
export function activeEliteBehavior(world: World, e: Enemy): EliteBehavior | null {
  return e.elite && eliteBehaviorsOn(world) ? eliteBehaviorOf(e.kind) : null;
}

export { boarLane, formationOf, formationSlot, leaderOf, wolfRushLength, wolfRushLine };
