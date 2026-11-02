import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { unzipSync, strFromU8 } from 'fflate';

/**
 * WhatsApp voice notes are OGG/Opus, and Meta's speech model takes mono 16-bit WAV, so voice notes are converted
 * with ffmpeg. Chat exports arrive as .txt, or as .zip (iPhone), which holds a _chat.txt.
 */

export function toWav16k(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg is not available'));
    const ff = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-f', 'wav', 'pipe:1']);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on('data', d => out.push(d));
    ff.stderr.on('data', d => err.push(d));
    ff.on('error', reject);
    ff.on('close', code => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg failed: ${Buffer.concat(err).toString().slice(0, 200)}`))));
    ff.stdin.on('error', () => undefined);
    ff.stdin.end(input);
  });
}

const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** Phone photos are large: shrink to at most 1400 px wide and re-encode as JPEG before sending to the model. */
export function shrinkImage(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg is not available'));
    const ff = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', "scale='min(1400,iw)':-2", '-frames:v', '1', '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']);
    const out: Buffer[] = [];
    ff.stdout.on('data', d => out.push(d));
    ff.on('error', reject);
    ff.on('close', code => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error('could not read the image'))));
    ff.stdin.on('error', () => undefined);
    ff.stdin.end(input);
  });
}

/** The chat text inside an export, or null when the file is not a chat export. */
export function exportText(file: Buffer): string | null {
  if (isZip(file)) {
    try {
      const entries = unzipSync(new Uint8Array(file));
      const name = Object.keys(entries).find(n => /\.txt$/i.test(n) && !n.startsWith('__MACOSX'));
      return name ? strFromU8(entries[name]) : null;
    } catch {
      return null;
    }
  }
  const text = file.toString('utf8');
  return text.includes('\n') ? text : null;
}

/** "WhatsApp Chat with Goa Trip.txt" -> "Goa Trip". */
export function titleFromFilename(name?: string): string | undefined {
  if (!name) return undefined;
  const t = name.replace(/\.(txt|zip)$/i, '').replace(/^WhatsApp Chat (with|-)\s*/i, '').trim();
  return t || undefined;
}
