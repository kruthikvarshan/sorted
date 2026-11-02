# Sorted: submission text

Copy each part into the matching field of the form. Shorter versions are given where forms often limit length.

**Name:** Sorted

**Tagline (one line):** Group chats that actually get things done. Sorted is a new member of your group, powered by Meta AI: it keeps what was decided, who owes whom and what happens next, in your own language.

**Live app:** https://sorted-n8v4.onrender.com · **Code:** https://github.com/kruthikvarshan/sorted

## Short description (≈50 words)
Group chats are where friends, flatmates and families plan their lives, and where decisions, promises and money get lost. Sorted joins the group as a member. It reads along in Hindi, Telugu, English or all three, keeps every topic, catches disagreements, checks payment screenshots, settles money exactly, and answers @Sorted.

## The problem
A real flat group: 7,600 messages in four months. Rent, Wi-Fi, a Manali trip and a hall AC, all paid by different people, half-agreed, half-forgotten. Nobody can answer "who owes whom?" without scrolling for an hour. Splitwise only works if someone types every bill in; groups don't. The truth is already in the chat. It just isn't sorted.

## What it does
- **Reads the group live**, topic by topic, in whatever language the group chats in (Hindi, Telugu, English or a mix of all three), and keeps what is decided, what is open and where people disagree, each with a link to the exact message.
- **Exact money**: bills, splits, revisions, loans, part-payments and repayments become balances, settled in the fewest payments. Every amount comes from a quote in the chat.
- **Payment screenshots**: Muse Spark reads a UPI screenshot; code checks it against the bill; the receiver confirms; the same screenshot sent twice is caught by its reference.
- **@Sorted** answers questions in the group ("Aniket ne mujhe kitna dena hai?") from the same numbers the Money tab shows.
- **Real WhatsApp reminders** through the WhatsApp Cloud API; the link opens the group as yourself.
- **Chat screenshot import**: a screenshot of any WhatsApp group becomes messages Sorted can read.
- **Trip planner**: fills in what the chat decided (with quotes), asks only for what's missing, then uses Meta AI web search for stays, routes, Instagram spots and sources.
- **Voice**: voice notes via Muse Voice; "Plan out loud" separates speakers in a recording of the group talking.
- **Group Wrapped**: a shareable recap card painted by Muse Image, with every number counted in code.
- **My Sorted**: a private view across all your groups, each group counted on its own, plus private questions.

## How we used Meta's tools
- **Muse Spark** (`muse-spark-1.3`, tool calling): topic tagging, extracting decisions, promises, payments and disagreements as structured proposals; a second claim-checking pass; @Sorted answers; private questions.
- **Muse Spark vision**: payment screenshots and chat screenshots.
- **Muse Voice**: voice-note transcription and speaker separation for Plan out loud.
- **Muse Image**: the Group Wrapped artwork.
- **Meta AI Responses API with web search**: the trip planner, with only links the search actually returned.
- **WhatsApp Cloud API**: real reminders to group members.

## How it's built
- **The model proposes, code verifies.** Muse Spark reads the chat and proposes structured facts with quotes; deterministic TypeScript turns them into balances. A number is never shown unless code worked it out from a quote.
- Money rules in code: split inference, revisions, "a later split replaces the earlier one", loans vs payments, one transfer counted once, self-corrections vs disagreements, cancelled plans, outsiders, currencies.
- **442 automated tests**, **20 hard money cases** run against the real model (18–20 exact per run), long-chat answer keys, and a trace of every Meta call (model, tokens, purpose).
- Incremental reading: only new messages are read, in topic batches; reads happen after 15 messages or 20 quiet seconds, or straight away for @Sorted and screenshots.
- Stack: React 19 + Vite, Express, SQLite, deployed on Render; phone + PIN accounts; spend guard on Meta credits.

## Challenges
Real chats are messy: amounts said three ways ("19k = 18k rent + 1k light"), bills revised after someone paid, promises kept by a screenshot, people correcting themselves. Each failure we hit in live testing became a rule in code and a test.

## What's next
Sorted is a blueprint for a member Meta could ship inside WhatsApp groups: reading where the conversation already happens, with WhatsApp Pay for settling up.

## Team
Kruthik Varshan Kondra (+ Aniket in the demo).
