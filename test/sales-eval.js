// Real-model check of Sales replies: does each line follow the rules, and
// would it make a busy buyer want the meeting? Not part of npm test (it
// calls a paid API). Run with your own key:
//   ANTHROPIC_API_KEY=… node test/sales-eval.js [model]
//   EVAL_PROVIDER=openai EVAL_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=… node test/sales-eval.js anthropic/claude-sonnet-5.5
//   EVAL_ONLY="opener|budget" node test/sales-eval.js     (a subset, by name)
// Prints each reply, the checks it failed, and a 1-10 buyer score. Read the
// replies too: checks can't judge everything.
import { ask, takeStage } from "../src/assistant.js";
import { createProvider, DEFAULT_ANTHROPIC_MODEL } from "../src/providers.js";

const BRIEF = `Company: Ledgerly. We help finance teams stop chasing invoices by hand.
Product: accounts-payable automation. Reads invoices, matches them to purchase orders, routes approvals.
Who it's for: controllers and AP managers at 200-2,000 person companies on NetSuite or QuickBooks.
Problem it solves: AP teams spend hours a week matching invoices to POs by hand, miss early-payment discounts, and pay duplicates.
Proof: Brightline (logistics, 600 people) cut invoice processing time 62% in the first quarter.
Pricing: from $12 per user per month, annual only.
Competitors: Bill.com (we match POs automatically; their base plan doesn't).
Lead source: LinkedIn, finance leaders at companies that use NetSuite.
Meeting to book: 20-minute demo with Priya, our solutions engineer.
Disclosure line: Heads up, this call is transcribed.`;
const PROFILE = { name: "Sam Lee", company: "Ledgerly", role: "Account executive" };
const them = (text) => ({ role: "them", text, at: Date.now(), start: Date.now() });

const CASES = [
  { name: "opener", question: "Rep asks: the call just connected. Give my opener now.", transcript: [], expect: ["opener"] },
  { name: "opener after hello", question: "Hi, this is Dana.", transcript: [them("Hi, this is Dana.")], expect: ["opener"] },
  { name: "pitch on request", question: "Rep asks: give my pitch now.", transcript: [them("Hi, this is Dana."), them("Okay, sure, you've got 30 seconds.")], previous: [{ question: "Hi, this is Dana.", answer: "**Hi Dana, it's Sam from Ledgerly. Heads up, this call is transcribed. We help finance teams stop chasing invoices by hand. Can I take 30 seconds to tell you why I called?**" }], expect: ["pitch"] },
  { name: "not interested", question: "Look, we're not interested.", transcript: [them("Look, we're not interested.")], expect: ["forward"] },
  { name: "send email", question: "Just send me an email.", transcript: [them("Just send me an email.")], expect: ["forward"] },
  { name: "competitor", question: "We already use Bill.com.", transcript: [them("We already use Bill.com.")], expect: ["forward", "noKnock"] },
  { name: "budget", question: "There's no budget for this right now.", transcript: [them("There's no budget for this right now.")], expect: ["forward"] },
  { name: "price question", question: "What does it cost?", transcript: [them("What does it cost?")], expect: ["forward", "price"] },
  { name: "unknown fact", question: "Does it integrate with SAP?", transcript: [them("Does it integrate with SAP?")], expect: ["notInBrief"] },
  { name: "bad time", question: "I'm driving, bad time.", transcript: [them("I'm driving, bad time.")], expect: ["forward", "twoTimes"] },
  { name: "who is this", question: "Who is this? How did you get my number?", transcript: [them("Who is this? How did you get my number?")], expect: ["forward", "source"] },
  { name: "pain stated", question: "Honestly matching POs takes my team most of Friday.", transcript: [them("Honestly matching POs takes my team most of Friday.")], expect: ["forward"] },
  { name: "close on request", question: "Rep asks: give my ask for the meeting now.", transcript: [them("Matching POs takes my team most of Friday."), them("Yeah, it's a pain.")], expect: ["twoTimes"] },
  { name: "do not call", question: "Take me off your list.", transcript: [them("Take me off your list.")], expect: ["dnc"], noJudge: true },
];

const BANNED = [/how are you today/i, /just checking in/i, /does that make sense/i, /\bsorry\b/i, /great question/i, /to be honest/i, /i totally understand/i, /i'd love to/i];
const STAGES = new Set(["opener", "pitch", "discovery", "objection", "close"]);

function checks(c, raw) {
  const fails = [];
  const { text, stage } = takeStage(raw);
  if (!stage || !STAGES.has(stage)) fails.push("no valid Stage line");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bold = lines[0]?.match(/^\*\*(.+)\*\*$/)?.[1];
  if (!bold) fails.push("first line isn't bold");
  const ask = lines.find((l) => /^ask:/i.test(l))?.replace(/^ask:\s*/i, "") || "";
  const spoken = `${bold || ""} ${ask}`;
  const words = (bold || "").split(/\s+/).filter(Boolean).length;
  const limit = c.expect.includes("pitch") ? 50 : c.expect.includes("opener") || /close/.test(c.name) ? 40 : 32;
  if (words > limit) fails.push(`bold line is ${words} words (limit ${limit})`);
  for (const b of BANNED) if (b.test(spoken)) fails.push(`banned phrase ${b}`);
  // Every number said aloud must come from the brief.
  // Times and durations ("30 seconds", "at 10", "2pm") are the rep's own.
  const facts = spoken.replace(/\b\d+\s*(?:seconds?|minutes?|mins?|am|pm|o'clock)\b|\b(?:at|by|around)\s+\d{1,2}(?::\d{2})?\b|\b\d{1,2}:\d{2}\b/gi, "");
  for (const n of facts.match(/\$?\d[\d,.]*%?/g) || []) if (!BRIEF.includes(n.replace(/[.,]$/, ""))) fails.push(`number not in brief: ${n}`);
  if ((spoken.match(/\?/g) || []).length > 1) fails.push("stacks questions (more than one ?)");
  if (/\b(as we discussed|following up on our)\b/i.test(spoken)) fails.push("false familiarity");
  const exp = new Set(c.expect);
  if (exp.has("forward") && !spoken.includes("?")) fails.push("doesn't end moving forward (no question or ask)");
  if (exp.has("opener")) {
    if (!/sam/i.test(spoken) || !/ledgerly/i.test(spoken)) fails.push("opener doesn't say who's calling");
    if (!/transcribed/i.test(spoken)) fails.push("opener misses the disclosure line");
    if (!spoken.includes("?")) fails.push("opener has no permission ask");
  }
  if (exp.has("pitch") && !/62%/.test(spoken)) fails.push("pitch has no proof point");
  if (exp.has("price") && !/\$12/.test(spoken)) fails.push("price not from the brief");
  if (exp.has("source") && !/linkedin/i.test(spoken)) fails.push("doesn't say where their details came from");
  if (exp.has("noKnock") && /\b(worse|terrible|bad|clunky|outdated)\b/i.test(spoken)) fails.push("knocks the competitor");
  if (exp.has("notInBrief") && !/not in brief/i.test(text)) fails.push("no 'not in brief' note for an unknown fact");
  if (exp.has("notInBrief") && /\byes\b.*\bsap\b|integrates? with sap/i.test(bold || "")) fails.push("claims an SAP integration");
  if (exp.has("twoTimes") && !/(monday|tuesday|wednesday|thursday|friday|tomorrow|morning|afternoon|\d\s?(am|pm))[\s\S]*\bor\b/i.test(spoken)) fails.push("no two time options");
  if (exp.has("dnc")) {
    if (spoken.includes("?")) fails.push("do-not-call reply still asks something");
    if (!/remove|off (?:the|our|your) list|won't call/i.test(spoken)) fails.push("do-not-call not confirmed");
  }
  return { fails, spoken, stage };
}

const JUDGE = `You are a busy B2B buyer (a finance controller) who gets cold calls every week and usually says no. Rate the rep's line below, said to you at this point in the call: how likely does it make you to keep talking and eventually agree to a short meeting? 1 = I'd hang up, 10 = I'd agree to the meeting. Judge relevance to you, clarity, honesty, brevity and whether it respects your time. Reply with only JSON: {"score": n, "why": "under 20 words"}`;

const providerName = process.env.EVAL_PROVIDER || "anthropic";
const model = process.argv[2] || (providerName === "openai" ? process.env.EVAL_MODEL : DEFAULT_ANTHROPIC_MODEL);
const provider = createProvider(providerName === "openai"
  ? { provider: "openai", apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.EVAL_BASE_URL || "https://api.openai.com/v1", model }
  : { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY });
if (providerName === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY (or EVAL_PROVIDER=openai with OPENAI_API_KEY and EVAL_BASE_URL).");
  process.exit(1);
}

const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY, "i") : null;
let failed = 0;
const scores = [];
for (const c of CASES.filter((c) => !only || only.test(c.name))) {
  const { done } = ask({ provider, model, question: c.question, transcript: c.transcript, previous: c.previous || [], screenshots: [], effort: "low", style: "sales", customInstructions: "", resume: "", productBrief: BRIEF, profile: PROFILE, onText() {} });
  const { result, problem } = await done;
  const reply = result.text.trim();
  const { fails, spoken, stage } = checks(c, reply);
  let judged = null;
  if (!c.noJudge) try {
    const j = await provider.complete({ model, system: JUDGE, user: `Call so far (prospect only): ${c.transcript.map((l) => l.text).join(" / ") || "(just connected)"}\n\nRep says: ${spoken}`, maxTokens: 200, effort: "low" });
    judged = JSON.parse(j.text.slice(j.text.indexOf("{"), j.text.lastIndexOf("}") + 1));
    scores.push(judged.score);
  } catch {}
  if (fails.length || problem) failed++;
  console.log(`\n${fails.length || problem ? "✖" : "✔"} ${c.name}  stage=${stage ?? "none"}  buyer=${judged?.score ?? "?"}/10${judged?.why ? ` (${judged.why})` : ""}`);
  console.log(reply.split("\n").map((l) => `   ${l}`).join("\n"));
  for (const f of [...fails, ...(problem ? [problem] : [])]) console.log(`   ✖ ${f}`);
}
const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "?";
console.log(`\n${failed ? `${failed} case(s) failed a check` : "All checks passed"}. Average buyer score ${avg}/10 over ${scores.length}.`);
process.exit(failed ? 1 : 0);
