# Sorted: roadmap to submission (Nov 4, 9 PM ET)

## Status (Nov 1)

Track 1 is built and running at `/live` (dev) and in the production server. Everything below was tested live with Meta AI.

| Item | Status | Proof |
|---|---|---|
| Topics + reading only new messages | ✅ | 1,983-message sample: 11 topics for 9 threads, coverage 95%, purity 98%, 19/19 facts, all under the right topic |
| 2,000-message test group + eval | ✅ | `eval/longChat/` (generate, evaluate, `--save-state`) |
| Live rooms, QR/link join, live updates | ✅ | Works in dev and production (`npm start`) |
| Live analysis (incremental) | ✅ | 1 new message in the 1,983-message chat read in ~28 s |
| Sorted speaks up (rules in code) | ✅ | Clashes, payment claims, new splits; buttons fit the clash |
| @Sorted in the group | ✅ | Topic-aware, knows who is asking |
| Live panel (topics, money, private) | ✅ | Phone sheet + desktop side panel |
| Settle up: Pay on WhatsApp + UPI | ✅ | Fewest payments, simplify-debts across topics |
| Receipts → checked payment claim | ✅ | Muse Spark vision; only the payee can confirm |
| Payee confirming in chat settles it | ✅ | Checked in code: the message must be from the payee |
| Voice notes in rooms | ✅ | Muse Voice, playable |
| Private Sorted across rooms | ✅ | Nothing stored; forged seats ignored |
| Chat screenshot → messages | ✅ | Muse Spark vision, "You" mapped to the sender |
| Plan out loud (speaker separation) | ✅ | Muse Voice diarization, assign voices, posts turns |
| Group Wrapped | ✅ | Stats in code, background by Muse Image (painted in advance) |
| Installable on phones + share from the phone's share menu | ✅ | Share inbox tested in the app; service worker unit-tested (this embedded browser has no service workers) |
| Six multilingual scenarios (regression) | ✅ | 99% (75/76), 0 traps; Street Food Walk 100% on 3/3 after the day-vs-time rule |
| Money: payments count Splitwise-style, group total = sum of topics | ✅ | Settle-up checked against topic cards on the sample, person by person |
| Trace page covers live rooms | ✅ | `/whatsapp/trace` |
| WhatsApp bot uses topics too | ✅ | Track 2 ready |
| Deploy on Render | ⏳ needs your Render account | `render.yaml` ready |


Two tracks. Track 1 is built now and assumes the worst case (no live WhatsApp). Track 2 starts the moment Meta
approves business verification, and reuses everything from Track 1.

**The one design rule that makes Track 2 fast:** every feature is a *bot action* that produces channel-neutral
output (text, buttons, list, image, link). Each channel only *renders* it: the Live web app, WhatsApp Cloud API,
Twilio. A feature built once works everywhere.

---

## Track 1: "Sorted" (the best possible experience without WhatsApp)

Not a fake WhatsApp screenshot: a real, multi-phone, live product that shows the full vision, including the part
WhatsApp does not allow yet (Sorted as a member of the group). Our own brand and look, WhatsApp-familiar but
never using WhatsApp's name, logo or identity as ours.

### What the judge experiences

1. Scans a QR code, types a name, and is inside a live group with us on their own phone.
2. People type plans. Sorted stays quiet until something matters, then speaks up in the group:
   "⚠️ Alex booked the villa for Friday, but Priya can only leave Saturday. [Draft a message] [Different things]".
3. A swipe-up panel on every phone updates live: decided, not settled, disagreements, who owes whom, plan and spend.
4. Someone drops a UPI screenshot: "Kiran paid Sita ₹1,500, receipt matches. Sita, confirm?" Sita taps Confirm on
   her phone and every balance updates on every phone.
5. "Settle up" shows the fewest payments to clear a topic or the group. The main button is **Pay on WhatsApp**:
   it opens the WhatsApp chat with the person you owe, with "Sending ₹1,150 for the Goa villa" ready; you send it
   and pay with WhatsApp Pay (₹) in that chat. The alternative is **Pay with any UPI app** (UPI link, amount
   filled in). There is no API for friend-to-friend WhatsApp Pay, so the person always pays in their own app.
6. A Telugu voice note in the group is transcribed and counted like any message.
7. "Plan out loud": tap the mic, three people argue in the room, the plan fills the screen as they speak.
8. Private Sorted: each person's own chat with Sorted ("what do I owe across groups?", scope, voice).
9. Any real chat: share a screenshot (or export) of a real WhatsApp group into private Sorted and it is read
   in seconds.
10. "Group Wrapped": one tap makes a shareable recap image (Muse Image).

### Long chats and topics (the backbone: real groups have thousands of messages)

Today the engine reads only the latest 400 messages and re-reads them every time. Real groups run for months,
with several plans interleaved. This is fixed first, because every other feature depends on it.

1. **Incremental reading.** Each run reads only messages it has not read before. The saved state (topics,
   decisions, money) is the memory. Cost grows with new messages, not with chat length.
2. **Sessions (code, free).** A gap of more than ~6 hours or a new day starts a new session.
3. **Topic tagging (Muse Spark, batches of ~150 messages).** Each message is assigned to an existing topic, a new
   topic, or "chit-chat". Tagging is per message, because real chats interleave ("rent" and "Goa" in the same
   hour). The model also marks a topic as finished when it is settled and has gone quiet.
4. **Topic records.** Title, kind (trip, bills, event, purchase…), open/closed, date range, people, message ids,
   a short summary. Example: "Goa trip, Nov 2026" with its sub-items (dates, villa, scuba).
5. **Analysis per topic.** Extraction runs on one topic's messages plus that topic's state: short input, better
   accuracy. Every decision, promise and bill carries its topic id.
6. **Money per topic.** "Goa trip: Arjun owes Neha ₹1,150". Each topic can be settled on its own (like Splitwise
   groups inside a group); the group total nets all open topics.
7. **Checked in code.** Message ids must exist, every message gets exactly one topic, low-confidence ones go to
   "general". A topic can be merged or renamed by a person.
8. **Search and questions.** "@Sorted what did we decide about the villa?" finds the topic first, then its
   messages and results.
9. **UI.** A topic list in the panel (open first, closed collapsed), each with its own decided / money / plan;
   a timeline of topics across months; jump from a result to the exact message.

**Test data at real scale.** A synthetic group of **2,000+ messages over ~4 months**, 6 people, 8 interleaved
topics (Goa trip, monthly rent and bills, a birthday gift collection, a weekend cricket plan, a broken-fridge
repair split, a wedding, plus chit-chat and memes), Telugu/Hindi/English mix, voice notes, payment claims,
retractions, and topics that reopen. Generated topic by topic with Muse Spark from a script we write (who says
what, what gets decided, who pays), then interleaved by time, with a known answer for every topic. Used for:
the demo ("this is 4 months of a real-feeling group, read in N seconds"), the live eval (topic accuracy and
extraction accuracy vs. today's approach), and load (time and tokens per 100 new messages).
Your real trip export, anonymized and with friends' consent, is the second test set.

### Priorities

| | Feature | Why | Effort |
|---|---|---|---|
| **P0** | Topics + incremental reading for 1,000s of messages, with the 2,000-message test group and its eval | Real groups are long; everything depends on it | 1 day |
| **P0** | Live rooms: QR/link join, names, real-time messages on all phones (server-sent events), SQLite | Everything else sits on it | 0.5 day |
| **P0** | Live analysis: after each burst of messages, read only the new ones, update state, push the panel to every phone | The core magic, live | 0.5 day |
| **P0** | Sorted speaks up (clashes, payment claims, new splits), rate-limited, with action buttons | The agentic wow | 0.25 day |
| **P0** | @Sorted in the group: answers from group results only, never anyone's private data | The dream feature | 0.25 day |
| **P0** | Live panel on phone (swipe-up) and desktop (side) reusing today's engine views | The "stats beside the group" | 0.25 day |
| **P1** | Settle up: fewest payments per topic or group; **Pay on WhatsApp** (opens the chat with the payee, note ready, then WhatsApp Pay) + **Pay with any UPI app**; collect each person's number once; mark paid → claim → payee confirms | Drives WhatsApp Pay usage; Splitwise moment | 0.5 day |
| **P1** | Receipts in the group: photo → Muse Spark vision → claim + receipt check → one-tap confirm | Proof, not trust | 0.25 day (built) |
| **P1** | Private Sorted inside the Live app, using the *same* bot as WhatsApp (server/whatsapp/bot.ts) | Parity with Track 2 | 0.25 day |
| **P1** | Screenshot → chat: image of any real chat → vision reads speakers and lines → imported group | Works with real WhatsApp today | 0.5 day |
| **P1** | Voice notes in Live rooms: record on any phone, transcribed by Muse Voice on the server, sent to everyone. Reuses the web recorder, server ffmpeg and transcription already built | Multilingual, cheap reuse | 0.25 day |
| **P2** | Plan out loud: record a conversation, Muse Voice speaker separation, map "Speaker 1 = Priya", each turn becomes a message, plan fills live. The `diarize` option exists; the flow and screen do not | Jaw-drop live moment | 0.5 day |
| **P2** | Group Wrapped image (Muse Image) | Viral and creative prizes | 0.25 day |
| **P2** | Installable on phones (PWA); Android share target for screenshots | Feels native | 0.25 day |

### Backend

- `server/live/`: rooms, members, messages in SQLite (extends `server/whatsapp/store.ts`), server-sent events stream
  per room, join tokens in the QR link.
- Analysis queue per room: debounce ~8 s after the last message (or every 15 messages), extract with Meta on the
  new messages + current state, apply with the existing reducer, compute ledger/plan, push a diff.
- Speak-up rules (code, not model): new open conflict, new payment claim, new split that includes people, payment
  confirmed. Max one Sorted message per event, at most one per 20 s per room.
- Bot actions: one function per feature returning channel-neutral output; renderers for `live`, `cloud`, `twilio`.
- Trace page extended to Live rooms (judges see every model call).

### UI

- Mobile-first group chat, our own green-teal brand, bubbles, ticks, typing dots.
- Sorted messages styled as a member with action buttons.
- Swipe-up panel with tabs: Decided · Money · Plan · Disagreements. Desktop shows it beside the chat.
- Private Sorted tab next to the group.
- Join screen with QR and a big "you are in" moment.

### Demo safety

- A one-click "rehearsal" room seeded from a scenario, so the video never depends on typing speed.
- Every model call has a fallback message; nothing hangs on screen.
- Deploy on Render by Nov 2 with a permanent HTTPS address (needed for phones and for Track 2).

### Schedule

With topics added, P0 alone is about 2.75 days of work, so the order matters and P2 is likely to be cut.

- **Nov 1:** topics + incremental reading; generate the 2,000-message group; run the eval.
- **Nov 2:** live rooms, topic-aware live analysis, speak-up, @Sorted, panel with topics; deploy on Render.
- **Nov 3 (morning):** P1: settle up with UPI, receipt confirm, screenshot import, private Sorted. Test with
  2 to 3 friends on real phones.
- **Nov 3 (evening):** README, screenshots, video recording.
- **Nov 4:** fixes only; submit by noon ET, not at 9 PM. P2 (voice in groups, plan-out-loud, Wrapped, PWA) only
  if a day above finishes early.

---

## Track 2: live on WhatsApp after verification

### What WhatsApp allows (and what it does not)

- ✅ Private 1:1 chat with Sorted: text, voice notes, images, documents, reply buttons (3), lists (10 rows),
  images we send.
- ✅ Free replies for 24 hours after the person's last message. Outside 24 h only approved templates.
- ❌ Sorted inside WhatsApp groups (needs an Official Business Account; not realistic now).
- ❌ Any panel inside WhatsApp's screen.

### How each Live feature maps to WhatsApp

| Live feature | On WhatsApp (1:1) |
|---|---|
| Sorted in the group | Share an export or **screenshot** of the group into the private chat; re-share to update. Same title = same group. |
| Live panel | A short status message + **Open board** link to the same panel on the web (signed, per-person link). |
| Sorted speaks up | After each import, a private alert: "⚠️ New disagreement in Goa: …" with buttons. |
| @Sorted | "@goa what about the hotel?" in the private chat routes to that group. |
| Draft a message to the group | Button opens WhatsApp with the text filled in (`https://wa.me/?text=…`); the person picks the group and sends. |
| Settle up | Each payment with **Pay on WhatsApp** (opens the chat with the payee, note ready, then WhatsApp Pay) and a **Pay with any UPI app** link. |
| Receipt confirm | Send the payment screenshot; the payee gets [Confirm] [Dispute] buttons. |
| Voice notes | Built: transcribed and answered. |
| Group Wrapped | Sent as an image message. |
| Scope | List message with the person's groups. |

### Steps the moment you say "verified" (about half a day)

1. **You (10 min):** API Setup → send the hello_world test to your number. It must arrive (lock lifted).
2. **You (10 min):** Business Settings → System users → create one, assign the app and the WhatsApp account
   (full control) → generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
3. **You:** put in `.env.local` (and on Render): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_VERIFY_TOKEN=groupos-verify`, `WHATSAPP_APP_SECRET`.
4. **You:** App → WhatsApp → Configuration → Callback URL `https://<render-app>/whatsapp/cloud`, verify token
   `groupos-verify` → Verify and save → subscribe to **messages**.
5. **Me (15 min):** smoke test: "hi", an export, a voice note, `money`. Check the trace page.
6. **Me (2 to 3 h):** render bot actions for Cloud API: reply buttons, list messages, image upload/send,
   inbound images (screenshots), signed board links, wa.me drafts.
7. **You:** add up to 4 friends as test recipients for the video.
8. **Together:** record the WhatsApp segment (it is a swappable 30 s block in the video).
9. **Later, optional:** submit utility templates ("group_update") for alerts outside 24 h.

Already built for Track 2: `server/whatsapp/` (webhook verification, signatures, Cloud API + Twilio, text, voice,
exports, SQLite, trace page, private Sorted commands).
