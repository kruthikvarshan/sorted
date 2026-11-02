# Sorted: everything a person can do

Sorted is a group chat with a member that keeps track: what the group decided, who owes whom, who promised what, and what is coming up. It runs on Meta AI (Muse Spark, Muse Voice, Muse Image, Meta web search); every amount it shows is calculated in code from quoted messages, never guessed.

Legend: **Meta** = which Meta capability does the reading or making. **Checked by code** = what is verified before anything is shown.

## 1. Accounts and groups

| Feature | What the person does | Meta | Checked by code |
|---|---|---|---|
| Sign up / log in | Name + mobile number + a 4-digit PIN they pick | — | One account per number; PIN stored only as a scrypt hash; 5 wrong PINs lock the number for 15 minutes |
| Example groups | Nothing: 8 groups (800–5,000 messages) arrive with the account, already read, under the person's own name | Muse Spark read them | Marked EXAMPLE, made-up people, nobody can join as them; a character whose name clashes with the person's is renamed |
| Real groups | Start a group, invite by QR or link | — | Only the creator can delete it for everyone |
| Add people by phone | Add a name + number in the group | — | When that person signs up with the number, the group appears for them, as themselves; nobody else can take that seat |
| My Sorted follows | Choose which groups the private view follows | — | Each group counted on its own, never netted with another |
| Delete a group | Delete (for everyone if you made it) | — | Deleted groups never come back, even if a read was running |

## 2. Chatting

| Feature | What the person does | Meta | Checked by code |
|---|---|---|---|
| Text chat | Type as in WhatsApp; live on every phone | — | — |
| Voice notes | Hold the mic | **Muse Voice** transcribes (Hindi, Telugu, English…) | Shown as a voice note with the audio kept |
| Plan out loud | Record the group talking around a table | **Muse Voice** separates speakers | People assign each voice to a member before anything is posted |
| @Sorted questions | "@Sorted what's the villa cost each?" | **Muse Spark** answers from the group's results | Answer quotes the messages it is based on |
| Payment screenshot | Send a GPay/PhonePe/UPI screenshot | **Muse Spark vision** reads amount, payer, payee, reference | Matched against what you owe that person; the same screenshot twice is caught; the receiver must confirm |
| Chat screenshot | Send a screenshot of any chat | **Muse Spark vision** copies every message word for word | Added as messages marked "from a screenshot", then read like the rest |
| Group Wrapped | Tap ✨ | **Muse Image** paints the background | Every number on the card counted in code |
| Reading status | See how far Sorted has read and when it reads next; Read now | — | Reads after 15 new messages or a quiet minute; never re-reads |

## 3. What Sorted works out (the panel)

| Feature | What the person sees | Meta | Checked by code |
|---|---|---|---|
| Topics | The chat sorted into threads (trip, rent, birthday…), parts of big plans separated ("Goa trip: stay") | **Muse Spark** tags messages in batches | Every message assigned once; topics merged or split by rules |
| Decisions | What was agreed, with quotes; changes tracked | **Muse Spark** proposes | Quote must be word-for-word in the chat; a change to an agreed value raises a disagreement instead of overwriting |
| Disagreements | "Arjun objects to 900 for electricity" | **Muse Spark** proposes | Kept open until a person resolves it; disputed money is not counted |
| Promises | "I'll book the cab by Friday" | **Muse Spark** proposes | Status only moves forward; a retraction needs the person's own words |
| Money: who owes whom | Netted per pair inside the group | **Muse Spark** reads bills and payments | Splitwise rules in code: shares, payments shared across topics oldest first, loans, part payments, running totals, one transfer per message, currencies never mixed |
| Settle up | The fewest payments that clear everything | — | Greedy minimum transfers |
| I paid this | Asks once, posts "Paid X ₹N" | — | Counts only when the receiver confirms |
| Pay on WhatsApp / UPI | Opens the chat or any UPI app with the amount | — | — |

## 4. Reaching people on WhatsApp

| Feature | What the person does | Meta | Checked by code |
|---|---|---|---|
| Remind on WhatsApp | Tap Remind next to a debt or a person, read the exact message, press Send | **WhatsApp Cloud API** delivers it | Text written in code from the ledger; only dated, non-money promises included; never for example people; 10 per hour per sender; the group sees that a reminder went |
| Join from the reminder | The person taps the link, signs up with their number | — | Lands in the group in their own seat |

## 5. Trip planner

| Feature | What the person does | Meta | Checked by code |
|---|---|---|---|
| 🧭 Plan this trip | On a trip topic, check the form (where to, from, dates, budget, people) and fill anything missing | **Muse Spark + Meta web search** | Facts come only from agreed or proposed decisions (with quotes); nothing assumed; searches only when all five are known |
| Ideas with sources | Stays, travel, things to do, a money tip, "⚠️ Heads-up" if the plan looks off | **Meta web search** | Only links the search returned; at most two per website; no other splitting app is ever suggested |

## 6. My Sorted (private)

| Feature | What the person sees | Meta | Checked by code |
|---|---|---|---|
| Totals | You owe / you are owed / disagreements / decided, across followed groups | — | Never netted across groups |
| Reminders | Pay X, confirm Y's payment, your promises, open disagreements | — | Worked out from each group's results |
| Who owes whom, group by group | Each pair with the bills behind it | — | Same ledger as the group |
| To-do and coming up | Your promises (tick them), dates the groups fixed | — | — |
| Private chat | "What do I owe overall?" | **Muse Spark** answers from your groups only | Only groups you are in |

## 7. Trust and transparency

- Every decision, promise and amount links to the messages it came from (tap to jump).
- Every Meta call is traced (what was read, how many tokens) on the trace page.
- Example groups are clearly labelled; real people's numbers are never written into data files.
