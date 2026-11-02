import { Evidence, Message } from '../types/groupOs';

/** People never see message or evidence ids. They see who said it and when. */

export function evidenceLabel(ev: Pick<Evidence, 'messageId' | 'sourceType'>, messages: Message[]): string {
  if (ev.sourceType === 'user_confirmation') return 'Confirmed in the app';
  const m = messages.find(x => x.id === ev.messageId);
  return m ? `${m.speakerName}, ${m.timestamp}` : 'Earlier message';
}

const ID_LIKE = /^(m|ev|att|msg)_[\w-]+$/i;
const ID_ANYWHERE = /^[a-z]{1,4}_\d+$|^(m|ev|att|msg)_[\w-]+$/i;

/**
 * Model answers cite messages by id ("[m_goa_04]"). Turn those into "(Alex, 10:02)". An id that matches no message
 * is dropped rather than shown, and bracketed text that is not an id (a group name, say) is left alone.
 */
export function humanizeCitations(text: string, messages: Message[]): string {
  return text
    .replace(/\[([^\]\n]{1,200})\]/g, (whole, inner: string) => {
      const parts = inner.split(/[,;]\s*/).map(p => p.trim()).filter(Boolean);
      if (parts.length === 0 || !parts.every(p => ID_ANYWHERE.test(p) || ID_LIKE.test(p))) return whole;
      const labels = parts
        .map(id => messages.find(m => m.id === id))
        .filter((m): m is Message => !!m)
        .map(m => `${m.speakerName}, ${m.timestamp}`);
      return labels.length ? `(${Array.from(new Set(labels)).join('; ')})` : '';
    })
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
