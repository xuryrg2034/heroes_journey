/**
 * Chain hit sound of the real-time prototype (iteration 2, stage C, docs/realtime-prototype.md 9г item 6):
 * a short synthesized «tick» whose pitch rises along the chain (a semitone per hit; П2, 12.10.2026: a ladder of 8 steps,
 * then it stays). Web Audio only, no files. The context is created on the first user gesture (browser autoplay rule).
 */
/** П2 «Тихая мелочь, громкая цепь»: steps of the hit's pitch ladder (a semitone each), then the pitch stays. */
export const HIT_STEPS = 8;

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

  /**
   * One hit of the chain: `combo` — its number in the dash (1, 2, …); a kill sounds brighter than a wound. The pitch climbs a
   * semitone per hit for `HIT_STEPS` steps (П2), then stays. A quiet dash (1–2 links) passes a lower `volume` (view/chainFeel.ts).
   */
  hit(combo: number, killed: boolean, volume: number, power = 0): void {
    // View-only: a hit carrying more power is louder and a bit longer (up to power 8).
    const k = Math.min(1, power / 8);
    this.tone(330 * Math.pow(2, Math.min(HIT_STEPS - 1, Math.max(0, combo - 1)) / 12), killed ? 'triangle' : 'square', 0.09 + 0.06 * k, volume * (killed ? 1 : 0.6) * (0.75 + 0.25 * k));
  }

  /** Package «Урон имеет значение»: a marker announces an elite — a low horn. */
  eliteMarker(volume: number): void {
    this.tone(110, 'sawtooth', 0.35, volume * 0.5);
  }

  /** Package «Урон имеет значение»: a chain hit took a plate — a low clank, not the survivor's buzz. */
  plate(volume: number): void {
    this.tone(196, 'triangle', 0.08, volume * 0.7);
  }

  /** A crystal breaks: a high glassy ping at the current pitch. */
  crystal(combo: number, volume: number): void {
    this.tone(990 * Math.pow(2, Math.min(12, combo) / 24), 'sine', 0.22, volume * 0.8);
  }

  /** П2: the end of a long dash (6+ enemy links) — a short major chord. */
  chord(volume: number): void {
    for (const [i, semis] of [0, 4, 7, 12].entries()) this.tone(392 * Math.pow(2, semis / 12), 'triangle', 0.4, volume * 0.45, i * 0.03);
  }

  /** The finisher: a low thump under the last hit. */
  finisher(volume: number): void {
    this.tone(110, 'sine', 0.35, volume);
  }

  /** Stage 3a: an enemy announces a threat — the wolves' howl (a low falling tone), the lynx's leap, the shaman's beam. */
  signal(kind: string, volume: number): void {
    if (kind === 'howl') this.tone(220, 'sawtooth', 0.45, volume * 0.35);
    else if (kind === 'leap') this.tone(520, 'square', 0.12, volume * 0.35);
    else if (kind === 'beam') this.tone(660, 'sine', 0.4, volume * 0.4);
    else if (kind === 'empower') this.tone(180, 'triangle', 0.25, volume * 0.6);
  }

  /** Casino stage 1 («Однорукий гоблин»): the idol appears — a jingle of coins. */
  coins(volume: number): void {
    for (let i = 0; i < 4; i++) this.tone(1320 + 220 * (i % 2), 'triangle', 0.09, volume * 0.45, i * 0.07);
  }

  /** Casino stage 1: the lever pulled — a wooden clack and the rattle of the reels. */
  lever(volume: number): void {
    this.tone(150, 'square', 0.06, volume * 0.6);
    for (let i = 1; i <= 6; i++) this.tone(700, 'square', 0.025, volume * 0.2, i * 0.15);
  }

  /** Casino stage 1: the 3rd reel stopped — coins for a good result, a low horn for arrows, a snicker for nothing. */
  slotResult(outcome: string, volume: number): void {
    // «Перебор»: the goblin blows up — lower and longer than the arrows' horn (98 Hz).
    if (outcome === 'bust') { this.tone(55, 'sawtooth', 0.8, volume * 0.7); this.tone(41, 'square', 0.6, volume * 0.5, 0.05); return; }
    if (outcome === 'rain' || outcome === 'volley') { this.tone(98, 'sawtooth', 0.5, volume * 0.5); return; }
    if (outcome === 'none') { for (let i = 0; i < 3; i++) this.tone(520 - 60 * i, 'square', 0.07, volume * 0.25, i * 0.1); return; }
    const notes = outcome === 'jackpot' || outcome.endsWith('3') ? 6 : 3;
    for (let i = 0; i < notes; i++) this.tone(990 * Math.pow(2, i / 12 * 2), 'triangle', 0.1, volume * 0.5, i * 0.06);
  }

  private tone(freq: number, type: OscillatorType, length: number, volume: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || volume <= 0) return;
    const t = ctx.currentTime + Math.max(0, delay), osc = ctx.createOscillator(), gain = ctx.createGain();
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
