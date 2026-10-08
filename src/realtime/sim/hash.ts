/**
 * World hash of the real-time simulation: a canonical JSON of everything that decides the future (positions, timers,
 * the chain, the dash, spawning, objects, stats, random stream states, the live panel values), hashed with two FNV-1a passes into 16 hex
 * digits. Events (an output buffer the view clears) and the flow field's wall-clock build time are left out.
 * Same seed and the same journal must give the same hash after the same number of ticks — in Node and in the browser.
 */
import type { World } from './world';

/** Canonical state of the world (fixed key order). */
export function worldState(world: World): unknown {
  return {
    tick: world.tick,
    time: world.time,
    status: world.status,
    stage: world.stage,
    greedStart: world.greedStart,
    endTime: world.endTime,
    groupTimer: world.groupTimer,
    nextId: world.nextId,
    timeScale: world.timeScale,
    hitstop: world.hitstop,
    slowmo: world.slowmo,
    focus: world.focus,
    focusing: world.focusing,
    focusRefreshed: [...world.focusRefreshed],
    energy: world.energy,
    heroOnDoor: world.heroOnDoor,
    reaperSpawned: world.reaperSpawned,
    input: world.input,
    heroWalk: world.heroWalk,
    hero: world.hero,
    enemies: world.enemies,
    markers: world.markers,
    queue: world.queue,
    objects: world.objects,
    chain: world.chain,
    move: world.move,
    lastChain: world.lastChain,
    stats: world.stats,
    flowTimer: world.flowTimer,
    flowBuilds: world.flow.builds,
    phaseIndex: world.pressure.phaseIndex,
    rng: world.rng.states(),
    // The live panel values decide the future too (a `param` command changes them).
    params: world.params,
  };
}

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function hashText(text: string): string {
  const a = fnv1a(text, 0x811c9dc5), b = fnv1a(text, 0x01234567 ^ text.length);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function hashWorld(world: World): string { return hashText(JSON.stringify(worldState(world))); }
