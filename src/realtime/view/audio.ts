/**
 * Chain hit sound of the real-time prototype (iteration 2, stage C, docs/realtime-prototype.md 9г item 6):
 * a short synthesized «tick» whose pitch rises along the chain (a semitone per hit, up to two octaves).
 * Web Audio only, no files. The context is created on the first user gesture (browser autoplay rule).
 */
export class ChainAudio {
  private ctx: AudioContext | null = null;

  /** Call from a user gesture (pointerdown / keydown): creates or resumes the context. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { this.ctx = null; }
  }

  /** One hit of the chain: `combo` — its number in the dash (1, 2, …); a kill sounds brighter than a wound. */
  hit(combo: number, killed: boolean, volume: number): void {
    this.tone(330 * Math.pow(2, Math.min(24, Math.max(0, combo - 1)) / 12), killed ? 'triangle' : 'square', 0.09, volume * (killed ? 1 : 0.6));
  }

  /** A crystal breaks: a high glassy ping at the current pitch. */
  crystal(combo: number, volume: number): void {
    this.tone(990 * Math.pow(2, Math.min(12, combo) / 24), 'sine', 0.22, volume * 0.8);
  }

  /** The finisher: a low thump under the last hit. */
  finisher(volume: number): void {
    this.tone(110, 'sine', 0.35, volume);
  }

  private tone(freq: number, type: OscillatorType, length: number, volume: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || volume <= 0) return;
    const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.5), t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }
}
