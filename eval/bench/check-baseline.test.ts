import { expect, test } from "vitest";
import { checkBaseline, BASELINE_REF } from "./check-baseline.ts";

const goodSummary = {
  private_recall: 0.98630,
  private_recall_wilson95: [0.9856503709526369, 0.9869181646947774] as [number, number],
  span_f1: { "iou_1.00": { f1: 0.7563543378434413 } },
};

test("passes when recall CI overlaps baseline and strict F1 is within tolerance", () => {
  const res = checkBaseline(goodSummary, BASELINE_REF);
  expect(res.ok).toBe(true);
  expect(res.failures).toEqual([]);
});

test("fails when recall CI does not overlap the baseline band", () => {
  const res = checkBaseline({ ...goodSummary, private_recall_wilson95: [0.95, 0.96] }, BASELINE_REF);
  expect(res.ok).toBe(false);
  expect(res.failures.some((f) => f.includes("recall"))).toBe(true);
});

test("fails when strict F1 drifts beyond tolerance", () => {
  const res = checkBaseline({ ...goodSummary, span_f1: { "iou_1.00": { f1: 0.50 } } }, BASELINE_REF);
  expect(res.ok).toBe(false);
  expect(res.failures.some((f) => f.includes("strict F1"))).toBe(true);
});
