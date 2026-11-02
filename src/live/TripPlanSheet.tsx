import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api } from './api';

/**
 * Before the trip planner searches, it shows what the chat already says (with the message it came from) and asks for
 * anything it does not know: where to, where from, dates, budget and how many people. Nothing is assumed.
 */
export const TripPlanSheet: React.FC<{ roomId: string; token: string; topicId: string; onClose: () => void }> = ({ roomId, token, topicId, onClose }) => {
  const [q, setQ] = useState<Awaited<ReturnType<typeof api.tripQuestions>> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .tripQuestions(roomId, token, topicId)
      .then(r => {
        setQ(r);
        setValues(r.facts);
      })
      .catch(e => setError(e.message));
  }, [roomId, token, topicId]);

  const ready = !!q && q.fields.every(f => (values[f.key] ?? '').trim());
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.planTrip(roomId, token, topicId, values);
      if (r.ok) onClose();
      else setError(r.message ?? 'Could not get trip ideas');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={e => e.stopPropagation()} data-testid="trip-sheet">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">🧭 Plan {q?.trip ?? 'this trip'}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        {!q && !error && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}
        {q && (
          <>
            <p className="text-[11px] text-slate-500">Filled in from the chat where it says so. Fill in the rest: Sorted will not guess them.</p>
            {q.fields.map(f => {
              const fromChat = !!q.facts[f.key] && values[f.key] === q.facts[f.key];
              const empty = !(values[f.key] ?? '').trim();
              return (
                <label key={f.key} className="block text-xs font-semibold text-slate-700">
                  {f.label}
                  <input
                    value={values[f.key] ?? ''}
                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={empty ? (f.key === 'people' ? `Not in the chat — this group has ${q.groupSize} members` : 'Not in the chat — please fill') : ''}
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal ${empty ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                    data-testid={`trip-${f.key}`}
                  />
                  {fromChat && q.quotes[f.key] && <span className="mt-0.5 block text-[10px] font-normal text-slate-400">From the chat: “{q.quotes[f.key]}”</span>}
                </label>
              );
            })}
            <button onClick={go} disabled={!ready || busy} className="w-full rounded-lg bg-[#008069] py-2.5 text-sm font-bold text-white disabled:opacity-40" data-testid="trip-go">
              {busy ? 'Searching the web with Meta AI…' : 'Find stays, travel and things to do'}
            </button>
          </>
        )}
        {error && <p className="text-xs text-rose-700">{error}</p>}
      </div>
    </div>
  );
};
