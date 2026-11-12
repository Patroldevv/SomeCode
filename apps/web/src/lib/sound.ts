/**
 * Soft chimes for the things worth hearing about. They are drawn as small WAV files in memory and played with a plain
 * audio element. The Web Audio API (`new AudioContext()`) is deliberately not used: in Electron on some Linux systems
 * creating an AudioContext makes the page process get killed, which showed as a black window on the first click.
 */
export type ChimeKind = 'done' | 'ask' | 'error' | 'limit';

/** [frequency in Hz, start offset in s] per note. */
const NOTES: Record<ChimeKind, [number, number][]> = {
  done: [[659.25, 0], [880, 0.11]],
  ask: [[587.33, 0], [783.99, 0.12], [987.77, 0.24]],
  error: [[392, 0], [293.66, 0.14]],
  limit: [[698.46, 0], [698.46, 0.2]],
};

const RATE = 22050;
const NOTE_SECONDS = 0.7;

/** The chime as a 16-bit mono WAV: sine notes with a short fade in and a long, smooth fade out (no click). */
export function renderChime(kind: ChimeKind): Uint8Array {
  const notes = NOTES[kind];
  const length = Math.ceil((notes[notes.length - 1]![1] + NOTE_SECONDS) * RATE);
  const mix = new Float32Array(length);
  for (const [freq, offset] of notes) {
    const start = Math.floor(offset * RATE);
    const count = Math.floor(NOTE_SECONDS * RATE);
    for (let i = 0; i < count && start + i < length; i++) {
      const t = i / RATE;
      const attack = Math.min(1, t / 0.02);
      const release = Math.exp(-5 * (t / NOTE_SECONDS));
      mix[start + i]! += Math.sin(2 * Math.PI * freq * t) * attack * release;
    }
  }
  const bytes = new Uint8Array(44 + length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mix[i]! * 0.3)) * 32767, true);
  return bytes;
}

/** `play()` returns a promise in browsers (which may reject) and nothing in some test environments. */
function swallow(result: Promise<void> | undefined): void {
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

const urls = new Map<ChimeKind, string>();

function urlOf(kind: ChimeKind): string | null {
  let url = urls.get(kind);
  if (!url) {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    url = URL.createObjectURL(new Blob([renderChime(kind) as BlobPart], { type: 'audio/wav' }));
    urls.set(kind, url);
  }
  return url;
}

/** Browsers only let a page play sound after the user touched it; one silent play on the first touch unlocks it. */
export function primeAudio(): () => void {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return () => {};
  const unlock = () => {
    if (typeof Audio === 'undefined') return;
    const silent = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
    silent.volume = 0;
    swallow(silent.play());
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  return () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
}

export function playChime(kind: ChimeKind, volume = 0.5): void {
  if (typeof Audio === 'undefined') return;
  const url = urlOf(kind);
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, volume));
  swallow(audio.play());
}
