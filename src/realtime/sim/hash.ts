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
    // Loop research, step 2: a closed chain (absent while open — worlds without the loop hash as before).
    ...world.chainClosed ? { chainClosed: world.chainClosed } : {},
    // Package «Урон имеет значение»: the firing counter (absent until used).
    ...world.firing ? { firing: world.firing } : {},
    move: world.move,
    lastChain: world.lastChain,
    stats: world.stats,
    flowTimer: world.flowTimer,
    flowBuilds: world.flow.builds,
    phaseIndex: world.pressure.phaseIndex,
    rng: world.rng.states(),
    // The live panel values decide the future too (a `param` command changes them).
    params: world.params,
    // Stage 2 of the transition: lit fuses (absent when there are none — worlds without them hash as before).
    ...world.blasts.length ? { blasts: world.blasts } : {},
    // Phase A, T4: fire trails of «Огненный» elites (absent when there are none — worlds without them hash as before).
    ...world.trails.length ? { trails: world.trails } : {},
    // Stage 2, step 3: the kit of an arena with a loadout (absent before: those worlds hash as before).
    ...world.kit ? { kit: world.kit } : {},
    // Phase B (build.ts): structures of the build modules (absent while empty — worlds without them hash as before). The kit's
    // `hammer`, `chains`, `counters` and the dash's `build` come with the kit and the move.
    ...world.build ? { build: world.build } : {},
    // Casino stage 1 («Однорукий гоблин», slot.ts): absent until the battle rolls — worlds without it hash as before.
    ...world.slot ? { slot: world.slot } : {},
    // «Длинная цепь кормит гоблина» (slot.ts): long chains of the fight (absent while 0 — worlds without it hash as before).
    ...world.slotChains ? { slotChains: world.slotChains } : {},
    // Casino «Котёл» (purse.ts): the cauldron and the door's record (absent until used — worlds without it hash as before).
    ...world.purse ? { purse: world.purse } : {},
    // Task 14 «Котомка у двери» (bag.ts): the bag of the fight (absent until the goals with the rule on — worlds hash as before).
    ...world.bag ? { bag: world.bag } : {},
    // Task 16 «Подвиги» (feat.ts): the feat's latch (absent until done — worlds without a feat hash as before).
    ...world.feat ? { feat: world.feat } : {},
    // Casino «Ставка клятвы» (oath.ts): the oath of the fight, its met and broken ticks (absent without one — worlds hash as before).
    ...world.oath ? { oath: world.oath } : {},
    // П9 «Второе дыхание» (world.ts): the tick and game time the second wind was used (absent until then — worlds hash as before).
    ...world.secondWind ? { secondWind: world.secondWind } : {},
    // К7 «Проклятый сундук» (chest.ts): the curse of the fight (absent until the chest is taken — worlds hash as before).
    ...world.curse ? { curse: world.curse } : {},
    // The prologue «Опушка» (world.ts `updateRestore`): the start enemies' ids and the due return (absent on every other arena).
    ...world.restore ? { restore: world.restore } : {},
    // The prologue: the enemies sleep until the first press (absent on every other arena and once they woke).
    ...world.asleep ? { asleep: true } : {},
    // The prologue, task 9 (goal `strike`): the best and the last spin (absent on every other arena).
    ...world.strike ? { strike: world.strike } : {},
    // The prologue, task 13 (goal `shield`): the shield's lamps and window (absent on every other arena).
    ...world.shieldGoal ? { shieldGoal: world.shieldGoal } : {},
    // Task 28 «Тюремщик в походе» (`Params.bossClears`): the boss died, the fight is over (absent until then — worlds hash as before).
    ...world.bossCleared ? { bossCleared: true } : {},
    // Task 38 «Гарнизон» (`Params.tethers`, tethers.ts): the tethers on the arena (absent while none — worlds hash as before).
    ...world.tethers?.length ? { tethers: world.tethers } : {},
    // Task 56 «Приметы» (omens.ts): the storm, the sleep, the pools, the roll call (each absent until its rule acts — worlds hash as before).
    ...world.storm ? { storm: world.storm } : {},
    ...world.drowse ? { drowse: world.drowse } : {},
    ...world.flood ? { flood: world.flood } : {},
    ...world.rollcall ? { rollcall: world.rollcall } : {},
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
