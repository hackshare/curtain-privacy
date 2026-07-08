import { expect, test } from "vitest";
import { checkBaseline, BASELINE_REF } from "./check-baseline.ts";

const goodSummary = {
  private_protected_rate: 0.9889,
  private_protected_rate_wilson95: [0.9882884519736814, 0.9894324162705477] as [number, number],
  span_f1: { "iou_1.00": { f1: 0.7654653599867222 } },
};

test("passes when protected_rate CI overlaps baseline and strict F1 is within tolerance", () => {
  const res = checkBaseline(goodSummary, BASELINE_REF);
  expect(res.ok).toBe(true);
  expect(res.failures).toEqual([]);
});

test("fails when protected_rate CI does not overlap the baseline band", () => {
  const res = checkBaseline({ ...goodSummary, private_protected_rate_wilson95: [0.5, 0.6] }, BASELINE_REF);
  expect(res.ok).toBe(false);
  expect(res.failures.some((f) => f.includes("protected_rate"))).toBe(true);
});

test("fails when strict F1 drifts beyond tolerance", () => {
  const res = checkBaseline({ ...goodSummary, span_f1: { "iou_1.00": { f1: 0.50 } } }, BASELINE_REF);
  expect(res.ok).toBe(false);
  expect(res.failures.some((f) => f.includes("strict F1"))).toBe(true);
});
