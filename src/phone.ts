import type { Span } from "./types";
import { detectCuedIds } from "./cued-ids";

/** Words that mark a nearby formatted number as a phone number. Matched,
 * lowercased, in the window before the candidate. */
export const PHONE_CUES = /\b(?:call|phone|telephone|tel|mobile|cell|fax|contact|whatsapp)\b/;

/** A formatted phone run: an optional leading '+'/'(' and a first group, then at
 * least one separated group. Requiring a separated group excludes bare digit
 * runs (account/order numbers), so only phone-shaped candidates are considered. */
const CANDIDATE = /(?<![\d+])\+?\(?\d{1,4}\)?(?:[-.\s]\d{1,4}){1,5}(?!\d)/g;

/** Detect '+'-less phone numbers that sit next to a phone cue. Additive backstop;
 * PHONE is in NO_PREMASK_LABELS so these are redacted but shown to the model. */
export function detectCuedPhone(raw: string): Span[] {
  return detectCuedIds(raw, { candidate: CANDIDATE, cues: PHONE_CUES, label: "PHONE" });
}
