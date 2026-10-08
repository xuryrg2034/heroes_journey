/**
 * Seeded random streams of the real-time simulation (stage 1 of the transition, docs/realtime-prototype.md,
 * «Ядро реального времени»). Every random choice of the simulation reads a named stream; a stream is derived from the
 * world seed and its name only, so adding a new stream (a new enemy behaviour) never shifts the numbers of the others,
 * and the order in which streams are first used does not matter.
 *
 * Streams of the prototype: `spawnPlace` (marker anchors and points), `spawnRoll` (group interval, size, pack, kind,
 * colour, HP), `speed` (personal speed spread), `crystal` (crystal drop point), `separate` (direction for coincident
 * bodies). A behaviour module takes its own stream by name (`behavior:<id>`).
 */

/** 32-bit string hash (FNV-1a): the per-stream salt. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** SplitMix32 finaliser: spreads a seed over all 32 bits. */
function mix32(x: number): number {
  x = (x + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** One stream: Mulberry32 over a single 32-bit state (serialisable, cheap, good enough for gameplay). */
export class Rng {
  constructor(public state: number) { this.state = state >>> 0; }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
}

export class RngStreams {
  private readonly streams = new Map<string, Rng>();

  constructor(readonly seed: number) { this.seed = seed >>> 0; }

  /** The stream `name`, created on first use from the seed and the name. */
  stream(name: string): Rng {
    let rng = this.streams.get(name);
    if (!rng) {
      rng = new Rng(mix32(this.seed ^ hashString(name)));
      this.streams.set(name, rng);
    }
    return rng;
  }

  /** States of the streams used so far, sorted by name (the world hash). */
  states(): [string, number][] {
    return [...this.streams.entries()].map(([name, rng]) => [name, rng.state] as [string, number]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
}
