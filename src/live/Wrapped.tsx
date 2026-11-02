import React, { useEffect, useState } from 'react';
import { Download, Loader2, Share2, X } from 'lucide-react';
import type { Wrapped } from '../engine/wrapped';
import { api } from './api';

/** Draws the Group Wrapped card on a canvas, so it can be saved or shared as an image. */
async function drawCard(w: Wrapped, art?: string): Promise<string> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0b3d33';
  x.fillRect(0, 0, W, H);
  if (art) {
    const img = await new Promise<HTMLImageElement | null>(res => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = art;
    });
    if (img) {
      const scale = Math.max(W / img.width, (H * 0.55) / img.height);
      x.drawImage(img, (W - img.width * scale) / 2, 0, img.width * scale, img.height * scale);
    }
  }
  const g = x.createLinearGradient(0, H * 0.25, 0, H * 0.6);
  g.addColorStop(0, 'rgba(11,61,51,0)');
  g.addColorStop(1, 'rgba(11,61,51,1)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  const text = (t: string, y: number, size: number, color = '#fff', weight = 700) => {
    x.font = `${weight} ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
    x.fillStyle = color;
    x.fillText(t, 72, y, W - 144);
  };
  text('GROUP OS WRAPPED', 640, 30, '#7ee2c8', 800);
  text(w.title, 710, 64);
  text(w.span, 760, 32, '#cfe9e2', 500);

  const tiles: [string, string][] = [
    [w.messages.toLocaleString('en-IN'), 'messages'],
    [String(w.decided), 'things decided'],
    [String(w.disagreements), 'disagreements'],
    [w.spend === 'nothing' ? '—' : w.spend, 'shared spend'],
  ];
  tiles.forEach(([big, small], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const bx = 72 + col * 480, by = 820 + row * 170;
    x.fillStyle = 'rgba(255,255,255,0.08)';
    x.beginPath();
    x.roundRect(bx, by, 440, 140, 24);
    x.fill();
    x.font = `800 ${big.length > 9 ? 44 : 56}px "Plus Jakarta Sans", system-ui, sans-serif`;
    x.fillStyle = '#fff';
    x.fillText(big, bx + 28, by + 70, 384);
    x.font = '500 28px "Plus Jakarta Sans", system-ui, sans-serif';
    x.fillStyle = '#cfe9e2';
    x.fillText(small, bx + 28, by + 112);
  });

  const lines = [
    w.chattiest && `💬 Chattiest: ${w.chattiest.name} (${w.chattiest.count} messages)`,
    w.nightOwl && `🌙 Night owl: ${w.nightOwl.name}`,
    w.bankOf && `🏦 Bank of the group: ${w.bankOf.name} (${w.bankOf.amount} owed back)`,
    w.savedBySayingNo && `🙅 Saved by saying no: ${w.savedBySayingNo}`,
    w.topics[0] && `🔥 Biggest topic: ${w.topics[0].title}`,
  ].filter(Boolean) as string[];
  lines.slice(0, 4).forEach((l, i) => text(l, 1180 + i * 44, 30, '#fff', 600));
  return c.toDataURL('image/png');
}

export const WrappedSheet: React.FC<{ roomId: string; token: string; onClose: () => void }> = ({ roomId, token, onClose }) => {
  const [png, setPng] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .wrapped(roomId, token)
      .then(r => drawCard(r.stats, r.art))
      .then(setPng)
      .catch(e => setError(e.message));
  }, [roomId, token]);

  const share = async () => {
    const blob = await (await fetch(png)).blob();
    const file = new File([blob], 'group-wrapped.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Group Wrapped' }).catch(() => undefined);
    else window.open(png, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">Group Wrapped</div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        {error ? (
          <p className="text-xs text-rose-700">{error}</p>
        ) : png ? (
          <img src={png} alt="Group Wrapped recap card" className="w-full rounded-xl" data-testid="wrapped-card" />
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-xs text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> Counting everything and painting the card with Muse Image…</div>
        )}
        {png && (
          <div className="flex gap-2">
            <a href={png} download="group-wrapped.png" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 py-2 text-xs font-semibold"><Download className="w-3.5 h-3.5" /> Save</a>
            <button onClick={share} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#008069] py-2 text-xs font-bold text-white"><Share2 className="w-3.5 h-3.5" /> Share</button>
          </div>
        )}
        <p className="text-[10px] text-slate-400">Every number is counted from the chat in code. Muse Image painted the background only.</p>
      </div>
    </div>
  );
};
