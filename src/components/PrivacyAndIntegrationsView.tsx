import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Layers,
  Users,
  Settings2,
  Cpu,
  Globe,
  Bell,
  RefreshCw,
  Info,
  Check,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { Workspace, PrivacyScopeSettings } from '../types/groupOs';

interface PrivacyAndIntegrationsViewProps {
  workspaces: Workspace[];
  privacySettings: PrivacyScopeSettings;
  onUpdatePrivacySettings: (updated: PrivacyScopeSettings) => void;
  onPurgeAllIntelligence: () => void;
  apiKey: string;
}

export const PrivacyAndIntegrationsView: React.FC<PrivacyAndIntegrationsViewProps> = ({
  workspaces,
  privacySettings,
  onUpdatePrivacySettings,
  onPurgeAllIntelligence,
  apiKey,
}) => {
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeSuccess, setPurgeSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'scope' | 'participation' | 'retention' | 'usage'>('scope');

  const toggleWorkspaceScope = (wsId: string) => {
    const isCurrentlyScoped = privacySettings.scopedWorkspaceIds.includes(wsId);
    const updatedIds = isCurrentlyScoped
      ? privacySettings.scopedWorkspaceIds.filter((id) => id !== wsId)
      : [...privacySettings.scopedWorkspaceIds, wsId];

    onUpdatePrivacySettings({
      ...privacySettings,
      scopedWorkspaceIds: updatedIds,
    });
  };

  const updateParticipation = (
    wsId: string,
    key: 'invitedToParticipate' | 'privateOnly' | 'allowProactiveAlerts',
    value: boolean
  ) => {
    const current = privacySettings.participationByWorkspace[wsId] || {
      invitedToParticipate: true,
      privateOnly: false,
      allowProactiveAlerts: true,
    };

    onUpdatePrivacySettings({
      ...privacySettings,
      participationByWorkspace: {
        ...privacySettings.participationByWorkspace,
        [wsId]: {
          ...current,
          [key]: value,
          // If user switches to privateOnly, invitedToParticipate cannot be active simultaneously
          ...(key === 'privateOnly' && value ? { invitedToParticipate: false } : {}),
          ...(key === 'invitedToParticipate' && value ? { privateOnly: false } : {}),
        },
      },
    });
  };

  const handlePurge = () => {
    onPurgeAllIntelligence();
    setShowPurgeConfirm(false);
    setPurgeSuccess(true);
    setTimeout(() => setPurgeSuccess(false), 3000);
  };

  return (
    <div className="flex-1 bg-[#efeae2] p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Hero Banner */}
        <div className="bg-[#008069] rounded-xl shadow-sm text-white p-6 relative overflow-hidden">
          <div className="relative z-10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-200 bg-white/10 px-2.5 py-0.5 rounded-full border border-white/20">
                Privacy, Scope & Permissions
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              What Sorted can see
            </h1>
            <p className="text-xs sm:text-sm text-emerald-100 max-w-2xl leading-relaxed">
              You decide which chats Sorted can read and whether it can speak in them. Everything is kept in this
              browser tab only, and it is gone when you close the tab.
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-300 bg-white/70 backdrop-blur-xs p-1.5 rounded-xl shadow-xs overflow-x-auto">
          <button
            onClick={() => setActiveTab('scope')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'scope'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Which chats</span>
          </button>

          <button
            onClick={() => setActiveTab('participation')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'participation'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Private or in the group</span>
          </button>

          <button
            onClick={() => setActiveTab('retention')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'retention'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>What is kept</span>
          </button>

          <button
            onClick={() => setActiveTab('usage')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shrink-0 ${
              activeTab === 'usage'
                ? 'bg-[#008069] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>How your data is used</span>
          </button>
        </div>

        {/* Section 1: My Scope */}
        {activeTab === 'scope' && (
          <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 space-y-5">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#008069]" />
                  <span>Which chats My Sorted can use</span>
                </h2>
                <span className="text-[11px] font-medium text-slate-500">
                  {privacySettings.scopedWorkspaceIds.length} of {workspaces.length} groups enabled
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Choose which conversations Sorted is allowed to read. Excluded groups are completely walled off; no messages
                are analyzed and no data leaves the browser session.
              </p>
            </div>

            <div className="space-y-3">
              {workspaces.map((ws) => {
                const isScoped = privacySettings.scopedWorkspaceIds.includes(ws.id);
                return (
                  <div
                    key={ws.id}
                    className={`flex items-center justify-between p-3.5 rounded-lg border transition-all ${
                      isScoped
                        ? 'bg-emerald-50/40 border-emerald-300 shadow-xs'
                        : 'bg-slate-50 border-slate-200 opacity-70'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                          isScoped ? 'bg-[#008069] text-white' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {isScoped ? <Check className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{ws.title}</span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              isScoped
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isScoped ? 'In Scope' : 'Excluded'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{ws.description}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleWorkspaceScope(ws.id)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        isScoped
                          ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                          : 'bg-[#008069] text-white hover:bg-[#00705c]'
                      }`}
                    >
                      {isScoped ? 'Exclude Group' : 'Enable Scope'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-600 space-y-1">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-[#008069]" />
                Example: include the Goa trip and flatmates, leave out work.
              </span>
              <p className="text-[11px] text-slate-500">
                Sorted respects clear conversational boundaries. When a chat is excluded, it will never be queried or
                used to answer your questions or build your to-do list.
              </p>
            </div>
          </div>
        )}

        {/* Section 2: Private vs Group Participation */}
        {activeTab === 'participation' && (
          <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#008069]" />
                <span>The Key Product Distinction: My Scope vs Group Participation</span>
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                A user might want private reminders from a group without adding an assistant participant to the group.
                Each group below can be configured independently:
              </p>
            </div>

            <div className="space-y-4">
              {workspaces.map((ws) => {
                const isScoped = privacySettings.scopedWorkspaceIds.includes(ws.id);
                const partSettings = privacySettings.participationByWorkspace[ws.id] || {
                  invitedToParticipate: true,
                  privateOnly: false,
                  allowProactiveAlerts: true,
                };

                return (
                  <div
                    key={ws.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{ws.title}</span>
                        {!isScoped && (
                          <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
                            Currently Excluded
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {/* Mode A: Private Assistant Only */}
                      <button
                        type="button"
                        onClick={() => updateParticipation(ws.id, 'privateOnly', true)}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          partSettings.privateOnly
                            ? 'border-[#008069] bg-white ring-1 ring-[#008069] shadow-xs'
                            : 'border-slate-200 bg-white/60 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-indigo-600" />
                            Private Assistant Only
                          </span>
                          {partSettings.privateOnly && (
                            <CheckCircle2 className="w-4 h-4 text-[#008069]" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-normal">
                          Sorted works secretly for you. It tracks your tasks and reminders, but NEVER responds in the group chat.
                        </p>
                      </button>

                      {/* Mode B: Group Participant */}
                      <button
                        type="button"
                        onClick={() => updateParticipation(ws.id, 'invitedToParticipate', true)}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          partSettings.invitedToParticipate
                            ? 'border-[#008069] bg-white ring-1 ring-[#008069] shadow-xs'
                            : 'border-slate-200 bg-white/60 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-[#008069]" />
                            Authorized Group Participant
                          </span>
                          {partSettings.invitedToParticipate && (
                            <CheckCircle2 className="w-4 h-4 text-[#008069]" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-normal">
                          All members have invited Sorted. It can respond to <code className="text-[#008069]">@Sorted</code>, detect contradictions, and post summaries.
                        </p>
                      </button>
                    </div>

                    {/* Proactive Notification Toggle */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-xs text-slate-700">
                      <div className="flex items-center gap-2">
                        <Bell className="w-3.5 h-3.5 text-slate-500" />
                        <span>Send proactive push alerts on schedule conflicts in this group</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={partSettings.allowProactiveAlerts}
                        onChange={(e) =>
                          updateParticipation(ws.id, 'allowProactiveAlerts', e.target.checked)
                        }
                        className="rounded text-[#008069] focus:ring-[#008069] h-4 w-4"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 3: Data Retention & Purge */}
        {activeTab === 'retention' && (
          <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#008069]" />
                <span>What is kept while this tab is open</span>
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Sorted keeps results only while this page stays open. Nothing is stored in your browser or on a server.
              </p>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5 text-xs text-emerald-900 space-y-1">
              <p className="font-bold">Nothing is saved.</p>
              <p>
                Your analysis, answers and imported chats live in this page's memory only. Reload the page or close the tab and
                everything is gone, so you analyze your chats again.
              </p>
            </div>

            {/* Permanent Data Purge */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear everything now</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Instantly wipes all extracted decisions, commitments, conflict histories, and cached chat data.
                  </p>
                </div>

                {!showPurgeConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowPurgeConfirm(true)}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
                  >
                    Purge All Stored Data
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPurgeConfirm(false)}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handlePurge}
                      className="px-3.5 py-1.5 text-xs font-bold bg-rose-600 text-white rounded-lg hover:bg-rose-700 shadow-xs"
                    >
                      Confirm Permanent Purge
                    </button>
                  </div>
                )}
              </div>

              {purgeSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>All intelligence state, commitments, and message caches have been wiped clean!</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 4: How your data is used */}
        {activeTab === 'usage' && (
          <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 space-y-4 text-xs text-slate-700 leading-relaxed">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#008069]" />
              <span>How your data is used</span>
            </h2>
            <ul className="space-y-3">
              <li>
                <b className="text-slate-900">What goes to Meta AI.</b> When you analyze a chat or ask a question, the text of
                chats you allow is sent to Meta's models to be read. Voice notes are sent as audio and receipts as an image,
                only when you record or attach one.
              </li>
              <li>
                <b className="text-slate-900">What never leaves.</b> Chats you have not allowed are never sent. Images and audio are
                not stored: only the facts read from them are kept.
              </li>
              <li>
                <b className="text-slate-900">What is stored.</b> There is no account and no server database. Results live in
                this browser tab, as set under "What is kept", and disappear when you close it.
              </li>
              <li>
                <b className="text-slate-900">See for yourself.</b> My Sorted lists every request sent to Meta this session: what
                it was, which chat, and how much. It records only that, never the chat text or the reply.
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
