import { describe, expect, it } from 'vitest';
import { isPhoneMic, pickMicrophone } from '../services/microphone';

const mac = { deviceId: 'mac', label: 'MacBook Pro Microphone (Built-in)' };
const phone = { deviceId: 'phone', label: "Kruthik's iPhone Microphone" };
const usb = { deviceId: 'usb', label: 'USB Audio Device' };
const def = { deviceId: 'default', label: "Default - Kruthik's iPhone Microphone" };

describe('choosing the microphone', () => {
  it('uses the computer microphone even when the system default is a nearby iPhone', () => {
    expect(pickMicrophone([def, phone, mac], '')?.deviceId).toBe('mac');
  });

  it('prefers any non-phone microphone when there is no built-in one', () => {
    expect(pickMicrophone([def, phone, usb], '')?.deviceId).toBe('usb');
  });

  it('uses the phone only when it is the only microphone', () => {
    expect(pickMicrophone([def, phone], '')?.deviceId).toBe('phone');
  });

  it('respects the person\'s own choice, and falls back to automatic if that device is gone', () => {
    expect(pickMicrophone([phone, mac], 'phone')?.deviceId).toBe('phone');
    expect(pickMicrophone([phone, mac], 'unplugged')?.deviceId).toBe('mac');
  });

  it('recognises phone microphones by name', () => {
    expect(isPhoneMic(phone.label)).toBe(true);
    expect(isPhoneMic(mac.label)).toBe(false);
  });
});
