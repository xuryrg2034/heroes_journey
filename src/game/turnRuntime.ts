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
