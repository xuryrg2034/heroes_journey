/**
 * Task 57а «Лес: стрелки»: the registry of the kinds that obey the arena's shooters' timer (sim/shots.ts). A module without runtime
 * imports: the kinds (enemies/archer.ts, slinger.ts, hive.ts) register at their load whatever module is imported first — shots.ts
 * imports world.ts, which loads the kinds, so the registry may not live in shots.ts (the cycle shots ⇄ enemies).
 */
import type { Enemy, World } from './world';

/**
 * A kind that obeys the arena's timer: how many shots its volley brings (`size`; 0 — the archer: its arrow is no shot of the
 * layer), and how its windup begins (`begin`, called by the timer when its turn comes).
 */
export interface ShooterDef { size(world: World, e: Enemy): number; begin(world: World, e: Enemy): void }

const shooters = new Map<string, ShooterDef>();
export function registerShooter(kind: string, def: ShooterDef): void { shooters.set(kind, def); }
/** The shooter of a kind (undefined — the kind does not obey the timer). */
export function shooterOf(kind: string): ShooterDef | undefined { return shooters.get(kind); }
