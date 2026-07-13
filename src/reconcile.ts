/**
 * Post-detection reconciliation: two deterministic passes over original-text
 * offsets, run after the detector emits spans and before the default-deny
 * policy. Both only widen or add redactions, never remove one, matching the
 * library's recall-over-precision threat model.
 *
 *  - snapNameSpans widens a name/street span whose edge fell mid-word (a
 *    subword tag such as "Smit" for "Smith") out to the whole word, so no
 *    letter fragment of a redacted name is left beside its placeholder.
 *  - propagateSurfaces redacts every other whole-word occurrence of a value the
 *    detector flagged once, so a name mentioned many times but tagged once does
 *    not leak on the rest.
 */
import { shouldRedact, type PiiLabel, type Span } from "./types";

/** Contextual labels whose spans snap to word boundaries. Structured IDs are
 * handled by extendSpans; snapping a keep-set label would not change what is
 * redacted. */
const SNAP_LABELS = new Set<PiiLabel>(["GIVEN_NAME", "SURNAME", "STREET_NAME"]);

const LETTER = /\p{L}/u;

/** True when text[i] exists and is a Unicode letter. */
function isLetter(text: string, i: number): boolean {
  return i >= 0 && i < text.length && LETTER.test(text[i]);
}

/**
 * Widen each name/street span outward across letters to its whitespace- or
 * punctuation-delimited word, so a subword tag cannot leave a letter fragment
 * of the name exposed. Spans of other labels pass through untouched.
 */
export function snapNameSpans(text: string, spans: readonly Span[]): Span[] {
  return spans.map((s) => {
    if (!SNAP_LABELS.has(s.label)) return s;
    let start = s.start;
    let end = s.end;
    while (isLetter(text, start - 1)) start--;
    while (isLetter(text, end)) end++;
    return start === s.start && end === s.end
      ? s
      : { ...s, start, end, text: text.slice(start, end) };
  });
}

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every whole-word, case-insensitive occurrence of `surface` in `text`, as
 * [start, end) pairs. Whole-word means neither side abuts a Unicode letter, so
 * "Li" matches the standalone word but never the "li" inside "climbs".
 */
function* wholeWordOccurrences(text: string, surface: string): Generator<[number, number]> {
  const re = new RegExp(escapeRegExp(surface), "giu");
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isLetter(text, start - 1) && !isLetter(text, end)) yield [start, end];
    if (re.lastIndex === start) re.lastIndex++;
  }
}

/**
 * For every redact-class span, add a same-label span at each other whole-word
 * occurrence of its surface. A value the detector caught once is thus redacted
 * everywhere it appears in the message. Keep-class spans are not propagated.
 * The originals are returned alongside the additions; overlap and duplication
 * are resolved later by mergeSpans.
 */
export function propagateSurfaces(
  text: string,
  spans: readonly Span[],
  keepLabels: ReadonlySet<PiiLabel>,
): Span[] {
  const additions: Span[] = [];
  const done = new Set<string>();
  for (const s of spans) {
    if (!shouldRedact(s.label, keepLabels)) continue;
    const surface = text.slice(s.start, s.end);
    if (surface.length === 0) continue;
    const key = `${s.label}:${surface.toLowerCase()}`;
    if (done.has(key)) continue;
    done.add(key);
    for (const [start, end] of wholeWordOccurrences(text, surface)) {
      additions.push({ ...s, start, end, text: text.slice(start, end) });
    }
  }
  return [...spans, ...additions];
}

/**
 * Run both reconciliation passes in order: snap name spans to word boundaries,
 * then propagate every redact-class surface to its whole-word repeats. Snap
 * runs first so propagation searches for the corrected, whole-word surface.
 */
export function reconcileSpans(
  text: string,
  spans: readonly Span[],
  keepLabels: ReadonlySet<PiiLabel>,
): Span[] {
  return propagateSurfaces(text, snapNameSpans(text, spans), keepLabels);
}
