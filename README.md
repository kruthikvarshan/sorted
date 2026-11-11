# Sorted

**Group chats that actually get things done.**

Sorted is a new member of your group chat, powered by Meta AI. It reads along, in whatever language your group talks in (Hindi, Telugu, English, or all three in one sentence), and keeps what was decided, who owes whom, and what happens next. Every number it shows is worked out in code from a message you can tap to see.

### ▶ The hosted demo has been retired after the hackathon. Watch the video below, or [run it yourself](#run-it-yourself).
### 🎬 3-minute demo: [youtu.be/vI0NgU80QUQ](https://youtu.be/vI0NgU80QUQ)

---

## Try it in 2 minutes (once it's running)

1. **[Run it yourself](#run-it-yourself)**, then open http://localhost:3000/live.
2. Tap **First time here**. Enter your name, your mobile number **with country code** (e.g. `+1 415 555 0123`) and any 4-digit PIN you choose.
3. You get **8 example groups, already read**, in English, Hindi-English and Telugu-English, 800 to 5,000 messages each. You appear in each one as a member.
4. Things to try:

| Try this | Where | What you'll see |
|---|---|---|
| **See who owes whom** | Any group → panel icon (top right) → **Money** | Exact balances, settled in the fewest payments |
| **Tap any amount or "see"** | In a topic card | The chat jumps to the exact message it came from |
| **Spot a disagreement** | Topic cards with a red badge | Who wants what, with both quotes |
| **Ask a question** | Type `@Sorted how much do I owe?` | An answer in the group, using the same numbers as the Money tab |
| **Plan a trip** | A trip topic → **🧭 Plan this trip** (try *Goa Trip 2026*) | Filled in from the chat, then Meta AI web search with real sources and Instagram spots |
| **Group Wrapped** | ✨ in the group's top bar | A shareable recap card, painted by Muse Image |
| **My Sorted** | 🔒 / home → My Sorted | Your money and to-dos across every group, and private questions |
| **Start a live group** | Home → **Start a new group** → share the QR | Chat with a friend; Sorted reads along within seconds |
| **Payment screenshot** | In your group: **+ → Send a screenshot** | Read, checked against the bill, duplicates caught |
| **Voice** | 🎤 for a voice note · **+ → Plan out loud** | Transcribed in the language you spoke; voices told apart |

> WhatsApp reminders use Meta's WhatsApp test number, which can only message numbers that have messaged it first, so that one feature is shown in the demo video rather than open to everyone.

---

## What it does

- **Reads the group live**, topic by topic, in any language the group chats in.
- **Exact money**: bills, splits, revisions, loans, part-payments and repayments become balances, settled in the fewest payments. Every amount links to its message.
- **Catches disagreements** and shows both sides with their quotes.
- **Answers `@Sorted`** in the group, from the same numbers as the Money tab.
- **Payment screenshots** (UPI, GPay, PhonePe…) are read, checked against the bill, confirmed by the receiver; the same screenshot twice is caught.
- **Chat screenshot import**: a screenshot of any WhatsApp group becomes messages Sorted reads.
- **Real WhatsApp reminders** through the WhatsApp Cloud API; the link opens the group as you.
- **Trip planner**: fills in what the chat decided (with the quote for each), asks only for what's missing, then searches the web.
- **Voice notes** and **Plan out loud** (a recording of the group talking, split by speaker).
- **Group Wrapped**: a shareable recap card.
- **My Sorted**: a private view across all your groups, each group counted on its own.

Full list: [docs/FEATURES.md](docs/FEATURES.md)

## Which Meta model does what

| Meta product | What Sorted uses it for |
|---|---|
| **Muse Spark** (`muse-spark-1.3`, tool calling) | Reads every message in any language: topics, decisions, promises, payments, disagreements, each with its quote. A second pass checks every claim. Answers `@Sorted` and private questions. |
| **Muse Spark vision** | Reads payment screenshots (amount, payee, UPI reference) and whole chat screenshots. |
| **Muse Voice** | Transcribes voice notes; separates speakers for Plan out loud. |
| **Muse Image** | Paints the Group Wrapped card. |
| **Meta AI web search** (Responses API) | Trip ideas with real sources; only links the search actually returned are shown. |
| **WhatsApp Cloud API** | Real reminders to group members. |

## How it's built

**The model proposes, the code verifies.** Muse Spark reads the chat and proposes structured facts with quotes; deterministic TypeScript turns them into balances, splits and settle-ups. Nothing is shown unless code worked it out from a message.

- **Tested**: 444 automated tests, 20 hard money cases run against the real model, and answer keys for long example chats ([eval/](eval)).
- **Traced**: every Meta call is logged with model, tokens and purpose.
- **Incremental**: only new messages are read, in topic batches: after 15 messages, 20 quiet seconds, or straight away for `@Sorted` and screenshots.
- **Stack**: React 19 + Vite, Express, SQLite, deployed on Render.

Architecture and data flow: [docs/TECHNICAL.md](docs/TECHNICAL.md)

## Run it yourself

```bash
npm ci
cp .env.example .env.local   # add your Meta Model API key (MODEL_API_KEY)
npm run dev                  # http://localhost:3000/live
```

Production: `npm run build && npm start`. One-click deploy on Render with [render.yaml](render.yaml). Tests: `npm test`.

| Folder | What's in it |
|---|---|
| `src/live/` | The app people use |
| `src/engine/` | Money, decisions and settle-up, all in code |
| `src/services/` | Meta model calls: reading, vision, voice, images, web search |
| `server/` | API, live rooms, accounts, WhatsApp |
| `eval/` | Evaluations against the real model, with results |
| `src/tests/` | Automated tests |

---

Built by Kruthik Varshan Kondra for the Meta × Cerebral Valley hackathon.
