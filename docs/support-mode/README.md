# Support mode: Dialpal for customer care calls

Status: proposal, not built. The build plan is in [PLAN.md](PLAN.md).

## 1. Summary

Dialpal today helps a sales rep on a cold call. It hears the prospect, flags objections, and shows the next line to say from a product brief. Support mode reuses the same engine for the other side of the business: a support agent on a call with a customer who has a problem.

On a support call Dialpal hears the customer and works out what they need. It shows the agent one thing to say and one thing to do next, taken only from the team's knowledge base. Card numbers and other sensitive details are blanked out before any text leaves the Mac. When the call ends, a one-tap wrap-up logs the outcome as a ticket.

About 70% of what Support mode needs already exists. The work is a new prompt, a knowledge base instead of a product brief, support-specific buttons and outcomes, redaction of sensitive data, and practice callers.

## 2. Why

- **The engine fits.** Transcription on the Mac, the cue card, auto-reply, the wrap-up, the call log, HubSpot, practice calls and stats are all channel-agnostic.
- **Support calls are where the agent most needs help.** The customer is upset, the policy is buried in a wiki, and the agent has to find the right step while staying calm. A large-type next line and the right policy at the right moment shorten calls and cut escalations.
- **It widens the market.** The same buyer (a small business with a phone line) often has both sales and support calls, frequently handled by the same few people.

## 3. Who it's for

| Segment | Fit | Notes |
| --- | --- | --- |
| Solo founders and small teams taking support calls on a Mac | Strong | Same buyer as Sales mode. No contact-centre platform to integrate with. |
| Small support teams (2 to 20 agents) using Aircall, Zoom Phone, Dialpad, RingCentral or a browser softphone on Macs | Good | The call audio plays through the Mac, so Dialpal hears it. |
| Agencies and outsourced support on Macs | Good | Many clients, many knowledge bases: needs per-client knowledge bases (later). |
| Large contact centres (Five9, Genesys, NICE, Amazon Connect) | Poor | Mostly Windows, centrally managed, buy from Cresta, Balto, Observe.AI. Out of scope. |

## 4. Goals and non-goals

### Goals

1. On a support call, the agent always sees the next thing to say and do within about 2 seconds of the customer finishing.
2. Every policy, price, timeline or troubleshooting step comes from the knowledge base. Anything else is flagged, never invented.
3. Card numbers, security codes, government ID numbers and bank details never leave the Mac and never reach the call log.
4. Angry or upset callers get an empathy-first reply that calms the call, never a scripted brush-off.
5. After the call, one tap logs a ticket-style record: issue, outcome, steps taken, follow-up.
6. Agents can practise against realistic difficult callers and get a scorecard.

### Non-goals (for the first version)

- Taking payments or processing refunds. Dialpal suggests what to say. It never acts in other systems.
- Reading or writing the customer's account in the team's own systems (order lookup, subscription status). That comes later through integrations.
- Windows.
- Chat and email support. This is for voice calls.
- Replacing a ticketing system. Dialpal logs to one, or to its CSV.

## 5. How a support call works

### Before the call (home screen)

- **Knowledge base** row in place of **Brief**: the first line of the knowledge base, with Edit.
- **Who's calling?** (optional): name, account or order number, plan, and what you already know ("second call this week about a late delivery"). The account number is treated as an identifier only; it is never a card number.
- **Take call** in place of Start call. Inbound calls start with the customer talking, so there's no automatic opener. Instead, the cue card shows the team's greeting from the knowledge base, ready to say.
- **Practice**, with support callers.
- **Today:** calls handled, resolved on the call (first-contact resolution), escalated, and the top issue.

### During the call

- **Header:** "On call" with the time, and the call **stage**: greet, verify, understand, resolve, confirm, close.
- **Banner:** the customer's latest line, tagged **Issue**, **Upset** or **Question**.
- **Cue card:**
  - **Say:** one or two sentences, under 30 words, ready to say.
  - **Do:** at most one action for the agent ("Check the order date in Shopify", "Ask for the last 4 digits of the card on file"). Never more than one step at a time.
  - An optional *note* for the agent only, such as "*Policy: refunds within 30 days only*" or "*not in knowledge base: international returns, check with a supervisor*".
- **Situation chips** (one tap, as if the customer just said it): Refund, Cancel, Where's my order, Can't log in, Billing error, Angry, Wants a manager.
- **Say next chips:** Greeting, Verify identity, Recap, Close.
- **Redaction:** sensitive numbers show as `[card ending 4242]` or `[redacted]` in the banner, the transcript and everything sent to the AI.

### After the call (wrap-up)

- **How did it end?** Resolved, Escalated, Callback scheduled, Refund or credit agreed, Ticket opened, Customer hung up.
- **Issue** (prefilled from the call, editable), **Steps taken**, **Follow-up** with a due date.
- **Save call:**
  - writes the notes file and a row in `calls.csv`, with a `mode` column set to `support`;
  - optionally creates a HubSpot **ticket** instead of a call, linked to the contact by email when it came up.

## 6. The knowledge base

A plain-text document, like the product brief, sent word for word. It is the only source for policies and steps. The suggested layout, offered as the placeholder:

```
Company: who you are and what you sell, in one line
Greeting: e.g. "Thanks for calling Ledgerly support, this is Sam. Who am I speaking with?"
Verification: what to check before discussing an account (e.g. email on file plus last 4 of the card). Never ask for a full card number.
Hours and channels: support hours, email, status page
Refunds: who qualifies, time limits, how they're issued, how long they take
Cancellations: how, notice, what happens to data, any save offer you're allowed to make
Billing: plans and prices, when cards are charged, how to fix a failed payment
Shipping or delivery (if relevant): timelines, carriers, what to do about late or lost orders
Troubleshooting: the top 10 problems, each with numbered steps
Known issues: current outages or bugs and what to tell customers
Escalation: when to escalate, to whom, and what to promise (e.g. "a reply within 1 business day")
Never say: things agents must not promise
```

Size: the same limit as the brief (20,000 characters, about 5,000 tokens). Larger knowledge bases need retrieval (pick the relevant sections per question), which is a later step (see section 13).

## 7. How replies are written (the support prompt)

A `support` style beside `sales` in `src/assistant.js`, with its own base, and the same shape rules (bold line, optional line, Stage line).

### Hard rules

1. **Shape:** bold line = what to say, under 30 words. Optional `Do:` line = one action for the agent. Optional *note*. Last line `Stage: greet|verify|understand|resolve|confirm|close`.
2. **Knowledge base only:** policies, prices, timelines, eligibility and steps come only from the knowledge base. If something is missing, never guess. The reply tells the customer the agent will check and come back, with a note "*not in knowledge base: <what>, check with a supervisor*".
3. **Never promise outside policy:** no refunds, credits, exceptions or timelines the knowledge base doesn't allow. If the customer pushes, acknowledge it and explain what can be done.
4. **Verify before account details:** follow the knowledge base's verification steps before discussing anything account-specific. Never ask for a full card number, security code, password or one-time code.
5. **Be honest:** never blame the customer, never claim a fix worked before it's confirmed, never invent a reason for a failure.

### How it should sound

- **Empathy first, briefly and specifically.** Name what happened and how it affects them ("A week late when you needed it Friday, that's frustrating"), then move to the fix. No stock lines ("I understand your frustration", "I apologize for any inconvenience").
- **Upset callers:** let them finish, acknowledge, take ownership ("I'll sort this out with you"), say what you'll do and how long it takes. Never argue or say "calm down".
- **One step at a time:** troubleshooting goes one step per turn, with a check ("Did that work?") before the next.
- **Recap before closing:** what was done, what happens next, by when, and how they'll hear.
- **Plain words:** no internal jargon, ticket codes or system names unless the customer uses them.
- **Questions:** at most one per reply, as in Sales mode.

### Common situations

| Situation | What the reply does |
| --- | --- |
| Refund request | Check eligibility against the refund policy. If eligible, state how and how long. If not, explain why plainly and offer what the policy does allow. |
| Cancellation | Confirm what they want and why (one question), make any save offer the knowledge base allows once, then respect the decision and explain next steps. |
| Where's my order | Verify, check status (a Do line), give the timeline from the knowledge base, set expectations, offer the escalation path if it's past the limit. |
| Can't log in | Troubleshooting steps one at a time, never ask for their password. |
| Billing error | Verify, find the charge (Do), explain it or correct it within policy, give the timeline for a reversal. |
| Wants a manager | Acknowledge, offer to fix it now once, then escalate per the knowledge base without arguing. |
| Abusive caller | Calmly set a boundary once. If it continues, follow the knowledge base's policy for ending the call. |

## 8. Sensitive data (redaction)

This is a hard requirement. Callers read out card numbers, security codes and ID numbers, and today the transcript is sent to the AI provider as text and saved in the notes.

### What gets redacted

| Data | How it's found | Replaced with |
| --- | --- | --- |
| Payment card numbers | 13 to 19 digits, with spaces or dashes, passing the Luhn check; also spoken digits ("four two four two…") after converting number words to digits | `[card ending 4242]` |
| Security codes (CVV) | 3 or 4 digits within a few words of "security code", "CVV", "CVC", "three digits on the back" | `[redacted]` |
| Expiry dates | MM/YY near "expires" or "expiry" | `[redacted]` |
| US Social Security numbers | `###-##-####` or 9 digits near "social" or "SSN" | `[redacted]` |
| Bank account and routing numbers | 8 to 17 digits near "account number", "routing", "sort code", "IBAN" | `[redacted]` |
| One-time codes and passwords | digits or words right after "code is", "password is" | `[redacted]` |

### Where it runs

- **On the Mac, before anything else sees the text:** right after transcription, in the main process (`heard()` in `src/main.js`), and on anything the agent types. The original text is never stored.
- Applied in Support **and** Sales mode: it's cheap and the risk exists in both.
- The redacted text is what appears on screen, in the transcript, in notes, in the call log and in HubSpot.
- A log line records counts only ("redacted card=1 cvv=1"), never the values.

### Limits to state openly

- Speech recognition can split or mishear digits, so redaction is best effort, not a compliance guarantee. Teams that take card payments over the phone should keep doing it in a PCI-compliant system (a payment IVR or pause-and-resume recording) and not read cards aloud with Dialpal listening.
- Names, emails and addresses are not redacted: the agent needs them, and they're needed to log the ticket.

## 9. Practice callers

New personas in `src/practice.js`, shown when Support mode is on:

| Persona | What they're like |
| --- | --- |
| Furious | A late order, the second call about it, wants a refund now, interrupts. |
| Confused | Not technical, can't log in, needs steps slowly, repeats questions. |
| Refund-demander | Outside the refund window, pushes hard for an exception, mentions a review. |
| About to cancel | Price-sensitive, comparing with a competitor, can be kept only by a real fix. |

The scorecard parts change for support: **greeting and verification**, **understanding**, **resolution**, **tone and empathy**, **close and recap**. It also checks that no out-of-policy promise was made.

## 10. Stats

- Calls handled, **resolved on the call** (first-contact resolution), escalated, callbacks.
- **Top issues** by type, with resolution rate per issue.
- Average call length.
- Practice scores, kept apart from real calls.

Sales and Support stats are shown separately (records carry a `mode` field).

## 11. CRM and logging

- `calls.csv` and `calls.jsonl` gain a `mode` column (`sales` or `support`) and support fields: `issue`, `resolution`, `steps`, `follow_up_due`.
- **HubSpot:** in Support mode, Save call creates a **ticket** (`/crm/v3/objects/tickets`) with subject, description (issue, steps, outcome), pipeline stage (resolved, or a waiting-on-us stage for follow-ups) and priority (high when the caller was upset or escalated). It's associated with the contact by email when one came up, and the call itself is logged as now. The ticket pipeline and stages are chosen in Settings, with the defaults read from the account.
- Required token scopes: `tickets` and `crm.objects.contacts.read`, plus `crm.objects.calls.write` for the call.

## 12. Settings and UI changes

- **Settings › Calls:** a **Call type** choice: Sales / Support / Other (Meeting). This replaces the Sales replies switch.
- **What you sell** becomes **Knowledge base** in Support mode.
- **Home, cue card, chips, wrap-up and stats** switch their labels and contents with the call type, as described above.
- The style value `support` joins `sales`, `brief` and `natural` in `config.style`.

## 13. Later (not in the first version)

1. **Retrieval for large knowledge bases:** split into sections, pick the 3 to 5 most relevant per question (keyword or embedding search on the Mac), and send only those.
2. **Import from help centres:** Zendesk Guide, Intercom articles, Notion or Google Docs export.
3. **Account lookups:** Shopify order status, Stripe subscription, through connectors, shown as a Do line with the result.
4. **Zendesk and Freshdesk tickets** besides HubSpot.
5. **Team knowledge bases** and per-client knowledge bases for agencies.
6. **After-call summaries emailed to the customer**, reviewed by the agent before sending.

## 14. Competition and positioning

| Product | What it is | Dialpal's angle |
| --- | --- | --- |
| Cresta, Balto, Observe.AI | Real-time agent assist for contact centres, sold to enterprises | Self-serve, works on any Mac softphone, transcription stays on the Mac |
| Zendesk AI, Intercom Fin | AI inside the ticketing tool, mostly chat and email | Live voice calls, any phone system |
| Dialpad Ai | Assist cards inside Dialpad's phone system | Not tied to one phone system |

**Pitch:** "Live help on every support call: the right policy, the next step, and calm words for upset customers. Card numbers never leave your Mac."

## 15. Risks

| Risk | How it's handled |
| --- | --- |
| A wrong policy answer costs money or trust | Knowledge-base-only rule, "not in knowledge base" notes, the eval checks for invented policy |
| Card or ID numbers sent to the AI provider | Redaction before sending, best-effort limits stated plainly, advice not to take cards aloud |
| Recording and consent laws (all-party consent states) | The greeting in the knowledge base includes the disclosure line, as in Sales mode |
| The agent over-relies on suggestions | Suggestions are short and marked as suggestions; "Do" lines never act on their own |
| Mac-only limits the market | Target small teams on Macs first; Windows is a separate project |
| Large knowledge bases exceed the size limit | Clear limit message; retrieval later |

## 16. How we'll know it works

- **Support eval** (`test/support-eval.js`, like `test/sales-eval.js`): about 15 moments (greeting, angry opener, refund in and out of policy, cancel, can't log in, billing error, wants a manager, unknown policy, someone reading out a card number). Each is checked for shape, knowledge-base-only facts, one question, no out-of-policy promises and redaction. A caller persona scores each reply.
- **Simulated support calls:** `scripts/simulate-call.mjs --mode support` with the four support personas, two runs each. Targets for the first release: an average scorecard of 7 or more, **zero out-of-policy promises**, **zero unredacted card numbers** across all runs, and resolution or a correct escalation in at least 6 of 8 calls.
- **Unit and UI tests** for redaction, the mode switch, chips, wrap-up outcomes, records, stats and the HubSpot ticket.

## 17. Open questions

1. Should the Call type be per call (picked on the home screen) or a setting? Proposal: a setting, with a quick switch on home.
2. Do we offer a save offer on cancellations by default, or only when the knowledge base lists one? Proposal: only when listed.
3. Should redaction be on in Sales mode too? Proposal: yes, always on.
4. Pricing: is Support a separate plan or included? Decide with the monetisation plan.
