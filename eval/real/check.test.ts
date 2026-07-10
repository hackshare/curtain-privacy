import { expect, test } from "vitest";
import { casesPath, checkReal, REAL_THRESHOLDS } from "./check.ts";
import type { Report } from "./score.ts";

function report(protectedRate: number, keepViolationRate: number): Report {
  return {
    cases: 1,
    overall: { redactTotal: 100, protected: 0, protectedRate, keepTotal: 100, violations: 0, keepViolationRate },
    byTier: {}, byLabel: {}, leaks: [], violations: [],
  };
}

test("passes a report above the floor and below the ceiling", () => {
  const r = checkReal(report(0.9808, 0.0146), REAL_THRESHOLDS);
  expect(r.ok).toBe(true);
  expect(r.failures).toEqual([]);
});

test("fails when protected_rate is below the floor", () => {
  const r = checkReal(report(0.96, 0.0146), REAL_THRESHOLDS);
  expect(r.ok).toBe(false);
  expect(r.failures.join(" ")).toMatch(/protected_rate/);
});

test("fails when keep_violation_rate is above the ceiling", () => {
  const r = checkReal(report(0.9808, 0.05), REAL_THRESHOLDS);
  expect(r.ok).toBe(false);
  expect(r.failures.join(" ")).toMatch(/keep_violation/);
});

test("defaults to the real cases file", () => {
  expect(casesPath([])).toBe("eval/real/cases.jsonl");
});

test("returns the --cases value when given", () => {
  expect(casesPath(["--cases", "train/fairness/cases.jsonl"])).toBe("train/fairness/cases.jsonl");
});

test("ignores an unrelated flag", () => {
  expect(casesPath(["--device", "cpu"])).toBe("eval/real/cases.jsonl");
});
