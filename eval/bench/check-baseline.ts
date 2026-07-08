/**
 * Acceptance gate: assert a reproduced summary.json lands within CI of the
 * frozen char-level baseline, measured against the shipped Rampart weights
 * (nationaldesignstudio/rampart) on the frozen 30k held-out set.
 *
 * Gate logic (two conditions must both pass):
 *
 * 1. Protected-rate CI overlap: the Wilson-95 confidence interval for
 *    private_protected_rate in the new run must overlap the frozen baseline CI.
 *    This is the primary privacy gate — it ensures the fraction of private
 *    character-occurrences that are fully protected has not regressed.
 *
 * 2. Strict span F1 within tolerance: the IoU=1.0 span F1 must be within
 *    strictF1Tol of the frozen value. This guards against unintended shifts in
 *    precision/recall that the protected-rate metric would miss.
 *
 * Numbers are char-level/occurrence-anchored and are not comparable to the
 * earlier substring-recall or whitepaper span-F1 figures.
 */
export interface BaselineRef {
  /** Frozen private_protected_rate Wilson-95 band. New run's CI must overlap it. */
  readonly protectedRateWilson95: readonly [number, number];
  /** Frozen strict (IoU=1.0) span F1, with accepted absolute tolerance. */
  readonly strictF1: number;
  readonly strictF1Tol: number;
}

export const BASELINE_REF: BaselineRef = {
  protectedRateWilson95: [0.9882884519736814, 0.9894324162705477],
  strictF1: 0.7654653599867222,
  strictF1Tol: 0.005,
};

interface SummaryShape {
  readonly private_protected_rate_wilson95: readonly [number, number];
  readonly span_f1: Readonly<Record<string, { readonly f1: number }>>;
}

function intervalsOverlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

export function checkBaseline(summary: SummaryShape, ref: BaselineRef): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const ci = summary.private_protected_rate_wilson95;
  if (!intervalsOverlap(ci, ref.protectedRateWilson95)) {
    failures.push(`protected_rate CI [${ci[0]}, ${ci[1]}] does not overlap frozen baseline [${ref.protectedRateWilson95[0]}, ${ref.protectedRateWilson95[1]}]`);
  }
  const strict = summary.span_f1["iou_1.00"]?.f1;
  if (strict === undefined || Math.abs(strict - ref.strictF1) > ref.strictF1Tol) {
    failures.push(`strict F1 ${strict} not within ${ref.strictF1Tol} of frozen baseline ${ref.strictF1}`);
  }
  return { ok: failures.length === 0, failures };
}
