// Removes payment and identity numbers from call text on the Mac, before it
// is shown, saved, logged or sent to an AI provider. Best effort: speech
// recognition can split or mishear digits, so this lowers the risk, it is
// not a compliance guarantee (see docs/support-mode/README.md, section 8).
//
//   const { text, counts } = redact("my card is 4242 4242 4242 4242", { previous })
//   // text: "my card is [card ending 4242]", counts: { card: 1 }
//
// previous: the line heard just before, so a number read out after "my card
// number is…" in the previous phrase is still caught.

const DIGIT_WORDS = { zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const DIGIT_WORD = "(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine|\\d)";

// "four two four two" -> "4242": only runs of four or more digit words (or
// digits mixed in), so everyday "one or two" stays as words.
export function spokenDigits(text) {
  const run = new RegExp(`\\b${DIGIT_WORD}(?:[\\s,.-]+${DIGIT_WORD}){3,}\\b`, "gi");
  return String(text).replace(run, (m) => {
    const parts = m.split(/[\s,.-]+/).filter(Boolean);
    // A run that is all real digits already reads fine.
    if (parts.every((p) => /^\d+$/.test(p))) return m;
    return parts.map((p) => DIGIT_WORDS[p.toLowerCase()] ?? p).join("");
  });
}

export function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const CARD_CONTEXT = /\b(?:card|credit|debit|visa|mastercard|master card|amex|american express|discover)\b/i;
const NEAR = (words, reach) => new RegExp(`\\b(?:${words})\\b[^\\d]{0,${reach}}`, "gi");
const RULES = [
  // Security code: 3 or 4 digits close after its name.
  ["cvv", NEAR("security code|cvv|cvc|cv2|cid|three digits on the back|digits on the back|code on the back", 25), /\d{3,4}\b/],
  // Expiry: MM/YY, MM YY, MMYY or MM/YYYY after "expires".
  ["expiry", NEAR("expires|expiry|expiration|exp|valid thru|valid through|valid until", 15), /\d{1,2}\s*[/ -]\s*\d{2,4}\b|\d{4}\b/],
  // Social Security and similar national IDs, after their name.
  ["id", NEAR("social security|social|ssn|national insurance|sin number|tax id|tin", 25), /\d[\d -]{6,12}\d\b|[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i],
  // Bank details, after their name.
  ["bank", NEAR("account number|account no|acct|routing number|routing|sort code|iban|bsb|aba", 25), /[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}|\d[\d -]{4,20}\d\b/i],
  // One-time codes, PINs and passwords: the next word or two.
  ["secret", /\b(?:code is|passcode is|password is|pass code is|pin is|pin number is|verification code is|one-time code is|security answer is)\s*/gi, /[^\s.,!?]+(?:\s[^\s.,!?]+)?/],
];

export function redact(input, { previous = "" } = {}) {
  const counts = {};
  const bump = (k) => (counts[k] = (counts[k] || 0) + 1);
  let text = spokenDigits(String(input ?? ""));

  // US Social Security numbers in their written shape, anywhere.
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => (bump("id"), "[redacted]"));

  // Card numbers: 13-19 digits (spaces or dashes allowed) passing Luhn.
  // The label keeps the last 4 (agents confirm cards that way); it's held
  // back as a placeholder so the passes below don't see its digits.
  const endings = [];
  text = text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    bump("card");
    endings.push(digits.slice(-4));
    return `\u0000${endings.length - 1}\u0000`;
  });

  for (const [kind, lead, value] of RULES) {
    const flags = lead.flags.includes("i") || value.flags.includes("i") ? "gi" : "g";
    text = text.replace(new RegExp(`(${lead.source})(${value.source})`, flags), (m, before) => {
      bump(kind);
      return `${before}[redacted]`;
    });
  }

  // A card read out in pieces after "my card number is" in the line before
  // (or earlier in this one): any group of 4+ digits left is part of it.
  const cardTalk = CARD_CONTEXT.test(previous) || CARD_CONTEXT.test(text);
  if (cardTalk) {
    text = text.replace(/\b\d(?:[ -]?\d){3,}\b/g, (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 4 || digits.length > 19) return m;
      bump("card");
      return "[redacted]";
    });
  }
  text = text.replace(/\u0000(\d+)\u0000/g, (m, i) => `[card ending ${endings[Number(i)]}]`);
  return { text, counts };
}
