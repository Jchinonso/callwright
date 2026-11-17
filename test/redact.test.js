import { test } from "node:test";
import assert from "node:assert/strict";
import { luhn, redact, spokenDigits } from "../src/redact.js";

test("card numbers: typed, with spaces or dashes, and spoken, keep only the last 4", () => {
  assert.deepEqual(redact("my card is 4242 4242 4242 4242 thanks"), { text: "my card is [card ending 4242] thanks", counts: { card: 1 } });
  assert.equal(redact("It's 5555-5555-5555-4444.").text, "It's [card ending 4444].");
  assert.equal(redact("four two four two four two four two four two four two four two four two").text, "[card ending 4242]");
  assert.equal(redact("378282246310005 is the amex").text, "[card ending 0005] is the amex");
});

test("a card read out in pieces after the card is mentioned is blanked too", () => {
  assert.equal(redact("4242 4242", { previous: "Okay, my card number is" }).text, "[redacted]");
  assert.equal(redact("my card number is 4242 4242, then 4242 4242").text, "my card number is [redacted], then [redacted]");
});

test("security codes, expiry, Social Security, bank details and one-time codes, only near their names", () => {
  assert.equal(redact("the security code is 737").text, "the security code is [redacted]");
  assert.equal(redact("CVV 1234 please").text, "CVV [redacted] please");
  assert.equal(redact("it expires 04/28").text, "it expires [redacted]");
  assert.equal(redact("my social is 123 45 6789").text, "my social is [redacted]");
  assert.equal(redact("SSN 123-45-6789").text, "SSN [redacted]");
  assert.equal(redact("routing number 021000021 and account number 123456789").text, "routing number [redacted] and account number [redacted]");
  assert.equal(redact("the code is 482 913 from the text").text, "the code is [redacted] from the text");
  assert.equal(redact("my password is hunter2.").text, "my password is [redacted].");
});

test("ordinary numbers stay: order numbers failing Luhn, phone numbers, prices, dates, quantities", () => {
  for (const s of ["order 1234567890123456 hasn't arrived", "call me on 512 555 0142", "it was $1,299 last month", "since March 3, 2026", "we have one or two issues", "about 15 hours a week"]) {
    assert.equal(redact(s).text, s, s);
  }
  assert.ok(!luhn("1234567890123456"));
});

test("spoken digits become numerals only in runs of four or more", () => {
  assert.equal(spokenDigits("one or two"), "one or two");
  assert.equal(spokenDigits("it's four oh one five"), "it's 4015");
  assert.equal(spokenDigits("1 2 3 4"), "1 2 3 4");
});
