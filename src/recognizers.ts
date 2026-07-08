/**
 * Complete a redaction to its full ID token. The model/heuristics often redact
 * the core of a formatted fiscal ID (e.g. "108-040-140") but stop at a separator
 * that is still part of the same token, leaking the affix ("CHE-", a leading
 * digit, or an alphanumeric wrapper). For structured-ID spans, extend across
 * ID-connector characters to the token boundary — stopping at whitespace — so no
 * ID fragment survives. Names/street/email are excluded (over-redaction risk).
 */
import type { Span } from "./types";

const EXTEND_LABELS = new Set<string>([
  "SSN",
  "TAX_ID",
  "CREDIT_CARD",
  "GOVERNMENT_ID",
  "PASSPORT",
  "DRIVERS_LICENSE",
  "BANK_ACCOUNT",
  "ROUTING_NUMBER",
]);

const ID_CHAR = /[\p{L}\p{N}./-]/u;
const ALNUM = /[\p{L}\p{N}]/u;

export function extendSpans(text: string, spans: readonly Span[]): Span[] {
  return spans.map((s) => {
    if (!EXTEND_LABELS.has(s.label)) return s;
    let start = s.start;
    let end = s.end;
    while (start > 0 && ID_CHAR.test(text[start - 1])) start--;
    while (end < text.length && ID_CHAR.test(text[end])) end++;
    // Trim separators the extension added, but never shrink below the original span.
    while (start < s.start && !ALNUM.test(text[start])) start++;
    while (end > s.end && !ALNUM.test(text[end - 1])) end--;
    return start === s.start && end === s.end ? s : { ...s, start, end, text: text.slice(start, end) };
  });
}
