import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanProspectLine, HANG_UP, parseScorecard, PERSONAS, prospectSystem, prospectUser, scorecardMarkdown, scorePractice } from "../src/practice.js";
import { MicListener } from "../src/audio.js";

test("the prospect prompt carries the persona, the brief, and the hang-up rule", () => {
  const p = prospectSystem({ persona: "busy", productBrief: "Ledgerly: AP automation.", company: "Brightline" });
  assert.match(p, /You are Dana Reyes/);
  assert.match(p, /at Brightline/);
  assert.match(p, /Ledgerly: AP automation\./);
  assert.ok(p.includes(HANG_UP));
  assert.match(prospectSystem({ persona: "nope" }), new RegExp(PERSONAS.skeptical.name), "unknown persona falls back");
  assert.match(prospectUser([], { opening: true }), /phone rings/);
  assert.match(prospectUser([{ role: "them", text: "Hello?" }, { role: "me", text: "Hi Dana, it's Sam from Ledgerly." }]), /you: Hello\?\nrep: Hi Dana, it's Sam from Ledgerly\./);
});

test("prospect lines are cleaned to speech and hang-ups are caught", () => {
  assert.deepEqual(cleanProspectLine('Dana: "Look, I\'m slammed." *sighs*'), { text: "Look, I'm slammed.", hungUp: false });
  assert.deepEqual(cleanProspectLine(`Fine, Tuesday at two. Bye. ${HANG_UP}`), { text: "Fine, Tuesday at two. Bye.", hungUp: true });
  assert.deepEqual(cleanProspectLine(HANG_UP), { text: "", hungUp: true });
  assert.deepEqual(cleanProspectLine("(pause) Uh, who is this?"), { text: "Uh, who is this?", hungUp: false });
});

test("scorecards are parsed, clamped and rendered", async () => {
  const card = parseScorecard('{"score": 12, "opener": {"score": 4, "note": "Clear reason."}, "discovery": {"score": 0}, "objections": {"score": 3, "note": "x"}, "close": {"score": 2, "note": "y"}, "booked": true, "talk_ratio": 64, "strengths": ["a", "b", "c"], "improve": ["Ask one question at a time."], "best_line": "Fair enough.", "try_instead": {"rep_said": "Can I have 30 minutes?", "better": "Worth 20 minutes Tuesday?"}}');
  assert.equal(card.score, 10);
  assert.equal(card.discovery.score, 1);
  assert.deepEqual(card.strengths, ["a", "b"]);
  assert.equal(card.talkRatio, 64);
  const md = scorecardMarkdown(card);
  assert.match(md, /## Scorecard: 10\/10 · meeting booked/);
  assert.match(md, /\| Opener \| 4\/5 \| Clear reason\. \|/);
  assert.match(md, /\*\*Instead of\*\* "Can I have 30 minutes\?", \*\*try\*\* "Worth 20 minutes Tuesday\?"/);
  assert.equal(parseScorecard('{"opener": {}}'), null, "no overall score");
  const provider = { name: () => "x", complete: async ({ user }) => ({ text: user.includes("rep: Hi") ? '{"score": 5}' : "", usage: {}, stop: "end" }) };
  assert.equal((await scorePractice(provider, "m", { transcript: [{ role: "me", text: "Hi" }] })).score, 5);
});

test("MicListener: the rep's phrases become 'me' lines; muted audio is dropped", async () => {
  const asr = { transcribe: async (pcm) => ({ text: `heard ${pcm.length > 0}`, ms: 1 }) };
  const mic = new MicListener({ asr });
  const lines = [];
  mic.on("line", (l) => lines.push(l));
  assert.equal(mic.start(), true);
  const loud = Buffer.alloc(480 * 2 * 40);
  for (let i = 0; i < loud.length; i += 2) loud.writeInt16LE(i % 4 ? 9000 : -9000, i);
  const quiet = Buffer.alloc(480 * 2 * 30);
  mic.setMuted(true);
  mic.push(loud);
  mic.push(quiet);
  mic.setMuted(false);
  for (let i = 0; i < 20; i++) mic.push(Buffer.alloc(480 * 2 * 10)); // settle the noise floor
  mic.push(loud);
  mic.push(quiet);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].role, "me");
  mic.stop();
  const noModel = new MicListener({ asr: null });
  const errors = [];
  noModel.on("error", (e) => errors.push(e));
  assert.equal(noModel.start(), false);
  assert.match(errors[0], /speech model is missing/);
});
