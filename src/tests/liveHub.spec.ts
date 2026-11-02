import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupIntelligenceState } from '../types/groupOs';

vi.mock('../services/groupAnalyzer', () => ({ analyzeGroup: vi.fn() }));
vi.mock('../services/groupQuestion', () => ({ answerGroupQuestion: vi.fn(async () => ({ text: 'The villa is 4,000 each (Goa trip).', ok: true, model: 'muse-spark-1.3' })) }));

const hub = await import('../../server/live/hub');
const { analyzeGroup } = await import('../services/groupAnalyzer');

const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [], topics: [], readThrough: 0 });

beforeEach(() => {
  hub.resetLive(':memory:');
  process.env.MODEL_API_KEY = 'test';
  vi.mocked(analyzeGroup).mockReset();
});

describe('live rooms', () => {
  it('people join by name, messages reach everyone listening, and the room remembers who is who', () => {
    const room = hub.createRoom('Goa gang');
    const neha = hub.joinRoom(room.id, 'Neha').member!;
    const arjun = hub.joinRoom(room.id, 'Arjun').member!;
    const seen: string[] = [];
    hub.subscribe(room.id, arjun.token, e => e.type === 'message' && seen.push(e.message.content));
    hub.postMessage(room.id, neha.token, 'villa booked for friday');
    expect(seen).toEqual(['villa booked for friday']);
    // Nobody can take a name already in use: that would let them act as that person.
    expect(hub.joinRoom(room.id, 'neha')).toEqual({ error: 'Neha is already in this group on another phone. Pick another name.' });
    expect(hub.snapshot(room.id, arjun.token)!.members.map(m => m.name)).toEqual(['Neha', 'Arjun']);
  });

  it('refuses strangers without a token', () => {
    const room = hub.createRoom('x');
    expect(hub.postMessage(room.id, 'forged', 'hi')).toBeUndefined();
    expect(hub.snapshot(room.id, 'forged')).toBeUndefined();
  });

  it('@GroupOS gets an answer in the group', async () => {
    const room = hub.createRoom('Goa gang');
    const neha = hub.joinRoom(room.id, 'Neha').member!;
    hub.postMessage(room.id, neha.token, '@GroupOS how much is the villa?');
    await new Promise(r => setTimeout(r, 10));
    const last = hub.snapshot(room.id, neha.token)!.messages.at(-1)!;
    expect(last.speakerName).toBe('Group OS');
    expect(last.content).toMatch(/4,000 each/);
  });

  it('reads only people\'s messages, never Group OS\'s own', async () => {
    const room = hub.createRoom('Goa gang');
    const neha = hub.joinRoom(room.id, 'Neha').member!;
    hub.postMessage(room.id, neha.token, 'rent 9000 each');
    const entry = hub.roomEntry(room.id)!;
    hub.botMessage(entry, 'I am Group OS');
    vi.mocked(analyzeGroup).mockResolvedValue({ state: { ...empty(), readThrough: 1 }, report: { newMessages: 1, batches: 1, topicsCreated: [], topicsUpdated: [], corrections: [], tokens: 0, calls: 0, failedTopics: [], ms: 1 } });
    await hub.analyse(entry);
    const sent = vi.mocked(analyzeGroup).mock.calls[0][0];
    expect(sent.map(m => m.content)).toEqual(['rent 9000 each']);
  });
});

describe('seats in the sample group', () => {
  it('a visitor can take an open seat once; after that the name is refused', () => {
    const room = hub.createRoom('Flat 402', { messages: [], people: ['Neha', 'Arjun'] });
    expect(hub.openSeats(room)).toEqual(['Neha', 'Arjun']);
    const first = hub.joinRoom(room.id, 'Neha');
    expect(first.member?.id).toBe('p_neha');
    expect(hub.joinRoom(room.id, 'Neha').error).toMatch(/already in this group/);
    expect(hub.openSeats(hub.roomEntry(room.id)!.room)).toEqual(['Arjun']);
  });
});

describe('Group OS speaks up, by rules', () => {
  const setup = () => {
    const room = hub.createRoom('Flat');
    const neha = hub.joinRoom(room.id, 'Neha').member!;
    const arjun = hub.joinRoom(room.id, 'Arjun').member!;
    return { room, neha, arjun, entry: hub.roomEntry(room.id)! };
  };

  it('a new disagreement, a payment claim and a new split each get one message, with the right buttons', () => {
    const { entry, neha } = setup();
    const after: GroupIntelligenceState = {
      ...empty(),
      topics: [{ id: 't_goa', title: 'Goa trip', kind: 'trip', status: 'open', messageIds: [], people: [], firstAt: 0, lastAt: 0 }],
      conflicts: [{ id: 'c1', topicId: 't_goa', conversationId: '', topic: 'Departure', description: 'Priya can only leave Saturday', relatedDecisionIds: [], evidenceIds: [], impactedItemIds: [], status: 'open', createdAt: '' }],
      commitments: [{ id: 'k1', conversationId: '', ownerId: '', ownerName: 'Arjun', description: 'Paid Neha for rent', status: 'needs_clarification', evidenceIds: [], lastUpdatedAt: '', payee: 'Neha', amount: 9000, currency: '₹' }],
      decisions: [{ id: 'd1', topicId: 't_goa', conversationId: '', topic: 'Villa', currentValue: '4000 each', status: 'confirmed', supportingEvidenceIds: [], contradictingEvidenceIds: [], confidence: 1, lastUpdatedAt: '', updatedBy: '', history: [], split: { perPerson: 4000, currency: '₹', among: 'everyone', collector: 'Arjun' } }],
    };
    hub.speakUp(entry, empty(), after);
    const msg = entry.messages.at(-1)!;
    expect(msg.content).toMatch(/⚠️ \*Goa trip\*: Priya can only leave Saturday/);
    expect(msg.content).toMatch(/💸 Arjun says: Paid Neha for rent \(₹9,000\)\. Neha, did you get it\?/);
    expect(msg.content).toMatch(/🧾 \*Goa trip\*: Villa, ₹4,000 each, to Arjun/);
    const confirm = msg.actions!.find(a => a.action === 'confirm')!;
    expect(confirm.onlyFor).toBe(neha.id);
    // A clash with no two values to choose between gets "suggest a fix" and "we sorted it".
    expect(msg.actions!.map(a => a.label)).toEqual(expect.arrayContaining(['Suggest a fair fix', 'We sorted it']));
    expect(msg.actions!.some(a => /^Keep /.test(a.label))).toBe(false);
  });

  it('says nothing when nothing new happened, and never twice within a few seconds', () => {
    const { entry } = setup();
    const before = entry.messages.length;
    hub.speakUp(entry, empty(), empty());
    expect(entry.messages.length).toBe(before);
    const s: GroupIntelligenceState = { ...empty(), conflicts: [{ id: 'c1', conversationId: '', topic: 'x', description: 'clash', relatedDecisionIds: [], evidenceIds: [], impactedItemIds: [], status: 'open', createdAt: '' }] };
    hub.speakUp(entry, empty(), s);
    hub.speakUp(entry, empty(), { ...s, conflicts: [...s.conflicts, { ...s.conflicts[0], id: 'c2' }] });
    expect(entry.messages.length).toBe(before + 1);
  });

  it('only the person who received the money can confirm it', () => {
    const { room, entry, neha, arjun } = setup();
    entry.room.state = { ...empty(), commitments: [{ id: 'k1', conversationId: '', ownerId: '', ownerName: 'Arjun', description: 'Paid Neha', status: 'needs_clarification', evidenceIds: [], lastUpdatedAt: '', payee: 'Neha', amount: 9000 }] };
    expect(hub.act(room.id, arjun.token, 'confirm', { commitmentId: 'k1' })).toEqual({ ok: false, message: 'Only Neha can confirm this' });
    expect(hub.act(room.id, neha.token, 'confirm', { commitmentId: 'k1' }).ok).toBe(true);
    expect(entry.room.state.commitments[0].verification?.state).toBe('confirmed');
  });
});

describe('limits on a public link', () => {
  it('allows a burst up to the limit, then refuses until the window passes', async () => {
    const { allowed } = await import('../../server/live/http');
    const key = `test:${Math.random()}`;
    const results = Array.from({ length: 5 }, () => allowed(key, 3, 60_000));
    expect(results).toEqual([true, true, true, false, false]);
  });
});

describe('when Group OS reads', () => {
  const report = { newMessages: 0, batches: 0, topicsCreated: [], topicsUpdated: [], corrections: [], tokens: 0, calls: 0, failedTopics: [], ms: 1 };
  const tick = () => new Promise(r => setTimeout(r, 20));

  it('waits for 15 new messages or a quiet minute, and says when it will read next', async () => {
    const room = hub.createRoom('Busy group');
    const neha = hub.joinRoom(room.id, 'Neha').member!;
    vi.mocked(analyzeGroup).mockImplementation(async (messages: any) => ({ state: { ...empty(), readThrough: messages.length }, report }));
    for (let i = 0; i < 3; i++) hub.postMessage(room.id, neha.token, `message ${i}`);
    await tick();
    expect(analyzeGroup).not.toHaveBeenCalled();
    const status = hub.readingStatus(hub.roomEntry(room.id)!);
    expect(status).toMatchObject({ read: 0, people: 3, burst: hub.BURST });
    expect(status.nextReadAt! - Date.now()).toBeGreaterThan(hub.QUIET_MS - 1000);
    for (let i = 3; i < hub.BURST; i++) hub.postMessage(room.id, neha.token, `message ${i}`);
    await tick();
    expect(analyzeGroup).toHaveBeenCalledTimes(1);
    expect(hub.readingStatus(hub.roomEntry(room.id)!)).toMatchObject({ read: hub.BURST, nextReadAt: undefined });
  });

  it('"Read now" reads straight away, and says so when there is nothing new', async () => {
    const room = hub.createRoom('Group');
    const neha = hub.joinRoom(room.id, 'Neha').member!;
    vi.mocked(analyzeGroup).mockImplementation(async (messages: any) => ({ state: { ...empty(), readThrough: messages.length }, report }));
    hub.postMessage(room.id, neha.token, 'rent 9000 each');
    expect(hub.readNow(room.id, neha.token)).toEqual({ ok: true });
    await tick();
    expect(analyzeGroup).toHaveBeenCalledTimes(1);
    expect(hub.readNow(room.id, neha.token)).toEqual({ ok: true, message: 'Everything is already read' });
  });

  it('reads the new messages before answering @GroupOS', async () => {
    const room = hub.createRoom('Group');
    const neha = hub.joinRoom(room.id, 'Neha').member!;
    vi.mocked(analyzeGroup).mockImplementation(async (messages: any) => ({ state: { ...empty(), readThrough: messages.length }, report }));
    hub.postMessage(room.id, neha.token, 'villa is 24000');
    hub.postMessage(room.id, neha.token, '@GroupOS how much is the villa?');
    await tick();
    expect(analyzeGroup).toHaveBeenCalled();
    expect(hub.snapshot(room.id, neha.token)!.messages.at(-1)!.speakerName).toBe('Group OS');
  });
});

describe('people added by phone', () => {
  it('someone added with a number takes their seat when they log in with it, once', () => {
    const room = hub.createRoom('Flat 7B');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    expect(hub.addPerson(room.id, k.token, 'Aniket', '98765 43210').member?.phone).toBe('919876543210');
    const seats = hub.seatsForPhone('919876543210');
    expect(seats).toHaveLength(1);
    expect(hub.snapshot(room.id, seats[0].token)?.me.name).toBe('Aniket');
    expect(hub.seatsForPhone('919876543210')).toHaveLength(0);
    // Once joined, nobody else can change their number.
    expect(hub.addPerson(room.id, k.token, 'Aniket', '91234 56780').error).toMatch(/already joined/);
  });

  it('example groups have made-up people: no numbers can be added and no phone takes their seats', () => {
    const room = hub.createRoom('Goa', { messages: [], people: ['Neha', 'Arjun'], example: true });
    const me = hub.joinRoom(room.id, 'Neha').member!;
    expect(hub.addPerson(room.id, me.token, 'Arjun', '9876543210').error).toMatch(/made up/);
    expect(hub.snapshot(room.id, me.token)?.room.example).toBe(true);
  });

  it('refuses a bad number and the same number for two people', () => {
    const room = hub.createRoom('Flat');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    expect(hub.addPerson(room.id, k.token, 'Swapnil', '123').error).toMatch(/mobile number/);
    hub.addPerson(room.id, k.token, 'Swapnil', '9876543210');
    expect(hub.addPerson(room.id, k.token, 'Aniket', '+91 98765 43210').error).toMatch(/already has that number/);
  });
});

describe('WhatsApp reminders from a group', () => {
  it('refuses people with no number and example groups; without WhatsApp set up it shows what would be sent', async () => {
    delete process.env.WHATSAPP_TOKEN;
    const room = hub.createRoom('Flat');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    hub.joinRoom(room.id, 'Aniket');
    expect((await hub.remind(room.id, k.token, 'Aniket', 'http://x')).message).toMatch(/no WhatsApp number/);
    hub.addPerson(room.id, k.token, 'Swapnil', '9876543210');
    const entry = hub.roomEntry(room.id)!;
    entry.room.state.commitments.push({ id: 'c1', ownerName: 'Swapnil', description: 'book the cab', status: 'accepted', dueAt: 'Friday', evidenceIds: [] } as any);
    const r = await hub.remind(room.id, k.token, 'Swapnil', 'http://x');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not connected/);
    expect(r.preview).toContain('book the cab');

    const ex = hub.createRoom('Goa', { messages: [], people: ['Neha', 'Arjun'], example: true });
    const n = hub.joinRoom(ex.id, 'Neha').member!;
    expect((await hub.remind(ex.id, n.token, 'Arjun', 'http://x')).message).toMatch(/made-up person/);
  });
});

describe('payment screenshots', () => {
  const reading = { kind: 'payment' as const, facts: { legible: true, amount: 200, currency: 'INR', payer: 'Kruthik', payee: 'Aniket', reference: '664124971520', date: '01 Nov', status: 'success', summary: 'Paid 200' } as any };

  it('the same screenshot sent twice is caught as one payment, and not counted again', () => {
    const room = hub.createRoom('Flat');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    hub.joinRoom(room.id, 'Aniket');
    hub.postImage(room.id, k.token, reading, '/x.jpg');
    const before = hub.roomEntry(room.id)!.room.state.commitments.length;
    hub.postImage(room.id, k.token, reading, '/x.jpg');
    const entry = hub.roomEntry(room.id)!;
    expect(entry.room.state.commitments.length).toBe(before);
    expect(entry.messages.at(-1)!.content).toMatch(/already shared .* not counted again/);
  });
});

describe('people acting while Group OS reads', () => {
  it('a payment screenshot sent during a read is still there when the read finishes', async () => {
    let finish!: (v: any) => void;
    vi.mocked(analyzeGroup).mockImplementation((_m: any, start: any) => new Promise(res => (finish = () => res({ state: { ...start, readThrough: 1 }, report: { newMessages: 1, batches: 1, topicsCreated: [], topicsUpdated: [], corrections: [], tokens: 0, calls: 1, failedTopics: [], ms: 1 } }))));
    const room = hub.createRoom('Flat');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    hub.joinRoom(room.id, 'Aniket');
    hub.postMessage(room.id, k.token, 'rent 18000 to me');
    const entry = hub.roomEntry(room.id)!;
    const reading = hub.analyse(entry);
    hub.postImage(room.id, k.token, { kind: 'payment', facts: { legible: true, amount: 400, currency: 'INR', payer: 'Kruthik', payee: 'Aniket', reference: '1234567890', date: '', status: 'success', summary: '' } as any }, '/x.jpg');
    expect(entry.room.state.commitments.some(c => c.payee === 'Aniket')).toBe(true);
    finish(undefined);
    await reading;
    expect(entry.room.state.commitments.some(c => c.payee === 'Aniket' && c.amount === 400)).toBe(true);
  });

  it('a group deleted while it is being read stays deleted', async () => {
    let finish!: (v: any) => void;
    vi.mocked(analyzeGroup).mockImplementation((_m: any, start: any) => new Promise(res => (finish = () => res({ state: start, report: { newMessages: 1, batches: 1, topicsCreated: [], topicsUpdated: [], corrections: [], tokens: 0, calls: 1, failedTopics: [], ms: 1 } }))));
    const room = hub.createRoom('Gone');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    hub.postMessage(room.id, k.token, 'hello');
    const reading = hub.analyse(hub.roomEntry(room.id)!);
    hub.deleteRoom(room.id);
    finish(undefined);
    await reading;
    expect(hub.roomEntry(room.id)).toBeUndefined();
  });
});

describe('joining safely', () => {
  it('refuses a name Group OS could mix up with someone already there, and a seat kept for a phone number', () => {
    const room = hub.createRoom('Flat');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    hub.joinRoom(room.id, 'Ravi K');
    expect(hub.joinRoom(room.id, 'Ravi').error).toMatch(/already in this group/);
    expect(hub.joinRoom(room.id, 'Ravi S').member).toBeDefined();
    hub.addPerson(room.id, k.token, 'Aniket', '9876543210');
    expect(hub.joinRoom(room.id, 'Aniket').error).toMatch(/kept for their phone number/);
    expect(hub.openSeats(hub.roomEntry(room.id)!.room)).not.toContain('Aniket');
  });
});

describe('watching an example group read from scratch', () => {
  it('forgets the old results and reads again from the first message, once, only for small example groups', () => {
    vi.mocked(analyzeGroup).mockResolvedValue({ state: empty(), report: { newMessages: 0, batches: 0, topicsCreated: [], topicsUpdated: [], corrections: [], tokens: 0, calls: 0, failedTopics: [], ms: 0 } } as any);
    const msgs = Array.from({ length: 5 }, (_, i) => ({ id: `m${i + 1}`, conversationId: '', speakerId: 'p_a', speakerName: 'A', timestamp: '', content: `hi ${i}`, type: 'text' as const, createdAt: i }));
    const ex = hub.createRoom('Gym', { messages: msgs, state: { ...empty(), readThrough: 5, decisions: [] }, people: ['Neha', 'A'], example: true });
    const me = hub.joinRoom(ex.id, 'Neha').member!;
    expect(hub.snapshot(ex.id, me.token)?.room.canReadFromScratch).toBe(true);
    expect(hub.readFromScratch(ex.id, me.token).ok).toBe(true);
    const entry = hub.roomEntry(ex.id)!;
    expect(entry.room.state.readThrough).toBe(0);
    expect(entry.room.state.decisions).toEqual([]);
    expect(hub.readFromScratch(ex.id, me.token).message).toMatch(/already/);
    const real = hub.createRoom('Mine');
    const k = hub.joinRoom(real.id, 'K').member!;
    expect(hub.readFromScratch(real.id, k.token).message).toMatch(/Only example groups/);
  });
});

describe('memory', () => {
  it('lets go of an idle group and reloads it from the database with nothing lost', () => {
    const room = hub.createRoom('Idle');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    hub.postMessage(room.id, k.token, 'hello');
    const entry = hub.roomEntry(room.id)!;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    expect(hub.releaseIdle(Date.now() + hub.IDLE_MS + 1)).toBeGreaterThan(0);
    expect(hub.snapshot(room.id, k.token)?.messages.map(m => m.content)).toEqual(['hello']);
  });

  it('never lets go of a group someone is watching or that is being read', () => {
    const room = hub.createRoom('Busy');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    const stop = hub.subscribe(room.id, k.token, () => undefined);
    expect(hub.releaseIdle(Date.now() + hub.IDLE_MS + 1)).toBe(0);
    if (typeof stop === 'function') stop();
  });
});
