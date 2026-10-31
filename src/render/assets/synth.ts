/**
 * A tiny sound-effect synthesizer for placeholder audio, so the game ships with no audio
 * files. A sound is a list of tones mixed together; each tone is an oscillator with a
 * frequency sweep and a simple attack/release envelope.
 *
 * Pure: it returns raw samples. The Phaser side copies them into a Web Audio buffer
 * (see loadAssets.ts). Noise uses the seeded Rng, so sounds are identical every run.
 */
import { Rng } from '../../core/Rng';

export type Wave = 'sine' | 'square' | 'triangle' | 'saw' | 'noise';

export interface Tone {
  wave: Wave;
  /** Start frequency in Hz (ignored for noise). */
  freq: number;
  /** End frequency in Hz; the pitch slides linearly from `freq` to this. */
  freqEnd?: number;
  /** Delay before this tone starts, in seconds. */
  start?: number;
  /** Length in seconds, including attack and release. */
  duration: number;
  /** Fade-in time in seconds. */
  attack?: number;
  /** Fade-out time in seconds at the end of the tone. */
  release?: number;
  /** Relative loudness, 0..1. */
  volume?: number;
}

/** Loudest sample value after mixing; leaves headroom so tones never clip. */
export const PEAK = 0.85;

export function soundLength(tones: readonly Tone[]): number {
  return tones.reduce((end, tone) => Math.max(end, (tone.start ?? 0) + tone.duration), 0);
}

export function synthesize(tones: readonly Tone[], sampleRate: number, seed = 1): Float32Array {
  const total = Math.max(1, Math.ceil(soundLength(tones) * sampleRate));
  const out = new Float32Array(total);
  const rng = new Rng(seed);

  for (const tone of tones) {
    const startSample = Math.floor((tone.start ?? 0) * sampleRate);
    const length = Math.floor(tone.duration * sampleRate);
    const attack = Math.max(1, Math.floor((tone.attack ?? 0.005) * sampleRate));
    const release = Math.max(1, Math.floor((tone.release ?? tone.duration * 0.6) * sampleRate));
    const volume = tone.volume ?? 1;
    const freqEnd = tone.freqEnd ?? tone.freq;
    let phase = 0;

    for (let i = 0; i < length && startSample + i < total; i++) {
      const progress = i / length;
      const freq = tone.freq + (freqEnd - tone.freq) * progress;
      phase = (phase + freq / sampleRate) % 1;

      let sample: number;
      switch (tone.wave) {
        case 'sine':
          sample = Math.sin(phase * Math.PI * 2);
          break;
        case 'square':
          sample = phase < 0.5 ? 1 : -1;
          break;
        case 'triangle':
          sample = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case 'saw':
          sample = phase * 2 - 1;
          break;
        case 'noise':
          sample = rng.next() * 2 - 1;
          break;
        default:
          sample = 0;
      }

      // Linear attack, then a curved fade over the release window.
      let envelope = 1;
      if (i < attack) envelope = i / attack;
      const fromEnd = length - i;
      if (fromEnd < release) envelope *= (fromEnd / release) ** 2;

      out[startSample + i] += sample * envelope * volume;
    }
  }

  // Normalise so the loudest point sits at PEAK.
  let max = 0;
  for (let i = 0; i < total; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 0) {
    const gain = PEAK / max;
    for (let i = 0; i < total; i++) out[i] *= gain;
  }
  return out;
}
