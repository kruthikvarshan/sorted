import { buildImportedWorkspace } from '../../src/engine/importChat';
import { formatMoney } from '../../src/engine/ledger';
import { computeGroupPlan, computeMyPlan, SpendTotals, totalsText } from '../../src/engine/plan';
import { summarizeGroupsForModel } from '../../src/engine/privateView';
import { computeGroupLedger, computeMySettlement, GroupLedger } from '../../src/engine/settle';
import { parseWhatsAppExport } from '../../src/engine/whatsappParser';
import { normalizeCurrency } from '../../src/engine/receiptVerifier';
import { MetaModelService } from '../../src/services/metaModelService';
import { analyzeGroup } from '../../src/services/groupAnalyzer';
import { DEFAULT_SPOKEN_LANGUAGES } from '../../src/state/preferences';
import { GroupIntelligenceState } from '../../src/types/groupOs';
import { Channel, downloadMedia, Inbound, sendText } from './channels';
import { exportText, titleFromFilename, toWav16k } from './media';
import { addTrace, deleteEverything, deleteGroup, getGroup, getPerson, listGroups, Person, saveGroup, savePerson, StoredGroup } from './store';

/**
 * Group OS inside WhatsApp, as a private 1:1 chat. A person shares a group's exported chat; Group OS reads it with
 * Meta AI using the same engine as the web app, and answers questions about the groups that person chose.
 * It never posts to a group and never mixes one person's groups with another's.
 */

const key = () => process.env.MODEL_API_KEY?.trim() || '';
const seen = new Set<string>();
const EMPTY: GroupIntelligenceState = { decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] };

/* ---------------- replies ---------------- */

const INTRO = [
  "Hi! I'm *Group OS*. I turn your WhatsApp group chats into what's decided, who owes whom, and what's next.",
  '',
  '*Bring in a group:* open the group, tap ⋮ (or the group name) › Export chat › Without media, and share it to me. Please let the group know you are doing it.',
  '',
  'Then ask me anything, like "what do I owe?" or "what is on this week?", or send a voice note.',
  '',
  'Commands: *groups* · *use 1 3* · *money* · *schedule* · *forget 2* · *delete my data*',
  'Only you see what I tell you here. I never post to a group.',
].join('\n');

const bullet = (items: string[], max = 6) => [...items.slice(0, max), ...(items.length > max ? [`…and ${items.length - max} more`] : [])].map(i => `• ${i}`).join('\n');

function views(g: StoredGroup) {
  const { decisions, commitments, conflicts, evidenceMap } = g.state;
  const ledger = computeGroupLedger(g.workspace, decisions, commitments, { conflicts, evidenceMap, messages: g.messages });
  const plan = computeGroupPlan(g.workspace, decisions, commitments, evidenceMap, ledger);
  return { ledger, plan };
}

const pairLine = (l: GroupLedger['pairs'][number]) =>
  `${l.from} owes ${l.to} ${formatMoney(l.amount, l.currency)} (${l.items
    .map(i => `${i.direction === 'offsets' ? '−' : ''}${i.reason} ${formatMoney(i.amount, l.currency)}`)
    .join(', ')})`;

export function groupReport(g: StoredGroup): string {
  const { ledger, plan } = views(g);
  const { decisions, conflicts } = g.state;
  const decided = decisions.filter(d => d.status === 'confirmed').map(d => `${d.topic}: ${d.currentValue}`);
  const open = decisions.filter(d => d.status === 'proposed' || d.status === 'unresolved' || d.status === 'conflicted').map(d => `${d.topic}: ${d.currentValue}`);
  const clashes = conflicts.filter(c => c.status === 'open').map(c => `${c.topic}: ${c.description}`);
  const money = [...ledger.pairs.map(pairLine), ...ledger.waiting.map(w => `Not counted yet: ${w.topic} (${w.why})`)];
  const topics = (g.state.topics ?? []).filter(t => t.status === 'open').sort((a, b) => b.lastAt - a.lastAt).slice(0, 6).map(t => `${t.title}${t.summary ? `: ${t.summary}` : ''}`);
  const parts = [`*${g.workspace.title}*: read ${g.messages.length} messages with Meta AI.`];
  if (topics.length) parts.push(`🗂 *Topics*\n${bullet(topics)}`);
  if (decided.length) parts.push(`✅ *Decided*\n${bullet(decided)}`);
  if (open.length) parts.push(`⏳ *Not settled yet*\n${bullet(open)}`);
  if (clashes.length) parts.push(`⚠️ *Needs the group*\n${bullet(clashes, 4)}`);
  if (money.length) parts.push(`💸 *Who owes whom*\n${bullet(money)}`);
  if (plan.spend.groupTotals.length) parts.push(`🧾 Shared costs so far: ${totalsText(plan.spend.groupTotals)}`);
  if (parts.length === 1) parts.push('Nothing decided or owed yet in this chat.');
  return parts.join('\n\n');
}

function whoAmIQuestion(g: StoredGroup) {
  const names = g.workspace.participants.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  return `Which one is you in *${g.workspace.title}*? Reply with the number.\n${names}`;
}

/* ---------------- scope and money across groups ---------------- */

const inScope = (p: Person, groups: StoredGroup[]) => (p.scope === null ? groups : groups.filter(g => p.scope!.includes(g.id)));

function sum(rows: SpendTotals[][]): SpendTotals[] {
  const m = new Map<string, number>();
  rows.flat().forEach(r => m.set(normalizeCurrency(r.currency) ?? r.currency, (m.get(normalizeCurrency(r.currency) ?? r.currency) ?? 0) + r.amount));
  return Array.from(m.entries()).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
}

export function moneyReport(p: Person, groups: StoredGroup[]) {
  const chosen = inScope(p, groups);
  const mine = chosen.filter(g => g.me);
  const per = mine.map(g => ({ g, s: computeMySettlement([views(g).ledger], g.me!) }));
  const owe = sum(per.map(x => x.s.oweTotals));
  const owed = sum(per.map(x => x.s.owedTotals));
  const lines = per.flatMap(x => x.s.lines);
  const unknown = chosen.filter(g => !g.me).map(g => g.workspace.title);
  return { owe, owed, lines, unknown, text: `${totalsText(owe)} owed by you, ${totalsText(owed)} owed to you` };
}

function moneyText(p: Person, groups: StoredGroup[]) {
  const r = moneyReport(p, groups);
  const head = `💸 *You owe:* ${totalsText(r.owe)}\n💰 *Owed to you:* ${totalsText(r.owed)}\n_Each group is counted on its own._`;
  const body = r.lines.length ? `\n\n${bullet(r.lines, 10)}` : '';
  const ask = r.unknown.length ? `\n\nI don't know which person you are in: ${r.unknown.join(', ')}. Send *groups* to tell me.` : '';
  return head + body + ask;
}

function scheduleText(p: Person, groups: StoredGroup[]) {
  const chosen = inScope(p, groups).filter(g => g.me);
  const items = chosen.flatMap(g => {
    const plan = computeMyPlan([views(g).plan], [g.workspace], g.me!);
    return [
      ...plan.timeline.map(i => ({ key: i.sortKey, text: `${i.when}: ${i.owner ? `${i.owner}, ` : ''}${i.title} (${g.workspace.title})` })),
      ...plan.groups.flatMap(x => x.tentative.map(i => ({ key: Number.MAX_SAFE_INTEGER, text: `Not fixed: ${i.title}, ${i.when} (${i.note}, ${g.workspace.title})` }))),
    ];
  });
  if (!items.length) return 'Nothing is scheduled yet in your groups.';
  return `🗓 *Your schedule*\n${bullet(items.sort((a, b) => a.key - b.key).map(i => i.text), 12)}`;
}

function groupsText(p: Person, groups: StoredGroup[]) {
  if (!groups.length) return 'You have not shared any group with me yet. Export a group chat and share it here.';
  const list = groups
    .map((g, i) => `${i + 1}. ${p.scope === null || p.scope.includes(g.id) ? '✅' : '⬜'} ${g.workspace.title}${g.me ? ` (you are ${g.me})` : ' (tell me who you are)'}`)
    .join('\n');
  return `*Your groups* (✅ = I may use it to answer you)\n${list}\n\nReply *use 1 3* to choose, *use all*, or *forget 2* to delete one.`;
}

/* ---------------- Meta AI ---------------- */

async function analyze(g: StoredGroup, phone: string, channel: Channel): Promise<StoredGroup> {
  // Same topic pipeline as the live rooms: only messages not read before, sorted into topics, each topic read alone.
  const { state, report } = await analyzeGroup(g.messages, g.state, { apiKey: key(), groupId: g.id });
  addTrace({
    channel,
    direction: 'model',
    phone,
    summary: `Meta muse-spark: read ${report.newMessages} new message(s) of "${g.workspace.title}": ${state.topics?.length ?? 0} topic(s), ${report.calls} calls, ${report.tokens.toLocaleString()} tokens, ${Math.round(report.ms / 1000)}s`,
  });
  return { ...g, state, analyzedAt: new Date().toISOString() };
}

async function answer(p: Person, groups: StoredGroup[], query: string, channel: Channel): Promise<string> {
  const chosen = inScope(p, groups);
  if (!chosen.length) return 'No groups are switched on for me to read. Send *groups* to choose.';
  const summaries = chosen.flatMap(g =>
    summarizeGroupsForModel({
      workspaces: [g.workspace],
      scopedIds: [g.id],
      decisionsByWs: { [g.id]: g.state.decisions },
      commitmentsByWs: { [g.id]: g.state.commitments },
      conflictsByWs: { [g.id]: g.state.conflicts },
      evidenceByWs: { [g.id]: g.state.evidenceMap },
      user: { id: 'me', name: g.me ?? '', avatarColor: '' },
    })
  );
  const money = moneyReport(p, groups);
  const who = chosen.map(g => (g.me ? `In "${g.workspace.title}" the person asking is ${g.me}.` : `In "${g.workspace.title}" we do not know which member the person asking is.`));
  const res = await MetaModelService.askPrivateAssistantWithMeta(key(), query, {
    userName: 'the person asking',
    groups: summaries,
    money: { totalsText: totalsText(money.owe), owedText: totalsText(money.owed), lines: [...money.lines, ...who] },
  });
  addTrace({ channel, direction: 'model', phone: p.phone, summary: `Meta ${res.modelUsed}: private answer over ${chosen.length} group(s), no chat text sent${res.success ? '' : ' (failed)'}` });
  return res.success && res.data ? res.data : 'Sorry, I could not reach Meta AI just now. Try again in a moment, or send *money* or *schedule*.';
}

async function transcribe(channel: Channel, ref: string, phone: string): Promise<string> {
  const wav = await toWav16k(await downloadMedia(channel, ref));
  const res = await MetaModelService.transcribeAudioWithMeta(key(), new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), { languageBias: DEFAULT_SPOKEN_LANGUAGES });
  addTrace({ channel, direction: 'model', phone, summary: `Meta ${res.modelUsed}: transcribed a voice note${res.success ? '' : ' (failed)'}` });
  if (!res.success || !res.data) throw new Error('transcription failed');
  return res.data.transcript;
}

/* ---------------- the conversation ---------------- */

async function importChat(person: Person, raw: string, title: string | undefined, reply: (t: string) => Promise<void>, channel: Channel) {
  const lines = parseWhatsAppExport(raw);
  if (lines.length < 2) return reply('That does not look like a WhatsApp chat export. In the group, tap Export chat › Without media and share the file here.');
  const name = title || `Group ${listGroups(person.phone).length + 1}`;
  const id = `wa_${person.phone}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
  const existing = getGroup(id);
  const built = buildImportedWorkspace(name, raw, id.replace(/^wa_/, ''), { category: 'WhatsApp', description: 'Shared from WhatsApp' });
  const workspace = { ...built.workspace, id };
  const messages = built.messages.map(m => ({ ...m, conversationId: id }));
  const newCount = existing ? Math.max(0, messages.length - existing.messages.length) : messages.length;

  let group: StoredGroup = existing
    ? { ...existing, workspace, messages }
    : { id, owner: person.phone, workspace, messages, state: EMPTY, createdAt: new Date().toISOString() };
  saveGroup(group);

  await reply(existing ? `Updating *${name}*: ${newCount} new message${newCount === 1 ? '' : 's'}. Reading with Meta AI…` : `Got *${name}* (${messages.length} messages, ${workspace.participants.length} people). Reading it with Meta AI, about 30 seconds…`);
  group = await analyze(group, person.phone, channel);
  saveGroup(group);
  await reply(groupReport(group));
  if (!group.me) {
    savePerson({ ...person, pending: { kind: 'whoami', groupId: id } });
    await reply(whoAmIQuestion(group));
  }
}

export async function handleInbound(msg: Inbound): Promise<void> {
  if (msg.id) {
    if (seen.has(msg.id)) return;
    seen.add(msg.id);
  }
  const reply = async (text: string) => {
    addTrace({ channel: msg.channel, direction: 'out', phone: msg.from, summary: text.slice(0, 300) });
    await sendText(msg.channel, msg.from, text, msg.replyFrom);
  };
  addTrace({
    channel: msg.channel,
    direction: 'in',
    phone: msg.from,
    summary: msg.media.length ? `${msg.media.map(m => m.contentType || 'file').join(', ')}${msg.text ? ` + "${msg.text.slice(0, 80)}"` : ''}` : msg.text.slice(0, 300),
  });

  try {
    let person = getPerson(msg.from);
    const first = !person;
    if (!person) {
      person = { phone: msg.from, scope: null, createdAt: new Date().toISOString() };
      savePerson(person);
    }
    if (!key()) return reply('Group OS is not connected to Meta AI on this server yet. Please try again later.');

    // Files: a chat export, or a voice note.
    for (const m of msg.media) {
      if (m.contentType.startsWith('audio/')) {
        const heard = await transcribe(msg.channel, m.ref, msg.from);
        if (!heard) return reply("I couldn't hear any speech in that voice note. Try again a little closer to the microphone.");
        await reply(`🎙 I heard: "${heard}"`);
        return reply(await answer(person, listGroups(msg.from), heard, msg.channel));
      }
      const raw = exportText(await downloadMedia(msg.channel, m.ref));
      if (raw) return importChat(person, raw, titleFromFilename(m.filename) ?? titleFromFilename(msg.text) ?? (msg.text.trim() || undefined), reply, msg.channel);
      return reply('I can read WhatsApp chat exports (.txt or .zip) and voice notes. In the group, tap Export chat › Without media and share it here.');
    }

    const text = msg.text.trim();
    // A chat pasted as text rather than shared as a file.
    if (parseWhatsAppExport(text).length >= 3) return importChat(person, text, undefined, reply, msg.channel);

    const groups = listGroups(msg.from);

    if (person.pending?.kind === 'whoami') {
      const g = getGroup(person.pending.groupId);
      const n = Number(text);
      const pick = g && (Number.isInteger(n) ? g.workspace.participants[n - 1] : g.workspace.participants.find(p => p.name.toLowerCase() === text.toLowerCase()));
      if (g && pick) {
        saveGroup({ ...g, me: pick.name });
        savePerson({ ...person, pending: null });
        const fresh = getGroup(g.id)!;
        const r = computeMySettlement([views(fresh).ledger], pick.name);
        return reply(`Got it, you are *${pick.name}* in ${g.workspace.title}.\nYou owe: ${r.oweText}. Owed to you: ${r.owedText}.${r.lines.length ? `\n${bullet(r.lines, 6)}` : ''}\n\nAsk me anything about your groups.`);
      }
      if (/^\d+$/.test(text)) return reply(`Please reply with a number from the list.\n\n${g ? whoAmIQuestion(g) : ''}`);
      savePerson({ ...person, pending: null });
    }

    if (first || /^(hi|hello|hey|start|help|menu)\b/i.test(text)) return reply(INTRO);
    if (/^groups?$/i.test(text)) return reply(groupsText(person, groups));

    const use = text.match(/^(use|only|scope)\s+(.+)$/i);
    if (use) {
      if (/^all$/i.test(use[2].trim())) {
        savePerson({ ...person, scope: null });
        return reply(`Done: I'll use all ${groups.length} of your groups.`);
      }
      const picked = (use[2].match(/\d+/g) ?? []).map(Number).filter(n => n >= 1 && n <= groups.length).map(n => groups[n - 1]);
      if (!picked.length) return reply('Tell me the numbers from *groups*, like *use 1 3*.');
      savePerson({ ...person, scope: picked.map(g => g.id) });
      return reply(`Done: I'll only use ${picked.map(g => g.workspace.title).join(', ')}.`);
    }

    const forget = text.match(/^forget\s+(\d+)$/i);
    if (forget) {
      const g = groups[Number(forget[1]) - 1];
      if (!g) return reply('That number is not in your list. Send *groups* to see it.');
      deleteGroup(g.id);
      return reply(`Deleted *${g.workspace.title}* and everything I learned from it.`);
    }
    if (/^delete my data$/i.test(text)) {
      deleteEverything(msg.from);
      return sendText(msg.channel, msg.from, 'Done. I deleted your groups, your settings and my log of this chat.', msg.replyFrom);
    }

    const whoami = text.match(/^(i am|i'm|me)\s+(.+?)\s+in\s+(\d+)$/i);
    if (whoami) {
      const g = groups[Number(whoami[3]) - 1];
      if (!g) return reply('That group number is not in your list.');
      saveGroup({ ...g, me: whoami[2] });
      return reply(`Got it, you are *${whoami[2]}* in ${g.workspace.title}.`);
    }

    if (/^(money|balance|owe)$/i.test(text)) return reply(moneyText(person, groups));
    if (/^(schedule|plan|agenda)$/i.test(text)) return reply(scheduleText(person, groups));
    const report = text.match(/^(report|status)\s+(\d+)$/i);
    if (report) {
      const g = groups[Number(report[2]) - 1];
      return reply(g ? groupReport(g) : 'That number is not in your list.');
    }

    if (!groups.length) return reply(`I don't have any of your groups yet.\n\n${INTRO}`);
    return reply(await answer(person, groups, text, msg.channel));
  } catch (err: any) {
    addTrace({ channel: msg.channel, direction: 'note', phone: msg.from, summary: `Error: ${err?.message ?? err}` });
    try {
      await sendText(msg.channel, msg.from, 'Something went wrong on my side. Please try again in a minute.', msg.replyFrom);
    } catch {
      /* the channel itself is down: nothing more to do */
    }
  }
}

export function useMetaDirectly() {
  // On the server, call Meta directly (the browser goes through the /meta-proxy forwarder instead).
  MetaModelService.baseUrl = (process.env.META_API_BASE || 'https://api.meta.ai/v1').replace(/\/$/, '');
}
