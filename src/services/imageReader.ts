import { ReceiptFacts } from '../types/groupOs';
import { MetaModelService } from './metaModelService';
import { parseReceiptReply } from './receiptReader';

/**
 * One look at an image with Muse Spark's vision: is it a payment screenshot (UPI, bank, card) or a screenshot of a
 * chat? A payment gives the printed facts (never guessed). A chat gives its messages, word for word, so a screenshot
 * of any real WhatsApp group can be read like an export.
 */

export interface ChatLine {
  speaker: string;
  time?: string;
  text: string;
}

export type ImageReading =
  | { kind: 'payment'; facts: ReceiptFacts }
  | { kind: 'chat'; title?: string; lines: ChatLine[] }
  | { kind: 'other'; summary: string };

const SYSTEM = `You look at one image from a group chat and say what it is. Reply with JSON only.

If it is a PAYMENT screenshot or receipt (UPI, GPay, PhonePe, Paytm, bank transfer, card):
{"kind":"payment","legible":true,"amount":number|null,"currency":string|null,"payer":string|null,"payee":string|null,"reference":string|null,"date":string|null,"status":string|null,"summary":"one sentence"}
Use null for anything you cannot see. amount is a plain number. Never guess a field.

If it is a SCREENSHOT OF A CHAT (WhatsApp or any messenger):
{"kind":"chat","title":"chat name if visible or null","messages":[{"speaker":"name","time":"HH:MM or null","text":"exact words"}]}
Copy every visible message in order, word for word, in its original language and script. Messages on the right side with no name were sent by the phone's owner: use "You" as the speaker. Skip dates, "typing…", reactions and system lines.

Anything else: {"kind":"other","summary":"one sentence"}`;

export function parseImageReading(raw: string): ImageReading | null {
  try {
    const cleaned = raw.replace(/```json\n?|```/g, '');
    const obj = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
    if (obj.kind === 'payment') {
      const facts = parseReceiptReply(JSON.stringify(obj));
      return facts ? { kind: 'payment', facts } : { kind: 'other', summary: 'A payment screenshot that could not be read clearly.' };
    }
    if (obj.kind === 'chat' && Array.isArray(obj.messages)) {
      const lines: ChatLine[] = obj.messages
        .filter((m: any) => m && typeof m.text === 'string' && m.text.trim() && typeof m.speaker === 'string' && m.speaker.trim())
        .map((m: any) => ({ speaker: m.speaker.trim().slice(0, 40), time: typeof m.time === 'string' ? m.time : undefined, text: m.text.trim().slice(0, 2000) }));
      return lines.length ? { kind: 'chat', title: typeof obj.title === 'string' ? obj.title : undefined, lines } : { kind: 'other', summary: 'A chat screenshot with no readable messages.' };
    }
    return { kind: 'other', summary: typeof obj.summary === 'string' ? obj.summary : 'Not a payment or a chat.' };
  } catch {
    return null;
  }
}

export async function readImage(apiKey: string, imageDataUrl: string, model: string = MetaModelService.DEFAULT_MODEL): Promise<ImageReading | null> {
  const raw = await MetaModelService.callChatCompletion(
    apiKey,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [{ type: 'text', text: 'What is this image? Reply with the JSON.' }, { type: 'image_url', image_url: { url: imageDataUrl } }] },
    ],
    { model, temperature: 0, max_tokens: 12000, reasoningEffort: 'low' }
  );
  return parseImageReading(raw);
}
