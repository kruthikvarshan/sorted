import React, { useState } from 'react';
import { Loader2, Lock, Send } from 'lucide-react';
import { api } from './api';

/**
 * My Group OS: ask privately across every group on this phone. Only results go to Meta AI, each group counted on its
 * own; nothing asked here is stored.
 */
export const PrivateChat: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState<{ who: 'me' | 'bot'; text: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const ask = async (text = question) => {
    const q = text.trim();
    if (!q || asking) return;
    setQuestion('');
    setThread(t => [...t, { who: 'me', text: q }]);
    setAsking(true);
    try {
      const r = await api.ask(api.scopedSeats(), q);
      setThread(t => [...t, { who: 'bot', text: r.text }]);
    } catch (e: any) {
      setThread(t => [...t, { who: 'bot', text: e.message }]);
    } finally {
      setAsking(false);
    }
  };
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-3 space-y-2 ${compact ? 'text-xs' : 'text-sm'}`} data-testid="private-chat">
      <div className="flex items-center gap-1.5 font-bold text-slate-900"><Lock className="w-3.5 h-3.5 text-[#008069]" /> Ask Group OS privately</div>
      <p className="text-[11px] text-slate-500">Only you see this. It covers the groups you added to My Group OS, each counted on its own. Nothing you ask is saved.</p>
      <div className="space-y-1.5">
        {thread.map((m, i) => (
          <div key={i} className={`rounded-lg px-2.5 py-1.5 ${m.who === 'me' ? 'ml-6 bg-[#d9fdd3]' : 'mr-6 bg-slate-100'} whitespace-pre-wrap`}>{m.text}</div>
        ))}
        {asking && <div className="mr-6 flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> Thinking…</div>}
      </div>
      {!thread.length && (
        <div className="flex flex-wrap gap-1.5">
          {['How much do I owe overall?', 'What did I promise to do?', 'What is still undecided?', "What's coming up this week?"].map(q => (
            <button key={q} onClick={() => ask(q)} className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] text-slate-700">{q}</button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} placeholder="Ask about your money, promises or plans" className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
        <button onClick={() => ask()} disabled={asking || !question.trim()} aria-label="Ask privately" className="rounded-md bg-[#008069] px-2.5 text-white disabled:opacity-40"><Send className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
};
