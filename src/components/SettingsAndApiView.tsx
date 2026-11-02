import React, { useState } from 'react';
import { Mic } from 'lucide-react';
import { getMicChoice, listMicrophones, MicOption, pickMicrophone, setMicChoice } from '../services/microphone';
import { Cpu, KeyRound, Languages, CheckCircle2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { MetaModelService } from '../services/metaModelService';
import { makeSilentWav } from '../services/audioUtils';
import { getSpokenLanguages, setSpokenLanguages } from '../state/preferences';

interface SettingsAndApiViewProps {
  /** True when Meta AI is switched off and chats are read with the simple offline method. */
  isDemoMode: boolean;
  onToggleDemoMode: (val: boolean) => void;
  apiKey: string;
  onSaveApiKey: (key: string) => void;
  /** True when the server holds the key, so this browser never needs one. */
  serverManagedKey?: boolean;
}

type CheckName = 'chat' | 'models' | 'voice' | 'image';
interface CheckResult {
  name: CheckName;
  status: 'running' | 'ok' | 'error';
  text: string;
  image?: string;
}

const CHECKS: { name: CheckName; label: string; hint: string }[] = [
  { name: 'chat', label: 'Reading and answering', hint: 'Asks Meta AI one short question.' },
  { name: 'models', label: 'Available models', hint: 'Lists what your key can use.' },
  { name: 'voice', label: 'Voice notes', hint: 'Sends one second of silence to the transcriber.' },
  { name: 'image', label: 'Pictures', hint: 'Makes one small picture.' },
];

export const SettingsAndApiView: React.FC<SettingsAndApiViewProps> = ({
  isDemoMode,
  onToggleDemoMode,
  apiKey,
  onSaveApiKey,
  serverManagedKey = false,
}) => {
  const [inputKey, setInputKey] = useState(apiKey && apiKey !== 'server-managed' ? apiKey : '');
  const [saved, setSaved] = useState(false);
  const [languages, setLanguages] = useState(() => getSpokenLanguages().join(', '));
  const [result, setResult] = useState<CheckResult | null>(null);
  const [mics, setMics] = useState<MicOption[] | null>(null);
  const [micChoice, setMicChoiceState] = useState(getMicChoice());
  const [micNote, setMicNote] = useState('');

  const findMicrophones = async () => {
    setMicNote('');
    try {
      // Names are only visible after the browser has allowed the microphone once.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      setMics(await listMicrophones());
    } catch {
      setMicNote('Allow the microphone for this site in your browser, then try again.');
    }
  };
  const chooseMic = (id: string) => {
    setMicChoiceState(id);
    setMicChoice(id);
  };
  const autoMic = mics ? pickMicrophone(mics, '') : undefined;

  // When the server holds the key, requests carry a placeholder that the server replaces. Nothing secret is involved.
  const testKey = serverManagedKey ? 'server-managed' : inputKey.trim();
  const hasKey = serverManagedKey || !!(apiKey && apiKey !== 'server-managed') || !!inputKey.trim();

  const save = () => {
    onSaveApiKey(inputKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const runCheck = async (name: CheckName) => {
    if (!testKey) {
      setResult({ name, status: 'error', text: 'Add your Meta key first.' });
      return;
    }
    setResult({ name, status: 'running', text: 'Checking…' });
    try {
      if (name === 'chat') {
        const reply = await MetaModelService.callChatCompletion(
          testKey,
          [{ role: 'user', content: 'Reply with one short, friendly sentence confirming you are connected to Sorted.' }],
          { temperature: 0.2, max_tokens: 1500 }
        );
        setResult({ name, status: 'ok', text: reply.trim() });
      } else if (name === 'models') {
        const ids = await MetaModelService.listModels(testKey);
        setResult({ name, status: 'ok', text: ids.length ? `Your key can use: ${ids.join(', ')}` : 'Connected, but no models were listed.' });
      } else if (name === 'voice') {
        const res = await MetaModelService.transcribeAudioWithMeta(testKey, makeSilentWav(1));
        if (!res.success) throw new Error(res.error);
        setResult({ name, status: 'ok', text: 'Voice notes work. A second of silence was sent and nothing was heard, as expected.' });
      } else {
        const res = await MetaModelService.generateImageWithMeta(testKey, 'A simple watercolor of a train at sunrise');
        if (!res.success || !res.data) throw new Error(res.error || 'No picture came back');
        setResult({ name, status: 'ok', text: 'Pictures work.', image: res.data });
      }
    } catch (err: any) {
      setResult({ name, status: 'error', text: err.message || 'That did not work.' });
    }
  };

  return (
    <div className="flex-1 bg-[#efeae2] p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Settings</h1>
          <p className="text-xs text-slate-600 mt-1">Connect Meta AI and choose how Sorted reads your chats.</p>
        </div>

        {/* Connection */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <KeyRound className="w-4 h-4 text-[#008069]" /> Meta AI connection
          </h2>

          {serverManagedKey ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Your Meta key is kept on the server and is never sent to this browser, so there is nothing to paste.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="meta-key" className="text-xs font-bold text-slate-700">
                Your Meta key
              </label>
              <div className="flex gap-2">
                <input
                  id="meta-key"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste the key from dev.meta.ai"
                  value={inputKey}
                  onChange={e => setInputKey(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#008069]"
                />
                <button onClick={save} className="px-4 py-2 bg-[#008069] hover:bg-[#00705c] text-white rounded-lg text-xs font-bold">
                  {saved ? 'Saved' : 'Save'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">Kept in this browser tab only. Closing the tab forgets it.</p>
            </div>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!isDemoMode}
              disabled={!hasKey}
              onChange={e => onToggleDemoMode(!e.target.checked)}
              className="mt-0.5 rounded text-[#008069] focus:ring-[#008069] h-4 w-4"
            />
            <span>
              <span className="block text-xs font-bold text-slate-900">Use Meta AI to read my chats</span>
              <span className="block text-[11px] text-slate-500">
                {hasKey
                  ? 'Turn this off to work offline: chats are then read with a simple method that finds far less.'
                  : 'Add your key to turn this on.'}
              </span>
            </span>
          </label>
        </section>

        {/* Checks */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Cpu className="w-4 h-4 text-[#008069]" /> Check the connection
          </h2>
          <div className="flex flex-wrap gap-2">
            {CHECKS.map(c => (
              <button
                key={c.name}
                onClick={() => runCheck(c.name)}
                disabled={result?.status === 'running'}
                title={c.hint}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {c.label}
              </button>
            ))}
          </div>

          {result && (
            <div
              role="status"
              className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                result.status === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : result.status === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              {result.status === 'running' && <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
              {result.status === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              {result.status === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
              <div className="space-y-2 min-w-0">
                <p className="break-words">{result.text}</p>
                {result.image && <img src={result.image} alt="A small test picture" className="max-h-40 rounded border border-slate-200" />}
              </div>
            </div>
          )}
        </section>

        {/* Microphone */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-2 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Mic className="w-4 h-4 text-[#008069]" /> Microphone for voice notes
          </h2>
          <p className="text-[11px] text-slate-500">
            Sorted uses your computer's own microphone, not a phone nearby, unless you choose otherwise here.
          </p>
          {mics === null ? (
            <button onClick={findMicrophones} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Show my microphones
            </button>
          ) : (
            <select
              value={micChoice}
              onChange={e => chooseMic(e.target.value)}
              aria-label="Microphone for voice notes"
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#008069]"
            >
              <option value="">Automatic{autoMic ? ` (${autoMic.label})` : ''}</option>
              {mics.filter(m => m.deviceId !== 'default' && m.deviceId !== 'communications').map(m => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          {micNote && <p className="text-[11px] text-rose-700">{micNote}</p>}
        </section>

        {/* Voice languages */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-2 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Languages className="w-4 h-4 text-[#008069]" /> Languages you speak in voice notes
          </h2>
          <input
            type="text"
            value={languages}
            onChange={e => setLanguages(e.target.value)}
            onBlur={() => setSpokenLanguages(languages)}
            placeholder="English, Telugu, Hindi"
            aria-label="Languages you speak in voice notes"
            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#008069]"
          />
          <p className="text-[11px] text-slate-500">
            Meta's voice model understands 25 languages, including Telugu and Hindi, even mixed in one sentence. This list is a hint,
            not a limit. Leave it empty and the model works out the language itself.
          </p>
        </section>
      </div>
    </div>
  );
};
