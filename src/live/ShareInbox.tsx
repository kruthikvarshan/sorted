import React, { useEffect, useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import { api } from './api';

/**
 * Where the phone's share menu lands (Android, installed app): an image or text shared from WhatsApp or anywhere else.
 * The person picks which of their groups it is for; Group OS then reads it there.
 */
export const ShareInbox: React.FC<{ go: (path: string) => void }> = ({ go }) => {
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [text] = useState(() => new URLSearchParams(window.location.search).get('text') ?? '');
  const [rooms, setRooms] = useState<{ roomId: string; token: string; title: string; me: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const hit = await (await caches.open('groupos-share')).match('/shared-image');
        if (hit) {
          const blob = await hit.blob();
          setImage(blob);
          setPreview(URL.createObjectURL(blob));
        }
      } catch {
        /* nothing shared */
      }
      const seats = api.seats();
      const named = await Promise.all(seats.map(s => api.mine(s.roomId, s.token).then(r => ({ ...s, title: r.room.title, me: r.me })).catch(() => null)));
      setRooms(named.filter((r): r is NonNullable<typeof r> => !!r));
    })();
  }, []);

  const send = async (roomId: string, token: string) => {
    setBusy(true);
    setError('');
    try {
      if (image) await api.image(roomId, token, image);
      else if (text) await api.send(roomId, token, text);
      try {
        await (await caches.open('groupos-share')).delete('/shared-image');
      } catch {
        /* fine */
      }
      go(`/live/${roomId}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#efeae2] px-4 py-8">
      <div className="mx-auto max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <h1 className="text-base font-bold text-slate-900">Send to which group?</h1>
        {preview ? <img src={preview} alt="Shared image" className="max-h-64 w-full rounded-lg object-contain bg-slate-50" /> : text ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{text}</p> : <p className="flex items-center gap-2 text-sm text-slate-500"><ImageIcon className="w-4 h-4" /> Nothing was shared. Share a screenshot to Group OS from your phone's share menu, or <button onClick={() => go('/live')} className="font-semibold text-[#008069] underline">go to my groups</button>.</p>}
        {rooms === null ? (
          <Loader2 className="mx-auto w-5 h-5 animate-spin text-slate-400" />
        ) : rooms.length === 0 ? (
          <p className="text-sm text-slate-600">You're not in a group on this phone yet. <button onClick={() => go('/live')} className="font-semibold text-[#008069] underline">Start or join one</button>.</p>
        ) : (
          <div className="space-y-2">
            {rooms.map(r => (
              <button key={r.roomId} disabled={busy || (!image && !text)} onClick={() => send(r.roomId, r.token)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-left text-sm font-semibold text-slate-800 hover:border-[#008069] disabled:opacity-50">
                {r.title} <span className="font-normal text-slate-500">· as {r.me}</span>
              </button>
            ))}
          </div>
        )}
        {busy && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading it with Meta AI…</p>}
        {error && <p className="text-xs text-rose-700">{error}</p>}
      </div>
    </div>
  );
};
