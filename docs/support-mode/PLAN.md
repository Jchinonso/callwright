# Support mode: build plan

The design is in [README.md](README.md). This plan builds it in nine steps, in order. Each step lists the files it touches, what to do, and how to check it's done. Steps 1 to 6 need no API credits. Steps 7 to 9 run against a real model.

Rough size: 2 to 3 days of work, plus about $10 to $20 of API usage for the evals and simulated calls.

---

## Step 1. Redact sensitive data (do this first; it protects Sales mode too)

**Files:** new `src/redact.js`, `src/main.js`, new `test/redact.test.js`

**Do:**
- Write `redact(text)` in `src/redact.js`. It returns `{ text, counts }`.
  - Convert spoken digits to numerals first ("four two four two" → "4242", "oh" → "0" between digits).
  - Card numbers: 13 to 19 digits, allowing spaces or dashes, passing the Luhn check → `[card ending NNNN]`.
  - Security codes, expiry dates, US Social Security numbers, bank account and routing numbers, one-time codes and passwords, each only near their trigger words (see README section 8) → `[redacted]`.
- In `src/main.js`, call it in `heard()` before `keep(line)`, on the agent's typed questions in `runAsk`, and on `practice-say` text. Log counts only.
- Leave names, emails and addresses alone.

**Done when:**
- `node --test test/redact.test.js` passes with cases covering: a typed card number, a spoken one, one split across two transcript lines (redact the joined text), a CVV next to "security code", an SSN, a bank account next to "routing", an order number of 16 digits that fails Luhn (not redacted), a phone number (not redacted), and a price "$1,299" (not redacted).
- `npm test` passes.

---

## Step 2. The Support style and knowledge base

**Files:** `src/assistant.js`, `src/main.js`, `test/prompt.test.js`

**Do:**
- Add `SUPPORT_BASE` and `STYLES.support` in `src/assistant.js`, following README section 7: the shape with `Do:` and `Stage:` lines, knowledge-base-only facts, no promises outside policy, verification first, empathy first, one step at a time, recap before closing, and the situation table.
- `systemPrompt`: when the style is `support`, send the knowledge base in `<knowledge_base>` (stored in a new `knowledgeBase` setting, same size limit as the brief) and use support wording for the user's details.
- `takeStage` (both copies: `src/assistant.js` and `src/ui/markdown.js`) accepts the support stages: greet, verify, understand, resolve, confirm, close.
- `src/main.js`: add `"support"` to the allowed styles, add `knowledgeBase` to defaults, settings and state, and refresh hint words from it as for the brief.
- Add `SAY_NEXT` entries for support (greeting, verify, recap, close). Taking a call in Support mode shows the greeting, as Start call shows the opener in Sales mode.

**Done when:** `node --test test/prompt.test.js` has new tests that pass:
- the knowledge base is sent word for word;
- the support prompt has the hard rules;
- the support prompt has no sales rules (no "pitch", no "objection");
- the support stages parse.

---

## Step 3. Support UI: call type, home, chips, cue card

**Files:** `src/ui/index.html`, `src/ui/app.js`, `src/ui/style.css`, `test/ui.test.js`

**Do:**
- Settings › Calls: replace the Sales replies switch with a **Call type** control (Sales / Support / Other).
- Home in Support mode: a **Knowledge base** row, a **Take call** button, a **Who's calling?** box (name, account or order number, plan, notes) and support stats.
- Chips switch by mode: situation chips (Refund, Cancel, Where's my order, Can't log in, Billing error, Angry, Wants a manager) and Say next (Greeting, Verify, Recap, Close).
- Banner tags: Issue, Upset, Question. Add an `isUpset()` check in `src/ui/questions.js` (raised-emotion phrases: "ridiculous", "unacceptable", "I want a manager", "this is the third time").
- Cue card: render the `Do:` line like **Then ask**, labelled **Do**, in a different colour (`src/ui/markdown.js`, like the Ask line).
- Practice personas and the knowledge base placeholder switch with the mode.

**Done when:** new UI tests pass:
- switching the call type changes home, chips and labels;
- a support chip asks as the customer;
- the `Do:` line renders;
- an upset line gets the Upset tag.

`npm test` passes.

---

## Step 4. Support wrap-up, records and stats

**Files:** `src/calls.js`, `src/main.js`, `src/ui/index.html`, `src/ui/app.js`, `test/calls.test.js`, `test/ui.test.js`

**Do:**
- `src/calls.js`:
  - add `SUPPORT_OUTCOMES` (resolved, escalated, callback, refund_or_credit, ticket_opened, hung_up) and `ISSUES` (refund, cancel, order_status, login, billing, product_bug, how_to, other);
  - add a support version of the record prompt: issue, resolution, steps, follow-up and due date, sentiment;
  - add a `mode` field to records and a `mode` column to the CSV. Read old rows without it as `sales`.
- `computeStats`: split by mode. Support stats are first-contact resolution, escalation rate, top issues with resolution rate per issue, and average length.
- Wrap-up in Support mode: support outcomes, Issue, Steps taken, Follow-up with a due date.
- Home and stats panel show the support numbers in Support mode.

**Done when:**
- unit tests pass: support records parse and their CSV columns are quoted safely; support and sales stats stay apart; old rows without a mode count as sales;
- a UI test passes: a support call wraps up, saves, and shows on home.

---

## Step 5. HubSpot tickets

**Files:** `src/calls.js`, `src/main.js`, `src/ui/index.html` (HubSpot form), `test/calls.test.js`, `test/ui.test.js`

**Do:**
- `pushTicketToHubSpot(record, token, options)`:
  - finds the contact by email;
  - creates a ticket (`POST /crm/v3/objects/tickets`) with subject, content, `hs_pipeline`, `hs_pipeline_stage` and `hs_ticket_priority` (HIGH when the caller was upset or the call escalated);
  - associates the ticket with the contact;
  - logs the call as now.
- Settings › Call log › HubSpot: pick the ticket pipeline and stage, loaded from `GET /crm/v3/pipelines/tickets`.
- `checkHubSpot` also checks the tickets scope when Support mode is on.

**Done when:**
- unit tests with a fake `fetch` pass: ticket fields, priority, association, and errors for a missing scope;
- the UI test against the fake HubSpot server passes;
- you've checked it by hand with a real HubSpot test account.

---

## Step 6. Practice callers and the support scorecard

**Files:** `src/practice.js`, `src/main.js`, `src/ui/app.js`, `test/practice.test.js`, `test/ui.test.js`

**Do:**
- Add `SUPPORT_PERSONAS` (furious, confused, refund_demander, about_to_cancel), each with:
  - a macOS voice (check it's installed with `say -v '?'`);
  - a name that never matches the agent's;
  - a situation consistent with the sample knowledge base.
- Add a caller prompt `callerSystem()`, the support version of `prospectSystem()`. The caller hangs up after repeated stonewalling, or once the issue is resolved and they've said goodbye.
- Add a support `SCORE` prompt with parts: greeting and verification, understanding, resolution, tone, close. Flag any out-of-policy promise.
- The practice panel shows the personas for the current mode.

**Done when:**
- unit tests pass: caller prompt contents, line cleaning, and support scorecard parsing;
- the UI practice test passes in Support mode.

---

## Step 7. Support eval (needs API credits)

**Files:** new `test/support-eval.js`, a sample knowledge base inside it (for example, an online store: refunds within 30 days, shipping 3 to 5 days, escalation to a team lead within 1 business day)

**Do:** about 15 cases, mirroring `test/sales-eval.js`:
- greeting and verification;
- an angry opening;
- a refund inside the window, and one outside it;
- a cancellation, with and without a save offer in the knowledge base;
- where's my order, inside and past the limit;
- can't log in;
- a billing error;
- wants a manager;
- an unknown policy;
- the customer reads out a card number (redaction check);
- an abusive caller.

Each case is checked for:
- the shape and Stage line;
- at most one question;
- a Do line with at most one action;
- no policy facts that aren't in the knowledge base;
- no promises outside policy (refunds, credits, timelines);
- "not in knowledge base" noted when it should be;
- no digits of the card in anything sent.

A caller persona scores each reply 1 to 10.

**Done when:**
- `ANTHROPIC_API_KEY=… node test/support-eval.js` passes every rule check;
- the persona's average score is 7 or more;
- you've read every reply.

---

## Step 8. Simulated support calls (needs API credits)

**Files:** `scripts/simulate-call.mjs`

**Do:**
- Add `--mode support`, which uses:
  - the knowledge base;
  - the support personas;
  - the caller prompt;
  - the support record and scorecard.
- Run a card number through the speech path in one scenario (the caller reads it out) to test redaction end to end, after transcription.
- Print the redaction counts in the summary line.

**Done when:** two runs of each support persona (8 calls) show:
- an average score of 7 or more;
- zero out-of-policy promises (check the scorecard flag and read the transcripts);
- zero unredacted card digits in anything sent to the model;
- resolution or a correct escalation in at least 6 of 8 calls.

Fix the prompt from the scorecards' "work on" feedback and repeat. Compare against at least 8 calls each time, because single calls vary by about ±1 point.

---

## Step 9. Docs, screenshots, release

**Files:** `README.md`, `scripts/screenshots.mjs`, `docs/images/`, `package.json`

**Do:**
- Update the README:
  - Support mode features;
  - the knowledge base template;
  - the redaction section and its limits;
  - the support eval and simulation commands.
- Add Support screenshots: home, on a call with an upset customer, the wrap-up, and stats.
- Bump the version to 0.2.0.
- Run `npm test` (all unit and UI tests).
- Package, build the DMG, and publish a GitHub release so the updater finds it.

**Done when:**
- all tests pass;
- the release is on GitHub with the arm64 DMG;
- a fresh install updates from 0.1.0 to 0.2.0.

---

## Order and dependencies

```
1 Redaction ──────────────┐
2 Support style + KB ──┬──┼── 3 Support UI ── 4 Wrap-up, records, stats ── 5 HubSpot tickets
                       │  │
                       └──┴── 6 Practice callers ── 7 Support eval ── 8 Simulated calls ── 9 Release
```

- 1 and 2 can be done in parallel.
- 3 needs 2.
- 4 needs 3.
- 5 needs 4.
- 6 needs 2.
- 7 and 8 need 1, 2 and 6, and API credits.
- 9 comes last.

## Checklist

- [ ] 1. Redaction, with tests
- [ ] 2. Support style and knowledge base
- [ ] 3. Support UI
- [ ] 4. Wrap-up, records, stats
- [ ] 5. HubSpot tickets
- [ ] 6. Practice callers and scorecard
- [ ] 7. Support eval passes (needs credits)
- [ ] 8. Simulated support calls meet the targets (needs credits)
- [ ] 9. Docs, screenshots, release 0.2.0
