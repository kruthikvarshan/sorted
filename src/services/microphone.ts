/**
 * Choosing the microphone. Browsers record from the system's default input, and on a Mac that is often an iPhone
 * nearby (Continuity) rather than the computer's own microphone. So we pick the input ourselves: the one the person
 * chose in Settings, otherwise the computer's built-in microphone, and a phone only if nothing else exists.
 */

const KEY = 'group_os_microphone';

export interface MicOption {
  deviceId: string;
  label: string;
}

// "phone" alone would match every "Microphone", so only whole words count.
const PHONE = /iphone|ipad|continuity|android|\bphone\b/i;
const BUILT_IN = /built-?in|macbook|internal|imac|laptop/i;

export const isPhoneMic = (label: string) => PHONE.test(label);

export function getMicChoice(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setMicChoice(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(KEY, deviceId);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: automatic choice applies */
  }
}

/** The input to use. "default" and "communications" are aliases of real devices, so they are never picked directly. */
export function pickMicrophone(options: MicOption[], chosenId: string): MicOption | undefined {
  const real = options.filter(o => o.deviceId && o.deviceId !== 'default' && o.deviceId !== 'communications');
  const chosen = real.find(o => o.deviceId === chosenId);
  if (chosen) return chosen;
  return real.find(o => BUILT_IN.test(o.label) && !isPhoneMic(o.label)) ?? real.find(o => !isPhoneMic(o.label)) ?? real[0];
}

export async function listMicrophones(): Promise<MicOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

const CONSTRAINTS = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** Opens the right microphone and says which one it is. */
export async function openMicrophone(): Promise<{ stream: MediaStream; label: string }> {
  // Device names are hidden until the site has microphone permission, so ask once with the default input first.
  let first: MediaStream | null = null;
  let options = await listMicrophones();
  if (options.every(o => !o.label || /^Microphone \d+$/.test(o.label))) {
    first = await navigator.mediaDevices.getUserMedia({ audio: CONSTRAINTS });
    options = await listMicrophones();
  }
  const target = pickMicrophone(options, getMicChoice());
  const current = first?.getAudioTracks()[0]?.getSettings().deviceId;
  if (first && (!target || target.deviceId === current)) {
    return { stream: first, label: target?.label ?? first.getAudioTracks()[0]?.label ?? 'microphone' };
  }
  first?.getTracks().forEach(t => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: target ? { ...CONSTRAINTS, deviceId: { exact: target.deviceId } } : CONSTRAINTS,
  });
  return { stream, label: target?.label ?? stream.getAudioTracks()[0]?.label ?? 'microphone' };
}
