import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bySession, getAccount, login, logout, normalizePhone, resetAccounts } from '../../server/live/accounts';

beforeEach(() => resetAccounts(':memory:'));

describe('accounts', () => {
  it('signing up creates the account under the phone number; the PIN is stored only as a hash', () => {
    const r = login('+91 98765 43210', '4821', { name: 'Kruthik', signup: true });
    expect(r.isNew).toBe(true);
    expect(r.account!.username).toBe('919876543210');
    expect(r.account!.name).toBe('Kruthik');
    expect(JSON.stringify(getAccount('919876543210'))).not.toContain('4821');
  });

  it('logging in finds the same account however the number is typed; a wrong PIN is refused', () => {
    login('9876543210', '4821', { name: 'Kruthik', signup: true });
    expect(login('+91-98765-43210', '4821').account?.name).toBe('Kruthik');
    expect(login('0091 9876543210', '4821').isNew).toBe(false);
    expect(login('9876543210', '9999').error).toMatch(/PIN does not match/);
  });

  it('locks a number for 15 minutes after 5 wrong PINs, even with the right PIN after that', () => {
    login('9876543210', '4821', { name: 'K', signup: true });
    for (let i = 0; i < 5; i++) login('9876543210', '0000');
    expect(login('9876543210', '4821').error).toMatch(/Too many wrong PINs/);
  });

  it('nobody can sign up as "Group OS"', () => {
    expect(login('9876543211', '1234', { name: 'Group OS', signup: true }).error).toMatch(/taken by Group OS/);
  });

  it('one account per number: signing up twice is refused, logging in without an account is refused', () => {
    login('9876543210', '4821', { name: 'Kruthik', signup: true });
    expect(login('9876543210', '1111', { name: 'Someone', signup: true }).error).toMatch(/already has an account/);
    expect(login('9123456780', '1111').error).toMatch(/Sign up first/);
  });

  it('a session identifies the account until logout', () => {
    const { session } = login('9876543210', '4821', { name: 'K', signup: true });
    expect(bySession(session)?.username).toBe('919876543210');
    logout(session!);
    expect(bySession(session)).toBeUndefined();
    expect(bySession('forged')).toBeUndefined();
  });

  it('refuses bad numbers, PINs and empty names', () => {
    expect(login('12345', '1234').error).toMatch(/mobile number/);
    expect(login('abc9876543210', '1234').error).toMatch(/mobile number/);
    expect(login('9876543210', '12', { signup: true, name: 'K' }).error).toMatch(/4 digits/);
    expect(login('9876543210', '1234', { signup: true, name: ' ' }).error).toMatch(/your name/);
    expect(normalizePhone('+1 202 555 0143')).toBe('12025550143');
  });
});

describe('demo groups use the account name', () => {
  const s = {
    people: ['Neha', 'Ravi'],
    messages: [{ speakerId: 'p_neha', speakerName: 'Neha', content: 'neha pls pay. nehaaa! Ravi owes Neha ₹200' }],
    state: { commitments: [{ owner: 'Neha', topicId: 't_neha_rent' }] },
  };

  it('replaces Neha everywhere, keeping other names and ids', async () => {
    const { asPerson } = await import('../../server/live/http');
    const r = asPerson(s, 'Kruthik');
    expect(r.me).toBe('Kruthik');
    expect(r.people).toEqual(['Kruthik', 'Ravi']);
    expect(r.messages[0]).toMatchObject({ speakerId: 'p_kruthik', speakerName: 'Kruthik', content: 'kruthik pls pay. kruthikaa! Ravi owes Kruthik ₹200' });
    expect(r.state.commitments[0]).toEqual({ owner: 'Kruthik', topicId: 't_neha_rent' });
  });

  it('a person named like an example character keeps their name; the character is renamed everywhere', async () => {
    const { asPerson } = await import('../../server/live/http');
    const { sameName } = await import('../engine/receiptVerifier');
    const r = asPerson(s, 'Ravi Kumar');
    expect(r.me).toBe('Ravi Kumar');
    const stand = r.people.find(p => p !== 'Ravi Kumar')!;
    expect(sameName(stand, 'Ravi Kumar')).toBe(false);
    expect(r.messages[0].content).toBe(`ravi kumar pls pay. ravi kumaraa! ${stand} owes Ravi Kumar ₹200`);
  });
});

describe('telling people apart', () => {
  it('different surnames are different people; a missing or matching surname is the same person', async () => {
    const { sameName } = await import('../engine/receiptVerifier');
    expect(sameName('Ravi K', 'Ravi S')).toBe(false);
    expect(sameName('Ravi K', 'Ravi Kumar')).toBe(true);
    expect(sameName('Kiran', 'Kiran K')).toBe(true);
  });
});

describe('sessions', () => {
  it('a session renews with use and expires after 30 days unused', () => {
    const { session } = login('9876543210', '4821', { name: 'K', signup: true });
    expect(bySession(session)?.name).toBe('K');
    const later = Date.now() + 31 * 86400000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(later);
    expect(bySession(session)).toBeUndefined();
    spy.mockRestore();
  });
});

describe('phone numbers', () => {
  it('an Indian number one digit short or long is refused, not saved as a broken number', () => {
    expect(normalizePhone('91 98765 4321')).toBeUndefined();
    expect(normalizePhone('987654321')).toBeUndefined();
    expect(normalizePhone('+91 98765 432100')).toBeUndefined();
    expect(normalizePhone('+91 98765 43210')).toBe('919876543210');
    expect(normalizePhone('+1 202 555 0143')).toBe('12025550143');
  });
});
