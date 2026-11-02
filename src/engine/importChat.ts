import { Message, User, Workspace } from '../types/groupOs';
import { parseWhatsAppExport } from './whatsappParser';

/** Parse an export into a workspace plus its messages. A stable `idSuffix` makes re-importing replace, not duplicate. */
export function buildImportedWorkspace(
  title: string,
  rawText: string,
  idSuffix: string,
  options?: { category?: string; description?: string }
): { workspace: Workspace; messages: Message[] } {
  const rawParsed = parseWhatsAppExport(rawText);
  const wsId = `ws_imported_${idSuffix}`;
  const speakerNames = Array.from(new Set(rawParsed.map(m => m.speaker)));
  const avatarColors = ['#008069', '#0284c7', '#d97706', '#9333ea', '#e11d48', '#059669'];

  const participants: User[] = speakerNames.map((name, idx) => ({
    id: `u_imp_${idx + 1}`,
    name,
    avatarColor: avatarColors[idx % avatarColors.length],
    role: idx === 0 ? 'Group Admin' : 'Member',
  }));

  const messages: Message[] = rawParsed.map((m, idx) => ({
    id: `m_imp_${idx + 1}`,
    conversationId: wsId,
    speakerId: participants.find(p => p.name === m.speaker)?.id || 'u_guest',
    speakerName: m.speaker,
    timestamp: m.timestamp.split(',')[1]?.trim() || m.timestamp,
    content: m.content,
    type: 'text',
    // The real send time when the export has it, so long chats can be split into sessions and topics.
    createdAt: m.at ?? Date.now() - (rawParsed.length - idx) * 60000,
  }));

  return {
    messages,
    workspace: {
      id: wsId,
      title: title.trim() || 'Imported WhatsApp Group',
      category: options?.category || 'Imported chat',
      description: options?.description || `Imported group conversation with ${participants.length} members and ${messages.length} messages.`,
      participants,
      unreadCount: 0,
      lastActivity: 'Just now',
      iconName: 'Compass',
      isCustomImported: true,
    },
  };
}
