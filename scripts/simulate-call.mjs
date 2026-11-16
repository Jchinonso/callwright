// Simulates a whole cold call through Dialpal's real pipeline, with no
// microphone and no phone:
//   prospect (the practice role-play model) -> spoken by a macOS voice ->
//   transcribed by the real Parakeet model -> question/objection detection ->
//   the Sales reply the rep would read -> ... -> call record and scorecard.
// The rep "says" each bold line exactly as shown. Needs the speech model
// (open Dialpal once) and an Anthropic key:
//   ANTHROPIC_API_KEY=… node scripts/simulate-call.mjs [persona] [turns]
// persona: busy | skeptical | curious | gatekeeper (default skeptical).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { Asr } from "../src/asr.js";
import { callNames, USER_BOOST } from "../src/hotwords.js";
import { Segmenter } from "../src/audio.js";
import { ask, takeStage } from "../src/assistant.js";
import { extractRecord, OBJECTIONS, OUTCOMES } from "../src/calls.js";
import { MODEL } from "../src/models.js";
import { cleanProspectLine, PERSONAS, prospectSystem, prospectUser, scorePractice } from "../src/practice.js";
import { createProvider, DEFAULT_ANTHROPIC_MODEL } from "../src/providers.js";

const persona = PERSONAS[process.argv[2]] ? process.argv[2] : "skeptical";
const maxTurns = Number(process.argv[3]) || 8;
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY.");
  process.exit(1);
}
const modelDir = path.join(os.homedir(), "Library", "Application Support", "Dialpal", "models", MODEL.dir);
const model = DEFAULT_ANTHROPIC_MODEL;
const llm = createProvider({ provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY });
const tmp = mkdtempSync(path.join(os.tmpdir(), "dialpal-call-"));

// The detector the window uses (a browser script), run here as-is.
const ctx = vm.createContext({});
vm.runInContext(`${readFileSync(new URL("../src/ui/questions.js", import.meta.url), "utf8")}\nthis.isQuestion = isQuestion; this.isObjection = isObjection;`, ctx);

const BRIEF = `Company: Ledgerly. We help finance teams stop chasing invoices by hand.
Product: accounts-payable automation. Reads invoices, matches them to purchase orders, routes approvals.
Who it's for: controllers and AP managers at 200-2,000 person companies on NetSuite or QuickBooks.
Problem it solves: AP teams spend hours a week matching invoices to POs by hand, miss early-payment discounts, and pay duplicates.
Proof: Brightline (logistics, 600 people) cut invoice processing time 62% in the first quarter.
Pricing: from $12 per user per month, annual only.
Competitors: Bill.com (we match POs automatically; their base plan doesn't).
Lead source: LinkedIn, finance leaders at companies that use NetSuite.
Meeting to book: 20-minute demo with Priya, our solutions engineer.
Times you can offer: Tuesday 10am, Wednesday 2pm, Thursday 11am.
Disclosure line: Heads up, this call is transcribed.`;
const PROFILE = { name: "Sam Lee", company: "Ledgerly", role: "Account executive", email: "sam@ledgerly.com", phone: "512 555 0142" };
const p = PERSONAS[persona];
const TARGET = { name: p.name, company: "Northwind Freight", role: persona === "gatekeeper" ? "Executive assistant to the CFO" : "Controller", notes: "Moved to NetSuite last quarter; hiring a second AP clerk (job post on LinkedIn)." };

// Speaks text with a macOS voice into 16 kHz mono int16 PCM, as the Mac's
// audio would arrive from a call.
function speakToPcm(text, voice) {
  const aiff = path.join(tmp, "line.aiff");
  const wav = path.join(tmp, "line.wav");
  execFileSync("/usr/bin/say", ["-v", voice, "-r", "180", "-o", aiff, text]);
  execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const buf = readFileSync(wav);
  const at = buf.indexOf("data") + 8; // the PCM after the WAV header's data chunk
  return buf.subarray(at);
}

// The call audio as Dialpal hears it: cut into phrases by the same
// segmenter, then transcribed by Parakeet.
async function hear(pcm, asr) {
  const seg = new Segmenter();
  const pieces = [];
  seg.on("segment", (s) => pieces.push(s));
  const silence = Buffer.alloc(16000 * 2); // a second of quiet before and after
  seg.push(silence);
  for (let i = 0; i < pcm.length; i += 3200) seg.push(pcm.subarray(i, i + 3200));
  seg.push(silence);
  seg.flush?.();
  const lines = [];
  for (const s of pieces) {
    const r = await asr.transcribe(s, { hotwords: HOTWORDS });
    if (r?.text?.trim()) lines.push(r.text.trim());
  }
  return lines;
}

const words = (t) => t.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
function wordErrorRate(ref, hyp) {
  const a = words(ref);
  const b = words(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return a.length ? d[a.length][b.length] / a.length : 0;
}

async function reply(question, transcript, previous) {
  const started = Date.now();
  let first = null;
  const { done } = ask({ provider: llm, model, question, transcript, previous, screenshots: [], effort: "low", style: "sales", customInstructions: "", resume: "", productBrief: BRIEF, profile: PROFILE, target: TARGET, onText: () => (first ??= Date.now() - started) });
  const { result } = await done;
  const { text, stage } = takeStage(result.text.trim());
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const say = lines[0]?.replace(/^\*\*|\*\*$/g, "") || "";
  const then = lines.find((l) => /^ask:/i.test(l))?.replace(/^ask:\s*/i, "") || "";
  const note = lines.find((l) => /^\*[^*].*\*$/.test(l)) || "";
  return { raw: result.text, say, then, note, stage, firstMs: first, totalMs: Date.now() - started };
}

// The same hint words the app gives Parakeet: names from the brief, the
// prospect and the rep.
const HOTWORDS = callNames({ brief: BRIEF, target: TARGET, profile: PROFILE }).map((phrase) => ({ phrase, boost: USER_BOOST }));
const asr = new Asr({ modelDir });
const loadStart = Date.now();
await asr.load({ hotwords: HOTWORDS });
console.log(`\nSpeech model loaded in ${Date.now() - loadStart} ms. Persona: ${p.label} (${p.name}, voice ${p.voice}). Calling ${TARGET.name}, ${TARGET.role} at ${TARGET.company}.\n`);

const transcript = []; // what Dialpal has: the prospect as heard, the rep as said
const previous = []; // the rep's lines, as the app keeps them
const wers = [];
let hungUp = false;
const show = (who, text) => console.log(`${who.padEnd(10)} ${text}`);

// Start call: the opener appears before the prospect says anything...
let r = await reply("Rep asks: the call just connected. Give my opener now.", transcript, previous);
// ...but on a real call the prospect answers the phone first.
const roleplay = (opening) => llm.complete({ model, system: prospectSystem({ persona, productBrief: BRIEF, company: TARGET.company }), user: prospectUser(transcript.map((l) => ({ role: l.role, text: l.text })), { opening }), maxTokens: 300, effort: "low" });
const greeting = cleanProspectLine((await roleplay(true)).text).text;
const greetPcm = speakToPcm(greeting, p.voice);
const greetHeard = (await hear(greetPcm, asr)).join(" ");
transcript.push({ role: "them", text: greetHeard, at: Date.now(), start: Date.now() });
show(p.name.split(" ")[0], `${greeting}`);
show("  heard", `${greetHeard}  (WER ${(100 * wordErrorRate(greeting, greetHeard)).toFixed(0)}%)`);
r = await reply(greetHeard, transcript, previous);
console.log("");

for (let turn = 1; turn <= maxTurns && !hungUp; turn++) {
  show("Sam", `${r.say}${r.then ? `  [then ask: ${r.then}]` : ""}`);
  console.log(`${"".padEnd(10)} stage=${r.stage ?? "?"}  first words in ${r.firstMs} ms, done in ${r.totalMs} ms${r.note ? `  note: ${r.note}` : ""}`);
  const said = [r.say, r.then].filter(Boolean).join(" ");
  previous.push({ question: transcript.at(-1)?.text || "", answer: r.raw });
  transcript.push({ role: "me", text: said, at: Date.now(), start: Date.now() });

  const out = cleanProspectLine((await roleplay(false)).text);
  hungUp = out.hungUp;
  if (!out.text) break;
  const pcm = speakToPcm(out.text, p.voice);
  const heardLines = await hear(pcm, asr);
  const heardText = heardLines.join(" ");
  const wer = wordErrorRate(out.text, heardText);
  wers.push(wer);
  const tag = ctx.isObjection(heardText) ? "OBJECTION" : ctx.isQuestion(heardText) ? "question" : "statement";
  transcript.push({ role: "them", text: heardText, at: Date.now(), start: Date.now() });
  console.log("");
  show(p.name.split(" ")[0], out.text);
  show("  heard", `${heardText}  (${tag}, WER ${(100 * wer).toFixed(0)}%)`);
  if (hungUp) {
    console.log(`\n${p.name} hung up.`);
    break;
  }
  r = await reply(heardText, transcript, previous);
  console.log("");
}

console.log("\n--- After the call ---");
const answers = previous.map((x) => ({ answer: x.answer }));
const [record, card] = await Promise.all([
  extractRecord(llm, model, { transcript, answers }).catch((e) => ({ error: e.message })),
  scorePractice(llm, model, { transcript, productBrief: BRIEF }).catch((e) => ({ error: e.message })),
]);
if (record.error) console.log(`Call record failed: ${record.error}`);
else {
  console.log(`Outcome: ${OUTCOMES[record.outcome]}${record.meeting ? ` (${record.meeting})` : ""}`);
  console.log(`Objections: ${record.objections.map((o) => `${OBJECTIONS[o.type]}${o.handled ? " (handled)" : ""}`).join("; ") || "none"}`);
  console.log(`Next step: ${record.nextStep ?? "none"}`);
}
if (card.error) console.log(`Scorecard failed: ${card.error}`);
else {
  console.log(`Score: ${card.score}/10  opener ${card.opener.score}/5, discovery ${card.discovery.score}/5, objections ${card.objections.score}/5, close ${card.close.score}/5`);
  for (const i of card.improve) console.log(`  work on: ${i}`);
}
const avgWer = wers.length ? (100 * wers.reduce((a, b) => a + b, 0)) / wers.length : 0;
console.log(`Speech: ${wers.length} prospect turns, average word error ${avgWer.toFixed(0)}%.`);
// One line for comparing runs (scripts that batch personas grep for it).
console.log(`SUMMARY ${JSON.stringify({ persona, score: card.score ?? null, parts: card.error ? null : [card.opener.score, card.discovery.score, card.objections.score, card.close.score], booked: card.booked ?? null, outcome: record.outcome ?? null, wer: Math.round(avgWer) })}`);
asr.stop();
rmSync(tmp, { recursive: true, force: true });
