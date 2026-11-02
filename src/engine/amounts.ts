/**
 * A payment recorded without its amount ("18000 rent + 1000 electricity bhej diya") gets it from its own quotes, in
 * code: a quote with one amount ("haan aa gaya 19000"), or amounts joined by "+" (added up). A quote with several
 * unrelated numbers is never guessed from. The largest such figure is the payment (the receiver's total).
 */
export function amountFromQuotes(quotes: string[]): number | undefined {
  const found: number[] = [];
  for (const raw of quotes) {
    // A flat, house or room number ("B-402", "flat 402", "#305", "no. 12") is not money.
    const q = raw.replace(/\b([a-z]-?\d{1,4}|(flat|room|house|block|apt|unit|no\.?|#)\s*-?\d{1,4})\b/gi, ' ');
    // "18000 rent + 1000 electricity = 19000": the figure after "=" is the total.
    const total = q.replace(/(\d),(\d)/g, '$1$2').match(/=\s*₹?\s*(\d+(?:\.\d+)?)\s?(k\b)?/i);
    if (total) {
      found.push(parseFloat(total[1]) * (total[2] ? 1000 : 1));
      continue;
    }
    const nums = (q.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?\s?k\b|\d+(?:\.\d+)?/gi) ?? [])
      .map(t => (/k$/i.test(t.trim()) ? parseFloat(t) * 1000 : parseFloat(t)))
      .filter(n => n >= 10);
    if (nums.length === 1) found.push(nums[0]);
    else if (nums.length > 1 && /\+/.test(q)) {
      // "19k bheja, 18k rent + 1k light": one figure is the others added up, so it is the total, counted once.
      const top = Math.max(...nums);
      const rest = nums.reduce((a, b) => a + b, 0) - top;
      found.push(Math.abs(rest - top) < 1 ? top : rest + top);
    }
  }
  return found.length ? Math.max(...found) : undefined;
}

/** The amount a payment's own description states ("Pay 1000 electricity share"), when it states exactly one. */
export function amountInText(text: string): number | undefined {
  // Only a figure that reads as money in the description ("Pay 1000", "₹500", "800 each") overrides the model's amount.
  if (/\+/.test(text) || !/(₹|rs\.?|inr|pay|paid|sent|send|share of|each)\s*\d|\d\s*(each|rupees|rs)\b/i.test(text)) return undefined;
  return amountFromQuotes([text]);
}

interface PaymentLike {
  id: string;
  amount?: number;
  evidenceIds: string[];
  ownerName?: string;
  payee?: string;
}

/**
 * One message, one transfer: payments that quote the same message ("haan bhai aa gaya 19000") together never add up to
 * more than the amount that message states. The model may describe one 19,000 transfer as "rent 18,000",
 * "electricity 1,000" and "rent and light 19,000"; it is still 19,000. Payments are taken in order; what is left of a
 * message's amount is all a later payment quoting it can use. The cap is per payer and receiver: "dono ke 400 mil
 * gaye" confirms Kruthik's 400 and Swapnil's 400 to Aniket, two transfers.
 */
export function capByMessage<T extends PaymentLike>(payments: T[], evidenceMap: Record<string, { messageId: string; quote: string }>): T[] {
  const left = new Map<string, number>();
  const out: T[] = [];
  for (const p of payments) {
    if (!p.amount) continue;
    let use = p.amount;
    const stated: string[] = [];
    for (const id of p.evidenceIds) {
      const ev = evidenceMap[id];
      if (!ev) continue;
      const amount = amountFromQuotes([ev.quote]);
      if (amount === undefined) continue;
      const k = `${ev.messageId}|${(p.ownerName ?? '').toLowerCase()}>${(p.payee ?? '').toLowerCase()}`;
      if (!left.has(k)) left.set(k, amount);
      stated.push(k);
      use = Math.min(use, left.get(k)!);
    }
    if (use <= 0.005) continue;
    stated.forEach(m => left.set(m, left.get(m)! - use));
    out.push(use === p.amount ? p : { ...p, amount: use });
  }
  return out;
}
