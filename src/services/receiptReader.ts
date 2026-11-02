import { ReceiptFacts } from '../types/groupOs';
import { MetaApiCallResult, MetaModelService } from './metaModelService';

/**
 * Reads a payment receipt image with Muse Spark (a model that can read images; Muse Image, which generates them,
 * is not involved). The result is only what is printed on the image. Deciding whether it settles a claim is a
 * separate, human step.
 */

const SYSTEM = `You read photos and screenshots of payment receipts (UPI, bank transfer, card, wallet or a handwritten receipt).
Reply with JSON only, no prose, in exactly this shape:
{"legible": boolean, "amount": number|null, "currency": string|null, "payer": string|null, "payee": string|null, "reference": string|null, "date": string|null, "status": string|null, "summary": string}
Rules:
- Use null for anything you cannot see. Never guess, infer or complete a field.
- amount is a plain number with no symbols or commas.
- If the image is not a payment receipt, or you cannot read it, set legible to false.
- summary is one short sentence describing only what is printed.`;

const extractJson = (text: string): any => {
  const cleaned = text.replace(/```json\n?|```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in the model reply');
  return JSON.parse(cleaned.slice(start, end + 1));
};

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const amountOf = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

/** Turn the model's JSON into facts, or null when it says the image is not a readable receipt. */
export function parseReceiptReply(raw: string): ReceiptFacts | null {
  const obj = extractJson(raw);
  if (obj.legible === false) return null;
  const facts: ReceiptFacts = {
    amount: amountOf(obj.amount),
    currency: text(obj.currency),
    payer: text(obj.payer),
    payee: text(obj.payee),
    reference: text(obj.reference),
    date: text(obj.date),
    status: text(obj.status),
    summary: text(obj.summary) ?? 'Receipt',
  };
  // Nothing usable was read: treat it as unreadable rather than a receipt with no facts.
  return facts.amount === null && !facts.reference && !facts.payer && !facts.payee ? null : facts;
}

export async function readReceipt(
  apiKey: string,
  imageDataUrl: string,
  model: string = MetaModelService.DEFAULT_MODEL
): Promise<MetaApiCallResult<ReceiptFacts | null>> {
  try {
    const raw = await MetaModelService.callChatCompletion(
      apiKey,
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this receipt.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      { model, temperature: 0, max_tokens: 4000 }
    );
    return { success: true, data: parseReceiptReply(raw), modelUsed: model, timestamp: new Date().toISOString() };
  } catch (err: any) {
    return { success: false, error: err.message, modelUsed: model, timestamp: new Date().toISOString() };
  }
}

/** Browser only: shrink a photo before sending it, so a 12 MB phone picture does not cost thousands of tokens. */
export async function fileToReceiptDataUrl(file: File, maxSide = 1400): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the image.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.88);
}
