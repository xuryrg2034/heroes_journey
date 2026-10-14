/**
 * Task 22 «Удар слышен» (design 15.10.2026, docs/design-notes/tasks-21-25.md): the sounds of a hit on the hero and of a threat's
 * start — the archer's aim, the boar's windup, a sapper's fuse (lit by a touch or burning after its death). At most one sound
 * of a kind in `SOUND_GAP` real seconds (sixty enemies must not make a noise); the focus's slow time does not stretch it.
 * The goblin's «lit» already sounds (`ChainAudio.slotResult('bust')`, the same tick). View only: never a Param, never the hash.
 */
import { sapperFuse } from '../sim/enemies/sapper';
import type { World } from '../sim/world';

/** Real seconds: one sound of a kind at most this often (design 15.10.2026, «~0,3 с»). */
export const SOUND_GAP = 0.3;

export type GatedSound = 'hurt' | 'aim' | 'charge' | 'fuse';
/** The threats' starts (not the hit). */
export type ThreatSound = Exclude<GatedSound, 'hurt'>;

/** One sound of a kind per `SOUND_GAP`: `pass` says whether this one sounds; the counts are what the tests read. */
export class SoundGate {
  private readonly last = new Map<GatedSound, number>();
  /** Asked for (every event) and let through, by kind. */
  readonly asked: Record<GatedSound, number> = { hurt: 0, aim: 0, charge: 0, fuse: 0 };
  readonly played: Record<GatedSound, number> = { hurt: 0, aim: 0, charge: 0, fuse: 0 };

  /** `now` — real seconds. */
  pass(kind: GatedSound, now: number): boolean {
    this.asked[kind]++;
    const last = this.last.get(kind);
    if (last !== undefined && now - last < SOUND_GAP - 1e-9) return false;
    this.last.set(kind, now);
    this.played[kind]++;
    return true;
  }
}

/**
 * The threats that start in a world, frame by frame (the sim sends no event for an aim or a lit fuse): each archer's aim once as
 * it begins, each sapper's fuse once (a touch-lit fuse, or the blast its death lights — the same sapper is not heard twice), each
 * boar's windup by its `boarCharge` event. A new world forgets what it saw.
 */
export class ThreatWatch {
  private world: World | null = null;
  private readonly aiming = new Set<number>();
  private readonly fused = new Set<number>();

  /** The threat sounds this frame's world asks for (in order: aim, charge, fuse; a kind at most once a frame). */
  read(world: World): ThreatSound[] {
    if (this.world !== world) { this.world = world; this.aiming.clear(); this.fused.clear(); }
    const out = new Set<ThreatSound>();
    if (world.status !== 'playing') return [];
    for (const e of world.enemies) {
      if (e.kind === 'archer') {
        if (e.vars.aim === 1) { if (!this.aiming.has(e.id)) { this.aiming.add(e.id); out.add('aim'); } }
        else this.aiming.delete(e.id);
      } else if (e.kind === 'sapper' && sapperFuse(world, e) && !this.fused.has(e.id)) { this.fused.add(e.id); out.add('fuse'); }
    }
    // A sapper's death lights its blast (`total` > 0: the fuse burns); a goblin's bust has its own sound.
    for (const b of world.blasts) if (!b.bust && b.source === 'blast' && b.total > 0 && !this.fused.has(b.ownerId)) { this.fused.add(b.ownerId); out.add('fuse'); }
    if (world.events.some(ev => ev.type === 'boarCharge')) out.add('charge');
    return (['aim', 'charge', 'fuse'] as const).filter(kind => out.has(kind));
  }
}
