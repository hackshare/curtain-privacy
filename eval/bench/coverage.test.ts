import { expect, test } from "vitest";
import { charCoverage } from "./coverage.ts";
import type { Span } from "../../src/types.ts";

function span(start: number, end: number): Span {
  return { start, end, label: "SSN", score: 1, source: "heuristic", text: "" };
}

test("full coverage: every significant char inside a redact span", () => {
  // "Rivera" at source offset 10, redacted [10,16)
  expect(charCoverage("Rivera", 10, [span(10, 16)])).toEqual({ significant: 6, covered: 6 });
});

test("partial coverage of a multi-token value", () => {
  // "2 09 12" at offset 0; only "09" (offsets 2-4) redacted → 2 of 5 sig chars covered
  expect(charCoverage("2 09 12", 0, [span(2, 4)])).toEqual({ significant: 5, covered: 2 });
});

test("whitespace/separators are not significant", () => {
  // "  -- " has no alphanumerics
  expect(charCoverage("  -- ", 0, [span(0, 5)])).toEqual({ significant: 0, covered: 0 });
});

test("a redact span elsewhere does not cover this occurrence", () => {
  // "4" at offset 20, redact span is at [5,6) — the OTHER "4"
  expect(charCoverage("4", 20, [span(5, 6)])).toEqual({ significant: 1, covered: 0 });
});
