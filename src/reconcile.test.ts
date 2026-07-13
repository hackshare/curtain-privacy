import { expect, test } from "vitest";
import { snapNameSpans, propagateSurfaces, reconcileSpans } from "./reconcile.ts";
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
