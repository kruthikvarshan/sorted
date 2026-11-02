# Group OS: future scope

Grouped by when it can happen. **Hackathon** = can be built or switched on before the deadline. **Next** = a few weeks. **Ultimate** = the version Meta could ship inside WhatsApp. Each item says why it matters.

## 1. Security and privacy

| Item | When | Why |
|---|---|---|
| Deploy on a fixed address (Render with a persistent disk) instead of a tunnel | Hackathon | Links and QR codes stop changing; WhatsApp needs a fixed webhook |
| Lock the trace page with `TRACE_TOKEN` in production | Hackathon | It shows group names and amounts |
| Sessions that expire (30 days) and are sent in a header, not the URL | Hackathon | URLs end up in logs and history |
| Daily cap on Meta calls for the whole server | Hackathon | A public demo can't run up an unlimited bill |
| Verify the phone number at sign-up with a WhatsApp code (OTP) | Next | Today anyone can sign up with someone else's number first and take the seats waiting for it. The test number can only message 5 verified numbers, so this needs a verified business number |
| PIN → passkey (Face ID / fingerprint) with the PIN as fallback | Next | 4 digits is the weakest link even with lockout |
| Show other members' numbers only when needed (a "Pay on WhatsApp" link without revealing the digits) | Next | Joining by link should not hand everyone's number to strangers |
| Screenshot and voice messages attributed to the uploader until the named person confirms | Next | A faked chat screenshot ("Arjun: I owe you 5000") should not create a debt by itself |
| Leave a group (removes you from "everyone" splits) | Next | Someone who left should not keep getting shares |
| Account deletion and data export | Next | Expected by users; required by India's DPDP Act |
| End-to-end encryption of chat content at rest; per-group keys | Ultimate | Group chats are private by nature |
| Private processing (Meta's on-device / confidential compute) for reading | Ultimate | The same promise as WhatsApp's private message summaries |

## 2. Reliability and scale

| Item | When | Why |
|---|---|---|
| Unload idle groups from memory; index sessions | Hackathon | Each account loads ~16k example messages; lookups scan all accounts |
| Background job queue for reads with retry and backoff | Next | A slow Meta call should never block others |
| Postgres instead of SQLite once there are several servers | Next | One file on one disk is fine for a demo, not for many servers |
| Incremental re-reads when a topic's earlier messages change | Next | Edits and deletions in chats |
| Per-group model cost budget | Next | Very long groups cost more |

## 3. The money engine

| Item | When | Why |
|---|---|---|
| Exact-answer scoring built into the chat generator (every money event tagged as it is written) | Hackathon | Every read scored automatically to the rupee, not checked by hand |
| A hard-cases test set (about 25 short chats: two payments in one message, part payments, loans, recaps, disputes, outsiders, running totals) run against the real pipeline | Hackathon | The bar is 100%, re-run after every change |
| Re-read every example group with the latest reader | Hackathon | They were read before the payment sweep |
| "Who said what" audit trail per amount, shown as a timeline | Next | People trust money they can trace |
| Recurring bills (rent every month) set up once | Next | Fewer messages needed, fewer misses |
| Multi-currency trips with live rates at the time of the bill | Next | Trips abroad |
| UPI payment links that confirm automatically (UPI collect / payment status APIs) | Ultimate | No screenshot, no "did you get it?" |

## 4. WhatsApp integration

| Item | When | Why |
|---|---|---|
| Approved reminder template (`group_os_reminder`) | Hackathon (submitted) | Reminders reach anyone, not only people who messaged in the last 24 hours |
| Incoming messages (webhook): forward messages, screenshots and voice notes to the Group OS number; it asks which group and files them; "What do I owe?" answered in WhatsApp | Hackathon / Next | The private Group OS lives in WhatsApp; needs the fixed address and the app published |
| A verified business number named "Group OS" | Next | Reminders show "Group OS", not "Test Number", and reach anyone |
| Inside WhatsApp groups | Ultimate | The Groups API needs an Official Business Account and still cannot join existing groups. Only Meta can put this inside WhatsApp groups, next to @Meta AI. This app is the blueprint: Message Summaries recap what you missed; Group OS remembers what the group agreed and keeps everyone to it |

## 5. Features

| Item | When | Why |
|---|---|---|
| "Seen on Instagram" spots in trip ideas (public Instagram pages from Meta web search) | Hackathon | Tested: the search returns public Instagram profiles and posts |
| Plan out loud moved into a "+" menu; the composer simplified | Hackathon | Two audio buttons side by side confuse people |
| Polls inside the chat that Group OS counts ("Saturday or Sunday?") | Next | Decisions become explicit |
| Calendar export of "Coming up" (.ics) | Next | Plans land where people look |
| Shared lists (packing, groceries) from the chat | Next | Another common group job |
| Group OS speaking up proactively ("Rohan still owes for the villa; trip is in 3 days") with quiet hours | Next | The member who keeps track also reminds, politely |
| Languages beyond Hindi and Telugu written in English letters (Tamil, Kannada, Bengali, native scripts) | Next | India's groups |
| Ray-Ban Meta glasses: "Hey Meta, what do I owe in Flat 7B?" | Ultimate | Hands-free, same private Group OS |
| Groups on Messenger and Instagram DMs | Ultimate | Same brain, every Meta surface |

## 6. Easier to use

| Item | When | Why |
|---|---|---|
| A 30-second first-run tour (one example group, three taps) | Hackathon | Judges understand it at once |
| Visible captions instead of hover tooltips (why a button is disabled, what EXAMPLE means) | Hackathon | Phones have no hover |
| Bigger tap targets on the group list chips; rows that are not buttons inside buttons | Hackathon | Fewer wrong taps |
| Offline queue for messages | Next | Patchy networks |
| Accessibility pass (screen readers, contrast, text sizes) | Next | Everyone in the group |

## 7. Known limits today (said openly)

- Reminders come from Meta's test number and only reach the five numbers verified on it.
- The public link is a free Cloudflare tunnel until the deploy; it changes when restarted.
- Phone numbers are not verified at sign-up.
- Example chats are generated; stories drift in places, and the money is checked against the chat itself.
- The model can still miss a payment in a very busy stretch; the payment sweep and the approve-before-send step on reminders are the safety nets.
