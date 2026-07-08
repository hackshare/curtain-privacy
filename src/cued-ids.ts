import type { PiiLabel, Span } from "./types";

/** A context-cued identifier rule: a global candidate regex, an identity-cue
 * regex tested against the lowercased preceding window, and the label to emit. */
export interface CuedIdRule {
  readonly candidate: RegExp;
  readonly cues: RegExp;
  readonly label: PiiLabel;
  readonly window?: number;
}

const DEFAULT_WINDOW = 48;

/** A '#' (allowing intervening spaces) right before the code marks an order code. */
const HASH_PREFIX = /#\s*$/;

/**
 * Detect context-cued identifiers: a candidate is emitted only when it is not
 * '#'-prefixed and a cue appears in the window just before it. The window is
 * clamped to the end of the previous candidate so a cue that belongs to one code
 * cannot bleed onto the next look-alike token. Spans may overlap other detectors;
 * the pipeline's merge step resolves conflicts before redaction.
 */
export function detectCuedIds(raw: string, rule: CuedIdRule): Span[] {
  const spans: Span[] = [];
  const window = rule.window ?? DEFAULT_WINDOW;
  rule.candidate.lastIndex = 0;
  let prevEnd = 0;
  for (let m = rule.candidate.exec(raw); m !== null; m = rule.candidate.exec(raw)) {
    const start = m.index;
    const end = start + m[0].length;
    const before = raw.slice(Math.max(start - window, prevEnd), start);
    prevEnd = end;
    if (HASH_PREFIX.test(before)) continue;
    if (!rule.cues.test(before.toLowerCase())) continue;
    spans.push({ start, end, label: rule.label, score: 1, source: "heuristic", text: m[0] });
  }
  return spans;
}
