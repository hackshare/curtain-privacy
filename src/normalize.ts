// src/normalize.ts
import { foldConfusable } from "./confusables";
import type { Span } from "./types";

/** Zero-width and invisible format characters dropped before detection. */
const INVISIBLE = new Set([
  "\u200B", // zero-width space
  "\u200C", // zero-width non-joiner
  "\u200D", // zero-width joiner
  "\u2060", // word joiner
  "\uFEFF", // BOM / zero-width no-break space
  "\u00AD", // soft hyphen
  "\u200E", // left-to-right mark
  "\u200F", // right-to-left mark
]);

/** Unusual horizontal spaces folded to a regular space. NFKC covers most of
 * these, but folding explicitly guarantees the behavior across Unicode versions. */
const UNUSUAL_SPACE = new Set([
  "\u00A0", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007",
  "\u2008", "\u2009", "\u200A", "\u202F", "\u205F", "\u1680", "\u2000",
  "\u2001", "\u3000",
]);

/** Neutralized placeholder brackets: passed through NFKC unchanged so that
 * placeholder neutralization is not undone in the detection view. */
const NEUTRALIZED_BRACKETS = new Set(["［", "］"]);

export interface NormalizedText {
  /** The normalized detection view. */
  readonly text: string;
  /** `rawStart[i]` is the original offset where normalized char `i` begins. */
  readonly rawStart: number[];
  /** `rawEnd[i]` is the original offset just past that character's source. */
  readonly rawEnd: number[];
}

/**
 * Produce a normalized view of `text` for detection: zero-width characters
 * removed, compatibility and confusable forms folded to ASCII, unusual spaces
 * regularized. Records, per output character, the `[start, end)` original
 * offsets of the code point it came from, so detected spans project back to
 * exact original coordinates. Total: never throws.
 */
export function normalizeForDetection(text: string): NormalizedText {
  let out = "";
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let i = 0;
  for (const cp of text) {
    const width = cp.length;
    if (INVISIBLE.has(cp)) {
      i += width;
      continue;
    }
    const decomposed = NEUTRALIZED_BRACKETS.has(cp) ? cp : cp.normalize("NFKC");
    for (const ch of decomposed) {
      const folded = foldConfusable(ch);
      const mapped = UNUSUAL_SPACE.has(folded) ? " " : folded;
      out += mapped;
      rawStart.push(i);
      rawEnd.push(i + width);
    }
    i += width;
  }
  return { text: out, rawStart, rawEnd };
}

/** Project a span detected in normalized coordinates back to original offsets,
 * re-slicing its text from the original input. */
export function remapSpan(span: Span, nrm: NormalizedText, original: string): Span {
  const start = nrm.rawStart[span.start];
  const end = nrm.rawEnd[span.end - 1];
  return { ...span, start, end, text: original.slice(start, end) };
}
