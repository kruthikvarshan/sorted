import React, { useState } from 'react';
import {
  Compass,
  Home,
  Cpu,
  Layers,
  UserCheck,
  History,
  Calendar,
  Settings,
  CheckCircle2,
  Shield,
  MessageSquare,
  Sparkles,
  Search,
  Upload,
  Lock,
  Plus,
} from 'lucide-react';
import { Workspace, User } from '../types/groupOs';

interface SidebarLeftProps {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  currentNav: 'conversations' | 'my-tasks' | 'decision-history' | 'importer' | 'privacy' | 'settings';
  onSelectNav: (nav: 'conversations' | 'my-tasks' | 'decision-history' | 'importer' | 'privacy' | 'settings') => void;
  currentUser: User;
  allUsers: User[];
  onSelectUser: (user: User) => void;
  isDemoMode: boolean;
  /** One short line per group, e.g. "Analyzed 14:22" or "Not analyzed yet". */
  analysisByWorkspace?: Record<string, string>;
  unresolvedCount: number;
}

export const SidebarLeft: React.FC<SidebarLeftProps> = ({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  currentNav,
  onSelectNav,
  currentUser,
  allUsers,
  onSelectUser,
  isDemoMode,
  analysisByWorkspace,
  unresolvedCount,
}) => {
  const [filterSearch, setFilterSearch] = useState('');

  const getWorkspaceAvatarColor = (idx: number) => {
    const colors = ['#008069', '#0284c7', '#d97706', '#9333ea', '#e11d48'];
    return colors[idx % colors.length];
  };

  const filteredWorkspaces = workspaces.filter(
    (w) =>
      w.title.toLowerCase().includes(filterSearch.toLowerCase()) ||
      w.description.toLowerCase().includes(filterSearch.toLowerCase())
  );

  return (
    <aside className="w-full md:w-80 bg-white border-r border-[#e9edef] flex flex-col h-full select-none shrink-0 shadow-xs">
      {/* WhatsApp-Style Top Header */}
      <div className="bg-[#008069] px-4 py-3 flex items-center justify-between text-white shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-white/20 border border-white/30 flex items-center justify-center font-bold text-xs tracking-tight">
            G·OS
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight">Group OS</span>
            </div>
            <p className="text-[10px] text-emerald-100 font-medium leading-none mt-0.5">
              Your conversations are messy. Your plans shouldn't be.
            </p>
          </div>
        </div>

        {/* Meta AI status */}
        <button
          onClick={() => onSelectNav('settings')}
          title={isDemoMode ? 'Meta AI is off, so chats are read with a simple offline method. Click to set it up.' : 'Meta AI reads your chats. Click for settings.'}
          className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all ${
            isDemoMode
              ? 'bg-amber-400 text-amber-950 border-amber-300 font-bold'
              : 'bg-emerald-400 text-emerald-950 border-emerald-300 font-bold'
          }`}
        >
          {isDemoMode ? 'Meta AI off' : 'Meta AI on'}
        </button>
      </div>

      {/* Primary Feature Tabs (WhatsApp Style Segmented Navigation) */}
      <div className="p-2.5 bg-[#f0f2f5] border-b border-[#e9edef] grid grid-cols-2 gap-1.5 text-xs font-semibold">
        <button
          onClick={() => onSelectNav('conversations')}
          className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            currentNav === 'conversations'
              ? 'bg-[#008069] text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Group Chats</span>
          </div>
          {unresolvedCount > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                currentNav === 'conversations' ? 'bg-white text-[#008069]' : 'bg-rose-500 text-white'
              }`}
            >
              {unresolvedCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onSelectNav('my-tasks')}
          className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            currentNav === 'my-tasks'
              ? 'bg-[#008069] text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5" />
            <span>My Group OS</span>
          </div>
          <span
            className={`text-[10px] px-1 py-0.2 rounded ${
              currentNav === 'my-tasks' ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-700 font-bold'
            }`}
          >
            Private
          </span>
        </button>

        <button
          onClick={() => onSelectNav('decision-history')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
            currentNav === 'decision-history'
              ? 'bg-[#008069] text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Decisions</span>
        </button>

        <button
          onClick={() => onSelectNav('privacy')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
            currentNav === 'privacy'
              ? 'bg-[#008069] text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Shield className="w-3.5 h-3.5 text-emerald-600" />
          <span>Privacy & Scope</span>
        </button>
      </div>

      {/* Quick Action Bar: Import & Settings */}
      <div className="px-3 py-2 bg-white flex items-center justify-between border-b border-[#e9edef] text-xs">
        <button
          onClick={() => onSelectNav('importer')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors ${
            currentNav === 'importer'
              ? 'bg-emerald-100 text-[#008069]'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
          }`}
        >
          <Upload className="w-3 h-3 text-[#008069]" />
          <span>Import a chat</span>
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onSelectNav('settings')}
            title="Settings"
            className={`p-1.5 rounded-md text-xs font-semibold transition-colors ${
              currentNav === 'settings' ? 'bg-[#008069] text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* WhatsApp Search Bar */}
      <div className="p-2.5 bg-white border-b border-[#e9edef]">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Search or start new chat"
            className="w-full bg-[#f0f2f5] rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[#008069]"
          />
        </div>
      </div>

      {/* Workspaces / Chats List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#f0f2f5]">
        {filteredWorkspaces.map((ws, idx) => {
          const isActive = ws.id === activeWorkspaceId && currentNav === 'conversations';
          const avatarBg = getWorkspaceAvatarColor(idx);

          return (
            <button
              key={ws.id}
              onClick={() => {
                onSelectWorkspace(ws.id);
                onSelectNav('conversations');
              }}
              className={`w-full text-left px-3.5 py-3 flex items-start gap-3 transition-colors ${
                isActive
                  ? 'bg-[#f0f2f5] border-l-4 border-l-[#008069]'
                  : 'hover:bg-[#f7f8fa] bg-white'
              }`}
            >
              {/* WhatsApp Chat Avatar */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-xs mt-0.5"
                style={{ backgroundColor: avatarBg }}
              >
                {ws.title.charAt(0)}
              </div>

              {/* Chat details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="text-xs font-bold text-slate-900 truncate">{ws.title}</span>
                  <span className="text-[10px] text-slate-500 font-medium shrink-0">{ws.lastActivity}</span>
                </div>

                <p className="text-[11px] text-slate-600 line-clamp-1 leading-tight">{ws.description}</p>

                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-[#008069] font-medium bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-100 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>{analysisByWorkspace?.[ws.id] ?? 'Not analyzed yet'}</span>
                  </span>

                  {ws.unreadCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-[#25d366] text-white text-[10px] font-bold flex items-center justify-center">
                      {ws.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Who you are viewing the groups as */}
      <div className="p-3 border-t border-[#e9edef] bg-[#f0f2f5]">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
          Viewing as
        </label>
        <div className="flex items-center justify-between bg-white border border-[#e9edef] p-2 rounded-lg shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ backgroundColor: currentUser.avatarColor }}
            >
              {currentUser.name.charAt(0)}
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-slate-900 truncate leading-none">{currentUser.name}</span>
              <span className="text-[10px] text-slate-500 leading-none mt-1">{currentUser.role || 'Member'}</span>
            </div>
          </div>

          <select
            value={currentUser.id}
            onChange={(e) => {
              const u = allUsers.find((user) => user.id === e.target.value);
              if (u) onSelectUser(u);
            }}
            className="text-[11px] bg-slate-50 border border-slate-300 rounded text-slate-800 px-2 py-1 focus:outline-none focus:border-[#008069]"
          >
            {allUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </aside>
  );
};
