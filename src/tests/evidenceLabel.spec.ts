import { describe, expect, it } from 'vitest';
import { evidenceLabel, humanizeCitations } from '../engine/evidenceLabel';
import { Message } from '../types/groupOs';

const m = (id: string, speakerName: string, timestamp: string): Message => ({ id, conversationId: 'w', speakerId: 'u', speakerName, timestamp, content: 'x', type: 'text', createdAt: 0 });
const messages = [m('m_goa_04', 'Alex', '10:02 AM'), m('m_goa_06', 'Priya', '10:09 AM'), m('hf_01', 'Aman', '9:00 AM')];

describe('showing who said it instead of an id', () => {
  it('labels evidence with the speaker and time', () => {
    expect(evidenceLabel({ messageId: 'm_goa_04', sourceType: 'message' }, messages)).toBe('Alex, 10:02 AM');
  });
  it('labels in-app confirmations and unknown messages without leaking ids', () => {
    expect(evidenceLabel({ messageId: 'user_action_confirm_payment', sourceType: 'user_confirmation' }, messages)).toBe('Confirmed in the app');
    expect(evidenceLabel({ messageId: 'gone_99', sourceType: 'message' }, messages)).toBe('Earlier message');
  });
});

describe('model answers with citations', () => {
  it('turns bracketed message ids into speaker and time', () => {
    expect(humanizeCitations('The budget is ₹15,000 [m_goa_06].', messages)).toBe('The budget is ₹15,000 (Priya, 10:09 AM).');
  });
  it('handles several ids in one bracket and removes repeats', () => {
    expect(humanizeCitations('Booked for 5 [m_goa_04, m_goa_06, m_goa_04].', messages)).toBe('Booked for 5 (Alex, 10:02 AM; Priya, 10:09 AM).');
  });
  it('drops an id that matches no message instead of showing it', () => {
    const out = humanizeCitations('Priya cannot leave Friday [m_nope_01].', messages);
    expect(out).toBe('Priya cannot leave Friday.');
    expect(out).not.toMatch(/m_nope/);
  });
  it('leaves bracketed text that is not an id, such as a group name', () => {
    expect(humanizeCitations('In [Goa Trip 🏖️] you booked lodging.', messages)).toBe('In [Goa Trip 🏖️] you booked lodging.');
  });
  it('handles short ids like hf_01 and plain text with no citations', () => {
    expect(humanizeCitations('Rent is 9000 [hf_01].', messages)).toBe('Rent is 9000 (Aman, 9:00 AM).');
    expect(humanizeCitations('Nothing to cite here.', messages)).toBe('Nothing to cite here.');
  });
});
