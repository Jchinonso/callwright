import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRecord, checkHubSpot, classifyObjection, computeStats, csvRow, extractRecord, fallbackRecord, parseRecord, pushToHubSpot, readRecords } from "../src/calls.js";

const record = (over = {}) => ({ date: "2026-11-16T15:00:00.000Z", company: "Brightline", contact: "Dana", email: null, outcome: "no_decision", meeting: null, objections: [], nextStep: null, summary: null, ...over });

test("parseRecord: JSON in a fence or prose, unknown values made safe", () => {
  const r = parseRecord('Here you go:\n```json\n{"company":"Brightline","contact":null,"email":"dana@brightline.com","outcome":"booked","meeting":"Tue 2pm","objections":[{"type":"no_budget","quote":"No budget till Q3","handled":true},{"type":"made_up","quote":"x"}],"next_step":"Send invite","summary":"Booked a demo."}\n```');
  assert.equal(r.outcome, "booked");
  assert.equal(r.email, "dana@brightline.com");
  assert.deepEqual(r.objections.map((o) => o.type), ["no_budget", "other"]);
  assert.equal(r.objections[0].handled, true);
  assert.equal(r.nextStep, "Send invite");
  assert.equal(parseRecord('{"outcome":"won the lottery","email":"not an email"}').outcome, "no_decision");
  assert.equal(parseRecord('{"email":"not an email"}').email, null);
  assert.equal(parseRecord("no json here"), null);
  assert.equal(parseRecord("{broken"), null);
});

test("objections are classified by type; the fallback record uses them", () => {
  assert.equal(classifyObjection("Look, we're not interested."), "not_interested");
  assert.equal(classifyObjection("Just send me an email."), "send_info");
  assert.equal(classifyObjection("We already use HubSpot."), "using_competitor");
  assert.equal(classifyObjection("There's no budget this year."), "no_budget");
  assert.equal(classifyObjection("Please take me off your list"), "do_not_call");
  assert.equal(classifyObjection("Tuesday works for me"), null);
  const r = fallbackRecord([
    { role: "them", text: "Who is this?" },
    { role: "me", text: "We're not interested in wasting your time" }, // the rep's words don't count
    { role: "them", text: "Stop calling me." },
  ]);
  assert.deepEqual(r.objections.map((o) => o.type), ["who_is_this", "do_not_call"]);
  assert.equal(r.outcome, "do_not_call");
});

test("extractRecord sends the transcript and replies, and parses the reply", async () => {
  let sent;
  const provider = { name: () => "x", complete: async (p) => ((sent = p), { text: '{"outcome":"follow_up","objections":[]}', usage: {}, stop: "end" }) };
  const r = await extractRecord(provider, "m", { transcript: [{ role: "them", text: "Call me next week." }], answers: [{ answer: "**Sure, Tuesday?**\nAsk: what time?" }] });
  assert.equal(r.outcome, "follow_up");
  assert.match(sent.user, /them: Call me next week/);
  assert.match(sent.user, /- \*\*Sure, Tuesday\?\*\*/);
  const bad = { name: () => "x", complete: async () => ({ text: "sorry", usage: {}, stop: "end" }) };
  await assert.rejects(extractRecord(bad, "m", { transcript: [], answers: [] }), /didn't return a call record/);
});

test("CSV rows quote commas and quotes, and never start a cell with a formula", () => {
  const row = csvRow(record({ company: 'Acme, "Inc"', summary: "=HYPERLINK(\"x\")", objections: [{ type: "no_budget" }, { type: "bad_time" }], outcome: "booked" }));
  assert.match(row, /"Acme, ""Inc"""/);
  assert.match(row, /"'=HYPERLINK\(""x""\)"/);
  assert.match(row, /No budget or too expensive; Bad time, call back/);
  assert.match(row, /Meeting booked/);
});

test("appendRecord writes JSONL and CSV; readRecords skips a torn line", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dialpal-calls-"));
  try {
    await appendRecord(dir, record({ outcome: "booked" }));
    await appendRecord(dir, record({ practice: true, score: 7 }));
    const csv = readFileSync(path.join(dir, "calls.csv"), "utf8").trim().split("\n");
    assert.equal(csv.length, 3);
    assert.match(csv[0], /^date,practice,duration_min,company/);
    writeFileSync(path.join(dir, "calls.jsonl"), readFileSync(path.join(dir, "calls.jsonl"), "utf8") + '{"torn":');
    const back = await readRecords(dir);
    assert.equal(back.length, 2);
    assert.equal(back[1].score, 7);
    assert.deepEqual(await readRecords(path.join(dir, "missing")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeStats: booked rate, objections ranked with booked-after rates, practice kept apart", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const st = computeStats(
    [
      record({ date: "2026-11-15T10:00:00Z", outcome: "booked", objections: [{ type: "no_budget", handled: true }, { type: "no_budget", handled: false }] }),
      record({ date: "2026-11-14T10:00:00Z", outcome: "not_interested", objections: [{ type: "no_budget", handled: false }, { type: "send_info", handled: false }] }),
      record({ date: "2026-10-01T10:00:00Z", outcome: "follow_up", objections: [] }),
      record({ date: "2026-11-15T10:00:00Z", outcome: "booked", practice: true, score: 6, objections: [{ type: "bad_time" }] }),
      record({ date: "2026-11-15T11:00:00Z", outcome: "no_decision", practice: true, score: 8, objections: [] }),
    ],
    now,
  );
  assert.equal(st.calls, 3);
  assert.equal(st.booked, 1);
  assert.equal(st.bookedRate, 33);
  assert.equal(st.lastWeek, 2);
  assert.equal(st.objections[0].type, "no_budget");
  assert.equal(st.objections[0].count, 3);
  assert.equal(st.objections[0].calls, 2);
  assert.equal(st.objections[0].bookedRate, 50);
  assert.equal(st.objections[0].handledRate, 33);
  assert.ok(!st.objections.some((o) => o.type === "bad_time"), "practice objections don't count");
  assert.deepEqual(st.practice, { sessions: 2, averageScore: 7, lastScores: [6, 8] });
  assert.deepEqual(computeStats([]).bookedRate, null);
});

test("pushToHubSpot: finds the contact by email, logs an outbound call associated with it", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    if (url.endsWith("/contacts/search")) return new Response(JSON.stringify({ results: [{ id: "501" }] }), { status: 200 });
    return new Response(JSON.stringify({ id: "9001" }), { status: 201 });
  };
  const out = await pushToHubSpot(record({ email: "dana@brightline.com", outcome: "booked", meeting: "Tue 2pm", objections: [{ type: "no_budget", handled: true }], summary: "Booked a demo.", durationMin: 3.5 }), "pat-na1-abc", { fetchFn, baseUrl: "http://hs" });
  assert.deepEqual(out, { id: "9001", contactId: "501" });
  assert.equal(calls[0].init.headers.authorization, "Bearer pat-na1-abc");
  assert.equal(calls[0].body.filterGroups[0].filters[0].value, "dana@brightline.com");
  const callBody = calls[1].body;
  assert.equal(calls[1].url, "http://hs/crm/v3/objects/calls");
  assert.equal(callBody.properties.hs_call_direction, "OUTBOUND");
  assert.equal(callBody.properties.hs_call_duration, "210000");
  assert.match(callBody.properties.hs_call_body, /Outcome: Meeting booked \(Tue 2pm\)/);
  assert.match(callBody.properties.hs_call_body, /No budget or too expensive \(handled\)/);
  assert.equal(callBody.associations[0].to.id, "501");
});

test("pushToHubSpot without an email skips the search; errors are plain", async () => {
  const urls = [];
  const ok = async (url) => (urls.push(url), new Response("{}", { status: 201 }));
  await pushToHubSpot(record(), "t", { fetchFn: ok, baseUrl: "http://hs" });
  assert.deepEqual(urls, ["http://hs/crm/v3/objects/calls"]);
  const unauthorized = async () => new Response("{}", { status: 401 });
  await assert.rejects(pushToHubSpot(record(), "t", { fetchFn: unauthorized, baseUrl: "http://hs" }), /didn't accept the token/);
  await assert.rejects(checkHubSpot("t", { fetchFn: async () => new Response("{}", { status: 403 }), baseUrl: "http://hs" }), /crm\.objects\.calls\.write/);
  assert.equal(await checkHubSpot("t", { fetchFn: async () => new Response("{}", { status: 200 }), baseUrl: "http://hs" }), true);
});

test("hint words for the speech model come from the brief, the prospect and the rep, without brief labels", async () => {
  const { callNames } = await import("../src/hotwords.js");
  const names = callNames({ brief: "Company: Ledgerly. We help finance teams.\nProof: Brightline cut time 62%.\nMeeting to book: demo with Priya on Tuesday.", target: { name: "Marcus Hill", company: "Northwind" }, profile: { name: "Sam Lee" } });
  assert.deepEqual(names, ["Marcus", "Hill", "Northwind", "Sam", "Lee", "Ledgerly", "Brightline", "Priya"]);
  assert.equal(classifyObjection("We've got a process for that already and it works fine."), "using_competitor");
  assert.equal(classifyObjection("Budget's locked for this year."), "no_budget");
});
