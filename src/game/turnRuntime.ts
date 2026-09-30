import type { EngineEvent } from './forestTypes';

/** A synchronous rule system pauses at observable events and presentation beats. */
export type TurnStep = { event: EngineEvent } | { delay: number };
export type TurnSequence = Generator<TurnStep, boolean, void>;
export interface TurnPlayback {
  isCurrent(): boolean;
  emit(event: EngineEvent): void;
  wait(milliseconds: number): Promise<void>;
}

/** The only asynchronous part of turn resolution. Never resume a cancelled rule system. */
export async function playTurn(sequence: TurnSequence, playback: TurnPlayback): Promise<boolean> {
  try {
    while (playback.isCurrent()) {
      const step = sequence.next();
      if (!playback.isCurrent()) return false;
      if (step.done) return step.value;
      if ('event' in step.value) playback.emit(step.value.event);
      else await playback.wait(step.value.delay);
    }
    return false;
  } finally {
    sequence.return(false);
  }
}

/** Animation timing belongs to the presentation adapter, not the combat systems. */
export function animationWait(milliseconds: number, scale: number): Promise<void> {
  return scale > 0 ? new Promise(resolve => setTimeout(resolve, milliseconds * scale)) : Promise.resolve();
}

/**
 * Run a turn sequence to its end synchronously, without clocks: yielded events are collected (and passed to
 * `onEvent`), delays skipped. For forecasts and tests that need the same systems without playback (ECS plan §3.8).
 * `isCurrent` may stop it early. Every event of a chain, ability or Rest turn passes through the sequence except the
 * battle end: `win`/`lose` are published by the facade's `finish` directly (to be moved in stage 6).
 */
export function drainSync(sequence: TurnSequence, isCurrent: () => boolean = () => true, onEvent?: (event: EngineEvent) => void): { result: boolean; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  try {
    // Same checks as playTurn: a step that cancelled the scene is not published.
    while (isCurrent()) {
      const step = sequence.next();
      if (!isCurrent()) return { result: false, events };
      if (step.done) return { result: step.value, events };
      if ('event' in step.value) { events.push(step.value.event); onEvent?.(step.value.event); }
    }
    return { result: false, events };
  } finally {
    sequence.return(false);
  }
}
