/**
 * «Однорукий гоблин» (casino stage 1; slot.ts): the odds line of the drawn chain — «дождь N % · залп M %» over the idol while
 * the chain ends on the lever or can take it next. Pure: the plan (`planChain`) counts the enemy links the dash will strike
 * (kills and plate hits; a survivor ends the chain, so no lever can follow it) and the pull's own function (`pullOdds`) turns
 * them into skulls and odds. With the world unchanged until the dash reaches the lever, the pull uses exactly these odds.
 */
import { canLinkObject, planChain, type ChainPlan } from './chain';
import { leverOf, pullOdds } from './slot';
import type { World } from './world';

export interface SlotPlanOdds {
  /** Enemy links the plan says the dash will strike before the lever. */
  links: number;
  /** Skulls per reel for this pull; chances of the rain (☠☠☠) and the volley (two ☠). */
  skulls: number[];
  rain: number;
  volley: number;
  /** The lever is the chain's last link already (false — it can be taken next). */
  onLever: boolean;
}

/** The odds line of the drawn chain now; null — no chain, no goblin, or the chain can neither end on the lever nor take it. */
export function slotPlanOdds(world: World, plan: ChainPlan = planChain(world)): SlotPlanOdds | null {
  const lever = leverOf(world);
  if (!lever || !world.chain.length || !world.params.slot) return null;
  const last = world.chain[world.chain.length - 1];
  const onLever = last.kind === 'object' && last.id === lever.id;
  if (!onLever && !canLinkObject(world, lever, plan)) return null;
  // A survivor before the lever stops the dash there: no pull, no line (review 11.10.2026).
  if (plan.endsOnSurvivor) return null;
  const links = plan.links.filter(l => l.outcome !== null).length;
  const odds = pullOdds(world, links);
  return { links, skulls: odds.skulls, rain: odds.rain, volley: odds.volley, onLever };
}

/** The line as the player reads it: «дождь 3,7 % · залп 22,2 %». */
export function slotOddsText(odds: Pick<SlotPlanOdds, 'rain' | 'volley'>): string {
  const pct = (v: number): string => `${(Math.round(v * 1000) / 10).toFixed(1).replace('.', ',')} %`;
  return `дождь ${pct(odds.rain)} · залп ${pct(odds.volley)}`;
}
