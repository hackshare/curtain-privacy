/**
 * Phase 0 acceptance gate: assert a reproduced summary.json lands within CI of
 * curtain-privacy's FROZEN Phase-0 baseline, measured against the SHIPPED HF
 * Rampart weights (nationaldesignstudio/rampart).
 *
 * The whitepaper reports strict F1 0.528; our run of the same model on the same
 * frozen dataset scores 0.756. Both weights (blob-identical since the 2026-06-29
 * HF release) and dataset (frozen 2026-06-03) were ruled out as causes. The gap
 * is a scoring-harness difference: the whitepaper's older harness under-counted
 * exact span matches — fp and fn co-inflated while tp dropped ~31k, the
 * fingerprint of a span offset/boundary miscount that the current vendored
 * harness fixes. 0.756 is the same model under correct scoring; that is what
 * BASELINE_REF freezes.
 *
 * Forward regression-gate semantics (one-sided "no worse than baseline") can
 * be refined when Phase 1 begins.
 */
export interface BaselineRef {
  /** Frozen private-recall Wilson95 band. Our recall CI must overlap it. */
  readonly recallWilson95: readonly [number, number];
  /** Frozen strict (IoU=1.0) span F1, with accepted absolute tolerance. */
  readonly strictF1: number;
  readonly strictF1Tol: number;
}

export const BASELINE_REF: BaselineRef = {
  recallWilson95: [0.9856503709526369, 0.9869181646947774],
  strictF1: 0.7563543378434413,
  strictF1Tol: 0.005,
};

interface SummaryShape {
  readonly private_recall_wilson95: readonly [number, number];
  readonly span_f1: Readonly<Record<string, { readonly f1: number }>>;
}

/** True iff the closed intervals [a0,a1] and [b0,b1] overlap. */
function intervalsOverlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

export function checkBaseline(summary: SummaryShape, ref: BaselineRef): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const ourCi = summary.private_recall_wilson95;
  if (!intervalsOverlap(ourCi, ref.recallWilson95)) {
    failures.push(
      `recall CI [${ourCi[0]}, ${ourCi[1]}] does not overlap frozen baseline [${ref.recallWilson95[0]}, ${ref.recallWilson95[1]}]`,
    );
  }

  const strict = summary.span_f1["iou_1.00"]?.f1;
  if (strict === undefined || Math.abs(strict - ref.strictF1) > ref.strictF1Tol) {
    failures.push(`strict F1 ${strict} not within ${ref.strictF1Tol} of frozen baseline ${ref.strictF1}`);
  }

  return { ok: failures.length === 0, failures };
}
