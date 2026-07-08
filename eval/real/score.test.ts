import { expect, test } from "vitest";
import type { Span } from "../../src/types.ts";
import type { ResolvedCase } from "./load.ts";
import { scoreCase, aggregate } from "./score.ts";

function span(start: number, end: number): Span {
  return { start, end, label: "EMAIL", score: 1, source: "heuristic", text: "" };
}

const caseA: ResolvedCase = {
  id: "a", tier: "normal", text: "mail a@b.com keep $240",
  redact: [{ label: "EMAIL", value: "a@b.com", start: 5, end: 12 }],
  keep: [{ value: "$240", start: 18, end: 22 }],
};

test("a fully covered redact term is protected; untouched keep term is clean", () => {
  const s = scoreCase(caseA, [span(5, 12)]);
  expect(s.redactProtected).toBe(1);
  expect(s.leaks).toHaveLength(0);
  expect(s.violations).toHaveLength(0);
});

test("a partially covered redact term leaks", () => {
  const s = scoreCase(caseA, [span(5, 9)]); // covers "a@b." not "com"
  expect(s.redactProtected).toBe(0);
  expect(s.leaks.map((t) => t.value)).toEqual(["a@b.com"]);
});

test("a redact span touching a keep term is a violation", () => {
  const s = scoreCase(caseA, [span(5, 12), span(18, 22)]); // also grabbed $240
  expect(s.violations.map((t) => t.value)).toEqual(["$240"]);
});

test("aggregate rolls up protected_rate, keep_violation_rate, by tier and label", () => {
  const scores = [scoreCase(caseA, [span(5, 12)])];
  const r = aggregate([caseA], scores);
  expect(r.overall.protectedRate).toBe(1);
  expect(r.overall.keepViolationRate).toBe(0);
  expect(r.byTier.normal.protectedRate).toBe(1);
  expect(r.byLabel.EMAIL).toMatchObject({ total: 1, protected: 1 });
});
