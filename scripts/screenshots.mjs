// Regenerates the README screenshots in docs/images/: runs Dialpal in test mode
// (its own settings folder, no keychain) with a made-up profile and a fake
// OpenAI-compatible model, walks through the main screens and captures each.
//   node scripts/screenshots.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { MODEL } from "../src/models.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.env.SHOTS_DIR || path.join(root, "docs", "images");
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESUME = `Sam Lee, account executive at Ledgerly. Based in Austin. Works with finance teams at 200-2,000 person companies.`;
const JOB = `Product: Ledgerly, accounts-payable automation. Reads invoices, matches them to POs, routes approvals.
Who it's for: controllers and AP managers at mid-market companies on NetSuite or QuickBooks.
Proof: Brightline cut invoice processing time 62% in the first quarter.
Pricing: from $12 per user per month; annual only.
Competitors: Bill.com (we match POs automatically; they don't on the base plan).
Meeting to book: 20-minute demo with Priya, our solutions engineer.`;
const ANSWER = `**Totally fair. Out of curiosity, how are invoices getting matched to POs today, by hand or in Bill.com?**

Ask: If it's mostly by hand, would a 20-minute look at how Brightline cut that time by 62% be worth it?

*Bill.com doesn't auto-match POs on its base plan. Keep that for if they say they use it.*`;

const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", async () => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const piece of ANSWER.match(/[\s\S]{1,40}/g)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5214, completion_tokens: 318 } })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const dir = mkdtempSync(path.join(os.tmpdir(), "dialpal-shots-"));
writeFileSync(path.join(dir, "config.json"), JSON.stringify({ provider: "openai", openaiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, openaiModel: "gpt-4o", autoScreen: false, style: "sales", invisible: true, resume: RESUME, productBrief: JOB, profileName: "Sam Lee" }));
// The speech model is already installed, so setup goes straight past its step:
// a stand-in (the real tokens.txt and a tiny encoder), with a stand-in engine
// (DIALPAL_TEST_ASR), as in the UI tests, so the real 660 MB isn't needed.
const modelDir = path.join(dir, "models", MODEL.dir);
mkdirSync(modelDir, { recursive: true });
copyFileSync(path.join(root, "test", "fixtures", "parakeet-tokens.txt"), path.join(modelDir, "tokens.txt"));
writeFileSync(path.join(modelDir, "encoder.int8.onnx"), "stand-in");
const standInFiles = ["encoder.int8.onnx", "tokens.txt"].map((name) => {
  const data = readFileSync(path.join(modelDir, name));
  return { name, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
});
const standIn = { DIALPAL_TEST_MODEL_FILES: JSON.stringify(standInFiles), DIALPAL_TEST_ASR: path.join(root, "test", "fixtures", "fake-asr.mjs") };
const port = 9900 + Math.floor(Math.random() * 90);
const app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, "--force-device-scale-factor=2"], { env: { ...process.env, DIALPAL_TEST_DIR: dir, ANTHROPIC_API_KEY: "sk-ant-placeholder-1234", ...standIn }, stdio: "ignore" });

let page;
for (let i = 0; i < 100 && !page; i++) {
  await sleep(100);
  try {
    page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  waiting.get(d.id)?.(d);
};
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (js) => (await cdp("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
const until = async (js) => { for (let i = 0; i < 100 && !(await run(`return !!(${js});`)); i++) await sleep(50); };
async function shot(name) {
  await sleep(500); // let the window fit its content
  const { result } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(result.data, "base64"));
  console.log(`docs/images/${name}.png`);
}

await until(`typeof state !== "undefined" && state.shortcuts`);
await shot("welcome");
await run(`document.getElementById("obNext").click();`);
await shot("setup-about");
await run(`document.getElementById("onboardSkip").click();`);
await until(`!onboarding`);
await run(`askingJob = true; render();`);
await shot("new-call-block");
await run(`document.getElementById("jdSame").click();`);

// Listening, with a question split by pauses joined back together.
const now = Date.now();
await run(`
  state.listening = true; state.listeningSince = Date.now() - 754000;
  stillHearing = async () => true; // keep auto-answer from firing for this shot
  onTranscript({ role: "them", text: "Okay, Ledgerly.", start: ${now - 9000}, at: ${now - 8000} });
  onTranscript({ role: "them", text: "Look, honestly we're not interested, we've got a process for invoices already.", start: ${now - 3000}, at: ${now} });
`);
await shot("question-heard");

await run(`stillHearing = async () => false; document.getElementById("answerQBtn").click();`);
await until(`answers.length && answers.at(-1).status === "done"`);
await run(`state.listening = true; pendingQuestion = null; renderStrip(); document.getElementById("stage").scrollTop = 0;`);
await shot("sales-reply");

await run(`document.getElementById("viewToggle").click();`);
await shot("key-points");
await run(`document.getElementById("viewToggle").click();`);

await run(`document.getElementById("modeBtn").click();`);
await shot("mode-menu");
await run(`setModeMenu(false);`);

await run(`document.getElementById("menuBtn").click(); document.querySelector('#settingsTabs [data-tab="interview"]').click();`);
await shot("settings-sales");
// Shown with Anthropic selected (placeholder key; nothing is sent).
await run(`await g.setSetting("provider", "anthropic"); await g.setSetting("model", "claude-sonnet-5-5"); document.querySelector('#settingsTabs [data-tab="answers"]').click();`);
await shot("settings-answers");
await run(`document.querySelector('#settingsTabs [data-tab="general"]').click(); document.getElementById("stage").scrollTop = 0;`);
await shot("settings-general");
await run(`document.querySelector('#settingsTabs [data-tab="about"]').click(); document.getElementById("stage").scrollTop = 0;`);
await shot("settings-about");
await run(`setMenu(false);`);

await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await shot("light-mode");

ws.close();
await new Promise((r) => (app.once("exit", r), app.kill()));
rmSync(dir, { recursive: true, force: true });

// The speech model step, part-way through: a separate run with no model, and a
// local server that sends about 40% of the file and then holds the connection.
const speechDir = mkdtempSync(path.join(os.tmpdir(), "dialpal-shots-speech-"));
writeFileSync(path.join(speechDir, "config.json"), JSON.stringify({ provider: "openai", openaiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, openaiModel: "gpt-4o", autoScreen: false, style: "sales", invisible: true, resume: RESUME, productBrief: JOB, profileName: "Sam Lee" }));
// The encoder is the first and largest file: hold at about 40% of it.
const holdAfter = Math.floor(MODEL.files[0].size * 0.4);
const held = [];
const modelServer = http.createServer((req, res) => {
  req.resume();
  req.on("end", async () => {
    res.on("error", () => {});
    res.writeHead(200, { "content-type": "application/octet-stream" });
    held.push(res);
    const chunk = Buffer.alloc(1_000_000);
    let sent = 0;
    while (sent < holdAfter && !res.destroyed) {
      const n = Math.min(chunk.length, holdAfter - sent);
      if (!res.write(chunk.subarray(0, n))) await new Promise((r) => res.once("drain", r));
      sent += n;
      await sleep(8);
    }
    // Hold the connection open so the progress bar stays part-way.
  });
});
await new Promise((r) => modelServer.listen(0, "127.0.0.1", r));
const speechPort = 9900 + Math.floor(Math.random() * 90);
const speechApp = spawn(electronPath, [root, `--remote-debugging-port=${speechPort}`, "--force-device-scale-factor=2"], { env: { ...process.env, DIALPAL_TEST_DIR: speechDir, DIALPAL_MODELS_URL: `http://127.0.0.1:${modelServer.address().port}`, ANTHROPIC_API_KEY: "sk-ant-placeholder-1234" }, stdio: "ignore" });

let speechPage;
for (let i = 0; i < 100 && !speechPage; i++) {
  await sleep(100);
  try {
    speechPage = (await (await fetch(`http://127.0.0.1:${speechPort}/json`)).json()).find((t) => t.type === "page");
  } catch {}
}
const speechWs = new WebSocket(speechPage.webSocketDebuggerUrl);
let speechId = 0;
const speechWaiting = new Map();
speechWs.onmessage = (m) => {
  const d = JSON.parse(m.data);
  speechWaiting.get(d.id)?.(d);
};
await new Promise((r) => (speechWs.onopen = r));
const speechCdp = (method, params = {}) => new Promise((r) => { const i = ++speechId; speechWaiting.set(i, r); speechWs.send(JSON.stringify({ id: i, method, params })); });
const speechRun = async (js) => (await speechCdp("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
const speechUntil = async (js) => { for (let i = 0; i < 100 && !(await speechRun(`return !!(${js});`)); i++) await sleep(50); };

await speechUntil(`typeof state !== "undefined" && state.shortcuts`);
await speechRun(`document.getElementById("obNext").click();`);
await speechUntil(`onboarding?.step === "speech" && state.speech?.received > 0`);
await sleep(500);
const { result: speechResult } = await speechCdp("Page.captureScreenshot", { format: "png" });
writeFileSync(path.join(out, "setup-speech.png"), Buffer.from(speechResult.data, "base64"));
console.log("docs/images/setup-speech.png");

speechWs.close();
await new Promise((r) => (speechApp.once("exit", r), speechApp.kill()));
for (const res of held) res.destroy();
modelServer.close();
server.close();
rmSync(speechDir, { recursive: true, force: true });
