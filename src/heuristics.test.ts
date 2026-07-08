import { expect, test } from "vitest";
import { detectHeuristics } from "./heuristics.ts";
import { premask } from "./premask.ts";

function emailSpan(text: string): string | null {
  const s = detectHeuristics(text).find((sp) => sp.label === "EMAIL");
  return s ? text.slice(s.start, s.end) : null;
}
function urlSpan(text: string): string | null {
  const s = detectHeuristics(text).find((sp) => sp.label === "URL");
  return s ? text.slice(s.start, s.end) : null;
}

test("matches an accented local part in full", () => {
  expect(emailSpan("reach mémoichon@protonmail.com now")).toBe("mémoichon@protonmail.com");
});

test("matches accented and mixed-case initials", () => {
  expect(emailSpan("id özebosau@hotmail.com x")).toBe("özebosau@hotmail.com");
  expect(emailSpan("id ÇY22@hotmail.com x")).toBe("ÇY22@hotmail.com");
});

test("plain ASCII email is unchanged", () => {
  expect(emailSpan("hi alex+housing@sub.example.gov ok")).toBe("alex+housing@sub.example.gov");
});

test("does not extend the match left across whitespace", () => {
  expect(emailSpan("café mémoichon@example.fr")).toBe("mémoichon@example.fr");
});

test("space in the local part still clips (documented out-of-scope boundary)", () => {
  expect(emailSpan("mail cvon st@yahoo.com here")).toBe("st@yahoo.com");
});

test("no catastrophic backtracking on a long whitespace-free blob", () => {
  const blob = "a".repeat(50000);              // no '@' -> no EMAIL match
  const t0 = performance.now();
  const spans = detectHeuristics(blob);
  expect(performance.now() - t0).toBeLessThan(100);
  expect(spans.find((s) => s.label === "EMAIL")).toBeUndefined();
});

test("long local-part run still matches once, fast", () => {
  const text = "x".repeat(50000) + "@example.com";
  const t0 = performance.now();
  const s = detectHeuristics(text).find((sp) => sp.label === "EMAIL");
  expect(performance.now() - t0).toBeLessThan(100);
  expect(s && text.slice(s.start, s.end)).toBe(text);
});

test("schemeless URL matches an accented host", () => {
  expect(urlSpan("visit www.café.fr/menu please")).toBe("www.café.fr/menu");
});

test("premask masks the whole accented email so no prefix reaches the model", () => {
  const text = "Write to mémoichon@protonmail.com today";
  const masked = premask(text, detectHeuristics(text)).masked;
  expect(masked).toContain("[EMAIL]");
  expect(masked).not.toContain("mémoichon");
});

function phoneSpan(text: string): string | null {
  const s = detectHeuristics(text).find((sp) => sp.label === "PHONE");
  return s ? text.slice(s.start, s.end) : null;
}

test("matches formatted NANP phones in full", () => {
  expect(phoneSpan("call (212) 555-0112 today")).toBe("(212) 555-0112");
  expect(phoneSpan("reach me 415-555-0158")).toBe("415-555-0158");
  expect(phoneSpan("intl +1 312 555 0177 ok")).toBe("+1 312 555 0177");
  expect(phoneSpan("toll (800) 555-0132 line")).toBe("(800) 555-0132");
  expect(phoneSpan("dotted 212.555.0112 here")).toBe("212.555.0112");
});

test("does not match non-phone digit shapes (over-redaction guards)", () => {
  expect(phoneSpan("order #ORD-8821045 shipped")).toBeNull();   // order number
  expect(phoneSpan("due 04/15/2026 pay")).toBeNull();            // date
  expect(phoneSpan("ssn 123-45-6789 x")).toBeNull();             // SSN (area starts 1)
  expect(phoneSpan("card 4111 1111 1111 1111 y")).toBeNull();    // CC (exchange starts 1)
  expect(phoneSpan("ip 192.168.1.1 z")).toBeNull();              // IPv4 (area starts 1)
  expect(phoneSpan("acct 4521003891 done")).toBeNull();          // bare 10-digit (no separators)
  expect(phoneSpan("local 555-0158 only")).toBeNull();           // 7-digit (out of scope)
});

test("does not over-match into neighbouring text or a longer digit run", () => {
  expect(phoneSpan("(212) 555-0112!")).toBe("(212) 555-0112");   // trailing punctuation excluded
  expect(phoneSpan("id 995551234567 no")).toBeNull();            // 12-digit run — no clean NANP match
});

test("PHONE is detected for redaction but NOT premasked (additive backstop, no model-blinding)", () => {
  const text = "Call (212) 555-0112 for help";
  // still detected as a redactable span
  expect(detectHeuristics(text).some((s) => s.label === "PHONE")).toBe(true);
  // but NOT sentinel-masked before the model (so the model sees the raw phone)
  const masked = premask(text, detectHeuristics(text).filter((s) => s.label !== "PHONE")).masked;
  expect(masked).toContain("555-0112");
  expect(masked).not.toContain("[PHONE]");
});

function secondary(text: string): string[] {
  return detectHeuristics(text).filter((s) => s.label === "SECONDARY_ADDRESS").map((s) => text.slice(s.start, s.end));
}

test("SECONDARY_ADDRESS matches designator + number forms", () => {
  expect(secondary("Ship to Apt 4B please")).toEqual(["Apt 4B"]);
  expect(secondary("Suite 200, downtown")).toEqual(["Suite 200"]);
  expect(secondary("Unit 12 rear")).toEqual(["Unit 12"]);
  expect(secondary("Ste #5 upstairs")).toEqual(["Ste #5"]);
});

test("SECONDARY_ADDRESS requires a designator keyword and a digit", () => {
  expect(secondary("the Suite Life of Zack")).toEqual([]); // keyword, no digit
  expect(secondary("ticket #4B resolved")).toEqual([]);    // digit, no designator
});

test("SECONDARY_ADDRESS does not eat a STATE + ZIP tail", () => {
  expect(secondary("Miami, FL 33101")).toEqual([]);
  expect(secondary("Applicant lives in Tampa FL 33602 now")).toEqual([]);
});

test("SECONDARY_ADDRESS still matches the full word Floor", () => {
  expect(secondary("Floor 3 rear")).toEqual(["Floor 3"]);
});

function phones(text: string): string[] {
  return detectHeuristics(text).filter((s) => s.label === "PHONE").map((s) => text.slice(s.start, s.end));
}

test("E.164 international numbers with a leading + are detected", () => {
  expect(phones("ring +44 20 7946 0958 today")).toContain("+44 20 7946 0958");
  expect(phones("de: +49 30 12345678")).toContain("+49 30 12345678");
});

test("a too-short +number and a bare digit run are not E.164 matches", () => {
  expect(phones("version +1.2 shipped")).toEqual([]);
  expect(phones("id 5551234567 only")).toEqual([]); // bare run, no + and no cue
});
