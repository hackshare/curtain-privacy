import { expect, test } from "vitest";
import { mergeSpans, applyPolicy } from "./policy.ts";
import type { Span } from "./types.ts";

function span(start: number, end: number, label: string, score: number, source: Span["source"] = "ner"): Span {
  return { start, end, label: label as Span["label"], score, source, text: "" };
}

test("full containment keeps the fuller span (union), not the shorter higher-score one", () => {
  const full = span(0, 17, "EMAIL", 0.7, "ner");
  const clip = span(6, 17, "EMAIL", 1.0, "heuristic");
  const out = mergeSpans([full, clip]);
  expect(out).toHaveLength(1);
  expect([out[0].start, out[0].end]).toEqual([0, 17]);
});

test("keep-class vs redact-class union is redacted (default-deny)", () => {
  const city = span(0, 10, "CITY", 0.9, "ner");
  const ssn = span(5, 15, "SSN", 1.0, "heuristic");
  const merged = mergeSpans([city, ssn]);
  expect([merged[0].start, merged[0].end]).toEqual([0, 15]);
  expect(merged[0].label).toBe("SSN");
  expect(applyPolicy([city, ssn]).some((s) => s.start <= 0 && s.end >= 15)).toBe(true);
});

test("two keep-class spans stay kept and are dropped by policy", () => {
  const city = span(0, 12, "CITY", 0.8, "ner");
  const state = span(3, 8, "STATE", 0.95, "ner");
  const merged = mergeSpans([city, state]);
  expect(merged).toHaveLength(1);
  expect([merged[0].start, merged[0].end]).toEqual([0, 12]);
  expect(applyPolicy([city, state])).toHaveLength(0);
});

test("partial overlap still unions (unchanged behavior)", () => {
  const a = span(0, 10, "SSN", 1.0, "heuristic");
  const b = span(7, 20, "TAX_ID", 1.0, "heuristic");
  const out = mergeSpans([a, b]);
  expect([out[0].start, out[0].end]).toEqual([0, 20]);
});

test("monotonicity: adding a contained span never shrinks coverage", () => {
  const cover = span(2, 30, "EMAIL", 0.6, "ner");
  const inner = span(10, 20, "EMAIL", 1.0, "heuristic");
  const out = mergeSpans([cover, inner]);
  expect(out.some((s) => s.start <= 2 && s.end >= 30)).toBe(true);
});
