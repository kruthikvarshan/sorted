import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, makeSilentWav, normalizeSamples } from '../services/audioUtils';
import { MetaModelService } from '../services/metaModelService';

describe('WAV encoding for Meta /asr/transcribe', () => {
  it('writes a mono 16-bit 16 kHz RIFF/WAVE header with the right sizes', async () => {
    const buf = await makeSilentWav(1).arrayBuffer();
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16); // bits
    expect(tag(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(32000); // 1s * 16000 * 2 bytes
    expect(buf.byteLength).toBe(44 + 32000);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });

  it('clamps and scales samples to signed 16-bit', async () => {
    const v = new DataView(await encodeWav(new Float32Array([1, -1, 2, 0]), 16000).arrayBuffer());
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(v.getInt16(48, true)).toBe(32767); // clamped
    expect(v.getInt16(50, true)).toBe(0);
  });
});

describe('transcribeAudioWithMeta', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts multipart to /asr/transcribe with the documented request part', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: 's1',
        transcript: 'Friday works. Saturday does not.',
        audioDurationMs: 4200,
        turns: [
          { turnId: 1, startMs: 0, endMs: 1500, transcript: 'Friday works.', speaker: 'A' },
          { turnId: 2, startMs: 2000, endMs: 4200, transcript: 'Saturday does not.', speaker: 'B' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await MetaModelService.transcribeAudioWithMeta('k', makeSilentWav(1), { diarize: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/meta-proxy/asr/transcribe');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(init.headers.Accept).toBe('application/json');

    const form = init.body as FormData;
    const request = JSON.parse(await (form.get('request') as Blob).text());
    expect(request).toEqual({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'DIARIZATION' });
    expect(form.get('audio')).toBeInstanceOf(Blob);

    expect(res.success).toBe(true);
    expect(res.data?.turns.map(t => t.speaker)).toEqual(['A', 'B']);
    expect(res.data?.audioDurationMs).toBe(4200);
  });

  it('defaults to PUSH_TO_TALK and reports API errors verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'unsupported WAV' });
    vi.stubGlobal('fetch', fetchMock);
    const res = await MetaModelService.transcribeAudioWithMeta('k', makeSilentWav(1));
    const request = JSON.parse(await ((fetchMock.mock.calls[0][1].body as FormData).get('request') as Blob).text());
    expect(request.mode).toBe('PUSH_TO_TALK');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/400.*unsupported WAV/);
  });
});

describe('level normalisation', () => {
  it('boosts a quiet recording toward -1 dBFS without clipping', () => {
    const quiet = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.08);
    const levels = normalizeSamples(quiet);
    expect(Math.max(...quiet.map(Math.abs))).toBeLessThanOrEqual(0.9);
    expect(Math.max(...quiet.map(Math.abs))).toBeGreaterThan(0.8);
    expect(levels.gainDb).toBeGreaterThan(10);
  });

  it('caps the boost so a very quiet recording is not blown up into noise', () => {
    const veryQuiet = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.02);
    const levels = normalizeSamples(veryQuiet);
    expect(levels.gainDb).toBeCloseTo(24.08, 1); // 16x
  });

  it('leaves loud audio alone and does not amplify near-silence', () => {
    const loud = Float32Array.from({ length: 50 }, () => 0.95);
    expect(normalizeSamples(loud).gainDb).toBe(0);
    const hiss = Float32Array.from({ length: 50 }, () => 0.001);
    expect(normalizeSamples(hiss).gainDb).toBe(0);
  });
});

describe('transcription hints', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends languageBias and keywords only when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transcript: 'I will book a cab', audioDurationMs: 1800, turns: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await MetaModelService.transcribeAudioWithMeta('k', makeSilentWav(1), {
      languageBias: ['English'],
      keywords: ['Priya', 'SunBreeze'],
    });
    const request = JSON.parse(await ((fetchMock.mock.calls[0][1].body as FormData).get('request') as Blob).text());
    expect(request).toEqual({
      model: 'muse-voice-transcribe-1.0',
      audioEncoding: 'WAV',
      mode: 'PUSH_TO_TALK',
      languageBias: ['English'],
      keywords: ['Priya', 'SunBreeze'],
    });
  });
});
