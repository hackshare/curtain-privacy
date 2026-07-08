/**
 * Character-level coverage of a gold occurrence by the redaction. `value` is the
 * exact substring at source offset `start`, so `value[i]` sits at `start + i`.
 * Only significant (alphanumeric) characters count — a surviving space is not a
 * leak. Used for both private recall (covered = redacted) and public retention
 * (covered = over-redacted).
 */
import type { Span } from "../../src/types.ts";

const SIGNIFICANT = /[\p{L}\p{N}]/u;

export function charCoverage(
  value: string,
  start: number,
  redactSpans: readonly Span[],
): { significant: number; covered: number } {
  let significant = 0;
  let covered = 0;
  for (let i = 0; i < value.length; i++) {
    if (!SIGNIFICANT.test(value[i])) continue;
    significant++;
    const pos = start + i;
    if (redactSpans.some((s) => s.start <= pos && pos < s.end)) covered++;
  }
  return { significant, covered };
}
