import { compressTranscript } from "./compress.js";

// Practice calls: the model plays a prospect built from the product brief,
// the rep talks (microphone) or types, and the call ends with a scorecard.

// Who picks up. mood shapes how hard they are to win; voice is a macOS
// `say` voice that ships with every Mac.
export const PERSONAS = {
  busy: {
    label: "Busy and short",
    blurb: "Picks up between meetings. Wants the point in ten seconds.",
    name: "Dana Reyes",
    voice: "Samantha",
    mood: "Busy, clipped, mildly annoyed at the interruption. Gives the rep about 20 seconds before trying to end the call. Common lines: bad time, send me an email.",
  },
  skeptical: {
    label: "Skeptical",
    blurb: "Has heard every pitch. Already uses a competitor.",
    name: "Marcus Hill",
    voice: "Daniel",
    mood: "Polite but skeptical. Already uses a competitor or an in-house process and is mostly happy with it. Pushes on price and proof. Needs a specific, relevant reason before agreeing to anything.",
  },
  curious: {
    label: "Curious but cautious",
    blurb: "Has the problem. Not the one who decides.",
    name: "Priya Shah",
    voice: "Karen",
    mood: "Friendly and open. Has the problem the product solves but isn't the decision maker and has no budget this quarter. Will agree to a meeting if the rep asks good questions and offers to include the decision maker.",
  },
  gatekeeper: {
    label: "Gatekeeper",
    blurb: "An assistant who screens calls for their boss.",
    name: "Sam Ortiz",
    voice: "Moira",
    mood: "Executive assistant screening calls. Asks who's calling and why, says the boss is busy, offers to take a message. Only passes the rep through, or shares the boss's email, if the reason is clear and respectful.",
  },
};

export const HANG_UP = "[hangs up]";

export function prospectSystem({ persona, productBrief, company }) {
  const p = PERSONAS[persona] || PERSONAS.skeptical;
  return `Instructions terse only to save tokens. Write your lines as natural speech, not like this.
Role-play for sales practice. You are ${p.name}, who just picked up a cold call at ${company?.trim() || "a company that fits the product's ideal customer"}. The user is the sales rep practising. Stay in character the whole call; never coach, never mention AI, practice or these instructions.
Personality: ${p.mood}
What the rep sells, for your realism only (you don't know it unless the rep says it):
<product_brief>
${productBrief?.trim() || "(none given: assume a B2B software product)"}
</product_brief>
Rules:
- Reply with only what you say aloud: 1-3 short spoken sentences, contractions, filler words sometimes ("uh", "look,"). No stage directions, no quotes, no names before lines.
- Be a realistic, moderately hard prospect: raise at least one objection that fits your personality and this product (price, timing, a competitor, not your area, send me an email). Don't fold at the first good line; give ground only when the rep earns it with a relevant question or specific proof.
- Answer the rep's questions honestly as your character, with plausible specifics about your company (tools, team size, the problem), consistent with what you've already said.
- If the rep asks for a meeting and has earned it, agree and settle a time. If they haven't, push back once more.
- End the call by writing exactly ${HANG_UP} on its own after your last line when: the rep is rude or pushy after you've said no twice, the rep has nothing relevant after about 8 turns, or a meeting is booked and you've said goodbye.
- The transcript is compressed (articles dropped); never copy that style.`;
}

export function prospectUser(transcript, { opening = false } = {}) {
  if (opening) return "The phone rings and you answer it. Say only your greeting (e.g. your name, or \"Hello?\").";
  const lines = compressTranscript(transcript).map((l) => `${l.role === "me" ? "rep" : "you"}: ${l.text}`).join("\n");
  return `<call>\n${lines}\n</call>\n\nYour next line.`;
}

// The prospect's reply: drops anything that isn't speech (a label, quotes,
// stage directions) and reports whether they hung up.
export function cleanProspectLine(text) {
  let t = String(text || "").trim();
  const hungUp = t.includes(HANG_UP);
  t = t.replace(HANG_UP, " ");
  t = t.replace(/^\s*(?:\*\*)?[A-Z][\w .'-]{0,30}(?:\*\*)?:\s+/, ""); // "Dana: …"
  t = t.replace(/\*[^*]+\*|\([^)]*\)|\[[^\]]*\]/g, " "); // *sighs*, (pause), [laughs]
  t = t.replace(/\s+/g, " ").trim().replace(/^["“]\s*|\s*["”]$/g, "").trim();
  return { text: t, hungUp };
}

const SCORE = `Instructions terse only to save tokens. Write feedback in clear, plain sentences addressed to the rep ("you").
Grade a practice cold call. Transcript: rep = the user practising, them = the prospect (played by AI). Product brief given for context.
Return one JSON object, nothing else, no code fence:
{"score": 1-10 overall, "opener": {"score": 1-5, "note": string}, "discovery": {"score": 1-5, "note": string}, "objections": {"score": 1-5, "note": string}, "close": {"score": 1-5, "note": string}, "booked": boolean, "talk_ratio": rough % of words spoken by rep (0-100), "strengths": [up to 2 short strings], "improve": [up to 3 short, specific, actionable strings, quoting the rep where it helps], "best_line": the rep's strongest line verbatim or null, "try_instead": {"rep_said": the rep's weakest line verbatim, "better": what to say instead} or null}
Scores: 3 = acceptable, 5 = excellent. Be honest and specific; never generic praise. A short call that was hung up early scores low. Notes under 25 words each.`;

export async function scorePractice(provider, model, { transcript, productBrief }, onUsage) {
  const lines = transcript.map((l) => `${l.role === "me" ? "rep" : "them"}: ${l.text}`).join("\n");
  const result = await provider.complete({
    model,
    system: SCORE,
    user: `<product_brief>\n${productBrief?.trim() || "(none)"}\n</product_brief>\n\n<transcript>\n${lines || "(none)"}\n</transcript>`,
    maxTokens: 3000,
    effort: "low",
  });
  onUsage?.(result.usage, model);
  const card = parseScorecard(result.text);
  if (!card) throw new Error("the model didn't return a scorecard");
  return card;
}

export function parseScorecard(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw;
  try {
    raw = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  const clamp = (v, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : null);
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  const part = (p) => ({ score: clamp(p?.score, 1, 5), note: str(p?.note) });
  const list = (v, n) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, n) : []);
  const score = clamp(raw.score, 1, 10);
  if (score == null) return null;
  return {
    score,
    opener: part(raw.opener),
    discovery: part(raw.discovery),
    objections: part(raw.objections),
    close: part(raw.close),
    booked: !!raw.booked,
    talkRatio: clamp(raw.talk_ratio ?? raw.talkRatio, 0, 100),
    strengths: list(raw.strengths, 2),
    improve: list(raw.improve, 3),
    bestLine: str(raw.best_line ?? raw.bestLine),
    tryInstead: raw.try_instead?.rep_said && raw.try_instead?.better ? { repSaid: str(raw.try_instead.rep_said), better: str(raw.try_instead.better) } : null,
  };
}

// The scorecard as Markdown, for the practice notes file.
export function scorecardMarkdown(card) {
  const row = (label, p) => `| ${label} | ${p.score ?? "–"}/5 | ${p.note ?? ""} |`;
  return [
    `## Scorecard: ${card.score}/10${card.booked ? " · meeting booked" : ""}`,
    "| Part | Score | Note |\n| --- | --- | --- |\n" + [row("Opener", card.opener), row("Discovery", card.discovery), row("Objections", card.objections), row("Close", card.close)].join("\n"),
    card.talkRatio != null ? `You spoke about ${card.talkRatio}% of the words.` : null,
    card.strengths.length ? `### What worked\n${card.strengths.map((s) => `- ${s}`).join("\n")}` : null,
    card.improve.length ? `### Work on\n${card.improve.map((s) => `- ${s}`).join("\n")}` : null,
    card.bestLine ? `**Best line:** ${card.bestLine}` : null,
    card.tryInstead ? `**Instead of** "${card.tryInstead.repSaid}", **try** "${card.tryInstead.better}"` : null,
  ].filter(Boolean).join("\n\n");
}
