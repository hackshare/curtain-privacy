import type { Span } from "./types";
import { detectCuedIds } from "./cued-ids";

/** Matched, lowercased, in the window before a candidate. */
export const PASSPORT_CUES = /\bpassport\b/;

/** 6-9 uppercase alphanumerics containing at least one digit. The digit
 * requirement and the passport cue keep it off ordinary uppercase words. */
const CANDIDATE = /\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,9}\b/g;

/** Detect passport numbers that sit next to a "passport" cue. Additive backstop;
 * PASSPORT is in NO_PREMASK_LABELS so these are redacted but shown to the model.
 * PASSPORT is in EXTEND_LABELS, so a partial code extends to its token boundary. */
export function detectPassport(raw: string): Span[] {
  return detectCuedIds(raw, { candidate: CANDIDATE, cues: PASSPORT_CUES, label: "PASSPORT" });
}
