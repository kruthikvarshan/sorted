# Sorted

**Your group chat, sorted.**
Sorted reads a group's conversation with Meta AI and keeps what's decided, who owes whom, what's still open and
where people disagree, topic by topic, live, in Telugu, Hindi, English or all three at once. It speaks up only
when something needs the group, answers `@Sorted`, settles money like Splitwise, and never posts a number it did not
work out in code from a quote in the chat.

Built for the Meta × Cerebral Valley hackathon.

---

## Try it

| What | Where |
|---|---|
| **Sorted**: a group chat people join from their phones (QR or link), with Sorted as a member | `/live` |
| A real-size sample group: 4 months, 1,983 messages, 6 people, 9 threads | `/live` → *Open the sample group* |
| The full workspace (import a WhatsApp export, decisions history, private view) | `/` |
| Every message in and out and every Meta AI call, for checking | `/whatsapp/trace` |

## How it uses Meta's models

| Model | What it does here |
|---|---|
| **Muse Spark** (tool calling) | Reads each topic and records decisions, promises and conflicts through tools, citing the exact message and quote for every item |
| **Muse Spark** (second pass) | Fact-checks every result against its own quotes; finds objections to suggested costs and plans, in any language |
| **Muse Spark** (topics) | Sorts long chats into topics message by message, so a 2,000-message group is read thread by thread |
| **Muse Spark** (vision) | Reads payment screenshots (amount, payee, reference) and screenshots of chats |
| **Muse Voice** | Transcribes voice notes (25 languages, mixed in one sentence), and separates speakers for *Plan out loud* |
| **Muse Image** | Paints the background of the *Group Wrapped* recap card (every number on it is counted in code) |

## The rule that makes it trustworthy: the model proposes, code verifies

- Every result must quote the chat word for word; the quote is checked against the real message in code.
- A confirmed decision is never silently overwritten: a contradiction becomes a visible disagreement unless the people
  involved agreed to the change.
- "I paid" is a claim. It is settled only when the person who received the money confirms it, in the app or in their
  own message in the chat (checked in code: the message must be theirs). A payment screenshot is evidence, not a verdict.
- All money (shares, totals, netting, the fewest payments to settle up) is computed in code. The model never adds numbers.
- Sorted speaks in the group by rules written in code (new disagreement, payment claim, new split), rate-limited.

## Features

- **Topics for long chats.** Only new messages are read; each is tagged to a topic (checked in code); each topic is
  analysed on its own, so money stays with its topic ("Goa trip: Arjun owes Neha ₹1,150").
- **Live rooms.** Real-time chat on every phone; Sorted reads a few seconds after people stop typing.
- **Speaks up** with buttons that fit: *Keep Friday / Switch to Saturday*, *Suggest a fair fix*, *Confirm (payee only)*.
- **Splitwise, from the chat.** "Split equally" means the people in that thread; what two people owe each other is
  netted; groups are never netted against each other; settle up with the fewest payments.
- **Pay on WhatsApp.** Opens your WhatsApp chat with the person you owe, note ready, to pay with WhatsApp Pay
  (no app can start a friend-to-friend WhatsApp Pay transfer, so you always pay in your own app). Or any UPI app.
- **Receipts.** A UPI screenshot becomes a checked payment claim; only the payee can confirm it.
- **Share from your phone.** On Android, install Sorted from the browser menu; then Share → Sorted sends a
  screenshot from WhatsApp (or anywhere) straight into a group.
- **Voice notes and Plan out loud.** Talk it out at the table; voices are separated; the plan lands in the chat.
- **Chat screenshots.** A screenshot of any real WhatsApp group becomes messages Sorted can read.
- **Private Sorted.** "How much do I owe across my groups?", answered only from the groups on your phone; nothing stored.
- **Group Wrapped.** A shareable recap card.

## Measured, not claimed

Live evaluation against Meta's API (`npm run eval`, `npx tsx eval/longChat/evaluate.ts`):

- **Long chat** (1,983 messages, 4 months, 9 threads, Telugu/Hindi/English): 11 topics for 9 real threads, topic
  coverage 95%, purity 98%, 19 of 19 known facts found, all under the right topic. A new message in that chat is read
  in about 28 seconds.
- **Six hand-built multilingual scenarios** (traps for sarcasm, hearsay, a prompt-injection attempt, retractions):
  99% of expected items found (75 of 76 over 2 runs each), 0 traps triggered.

Results vary between runs; the numbers above are from the runs recorded in `eval/`.

## Run it

```bash
npm install
cp .env.example .env.local   # then put your Meta key in MODEL_API_KEY
npm run dev                  # http://localhost:3000 (open /live)
```

Production: `npm run build && npm start` (port 8080). One-click deploy on Render with `render.yaml`.

Tests: `npm test` (360+ tests, no network).

## WhatsApp

Sorted also runs inside WhatsApp as a private 1:1 chat (share a group's export or screenshot; ask "what do I owe?";
send voice notes). The code is in `server/whatsapp/` and supports two official routes:

**Meta WhatsApp Cloud API (your own test number)**
1. developers.facebook.com → Create App → *Connect with customers through WhatsApp* → API Setup.
2. Put `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` in `.env.local`.
3. WhatsApp → Configuration → Callback URL `https://<your-host>/whatsapp/cloud`, the same verify token, subscribe to *messages*.
4. Message your test number.

**Twilio WhatsApp Sandbox**: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `PUBLIC_URL`, and
point the sandbox's *When a message comes in* to `https://<your-host>/whatsapp/twilio`.

Note: Meta requires business verification before a Cloud API number can message, and Sorted as a *member of a
WhatsApp group* needs Meta's Groups API (Official Business Account, groups of up to 8). The live rooms show that
experience today; the WhatsApp code is written to Meta's documented formats so it switches on with credentials.

## Privacy

- Sorted reads only the groups you give it. The private view answers only from groups on your phone.
- Payment screenshots and voice notes are processed for the facts on them; phone numbers are masked on the trace page.
- `delete my data` (WhatsApp) removes everything about you. Nothing is posted to a group without a person pressing send.
