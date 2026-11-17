// Words to listen for ("hotwords"), for Parakeet through sherpa-onnx.
//
// sherpa-onnx boosts a phrase only when it is given as the model's own tokens
// (tokens.txt: BPE pieces, "▁" starting a word, case-sensitive), and only when
// those are exactly the pieces the model emits for it. Its hotword parser
// can't take word-initial pieces ("▁P") directly, so Callwright gives it plain
// words plus a small vocabulary file made of just the pieces those words
// need; sherpa's encoder then picks the highest-scoring split from that file.
// A wrong split makes things worse ("Postgres" heard as "Postgroups"), and one
// piece sherpa can't find makes it drop every phrase, so each phrase is
// checked here first and left out if it can't be encoded exactly.

// At 2.0 the built-in tech words hijacked everyday speech in tests ("job"
// heard as "Java", "keep your skills from getting rusty" heard as "Pow Do You
// Kubernetes from Gusty"); 1.0 still turns "posters" into "Postgres" without
// that.
const BOOST = 1.0;

// Words the user typed in themselves: at 2.0 "Supabase" is heard right (at
// 1.0 it was "Superbase"), and these are the user's own distinctive names,
// unlike the short built-in tech words that hijacked everyday speech at 2.0.
export const USER_BOOST = 2.0;

// tokens.txt: "<piece> <id>" per line. Lower ids were merged earlier.
export function readTokens(text) {
  const tokens = new Map();
  for (const line of String(text).split("\n")) {
    const i = line.lastIndexOf(" ");
    if (i <= 0) continue;
    const id = Number(line.slice(i + 1));
    if (Number.isInteger(id)) tokens.set(line.slice(0, i), id);
  }
  return tokens;
}

// The pieces the model uses for one word: sentencepiece BPE, which starts
// from single characters and keeps merging the neighbouring pair that was
// merged earliest in training (the lowest id). null when a character isn't
// in the vocabulary at all.
export function encodeWord(word, tokens) {
  const parts = [..."▁" + word];
  if (!word || parts.some((c) => !tokens.has(c))) return null;
  for (;;) {
    let best = -1;
    let bestId = Infinity;
    for (let i = 0; i < parts.length - 1; i++) {
      const id = tokens.get(parts[i] + parts[i + 1]);
      if (id !== undefined && id < bestId) {
        bestId = id;
        best = i;
      }
    }
    if (best < 0) return parts;
    parts.splice(best, 2, parts[best] + parts[best + 1]);
  }
}

// A score per piece for sherpa's encoder (simple-sentencepiece), which picks
// the split with the highest total. Every full split of a word covers the
// same characters, so the large per-character part only makes a split that
// stops early lose; among full splits, fewer pieces win.
const pieceScore = (piece) => 1000 * [...piece].length - 1;

// What sherpa's encoder will make of a word with this vocabulary (a copy of
// its dynamic programming, ties included), to check it before it's used.
export function sherpaSplit(word, scores) {
  const s = [..."▁" + word];
  const n = s.length;
  const route = new Array(n + 1);
  route[n] = { score: 0, end: 0, piece: null };
  for (let i = n - 1; i >= 0; i--) {
    let best = -Infinity;
    let end = -1;
    let piece = null;
    for (let j = i + 1; j <= n; j++) {
      const p = s.slice(i, j).join("");
      if (!scores.has(p)) continue;
      const total = scores.get(p) + route[j].score;
      if (total > best) {
        best = total;
        end = j;
        piece = p;
      }
    }
    // sherpa scores a dead end as 0, not minus infinity.
    route[i] = { score: best === -Infinity ? 0 : best, end, piece };
  }
  const out = [];
  for (let i = 0; i < n; i = route[i].end) {
    if (route[i].end === -1) return null; // sherpa would write <unk> here
    out.push(route[i].piece);
  }
  return out;
}

// Characters sherpa's hotword parser treats specially: "/" separates
// phrases, and a word starting with ":" is a boost score.
const UNUSABLE = /[/\n]|(^|\s)[:#@]/;

// phrases: "React", "Next.js", { phrase: "Hugging Face", boost: 2 }, ...
// (duplicates and blanks are fine; the first occurrence wins). Returns
// { hotwords, vocab, used, skipped }: hotwords for createStream, vocab for
// the recognizer's bpeVocab file (empty when there's nothing to boost), and
// the phrases left out.
export function planHotwords(phrases, tokens) {
  const skipped = [];
  let candidates = [];
  const seen = new Set();
  for (const raw of phrases) {
    const entry = typeof raw === "object" && raw !== null ? raw : { phrase: raw };
    const phrase = String(entry.phrase ?? "").trim().replace(/\s+/g, " ");
    const boost = Number.isFinite(entry.boost) ? entry.boost : BOOST;
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    if (UNUSABLE.test(phrase)) {
      skipped.push(phrase);
      continue;
    }
    // As written, else in lower case (the model's vocabulary is case-sensitive).
    const words = [];
    for (const word of phrase.split(" ")) {
      const asWritten = encodeWord(word, tokens);
      const lower = asWritten ? null : encodeWord(word.toLowerCase(), tokens);
      if (asWritten) words.push({ word, pieces: asWritten });
      else if (lower) words.push({ word: word.toLowerCase(), pieces: lower });
      else break;
    }
    if (words.length !== phrase.split(" ").length) skipped.push(phrase);
    else candidates.push({ phrase, boost, words });
  }
  // A piece one phrase needs can give another a different split; such a
  // phrase is left out and the vocabulary is worked out again without it.
  for (;;) {
    const scores = new Map();
    for (const c of candidates) for (const w of c.words) for (const p of w.pieces) scores.set(p, pieceScore(p));
    const wrong = candidates.filter((c) => c.words.some((w) => sherpaSplit(w.word, scores)?.join(" ") !== w.pieces.join(" ")));
    if (!wrong.length) {
      const vocab = [...scores].map(([p, score]) => `${p}\t${score}`).join("\n");
      return {
        hotwords: candidates.map((c) => `${c.words.map((w) => w.word).join(" ")} :${c.boost.toFixed(1)}`).join("/"),
        vocab: vocab ? `${vocab}\n` : "",
        used: candidates.map((c) => c.phrase),
        skipped,
      };
    }
    // Drop the last one in the list first: the earlier ones matter more.
    const drop = wrong.at(-1);
    skipped.push(drop.phrase);
    candidates = candidates.filter((c) => c !== drop);
  }
}

// Names worth listening for on a sales call, taken from what the rep already
// typed: proper nouns in the product brief (the company, the product,
// customers, competitors, the colleague who runs the demo), the prospect's
// name and company, and the rep's own. Brief labels ("Proof:") and ordinary
// capitalised words are left out. Most distinctive first, at most 24.
const NOT_NAMES = new Set(
  "Company Product Who Problem Proof Pricing Competitors Lead Meeting Disclosure Opener Pitch Source Heads The This That These Those We Our You Your They Their It Its If In On At For From With And But Or Not No Yes A An To Of By As Is Are Was Be From Hi Hello Mind Can Could Would Should Will Do Does Did Got Get Most Many Some All Any Each Every One Two Three Teams Team Finance Sales Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December First Second Quarter Annual Optional E.g Eg Also".split(" "),
);
export function callNames({ brief = "", target = {}, profile = {} } = {}) {
  const out = [];
  const add = (w) => {
    const word = String(w || "").trim().replace(/[.,;:!?)]+$/, "");
    if (word.length < 3 || NOT_NAMES.has(word) || out.includes(word)) return;
    out.push(word);
  };
  for (const v of [target.name, target.company, profile.name, profile.company]) for (const w of String(v || "").split(/\s+/)) if (/^[A-Z]/.test(w)) add(w);
  const body = String(brief).replace(/^[A-Za-z ]{2,24}:/gm, " "); // drop "Proof:" style labels
  for (const m of body.matchAll(/\b[A-Z][a-zA-Z]+(?:\.[a-z]{2,4})?\b/g)) add(m[0]);
  return out.slice(0, 24);
}
