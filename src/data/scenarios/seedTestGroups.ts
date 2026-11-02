import { Message, User, Workspace } from '../../types/groupOs';
import { SCENARIOS } from './index';

const COLORS = ['#008069', '#0284c7', '#d97706', '#9333ea', '#e11d48', '#059669'];

export const testWorkspaceId = (scenarioId: string) => `ws_test_${scenarioId}`;

/**
 * The six test groups as workspaces with their chats only. Nothing is analyzed in advance: every decision,
 * commitment and conflict comes from a live run of Meta's models.
 */
export function seedTestGroups() {
  const workspaces: Workspace[] = [];
  const messagesByWs: Record<string, Message[]> = {};
  const users: User[] = [];

  for (const scenario of SCENARIOS) {
    const wsId = testWorkspaceId(scenario.id);
    const names = Array.from(new Set(scenario.messages.filter(m => m.type !== 'system').map(m => m.speaker)));
    const participants: User[] = names.map((name, i) => ({
      id: `u_${name.toLowerCase()}`,
      name,
      avatarColor: COLORS[i % COLORS.length],
      role: i === 0 ? 'Group Admin' : 'Member',
    }));
    participants.forEach(p => {
      if (!users.some(u => u.name === p.name)) users.push(p);
    });

    const messages: Message[] = scenario.messages.map((m, i) => ({
      id: m.id,
      conversationId: wsId,
      speakerId: `u_${m.speaker.toLowerCase()}`,
      speakerName: m.speaker,
      timestamp: m.time,
      content: m.text,
      type: m.type === 'voice_transcript' ? 'voice_transcript' : m.type === 'system' ? 'system' : 'text',
      createdAt: i,
    }));

    workspaces.push({
      id: wsId,
      title: scenario.title,
      category: `Sample chat · ${scenario.languages.join(' + ')}`,
      description: scenario.blurb,
      participants,
      unreadCount: 0,
      lastActivity: 'Sample',
      iconName: 'Compass',
    });
    messagesByWs[wsId] = messages;

  }

  return { workspaces, messagesByWs, users };
}
