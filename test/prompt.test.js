import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, GATE, HUMAN_VOICE, splitKeys, summarizeSession, systemPrompt } from "../src/assistant.js";

test("about you and the product brief go with every style, word for word", () => {
  const about = "Sam Lee, account executive at Ledgerly.";
  const brief = "Ledgerly: AP automation for mid-market finance teams. $12 per user.";
  for (const style of ["sales", "brief", "natural"]) {
    const p = systemPrompt(style, "", about, brief);
    assert.ok(p.includes(`<about_user>\n${about}\n</about_user>`), style);
    assert.ok(p.includes(`<product_brief>\n${brief}\n</product_brief>`), style);
  }
  // Outside Sales mode, only for questions about the user or the product.
  assert.ok(systemPrompt("brief", "", about, brief).includes("Use only when a question is about the user"));
  assert.ok(!systemPrompt("sales", "", about, brief).includes("Use only when a question is about the user"));
  assert.ok(systemPrompt("sales", "", about, brief).includes("the only source for product facts"));
});

test("custom instructions come last so they win conflicts", () => {
  const p = systemPrompt("sales", "Answer in British English.", "about text", "brief text");
  assert.ok(p.indexOf("<user_instructions>") > p.indexOf("<product_brief>"));
});

test("Sales style leaves out the general rules that conflict with one-line spoken replies", () => {
  const p = systemPrompt("sales", "", "", "");
  for (const rule of ["State any assumption in one line", "what the main alternative would cost", "Never ask clarifying questions", "Coding problem"]) assert.ok(!p.includes(rule), rule);
  assert.ok(systemPrompt("brief", "", "", "").includes("State any assumption in one line"));
});

test("Sales style: short spoken line, facts only from the brief, no deception, do-not-call respected", () => {
  const p = systemPrompt("sales", "", "", "");
  assert.ok(p.includes("under 30 words"));
  assert.ok(p.includes("come only from the product brief"));
  assert.ok(p.includes("never invent"));
  assert.ok(p.includes("Never deceive"));
  assert.ok(p.includes("confirms they'll be removed"));
  assert.ok(p.includes("disclosure line"));
  for (const objection of ["Not interested", "Send me an email", "We already use X", "No budget", "Bad time", "Who is this?"]) assert.ok(p.includes(objection), objection);
});

test("no interview, exam or proctored-assessment rules remain", () => {
  for (const style of ["sales", "brief", "natural"]) {
    const p = systemPrompt(style, "", "", "");
    for (const word of [/proctored/i, /\binterview/i, /\bexams?\b/i, /\bresume\b/i]) assert.ok(!word.test(p), `${style}: ${word}`);
  }
});

test("every answer style and the notes prompt use the human voice", async () => {
  for (const style of ["brief", "natural", "sales"]) {
    assert.ok(systemPrompt(style, "", "", "").includes(HUMAN_VOICE), style);
  }
  let notesSystem = "";
  const provider = { name: () => "test", complete: ({ system }) => ((notesSystem = system), Promise.resolve({ text: "", usage: {}, stop: "end" })) };
  await summarizeSession(provider, "m", { transcript: [], answers: [] });
  assert.ok(notesSystem.includes(HUMAN_VOICE));
  assert.ok(notesSystem.includes("## Outcome"));
});

test("your details from setup go with every question", () => {
  const p = systemPrompt("brief", "", "", "", { name: "Johnson", company: "Ledgerly", role: "" });
  assert.ok(p.includes("<user_details>\nName: Johnson\nCompany: Ledgerly\n</user_details>"));
  assert.ok(!systemPrompt("brief", "", "", "", {}).includes("<user_details>"));
});

test("the Keys line is split off, and only near the top", () => {
  const answer = "**I led the billing migration.**\nKeys: billing migration · 40% fewer errors · staged rollout\n\nAt Acme Pay we…";
  assert.deepEqual(splitKeys(answer), { text: "**I led the billing migration.**\n\nAt Acme Pay we…", keys: ["billing migration", "40% fewer errors", "staged rollout"] });
  assert.deepEqual(splitKeys("**Hi.**\n\na\n\nb\n\nKeys: not this").keys, []);
  assert.deepEqual(splitKeys("**Yes.**\n\nKeys: · Proud of Acme work · Four weeks notice").keys, ["Proud of Acme work", "Four weeks notice"]); // stray leading dot
  assert.deepEqual(splitKeys("**Yes.**\n**Keys:** cache first · then shard").keys, ["cache first", "then shard"]); // bold label
  assert.deepEqual(splitKeys("To remap:\nKeys: Cmd+K opens search").keys, [], "an ordinary Keys: line stays");
  assert.equal(splitKeys("**A.**\n\nKeys: x · y\n\nBody.").text, "**A.**\n\nBody.", "no double gap left behind");
});

test("earlier answers drop their Keys line; what the user said replaces the suggestion", async () => {
  let sent = "";
  const provider = { name: () => "x", stream: ({ parts }) => ((sent = parts.at(-1).text), { done: Promise.resolve({ text: "", usage: {}, stop: "end" }), abort() {} }) };
  const previous = [
    { question: "Tell me about a project.", answer: "**The billing migration.**\nKeys: billing · Postgres · 40%\n\nWe moved billing to Postgres." },
    { question: "Why Postgres?", answer: "**Transactions.**\n\nIt gave us real transactions.", said: "I talked about the team knowing Postgres already" },
  ];
  await ask({ provider, model: "m", question: "", transcript: [], previous, screenshots: [], effort: "low", style: "sales", onText() {} }).done;
  assert.ok(!sent.includes("Keys:"), sent);
  assert.match(sent, /A \(user said this instead of the suggestion\): .*team knowing Postgres/);
  assert.ok(!sent.includes("It gave us real transactions"));
});

test("an answer cut short is marked as such for follow-ups", async () => {
  let sent = "";
  const provider = { name: () => "x", stream: ({ parts }) => ((sent = parts.at(-1).text), { done: Promise.resolve({ text: "", usage: {}, stop: "end" }), abort() {} }) };
  const previous = [{ question: "Walk me through the migration.", answer: "**We moved billing to Postgres.**\n\nFirst we", stopped: true }];
  await ask({ provider, model: "m", question: "", transcript: [], previous, screenshots: [], effort: "low", style: "sales", onText() {} }).done;
  assert.match(sent, /First we \[stopped before the end\]/);
});

test("a gated ask adds the turn check to the user message and leaves the system prompt alone", () => {
  const sent = (gated) => {
    let params;
    const provider = { name: () => "test", stream: (p) => ((params = p), { done: new Promise(() => {}), abort() {} }) };
    ask({ provider, model: "m", question: "Hi, I'm Abby, welcome to the call.", transcript: [], previous: [], screenshots: [], effort: "low", style: "sales", customInstructions: "Be warm.", resume: "Jane Doe", productBrief: "Engineer", gated, onText() {} });
    return params;
  };
  const gated = sent(true);
  const plain = sent(false);
  assert.equal(gated.system, plain.system, "system prompt byte-identical, so the cache keeps working");
  assert.ok(!gated.system.includes("<none>"));
  const text = gated.parts.at(-1).text;
  assert.ok(text.endsWith(GATE), text);
  assert.match(GATE, /reply exactly <none> and nothing else/);
  assert.match(text, /Prospect's latest turn: Hi, I'm Abby/);
  assert.ok(!plain.parts.at(-1).text.includes("<none>"));
  assert.ok(!plain.parts.at(-1).text.includes(GATE));
  assert.match(plain.parts.at(-1).text, /Prospect said \(or rep typed\): Hi, I'm Abby/);
});

test("isNoAnswer: the skip reply in the formats models use, never a real answer", async () => {
  const { isNoAnswer } = await import("../src/assistant.js");
  for (const t of ["<none>", " <none>", "`<none>`", '"<none>"', "**<none>**", "<None>", "< none >", "<none> "]) assert.equal(isNoAnswer(t), true, t);
  for (const t of ["None.", "none", "(none)", "None!"]) {
    assert.equal(isNoAnswer(t, true), true, `${t} (whole reply)`);
    assert.equal(isNoAnswer(t, false), false, `${t} (still streaming)`);
  }
  for (const t of ["None of my previous roles used Kafka", "Nonetheless, I", "I led the migration", ""]) assert.equal(isNoAnswer(t, true), false, t);
});

test("sales replies end with a Stage line: read for the console, dropped everywhere else", async () => {
  const { takeStage } = await import("../src/assistant.js");
  assert.deepEqual(takeStage("**Fair enough.**\nAsk: what do you use today?\n\nStage: objection"), { text: "**Fair enough.**\nAsk: what do you use today?", stage: "objection" });
  assert.deepEqual(takeStage("**Hi.**\n**Stage:** Opener."), { text: "**Hi.**", stage: "opener" });
  assert.equal(takeStage("The stage: was set").stage, null);
  assert.equal(splitKeys("**Yes.**\n\nStage: close").text, "**Yes.**", "previous answers and notes never carry it");
  assert.match(systemPrompt("sales", "", "", ""), /Last line always: "Stage: "/);
});

test("the rep drives the call: opener, pitch and the meeting ask on request, the rep's own script used", () => {
  const p = systemPrompt("sales", "", "", "");
  assert.match(p, /"Rep asks: … opener": the opener: .*what the company does for people like them in one plain line/);
  assert.match(p, /permission ask that gives an out/);
  assert.match(p, /"Rep asks: … pitch": the pitch now/);
  assert.match(p, /"Rep asks: … ask for the meeting"/);
  assert.match(p, /rep's own opener or pitch written out: use it nearly word for word/);
});

test("the sales prompt sells honestly: their problem first, one proof point, quantified pain, a small specific ask", () => {
  const p = systemPrompt("sales", "", "", "");
  for (const rule of ["Their world, not ours", "one concrete result from the brief", "ask what it costs them", "two time options", "ends by moving forward", "Never invent a number, a customer or a result", "false familiarity"]) assert.ok(p.includes(rule), rule);
  for (const banned of ['"how are you today"', '"just checking in"', '"does that make sense?"', '"sorry to bother you"']) assert.ok(p.includes(banned), banned);
});
