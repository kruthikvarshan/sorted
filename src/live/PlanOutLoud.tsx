import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import { api, Person } from './api';
import { openMicrophone } from '../services/microphone';

/**
 * Plan out loud: put the phone on the table and talk. Muse Voice separates the voices; you say which person each voice
 * is; every turn becomes a message in the group, and Sorted reads it like typed chat.
 */
export const PlanOutLoud: React.FC<{ roomId: string; token: string; me: Person; members: Person[]; onClose: () => void }> = ({ roomId, token, me, members, onClose }) => {
  const [stage, setStage] = useState<'idle' | 'recording' | 'listening' | 'assign' | 'posting'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<{ speaker: string; text: string }[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [who, setWho] = useState<Record<string, string>>({});
  const stopRef = useRef<(() => void) | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (stage !== 'recording') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [stage]);

  const record = async () => {
    setError('');
    try {
      const { stream } = await openMicrophone();
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setStage('listening');
        try {
          const r = await api.listen(roomId, token, new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
          if (!r.turns.length) throw new Error('No speech was heard. Try again closer to the phone.');
          const speakers = [...new Set(r.turns.map(t => t.speaker))];
          setTurns(r.turns);
          setAudioUrl(r.audioUrl);
          setWho(Object.fromEntries(speakers.map((s, i) => [s, i === 0 ? me.name : ''])));
          setStage('assign');
        } catch (e: any) {
          setError(e.message);
          setStage('idle');
        }
      };
      rec.start(250);
      started.current = Date.now();
      setElapsed(0);
      stopRef.current = () => rec.stop();
      setStage('recording');
    } catch {
      setError('The microphone could not start. Allow it for this site and try again.');
    }
  };

  const post = async () => {
    setStage('posting');
    try {
      const r = await api.conversation(roomId, token, turns.map(t => ({ name: who[t.speaker] || `Speaker ${t.speaker}`, text: t.text })), audioUrl);
      if (!r.ok) throw new Error(r.message);
      onClose();
    } catch (e: any) {
      setError(e.message);
      setStage('assign');
    }
  };

  const speakers = [...new Set(turns.map(t => t.speaker))];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={stage === 'idle' || stage === 'assign' ? onClose : undefined}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()} data-testid="plan-out-loud">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">🎙 Plan out loud</div>
          {(stage === 'idle' || stage === 'assign') && <button onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-slate-100"><X className="w-4 h-4" /></button>}
        </div>

        {stage === 'idle' && (
          <>
            <p className="text-xs text-slate-600">Put the phone in the middle and talk it out, in any language. Sorted separates the voices, you say who is who, and the plan lands in the chat.</p>
            <button onClick={record} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#008069] py-3 text-sm font-bold text-white"><Mic className="w-4 h-4" /> Start listening</button>
          </>
        )}
        {stage === 'recording' && (
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-100"><span className="h-6 w-6 animate-pulse rounded-full bg-rose-600" /></div>
            <div className="text-sm font-semibold text-slate-800">Listening… {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</div>
            <button onClick={() => stopRef.current?.()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white"><Square className="w-4 h-4" /> Done talking</button>
          </div>
        )}
        {stage === 'listening' && <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-600"><Loader2 className="w-4 h-4 animate-spin" /> Separating voices with Muse Voice…</div>}
        {(stage === 'assign' || stage === 'posting') && (
          <>
            <p className="text-xs text-slate-600">I heard {speakers.length} voice{speakers.length === 1 ? '' : 's'}. Who is who?</p>
            <div className="max-h-[45vh] space-y-3 overflow-y-auto">
              {speakers.map(s => (
                <div key={s} className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">Voice {s}</span>
                    <select value={who[s] ?? ''} onChange={e => setWho(w => ({ ...w, [s]: e.target.value }))} className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs" aria-label={`Who is voice ${s}`}>
                      <option value="">Choose a person…</option>
                      {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="text-[11px] text-slate-600 italic line-clamp-2">“{turns.find(t => t.speaker === s)?.text}”</div>
                </div>
              ))}
            </div>
            <button onClick={post} disabled={stage === 'posting' || speakers.some(s => !who[s])} className="w-full rounded-xl bg-[#008069] py-3 text-sm font-bold text-white disabled:opacity-40">
              {stage === 'posting' ? 'Adding…' : `Add ${turns.length} message${turns.length === 1 ? '' : 's'} to the chat`}
            </button>
          </>
        )}
        {error && <p className="text-xs text-rose-700">{error}</p>}
      </div>
    </div>
  );
};
