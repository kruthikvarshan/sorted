import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../data/scenarios';
import { seedTestGroups, testWorkspaceId } from '../data/scenarios/seedTestGroups';

describe('test groups seeded as chats only', () => {
  const seed = seedTestGroups();

  it('creates one workspace per scenario with its own messages', () => {
    expect(seed.workspaces.map(w => w.id)).toEqual(SCENARIOS.map(s => testWorkspaceId(s.id)));
    SCENARIOS.forEach(s => {
      const msgs = seed.messagesByWs[testWorkspaceId(s.id)];
      expect(msgs).toHaveLength(s.messages.length);
      msgs.forEach(m => expect(m.conversationId).toBe(testWorkspaceId(s.id)));
    });
  });

  it('carries no analysis at all: every decision, commitment and conflict must come from a live run', () => {
    expect(Object.keys(seed).sort()).toEqual(['messagesByWs', 'users', 'workspaces']);
  });

  it('shows no unread badge and uses the scenario text untouched', () => {
    seed.workspaces.forEach(w => expect(w.unreadCount).toBe(0));
    const first = SCENARIOS[0];
    expect(seed.messagesByWs[testWorkspaceId(first.id)][0].content).toBe(first.messages[0].text);
  });

  it('makes the people in the test groups selectable personas, without duplicates', () => {
    const names = seed.users.map(u => u.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['Ravi', 'Sita', 'Zoya', 'Dana', 'Riley']));
  });
});
