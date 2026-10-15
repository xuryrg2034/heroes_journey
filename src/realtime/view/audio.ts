/**
 * Chain hit sound of the real-time prototype (iteration 2, stage C, docs/realtime-prototype.md 9г item 6):
 * a short synthesized «tick» whose pitch rises along the chain (a semitone per hit; П2, 12.10.2026: a ladder of 8 steps,
 * then it stays). Web Audio only, no files. The context is created on the first user gesture (browser autoplay rule).
 */
/** П2 «Тихая мелочь, громкая цепь»: steps of the hit's pitch ladder (a semitone each), then the pitch stays. */
export const HIT_STEPS = 8;

export class ChainAudio {
  private ctx: AudioContext | null = null;
  /** Tones asked for with a volume above 0, played or not (no context yet): the decision to sound, which tests read. */
  requested = 0;

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
  hit(combo: number, killed: boolean, volume: number, power = 0, semis = 0): void {
    // View-only: a hit carrying more power is louder and a bit longer (up to power 8). Task 35, С4: `semis` shifts the ladder
    // («Тяжёлый клинок» −5).
    const k = Math.min(1, power / 8);
    this.tone(330 * Math.pow(2, (Math.min(HIT_STEPS - 1, Math.max(0, combo - 1)) + semis) / 12), killed ? 'triangle' : 'square', 0.09 + 0.06 * k, volume * (killed ? 1 : 0.6) * (0.75 + 0.25 * k));
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

  /** «Смена цвета»: the drawn chain's colour is free (the N-th link of a colour segment) — a quick rising glassy arpeggio. */
  colorShift(volume: number): void {
    for (const [i, semis] of [0, 4, 7, 11].entries()) this.tone(880 * Math.pow(2, semis / 12), 'sine', 0.14, volume * 0.55, i * 0.045);
  }

  /** П2: the end of a long dash (6+ enemy links) — a short major chord. */
  chord(volume: number): void {
    for (const [i, semis] of [0, 4, 7, 12].entries()) this.tone(392 * Math.pow(2, semis / 12), 'triangle', 0.4, volume * 0.45, i * 0.03);
  }

  /** Task 35, С4 «Тяжёлый клинок»: a dull thud under each hit of the dash (lower and shorter than the finisher's thump). */
  thud(volume: number): void {
    this.tone(72, 'sine', 0.12, volume * 0.8);
  }

  /** Task 35, С4 «Пятое звено»: the talisman fired on a link the dash struck — a small bell (a high tone and its overtone). */
  bell(volume: number): void {
    this.tone(1568, 'sine', 0.5, volume * 0.55);
    this.tone(1568 * 2.76, 'sine', 0.25, volume * 0.18);
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

  /**
   * Task 22 «Удар слышен» (view/soundGate.ts): a hit on the hero — a low dull thud with a short crack, unlike the chain's ticks;
   * the starts of threats — the archer's aim (a bowstring's twang), the boar's windup (a low snort), a sapper's fuse (a hiss).
   */
  hurt(volume: number): void {
    this.tone(92, 'sawtooth', 0.18, volume * 0.75);
    this.tone(1250, 'square', 0.035, volume * 0.18);
  }

  threat(kind: 'aim' | 'charge' | 'fuse', volume: number): void {
    if (kind === 'aim') { this.tone(740, 'triangle', 0.12, volume * 0.35); this.tone(1110, 'sine', 0.07, volume * 0.2, 0.015); }
    else if (kind === 'charge') this.tone(68, 'sawtooth', 0.28, volume * 0.5);
    else this.tone(2600, 'sawtooth', 0.2, volume * 0.12);
  }

  /** Task 16 «Подвиги»: the feat done — a short rising chime of three notes (brighter than the coins, softer than the chord). */
  feat(volume: number): void {
    [784, 988, 1319].forEach((f, i) => this.tone(f, 'triangle', 0.16, volume * 0.45, i * 0.09));
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
    if (outcome === 'bust') { this.tone(55, 'sawtooth', 0.8, volume * 0.7); this.tone(41, 'square', 0.6, volume * 0.5, 0.05); this.tone(1500, 'sawtooth', 0.14, volume * 0.22, 0.02); return; } // + a short zap: the spark finds the hero (task 5б)
    if (outcome === 'rain' || outcome === 'volley') { this.tone(98, 'sawtooth', 0.5, volume * 0.5); return; }
    if (outcome === 'none') { for (let i = 0; i < 3; i++) this.tone(520 - 60 * i, 'square', 0.07, volume * 0.25, i * 0.1); return; }
    const notes = outcome === 'jackpot' || outcome.endsWith('3') ? 6 : 3;
    for (let i = 0; i < notes; i++) this.tone(990 * Math.pow(2, i / 12 * 2), 'triangle', 0.1, volume * 0.5, i * 0.06);
  }

  private tone(freq: number, type: OscillatorType, length: number, volume: number, delay = 0): void {
    if (volume > 0) this.requested++;
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
