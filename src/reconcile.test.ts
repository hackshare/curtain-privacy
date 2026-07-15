import { expect, test } from "vitest";
import { snapNameSpans, stripLeadingTitles, propagateSurfaces, reconcileSpans } from "./reconcile.ts";
import { KEEP_LABELS, type Span } from "./types.ts";

function span(text: string, needle: string, label: Span["label"], score = 0.9): Span {
  const start = text.indexOf(needle);
  return { start, end: start + needle.length, label, score, source: "ner", text: needle };
}

function allOffsets(text: string, needle: string): number[] {
  const out: number[] = [];
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}

// --- snapNameSpans ---

test("snap widens a trailing subword fragment to the whole name", () => {
  const text = "Maria Tanaka fell over";
  const at = text.indexOf("aka"); // model tagged only "aka" of "Tanaka"
  const spans: Span[] = [{ start: at, end: at + 3, label: "SURNAME", score: 0.4, source: "ner", text: "aka" }];
  const [snapped] = snapNameSpans(text, spans);
  expect(text.slice(snapped.start, snapped.end)).toBe("Tanaka");
  expect(snapped.text).toBe("Tanaka");
});

test("snap widens a leading subword fragment to the whole name", () => {
  const text = "Katie OBrien hit the wall";
  const at = text.indexOf("rien"); // model tagged only "rien" of "OBrien"
  const spans: Span[] = [{ start: at, end: at + 4, label: "GIVEN_NAME", score: 0.5, source: "ner", text: "rien" }];
  const [snapped] = snapNameSpans(text, spans);
  expect(text.slice(snapped.start, snapped.end)).toBe("OBrien");
});

test("snap leaves a whole-word name span unchanged (same object)", () => {
  const text = "James Smith was arrested";
  const s = span(text, "James", "GIVEN_NAME");
  const [out] = snapNameSpans(text, [s]);
  expect(out).toBe(s);
});

test("snap does not touch non-name labels", () => {
  const text = "ssn 123-45-6789 here";
  const s = span(text, "123-45-6789", "SSN", 1);
  const [out] = snapNameSpans(text, [s]);
  expect(out).toBe(s);
});

// --- propagateSurfaces ---

test("propagate redacts every repeat of a name caught once", () => {
  const text = "Timmy fell and then someone hit Timmy again, poor Timmy";
  const first = span(text, "Timmy", "GIVEN_NAME");
  const out = propagateSurfaces(text, [first], KEEP_LABELS);
  const covered = (i: number) =>
    out.some((sp) => sp.label === "GIVEN_NAME" && sp.start <= i && sp.end >= i + 5);
  const offsets = allOffsets(text, "Timmy");
  expect(offsets.length).toBe(3);
  for (const o of offsets) expect(covered(o)).toBe(true);
});

test("propagate is whole-word only, never a substring", () => {
  const text = "Li climbs quickly"; // "li" also sits inside "climbs"
  const first = span(text, "Li", "GIVEN_NAME");
  const out = propagateSurfaces(text, [first], KEEP_LABELS);
  const insideClimbs = text.indexOf("li", text.indexOf("climbs"));
  expect(out.some((sp) => sp.start === insideClimbs)).toBe(false);
});

test("propagate is case-insensitive", () => {
  const text = "Johnny ran; later johnny returned";
  const first = span(text, "Johnny", "GIVEN_NAME");
  const out = propagateSurfaces(text, [first], KEEP_LABELS);
  const lower = text.indexOf("johnny");
  expect(out.some((sp) => sp.start === lower)).toBe(true);
});

test("propagate skips keep-class labels", () => {
  const text = "Boston and Boston again";
  const first = span(text, "Boston", "CITY");
  const out = propagateSurfaces(text, [first], KEEP_LABELS);
  expect(out.length).toBe(1); // CITY is kept, so no additions
});

// --- reconcileSpans (snap before propagate) ---

test("reconcile snaps a fragment then propagates the whole word", () => {
  const text = "Tanaka met Tanaka"; // second mention should also go
  const at = text.indexOf("aka");
  const spans: Span[] = [{ start: at, end: at + 3, label: "SURNAME", score: 0.4, source: "ner", text: "aka" }];
  const out = reconcileSpans(text, spans, KEEP_LABELS);
  const covers = (i: number) => out.some((sp) => sp.start <= i && sp.end >= i + 6);
  for (const o of allOffsets(text, "Tanaka")) expect(covers(o)).toBe(true);
});

// --- stripLeadingTitles ---

test("strips a leading honorific from a name span", () => {
  const text = "The photographer, Miss Yowhana Mini Herrera.";
  const [out] = stripLeadingTitles(text, [span(text, "Miss Yowhana Mini", "GIVEN_NAME")], KEEP_LABELS);
  expect(text.slice(out.start, out.end)).toBe("Yowhana Mini");
  expect(out.text).toBe("Yowhana Mini");
});

test("strips titles across languages, accent- and case-insensitively", () => {
  for (const [text, needle, expected] of [
    ["O cliente Sr Pariya Di.", "Sr Pariya", "Pariya"],
    ["Geachte Dhr Jariff, dank.", "Dhr Jariff", "Jariff"],
    ["Bonjour Monsieur Léon Dubois.", "Monsieur Léon", "Léon"],
    ["Estimado SEÑOR Ervino Ok.", "SEÑOR Ervino", "Ervino"],
    ["Sehr geehrte Frau Müller.", "Frau Müller", "Müller"],
  ] as const) {
    const [out] = stripLeadingTitles(text, [span(text, needle, "GIVEN_NAME")], KEEP_LABELS);
    expect(text.slice(out.start, out.end)).toBe(expected);
  }
});

test("strips stacked titles in turn", () => {
  const text = "Als Prof Dr Smith aanwezig.";
  const [out] = stripLeadingTitles(text, [span(text, "Prof Dr Smith", "SURNAME")], KEEP_LABELS);
  expect(text.slice(out.start, out.end)).toBe("Smith");
});

test("leaves a non-title leading word untouched (same object)", () => {
  const text = "Grace Kelly attended.";
  const s = span(text, "Grace Kelly", "GIVEN_NAME");
  const [out] = stripLeadingTitles(text, [s], KEEP_LABELS);
  expect(out).toBe(s);
});

test("never consumes the whole span: a title-only span is left as-is", () => {
  const text = "Miss";
  const s = span(text, "Miss", "GIVEN_NAME");
  const [out] = stripLeadingTitles(text, [s], KEEP_LABELS);
  expect(out).toBe(s);
});

test("does not strip ambiguous title-or-name tokens (Sen)", () => {
  const text = "Amartya Sen Roy spoke.";
  const s = span(text, "Sen Roy", "SURNAME");
  const [out] = stripLeadingTitles(text, [s], KEEP_LABELS);
  expect(out).toBe(s);
});

test("ignores non-name labels", () => {
  const text = "Dr House ID.";
  const s = span(text, "Dr House", "GOVERNMENT_ID");
  const [out] = stripLeadingTitles(text, [s], KEEP_LABELS);
  expect(out).toBe(s);
});

test("preserves label, score, and source while narrowing", () => {
  const text = "Herr Weber signed.";
  const s: Span = { ...span(text, "Herr Weber", "SURNAME", 0.73), source: "ner" };
  const [out] = stripLeadingTitles(text, [s], KEEP_LABELS);
  expect(out.label).toBe("SURNAME");
  expect(out.score).toBe(0.73);
  expect(out.source).toBe("ner");
  expect(text.slice(out.start, out.end)).toBe("Weber");
});

test("reconcileSpans strips the title before propagating the clean name", () => {
  const text = "Miss Rivera called. Rivera waited.";
  const out = reconcileSpans(text, [span(text, "Miss Rivera", "SURNAME")], KEEP_LABELS);
  // Every emitted span is the clean surname; the title "Miss" is never redacted.
  expect(out.every((s) => text.slice(s.start, s.end) === "Rivera")).toBe(true);
  // Both "Rivera" occurrences are covered (the clean surface propagated, not "Miss Rivera").
  for (const o of allOffsets(text, "Rivera")) {
    expect(out.some((s) => s.start <= o && s.end >= o + "Rivera".length)).toBe(true);
  }
});
