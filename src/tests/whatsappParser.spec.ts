import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from '../engine/whatsappParser';

describe('whatsapp export parser', () => {
  it('parses the 12h Android/US format', () => {
    const out = parseWhatsAppExport('10/24/24, 9:15 AM - Alex: Leaving Friday\n10/24/24, 9:18 AM - Priya Sharma: Saturday works');
    expect(out).toMatchObject([
      { timestamp: '10/24/24, 9:15 AM', speaker: 'Alex', content: 'Leaving Friday' },
      { timestamp: '10/24/24, 9:18 AM', speaker: 'Priya Sharma', content: 'Saturday works' },
    ]);
  });

  it('parses the 24h European format and the iOS bracket format with seconds', () => {
    const out = parseWhatsAppExport('24/10/2024, 21:15 - Ravi: nenu ostunna\n[24/10/2024, 21:16:30] Sita: సరే');
    expect(out.map(m => [m.speaker, m.content])).toEqual([['Ravi', 'nenu ostunna'], ['Sita', 'సరే']]);
  });

  it('handles the narrow no-break space newer exports put before AM/PM', () => {
    const out = parseWhatsAppExport('10/24/24, 9:15 AM - Alex: hello');
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('hello');
  });

  it('strips invisible direction marks that iOS adds to lines', () => {
    const out = parseWhatsAppExport('‎[24/10/2024, 21:15:30] Alex: ‎hi there');
    expect(out).toHaveLength(1);
    expect(out[0].speaker).toBe('Alex');
  });

  it('joins multi-line messages and keeps Telugu, Hindi and emoji intact', () => {
    const out = parseWhatsAppExport('10/24/24, 9:15 AM - Sita: ఆదివారం ఫంక్షన్ ఉంది\nఅందరూ రండి 🎉\nkal milte hain\n10/24/24, 9:16 AM - Ravi: ok');
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe('ఆదివారం ఫంక్షన్ ఉంది అందరూ రండి 🎉 kal milte hain');
  });

  it('drops system lines, including ones that contain a colon, without gluing them to the previous message', () => {
    const out = parseWhatsAppExport(
      [
        '10/24/24, 9:00 AM - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.',
        '10/24/24, 9:01 AM - Alex: Trip chat is live',
        '10/24/24, 9:02 AM - Alex changed the subject to "Trip: Goa"',
        '10/24/24, 9:03 AM - Priya joined using this group\'s invite link',
        '10/24/24, 9:04 AM - Sam: ok',
      ].join('\n')
    );
    expect(out.map(m => m.content)).toEqual(['Trip chat is live', 'ok']);
  });

  it('drops media placeholders, voice-note attachments and deleted messages', () => {
    const out = parseWhatsAppExport(
      [
        '10/24/24, 9:00 AM - Alex: <Media omitted>',
        '10/24/24, 9:01 AM - Alex: <attached: PTT-20241024-WA0001.opus>',
        '10/24/24, 9:02 AM - Priya: This message was deleted',
        '10/24/24, 9:03 AM - Sam: sticker omitted',
        '10/24/24, 9:04 AM - Sam: real message',
      ].join('\n')
    );
    expect(out.map(m => m.content)).toEqual(['real message']);
  });

  it('keeps colons inside the message body and does not split the speaker wrongly', () => {
    const out = parseWhatsAppExport('10/24/24, 9:15 AM - Alex: Plan: leave at 10:30 sharp');
    expect(out[0]).toMatchObject({ speaker: 'Alex', content: 'Plan: leave at 10:30 sharp' });
  });

  it('returns nothing for empty or non-chat text without throwing', () => {
    expect(parseWhatsAppExport('')).toEqual([]);
    expect(parseWhatsAppExport('just some pasted words\nwith no timestamps')).toEqual([]);
  });

  it('reads real send times, working out day-first or month-first from the whole file', () => {
    const indian = parseWhatsAppExport('03/11/24, 21:15 - Ravi: one\n25/11/24, 08:05 - Sita: two');
    expect(new Date(indian[0].at!).toDateString()).toBe(new Date(2024, 10, 3).toDateString()); // 3 Nov, day first
    expect(new Date(indian[1].at!).getHours()).toBe(8);
    const us = parseWhatsAppExport('11/03/24, 9:15 PM - Ravi: one\n11/25/24, 9:18 AM - Sita: two');
    expect(new Date(us[0].at!).toDateString()).toBe(new Date(2024, 10, 3).toDateString()); // Nov 3, month first
    expect(new Date(us[0].at!).getHours()).toBe(21);
    const bracket = parseWhatsAppExport('[24/10/2024, 21:15:30] Ravi: hi');
    expect(new Date(bracket[0].at!).getFullYear()).toBe(2024);
  });
});
