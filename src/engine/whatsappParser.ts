/**
 * Parser for WhatsApp "Export chat" text files (iOS and Android, 12h and 24h clocks, several date styles).
 * Language-agnostic: it only reads the line structure, never the words.
 */

export interface ParsedLine {
  timestamp: string;
  speaker: string;
  content: string;
  /** Epoch ms, when the date could be read (day/month order is worked out from the whole file). */
  at?: number;
}

/** Day-first (India, UK) or month-first (US)? Decided from the whole export: any first part above 12 settles it. */
function dayFirst(dates: string[]): boolean {
  for (const d of dates) {
    const [a, b] = d.split(/[\/.\-]/).map(Number);
    if (a > 12) return true;
    if (b > 12) return false;
  }
  return true;
}

export function toEpoch(date: string, time: string, dmy: boolean): number | undefined {
  const [p1, p2, p3] = date.split(/[\/.\-]/).map(Number);
  const [day, month] = dmy ? [p1, p2] : [p2, p1];
  const year = p3 < 100 ? 2000 + p3 : p3;
  const t = time.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([APap])?/);
  if (!t || !day || !month || !year) return undefined;
  let hour = Number(t[1]) % (t[4] ? 12 : 24);
  if (t[4] && /p/i.test(t[4])) hour += 12;
  const ms = new Date(year, month - 1, day, hour, Number(t[2]), Number(t[3] ?? 0)).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

const DATE = String.raw`\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?`;

// "10/24/24, 9:15 AM - Name: text"  /  "24.10.2024, 21:15 - Name: text"
const DASH_FORMAT = new RegExp(String.raw`^(${DATE}),?\s+(${TIME})\s+-\s+([^:]+?):\s+(.*)$`);
// "[24/10/2024, 21:15:30] Name: text"
const BRACKET_FORMAT = new RegExp(String.raw`^\[(${DATE}),?\s+(${TIME})\]\s+([^:]+?):\s+(.*)$`);
// Any dated line, with or without a sender: used to spot system lines
const DATED_LINE = new RegExp(String.raw`^\[?${DATE},?\s+${TIME}\]?\s+-?\s*`);

// Invisible marks and the narrow no-break space newer exports put before AM/PM
const INVISIBLE = /[‎‏‪-‮]/g;
const SPACES = /[  ]/g;

const SYSTEM_SENDER =
  /(changed|added|removed|left|joined|created|deleted|updated|security code|end-to-end|invited|pinned|turned|messages and calls|you were added)/i;

const MEDIA_ONLY =
  /^(<)?(media|image|video|audio|sticker|gif|document|contact card|voice call|video call)\s+(omitted|attached)(>)?$|^<attached:.*>$|^\(file attached\)$|^this message was deleted\.?$|^you deleted this message\.?$|^missed (voice|video) call$/i;

export function parseWhatsAppExport(text: string): ParsedLine[] {
  const messages: ParsedLine[] = [];
  let current: ParsedLine | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(INVISIBLE, '').replace(SPACES, ' ').trim();
    if (!line) continue;

    const match = line.match(DASH_FORMAT) || line.match(BRACKET_FORMAT);
    if (match) {
      const [, date, time, speaker, content] = match;
      if (SYSTEM_SENDER.test(speaker) || speaker.length > 40) {
        // e.g. 'Alex changed the subject to "Trip: Goa"': a system line that happens to contain a colon
        if (current) messages.push(current);
        current = null;
        continue;
      }
      if (current) messages.push(current);
      current = { timestamp: `${date}, ${time}`, speaker: speaker.trim(), content: content.trim() };
    } else if (DATED_LINE.test(line)) {
      // Dated but no sender: "Messages and calls are end-to-end encrypted", "X joined using a link"
      if (current) messages.push(current);
      current = null;
    } else if (current) {
      current.content += ` ${line}`; // continuation of a multi-line message
    }
  }
  if (current) messages.push(current);

  const dmy = dayFirst(messages.map(m => m.timestamp.split(',')[0]));
  for (const m of messages) {
    const [date, time] = m.timestamp.split(/,\s*/);
    m.at = toEpoch(date, time ?? '', dmy);
  }
  return messages.filter(m => !MEDIA_ONLY.test(m.content.trim()));
}
