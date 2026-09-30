export class GameAudio {
  enabled = true;
  private context: AudioContext | null = null;
  private lastHit = 0;

  unlock() {
    if (!this.enabled) return;
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  play(kind: string, amount = 1) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (kind === 'select' && now - this.lastHit < 0.025) return;
    this.lastHit = now;
    const settings: Record<string, [number, number, OscillatorType]> = {
      select: [210 + Math.min(amount, 18) * 24, 0.06, 'sine'],
      hit: [125 + Math.min(amount, 15) * 12, 0.07, 'triangle'],
      damage: [72, 0.22, 'sawtooth'],
      prism: [660, 0.28, 'sine'],
      frost: [790, 0.32, 'sine'],
      reward: [590, 0.35, 'triangle'],
      item: [430, 0.18, 'sine'],
      win: [520, 0.5, 'triangle'],
      lose: [95, 0.6, 'triangle'],
      click: [280, 0.08, 'sine'],
    };
    const [frequency, duration, wave] = settings[kind] ?? settings.hit;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'win' ? 1.5 : 0.55), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
