import React, { useEffect, useState, useRef } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  Play,
  Pause,
  FileText,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  Search,
  CheckCircle,
  MoreVertical,
  CheckCheck,
  Loader2,
} from 'lucide-react';
import { humanizeCitations } from '../engine/evidenceLabel';
import { openMicrophone } from '../services/microphone';
import { Message, Workspace, Attachment } from '../types/groupOs';

export interface VoiceDraft {
  transcript: string;
  durationSec: number;
  model: string;
  detail: string;
  audioUrl: string;
}

type VoiceState =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number; mic: string }
  | { phase: 'working' }
  | { phase: 'review'; draft: VoiceDraft; text: string }
  | { phase: 'error'; message: string };

/** Longest voice note we record; Meta accepts up to 10 minutes, but a chat message should be short. */
const MAX_RECORDING_SEC = 120;

interface ConversationCenterProps {
  workspace: Workspace;
  messages: Message[];
  attachments: Record<string, Attachment>;
  highlightedMessageId: string | null;
  onSendMessage: (content: string, type?: Message['type'], attachment?: Attachment) => void;
  onInspectEvidence: (messageId: string) => void;
  onAskGroupOs: (query: string) => void;
  onRunMetaExtraction?: () => void;
  isAnalyzingWithMeta?: boolean;
  onGenerateVisual?: () => void;
  isGeneratingVisual?: boolean;
  /** Transcribes a recording. Rejects with a message that is safe to show the user. */
  onTranscribeVoiceNote?: (audio: Blob) => Promise<VoiceDraft>;
  onPostVoiceNote?: (draft: VoiceDraft, text: string) => void;
}

export const ConversationCenter: React.FC<ConversationCenterProps> = ({
  workspace,
  messages,
  attachments,
  highlightedMessageId,
  onSendMessage,
  onInspectEvidence,
  onAskGroupOs,
  onRunMetaExtraction,
  isAnalyzingWithMeta = false,
  onGenerateVisual,
  isGeneratingVisual = false,
  onTranscribeVoiceNote,
  onPostVoiceNote,
}) => {
  const [inputText, setInputText] = useState('');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const getContextualPrompts = () => [
    { label: "What's decided?", query: 'What has the group decided so far?' },
    { label: 'Who owes what?', query: 'Who owes what in this group?' },
    { label: 'Any clashes?', query: 'Does anything in this group contradict something else?' },
    { label: "What's pending?", query: 'What is still pending or not confirmed?' },
  ];

  const contextualPrompts = getContextualPrompts();

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    if (inputText.trim().toLowerCase().startsWith('@sorted') || inputText.trim().startsWith('@group')) {
      onAskGroupOs(inputText.replace(/@Sorted|@GroupOS|@group/gi, '').trim());
    } else {
      onSendMessage(inputText.trim(), 'text');
    }
    setInputText('');
  };

  const [voice, setVoice] = useState<VoiceState>({ phase: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isRecording = voice.phase === 'recording';

  // A visible timer, and a hard stop so a forgotten recording does not run forever.
  useEffect(() => {
    if (voice.phase !== 'recording') return;
    const tick = setInterval(() => {
      const sec = Math.floor((Date.now() - voice.startedAt) / 1000);
      setElapsed(sec);
      if (sec >= MAX_RECORDING_SEC) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(tick);
  }, [voice]);

  const micError = (err: any): string => {
    const name = err?.name || '';
    if (!window.isSecureContext) return 'Voice notes need a secure page (https or localhost). Open the app from localhost or an https address.';
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'This browser cannot record audio. Try Chrome, Edge, Safari or Firefox.';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow the microphone for this site in your browser (the icon in the address bar), then try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect one, or pick an input device in your system settings.';
    if (name === 'NotReadableError') return 'The microphone is busy in another app. Close it there and try again.';
    return `The microphone could not start${err?.message ? ` (${err.message})` : ''}.`;
  };

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    if (!onTranscribeVoiceNote) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('unsupported');
      const { stream, label } = await openMicrophone();
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) {
          setVoice({ phase: 'error', message: 'Nothing was recorded. Try again.' });
          return;
        }
        setVoice({ phase: 'working' });
        try {
          const draft = await onTranscribeVoiceNote(blob);
          setVoice({ phase: 'review', draft, text: draft.transcript });
        } catch (err: any) {
          setVoice({ phase: 'error', message: err?.message || 'The voice note could not be transcribed.' });
        }
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setElapsed(0);
      setVoice({ phase: 'recording', startedAt: Date.now(), mic: label });
    } catch (err: any) {
      setVoice({ phase: 'error', message: micError(err) });
    }
  };

  const postVoice = () => {
    if (voice.phase !== 'review' || !voice.text.trim()) return;
    onPostVoiceNote?.(voice.draft, voice.text);
    setVoice({ phase: 'idle' });
  };

  const handleCopyQuote = (msg: Message) => {
    navigator.clipboard.writeText(`"${msg.content}" — ${msg.speakerName}, ${msg.timestamp}`);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredMessages = messages.filter((m) => {
    if (!searchQuery.trim()) return true;
    return (
      m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.speakerName.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-[#efeae2] border-r border-[#e9edef] overflow-hidden">
      {/* WhatsApp Web Style Header */}
      <div className="px-4 py-2.5 bg-[#f0f2f5] border-b border-[#e9edef] flex items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-[#008069] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-2xs">
            {workspace.title.charAt(0)}
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 truncate tracking-tight">
                {workspace.title}
              </h2>
            </div>
            <p
              className="text-[11px] text-slate-500 truncate mt-0.5"
              title={workspace.participants.map((p) => p.name).join(', ')}
            >
              {workspace.participants.length} members ·{' '}
              <span className="font-semibold text-slate-600">{messages.length} messages</span>
            </p>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative hidden sm:block">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chat..."
              className="text-xs bg-white border border-slate-200 rounded-md pl-8 pr-2.5 py-1 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#008069] w-32 sm:w-40"
            />
          </div>

          {/* Meta AI Extraction Button */}
          <button
            onClick={onRunMetaExtraction}
            disabled={isAnalyzingWithMeta}
            title="Read this whole chat and update the decisions, promises and money"
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs border ${
              isAnalyzingWithMeta
                ? 'bg-purple-100 text-purple-800 border-purple-300 animate-pulse'
                : 'bg-[#008069] hover:bg-[#00705c] text-white border-[#00705c]'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${isAnalyzingWithMeta ? 'animate-spin' : ''}`} />
            <span>{isAnalyzingWithMeta ? 'Analyzing…' : 'Analyze chat'}</span>
          </button>

        </div>
      </div>

      {/* WhatsApp Chat Wallpaper Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 whatsapp-chat-bg">
        {/* Day Divider Pill */}
        <div className="flex justify-center">
          <span className="text-[10px] font-semibold text-slate-600 bg-white/80 backdrop-blur-xs px-3 py-1 rounded-full shadow-2xs border border-slate-200 uppercase tracking-wider">
            Today
          </span>
        </div>

        {messages.length === 0 && (
          <div className="mx-auto max-w-sm rounded-lg bg-white/80 border border-slate-200 p-3 text-center text-[11px] text-slate-600">
            Raw messages are not stored under your retention setting, so only the extracted decisions, commitments and
            their quoted evidence were kept. Change this in Privacy &amp; Scope.
          </div>
        )}
        {filteredMessages.map((msg) => {
          const isHighlighted = highlightedMessageId === msg.id;
          const isMe = msg.speakerName === 'Alex' || msg.speakerId === 'u_alex';
          const isBot = msg.speakerName.includes('Sorted') || msg.speakerId.includes('bot');
          const userParticipant = workspace.participants.find((p) => p.id === msg.speakerId);
          const avatarColor = userParticipant?.avatarColor || '#008069';

          // Bot / Sorted Response Bubble (Distinct High-Visibility WhatsApp Message)
          if (isBot) {
            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`max-w-2xl mx-auto my-2 p-3.5 rounded-xl bg-white border-2 transition-all shadow-sm ${
                  isHighlighted
                    ? 'border-amber-400 ring-2 ring-amber-300'
                    : 'border-emerald-500/60'
                }`}
              >
                <div className="flex items-center justify-between border-b border-emerald-100 pb-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#008069] animate-pulse" />
                    <span className="text-xs font-bold text-[#008069] flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      Sorted
                    </span>
                    {msg.provenance?.source === 'meta' ? (
                      <span
                        className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200"
                        title={msg.provenance.model}
                      >
                        Meta AI
                      </span>
                    ) : msg.provenance ? (
                      <span
                        className="text-[10px] bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200"
                        title={msg.provenance.note}
                      >
                        Offline answer
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{msg.timestamp}</span>
                </div>

                <div className="text-xs text-slate-800 leading-relaxed font-normal whitespace-pre-wrap">
                  {humanizeCitations(msg.content, messages)}
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="flex items-center gap-1 font-medium text-emerald-800">
                    <CheckCheck className="w-3.5 h-3.5 text-[#008069]" />
                    {msg.provenance?.source === 'meta' ? 'Written by Meta AI from this chat' : "Built from what's tracked in this group"}
                  </span>
                  <button
                    onClick={() => handleCopyQuote(msg)}
                    className="hover:text-slate-800 flex items-center gap-1 text-[10px]"
                  >
                    {copiedId === msg.id ? (
                      <span className="text-[#008069] font-bold">Copied!</span>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Quote</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          }

          // Human Chat Bubbles (WhatsApp Style)
          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`relative group max-w-sm sm:max-w-md md:max-w-lg p-2.5 sm:px-3 sm:py-2 rounded-lg shadow-2xs transition-all duration-200 ${
                  isMe
                    ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none'
                    : 'bg-white text-[#111b21] rounded-tl-none'
                } ${
                  isHighlighted ? 'ring-2 ring-amber-400 shadow-md' : ''
                }`}
              >
                {/* Speaker Header (if not current user) */}
                {!isMe && (
                  <div className="flex items-center justify-between gap-3 mb-0.5">
                    <span
                      className="text-xs font-bold leading-tight"
                      style={{ color: avatarColor }}
                    >
                      {msg.speakerName}
                    </span>
                  </div>
                )}

                {/* Message Text */}
                <p className="text-xs sm:text-[13px] leading-relaxed break-words font-normal text-slate-900">
                  {msg.content}
                </p>
                {msg.provenance?.note && <p className="mt-1 text-[10px] font-mono text-purple-700">{msg.provenance.note}</p>}

                {/* Attachments rendering */}
                {msg.attachmentIds && msg.attachmentIds.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {msg.attachmentIds.map((attId) => {
                      const att = attachments[attId];
                      if (!att) return null;

                      // Hotel Booking Confirmation Card
                      if (att.type === 'booking') {
                        return (
                          <div
                            key={att.id}
                            className="bg-white border border-slate-200 rounded-lg p-3 space-y-1.5 shadow-2xs text-slate-800"
                          >
                            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                              <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                                <FileText className="w-3.5 h-3.5 text-[#008069]" />
                                <span>{att.displayName}</span>
                              </div>
                              <span className="text-[10px] font-mono bg-rose-50 text-rose-700 px-1.5 py-0.2 rounded border border-rose-200">
                                Non-refundable
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 pt-0.5">
                              <div>Check-in: <strong className="text-slate-800">{att.metadata.checkIn}</strong></div>
                              <div>Check-out: <strong className="text-slate-800">{att.metadata.checkOut}</strong></div>
                              <div>Rooms: <strong className="text-slate-800">{att.metadata.rooms}</strong></div>
                              <div>Total Paid: <strong className="text-[#008069]">{att.metadata.totalPaid}</strong></div>
                            </div>
                            <div className="text-[10px] text-amber-800 bg-amber-50 p-1.5 rounded border border-amber-200">
                              ⚠️ Policy: {att.metadata.cancellationPolicy}
                            </div>
                          </div>
                        );
                      }

                      // Voice Note Card
                      if (att.type === 'voice_note') {
                        const isPlaying = playingVoiceId === att.id;
                        return (
                          <div
                            key={att.id}
                            className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 max-w-xs space-y-1.5"
                          >
                            {att.metadata.audioUrl && (
                              <audio controls src={att.metadata.audioUrl} className="w-full h-8" />
                            )}
                            <div className={`flex items-center gap-2.5 ${att.metadata.audioUrl ? 'hidden' : ''}`}>
                              <button
                                onClick={() => setPlayingVoiceId(isPlaying ? null : att.id)}
                                className="w-7 h-7 rounded-full bg-[#008069] hover:bg-[#00705c] text-white flex items-center justify-center transition-colors shadow-2xs"
                              >
                                {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                              </button>

                              <div className="flex-1 space-y-1">
                                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden flex items-center px-0.5">
                                  <div
                                    className={`h-1 bg-[#008069] rounded-full transition-all duration-300 ${
                                      isPlaying ? 'w-3/4 animate-pulse' : 'w-1/4'
                                    }`}
                                  />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                                  <span>0:{isPlaying ? '18' : '00'}</span>
                                  <span>0:{att.metadata.durationSec || '24'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-[10px] text-slate-600 bg-white p-1.5 rounded border border-slate-200 italic">
                              "{att.metadata.transcript}"
                            </div>
                            {att.metadata.transcribedBy && (
                              <div className="text-[9px] font-mono text-slate-400">{att.metadata.transcribedBy}</div>
                            )}
                          </div>
                        );
                      }

                      // Electricity Bill Receipt
                      if (att.type === 'receipt') {
                        return (
                          <div
                            key={att.id}
                            className="bg-white border border-slate-200 rounded-lg p-2.5 max-w-xs space-y-1 text-slate-800"
                          >
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span>{att.displayName}</span>
                              <span className="text-emerald-700 font-mono">{att.metadata.amountDue || att.metadata.total}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {att.metadata.biller || att.metadata.store} · Split:{' '}
                              <strong className="text-slate-800">{att.metadata.splitPerPerson || att.metadata.status}</strong>
                            </div>
                          </div>
                        );
                      }

                      // Image / Photo Attachment (Generated by muse-image-1.0 or uploaded)
                      if (att.type === 'image' || att.metadata?.imageUrl) {
                        return (
                          <div
                            key={att.id}
                            className="bg-white border border-slate-200 rounded-lg p-2 max-w-sm space-y-1.5 shadow-2xs"
                          >
                            <img
                              src={att.metadata.imageUrl}
                              alt={att.displayName}
                              className="w-full h-44 object-cover rounded-md border border-slate-200"
                            />
                            <div className="flex items-center justify-between text-[11px] text-slate-700 px-1">
                              <span className="font-semibold">{att.displayName}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200 font-bold">
                                Meta muse-image-1.0
                              </span>
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                )}

                {/* Footer Timestamp & Read Receipt */}
                <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 mt-1 select-none">
                  <span>{msg.timestamp}</span>
                  {isMe && <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />}
                </div>

                {/* Hover Quote & Inspect Tools */}
                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-3 right-2 bg-white border border-slate-200 rounded-full px-2 py-0.5 shadow-xs flex items-center gap-1.5 text-slate-600">
                  <button
                    onClick={() => handleCopyQuote(msg)}
                    title="Copy Quote"
                    className="hover:text-slate-900"
                  >
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-[#008069]" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => onInspectEvidence(msg.id)}
                    title="Inspect Linked Decisions"
                    className="hover:text-slate-900"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* WhatsApp Composer Area */}
      <div className="p-3 bg-[#f0f2f5] border-t border-[#e9edef] space-y-2">
        {/* Workspace Quick Prompts */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
            Ask:
          </span>
          {contextualPrompts.map((cp, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setInputText(`@Sorted ${cp.query}`)}
              className="px-2.5 py-1 rounded-full bg-white hover:bg-emerald-50 text-slate-700 hover:text-[#008069] border border-slate-200 text-xs font-medium transition-colors shrink-0 flex items-center gap-1 shadow-2xs"
            >
              <Sparkles className="w-3 h-3 text-[#008069]" />
              <span>{cp.label}</span>
            </button>
          ))}
        </div>

        {voice.phase === 'recording' && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900" role="status">
            <span className="h-2 w-2 rounded-full bg-rose-600 animate-pulse" />
            Recording… {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </div>
        )}
        {voice.phase === 'working' && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Transcribing with Meta AI…
          </div>
        )}
        {voice.phase === 'error' && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900" role="alert">
            <span>{voice.message}</span>
            <button type="button" onClick={() => setVoice({ phase: 'idle' })} className="shrink-0 font-bold underline">
              Dismiss
            </button>
          </div>
        )}
        {voice.phase === 'review' && (
          <div className="rounded-lg border border-emerald-200 bg-white p-3 space-y-2 shadow-xs" data-testid="voice-review">
            <div className="text-[11px] font-bold text-slate-800">Check your voice note before it is posted. Fix any word it misheard.</div>
            <textarea
              value={voice.text}
              onChange={e => setVoice({ ...voice, text: e.target.value })}
              rows={Math.min(5, Math.max(2, Math.ceil(voice.text.length / 70)))}
              aria-label="Voice note transcript"
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#008069]"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">{Math.round(voice.draft.durationSec)}s · transcribed by Meta AI</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setVoice({ phase: 'idle' })} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Discard
                </button>
                <button
                  type="button"
                  onClick={postVoice}
                  disabled={!voice.text.trim()}
                  className="rounded-md bg-[#008069] px-3 py-1 text-xs font-bold text-white hover:bg-[#00705c] disabled:opacity-40"
                >
                  Post
                </button>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-center gap-2">
          {/* @Sorted Trigger Button */}
          <button
            type="button"
            onClick={() => {
              const defaultQ = contextualPrompts[0]?.query || 'What are the current decisions?';
              setInputText(`@Sorted ${defaultQ}`);
            }}
            title={`Ask Sorted about ${workspace.title}`}
            className="px-3 py-2 text-xs font-bold bg-[#008069] hover:bg-[#00705c] text-white rounded-lg transition-colors flex items-center gap-1 shrink-0 shadow-2xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>@Sorted</span>
          </button>

          {/* muse-image-1.0 Image Generator */}
          {onGenerateVisual && (
            <button
              type="button"
              onClick={onGenerateVisual}
              disabled={isGeneratingVisual}
              title="Generate visual preview using Meta muse-image-1.0"
              className="p-2 text-slate-600 hover:text-purple-700 bg-white border border-slate-200 rounded-lg transition-colors shrink-0 disabled:opacity-40"
            >
              <Paperclip className="w-4 h-4" />
            </button>
          )}

          {/* Voice Note Button */}
          {onTranscribeVoiceNote && (
            <button
              type="button"
              onClick={toggleRecording}
              disabled={voice.phase === 'working'}
              aria-label={isRecording ? 'Stop recording' : 'Record a voice note'}
              title={isRecording ? 'Stop and transcribe' : 'Record a voice note (transcribed by Meta AI)'}
              className={`p-2 border rounded-lg transition-colors shrink-0 ${
                isRecording
                  ? 'text-white bg-rose-600 border-rose-700 animate-pulse'
                  : 'text-slate-600 hover:text-[#008069] bg-white border-slate-200'
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>
          )}

          {/* Input field */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message or ask @Sorted..."
            className="flex-1 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="w-9 h-9 rounded-full bg-[#00a884] hover:bg-[#008069] text-white flex items-center justify-center transition-colors disabled:opacity-40 shadow-xs shrink-0"
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </form>

        <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
          <span>Type <code className="text-[#008069] font-bold">@Sorted</code> to ask a question about this group.</span>
          <span className="font-semibold text-slate-600">Only groups you allow are shared with Meta AI</span>
        </div>
      </div>
    </div>
  );
};
