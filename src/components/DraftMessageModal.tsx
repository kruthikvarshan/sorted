import React from 'react';
import { Sparkles, Loader2, AlertTriangle, Send, RefreshCw, X } from 'lucide-react';

export interface DraftState {
  conflictId: string;
  topic: string;
  status: 'drafting' | 'ready' | 'error';
  text: string;
  ungroundedFigures: string[];
  model?: string;
  error?: string;
}

interface DraftMessageModalProps {
  draft: DraftState;
  senderName: string;
  onTextChange: (text: string) => void;
  onPost: () => void;
  onRedraft: () => void;
  onCancel: () => void;
}

/** Shows Muse's draft for one conflict. Nothing is posted until the person edits it and presses Post. */
export const DraftMessageModal: React.FC<DraftMessageModalProps> = ({ draft, senderName, onTextChange, onPost, onRedraft, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Draft a message to the group">
    <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Sparkles className="w-4 h-4 text-purple-600" /> Draft for the group
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">About: {draft.topic}. Nothing is sent until you press Post.</p>
        </div>
        <button onClick={onCancel} aria-label="Close" className="text-slate-400 hover:text-slate-700">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        {draft.status === 'drafting' && (
          <div className="flex items-center gap-2 py-8 justify-center text-xs text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" /> Muse is drafting from the evidence…
          </div>
        )}

        {draft.status === 'error' && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            Could not draft a message: {draft.error}
          </div>
        )}

        {draft.status === 'ready' && (
          <>
            <textarea
              value={draft.text}
              onChange={e => onTextChange(e.target.value)}
              rows={6}
              className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm leading-relaxed text-slate-900 focus:border-[#008069] focus:outline-none"
              aria-label="Draft message, editable"
            />
            {draft.ungroundedFigures.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  The draft mentions <b>{draft.ungroundedFigures.join(', ')}</b>, which is not in the conflict details. Check it or remove it
                  before posting.
                </span>
              </div>
            )}
            <p className="text-[11px] text-slate-500">
              Will be posted as <b>{senderName}</b>, labelled "Drafted by Meta {draft.model}, approved by {senderName}".
            </p>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 p-3">
        <button
          onClick={onRedraft}
          disabled={draft.status === 'drafting'}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Draft again
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            Discard
          </button>
          <button
            onClick={onPost}
            disabled={draft.status !== 'ready' || !draft.text.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-[#008069] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#00705c] disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" /> Post to group
          </button>
        </div>
      </div>
    </div>
  </div>
);
