/**
 * Span reconciliation + default-deny policy.
 *
 * Detectors (heuristic + NER) emit overlapping, possibly conflicting spans.
 * {@link mergeSpans} resolves them into a non-overlapping set, then
 * {@link applyPolicy} drops anything in the keep-set so only redactable spans
 * remain. This is Option A: redact detected entities whose label is not kept.
 */

import { KEEP_LABELS, shouldRedact, type PiiLabel, type Span } from "./types";

/**
 * Reduce overlapping spans to a disjoint set. When two spans overlap, the
 * higher-confidence one wins; ties break toward the longer span, then toward
 * heuristics (validator-backed, so most trustworthy). Biased to *keep* a
 * redaction rather than drop one — recall over precision, per the threat model.
 *
 * On any overlap the merged span covers the byte-union; the label follows
 * default-deny so a union never drops redact-class bytes. A redact-class span
 * always beats an overlapping keep-class span for the union label.
 */
export function mergeSpans(spans: readonly Span[], keepLabels: ReadonlySet<PiiLabel> = KEEP_LABELS): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (prev === undefined || span.start >= prev.end) {
      merged.push(span);
      continue;
    }
    // Any overlap: cover the byte-union so no detected byte is dropped. The
    // label is default-deny — a redact-class span beats an overlapping
    // keep-class one — so a union can never re-expose bytes a detector redacted.
    const winner = preferredRedactFirst(prev, span, keepLabels);
    const start = Math.min(prev.start, span.start);
    const end = Math.max(prev.end, span.end);
    merged[merged.length - 1] = { ...winner, start, end, text: winner.text };
  }
  return merged;
}

function preferredRedactFirst(a: Span, b: Span, keepLabels: ReadonlySet<PiiLabel>): Span {
  const aRedact = shouldRedact(a.label, keepLabels);
  const bRedact = shouldRedact(b.label, keepLabels);
  if (aRedact !== bRedact) return aRedact ? a : b;
  return preferred(a, b);
}

function preferred(a: Span, b: Span): Span {
  if (a.score !== b.score) return a.score > b.score ? a : b;
  const aLen = a.end - a.start;
  const bLen = b.end - b.start;
  if (aLen !== bLen) return aLen > bLen ? a : b;
  return a.source === "heuristic" ? a : b;
}

/**
 * Apply the keep-set. Returns only spans that must be redacted, sorted right to
 * left so callers can splice from the end and keep earlier offsets valid.
 */
export function applyPolicy(spans: readonly Span[], keepLabels: ReadonlySet<PiiLabel> = KEEP_LABELS): Span[] {
  return mergeSpans(spans, keepLabels)
    .filter((s) => shouldRedact(s.label, keepLabels))
    .sort((a, b) => b.start - a.start);
}
