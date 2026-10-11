/**
 * П2 «Тихая мелочь, громкая цепь» (docs/realtime-prototype.md, 9о; docs/realtime-engagement-research.md, П2; design
 * 12.10.2026). View and sound only: the simulation, its hit-stop and the hash do not change, no `Params`.
 *
 * The dash's feel follows the enemy links of the released chain (the plan at the release):
 * - 1–2 — quiet: no shake, the hit sound −6 dB, no pop-up over the hero (the cheque or the sandbox «+N»);
 * - 3–5 — as before;
 * - 6–9 — a chord at the end of the dash and a flash of the hero's outline;
 * - 10+ — the finisher as before (its own flash and thump) and the chord.
 * The cheque pop-up follows the cheque's own `links` (render.ts `showCheque`).
 */
import type { HeroMove, World } from '../sim/world';

/** Enemy links up to which a dash stays quiet. */
export const QUIET_LINKS = 2;
/** Enemy links from which the dash ends with a chord and the hero's outline. */
export const CHORD_LINKS = 6;
/** Enemy links from which the chord comes with the finisher instead of the outline. */
export const FINALE_LINKS = 10;
/** −6 dB of the hit sound for a quiet dash (amplitude ×0.5). */
export const QUIET_GAIN = 0.5;

export type ChainFeel = 'quiet' | 'plain' | 'chord' | 'finale';

/** The feel of a dash with `links` enemy links (0 — a chain without enemies: quiet too). */
export function chainFeel(links: number): ChainFeel {
  return links <= QUIET_LINKS ? 'quiet' : links < CHORD_LINKS ? 'plain' : links < FINALE_LINKS ? 'chord' : 'finale';
}

/** Enemy links of a dash as the release left them: struck so far, passed fallen, still ahead. */
function linksOf(move: HeroMove): number {
  return move.hits + (move.fallen?.length ?? 0) + move.links.filter(l => l.kind === 'enemy').length;
}

/**
 * Enemy links of the dash running now (or ending in this frame's events), as the plan had them at the release. The view's
 * own release (main.ts `command`) notes the count at once; a dash the view did not see released is counted on its first
 * frame; a dash that began and ended inside one frame is counted from its events (the cheque's `links`, or its hits).
 * Reading does not change the world; calling it twice in a frame gives the same number.
 */
export class DashLinks {
  private move: HeroMove | null = null;
  private links = 0;

  /** The view released the chain: `world.move` is the new dash with all its links. */
  release(world: World): void {
    const move = world.move;
    if (move?.kind === 'dash') { this.move = move; this.links = linksOf(move); }
  }

  of(world: World): number {
    const move = world.move;
    if (move?.kind === 'dash') {
      if (move !== this.move) { this.move = move; this.links = linksOf(move); }
      return this.links;
    }
    const ended = world.events.some(ev => ev.type === 'chainEnd');
    if (!ended) { this.move = null; return 0; }
    // The dash ended in this frame: the one seen running, or one never seen (its events tell).
    if (this.move) return this.links;
    const cheque = world.events.find(ev => ev.type === 'cheque');
    return cheque && cheque.type === 'cheque' ? cheque.links : world.events.filter(ev => ev.type === 'chainHit').length;
  }
}
