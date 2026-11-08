/** Soft chimes for the things worth hearing about, made with the Web Audio API (no sound files). */
export type ChimeKind = 'done' | 'ask' | 'error' | 'limit';

/** [frequency in Hz, start offset in s] per note. */
const NOTES: Record<ChimeKind, [number, number][]> = {
  done: [[659.25, 0], [880, 0.11]],
  ask: [[587.33, 0], [783.99, 0.12], [987.77, 0.24]],
  error: [[392, 0], [293.66, 0.14]],
  limit: [[698.46, 0], [698.46, 0.2]],
};

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    context ??= new AudioContext();
    return context;
  } catch {
    return null;
  }
}

/** Browsers only let a page make sound after the user touched it: the first click or key press unlocks it. */
export function primeAudio(): () => void {
  const unlock = () => void audio()?.resume().catch(() => {});
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  return () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
}

export function playChime(kind: ChimeKind, volume = 0.5): void {
  const ctx = audio();
  if (!ctx || ctx.state === 'closed') return;
  void ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = 0.2 * volume;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  filter.connect(master).connect(ctx.destination);
  for (const [freq, offset] of NOTES[kind]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // A short fade in and a long, smooth fade out, so there is no click and it rings softly.
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(1, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.7);
    osc.connect(gain).connect(filter);
    osc.start(start + offset);
    osc.stop(start + offset + 0.75);
  }
}
