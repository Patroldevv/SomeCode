import { describe, expect, it } from 'vitest';
import { renderChime, type ChimeKind } from './sound.ts';

describe('renderChime', () => {
  it.each<ChimeKind>(['done', 'ask', 'error', 'limit'])('draws a valid, quiet, fading WAV for %s', (kind) => {
    const bytes = renderChime(kind);
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.subarray(8, 16))).toBe('WAVEfmt ');
    expect(view.getUint32(24, true)).toBe(22050);
    const samples = (bytes.length - 44) / 2;
    expect(view.getUint32(40, true)).toBe(samples * 2);
    let peak = 0;
    for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 2, true)));
    expect(peak).toBeGreaterThan(2000);
    expect(peak).toBeLessThan(20000);
    // It ends softly, not on a cut.
    expect(Math.abs(view.getInt16(44 + (samples - 1) * 2, true))).toBeLessThan(400);
  });
});
