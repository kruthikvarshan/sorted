/**
 * Meta's /asr/transcribe accepts only RIFF/WAVE, mono, 16-bit PCM at 16 or 24 kHz, up to 10 minutes.
 * Browsers record WebM/Opus or MP4, so recordings are decoded and re-encoded here.
 */

export const ASR_SAMPLE_RATE = 16000;
export const ASR_PREFERRED_RATE = 24000; // Meta accepts 16 or 24 kHz; 24 kHz keeps more consonant detail
export const ASR_MAX_SECONDS = 600;

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function makeSilentWav(seconds = 1, sampleRate = ASR_SAMPLE_RATE): Blob {
  return encodeWav(new Float32Array(Math.round(seconds * sampleRate)), sampleRate);
}

export interface AudioLevels {
  peakDb: number;
  rmsDb: number;
  gainDb: number;
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Scale quiet recordings up toward -1 dBFS (capped at +24 dB so room noise is not blown up). */
export function normalizeSamples(samples: Float32Array): AudioLevels {
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSquares += samples[i] * samples[i];
  }
  let gain = 1;
  if (peak > 0.003 && peak < 0.89) gain = Math.min(0.89 / peak, 16);
  if (gain !== 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length)) * gain;
  return { peakDb: toDb(peak * gain), rmsDb: toDb(rms), gainDb: toDb(gain) };
}

/** Decode any browser-playable audio and return mono 16-bit WAV (24 kHz) plus level info. Browser only. */
export async function toAsrWav(input: Blob): Promise<{ wav: Blob; durationSec: number; sampleRate: number; levels: AudioLevels }> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await input.arrayBuffer());
  } finally {
    ctx.close();
  }
  if (decoded.duration > ASR_MAX_SECONDS) {
    throw new Error('Audio is longer than the 10 minute limit for transcription.');
  }

  const rate = ASR_PREFERRED_RATE;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const samples = rendered.getChannelData(0);
  const levels = normalizeSamples(samples);
  return { wav: encodeWav(samples, rate), durationSec: decoded.duration, sampleRate: rate, levels };
}
