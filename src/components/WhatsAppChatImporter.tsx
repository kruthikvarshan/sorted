import React, { useState } from 'react';
import {
  Upload,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Users,
  Compass,
  ArrowRight,
  ClipboardPaste,
  RefreshCw,
  Info,
} from 'lucide-react';
import { Workspace, Message } from '../types/groupOs';
import { buildImportedWorkspace } from '../engine/importChat';
import { SCENARIOS, toWhatsAppExport } from '../data/scenarios';

interface WhatsAppChatImporterProps {
  onChatImported: (workspace: Workspace, messages: Message[]) => void | Promise<void>;
  apiKey?: string;
  isAnalyzing?: boolean;
}

const SAMPLE_REAL_CHATS: { title: string; description: string; rawText: string }[] = [];


// Sample chats in several languages (also the ones `npm run eval` scores).
SAMPLE_REAL_CHATS.push(
  ...SCENARIOS.map(scenario => ({
    title: scenario.title,
    description: `${scenario.blurb} Languages: ${scenario.languages.join(', ')}.`,
    rawText: toWhatsAppExport(scenario),
  }))
);



export const WhatsAppChatImporter: React.FC<WhatsAppChatImporterProps> = ({
  onChatImported,
  apiKey,
  isAnalyzing = false,
}) => {
  const [chatTitle, setChatTitle] = useState(SAMPLE_REAL_CHATS[0].title);
  const [rawChatText, setRawChatText] = useState(SAMPLE_REAL_CHATS[0].rawText);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseStats, setParseStats] = useState<{
    messageCount: number;
    speakers: string[];
  } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setRawChatText(content);
        const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '').replace(/^WhatsApp Chat with /i, '');
        setChatTitle(fileNameWithoutExt || 'Imported WhatsApp Chat');
      }
    };
    reader.readAsText(file);
  };

  const handleSelectSample = (sample: (typeof SAMPLE_REAL_CHATS)[0]) => {
    setChatTitle(sample.title);
    setRawChatText(sample.rawText);
  };

  const handleImportAndAnalyze = async () => {
    if (!rawChatText.trim()) return;
    setIsProcessing(true);
    try {
      const built = buildImportedWorkspace(chatTitle, rawChatText, String(Date.now()));
      await onChatImported(built.workspace, built.messages);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex-1 bg-[#efeae2] p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Card */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#008069] flex items-center justify-center text-white">
                  <ClipboardPaste className="w-4 h-4" />
                </div>
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">Import a chat</h1>
              </div>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Bring in a WhatsApp chat as an exported .txt file, or paste the text. Group OS reads it and finds what was decided,
                who promised what, who owes whom, and where plans clash.
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                In WhatsApp: open the chat, tap its name, then Export chat, Without media.
              </p>
            </div>
          </div>

          {/* Preset Sample Buttons */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-2">
              Or try a sample chat (these are also in the sidebar):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SAMPLE_REAL_CHATS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectSample(sample)}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    chatTitle === sample.title
                      ? 'border-[#008069] bg-emerald-50/50 shadow-xs ring-1 ring-[#008069]'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{sample.title}</span>
                    <span className="text-[10px] text-[#008069] font-semibold">Load Sample</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{sample.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Chat name
            </label>
            <input
              type="text"
              value={chatTitle}
              onChange={(e) => setChatTitle(e.target.value)}
              placeholder="e.g. Goa trip, Flat 402, Office team"
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Paste the chat text or upload the .txt file
              </label>
              <label className="text-[11px] text-[#008069] hover:underline cursor-pointer flex items-center gap-1 font-semibold">
                <Upload className="w-3 h-3" />
                <span>Upload WhatsApp export file</span>
                <input
                  type="file"
                  accept=".txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              rows={12}
              value={rawChatText}
              onChange={(e) => setRawChatText(e.target.value)}
              placeholder={`Paste raw exported WhatsApp text here. Examples:\n10/24/24, 9:15 AM - Alex: Can everyone confirm departure?\n10/24/24, 9:18 AM - Priya: I have a Friday shift so I can only leave Saturday!`}
              className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg p-3 text-slate-800 leading-relaxed focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Info className="w-4 h-4 text-slate-400" />
              <span>Standard WhatsApp timestamp formats supported (iOS & Android).</span>
            </div>

            <button
              type="button"
              onClick={handleImportAndAnalyze}
              disabled={isProcessing || !rawChatText.trim()}
              className="px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-[#008069] hover:bg-[#00705c] transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Parsing & Running Intelligence...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Import this chat</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
