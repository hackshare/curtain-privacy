/**
 * Leak instrumentation for the native bench: per-label term recall plus a
 * taxonomy of WHY each private term leaked. Pure and model-free so it is unit
 * tested directly; the bench (run.ts) feeds it real per-row detection results.
 */
import { KEEP_LABELS, type PiiLabel, type Span } from "../../src/types.ts";
import { wilsonCi } from "./score.ts";
import { charCoverage } from "./coverage.ts";

export type LeakCause = "undetected" | "keep_misroute" | "under_cover";

/** A gold private term: its value, our-schema label, and raw offsets. */
export interface GoldTerm {
  readonly value: string;
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Why a leaked gold term escaped, judged at its primary offset. Precedence:
 * under_cover -> keep_misroute -> undetected. A leaked term whose primary
 * location is fully redacted (a duplicate-value leak elsewhere) falls to
 * undetected — an occurrence the detector missed.
 */
export function classifyLeak(term: GoldTerm, detected: readonly Span[], redactSpans: readonly Span[]): LeakCause {
  const fullyCovered = redactSpans.some((s) => s.start <= term.start && s.end >= term.end);
  const partial = redactSpans.some(
    (s) => overlaps(s.start, s.end, term.start, term.end) && !(s.start <= term.start && s.end >= term.end),
  );
  if (partial && !fullyCovered) return "under_cover";
  const keepMisroute = detected.some(
    (s) => overlaps(s.start, s.end, term.start, term.end) && KEEP_LABELS.has(s.label as PiiLabel),
  );
  if (keepMisroute) return "keep_misroute";
  return "undetected";
}

export interface LabelLeakReport {
  readonly char_recall: number;
  readonly protected_rate: number;
  readonly protected_rate_wilson95: [number, number];
  readonly private_total: number;
  readonly fully_protected: number;
  readonly leaked: number;
  readonly causes: { undetected: number; keep_misroute: number; under_cover: number };
}

/** Accumulates per-label char-level recall + fully-protected rate + leak causes. */
export class LeakAccumulator {
  private readonly terms = new Map<string, number>();
  private readonly fullyProtected = new Map<string, number>();
  private readonly charTotal = new Map<string, number>();
  private readonly charCovered = new Map<string, number>();
  private readonly causes = new Map<string, { undetected: number; keep_misroute: number; under_cover: number }>();

  private bump(map: Map<string, number>, key: string, by: number): void {
    map.set(key, (map.get(key) ?? 0) + by);
  }

  /**
   * Record one gold private term. Leaked-ness is char-level: a term is fully
   * protected iff every significant (alphanumeric) char of its gold occurrence
   * is inside a redact span. Not-fully-protected terms get a leak cause.
   */
  add(term: GoldTerm, detected: readonly Span[], redactSpans: readonly Span[]): void {
    this.bump(this.terms, term.label, 1);
    if (!this.causes.has(term.label)) this.causes.set(term.label, { undetected: 0, keep_misroute: 0, under_cover: 0 });
    const { significant, covered } = charCoverage(term.value, term.start, redactSpans);
    this.bump(this.charTotal, term.label, significant);
    this.bump(this.charCovered, term.label, covered);
    if (significant === 0 || covered === significant) {
      this.bump(this.fullyProtected, term.label, 1);
      return;
    }
    this.causes.get(term.label)![classifyLeak(term, detected, redactSpans)] += 1;
  }

  report(): Record<string, LabelLeakReport> {
    const out: Record<string, LabelLeakReport> = {};
    for (const [label, total] of this.terms) {
      const fp = this.fullyProtected.get(label) ?? 0;
      const ct = this.charTotal.get(label) ?? 0;
      const cc = this.charCovered.get(label) ?? 0;
      out[label] = {
        char_recall: ct ? cc / ct : 1,
        protected_rate: total ? fp / total : 1,
        protected_rate_wilson95: wilsonCi(fp, total),
        private_total: total,
        fully_protected: fp,
        leaked: total - fp,
        causes: this.causes.get(label)!,
      };
    }
    return out;
  }

  aggregate(): {
    char_recall: number;
    protected_rate: number;
    protected_rate_wilson95: [number, number];
    private_total: number;
    fully_protected: number;
  } {
    let total = 0;
    let fp = 0;
    let ct = 0;
    let cc = 0;
    for (const [label, t] of this.terms) {
      total += t;
      fp += this.fullyProtected.get(label) ?? 0;
      ct += this.charTotal.get(label) ?? 0;
      cc += this.charCovered.get(label) ?? 0;
    }
    return {
      char_recall: ct ? cc / ct : 1,
      protected_rate: total ? fp / total : 1,
      protected_rate_wilson95: wilsonCi(fp, total),
      private_total: total,
      fully_protected: fp,
    };
  }
}
