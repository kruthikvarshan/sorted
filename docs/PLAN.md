# Group OS: what is left until submission

Deadline: Wednesday Nov 4, 9 PM ET (Thursday Nov 5, 6:30 AM IST). We submit Wednesday night IST.
Decided: Aniket's scenes are shot on Day 2 (he leaves Nov 4). Swapnil and the WhatsApp reminder template are dropped; the demo uses Aniket, who sends "hi" to +1 555-208-7343 before recording so plain-text reminders reach him. Plan out loud stays as is (names picked by hand). Feature freeze from Nov 2: no new features (forward-in, mediator, speaks-up, accuracy page dropped); only bug fixes, speed and polish.

## Day 2: Tuesday, Nov 3 (going public + every scene that needs Aniket; he leaves on Nov 4)
1. **Rotate the Meta key** — You: new key at dev.meta.ai into `.env.local` (5 min). Me: check it works.
2. **Prepare the code** — Me: git repo, secrets scan, kickoff screenshots out of `public/`, Render config.
3. **Render deploy** — Me: step-by-step instructions, then check the live site end to end. You: private GitHub repo + Render account, card (~$7 + disk), paste the secrets (~20 min).
4. **Shot list for Aniket's scenes** — Me: write the exact shots, in order, with what each of you taps and says. You: read it with Aniket.
5. **Real-phone run-through with Aniket** — You + Aniket: every feature on the live address (~45 min). Me: fix anything found on the spot.
6. **Shoot Aniket's scenes** (live address, both phones) — You + Aniket: record on your phones:
   - Live new group: QR scan to join, a short Hinglish chat, Group OS reading it (0:10–0:35).
   - Payment screenshot from Aniket's side, checked, you confirm; the same screenshot caught as a duplicate (1:05–1:20).
   - Aniket sends "hi" to +1 555-208-7343, then the reminder: your tap and Send, **his phone buzzing**, him opening the link and landing in Flat 7B as himself (1:20–1:40).
   - Spare takes of each, and any shot with both of you in it.
   Me: check every clip the same day; re-shoot list if anything is missing.
7. **README and docs** — Me: write everything, including eval scores and traces. You: read it once.

## Day 3: Wednesday, Nov 4 (pitch, video, submit)
8. **Demo script** (main ~3 min, every feature; walkthrough ~6–8 min) — Me: write it shot by shot. You: approve; tell me the video length limit.
9. **Slides and submission text** — Me: write. You: approve.
10. **Recording the rest** — Me: screen parts. You: your solo phone moments and the voice-over.
11. **Video edit** — Me: full edit of both videos, drafts for feedback. You: `brew install ffmpeg`, feedback.
12. **Final check and submit** — Me: check everything on the live address. You: press Submit.

## Main video (~3 min)
| Time | Scene |
|---|---|
| 0:00–0:10 | The problem: a 7,600-message chat, "who owes what?" |
| 0:10–0:35 | Live: new group, QR join, Hinglish chat, Group OS reads it in front of you |
| 0:35–1:05 | Flat 7B: topics, exact money, tap to see the quote, a disagreement caught, "@GroupOS what does Aniket owe me?" |
| 1:05–1:20 | Payment screenshot checked; duplicate caught |
| 1:20–1:40 | Real WhatsApp reminder; Aniket's phone buzzes; he joins as himself |
| 1:40–1:55 | A real WhatsApp chat screenshot imported and read |
| 1:55–2:15 | Trip planner: asks what's missing, Meta web search, real sources, Instagram spots, a heads-up |
| 2:15–2:30 | Voice note and Plan out loud (Muse Voice), Wrapped (Muse Image) |
| 2:30–2:42 | My Group OS: across groups, never mixed, reminders, to-do |
| 2:42–3:00 | How it's built: "the model proposes, code verifies", evals, traces, "only Meta can ship this inside WhatsApp" |

## Ground rules
- Authenticity first: nothing pre-made pretending to be live; never cut live Meta work to save money.
- The model proposes, code verifies; every money fix gets a test.
- Nothing breaks in front of judges: calm notes, never errors.
- Report Meta spend after every big read (counted on /live/api/spend).
