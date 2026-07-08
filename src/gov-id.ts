/**
 * Context-gated recognizer for custom-prefixed government and agency identifiers
 * (`EMP-334455`, `NIN-998877`, `GV9876543`) that the model misses because it was
 * not trained on arbitrary agency prefixes.
 *
 * These IDs share their shape with order and reference codes that must NOT be
 * redacted (`#ORD-8821045`, `ref:WIRE-20260502`), so detection alone would trade
 * a leak for over-redaction. The recognizer discriminates on two signals that
 * separate the two in practice: order codes carry a leading `#`, and a real ID
 * sits next to an identity cue ("government ID", "emp id", "staff badge"). A
 * candidate is redacted only when it is not `#`-prefixed and a cue appears in the
 * short window just before it.
 *
 * The span is additive, not premasked: the model was never trained with a
 * `[GOVERNMENT_ID]` sentinel for these prefixes, so the span is merged with the
 * model's view downstream rather than hiding the text from it (the same choice
 * the PHONE recognizer makes).
 */

import type { Span } from "./types";
import { detectCuedIds } from "./cued-ids";

/** 2-5 uppercase letters, an optional single hyphen, then 4-12 digits. The letter
 * prefix keeps it off SSN/phone/account digit runs; requiring the digits adjacent
 * (only an optional hyphen, no space) keeps it off `State ZIP` like `TX 75201`. */
const CANDIDATE = /\b[A-Z]{2,5}-?\d{4,12}\b/g;

/** Identity cues that mark a prefixed code as a personal government or agency ID
 * rather than an order/reference code. Matched, lowercased, in the window before
 * a candidate. The set is kept to cues the corpus actually relies on; broad words
 * like "agent" or "member" are excluded because they occur in non-identity
 * contexts ("travel agent", "committee member") and each redact case is already
 * covered by a narrower cue. Bare "id" stays in because a few IDs ("state-issued
 * ID number is GV...") carry no other cue; detectCuedIds clamps the cue window to
 * the previous match so that breadth cannot bleed across tokens. */
export const GOV_ID_CUES =
  /\b(?:ids?|gov|government|agency|employee|emp|staff|badge|resident|claimant|nin|national insurance|social insurance|social security|aadhaar|citizen)\b/;

/** Detect context-cued government/agency identifiers. */
export function detectGovernmentIds(raw: string): Span[] {
  return detectCuedIds(raw, { candidate: CANDIDATE, cues: GOV_ID_CUES, label: "GOVERNMENT_ID" });
}
